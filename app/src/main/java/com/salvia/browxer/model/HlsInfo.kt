// File: app/src/main/java/com/salvia/browxer/model/HlsInfo.kt
package com.salvia.browxer.model

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

/**
 * HlsInfo - Represents HLS manifest information.
 */
@Parcelize
data class HlsInfo(
    val isMaster: Boolean = false,
    val variants: List<HlsVariant> = emptyList(),
    val segments: List<HlsSegment> = emptyList(),
    val totalSize: Long = 0,
    val duration: Double = 0.0,
    val targetDuration: Double = 0.0,
    val mediaSequence: Long = 0,
    val discontinuitySequence: Long = 0,
    val selectedVariant: HlsVariant? = null
) : Parcelable

/**
 * HlsVariant - Represents a variant in HLS master playlist.
 */
@Parcelize
data class HlsVariant(
    val bandwidth: Long = 0,
    val resolution: String = "",
    val codecs: String = "",
    val audio: String = "",
    val video: String = "",
    val subtitles: String = "",
    val url: String = ""
) : Parcelable {
    
    /**
     * Get resolution as width x height
     */
    fun getResolutionPair(): Pair<Int, Int>? {
        if (resolution.isEmpty()) return null
        
        val parts = resolution.split("x")
        if (parts.size != 2) return null
        
        val width = parts[0].toIntOrNull() ?: 0
        val height = parts[1].toIntOrNull() ?: 0
        
        return if (width > 0 && height > 0) width to height else null
    }
    
    /**
     * Get quality label (e.g., "1080p", "720p")
     */
    fun getQualityLabel(): String {
        val resolutionPair = getResolutionPair()
        return when {
            resolutionPair?.second ?: 0 >= 2160 -> "4K"
            resolutionPair?.second ?: 0 >= 1440 -> "1440p"
            resolutionPair?.second ?: 0 >= 1080 -> "1080p"
            resolutionPair?.second ?: 0 >= 720 -> "720p"
            resolutionPair?.second ?: 0 >= 480 -> "480p"
            else -> "SD"
        }
    }
    
    /**
     * Get bitrate in kbps
     */
    fun getBitrateKbps(): Int {
        return (bandwidth / 1000).toInt()
    }
}

/**
 * HlsSegment - Represents a segment in HLS playlist.
 */
@Parcelize
data class HlsSegment(
    val duration: Double = 0.0,
    val title: String = "",
    val sequence: Long = 0,
    val url: String = "",
    val byteRangeLength: Long = 0,
    val byteRangeOffset: Long = 0,
    val size: Long = 0
) : Parcelable {
    
    /**
     * Check if segment has byte range
     */
    fun hasByteRange(): Boolean {
        return byteRangeLength > 0
    }
    
    /**
     * Get full byte range string
     */
    fun getByteRangeString(): String {
        return if (hasByteRange()) {
            "bytes=$byteRangeOffset-$byteRangeLength"
        } else {
            ""
        }
    }
}
