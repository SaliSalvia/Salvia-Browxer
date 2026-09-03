// File: app/src/main/java/com/salvia/browxer/model/DashInfo.kt
package com.salvia.browxer.model

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

/**
 * DashInfo - Represents DASH manifest information.
 */
@Parcelize
data class DashInfo(
    val type: String = "",
    val mediaPresentationDuration: Double = 0.0,
    val minBufferTime: Double = 0.0,
    val videoAdaptationSets: List<DashAdaptationSet> = emptyList(),
    val audioAdaptationSets: List<DashAdaptationSet> = emptyList(),
    val videoRepresentations: List<DashRepresentation> = emptyList(),
    val audioRepresentations: List<DashRepresentation> = emptyList(),
    val segments: List<DashSegment> = emptyList(),
    val totalSize: Long = 0
) : Parcelable

/**
 * DashAdaptationSet - Represents an adaptation set in DASH manifest.
 */
@Parcelize
data class DashAdaptationSet(
    val id: String = "",
    val mimeType: String = "",
    val contentType: String = "",
    val lang: String = "",
    val representations: List<DashRepresentation> = emptyList(),
    val segments: List<DashSegment> = emptyList()
) : Parcelable

/**
 * DashRepresentation - Represents a representation in DASH manifest.
 */
@Parcelize
data class DashRepresentation(
    val id: String = "",
    val bandwidth: Long = 0,
    val width: Int = 0,
    val height: Int = 0,
    val frameRate: String = "",
    val codecs: String = "",
    val segments: List<DashSegment> = emptyList(),
    var initializationUrl: String = ""
) : Parcelable {
    
    /**
     * Get quality label (e.g., "1080p", "720p")
     */
    fun getQualityLabel(): String {
        return when {
            height >= 2160 -> "4K"
            height >= 1440 -> "1440p"
            height >= 1080 -> "1080p"
            height >= 720 -> "720p"
            height >= 480 -> "480p"
            else -> "SD"
        }
    }
    
    /**
     * Get bitrate in kbps
     */
    fun getBitrateKbps(): Int {
        return (bandwidth / 1000).toInt()
    }
    
    /**
     * Check if this is a video representation
     */
    fun isVideo(): Boolean {
        return width > 0 && height > 0
    }
    
    /**
     * Check if this is an audio representation
     */
    fun isAudio(): Boolean {
        return width == 0 && height == 0 && bandwidth > 0
    }
}

/**
 * DashSegment - Represents a segment in DASH manifest.
 */
@Parcelize
data class DashSegment(
    val duration: Long = 0,
    val timescale: Long = 1,
    val urls: List<String> = emptyList(),
    val indexUrl: String = ""
) : Parcelable {
    
    /**
     * Get duration in seconds
     */
    fun getDurationSeconds(): Double {
        return duration.toDouble() / timescale
    }
    
    /**
     * Check if segment has multiple URLs
     */
    fun hasMultipleUrls(): Boolean {
        return urls.size > 1
    }
    
    /**
     * Get first URL
     */
    fun getFirstUrl(): String? {
        return urls.firstOrNull()
    }
}
