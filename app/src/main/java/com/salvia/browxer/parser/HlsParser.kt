// File: app/src/main/java/com/salvia/browxer/parser/HlsParser.kt
package com.salvia.browxer.parser

import com.salvia.browxer.model.HlsInfo
import com.salvia.browxer.model.HlsSegment
import com.salvia.browxer.model.HlsVariant
import com.salvia.browxer.util.HttpClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * HLS Parser - Parses HLS (.m3u8) manifests and extracts segment information.
 * 
 * Features:
 * - Master playlist parsing
 * - Variant playlist selection (highest bitrate)
 * - Segment list extraction
 * - TS and fMP4 segment support
 * - Resolution and bandwidth parsing
 */
class HlsParser {

    private val httpClient = HttpClient()

    /**
     * Parse HLS manifest from URL
     */
    suspend fun parseManifest(url: String, headers: Map<String, String> = emptyMap()): HlsInfo {
        return withContext(Dispatchers.IO) {
            try {
                // Fetch manifest content
                val manifestContent = httpClient.getString(url, headers)
                
                // Parse manifest
                parseManifestContent(manifestContent, url, headers)
                
            } catch (e: Exception) {
                throw Exception("Failed to parse HLS manifest: ${e.message}")
            }
        }
    }

    /**
     * Parse HLS manifest content
     */
    private fun parseManifestContent(
        content: String,
        baseUrl: String,
        headers: Map<String, String>
    ): HlsInfo {
        val lines = content.split("\n")
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
        
        val isMasterPlaylist = content.contains("#EXT-X-STREAM-INF")
        
        if (isMasterPlaylist) {
            // Parse master playlist
            parseMasterPlaylist(content, baseUrl, headers)
        } else {
            // Parse media playlist
            parseMediaPlaylist(content, baseUrl, headers)
        }
    }

    /**
     * Parse master playlist
     */
    private fun parseMasterPlaylist(
        content: String,
        baseUrl: String,
        headers: Map<String, String>
    ): HlsInfo {
        val lines = content.split("\n")
        val variants = mutableListOf<HlsVariant>()
        var selectedVariant: HlsVariant? = null
        
        var currentVariant: HlsVariant? = null
        
        for (line in lines) {
            val trimmedLine = line.trim()
            
            if (trimmedLine.startsWith("#EXT-X-STREAM-INF:")) {
                // Parse variant info
                currentVariant = parseVariantInfo(trimmedLine, baseUrl)
                variants.add(currentVariant!!)
                
                // Select highest bitrate variant
                if (selectedVariant == null || 
                    currentVariant!!.bandwidth > selectedVariant!!.bandwidth) {
                    selectedVariant = currentVariant
                }
                
            } else if (trimmedLine.isNotEmpty() && !trimmedLine.startsWith("#")) {
                // This is the URI for the current variant
                currentVariant?.let { variant ->
                    val fullUrl = resolveUrl(baseUrl, trimmedLine)
                    variants[variants.size - 1] = variant.copy(url = fullUrl)
                    
                    // Update selected variant URL
                    if (variant == selectedVariant) {
                        selectedVariant = selectedVariant.copy(url = fullUrl)
                    }
                }
            }
        }
        
        // If we have a selected variant, parse its media playlist
        if (selectedVariant != null) {
            val mediaPlaylistContent = httpClient.getString(selectedVariant!!.url, headers)
            val mediaPlaylist = parseMediaPlaylist(mediaPlaylistContent, selectedVariant!!.url, headers)
            
            return mediaPlaylist.copy(
                isMaster = true,
                variants = variants,
                selectedVariant = selectedVariant!!
            )
        }
        
        return HlsInfo(
            isMaster = true,
            variants = variants,
            segments = emptyList(),
            totalSize = 0,
            duration = 0.0
        )
    }

    /**
     * Parse variant info from EXT-X-STREAM-INF line
     */
    private fun parseVariantInfo(line: String, baseUrl: String): HlsVariant {
        val attributes = parseAttributes(line)
        
        return HlsVariant(
            bandwidth = attributes["BANDWIDTH"]?.toLongOrNull() ?: 0,
            resolution = attributes["RESOLUTION"] ?: "",
            codecs = attributes["CODECS"] ?: "",
            audio = attributes["AUDIO"] ?: "",
            video = attributes["VIDEO"] ?: "",
            subtitles = attributes["SUBTITLES"] ?: "",
            url = baseUrl
        )
    }

