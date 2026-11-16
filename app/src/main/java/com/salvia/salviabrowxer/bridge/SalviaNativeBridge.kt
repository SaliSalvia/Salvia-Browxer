package com.salvia.salviabrowxer.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import com.salvia.salviabrowxer.MainActivity
import com.salvia.salviabrowxer.service.NativeDownloadService

class SalviaNativeBridge(private val activity: Activity) {

    @JavascriptInterface
    fun isAndroidApp(): Boolean = true

    @JavascriptInterface
    fun getApiBase(): String = "https://appassets.androidplatform.net"

    @JavascriptInterface
    fun supportsNativeBrowser(): Boolean = activity is MainActivity

    @JavascriptInterface
    fun startDownload(
        id: String,
        url: String,
        filename: String,
        mimeType: String,
        isHls: Boolean,
        parallelConnections: Int,
        autoSaveToGallery: Boolean,
        audioTrackUrl: String?
    ) {
        NativeDownloadService.start(
            context = activity.applicationContext,
            id = id,
            url = url,
            filename = filename,
            mimeType = mimeType,
            isHls = isHls,
            connections = parallelConnections,
            autoSave = autoSaveToGallery,
            audioTrackUrl = audioTrackUrl?.takeIf { it.isNotBlank() }
        )
    }

    @JavascriptInterface
    fun startDownloadWithReferer(
        id: String,
        url: String,
        filename: String,
        mimeType: String,
        isHls: Boolean,
        parallelConnections: Int,
        autoSaveToGallery: Boolean,
        audioTrackUrl: String?,
        referer: String?
    ) {
        NativeDownloadService.start(
            context = activity.applicationContext,
            id = id,
            url = url,
            filename = filename,
            mimeType = mimeType,
            isHls = isHls,
            connections = parallelConnections,
            autoSave = autoSaveToGallery,
            audioTrackUrl = audioTrackUrl?.takeIf { it.isNotBlank() },
            referer = referer?.takeIf { it.isNotBlank() }
        )
    }

    @JavascriptInterface
    fun pauseDownload(id: String) {
        NativeDownloadService.pause(activity.applicationContext, id)
    }

    @JavascriptInterface
    fun cancelDownload(id: String) {
        NativeDownloadService.cancel(activity.applicationContext, id)
    }

    @JavascriptInterface
    fun openNativeFile(uriString: String, mimeType: String): Boolean {
        return try {
            val uri = Uri.parse(uriString)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mimeType.ifBlank { "video/*" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun shareNativeFile(uriString: String, title: String, mimeType: String): Boolean {
        return try {
            val uri = Uri.parse(uriString)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType.ifBlank { "video/*" }
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(intent, title))
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun minimizeApp() {
        activity.runOnUiThread {
            activity.moveTaskToBack(true)
        }
    }

    @JavascriptInterface
    fun nativeLoadUrl(
        tabId: String,
        url: String,
        desktopMode: Boolean,
        jsEnabled: Boolean,
        adBlockEnabled: Boolean
    ) {
        (activity as? MainActivity)?.nativeLoadUrl(tabId, url, desktopMode, jsEnabled, adBlockEnabled)
    }

    @JavascriptInterface
    fun nativeUpdateBrowserSettings(
        desktopMode: Boolean,
        jsEnabled: Boolean,
        adBlockEnabled: Boolean,
        cookiesEnabled: Boolean,
        pageZoom: Int
    ) {
        (activity as? MainActivity)?.nativeUpdateBrowserSettings(
            desktopMode,
            jsEnabled,
            adBlockEnabled,
            cookiesEnabled,
            pageZoom
        )
    }

    @JavascriptInterface
    fun nativeGoBack() {
        (activity as? MainActivity)?.nativeGoBack()
    }

    @JavascriptInterface
    fun nativeGoForward() {
        (activity as? MainActivity)?.nativeGoForward()
    }

    @JavascriptInterface
    fun nativeReload() {
        (activity as? MainActivity)?.nativeReload()
    }

    @JavascriptInterface
    fun nativeStopLoading() {
        (activity as? MainActivity)?.nativeStopLoading()
    }

    @JavascriptInterface
    fun nativeFindInPage(query: String, backwards: Boolean) {
        (activity as? MainActivity)?.nativeFindInPage(query, backwards)
    }

    @JavascriptInterface
    fun nativeClearFindInPage() {
        (activity as? MainActivity)?.nativeClearFindInPage()
    }

    @JavascriptInterface
    fun nativeClearBrowserData() {
        (activity as? MainActivity)?.nativeClearBrowserData()
    }

    @JavascriptInterface
    fun setBrowserViewport(
        visible: Boolean,
        leftCss: Float,
        topCss: Float,
        widthCss: Float,
        heightCss: Float
    ) {
        (activity as? MainActivity)?.setBrowserViewport(visible, leftCss, topCss, widthCss, heightCss)
    }

    @JavascriptInterface
    fun setFloatingOrbState(
        visible: Boolean,
        highlighted: Boolean,
        mediaCount: Int,
        sizeDp: Int,
        xCss: Float,
        yCss: Float,
        contentDesc: String
    ) {
        (activity as? MainActivity)?.setFloatingOrbState(
            visible,
            highlighted,
            mediaCount,
            sizeDp,
            xCss,
            yCss,
            contentDesc
        )
    }
}

/**
 * Minimal, isolated JS interface exposed only inside the live third-party WebView so
 * untrusted web pages cannot invoke download or file-management bridges.
 */
class SalviaMediaReceiverBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun reportBrowserMedia(jsonPayload: String) {
        activity.onNativeBrowserScriptMessage(jsonPayload)
    }
}
