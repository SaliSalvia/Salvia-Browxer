// File: app/src/main/java/com/salvia/browxer/browser/CustomWebView.kt
package com.salvia.browxer.browser

import android.content.Context
import android.util.AttributeSet
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewFeature
import com.salvia.browxer.browser.adblocker.AdBlocker
import com.salvia.browxer.browser.extraction.ExtractionWebViewClient

/**
 * Custom WebView with hardware acceleration and optimized performance settings.
 * 
 * Features:
 * - Hardware acceleration enabled
 * - Optimized layer caching
 * - DOM storage enabled
 * - JavaScript enabled with injection support
 * - Custom WebViewClient for request interception
 */
class CustomWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = android.R.attr.webViewStyle
) : WebView(context, attrs, defStyleAttr) {

    private val adBlocker: AdBlocker
    private val extractionClient: ExtractionWebViewClient

    init {
        // Enable hardware acceleration
        if (WebViewFeature.isFeatureSupported(WebViewFeature.HARDWARE_ACCELERATION)) {
            setLayerType(LAYER_TYPE_HARDWARE, null)
        }

        // Initialize settings
        initWebSettings()

        // Initialize ad blocker
        adBlocker = AdBlocker.getInstance(context)

        // Initialize extraction client
        extractionClient = ExtractionWebViewClient(
            context = context,
            adBlocker = adBlocker
        )

        // Set custom WebViewClient
        webViewClient = extractionClient
    }

    /**
     * Initialize WebSettings for optimal performance
     */
    private fun initWebSettings() {
        settings.apply {
            // Enable JavaScript
            javaScriptEnabled = true
            
            // Enable DOM storage
            domStorageEnabled = true
            
            // Enable database storage
            databaseEnabled = true
            
            // Set cache mode
            cacheMode = WebSettings.LOAD_DEFAULT
            
            // Enable built-in zoom controls
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            
            // Set user agent
            userAgentString = settings.userAgentString?.replace("Mobile", "Desktop")
            
            // Enable media playback
            mediaPlaybackRequiresUserGesture = false
            
            // Enable mixed content
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            
            // Set text zoom
            textZoom = 100
            
            // Enable JavaScript can open windows
            javaScriptCanOpenWindowsAutomatically = true
            
            // Enable load with overview mode
            loadWithOverviewMode = true
            useWideViewPort = true
            
            // Set default font scaling
            setDefaultFontSize(16)
            
            // Enable smooth scrolling
            setRenderPriority(WebSettings.RenderPriority.HIGH)
        }

        // Enable hardware acceleration for the WebView
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    /**
     * Set desktop user agent
     */
    fun setDesktopUserAgent() {
        settings.userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    /**
     * Set mobile user agent
     */
    fun setMobileUserAgent() {
        settings.userAgentString = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    }

    /**
     * Toggle ad blocker
     */
    fun setAdBlockerEnabled(enabled: Boolean) {
        adBlocker.setEnabled(enabled)
    }

    /**
     * Get current ad blocker status
     */
    fun isAdBlockerEnabled(): Boolean {
        return adBlocker.isEnabled()
    }

    /**
     * Get the extraction client for advanced operations
     */
    fun getExtractionClient(): ExtractionWebViewClient {
        return extractionClient
    }

    /**
     * Clear all WebView data
     */
    fun clearWebViewData() {
        clearCache(true)
        clearHistory()
        clearFormData()
        clearSslPreferences()
    }

    /**
     * Reset WebView to initial state
     */
    fun reset() {
        clearWebViewData()
        stopLoading()
        loadUrl("about:blank")
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        // Clean up resources when WebView is detached
        extractionClient.cleanup()
    }
}
