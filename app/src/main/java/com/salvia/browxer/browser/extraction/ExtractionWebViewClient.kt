// File: app/src/main/java/com/salvia/browxer/browser/extraction/ExtractionWebViewClient.kt
package com.salvia.browxer.browser.extraction

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.salvia.browxer.browser.adblocker.AdBlocker
import com.salvia.browxer.download.DownloadManager
import com.salvia.browxer.model.VideoInfo
import com.salvia.browxer.util.JavaScriptInjector
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * ExtractionWebViewClient - Handles request interception and video extraction.
 * 
 * Features:
 * - Protocol interception for video/mp4, video/webm, .m3u8, .mpd
 * - JS monkey patching for fetch, XMLHttpRequest, HTMLMediaElement
 * - Invisible video hunting via Blob and MSE
 * - Recursive iframe injection
 * - DRM detection and graceful exit
 */
class ExtractionWebViewClient(
    private val context: Context,
    private val adBlocker: AdBlocker
) : WebViewClient() {

    private val javaScriptInjector = JavaScriptInjector()
    private val downloadManager = DownloadManager.getInstance(context)
    
    // Track detected video URLs
    private val detectedVideoUrls = mutableSetOf<String>()
    
    // Track current page URL for referer
    private var currentPageUrl: String = ""
    
    // Track if DRM was detected
    private var drmDetected = false

    override fun shouldInterceptRequest(
        view: WebView?, 
        request: WebResourceRequest?
    ): WebResourceResponse? {
        request ?: return null
        view ?: return null

        val url = request.url.toString()
        
        // Check if ad blocker should block this request
        if (adBlocker.shouldBlockUrl(url)) {
            return createBlockedResponse()
        }
        
        // Check for video protocols
        if (isVideoUrl(url)) {
            // Extract video info and notify download manager
            extractVideoInfo(url, request)
        }
        
        return null
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
        super.onPageStarted(view, url, favicon)
        currentPageUrl = url ?: ""
        drmDetected = false
        detectedVideoUrls.clear()
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        
        // Inject extraction scripts
        injectExtractionScripts(view)
    }

    /**
     * Inject extraction scripts into the WebView
     */
    private fun injectExtractionScripts(view: WebView?) {
        view ?: return
        
        // Inject JS monkey patching
        CoroutineScope(Dispatchers.Main).launch {
            try {
                // Inject main extraction script
                view.evaluateJavascript(javaScriptInjector.getExtractionScript()) { result ->
                    // Handle result if needed
                }
                
                // Inject MSE hook
                view.evaluateJavascript(javaScriptInjector.getMseHookScript()) { result ->
                    // Handle result
                }
                
                // Inject Blob URL hook
                view.evaluateJavascript(javaScriptInjector.getBlobUrlHookScript()) { result ->
                    // Handle result
                }
                
                // Inject iframe injection script
                view.evaluateJavascript(javaScriptInjector.getIframeInjectionScript()) { result ->
                    // Handle result
                }
                
                // Inject DRM detection
                view.evaluateJavascript(javaScriptInjector.getDrmDetectionScript()) { result ->
                    // Handle result
                }
            } catch (e: Exception) {
                // Handle injection error
            }
        }
    }

    /**
     * Check if URL is a video URL
     */
    private fun isVideoUrl(url: String): Boolean {
        val lowerUrl = url.lowercase()
        
        return lowerUrl.endsWith(".mp4") ||
               lowerUrl.endsWith(".webm") ||
               lowerUrl.endsWith(".m3u8") ||
               lowerUrl.endsWith(".mpd") ||
               lowerUrl.endsWith(".ts") ||
               lowerUrl.endsWith(".fmp4") ||
               lowerUrl.contains(".m3u8") ||
               lowerUrl.contains(".mpd") ||
               lowerUrl.contains("video/") ||
               lowerUrl.contains("/video") ||
               lowerUrl.contains("stream/") ||
               lowerUrl.contains("/stream")
    }

    /**
     * Extract video info from request
     */
    private fun extractVideoInfo(url: String, request: WebResourceRequest) {
        if (detectedVideoUrls.contains(url)) {
            return
        }
        
        detectedVideoUrls.add(url)
        
        // Extract headers for download
        val headers = mutableMapOf<String, String>()
        request.requestHeaders.forEach { (key, value) ->
            headers[key] = value
        }
        
        // Add referer if available
        if (currentPageUrl.isNotEmpty()) {
            headers["Referer"] = currentPageUrl
        }
        
        // Add user agent
        headers["User-Agent"] = request.requestHeaders["User-Agent"] ?: ""
        
        // Create video info
        val videoInfo = VideoInfo(
            url = url,
            title = extractTitleFromUrl(url),
            mimeType = request.mimeType ?: "",
            headers = headers,
            referer = currentPageUrl,
            userAgent = request.requestHeaders["User-Agent"] ?: "",
            timestamp = System.currentTimeMillis()
        )
        
        // Notify download manager
        CoroutineScope(Dispatchers.IO).launch {
            downloadManager.onVideoDetected(videoInfo)
        }
    }

    /**
     * Extract title from URL
     */
    private fun extractTitleFromUrl(url: String): String {
        return try {
            val uri = Uri.parse(url)
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
     * Create blocked response for ad blocker
     */
    private fun createBlockedResponse(): WebResourceResponse {
        return WebResourceResponse(
            mimeType = "text/plain",
            encoding = "utf-8",
            data = "Blocked by AdBlocker".byteInputStream()
        )
    }

    /**
     * Check if DRM was detected
     */
    fun isDrmDetected(): Boolean {
        return drmDetected
    }

    /**
     * Set DRM detection flag
     */
    fun setDrmDetected(detected: Boolean) {
        drmDetected = detected
    }

    /**
     * Get detected video URLs
     */
    fun getDetectedVideoUrls(): Set<String> {
        return detectedVideoUrls.toSet()
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        detectedVideoUrls.clear()
        currentPageUrl = ""
        drmDetected = false
    }

    /**
     * Set video detection callback
     */
    fun setVideoDetectionCallback(callback: (VideoInfo) -> Unit) {
        // In a real implementation, this would be used to notify UI
    }
}
