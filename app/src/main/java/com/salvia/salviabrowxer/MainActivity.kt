package com.salvia.salviabrowxer

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.salvia.salviabrowxer.bridge.SalviaNativeBridge
import com.salvia.salviabrowxer.core.NativeProxyClient
import com.salvia.salviabrowxer.service.NativeDownloadBus
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ -> }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.decorView.setBackgroundColor(Color.BLACK)

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            addJavascriptInterface(SalviaNativeBridge(this@MainActivity), "SalviaNative")

            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    val uri = request.url ?: return null
                    if (uri.host == "appassets.androidplatform.net") {
                        if (uri.path?.startsWith("/api/") == true) {
                            return NativeProxyClient.handleApiRequest(this@MainActivity, request)
                        }
                        return assetLoader.shouldInterceptRequest(uri)
                    }
                    return super.shouldInterceptRequest(view, request)
                }
            }
        }

        setContentView(webView)

        NativeDownloadBus.listener = { payload ->
            val encoded = JSONObject.quote(payload.toString())
            runOnUiThread {
                if (::webView.isInitialized) {
                    webView.evaluateJavascript(
                        "window.__salviaNativeDownloadEvent && window.__salviaNativeDownloadEvent(JSON.parse($encoded));",
                        null
                    )
                }
            }
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webView.evaluateJavascript(
                        "(function(){ return window.__salviaNativeBack ? window.__salviaNativeBack() : false; })()"
                    ) { result ->
                        if (result != "true") {
                            moveTaskToBack(true)
                        }
                    }
                }
            }
        )

        requestNotificationPermissionIfNeeded()

        val initialUrl = intent?.dataString
        val startUrl = if (!initialUrl.isNullOrBlank()) {
            "https://appassets.androidplatform.net/assets/www/index.html?autostart=1&open=${
                java.net.URLEncoder.encode(initialUrl, "UTF-8")
            }"
        } else {
            "https://appassets.androidplatform.net/assets/www/index.html?autostart=1"
        }
        webView.loadUrl(startUrl)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val incoming = intent.dataString
        if (!incoming.isNullOrBlank() && ::webView.isInitialized) {
            val quoted = JSONObject.quote(incoming)
            webView.evaluateJavascript("window.__salviaOpenUrl && window.__salviaOpenUrl($quoted);", null)
        }
    }

    override fun onDestroy() {
        NativeDownloadBus.listener = null
        if (::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}
