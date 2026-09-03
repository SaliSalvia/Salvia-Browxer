// File: app/src/main/java/com/salvia/browxer/model/VideoInfo.kt
package com.salvia.browxer.model

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

/**
 * VideoInfo - Represents detected video information.
 * 
 * @param url The video URL
 * @param title The video title
 * @param mimeType The MIME type of the video
 * @param headers HTTP headers for the video request
 * @param referer The referer URL
 * @param userAgent The user agent string
 * @param timestamp When the video was detected
 * @param isHls Whether the video is HLS format
 * @param isDash Whether the video is DASH format
 * @param isMpegTs Whether the video is MPEG-TS format
 * @param hasDrm Whether the video has DRM protection
 * @param quality The video quality (e.g., "1080p", "720p")
 * @param duration The video duration in milliseconds
 * @param size The video size in bytes
 */
@Parcelize
data class VideoInfo(
    val url: String,
    val title: String = "",
    val mimeType: String = "",
    val headers: Map<String, String> = emptyMap(),
    val referer: String = "",
    val userAgent: String = "",
    val timestamp: Long = System.currentTimeMillis(),
    val isHls: Boolean = false,
    val isDash: Boolean = false,
    val isMpegTs: Boolean = false,
    val hasDrm: Boolean = false,
    val quality: String = "",
    val duration: Long = 0,
    val size: Long = 0
) : Parcelable {
    
    /**
     * Check if the video is a streaming format
     */
    fun isStreaming(): Boolean {
        return isHls || isDash || isMpegTs
    }
    
    /**
     * Get the base URL (without query parameters)
     */
    fun getBaseUrl(): String {
        return url.split("?")[0]
    }
    
    /**
     * Get the file extension
     */
    fun getExtension(): String {
        val baseUrl = getBaseUrl()
        val lastDotIndex = baseUrl.lastIndexOf(".")
        val lastSlashIndex = baseUrl.lastIndexOf("/")
        
        return if (lastDotIndex > lastSlashIndex) {
            baseUrl.substring(lastDotIndex + 1)
        } else {
            ""
        }
    }
    
    /**
     * Check if the video can be downloaded directly
     */
    fun canDownloadDirectly(): Boolean {
        return !hasDrm && !isStreaming()
    }
    
    /**
     * Get a copy with updated headers
     */
    fun copyWithHeaders(newHeaders: Map<String, String>): VideoInfo {
        return copy(headers = newHeaders)
    }
    
    /**
     * Check if the video is from a known CDN
     */
    fun isFromCdn(): Boolean {
        val cdnHosts = listOf(
            "cdn.", "cloudfront.net", "akamaihd.net", "fastly.net",
            "youtube.com", "vimeo.com", "dailymotion.com",
            "twitch.tv", "facebook.com", "instagram.com"
        )
        
        return cdnHosts.any { cdn -> url.contains(cdn, ignoreCase = true) }
    }
    
    /**
     * Get a unique identifier for this video
     */
    fun getUniqueId(): String {
        return "${url.hashCode()}_${timestamp}"
    }
    
    override fun toString(): String {
        return "VideoInfo(url='$url', title='$title', mimeType='$mimeType', " +
                "isHls=$isHls, isDash=$isDash, hasDrm=$hasDrm, " +
                "quality='$quality', duration=$duration, size=$size)"
    }
}

/**
 * Extension function to create VideoInfo from URL
 */
fun createVideoInfoFromUrl(
    url: String,
    referer: String = "",
    userAgent: String = "",
    headers: Map<String, String> = emptyMap()
): VideoInfo {
    val lowerUrl = url.lowercase()
    
    return VideoInfo(
        url = url,
        title = extractTitleFromUrl(url),
        mimeType = getMimeTypeFromUrl(url),
        headers = headers,
        referer = referer,
        userAgent = userAgent,
        isHls = lowerUrl.endsWith(".m3u8") || lowerUrl.contains(".m3u8"),
        isDash = lowerUrl.endsWith(".mpd") || lowerUrl.contains(".mpd"),
        isMpegTs = lowerUrl.endsWith(".ts") || lowerUrl.contains(".ts")
    )
}

/**
 * Extract title from URL
 */
private fun extractTitleFromUrl(url: String): String {
    return try {
        val uri = android.net.Uri.parse(url)
        val lastPathSegment = uri.lastPathSegment ?: ""
        if (lastPathSegment.contains(".")) {
            lastPathSegment.substringBeforeLast(".")
        } else {
            lastPathSegment
        }
    } catch (e: Exception) {
        "Video"
    }
}

/**
 * Get MIME type from URL
 */
private fun getMimeTypeFromUrl(url: String): String {
    val lowerUrl = url.lowercase()
    
    return when {
        lowerUrl.endsWith(".mp4") -> "video/mp4"
        lowerUrl.endsWith(".webm") -> "video/webm"
        lowerUrl.endsWith(".m3u8") -> "application/vnd.apple.mpegurl"
        lowerUrl.endsWith(".mpd") -> "application/dash+xml"
        lowerUrl.endsWith(".ts") -> "video/MP2T"
        lowerUrl.endsWith(".fmp4") -> "video/iso.segment"
        else -> "video/*"
    }
}
