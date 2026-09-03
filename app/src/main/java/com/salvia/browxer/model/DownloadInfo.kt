// File: app/src/main/java/com/salvia/browxer/model/DownloadInfo.kt
package com.salvia.browxer.model

import android.os.Parcelable
import kotlinx.parcelize.Parcelize
import java.util.UUID

/**
 * DownloadInfo - Represents a download task.
 * 
 * @param id Unique download ID
 * @param videoInfo The video information
 * @param downloadUrl The URL to download from
 * @param filePath The local file path to save to
 * @param status The current download status
 * @param progress The download progress (0-100)
 * @param downloadedBytes The number of bytes downloaded
 * @param totalBytes The total size of the download
 * @param startTime When the download started
 * @param endTime When the download completed
 * @param headers HTTP headers for the download request
 * @param isChunked Whether the download uses chunked downloading
 * @param chunkCount The number of chunks for parallel downloading
 * @param retryCount The number of retry attempts
 * @param errorMessage The error message if download failed
 */
@Parcelize
data class DownloadInfo(
    val id: String = UUID.randomUUID().toString(),
    val videoInfo: VideoInfo,
    val downloadUrl: String,
    val filePath: String = "",
    val status: DownloadStatus = DownloadStatus.PENDING,
    val progress: Int = 0,
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val startTime: Long = 0,
    val endTime: Long = 0,
    val headers: Map<String, String> = emptyMap(),
    val isChunked: Boolean = false,
    val chunkCount: Int = 8,
    val retryCount: Int = 0,
    val errorMessage: String = ""
) : Parcelable {
    
    /**
     * Check if download is completed
     */
    fun isCompleted(): Boolean {
        return status == DownloadStatus.COMPLETED
    }
    
    /**
     * Check if download is in progress
     */
    fun isInProgress(): Boolean {
        return status == DownloadStatus.DOWNLOADING || 
               status == DownloadStatus.PAUSED ||
               status == DownloadStatus.RESUMING
    }
    
    /**
     * Check if download failed
     */
    fun isFailed(): Boolean {
        return status == DownloadStatus.FAILED ||
               status == DownloadStatus.CANCELLED
    }
    
    /**
     * Get download speed in bytes per second
     */
    fun getDownloadSpeed(): Double {
        if (startTime == 0L) return 0.0
        
        val currentTime = if (endTime > 0) endTime else System.currentTimeMillis()
        val duration = (currentTime - startTime) / 1000.0
        
        return if (duration > 0) {
            downloadedBytes / duration
        } else {
            0.0
        }
    }
    
    /**
     * Get estimated time remaining in seconds
     */
    fun getEstimatedTimeRemaining(): Long {
        if (totalBytes <= 0 || downloadedBytes >= totalBytes) return 0
        
        val speed = getDownloadSpeed()
        if (speed <= 0) return 0
        
        val remainingBytes = totalBytes - downloadedBytes
        return (remainingBytes / speed).toLong()
    }
    
    /**
     * Get a copy with updated status
     */
    fun copyWithStatus(newStatus: DownloadStatus): DownloadInfo {
        return copy(
            status = newStatus,
            endTime = if (newStatus == DownloadStatus.COMPLETED || 
                          newStatus == DownloadStatus.FAILED ||
                          newStatus == DownloadStatus.CANCELLED) {
                System.currentTimeMillis()
            } else {
                endTime
            }
        )
    }
    
    /**
     * Get a copy with updated progress
     */
    fun copyWithProgress(newProgress: Int, newDownloadedBytes: Long): DownloadInfo {
        return copy(
            progress = newProgress,
            downloadedBytes = newDownloadedBytes
        )
    }
    
    /**
     * Get a copy with error
     */
    fun copyWithError(errorMessage: String): DownloadInfo {
        return copy(
            status = DownloadStatus.FAILED,
            errorMessage = errorMessage,
            endTime = System.currentTimeMillis()
        )
    }
    
    override fun toString(): String {
        return "DownloadInfo(id='$id', status=$status, progress=$progress%, " +
                "downloaded=$downloadedBytes/$totalBytes, speed=${getDownloadSpeed()} B/s)"
    }
}

/**
 * Download status enum
 */
enum class DownloadStatus {
    PENDING,       // Waiting to start
    DOWNLOADING,   // Currently downloading
    PAUSED,        // Paused by user
    RESUMING,      // Resuming from pause
    COMPLETED,     // Download completed successfully
    FAILED,        // Download failed
    CANCELLED      // Download cancelled by user
}

/**
 * Extension function to create DownloadInfo from VideoInfo
 */
fun createDownloadInfoFromVideo(
    videoInfo: VideoInfo,
    filePath: String = "",
    headers: Map<String, String> = emptyMap()
): DownloadInfo {
    return DownloadInfo(
        videoInfo = videoInfo,
        downloadUrl = videoInfo.url,
        filePath = filePath,
        headers = headers,
        isChunked = videoInfo.isStreaming(),
        chunkCount = if (videoInfo.isStreaming()) 8 else 1
    )
}
