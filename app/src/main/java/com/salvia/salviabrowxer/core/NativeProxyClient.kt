package com.salvia.salviabrowxer.core

import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import okhttp3.ConnectionPool
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Dispatcher
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.ResponseBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.URI
import java.util.Locale
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.roundToInt

object NativeProxyClient {
    private const val MAX_TEXT_BODY_BYTES = 3 * 1024 * 1024
    private const val MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
    private const val DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

    private val probePool: ExecutorService = Executors.newFixedThreadPool(8)

    private data class ExtractedCandidate(
        val url: String,
        val source: String = "FETCH",
        val mimeType: String? = null,
        val format: String? = null,
        val width: Int? = null,
        val height: Int? = null,
        val bitrate: Int? = null,
        val audioTrackUrl: String? = null
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("url", url)
            put("source", source)
            if (!mimeType.isNullOrBlank()) put("mimeType", mimeType)
            if (!format.isNullOrBlank()) put("format", format)
            if (width != null && width > 0) put("width", width)
            if (height != null && height > 0) put("height", height)
            if (bitrate != null && bitrate > 0) put("bitrate", bitrate)
            if (!audioTrackUrl.isNullOrBlank()) put("audioTrackUrl", audioTrackUrl)
        }
    }

    private val webViewCookieJar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            try {
                val cm = CookieManager.getInstance()
                val urlStr = url.toString()
                for (cookie in cookies) {
                    cm.setCookie(urlStr, cookie.toString())
                }
            } catch (_: Exception) {
            }
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            return try {
                val raw = CookieManager.getInstance().getCookie(url.toString()) ?: return emptyList()
                raw.split(";")
                    .mapNotNull { part ->
                        val idx = part.indexOf('=')
                        if (idx <= 0) return@mapNotNull null
                        val name = part.substring(0, idx).trim()
                        val value = part.substring(idx + 1).trim()
                        if (name.isEmpty()) null else Cookie.Builder().name(name).value(value).domain(url.host).build()
                    }
            } catch (_: Exception) {
                emptyList()
            }
        }
    }

    val httpClient: OkHttpClient by lazy {
        val dispatcher = Dispatcher().apply {
            maxRequests = 64
            maxRequestsPerHost = 16
        }
        OkHttpClient.Builder()
            .dispatcher(dispatcher)
            .connectionPool(ConnectionPool(16, 5, TimeUnit.MINUTES))
            .cookieJar(webViewCookieJar)
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .build()
    }

    private fun readBoundedText(body: ResponseBody?, maxBytes: Int = MAX_TEXT_BODY_BYTES): String {
        if (body == null) return ""
        val input = body.byteStream()
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        var remaining = maxBytes
        while (remaining > 0) {
            val read = input.read(buf, 0, minOf(buf.size, remaining))
            if (read <= 0) break
            out.write(buf, 0, read)
            remaining -= read
        }
        return String(out.toByteArray(), Charsets.UTF_8)
    }

    fun handleApiRequest(context: Context, request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url ?: return null
        val path = uri.path ?: return null
        if (!path.startsWith("/api/")) return null

        return when (path) {
            "/api/browse" -> handleBrowse(uri)
            "/api/media/probe" -> handleProbe(uri)
            "/api/media/extract" -> handleExtract(uri)
            "/api/media/fetch" -> handleFetch(uri, request)
            "/api/local-file" -> handleLocalFile(context, uri, request)
            else -> jsonResponse(404, JSONObject().put("error", "Not found"))
        }
    }

    private fun attachReferer(builder: Request.Builder, rawReferer: String?) {
        val validRef = validateRemoteUrl(rawReferer) ?: return
        builder.header("Referer", validRef)
        try {
            val uri = URI(validRef)
            val portPart = if (uri.port > 0) ":${uri.port}" else ""
            if (!uri.scheme.isNullOrBlank() && !uri.host.isNullOrBlank()) {
                builder.header("Origin", "${uri.scheme}://${uri.host}$portPart")
            }
        } catch (_: Exception) {
        }
    }

    private fun handleBrowse(uri: Uri): WebResourceResponse {
        val target = validateRemoteUrl(uri.getQueryParameter("url"))
            ?: return jsonResponse(400, JSONObject().put("error", "Invalid or restricted URL"))
        val desktop = uri.getQueryParameter("desktop") == "1"
        val adBlock = uri.getQueryParameter("adblock") == "1"

        return try {
            val req = Request.Builder()
                .url(target)
                .header("User-Agent", if (desktop) DESKTOP_UA else MOBILE_UA)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .build()
            httpClient.newCall(req).execute().use { res ->
                val contentType = res.header("Content-Type").orEmpty()
                val finalUrl = res.request.url.toString()
                if (!res.isSuccessful) {
                    return jsonResponse(
                        200,
                        JSONObject()
                            .put("ok", false)
                            .put("status", res.code)
                            .put("statusText", res.message)
                            .put("finalUrl", finalUrl)
                    )
                }
                if (contentType.contains("text/html") ||
                    contentType.contains("application/xhtml+xml") ||
                    contentType.isEmpty()
                ) {
                    val rawHtml = readBoundedText(res.body)
                    val injected = BrowserBridgeInjector.inject(rawHtml, finalUrl, adBlock)
                    val title = injected.title ?: URI(finalUrl).host ?: target
                    jsonResponse(
                        200,
                        JSONObject()
                            .put("ok", true)
                            .put("finalUrl", finalUrl)
                            .put("title", title)
                            .put("contentType", contentType)
                            .put("blockedCount", injected.blockedCount)
                            .put("html", injected.html)
                    )
                } else {
                    val isDirect = contentType.startsWith("video/") ||
                        contentType.startsWith("audio/") ||
                        contentType.contains("mpegurl") ||
                        contentType.contains("dash+xml")
                    val cl = res.header("Content-Length")?.toLongOrNull()
                    jsonResponse(
                        200,
                        JSONObject()
                            .put("ok", true)
                            .put("finalUrl", finalUrl)
                            .put("title", finalUrl.substringAfterLast('/').ifEmpty { URI(finalUrl).host ?: target })
                            .put("contentType", contentType)
                            .put("blockedCount", 0)
                            .put("isDirectMedia", isDirect)
                            .put("contentLength", cl ?: JSONObject.NULL)
                    )
                }
            }
        } catch (e: Exception) {
            jsonResponse(
                200,
                JSONObject()
                    .put("ok", false)
                    .put("error", e.message ?: "Network error")
                    .put("finalUrl", target)
            )
        }
    }

    private fun handleProbe(uri: Uri): WebResourceResponse {
        val target = validateRemoteUrl(uri.getQueryParameter("url"))
            ?: return jsonResponse(400, JSONObject().put("error", "Invalid or restricted URL"))
        val referer = uri.getQueryParameter("referer")

        return try {
            val headBuilder = Request.Builder()
                .url(target)
                .head()
                .header("User-Agent", MOBILE_UA)
            attachReferer(headBuilder, referer)
            var res = httpClient.newCall(headBuilder.build()).execute()

            if (!res.isSuccessful || res.code == 405) {
                res.close()
                val rangeBuilder = Request.Builder()
                    .url(target)
                    .get()
                    .header("User-Agent", MOBILE_UA)
                    .header("Range", "bytes=0-0")
                attachReferer(rangeBuilder, referer)
                res = httpClient.newCall(rangeBuilder.build()).execute()
            }

            res.use { response ->
                val contentType = response.header("Content-Type").orEmpty()
                val contentDisposition = response.header("Content-Disposition").orEmpty()
                val contentRange = response.header("Content-Range").orEmpty()
                var size = response.header("Content-Length")?.toLongOrNull()?.takeIf { it > 0L }
                if (contentRange.contains("/")) {
                    val total = contentRange.substringAfter("/").toLongOrNull()
                    if (total != null && total > 0L) size = total
                }
                val acceptRanges = response.header("Accept-Ranges").equals("bytes", ignoreCase = true) ||
                    response.code == 206
                val finalUrl = response.request.url.toString()

                var manifestText: String? = null
                val lowerUrl = target.lowercase(Locale.US)
                if (lowerUrl.contains(".m3u8") ||
                    lowerUrl.contains(".mpd") ||
                    contentType.contains("mpegurl") ||
                    contentType.contains("dash+xml")
                ) {
                    val manifestBuilder = Request.Builder().url(target).header("User-Agent", MOBILE_UA)
                    attachReferer(manifestBuilder, referer)
                    httpClient.newCall(manifestBuilder.build()).execute().use { mRes ->
                        if (mRes.isSuccessful) {
                            manifestText = mRes.body?.string()
                        }
                    }
                }

                jsonResponse(
                    200,
                    JSONObject()
                        .put("ok", true)
                        .put("finalUrl", finalUrl)
                        .put("contentType", contentType)
                        .put("contentDisposition", contentDisposition)
                        .put("size", size ?: JSONObject.NULL)
                        .put("acceptRanges", acceptRanges)
                        .put("manifestText", manifestText ?: JSONObject.NULL)
                )
            }
        } catch (e: Exception) {
            jsonResponse(
                200,
                JSONObject()
                    .put("ok", false)
                    .put("error", e.message ?: "Probe failed")
            )
        }
    }

    private fun handleExtract(uri: Uri): WebResourceResponse {
        val target = validateRemoteUrl(uri.getQueryParameter("url"))
            ?: return jsonResponse(400, JSONObject().put("error", "Invalid or restricted URL"))
        val pattern = LinkPatternDetector.classify(target)
            ?: return jsonResponse(400, JSONObject().put("error", "Invalid URL"))

        if (pattern.category == LinkPatternCategory.YOUTUBE_EXCLUDED) {
            return jsonResponse(
                200,
                JSONObject()
                    .put("ok", false)
                    .put("youtubeExcluded", true)
                    .put("finalUrl", pattern.canonicalUrl)
                    .put("title", pattern.canonicalUrl)
                    .put("items", JSONArray())
                    .put("error", "YOUTUBE_EXCLUDED")
            )
        }

        if (pattern.category == LinkPatternCategory.DIRECT_MEDIA) {
            val arr = JSONArray().put(
                ExtractedCandidate(
                    url = pattern.canonicalUrl,
                    source = "FETCH",
                    mimeType = pattern.inferredMime ?: "video/mp4",
                    format = pattern.inferredExtension?.uppercase(Locale.US) ?: "MP4"
                ).toJson()
            )
            return jsonResponse(
                200,
                JSONObject()
                    .put("ok", true)
                    .put("finalUrl", pattern.canonicalUrl)
                    .put("title", pattern.canonicalUrl.substringAfterLast('/').substringBefore('?').ifEmpty { pattern.hostname })
                    .put("thumbnail", JSONObject.NULL)
                    .put("items", arr)
            )
        }

        // Pattern-routed specialized extractors (fast, stable, no heavyweight browser needed)
        val specialized: JSONObject? = try {
            when (pattern.platform) {
                PlatformExtractorKey.X_TWITTER -> extractXTwitter(pattern)
                PlatformExtractorKey.INSTAGRAM -> extractInstagram(pattern)
                PlatformExtractorKey.TIKTOK -> extractTikTok(pattern)
                PlatformExtractorKey.FACEBOOK -> extractFacebook(pattern)
                PlatformExtractorKey.REDDIT -> extractReddit(pattern)
                PlatformExtractorKey.VIMEO -> extractVimeo(pattern)
                PlatformExtractorKey.DAILYMOTION -> extractDailymotion(pattern)
                PlatformExtractorKey.STREAMABLE -> extractStreamable(pattern)
                else -> null
            }
        } catch (_: Exception) {
            null
        }
        if (specialized != null && specialized.optBoolean("ok", false) && (specialized.optJSONArray("items")?.length() ?: 0) > 0) {
            return jsonResponse(200, specialized)
        }

        // Universal deep HTML / JSON-LD / Script / Iframe extraction for all other websites
        return try {
            val req = Request.Builder()
                .url(pattern.canonicalUrl)
                .header("User-Agent", MOBILE_UA)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .header("Accept-Language", "en-US,en;q=0.9")
                .build()
            httpClient.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    return jsonResponse(
                        200,
                        JSONObject()
                            .put("ok", false)
                            .put("status", res.code)
                            .put("error", "HTTP ${res.code}")
                    )
                }
                val ct = res.header("Content-Type").orEmpty()
                val finalUrl = res.request.url.toString()
                if (ct.startsWith("video/") || ct.startsWith("audio/") || ct.contains("mpegurl") || ct.contains("dash+xml")) {
                    val arr = JSONArray().put(
                        JSONObject()
                            .put("url", finalUrl)
                            .put("mimeType", ct)
                            .put("source", "FETCH")
                    )
                    return jsonResponse(
                        200,
                        JSONObject()
                            .put("ok", true)
                            .put("finalUrl", finalUrl)
                            .put("title", finalUrl.substringAfterLast('/'))
                            .put("items", arr)
                    )
                }

                val html = readBoundedText(res.body)
                val title = parseTitleFromHtml(html, finalUrl)
                val thumbnail = parseThumbFromHtml(html, finalUrl)

                val found = LinkedHashMap<String, ExtractedCandidate>()
                collectUrlsFromHtml(html, finalUrl, found)

                // Inspect up to 3 embedded iframes concurrently one hop deep
                val iframeRegex = Regex("<iframe\\b[^>]+\\b(?:src|data-src)=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
                val iframeUrls = iframeRegex.findAll(html)
                    .mapNotNull { m ->
                        try {
                            validateRemoteUrl(URI(finalUrl).resolve(m.groupValues[1]).toString())
                        } catch (_: Exception) {
                            null
                        }
                    }
                    .distinct()
                    .take(3)
                    .toList()

                if (iframeUrls.isNotEmpty()) {
                    val futures = iframeUrls.map { iframeUrl ->
                        probePool.submit(Callable<Pair<String, String>?> {
                            try {
                                httpClient.newCall(
                                    Request.Builder()
                                        .url(iframeUrl)
                                        .header("User-Agent", MOBILE_UA)
                                        .header("Referer", finalUrl)
                                        .build()
                                ).execute().use { iRes ->
                                    if (iRes.isSuccessful) {
                                        iRes.request.url.toString() to readBoundedText(iRes.body)
                                    } else null
                                }
                            } catch (_: Exception) {
                                null
                            }
                        })
                    }
                    for (future in futures) {
                        val iframePair = try {
                            future.get(7, TimeUnit.SECONDS)
                        } catch (_: Exception) {
                            null
                        }
                        if (iframePair != null && iframePair.second.isNotBlank()) {
                            collectUrlsFromHtml(iframePair.second, iframePair.first, found)
                        }
                    }
                }

                val arr = JSONArray()
                for (item in found.values) {
                    arr.put(item.toJson())
                }
                jsonResponse(
                    200,
                    JSONObject()
                        .put("ok", true)
                        .put("finalUrl", finalUrl)
                        .put("title", title)
                        .put("thumbnail", thumbnail ?: JSONObject.NULL)
                        .put("items", arr)
                )
            }
        } catch (e: Exception) {
            jsonResponse(200, JSONObject().put("ok", false).put("error", e.message ?: "Extract failed"))
        }
    }

    private fun extractXTwitter(pattern: LinkPatternMatch): JSONObject? {
        var effectiveUrl = pattern.canonicalUrl
        var tweetId = pattern.mediaId

        if (tweetId.isNullOrBlank()) {
            try {
                httpClient.newCall(
                    Request.Builder().url(effectiveUrl).header("User-Agent", DESKTOP_UA).build()
                ).execute().use { res ->
                    effectiveUrl = res.request.url.toString()
                    tweetId = LinkPatternDetector.classify(effectiveUrl)?.mediaId
                }
            } catch (_: Exception) {
            }
        }

        val id = tweetId?.takeIf { it.isNotBlank() } ?: return null
        val token = syndicationTokenForTweetId(id)

        // Probe FxTwitter, VxTwitter, and official Syndication concurrently
        val fxFuture: Future<JSONObject?> = probePool.submit(Callable {
            fetchJson("https://api.fxtwitter.com/status/$id", mapOf("User-Agent" to "SalviaBrowxer/1.0", "Accept" to "application/json"))
        })
        val vxFuture: Future<JSONObject?> = probePool.submit(Callable {
            fetchJson("https://api.vxtwitter.com/Twitter/status/$id", mapOf("User-Agent" to "SalviaBrowxer/1.0", "Accept" to "application/json"))
        })
        val synFuture: Future<JSONObject?> = probePool.submit(Callable {
            fetchJson(
                "https://cdn.syndication.twimg.com/tweet-result?id=$id&lang=en&token=$token",
                mapOf("User-Agent" to DESKTOP_UA, "Accept" to "application/json")
            )
        })

        // Strategy 1: FxTwitter JSON API (returns all MP4 bitrates + HLS + thumbnail)
        val fxResult = try { fxFuture.get(9, TimeUnit.SECONDS) } catch (_: Exception) { null }
        fxResult?.let { fx ->
            val tweet = fx.optJSONObject("tweet")
            val videos = tweet?.optJSONObject("media")?.optJSONArray("videos")
            if (videos != null && videos.length() > 0) {
                val video = videos.getJSONObject(0)
                val collected = ArrayList<ExtractedCandidate>()
                val seen = HashSet<String>()

                val variantsArr = JSONArray()
                video.optJSONArray("variants")?.let { arr ->
                    for (i in 0 until arr.length()) variantsArr.put(arr.getJSONObject(i))
                }
                video.optJSONArray("formats")?.let { arr ->
                    for (i in 0 until arr.length()) {
                        val f = arr.getJSONObject(i)
                        variantsArr.put(
                            JSONObject()
                                .put("url", f.optString("url"))
                                .put("bitrate", f.optInt("bitrate", 0))
                                .put("content_type", if (f.optString("container") == "m3u8") "application/vnd.apple.mpegurl" else "video/mp4")
                        )
                    }
                }

                val mp4List = ArrayList<JSONObject>()
                for (i in 0 until variantsArr.length()) {
                    val v = variantsArr.optJSONObject(i) ?: continue
                    val u = v.optString("url")
                    val ct = v.optString("content_type")
                    if (u.isNotBlank() && (ct.isBlank() || ct.contains("mp4"))) {
                        mp4List.add(v)
                    }
                }
                mp4List.sortByDescending { it.optInt("bitrate", 0) }

                val fallbackW = video.optInt("width", 0).takeIf { it > 0 }
                val fallbackH = video.optInt("height", 0).takeIf { it > 0 }

                for (v in mp4List) {
                    val u = v.optString("url")
                    if (u.isBlank() || !seen.add(u)) continue
                    val resMatch = Regex("/(\\d{3,4})x(\\d{3,4})/").find(u)
                    val w = resMatch?.groupValues?.getOrNull(1)?.toIntOrNull() ?: fallbackW
                    val h = resMatch?.groupValues?.getOrNull(2)?.toIntOrNull() ?: fallbackH
                    val kbps = v.optInt("bitrate", 0).takeIf { it > 0 }?.let { (it / 1000.0).roundToInt() }
                    val fmt = when {
                        h != null -> "${h}p MP4"
                        kbps != null -> "$kbps kbps MP4"
                        else -> "MP4"
                    }
                    collected.add(
                        ExtractedCandidate(
                            url = u,
                            source = "FETCH",
                            mimeType = "video/mp4",
                            format = fmt,
                            width = w,
                            height = h,
                            bitrate = kbps
                        )
                    )
                }

                val primaryUrl = video.optString("url")
                if (primaryUrl.isNotBlank() && seen.add(primaryUrl)) {
                    val isM3u8 = primaryUrl.contains(".m3u8")
                    collected.add(
                        ExtractedCandidate(
                            url = primaryUrl,
                            source = "FETCH",
                            mimeType = if (isM3u8) "application/vnd.apple.mpegurl" else "video/mp4",
                            format = if (isM3u8) "HLS Stream" else fallbackH?.let { "${it}p MP4" } ?: "MP4",
                            width = fallbackW,
                            height = fallbackH
                        )
                    )
                }

                if (collected.isNotEmpty()) {
                    val author = tweet.optJSONObject("author")?.optString("screen_name").orEmpty()
                    val text = tweet.optString("text")
                    val prefix = if (author.isNotBlank()) "@$author" else "X"
                    val title = if (text.isNotBlank()) "$prefix: ${text.take(72)}" else "X Video $id"
                    val thumb = video.optString("thumbnail_url").takeIf { it.isNotBlank() }
                    val durMs = video.optDouble("duration", 0.0).takeIf { it > 0.0 }?.let { (it * 1000.0).roundToInt() }
                    val itemsJson = JSONArray().apply { collected.forEach { put(it.toJson()) } }
                    return JSONObject()
                        .put("ok", true)
                        .put("finalUrl", effectiveUrl)
                        .put("title", title)
                        .put("thumbnail", thumb ?: JSONObject.NULL)
                        .put("durationMs", durMs ?: JSONObject.NULL)
                        .put("items", itemsJson)
                }
            }
        }

        // Strategy 2: VxTwitter API
        val vxResult = try { vxFuture.get(9, TimeUnit.SECONDS) } catch (_: Exception) { null }
        vxResult?.let { vx ->
            val mediaExt = vx.optJSONArray("media_extended")
            if (mediaExt != null && mediaExt.length() > 0) {
                val items = ArrayList<ExtractedCandidate>()
                var thumb: String? = null
                var durMs: Int? = null
                for (i in 0 until mediaExt.length()) {
                    val m = mediaExt.optJSONObject(i) ?: continue
                    val type = m.optString("type")
                    val u = m.optString("url")
                    if ((type == "video" || type == "gif") && u.isNotBlank()) {
                        if (thumb == null) thumb = m.optString("thumbnail_url").takeIf { it.isNotBlank() }
                        if (durMs == null) durMs = m.optInt("duration_millis", 0).takeIf { it > 0 }
                        val sz = m.optJSONObject("size")
                        val w = sz?.optInt("width", 0)?.takeIf { it > 0 }
                        val h = sz?.optInt("height", 0)?.takeIf { it > 0 }
                        items.add(
                            ExtractedCandidate(
                                url = u,
                                source = "FETCH",
                                mimeType = if (u.contains(".m3u8")) "application/vnd.apple.mpegurl" else "video/mp4",
                                format = h?.let { "${it}p MP4" } ?: "MP4",
                                width = w,
                                height = h
                            )
                        )
                    }
                }
                if (items.isNotEmpty()) {
                    val author = vx.optString("user_screen_name")
                    val text = vx.optString("text")
                    val prefix = if (author.isNotBlank()) "@$author" else "X"
                    val title = if (text.isNotBlank()) "$prefix: ${text.take(72)}" else "X Video $id"
                    val arr = JSONArray().apply { items.forEach { put(it.toJson()) } }
                    return JSONObject()
                        .put("ok", true)
                        .put("finalUrl", effectiveUrl)
                        .put("title", title)
                        .put("thumbnail", thumb ?: JSONObject.NULL)
                        .put("durationMs", durMs ?: JSONObject.NULL)
                        .put("items", arr)
                }
            }
        }

        // Strategy 3: Official Twitter public syndication endpoint
        val synResult = try { synFuture.get(9, TimeUnit.SECONDS) } catch (_: Exception) { null }
        synResult?.let { syn ->
            val collected = ArrayList<ExtractedCandidate>()
            val seen = HashSet<String>()
            val videoObj = syn.optJSONObject("video")
            val variants = videoObj?.optJSONArray("variants")
            if (variants != null) {
                for (i in 0 until variants.length()) {
                    val v = variants.optJSONObject(i) ?: continue
                    val u = v.optString("src")
                    if (u.isBlank() || !seen.add(u)) continue
                    val ct = v.optString("type").takeIf { it.isNotBlank() }
                    val resMatch = Regex("/(\\d{3,4})x(\\d{3,4})/").find(u)
                    val w = resMatch?.groupValues?.getOrNull(1)?.toIntOrNull()
                    val h = resMatch?.groupValues?.getOrNull(2)?.toIntOrNull()
                    collected.add(
                        ExtractedCandidate(
                            url = u,
                            source = "FETCH",
                            mimeType = ct ?: if (u.contains(".m3u8")) "application/vnd.apple.mpegurl" else "video/mp4",
                            format = h?.let { "${it}p MP4" } ?: if (u.contains(".m3u8")) "HLS" else "MP4",
                            width = w,
                            height = h
                        )
                    )
                }
            }
            val mediaDetails = syn.optJSONArray("mediaDetails")
            if (mediaDetails != null) {
                for (i in 0 until mediaDetails.length()) {
                    val md = mediaDetails.optJSONObject(i) ?: continue
                    val vars = md.optJSONObject("video_info")?.optJSONArray("variants") ?: continue
                    for (j in 0 until vars.length()) {
                        val v = vars.optJSONObject(j) ?: continue
                        val u = v.optString("url")
                        if (u.isBlank() || !seen.add(u)) continue
                        val resMatch = Regex("/(\\d{3,4})x(\\d{3,4})/").find(u)
                        val w = resMatch?.groupValues?.getOrNull(1)?.toIntOrNull()
                        val h = resMatch?.groupValues?.getOrNull(2)?.toIntOrNull()
                        val kbps = v.optInt("bitrate", 0).takeIf { it > 0 }?.let { (it / 1000.0).roundToInt() }
                        collected.add(
                            ExtractedCandidate(
                                url = u,
                                source = "FETCH",
                                mimeType = v.optString("content_type").takeIf { it.isNotBlank() } ?: "video/mp4",
                                format = h?.let { "${it}p MP4" } ?: if (u.contains(".m3u8")) "HLS" else "MP4",
                                width = w,
                                height = h,
                                bitrate = kbps
                            )
                        )
                    }
                }
            }
            if (collected.isNotEmpty()) {
                collected.sortWith(compareByDescending<ExtractedCandidate> { it.height ?: 0 }.thenByDescending { it.bitrate ?: 0 })
                val author = syn.optJSONObject("user")?.optString("screen_name").orEmpty()
                val text = syn.optString("text")
                val prefix = if (author.isNotBlank()) "@$author" else "X"
                val title = if (text.isNotBlank()) "$prefix: ${text.take(72)}" else "X Video $id"
                val thumb = videoObj?.optString("poster")?.takeIf { it.isNotBlank() }
                val durMs = videoObj?.optInt("durationMs", 0)?.takeIf { it > 0 }
                val arr = JSONArray().apply { collected.forEach { put(it.toJson()) } }
                return JSONObject()
                    .put("ok", true)
                    .put("finalUrl", effectiveUrl)
                    .put("title", title)
                    .put("thumbnail", thumb ?: JSONObject.NULL)
                    .put("durationMs", durMs ?: JSONObject.NULL)
                    .put("items", arr)
            }
        }
        return null
    }

    private fun extractInstagram(pattern: LinkPatternMatch): JSONObject? {
        val shortcode = pattern.mediaId
        val kind = if (pattern.mediaSubKind == "p" || pattern.mediaSubKind == "tv") pattern.mediaSubKind else "reel"
        val found = LinkedHashMap<String, ExtractedCandidate>()
        var title = "Instagram ${shortcode.orEmpty()}".trim()
        var thumbnail: String? = null

        val candidateUrls = ArrayList<String>()
        if (!shortcode.isNullOrBlank()) {
            candidateUrls.add("https://www.instagram.com/$kind/$shortcode/embed/captioned/")
            candidateUrls.add("https://www.instagram.com/p/$shortcode/embed/captioned/")
            candidateUrls.add("https://www.instagram.com/$kind/$shortcode/?__a=1&__d=dis")
        }
        candidateUrls.add(pattern.canonicalUrl)
        if (!shortcode.isNullOrBlank()) {
            candidateUrls.add("https://d.ddinstagram.com/$kind/$shortcode")
        }

        val futures = candidateUrls.map { probeUrl ->
            probePool.submit(Callable<Pair<String, String>?> {
                val ua = if (probeUrl.contains("ddinstagram")) "TelegramBot (like TwitterBot)" else MOBILE_UA
                fetchText(
                    probeUrl,
                    mapOf(
                        "User-Agent" to ua,
                        "Accept" to "text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8",
                        "Accept-Language" to "en-US,en;q=0.9",
                        "Sec-Fetch-Site" to "none",
                        "Sec-Fetch-Mode" to "navigate"
                    )
                )
            })
        }

        for (future in futures) {
            val res = try {
                future.get(9, TimeUnit.SECONDS)
            } catch (_: Exception) {
                null
            } ?: continue
            val (finalUrl, body) = res
            if (body.isBlank()) continue

            if (!body.trimStart().startsWith("{")) {
                val parsedTitle = parseTitleFromHtml(body, finalUrl)
                if (!parsedTitle.lowercase(Locale.US).contains("instagram")) title = parsedTitle
                if (thumbnail == null) thumbnail = parseThumbFromHtml(body, finalUrl)
            }
            collectUrlsFromHtml(body, finalUrl, found)
        }

        if (found.isNotEmpty()) {
            val sorted = found.values.sortedByDescending { it.height ?: 0 }
            val arr = JSONArray().apply { sorted.forEach { put(it.toJson()) } }
            return JSONObject()
                .put("ok", true)
                .put("finalUrl", pattern.canonicalUrl)
                .put("title", title)
                .put("thumbnail", thumbnail ?: JSONObject.NULL)
                .put("items", arr)
        }
        return null
    }

    private fun extractTikTok(pattern: LinkPatternMatch): JSONObject? {
        val found = LinkedHashMap<String, ExtractedCandidate>()
        var finalUrl = pattern.canonicalUrl
        var title = "TikTok Video"
        var thumbnail: String? = null

        fetchText(
            pattern.canonicalUrl,
            mapOf(
                "User-Agent" to DESKTOP_UA,
                "Accept" to "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Language" to "en-US,en;q=0.9"
            )
        )?.let { (resUrl, body) ->
            finalUrl = resUrl
            if (body.isNotBlank()) {
                title = parseTitleFromHtml(body, finalUrl)
                thumbnail = parseThumbFromHtml(body, finalUrl)
                collectUrlsFromHtml(body, finalUrl, found)
            }
        }

        if (found.isEmpty()) {
            val encoded = LinkPatternDetector.encodeQueryComponent(finalUrl)
            fetchJson("https://www.tikwm.com/api/?url=$encoded&hd=1", mapOf("User-Agent" to "SalviaBrowxer/1.0", "Accept" to "application/json"))?.let { res ->
                if (res.optInt("code", -1) == 0) {
                    val d = res.optJSONObject("data")
                    if (d != null) {
                        d.optString("title").takeIf { it.isNotBlank() }?.let { title = it }
                        d.optString("cover").takeIf { it.isNotBlank() }?.let { thumbnail = it }
                        d.optString("hdplay").takeIf { it.isNotBlank() }?.let { u ->
                            found[u] = ExtractedCandidate(u, "FETCH", "video/mp4", "HD MP4 (No Watermark)", height = 1080)
                        }
                        d.optString("play").takeIf { it.isNotBlank() && !found.containsKey(it) }?.let { u ->
                            found[u] = ExtractedCandidate(u, "FETCH", "video/mp4", "SD MP4 (No Watermark)", height = 720)
                        }
                        d.optString("music").takeIf { it.isNotBlank() && !found.containsKey(it) }?.let { u ->
                            found[u] = ExtractedCandidate(u, "FETCH", "audio/mpeg", "Audio MP3")
                        }
                    }
                }
            }
        }

        if (found.isEmpty()) return null
        val arr = JSONArray().apply { found.values.forEach { put(it.toJson()) } }
        return JSONObject()
            .put("ok", true)
            .put("finalUrl", finalUrl)
            .put("title", title)
            .put("thumbnail", thumbnail ?: JSONObject.NULL)
            .put("items", arr)
    }

    private fun extractFacebook(pattern: LinkPatternMatch): JSONObject? {
        val found = LinkedHashMap<String, ExtractedCandidate>()
        var finalUrl = pattern.canonicalUrl
        var title = "Facebook Video"
        var thumbnail: String? = null

        fetchText(
            pattern.canonicalUrl,
            mapOf(
                "User-Agent" to DESKTOP_UA,
                "Accept" to "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Language" to "en-US,en;q=0.9",
                "Sec-Fetch-Site" to "none",
                "Sec-Fetch-Mode" to "navigate"
            )
        )?.let { (resUrl, body) ->
            finalUrl = resUrl
            if (body.isNotBlank()) {
                title = parseTitleFromHtml(body, finalUrl)
                thumbnail = parseThumbFromHtml(body, finalUrl)
                collectUrlsFromHtml(body, finalUrl, found)
            }
        }

        if (found.isEmpty()) return null
        val arr = JSONArray().apply { found.values.forEach { put(it.toJson()) } }
        return JSONObject()
            .put("ok", true)
            .put("finalUrl", finalUrl)
            .put("title", title)
            .put("thumbnail", thumbnail ?: JSONObject.NULL)
            .put("items", arr)
    }

    private fun extractReddit(pattern: LinkPatternMatch): JSONObject? {
        val parsed = URI(pattern.canonicalUrl)
        val cleanPath = parsed.path.orEmpty().trimEnd('/')
        val jsonUrl = "${parsed.scheme}://${parsed.rawAuthority}$cleanPath.json"
        val raw = fetchText(jsonUrl, mapOf("User-Agent" to "SalviaBrowxer/1.0 (media resolver)", "Accept" to "application/json"))?.second ?: return null
        val listing = JSONArray(raw)
        val postData = listing.optJSONObject(0)
            ?.optJSONObject("data")
            ?.optJSONArray("children")
            ?.optJSONObject(0)
            ?.optJSONObject("data") ?: return null
        val rv = postData.optJSONObject("secure_media")?.optJSONObject("reddit_video")
            ?: postData.optJSONArray("crosspost_parent_list")?.optJSONObject(0)?.optJSONObject("secure_media")?.optJSONObject("reddit_video")
            ?: return null

        val items = ArrayList<ExtractedCandidate>()
        val hls = rv.optString("hls_url")
        val h = rv.optInt("height", 0).takeIf { it > 0 }
        val w = rv.optInt("width", 0).takeIf { it > 0 }
        if (hls.isNotBlank()) {
            items.add(
                ExtractedCandidate(
                    url = hls,
                    source = "FETCH",
                    mimeType = "application/vnd.apple.mpegurl",
                    format = h?.let { "${it}p HLS (Video + Audio)" } ?: "HLS (Video + Audio)",
                    width = w,
                    height = h
                )
            )
        }
        val fallback = rv.optString("fallback_url")
        if (fallback.isNotBlank()) {
            val clean = fallback.substringBefore('?')
            val baseDir = clean.substringBeforeLast('/')
            val audioCandidate = "$baseDir/DASH_AUDIO_128.mp4"
            items.add(
                ExtractedCandidate(
                    url = fallback,
                    source = "FETCH",
                    mimeType = "video/mp4",
                    format = h?.let { "${it}p MP4" } ?: "MP4",
                    width = w,
                    height = h,
                    audioTrackUrl = audioCandidate
                )
            )
        }

        if (items.isEmpty()) return null
        val arr = JSONArray().apply { items.forEach { put(it.toJson()) } }
        val thumb = postData.optString("thumbnail").takeIf { it.startsWith("http") }
        val dur = rv.optInt("duration", 0).takeIf { it > 0 }?.times(1000)
        return JSONObject()
            .put("ok", true)
            .put("finalUrl", pattern.canonicalUrl)
            .put("title", postData.optString("title").ifBlank { "Reddit Video" })
            .put("thumbnail", thumb ?: JSONObject.NULL)
            .put("durationMs", dur ?: JSONObject.NULL)
            .put("items", arr)
    }

    private fun extractVimeo(pattern: LinkPatternMatch): JSONObject? {
        val id = pattern.mediaId?.takeIf { it.isNotBlank() } ?: return null
        val config = fetchJson(
            "https://player.vimeo.com/video/$id/config",
            mapOf("User-Agent" to DESKTOP_UA, "Referer" to "https://vimeo.com/", "Accept" to "application/json")
        ) ?: return null
        val files = config.optJSONObject("request")?.optJSONObject("files") ?: return null
        val items = ArrayList<ExtractedCandidate>()
        val progArr = files.optJSONArray("progressive")
        if (progArr != null) {
            val list = ArrayList<JSONObject>()
            for (i in 0 until progArr.length()) list.add(progArr.getJSONObject(i))
            list.sortByDescending { it.optInt("height", 0) }
            for (p in list) {
                val u = p.optString("url")
                if (u.isBlank()) continue
                val h = p.optInt("height", 0).takeIf { it > 0 }
                val w = p.optInt("width", 0).takeIf { it > 0 }
                items.add(
                    ExtractedCandidate(
                        url = u,
                        source = "FETCH",
                        mimeType = p.optString("mime").ifBlank { "video/mp4" },
                        format = h?.let { "${it}p MP4" } ?: p.optString("quality").ifBlank { "MP4" },
                        width = w,
                        height = h
                    )
                )
            }
        }
        val hls = files.optJSONObject("hls")
        val defCdn = hls?.optString("default_cdn")
        val cdns = hls?.optJSONObject("cdns")
        val hlsUrl = defCdn?.takeIf { it.isNotBlank() }?.let { cdns?.optJSONObject(it)?.optString("url") }
        if (!hlsUrl.isNullOrBlank()) {
            items.add(ExtractedCandidate(hlsUrl, "FETCH", "application/vnd.apple.mpegurl", "HLS Adaptive"))
        }
        if (items.isEmpty()) return null
        val videoObj = config.optJSONObject("video")
        val thumb = videoObj?.optJSONObject("thumbs")?.optString("base")?.takeIf { it.isNotBlank() }
        val dur = videoObj?.optInt("duration", 0)?.takeIf { it > 0 }?.times(1000)
        val arr = JSONArray().apply { items.forEach { put(it.toJson()) } }
        return JSONObject()
            .put("ok", true)
            .put("finalUrl", pattern.canonicalUrl)
            .put("title", videoObj?.optString("title").orEmpty().ifBlank { "Vimeo $id" })
            .put("thumbnail", thumb ?: JSONObject.NULL)
            .put("durationMs", dur ?: JSONObject.NULL)
            .put("items", arr)
    }

    private fun extractDailymotion(pattern: LinkPatternMatch): JSONObject? {
        val id = pattern.mediaId?.takeIf { it.isNotBlank() } ?: return null
        val meta = fetchJson(
            "https://www.dailymotion.com/player/metadata/video/$id",
            mapOf("User-Agent" to DESKTOP_UA, "Accept" to "application/json")
        ) ?: return null
        val qualities = meta.optJSONObject("qualities") ?: return null
        val items = ArrayList<ExtractedCandidate>()
        val seen = HashSet<String>()
        val keys = qualities.keys()
        while (keys.hasNext()) {
            val qKey = keys.next()
            val arr = qualities.optJSONArray(qKey) ?: continue
            for (i in 0 until arr.length()) {
                val entry = arr.optJSONObject(i) ?: continue
                val u = entry.optString("url")
                if (u.isBlank() || !seen.add(u)) continue
                val h = qKey.toIntOrNull()
                items.add(
                    ExtractedCandidate(
                        url = u,
                        source = "FETCH",
                        mimeType = entry.optString("type").takeIf { it.isNotBlank() }
                            ?: if (u.contains(".m3u8")) "application/vnd.apple.mpegurl" else "video/mp4",
                        format = h?.let { "${it}p" } ?: qKey.uppercase(Locale.US),
                        height = h
                    )
                )
            }
        }
        if (items.isEmpty()) return null
        val arr = JSONArray().apply { items.forEach { put(it.toJson()) } }
        val posters = meta.optJSONObject("posters")
        var thumb: String? = null
        posters?.keys()?.forEach { thumb = posters.optString(it).takeIf { s -> s.isNotBlank() } ?: thumb }
        val dur = meta.optInt("duration", 0).takeIf { it > 0 }?.times(1000)
        return JSONObject()
            .put("ok", true)
            .put("finalUrl", pattern.canonicalUrl)
            .put("title", meta.optString("title").ifBlank { "Dailymotion $id" })
            .put("thumbnail", thumb ?: JSONObject.NULL)
            .put("durationMs", dur ?: JSONObject.NULL)
            .put("items", arr)
    }

    private fun extractStreamable(pattern: LinkPatternMatch): JSONObject? {
        val id = pattern.mediaId?.takeIf { it.isNotBlank() } ?: return null
        val data = fetchJson(
            "https://api.streamable.com/videos/$id",
            mapOf("User-Agent" to DESKTOP_UA, "Accept" to "application/json")
        ) ?: return null
        val files = data.optJSONObject("files") ?: return null
        val items = ArrayList<ExtractedCandidate>()
        val keys = files.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val f = files.optJSONObject(key) ?: continue
            val rawUrl = f.optString("url")
            if (rawUrl.isBlank()) continue
            val abs = if (rawUrl.startsWith("//")) "https:$rawUrl" else rawUrl
            val h = f.optInt("height", 0).takeIf { it > 0 }
            val w = f.optInt("width", 0).takeIf { it > 0 }
            val kbps = f.optInt("bitrate", 0).takeIf { it > 0 }?.let { (it / 1000.0).roundToInt() }
            items.add(
                ExtractedCandidate(
                    url = abs,
                    source = "FETCH",
                    mimeType = "video/mp4",
                    format = h?.let { "${it}p MP4 ($key)" } ?: key.uppercase(Locale.US),
                    width = w,
                    height = h,
                    bitrate = kbps
                )
            )
        }
        if (items.isEmpty()) return null
        items.sortByDescending { it.height ?: 0 }
        val arr = JSONArray().apply { items.forEach { put(it.toJson()) } }
        val rawThumb = data.optString("thumbnail_url").takeIf { it.isNotBlank() }
        val thumb = rawThumb?.let { if (it.startsWith("//")) "https:$it" else it }
        return JSONObject()
            .put("ok", true)
            .put("finalUrl", pattern.canonicalUrl)
            .put("title", data.optString("title").ifBlank { "Streamable $id" })
            .put("thumbnail", thumb ?: JSONObject.NULL)
            .put("items", arr)
    }

    private fun fetchJson(url: String, headers: Map<String, String>): JSONObject? {
        val (_, text) = fetchText(url, headers) ?: return null
        if (text.isBlank()) return null
        return try {
            JSONObject(text)
        } catch (_: Exception) {
            null
        }
    }

    private fun fetchText(url: String, headers: Map<String, String>): Pair<String, String>? {
        val builder = Request.Builder().url(url)
        for ((k, v) in headers) builder.header(k, v)
        return try {
            httpClient.newCall(builder.build()).execute().use { res ->
                if (!res.isSuccessful) return null
                val finalUrl = res.request.url.toString()
                val body = readBoundedText(res.body)
                finalUrl to body
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun syndicationTokenForTweetId(tweetId: String): String {
        val num = tweetId.toDoubleOrNull() ?: return "0"
        val value = (num / 1e15) * PI
        val intPart = value.toLong()
        val fracPart = ((value - intPart) * 1e9).toLong()
        return "${intPart.toString(36)}${fracPart.toString(36)}".replace("0", "")
    }

    private fun unescapeEmbeddedText(raw: String): String {
        return raw
            .replace("\\u002F", "/", ignoreCase = true)
            .replace("\\u0026", "&", ignoreCase = true)
            .replace("\\u003D", "=", ignoreCase = true)
            .replace("\\u003F", "?", ignoreCase = true)
            .replace("\\u0025", "%", ignoreCase = true)
            .replace("\\u003C", "<", ignoreCase = true)
            .replace("\\u003E", ">", ignoreCase = true)
            .replace("\\x2F", "/", ignoreCase = true)
            .replace("\\x3A", ":", ignoreCase = true)
            .replace("\\x26", "&", ignoreCase = true)
            .replace("\\x3D", "=", ignoreCase = true)
            .replace("\\x3F", "?", ignoreCase = true)
            .replace("\\/", "/")
            .replace("&#x2F;", "/", ignoreCase = true)
            .replace("&#38;", "&")
            .replace("&amp;", "&", ignoreCase = true)
            .replace("&quot;", "\"", ignoreCase = true)
            .replace("&#039;", "'")
            .replace("&#39;", "'")
            .replace("&#x27;", "'", ignoreCase = true)
    }

    private fun parseTitleFromHtml(html: String, finalUrl: String): String {
        val titleMatch = Regex("<title[^>]*>([^<]*)</title>", RegexOption.IGNORE_CASE).find(html)
        return titleMatch?.groupValues?.getOrNull(1)?.let { unescapeEmbeddedText(it).trim() }.orEmpty()
            .ifEmpty {
                try {
                    URI(finalUrl).host ?: finalUrl
                } catch (_: Exception) {
                    finalUrl
                }
            }
    }

    private fun parseThumbFromHtml(html: String, finalUrl: String): String? {
        val thumbMatch = Regex(
            "<meta[^>]+(?:property=[\"']og:image[\"']|name=[\"']twitter:image[\"'])[^>]+content=[\"']([^\"']+)[\"']",
            RegexOption.IGNORE_CASE
        ).find(html) ?: return null
        val raw = unescapeEmbeddedText(thumbMatch.groupValues[1])
        return try {
            URI(finalUrl).resolve(raw).toString()
        } catch (_: Exception) {
            null
        }
    }

    private fun collectUrlsFromHtml(html: String, baseUrl: String, out: MutableMap<String, ExtractedCandidate>) {
        val unescaped = unescapeEmbeddedText(html)
        val base = try {
            URI(baseUrl)
        } catch (_: Exception) {
            null
        }

        fun add(raw: String, source: String, mimeType: String? = null, format: String? = null) {
            val resolved = try {
                base?.resolve(raw)?.toString() ?: raw
            } catch (_: Exception) {
                return
            }
            if (!resolved.startsWith("http://", ignoreCase = true) && !resolved.startsWith("https://", ignoreCase = true)) return
            if (LinkPatternDetector.isYouTubeUrl(resolved)) return
            if (!out.containsKey(resolved)) {
                out[resolved] = ExtractedCandidate(resolved, source, mimeType, format)
            }
        }

        val directRegex = Regex(
            "https?://[^\\s\"'<>\\\\]+\\.(?:mp4|webm|mov|m4v|m3u8|mpd|mp3|m4a)(?:\\?[^\\s\"'<>\\\\]*)?",
            RegexOption.IGNORE_CASE
        )
        for (match in directRegex.findAll(unescaped)) {
            add(match.value, "JS")
        }

        val keyRegex = Regex(
            "\"(?:contentUrl|playbackUrl|playable_url(?:_quality_hd)?|browser_native_hd_url|browser_native_sd_url|hd_src(?:_no_ratelimit)?|sd_src(?:_no_ratelimit)?|video_url|video_hls_url|playAddr|downloadAddr|fallback_url|hls_url|hls_manifest_url|dash_url|dashManifestUrl|playlistUrl|manifestUrl|streamUrl|mediaUrl|hdUrl|sdUrl|mp4_url|file|src)\"\\s*:\\s*\"(https?://[^\"]+)\"",
            RegexOption.IGNORE_CASE
        )
        for (match in keyRegex.findAll(unescaped)) {
            val k = match.value.lowercase(Locale.US)
            val fmt = when {
                k.contains("hd") -> "HD MP4"
                k.contains("sd") -> "SD MP4"
                else -> null
            }
            add(match.groupValues[1], "DOM", format = fmt)
        }

        // Instagram / Meta video_versions entries
        val igVersionRegex = Regex(
            "\"width\"\\s*:\\s*(\\d+)\\s*,\\s*\"height\"\\s*:\\s*(\\d+)\\s*,\\s*\"url\"\\s*:\\s*\"(https?://[^\"]+)\"",
            RegexOption.IGNORE_CASE
        )
        for (match in igVersionRegex.findAll(unescaped)) {
            val w = match.groupValues[1].toIntOrNull()
            val h = match.groupValues[2].toIntOrNull()
            val u = match.groupValues[3]
            if (u.contains(".mp4") || u.contains("cdninstagram") || u.contains("fbcdn")) {
                val abs = try {
                    base?.resolve(u)?.toString() ?: u
                } catch (_: Exception) {
                    continue
                }
                if (!LinkPatternDetector.isYouTubeUrl(abs) && !out.containsKey(abs)) {
                    out[abs] = ExtractedCandidate(
                        url = abs,
                        source = "DOM",
                        mimeType = "video/mp4",
                        format = if (h != null && h > 0) "${h}p MP4" else "MP4",
                        width = w,
                        height = h
                    )
                }
            }
        }

        val tagRegex = Regex("<(?:source|video|audio)\\b[^>]+\\b(?:src|data-src|data-video-src|data-mp4|data-hls)=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
        for (match in tagRegex.findAll(unescaped)) {
            add(match.groupValues[1], "DOM")
        }

        val ogVideoRegex = Regex(
            "<meta[^>]+(?:property=[\"']og:video(?::url|:secure_url)?[\"']|name=[\"']twitter:player:stream[\"'])[^>]+content=[\"']([^\"']+)[\"']",
            RegexOption.IGNORE_CASE
        )
        for (match in ogVideoRegex.findAll(unescaped)) {
            add(match.groupValues[1], "DOM", mimeType = "video/mp4")
        }
    }

    private fun handleFetch(uri: Uri, webRequest: WebResourceRequest): WebResourceResponse {
        val target = validateRemoteUrl(uri.getQueryParameter("url"))
            ?: return jsonResponse(400, JSONObject().put("error", "Invalid or restricted URL"))
        val referer = uri.getQueryParameter("referer")

        return try {
            val reqBuilder = Request.Builder()
                .url(target)
                .header("User-Agent", MOBILE_UA)
            attachReferer(reqBuilder, referer)
            val rangeHeader = webRequest.requestHeaders?.entries
                ?.firstOrNull { it.key.equals("Range", ignoreCase = true) }
                ?.value
            if (!rangeHeader.isNullOrBlank()) {
                reqBuilder.header("Range", rangeHeader)
            }

            val response = httpClient.newCall(reqBuilder.build()).execute()
            val body = response.body
            if (body == null) {
                val status = response.code
                val msg = response.message.ifEmpty { "OK" }
                response.close()
                return WebResourceResponse("application/octet-stream", null, status, msg, corsHeaders(), ByteArrayInputStream(ByteArray(0)))
            }

            val ct = response.header("Content-Type")?.substringBefore(';')?.trim() ?: "application/octet-stream"
            val headers = corsHeaders().toMutableMap()
            response.header("Content-Length")?.let { headers["Content-Length"] = it }
            response.header("Content-Range")?.let { headers["Content-Range"] = it }
            response.header("Accept-Ranges")?.let { headers["Accept-Ranges"] = it }

            val stream: InputStream = object : FilterInputStream(body.byteStream()) {
                override fun close() {
                    try {
                        super.close()
                    } finally {
                        response.close()
                    }
                }
            }

            WebResourceResponse(
                ct,
                null,
                response.code,
                response.message.ifEmpty { "OK" },
                headers,
                stream
            )
        } catch (e: Exception) {
            jsonResponse(502, JSONObject().put("error", e.message ?: "Fetch proxy failed"))
        }
    }

    private fun handleLocalFile(context: Context, uri: Uri, webRequest: WebResourceRequest): WebResourceResponse {
        val id = uri.getQueryParameter("id")?.replace(Regex("[^a-zA-Z0-9._-]"), "")
            ?: return jsonResponse(400, JSONObject().put("error", "Missing file id"))
        val mime = uri.getQueryParameter("mime")?.takeIf { it.isNotBlank() } ?: "video/mp4"
        val downloadsDir = File(context.filesDir, "downloads")
        val targetFile = File(downloadsDir, id)
        if (!targetFile.canonicalPath.startsWith(downloadsDir.canonicalPath) || !targetFile.exists()) {
            return jsonResponse(404, JSONObject().put("error", "Local file not found"))
        }

        val totalLen = targetFile.length()
        val rangeHeader = webRequest.requestHeaders?.entries
            ?.firstOrNull { it.key.equals("Range", ignoreCase = true) }
            ?.value

        val headers = corsHeaders().toMutableMap()
        headers["Accept-Ranges"] = "bytes"

        if (!rangeHeader.isNullOrBlank() && rangeHeader.startsWith("bytes=")) {
            val spec = rangeHeader.removePrefix("bytes=").split("-", limit = 2)
            val start = spec.getOrNull(0)?.toLongOrNull() ?: 0L
            val end = spec.getOrNull(1)?.toLongOrNull()?.coerceAtMost(totalLen - 1L) ?: (totalLen - 1L)
            if (start in 0 until totalLen && end >= start) {
                val length = end - start + 1L
                headers["Content-Range"] = "bytes $start-$end/$totalLen"
                headers["Content-Length"] = length.toString()
                val raf = RandomAccessFile(targetFile, "r")
                raf.seek(start)
                val boundedStream = object : InputStream() {
                    var remaining = length
                    override fun read(): Int {
                        if (remaining <= 0) return -1
                        val b = raf.read()
                        if (b >= 0) remaining--
                        return b
                    }

                    override fun read(b: ByteArray, off: Int, len: Int): Int {
                        if (remaining <= 0) return -1
                        val toRead = minOf(len.toLong(), remaining).toInt()
                        val read = raf.read(b, off, toRead)
                        if (read > 0) remaining -= read
                        return read
                    }

                    override fun close() {
                        raf.close()
                    }
                }
                return WebResourceResponse(mime, null, 206, "Partial Content", headers, boundedStream)
            }
        }

        headers["Content-Length"] = totalLen.toString()
        return WebResourceResponse(mime, null, 200, "OK", headers, targetFile.inputStream())
    }

    private fun validateRemoteUrl(rawUrl: String?): String? {
        if (rawUrl.isNullOrBlank()) return null
        return try {
            val parsed = URI(rawUrl.trim())
            val scheme = parsed.scheme?.lowercase(Locale.US)
            if (scheme != "http" && scheme != "https") return null
            if (!parsed.userInfo.isNullOrEmpty()) return null
            val host = parsed.host?.lowercase(Locale.US)?.trim('[', ']') ?: return null
            if (host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0" || host.endsWith(".local")) {
                return null
            }
            if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
                return null
            }
            if (host.startsWith("172.")) {
                val second = host.split(".").getOrNull(1)?.toIntOrNull()
                if (second != null && second in 16..31) return null
            }
            try {
                val addr = InetAddress.getByName(host)
                if (addr.isLoopbackAddress || addr.isSiteLocalAddress || addr.isLinkLocalAddress) {
                    return null
                }
            } catch (_: Exception) {
                // Allow DNS resolution during actual OkHttp call if transient
            }
            parsed.toString()
        } catch (_: Exception) {
            null
        }
    }

    private fun corsHeaders(): Map<String, String> = mapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Headers" to "Range, Content-Type",
        "Access-Control-Expose-Headers" to "Content-Length, Content-Range, Accept-Ranges"
    )

    private fun jsonResponse(status: Int, body: JSONObject): WebResourceResponse {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        val headers = corsHeaders().toMutableMap()
        headers["Content-Length"] = bytes.size.toString()
        return WebResourceResponse(
            "application/json",
            "UTF-8",
            status,
            if (status < 400) "OK" else "Error",
            headers,
            ByteArrayInputStream(bytes)
        )
    }
}