    /**
     * Parse media playlist
     */
    private fun parseMediaPlaylist(
        content: String,
        baseUrl: String,
        headers: Map<String, String>
    ): HlsInfo {
        val lines = content.split("\n")
        val segments = mutableListOf<HlsSegment>()
        var totalSize: Long = 0
        var duration: Double = 0.0
        var targetDuration: Double = 0.0
        var mediaSequence: Long = 0
        var discontinuitySequence: Long = 0
        
        var currentSegment: HlsSegment? = null
        
        for (line in lines) {
            val trimmedLine = line.trim()
            
            when {
                trimmedLine.startsWith("#EXT-X-TARGETDURATION:") -> {
                    targetDuration = trimmedLine.substringAfter(":").trim().toDoubleOrNull() ?: 0.0
                }
                trimmedLine.startsWith("#EXT-X-MEDIA-SEQUENCE:") -> {
                    mediaSequence = trimmedLine.substringAfter(":").trim().toLongOrNull() ?: 0
                }
                trimmedLine.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:") -> {
                    discontinuitySequence = trimmedLine.substringAfter(":").trim().toLongOrNull() ?: 0
                }
                trimmedLine.startsWith("#EXTINF:") -> {
                    // Parse segment duration and title
                    val infoParts = trimmedLine.substringAfter(":").trim().split(",")
                    val segmentDuration = infoParts[0].toDoubleOrNull() ?: 0.0
                    val segmentTitle = if (infoParts.size > 1) infoParts[1] else ""
                    
                    currentSegment = HlsSegment(
                        duration = segmentDuration,
                        title = segmentTitle,
                        sequence = mediaSequence + segments.size,
                        url = ""
                    )
                    duration += segmentDuration
                }
                trimmedLine.startsWith("#EXT-X-BYTERANGE:") -> {
                    // Parse byte range
                    val rangeParts = trimmedLine.substringAfter(":").trim().split("@")
                    val length = rangeParts[0].toLongOrNull() ?: 0
                    val offset = if (rangeParts.size > 1) rangeParts[1].toLongOrNull() ?: 0 else 0
                    
                    currentSegment?.let { segment ->
                        currentSegment = segment.copy(
                            byteRangeLength = length,
                            byteRangeOffset = offset
                        )
                    }
                }
                trimmedLine.isNotEmpty() && !trimmedLine.startsWith("#") -> {
                    // This is a segment URI
                    if (currentSegment != null) {
                        val fullUrl = resolveUrl(baseUrl, trimmedLine)
                        val segmentSize = estimateSegmentSize(currentSegment!!, targetDuration)
                        
                        currentSegment = currentSegment!!.copy(
                            url = fullUrl,
                            size = segmentSize
                        )
                        
                        segments.add(currentSegment!!)
                        totalSize += segmentSize
                        currentSegment = null
                    }
                }
            }
        }
        
        return HlsInfo(
            isMaster = false,
            variants = emptyList(),
            segments = segments,
            totalSize = totalSize,
            duration = duration,
            targetDuration = targetDuration,
            mediaSequence = mediaSequence,
            discontinuitySequence = discontinuitySequence
        )
    }

    /**
     * Estimate segment size based on duration and target duration
     */
    private fun estimateSegmentSize(segment: HlsSegment, targetDuration: Double): Long {
        // Default segment size estimation
        // This is a rough estimate; actual size depends on bitrate
        if (targetDuration > 0) {
            // Assume average bitrate of 2 Mbps (250 KB/s)
            val bitrateBytesPerSecond = 250 * 1024
            return (segment.duration * bitrateBytesPerSecond).toLong()
        }
        
        // Default to 1MB per segment
        return 1024 * 1024
    }

    /**
     * Parse attributes from HLS tag
     */
    private fun parseAttributes(line: String): Map<String, String> {
        val attributes = mutableMapOf<String, String>()
        
        val content = line.substringAfter(":").trim()
        val parts = content.split(",")
        
        for (part in parts) {
            val keyValue = part.split("=")
            if (keyValue.size == 2) {
                attributes[keyValue[0].trim().uppercase()] = keyValue[1].trim().removeSurrounding("\"")
            }
        }
        
        return attributes
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
     * Get highest quality variant URL
     */
    suspend fun getHighestQualityVariantUrl(
        masterPlaylistUrl: String,
        headers: Map<String, String> = emptyMap()
    ): String? {
        return withContext(Dispatchers.IO) {
            try {
                val manifestContent = httpClient.getString(masterPlaylistUrl, headers)
                val hlsInfo = parseManifestContent(manifestContent, masterPlaylistUrl, headers)
                
                if (hlsInfo.isMaster && hlsInfo.variants.isNotEmpty()) {
                    // Sort by bandwidth descending
                    val sortedVariants = hlsInfo.variants.sortedByDescending { it.bandwidth }
                    sortedVariants.firstOrNull()?.url
                } else {
                    masterPlaylistUrl
                }
            } catch (e: Exception) {
                null
            }
        }
    }

    /**
     * Get all segments from HLS manifest
     */
    suspend fun getAllSegments(
        playlistUrl: String,
        headers: Map<String, String> = emptyMap()
    ): List<HlsSegment> {
        return withContext(Dispatchers.IO) {
            try {
                val manifestContent = httpClient.getString(playlistUrl, headers)
                val hlsInfo = parseManifestContent(manifestContent, playlistUrl, headers)
                hlsInfo.segments
            } catch (e: Exception) {
                emptyList()
            }
        }
    }
}
