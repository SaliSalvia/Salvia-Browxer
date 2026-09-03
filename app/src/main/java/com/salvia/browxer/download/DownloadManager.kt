// File: app/src/main/java/com/salvia/browxer/download/DownloadManager.kt
package com.salvia.browxer.download

import android.content.Context
import com.salvia.browxer.model.DownloadInfo
import com.salvia.browxer.model.DownloadStatus
import com.salvia.browxer.model.VideoInfo
import com.salvia.browxer.parser.HlsParser
import com.salvia.browxer.parser.DashParser
import com.salvia.browxer.service.DownloadService
import com.salvia.browxer.util.FileUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * DownloadManager - Manages all download operations.
 * 
 * Features:
 * - Multi-threaded chunked downloading
 * - HLS and DASH manifest parsing
 * - Session header hijacking
 * - Foreground service integration
 * - Download queue management
 */
class DownloadManager private constructor(
    private val context: Context
) {
    
    companion object {
        @Volatile
        private var instance: DownloadManager? = null
        
        fun getInstance(context: Context): DownloadManager {
            return instance ?: synchronized(this) {
                instance ?: DownloadManager(context.applicationContext).also {
                    instance = it
                }
            }
        }
    }

    private val downloadQueue = ConcurrentHashMap<String, DownloadInfo>()
    private val downloadService: DownloadService by lazy {
        DownloadService.getInstance(context)
    }
    private val okHttpClient: OkHttpClient by lazy {
        createOkHttpClient()
    }
    private val hlsParser = HlsParser()
    private val dashParser = DashParser()
    
    // State flow for download updates
    private val _downloadsFlow = MutableStateFlow<List<DownloadInfo>>(emptyList())
    val downloadsFlow: StateFlow<List<DownloadInfo>> = _downloadsFlow
    
    // State flow for active downloads
    private val _activeDownloadsFlow = MutableStateFlow<List<DownloadInfo>>(emptyList())
    val activeDownloadsFlow: StateFlow<List<DownloadInfo>> = _activeDownloadsFlow
    
    // Callback for download events
    private var downloadCallback: DownloadCallback? = null

    init {
        // Initialize download service
        downloadService.initialize()
    }

    /**
     * Create OkHttpClient with optimized settings
     */
    private fun createOkHttpClient(): OkHttpClient {
        return OkHttpClient.Builder()
            .connectionPool(okhttp3.ConnectionPool(16, 5, java.util.concurrent.TimeUnit.MINUTES))
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .build()
    }

    /**
     * Handle video detected event
     */
    fun onVideoDetected(videoInfo: VideoInfo) {
        CoroutineScope(Dispatchers.IO).launch {
            // Check if this video is already in the queue
            val existingDownload = downloadQueue.values.find { 
                it.videoInfo.url == videoInfo.url 
            }
            
            if (existingDownload != null) {
                // Video already in queue, notify callback
                downloadCallback?.onVideoAlreadyInQueue(existingDownload)
                return@launch
            }
            
            // Notify callback about new video detection
            downloadCallback?.onVideoDetected(videoInfo)
        }
    }

    /**
     * Start downloading a video
     */
    suspend fun startDownload(
        videoInfo: VideoInfo,
        filePath: String = ""
    ): DownloadInfo {
        return withContext(Dispatchers.IO) {
            // Create download info
            val downloadInfo = if (filePath.isNotEmpty()) {
                createDownloadInfoFromVideo(videoInfo, filePath, videoInfo.headers)
            } else {
                val generatedPath = FileUtils.generateDownloadFilePath(
                    context,
                    videoInfo.title,
                    videoInfo.getExtension()
                )
                createDownloadInfoFromVideo(videoInfo, generatedPath, videoInfo.headers)
            }
            
            // Check if video is streaming format
            if (videoInfo.isHls) {
                startHlsDownload(downloadInfo)
            } else if (videoInfo.isDash) {
                startDashDownload(downloadInfo)
            } else {
                startDirectDownload(downloadInfo)
            }
        }
    }

    /**
     * Start HLS download
     */
    private suspend fun startHlsDownload(downloadInfo: DownloadInfo) {
        withContext(Dispatchers.IO) {
            try {
                // Parse HLS manifest
                val hlsInfo = hlsParser.parseManifest(downloadInfo.downloadUrl, downloadInfo.headers)
                
                // Update download info with HLS details
                val updatedDownloadInfo = downloadInfo.copy(
                    totalBytes = hlsInfo.totalSize,
                    chunkCount = hlsInfo.segments.size
                )
                
                // Add to queue
                downloadQueue[updatedDownloadInfo.id] = updatedDownloadInfo
                updateDownloadsFlow()
                
                // Start download service
                downloadService.startHlsDownload(updatedDownloadInfo, hlsInfo)
                
                // Notify callback
                downloadCallback?.onDownloadStarted(updatedDownloadInfo)
                
            } catch (e: Exception) {
                val errorDownloadInfo = downloadInfo.copyWithError(e.message ?: "Failed to parse HLS manifest")
                downloadQueue[errorDownloadInfo.id] = errorDownloadInfo
                updateDownloadsFlow()
                downloadCallback?.onDownloadFailed(errorDownloadInfo, e)
            }
        }
    }

    /**
     * Start DASH download
     */
    private suspend fun startDashDownload(downloadInfo: DownloadInfo) {
        withContext(Dispatchers.IO) {
            try {
                // Parse DASH manifest
                val dashInfo = dashParser.parseManifest(downloadInfo.downloadUrl, downloadInfo.headers)
                
                // Update download info with DASH details
                val updatedDownloadInfo = downloadInfo.copy(
                    totalBytes = dashInfo.totalSize,
                    chunkCount = dashInfo.segments.size
                )
                
                // Add to queue
                downloadQueue[updatedDownloadInfo.id] = updatedDownloadInfo
                updateDownloadsFlow()
                
                // Start download service
                downloadService.startDashDownload(updatedDownloadInfo, dashInfo)
                
                // Notify callback
                downloadCallback?.onDownloadStarted(updatedDownloadInfo)
                
            } catch (e: Exception) {
                val errorDownloadInfo = downloadInfo.copyWithError(e.message ?: "Failed to parse DASH manifest")
                downloadQueue[errorDownloadInfo.id] = errorDownloadInfo
                updateDownloadsFlow()
                downloadCallback?.onDownloadFailed(errorDownloadInfo, e)
            }
        }
    }

    /**
     * Start direct download
     */
    private suspend fun startDirectDownload(downloadInfo: DownloadInfo) {
        withContext(Dispatchers.IO) {
            try {
                // Get file size first
                val fileSize = getFileSize(downloadInfo.downloadUrl, downloadInfo.headers)
                
                // Update download info with file size
                val updatedDownloadInfo = downloadInfo.copy(
                    totalBytes = fileSize,
                    isChunked = fileSize > 10 * 1024 * 1024 // Chunk if > 10MB
                )
                
                // Add to queue
                downloadQueue[updatedDownloadInfo.id] = updatedDownloadInfo
                updateDownloadsFlow()
                
                // Start download service
                downloadService.startDirectDownload(updatedDownloadInfo)
                
                // Notify callback
                downloadCallback?.onDownloadStarted(updatedDownloadInfo)
                
            } catch (e: Exception) {
                val errorDownloadInfo = downloadInfo.copyWithError(e.message ?: "Failed to start download")
                downloadQueue[errorDownloadInfo.id] = errorDownloadInfo
                updateDownloadsFlow()
                downloadCallback?.onDownloadFailed(errorDownloadInfo, e)
            }
        }
    }

    /**
     * Get file size from URL
     */
    private suspend fun getFileSize(url: String, headers: Map<String, String>): Long {
        return withContext(Dispatchers.IO) {
            try {
                val request = okhttp3.Request.Builder()
                    .url(url)
                    .head()
                    .apply {
                        headers.forEach { (key, value) ->
                            addHeader(key, value)
                        }
                    }
                    .build()
                
                val response = okHttpClient.newCall(request).execute()
                
                if (response.isSuccessful) {
                    val contentLength = response.header("Content-Length")?.toLongOrNull() ?: 0L
                    response.close()
                    contentLength
                } else {
                    response.close()
                    0L
                }
            } catch (e: Exception) {
                0L
            }
        }
    }

    /**
     * Pause download
     */
    fun pauseDownload(downloadId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val downloadInfo = downloadQueue[downloadId] ?: return@launch
            
            if (downloadInfo.isInProgress()) {
                downloadService.pauseDownload(downloadId)
                
                val pausedDownloadInfo = downloadInfo.copyWithStatus(DownloadStatus.PAUSED)
                downloadQueue[downloadId] = pausedDownloadInfo
                updateDownloadsFlow()
                
                downloadCallback?.onDownloadPaused(pausedDownloadInfo)
            }
        }
    }

    /**
     * Resume download
     */
    fun resumeDownload(downloadId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val downloadInfo = downloadQueue[downloadId] ?: return@launch
            
            if (downloadInfo.status == DownloadStatus.PAUSED) {
                downloadService.resumeDownload(downloadId)
                
                val resumedDownloadInfo = downloadInfo.copyWithStatus(DownloadStatus.RESUMING)
                downloadQueue[downloadId] = resumedDownloadInfo
                updateDownloadsFlow()
                
                downloadCallback?.onDownloadResumed(resumedDownloadInfo)
            }
        }
    }

    /**
     * Cancel download
     */
    fun cancelDownload(downloadId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val downloadInfo = downloadQueue[downloadId] ?: return@launch
            
            if (downloadInfo.isInProgress() || downloadInfo.status == DownloadStatus.PENDING) {
                downloadService.cancelDownload(downloadId)
                
                val cancelledDownloadInfo = downloadInfo.copyWithStatus(DownloadStatus.CANCELLED)
                downloadQueue[downloadId] = cancelledDownloadInfo
                updateDownloadsFlow()
                
                downloadCallback?.onDownloadCancelled(cancelledDownloadInfo)
            }
        }
    }

    /**
     * Remove download from queue
     */
    fun removeDownload(downloadId: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val downloadInfo = downloadQueue.remove(downloadId) ?: return@launch
            updateDownloadsFlow()
            downloadCallback?.onDownloadRemoved(downloadInfo)
        }
    }

    /**
     * Clear all downloads
     */
    fun clearAllDownloads() {
        CoroutineScope(Dispatchers.IO).launch {
            downloadQueue.clear()
            updateDownloadsFlow()
            downloadCallback?.onAllDownloadsCleared()
        }
    }

    /**
     * Get download by ID
     */
    fun getDownload(downloadId: String): DownloadInfo? {
        return downloadQueue[downloadId]
    }

    /**
     * Get all downloads
     */
    fun getAllDownloads(): List<DownloadInfo> {
        return downloadQueue.values.toList()
    }

    /**
     * Get active downloads
     */
    fun getActiveDownloads(): List<DownloadInfo> {
        return downloadQueue.values.filter { it.isInProgress() }
    }

    /**
     * Get completed downloads
     */
    fun getCompletedDownloads(): List<DownloadInfo> {
        return downloadQueue.values.filter { it.isCompleted() }
    }

    /**
     * Set download callback
     */
    fun setDownloadCallback(callback: DownloadCallback) {
        downloadCallback = callback
    }

    /**
     * Update downloads flow
     */
    private fun updateDownloadsFlow() {
        CoroutineScope(Dispatchers.Main).launch {
            _downloadsFlow.value = downloadQueue.values.toList()
            _activeDownloadsFlow.value = downloadQueue.values.filter { it.isInProgress() }
        }
    }

    /**
     * Handle download progress update
     */
    fun onDownloadProgress(downloadId: String, progress: Int, downloadedBytes: Long) {
        CoroutineScope(Dispatchers.IO).launch {
            val downloadInfo = downloadQueue[downloadId] ?: return@launch
            
            val updatedDownloadInfo = downloadInfo.copyWithProgress(progress, downloadedBytes)
            downloadQueue[downloadId] = updatedDownloadInfo
            updateDownloadsFlow()
            
            downloadCallback?.onDownloadProgress(updatedDownloadInfo)
        }
    }

    /**
     * Handle download completion
     */
    fun onDownloadCompleted(downloadId: String, filePath: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val downloadInfo = downloadQueue[downloadId] ?: return@launch
            
            val completedDownloadInfo = downloadInfo.copy(
                status = DownloadStatus.COMPLETED,
                filePath = filePath,
                progress = 100,
                downloadedBytes = downloadInfo.totalBytes,
                endTime = System.currentTimeMillis()
            )
            downloadQueue[downloadId] = completedDownloadInfo
            updateDownloadsFlow()
            
            downloadCallback?.onDownloadCompleted(completedDownloadInfo)
        }
    }

    /**
     * Handle download failure
     */
    fun onDownloadFailed(downloadId: String, errorMessage: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val downloadInfo = downloadQueue[downloadId] ?: return@launch
            
            val failedDownloadInfo = downloadInfo.copyWithError(errorMessage)
            downloadQueue[downloadId] = failedDownloadInfo
            updateDownloadsFlow()
            
            downloadCallback?.onDownloadFailed(failedDownloadInfo, Exception(errorMessage))
        }
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        downloadService.cleanup()
        downloadQueue.clear()
    }
}

/**
 * Download callback interface
 */
interface DownloadCallback {
    fun onVideoDetected(videoInfo: VideoInfo)
    fun onVideoAlreadyInQueue(downloadInfo: DownloadInfo)
    fun onDownloadStarted(downloadInfo: DownloadInfo)
    fun onDownloadProgress(downloadInfo: DownloadInfo)
    fun onDownloadPaused(downloadInfo: DownloadInfo)
    fun onDownloadResumed(downloadInfo: DownloadInfo)
    fun onDownloadCompleted(downloadInfo: DownloadInfo)
    fun onDownloadFailed(downloadInfo: DownloadInfo, error: Exception)
    fun onDownloadCancelled(downloadInfo: DownloadInfo)
    fun onDownloadRemoved(downloadInfo: DownloadInfo)
    fun onAllDownloadsCleared()
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
