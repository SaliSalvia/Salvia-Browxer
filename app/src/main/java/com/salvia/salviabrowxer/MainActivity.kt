package com.salvia.salviabrowxer

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentCallbacks2
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.salvia.salviabrowxer.bridge.SalviaMediaReceiverBridge
import com.salvia.salviabrowxer.bridge.SalviaNativeBridge
import com.salvia.salviabrowxer.core.AdBlockHostRules
import com.salvia.salviabrowxer.core.BrowserBridgeInjector
import com.salvia.salviabrowxer.core.LinkPatternCategory
import com.salvia.salviabrowxer.core.LinkPatternDetector
import com.salvia.salviabrowxer.core.NativeProxyClient
import com.salvia.salviabrowxer.service.NativeDownloadBus
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {

    private lateinit var rootContainer: FrameLayout
    private lateinit var uiWebView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private var browserWebView: WebView? = null
    private var fullscreenContainer: FrameLayout? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private var floatingOrbView: FrameLayout? = null
    private var floatingOrbRing: View? = null
    private var floatingOrbImage: ImageView? = null
    private var floatingOrbBadge: TextView? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val sniffedUrls = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    @Volatile
    private var activeTabId: String = "tab-initial"

    @Volatile
    private var activePageUrl: String = ""

    @Volatile
    private var activeAdBlock: Boolean = false

    @Volatile
    private var activeDesktopMode: Boolean = false

    @Volatile
    private var activeJsEnabled: Boolean = true

    @Volatile
    private var activeCookiesEnabled: Boolean = true

    @Volatile
    private var activePageZoom: Int = 100

    private var viewportVisible: Boolean = false
    private var vpLeftPx: Int = 0
    private var vpTopPx: Int = 0
    private var vpWidthPx: Int = 0
    private var vpHeightPx: Int = 0

    private var orbVisible: Boolean = true
    private var orbHighlighted: Boolean = false
    private var orbMediaCount: Int = 0
    private var orbSizeDp: Int = 54
    private var orbXCss: Float = 0f
    private var orbYCss: Float = 0f

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

        rootContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        uiWebView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
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

        rootContainer.addView(
            uiWebView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(rootContainer)

        NativeDownloadBus.listener = { payload ->
            val encoded = JSONObject.quote(payload.toString())
            runOnUiThread {
                if (::uiWebView.isInitialized) {
                    uiWebView.evaluateJavascript(
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
                    if (fullscreenContainer != null) {
                        customViewCallback?.onCustomViewHidden()
                        return
                    }
                    val bwv = browserWebView
                    if (viewportVisible && bwv != null && bwv.canGoBack()) {
                        bwv.goBack()
                        return
                    }
                    uiWebView.evaluateJavascript(
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
        uiWebView.loadUrl(startUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureBrowserWebView(): WebView {
        browserWebView?.let { return it }

        val bwv = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            visibility = View.GONE

            settings.javaScriptEnabled = activeJsEnabled
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.userAgentString = if (activeDesktopMode) DESKTOP_USER_AGENT else MOBILE_USER_AGENT
            settings.textZoom = activePageZoom.coerceIn(75, 150)

            CookieManager.getInstance().setAcceptCookie(activeCookiesEnabled)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, activeCookiesEnabled)

            addJavascriptInterface(SalviaMediaReceiverBridge(this@MainActivity), "SalviaNative")

            setFindListener { activeMatchOrdinal, numberOfMatches, isDoneCounting ->
                if (isDoneCounting) {
                    emitUiBrowserEvent(
                        JSONObject()
                            .put("type", "find-result")
                            .put("tabId", activeTabId)
                            .put("matches", numberOfMatches)
                            .put("active", if (numberOfMatches > 0) activeMatchOrdinal + 1 else 0)
                    )
                }
            }

            setDownloadListener { dlUrl, _, _, mimeType, _ ->
                if (dlUrl.isNullOrBlank() || LinkPatternDetector.isYouTubeUrl(dlUrl)) return@setDownloadListener
                emitUiBrowserEvent(
                    JSONObject()
                        .put("type", "media-sniffed")
                        .put("tabId", activeTabId)
                        .put("pageUrl", activePageUrl)
                        .put("mediaUrl", dlUrl)
                        .put("mimeType", mimeType ?: "")
                        .put("source", "FETCH")
                )
            }

            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    emitUiBrowserEvent(
                        JSONObject()
                            .put("type", "progress")
                            .put("tabId", activeTabId)
                            .put("progress", newProgress)
                    )
                }

                override fun onReceivedTitle(view: WebView?, title: String?) {
                    if (!title.isNullOrBlank()) {
                        emitUiBrowserEvent(
                            JSONObject()
                                .put("type", "title")
                                .put("tabId", activeTabId)
                                .put("url", view?.url ?: activePageUrl)
                                .put("title", title)
                        )
                    }
                }

                override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                    if (view == null) return
                    fullscreenContainer?.let { rootContainer.removeView(it) }
                    val fs = FrameLayout(this@MainActivity).apply {
                        setBackgroundColor(Color.BLACK)
                        addView(
                            view,
                            FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                        )
                    }
                    fullscreenContainer = fs
                    customViewCallback = callback
                    rootContainer.addView(
                        fs,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                }

                override fun onHideCustomView() {
                    fullscreenContainer?.let { rootContainer.removeView(it) }
                    fullscreenContainer = null
                    customViewCallback = null
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url ?: return false
                    val scheme = uri.scheme?.lowercase().orEmpty()
                    if (scheme == "http" || scheme == "https") {
                        return false
                    }
                    return true
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    val safeUrl = url ?: return
                    activePageUrl = safeUrl
                    if (sniffedUrls.size > 250) sniffedUrls.clear()
                    emitUiBrowserEvent(
                        JSONObject()
                            .put("type", "page-started")
                            .put("tabId", activeTabId)
                            .put("url", safeUrl)
                            .put("canGoBack", view?.canGoBack() ?: false)
                            .put("canGoForward", view?.canGoForward() ?: false)
                    )
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    val safeUrl = url ?: return
                    activePageUrl = safeUrl
                    val script = BrowserBridgeInjector.buildDetectorScript(safeUrl, isLiveWebView = true)
                    view?.evaluateJavascript(script, null)
                    emitUiBrowserEvent(
                        JSONObject()
                            .put("type", "page-finished")
                            .put("tabId", activeTabId)
                            .put("url", safeUrl)
                            .put("title", view?.title ?: safeUrl)
                            .put("canGoBack", view?.canGoBack() ?: false)
                            .put("canGoForward", view?.canGoForward() ?: false)
                    )
                }

                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    val urlStr = request.url?.toString() ?: return null
                    if (!urlStr.startsWith("http://", true) && !urlStr.startsWith("https://", true)) {
                        return null
                    }

                    if (activeAdBlock && !request.isForMainFrame && AdBlockHostRules.isBlockedUrl(urlStr)) {
                        emitUiBrowserEvent(
                            JSONObject()
                                .put("type", "adblock-blocked")
                                .put("tabId", activeTabId)
                                .put("host", request.url?.host ?: "")
                        )
                        return WebResourceResponse(
                            "text/plain",
                            "utf-8",
                            204,
                            "No Content",
                            emptyMap(),
                            ByteArrayInputStream(ByteArray(0))
                        )
                    }

                    if (!request.isForMainFrame && !LinkPatternDetector.isYouTubeUrl(urlStr)) {
                        sniffNetworkMediaUrl(urlStr)
                    }

                    return super.shouldInterceptRequest(view, request)
                }
            }
        }

        browserWebView = bwv
        // Layer above uiWebView inside viewport bounds, while floatingOrbView sits above browserWebView
        rootContainer.addView(bwv, 1)
        ensureFloatingOrbView()
        applyViewportLayout()
        return bwv
    }

    private fun sniffNetworkMediaUrl(urlStr: String) {
        val cleanPath = urlStr.substringBefore('#').substringBefore('?').lowercase()
        if (cleanPath.endsWith(".ts") ||
            cleanPath.endsWith(".m4s") ||
            cleanPath.endsWith(".vtt") ||
            cleanPath.endsWith(".srt") ||
            cleanPath.endsWith(".key") ||
            cleanPath.endsWith(".png") ||
            cleanPath.endsWith(".jpg") ||
            cleanPath.endsWith(".jpeg") ||
            cleanPath.endsWith(".webp") ||
            cleanPath.endsWith(".gif") ||
            cleanPath.endsWith(".svg") ||
            cleanPath.endsWith(".css") ||
            cleanPath.endsWith(".js") ||
            cleanPath.endsWith(".woff") ||
            cleanPath.endsWith(".woff2")
        ) {
            return
        }
        val low = urlStr.lowercase()
        val match = LinkPatternDetector.classify(urlStr) ?: return
        val isMedia = match.category == LinkPatternCategory.DIRECT_MEDIA ||
            match.isCdnDirect ||
            low.contains(".m3u8") ||
            low.contains(".mpd") ||
            low.contains("mime=video") ||
            low.contains("mime=audio") ||
            low.contains("mime%3dvideo") ||
            low.contains("mime%3daudio")
        if (!isMedia) return

        if (sniffedUrls.size > 300) sniffedUrls.clear()
        if (!sniffedUrls.add(urlStr)) return

        val inferredMime = match.inferredMime ?: when {
            low.contains(".m3u8") -> "application/vnd.apple.mpegurl"
            low.contains(".mpd") -> "application/dash+xml"
            low.contains(".mp3") -> "audio/mpeg"
            low.contains(".m4a") -> "audio/mp4"
            else -> "video/mp4"
        }

        emitUiBrowserEvent(
            JSONObject()
                .put("type", "media-sniffed")
                .put("tabId", activeTabId)
                .put("pageUrl", activePageUrl)
                .put("mediaUrl", urlStr)
                .put("mimeType", inferredMime)
                .put("source", "FETCH")
        )
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun ensureFloatingOrbView(): FrameLayout {
        floatingOrbView?.let { return it }

        val container = FrameLayout(this).apply {
            visibility = View.GONE
            elevation = dp(12).toFloat()
            clipChildren = false
            clipToPadding = false
        }

        val ringView = View(this).apply {
            background = buildOrbRingDrawable(false)
        }
        floatingOrbRing = ringView

        val image = ImageView(this).apply {
            setImageResource(R.drawable.salvia_logo)
            scaleType = ImageView.ScaleType.CENTER_CROP
            clipToOutline = true
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setOval(0, 0, view.width, view.height)
                }
            }
            alpha = 0.55f
        }
        floatingOrbImage = image

        val badge = TextView(this).apply {
            visibility = View.GONE
            setTextColor(Color.BLACK)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#D9AE54"))
                setStroke(dp(2), Color.parseColor("#070510"))
            }
        }
        floatingOrbBadge = badge

        container.addView(
            ringView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        val inset = dp(3)
        container.addView(
            image,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ).apply {
                setMargins(inset, inset, inset, inset)
            }
        )
        val badgeSize = dp(20)
        container.addView(
            badge,
            FrameLayout.LayoutParams(badgeSize, badgeSize).apply {
                gravity = Gravity.TOP or Gravity.END
            }
        )

        var downRawX = 0f
        var downRawY = 0f
        var startX = 0f
        var startY = 0f
        var moved = false
        var longPressed = false
        val longPressRunnable = Runnable {
            if (!moved) {
                longPressed = true
                runOnUiThread {
                    uiWebView.evaluateJavascript(
                        "window.__salviaNativeFabLongPress && window.__salviaNativeFabLongPress();",
                        null
                    )
                }
            }
        }

        container.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    v.animate().cancel()
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = v.x
                    startY = v.y
                    moved = false
                    longPressed = false
                    mainHandler.postDelayed(longPressRunnable, 500L)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    if (!moved && hypot(dx.toDouble(), dy.toDouble()) > dp(8).toDouble()) {
                        moved = true
                        mainHandler.removeCallbacks(longPressRunnable)
                    }
                    if (moved) {
                        val pad = dp(14).toFloat()
                        val minX = vpLeftPx + pad
                        val maxX = maxOf(minX, vpLeftPx + vpWidthPx - v.width - pad)
                        val minY = vpTopPx + pad
                        val maxY = maxOf(minY, vpTopPx + vpHeightPx - v.height - pad)
                        v.x = (startX + dx).coerceIn(minX, maxX)
                        v.y = (startY + dy).coerceIn(minY, maxY)
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    if (moved) {
                        val pad = dp(14).toFloat()
                        val minX = vpLeftPx + pad
                        val maxX = maxOf(minX, vpLeftPx + vpWidthPx - v.width - pad)
                        val center = v.x + v.width / 2f
                        val vpMid = vpLeftPx + vpWidthPx / 2f
                        val targetX = if (center < vpMid) minX else maxX
                        val minY = vpTopPx + pad
                        val maxY = maxOf(minY, vpTopPx + vpHeightPx - v.height - pad)
                        val targetY = v.y.coerceIn(minY, maxY)
                        v.animate().x(targetX).y(targetY).setDuration(180L).start()

                        val density = resources.displayMetrics.density.coerceAtLeast(1f)
                        val relXCss = (targetX - vpLeftPx) / density
                        val relYCss = (targetY - vpTopPx) / density
                        orbXCss = relXCss
                        orbYCss = relYCss
                        uiWebView.evaluateJavascript(
                            "window.__salviaNativeFabMove && window.__salviaNativeFabMove($relXCss, $relYCss);",
                            null
                        )
                    } else if (!longPressed && event.actionMasked == MotionEvent.ACTION_UP) {
                        uiWebView.evaluateJavascript(
                            "window.__salviaNativeFabTap && window.__salviaNativeFabTap();",
                            null
                        )
                    }
                    true
                }
                else -> false
            }
        }

        floatingOrbView = container
        rootContainer.addView(container)
        applyFloatingOrbStyle()
        return container
    }

    private fun buildOrbRingDrawable(highlighted: Boolean): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#070510"))
            setStroke(
                dp(if (highlighted) 2 else 1),
                Color.parseColor(if (highlighted) "#4CC4FF" else "#312556")
            )
        }
    }

    private fun applyFloatingOrbStyle() {
        val orb = floatingOrbView ?: return
        val sizePx = dp(orbSizeDp.coerceIn(46, 76))
        val lp = (orb.layoutParams as? FrameLayout.LayoutParams)
            ?: FrameLayout.LayoutParams(sizePx, sizePx)
        lp.width = sizePx
        lp.height = sizePx
        orb.layoutParams = lp

        floatingOrbRing?.background = buildOrbRingDrawable(orbHighlighted)
        floatingOrbImage?.alpha = if (orbHighlighted) 1.0f else 0.45f
        floatingOrbBadge?.let { badge ->
            if (orbHighlighted && orbMediaCount > 0) {
                badge.visibility = View.VISIBLE
                badge.text = orbMediaCount.toString()
            } else {
                badge.visibility = View.GONE
            }
        }

        if (viewportVisible && orbVisible && vpWidthPx > sizePx && vpHeightPx > sizePx) {
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            val pad = dp(14).toFloat()
            val posX = if (orbXCss > 0f || orbYCss > 0f) {
                (vpLeftPx + orbXCss * density).coerceIn(
                    vpLeftPx + pad,
                    maxOf(vpLeftPx + pad, vpLeftPx + vpWidthPx - sizePx - pad)
                )
            } else {
                (vpLeftPx + vpWidthPx - sizePx - dp(16)).toFloat()
            }
            val posY = if (orbXCss > 0f || orbYCss > 0f) {
                (vpTopPx + orbYCss * density).coerceIn(
                    vpTopPx + pad,
                    maxOf(vpTopPx + pad, vpTopPx + vpHeightPx - sizePx - pad)
                )
            } else {
                (vpTopPx + vpHeightPx - sizePx - dp(18)).toFloat()
            }
            orb.animate().cancel()
            orb.x = posX
            orb.y = posY
            orb.visibility = View.VISIBLE
        } else {
            orb.visibility = View.GONE
        }
    }

    private fun applyViewportLayout() {
        val bwv = browserWebView ?: return
        if (!viewportVisible || vpWidthPx <= 0 || vpHeightPx <= 0) {
            bwv.visibility = View.GONE
            floatingOrbView?.visibility = View.GONE
            return
        }
        val lp = FrameLayout.LayoutParams(vpWidthPx, vpHeightPx).apply {
            leftMargin = vpLeftPx
            topMargin = vpTopPx
        }
        bwv.layoutParams = lp
        bwv.visibility = View.VISIBLE
        applyFloatingOrbStyle()
    }

    fun nativeLoadUrl(
        tabId: String,
        url: String,
        desktopMode: Boolean,
        jsEnabled: Boolean,
        adBlockEnabled: Boolean
    ) {
        activeTabId = tabId
        activeDesktopMode = desktopMode
        activeJsEnabled = jsEnabled
        activeAdBlock = adBlockEnabled
        runOnUiThread {
            val bwv = ensureBrowserWebView()
            bwv.settings.javaScriptEnabled = jsEnabled
            bwv.settings.userAgentString = if (desktopMode) DESKTOP_USER_AGENT else MOBILE_USER_AGENT
            sniffedUrls.clear()
            activePageUrl = url
            bwv.loadUrl(url)
        }
    }

    fun nativeUpdateBrowserSettings(
        desktopMode: Boolean,
        jsEnabled: Boolean,
        adBlockEnabled: Boolean,
        cookiesEnabled: Boolean,
        pageZoom: Int
    ) {
        val uaChanged = activeDesktopMode != desktopMode
        activeDesktopMode = desktopMode
        activeJsEnabled = jsEnabled
        activeAdBlock = adBlockEnabled
        activeCookiesEnabled = cookiesEnabled
        activePageZoom = pageZoom
        runOnUiThread {
            val bwv = browserWebView ?: return@runOnUiThread
            bwv.settings.javaScriptEnabled = jsEnabled
            bwv.settings.textZoom = pageZoom.coerceIn(75, 150)
            CookieManager.getInstance().setAcceptCookie(cookiesEnabled)
            CookieManager.getInstance().setAcceptThirdPartyCookies(bwv, cookiesEnabled)
            if (uaChanged) {
                bwv.settings.userAgentString = if (desktopMode) DESKTOP_USER_AGENT else MOBILE_USER_AGENT
                if (bwv.url != null) bwv.reload()
            }
        }
    }

    fun nativeGoBack() {
        runOnUiThread {
            val bwv = browserWebView ?: return@runOnUiThread
            if (bwv.canGoBack()) {
                bwv.goBack()
            }
        }
    }

    fun nativeGoForward() {
        runOnUiThread {
            val bwv = browserWebView ?: return@runOnUiThread
            if (bwv.canGoForward()) {
                bwv.goForward()
            }
        }
    }

    fun nativeReload() {
        runOnUiThread {
            browserWebView?.reload()
        }
    }

    fun nativeStopLoading() {
        runOnUiThread {
            browserWebView?.stopLoading()
        }
    }

    fun nativeFindInPage(query: String, backwards: Boolean) {
        runOnUiThread {
            val bwv = browserWebView ?: return@runOnUiThread
            if (query.isBlank()) {
                bwv.clearMatches()
                return@runOnUiThread
            }
            bwv.findAllAsync(query)
            bwv.findNext(!backwards)
        }
    }

    fun nativeClearFindInPage() {
        runOnUiThread {
            browserWebView?.clearMatches()
        }
    }

    fun nativeClearBrowserData() {
        runOnUiThread {
            try {
                browserWebView?.clearCache(true)
                browserWebView?.clearHistory()
                browserWebView?.clearFormData()
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
            } catch (_: Exception) {
            }
        }
    }

    fun setBrowserViewport(
        visible: Boolean,
        leftCss: Float,
        topCss: Float,
        widthCss: Float,
        heightCss: Float
    ) {
        runOnUiThread {
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            viewportVisible = visible
            vpLeftPx = (leftCss * density).roundToInt().coerceAtLeast(0)
            vpTopPx = (topCss * density).roundToInt().coerceAtLeast(0)
            vpWidthPx = (widthCss * density).roundToInt().coerceAtLeast(0)
            vpHeightPx = (heightCss * density).roundToInt().coerceAtLeast(0)
            if (visible) {
                ensureBrowserWebView()
            }
            applyViewportLayout()
        }
    }

    fun setFloatingOrbState(
        visible: Boolean,
        highlighted: Boolean,
        mediaCount: Int,
        sizeDp: Int,
        xCss: Float,
        yCss: Float,
        contentDesc: String
    ) {
        runOnUiThread {
            orbVisible = visible
            orbHighlighted = highlighted
            orbMediaCount = mediaCount
            orbSizeDp = sizeDp
            orbXCss = xCss
            orbYCss = yCss
            floatingOrbView?.contentDescription = contentDesc
            applyFloatingOrbStyle()
        }
    }

    fun onNativeBrowserScriptMessage(jsonPayload: String) {
        try {
            val obj = JSONObject(jsonPayload)
            val msgType = obj.optString("type")
            val payload = obj.optJSONObject("payload") ?: return
            if (msgType == "media-dom") {
                val items = payload.optJSONArray("items") ?: JSONArray()
                emitUiBrowserEvent(
                    JSONObject()
                        .put("type", "media-dom")
                        .put("tabId", activeTabId)
                        .put("pageUrl", payload.optString("pageUrl", activePageUrl))
                        .put("items", items)
                )
            } else if (msgType == "visible-media") {
                emitUiBrowserEvent(
                    JSONObject()
                        .put("type", "visible-media")
                        .put("tabId", activeTabId)
                        .put("pageUrl", payload.optString("pageUrl", activePageUrl))
                        .put("mediaUrl", payload.optString("mediaUrl", ""))
                )
            }
        } catch (_: Exception) {
        }
    }

    private fun emitUiBrowserEvent(payload: JSONObject) {
        val encoded = JSONObject.quote(payload.toString())
        runOnUiThread {
            if (::uiWebView.isInitialized) {
                uiWebView.evaluateJavascript(
                    "window.__salviaNativeBrowserEvent && window.__salviaNativeBrowserEvent(JSON.parse($encoded));",
                    null
                )
            }
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).roundToInt()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val incoming = intent.dataString
        if (!incoming.isNullOrBlank() && ::uiWebView.isInitialized) {
            val quoted = JSONObject.quote(incoming)
            uiWebView.evaluateJavascript("window.__salviaOpenUrl && window.__salviaOpenUrl($quoted);", null)
        }
    }

    override fun onPause() {
        try {
            CookieManager.getInstance().flush()
            browserWebView?.onPause()
        } catch (_: Exception) {
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        try {
            browserWebView?.onResume()
        } catch (_: Exception) {
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
            level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN
        ) {
            runOnUiThread {
                try {
                    browserWebView?.clearCache(false)
                    uiWebView.clearCache(false)
                } catch (_: Exception) {
                }
            }
        }
    }

    override fun onDestroy() {
        NativeDownloadBus.listener = null
        mainHandler.removeCallbacksAndMessages(null)
        browserWebView?.let {
            it.stopLoading()
            it.destroy()
        }
        browserWebView = null
        if (::uiWebView.isInitialized) {
            uiWebView.destroy()
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

    companion object {
        private const val MOBILE_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
        private const val DESKTOP_USER_AGENT =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    }
}
