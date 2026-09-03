// File: app/src/main/java/com/salvia/browxer/parser/DashParser.kt
package com.salvia.browxer.parser

import com.salvia.browxer.model.DashInfo
import com.salvia.browxer.model.DashSegment
import com.salvia.browxer.model.DashRepresentation
import com.salvia.browxer.model.DashAdaptationSet
import com.salvia.browxer.util.HttpClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/**
 * DASH Parser - Parses DASH (.mpd) manifests and extracts segment information.
 * 
 * Features:
 * - MPD manifest parsing
 * - Adaptation set extraction (video and audio)
 * - Representation selection (highest bitrate)
 * - Segment list extraction
 * - Parallel audio/video stream fetching
 */
class DashParser {

    private val httpClient = HttpClient()

    /**
     * Parse DASH manifest from URL
     */
    suspend fun parseManifest(url: String, headers: Map<String, String> = emptyMap()): DashInfo {
        return withContext(Dispatchers.IO) {
            try {
                // Fetch manifest content
                val manifestContent = httpClient.getString(url, headers)
                
                // Parse manifest
                parseManifestContent(manifestContent, url, headers)
                
            } catch (e: Exception) {
                throw Exception("Failed to parse DASH manifest: ${e.message}")
            }
        }
    }

    /**
     * Parse DASH manifest content
     */
    private fun parseManifestContent(
        content: String,
        baseUrl: String,
        headers: Map<String, String>
    ): DashInfo {
        val factory = XmlPullParserFactory.newInstance()
        factory.isNamespaceAware = true
        val parser = factory.newPullParser()
        
        parser.setInput(content.reader())
        
        var eventType = parser.eventType
        val adaptationSets = mutableListOf<DashAdaptationSet>()
        var currentAdaptationSet: DashAdaptationSet? = null
        var currentRepresentation: DashRepresentation? = null
        var currentSegment: DashSegment? = null
        
        var mpdType = ""
        var mpdMediaPresentationDuration: Double = 0.0
        var mpdMinBufferTime: Double = 0.0
        
        while (eventType != XmlPullParser.END_DOCUMENT) {
            when (eventType) {
                XmlPullParser.START_TAG -> {
                    when (parser.name) {
                        "MPD" -> {
                            mpdType = parser.getAttributeValue(null, "type") ?: ""
                            mpdMediaPresentationDuration = parser.getAttributeValue(null, "mediaPresentationDuration")?.toDoubleOrNull() ?: 0.0
                            mpdMinBufferTime = parser.getAttributeValue(null, "minBufferTime")?.toDoubleOrNull() ?: 0.0
                        }
                        "AdaptationSet" -> {
                            val mimeType = parser.getAttributeValue(null, "mimeType") ?: ""
                            val contentType = parser.getAttributeValue(null, "contentType") ?: ""
                            val id = parser.getAttributeValue(null, "id") ?: ""
                            val lang = parser.getAttributeValue(null, "lang") ?: ""
                            
                            currentAdaptationSet = DashAdaptationSet(
                                id = id,
                                mimeType = mimeType,
                                contentType = contentType,
                                lang = lang,
                                representations = mutableListOf(),
                                segments = mutableListOf()
                            )
                            adaptationSets.add(currentAdaptationSet!!)
                        }
                        "Representation" -> {
                            val id = parser.getAttributeValue(null, "id") ?: ""
                            val bandwidth = parser.getAttributeValue(null, "bandwidth")?.toLongOrNull() ?: 0
                            val width = parser.getAttributeValue(null, "width")?.toIntOrNull() ?: 0
                            val height = parser.getAttributeValue(null, "height")?.toIntOrNull() ?: 0
                            val frameRate = parser.getAttributeValue(null, "frameRate") ?: ""
                            val codecs = parser.getAttributeValue(null, "codecs") ?: ""
                            
                            currentRepresentation = DashRepresentation(
                                id = id,
                                bandwidth = bandwidth,
                                width = width,
                                height = height,
                                frameRate = frameRate,
                                codecs = codecs,
                                segments = mutableListOf()
                            )
                            currentAdaptationSet?.representations?.add(currentRepresentation!!)
                        }
                        "SegmentList" -> {
                            val duration = parser.getAttributeValue(null, "duration")?.toLongOrNull() ?: 0
                            val timescale = parser.getAttributeValue(null, "timescale")?.toLongOrNull() ?: 1
                            
                            currentSegment = DashSegment(
                                duration = duration,
                                timescale = timescale,
                                urls = mutableListOf()
                            )
                            currentRepresentation?.segments?.add(currentSegment!!)
                        }
                        "SegmentURL" -> {
                            val media = parser.getAttributeValue(null, "media") ?: ""
                            val index = parser.getAttributeValue(null, "index") ?: ""
                            
                            if (media.isNotEmpty()) {
                                val fullUrl = resolveUrl(baseUrl, media)
                                currentSegment?.urls?.add(fullUrl)
                            }
                            if (index.isNotEmpty()) {
                                val fullUrl = resolveUrl(baseUrl, index)
                                // Index segments are not added to URLs
                            }
                        }
                        "Initialization" -> {
                            val sourceURL = parser.getAttributeValue(null, "sourceURL") ?: ""
                            if (sourceURL.isNotEmpty()) {
                                val fullUrl = resolveUrl(baseUrl, sourceURL)
                                currentRepresentation?.initializationUrl = fullUrl
                            }
                        }
                    }
                }
                XmlPullParser.END_TAG -> {
                    when (parser.name) {
                        "Representation" -> {
                            currentRepresentation = null
                        }
                        "SegmentList" -> {
                            currentSegment = null
                        }
                    }
                }
            }
            
            eventType = parser.next()
        }
        
        // Separate video and audio adaptation sets
        val videoAdaptationSets = adaptationSets.filter { 
            it.mimeType.startsWith("video/") || it.contentType == "video" 
        }
        val audioAdaptationSets = adaptationSets.filter { 
            it.mimeType.startsWith("audio/") || it.contentType == "audio" 
        }
        
        // Select highest bitrate representations
        val videoRepresentations = videoAdaptationSets.flatMap { it.representations }
            .sortedByDescending { it.bandwidth }
        val audioRepresentations = audioAdaptationSets.flatMap { it.representations }
            .sortedByDescending { it.bandwidth }
        
        // Calculate total size
        val totalSize = calculateTotalSize(videoRepresentations, audioRepresentations)
        
        return DashInfo(
            type = mpdType,
            mediaPresentationDuration = mpdMediaPresentationDuration,
            minBufferTime = mpdMinBufferTime,
            videoAdaptationSets = videoAdaptationSets,
            audioAdaptationSets = audioAdaptationSets,
            videoRepresentations = videoRepresentations,
            audioRepresentations = audioRepresentations,
            segments = adaptationSets.flatMap { it.segments }.toList(),
            totalSize = totalSize
        )
    }

