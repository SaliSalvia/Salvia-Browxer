package com.salvia.salviabrowxer.bridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import com.salvia.salviabrowxer.service.NativeDownloadService

class SalviaNativeBridge(private val activity: Activity) {

    @JavascriptInterface
    fun isAndroidApp(): Boolean = true

    @JavascriptInterface
    fun getApiBase(): String = "https://appassets.androidplatform.net"

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
}