    /**
     * Calculate total size from representations
     */
    private fun calculateTotalSize(
        videoRepresentations: List<DashRepresentation>,
        audioRepresentations: List<DashRepresentation>
    ): Long {
        var totalSize: Long = 0
        
        // Estimate size based on bandwidth and duration
        // This is a rough estimate; actual size depends on content
        val videoRep = videoRepresentations.firstOrNull()
        val audioRep = audioRepresentations.firstOrNull()
        
        if (videoRep != null) {
            // Estimate video size: bandwidth (bits per second) * duration (seconds) / 8
            // Assume 1 hour duration for estimation
            val estimatedDuration = 3600.0
            val videoSize = (videoRep.bandwidth * estimatedDuration / 8).toLong()
            totalSize += videoSize
        }
        
        if (audioRep != null) {
            // Estimate audio size
            val estimatedDuration = 3600.0
            val audioSize = (audioRep.bandwidth * estimatedDuration / 8).toLong()
            totalSize += audioSize
        }
        
        return totalSize
    }

    /**
     * Resolve relative URL against base URL
     */
    private fun resolveUrl(baseUrl: String, relativeUrl: String): String {
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
            return relativeUrl
        }
        
        if (baseUrl.endsWith("/")) {
            return baseUrl + relativeUrl
        }
        
        val lastSlashIndex = baseUrl.lastIndexOf("/")
        if (lastSlashIndex >= 0) {
            return baseUrl.substring(0, lastSlashIndex + 1) + relativeUrl
        }
        
        return baseUrl + "/" + relativeUrl
    }

    /**
     * Get video and audio representation URLs for parallel downloading
     */
    suspend fun getRepresentationUrls(
        mpdUrl: String,
        headers: Map<String, String> = emptyMap()
    ): Pair<String?, String?> {
        return withContext(Dispatchers.IO) {
            try {
                val dashInfo = parseManifest(mpdUrl, headers)
                
                val videoUrl = dashInfo.videoRepresentations.firstOrNull()?.initializationUrl
                val audioUrl = dashInfo.audioRepresentations.firstOrNull()?.initializationUrl
                
                videoUrl to audioUrl
            } catch (e: Exception) {
                null to null
            }
        }
    }

    /**
     * Get all segments from video representation
     */
    suspend fun getVideoSegments(
        mpdUrl: String,
        headers: Map<String, String> = emptyMap()
    ): List<DashSegment> {
        return withContext(Dispatchers.IO) {
            try {
                val dashInfo = parseManifest(mpdUrl, headers)
                
                // Get segments from highest bitrate video representation
                val videoRep = dashInfo.videoRepresentations.firstOrNull()
                videoRep?.segments ?: emptyList()
            } catch (e: Exception) {
                emptyList()
            }
        }
    }

    /**
     * Get all segments from audio representation
     */
    suspend fun getAudioSegments(
        mpdUrl: String,
        headers: Map<String, String> = emptyMap()
    ): List<DashSegment> {
        return withContext(Dispatchers.IO) {
            try {
                val dashInfo = parseManifest(mpdUrl, headers)
                
                // Get segments from highest bitrate audio representation
                val audioRep = dashInfo.audioRepresentations.firstOrNull()
                audioRep?.segments ?: emptyList()
            } catch (e: Exception) {
                emptyList()
            }
        }
    }
}
