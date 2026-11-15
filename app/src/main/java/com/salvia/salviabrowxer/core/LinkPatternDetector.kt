package com.salvia.salviabrowxer.core

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

enum class LinkPatternCategory {
    YOUTUBE_EXCLUDED,
    DIRECT_MEDIA,
    PLATFORM_PAGE,
    GENERIC_PAGE
}

enum class PlatformExtractorKey {
    X_TWITTER,
    INSTAGRAM,
    TIKTOK,
    FACEBOOK,
    REDDIT,
    VIMEO,
    DAILYMOTION,
    PINTEREST,
    STREAMABLE,
    THREADS,
    TWITCH,
    SOUNDCLOUD,
    GENERIC
}

data class LinkPatternMatch(
    val rawUrl: String,
    val canonicalUrl: String,
    val hostname: String,
    val category: LinkPatternCategory,
    val platform: PlatformExtractorKey,
    val mediaId: String? = null,
    val mediaSubKind: String? = null,
    val inferredExtension: String? = null,
    val inferredMime: String? = null,
    val isCdnDirect: Boolean = false
)

object LinkPatternDetector {
    private val YOUTUBE_HOST_RE =
        Regex("(?:^|\\.)(?:youtube\\.com|youtu\\.be|youtube-nocookie\\.com|googlevideo\\.com)$", RegexOption.IGNORE_CASE)

    private val DIRECT_EXT_RE =
        Regex("\\.(mp4|m4v|mov|webm|mkv|avi|flv|3gp|3g2|ts|m3u8|mpd|mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav)(?:[?#]|$)", RegexOption.IGNORE_CASE)

    private val QUERY_MEDIA_HINT_RE =
        Regex("(?:^|[?&])(?:mime|type|content_type)=((?:video|audio)(?:%2F|/)[a-z0-9.+-]+)|(?:^|[?&])(?:format|ext)=(mp4|m4v|mov|webm|m3u8|mpd|mp3|m4a|aac)\\b", RegexOption.IGNORE_CASE)

    private data class CdnRule(
        val hostRe: Regex,
        val pathRe: Regex,
        val ext: String,
        val mime: String
    )

    private val CDN_RULES = listOf(
        CdnRule(Regex("(?:^|\\.)video\\.twimg\\.com$", RegexOption.IGNORE_CASE), Regex("/(?:ext_tw_video|amplify_video|tweet_video|vid)/", RegexOption.IGNORE_CASE), "mp4", "video/mp4"),
        CdnRule(Regex("(?:^|\\.)cdninstagram\\.com$", RegexOption.IGNORE_CASE), Regex("/v/t\\d+(?:\\.[0-9-]+)*/", RegexOption.IGNORE_CASE), "mp4", "video/mp4"),
        CdnRule(Regex("(?:^|\\.)fbcdn\\.net$", RegexOption.IGNORE_CASE), Regex("/v/t\\d+(?:\\.[0-9-]+)*/", RegexOption.IGNORE_CASE), "mp4", "video/mp4"),
        CdnRule(Regex("(?:^|\\.)tiktokcdn(?:-us|-eu|-in)?\\.com$", RegexOption.IGNORE_CASE), Regex("/(?:video|play|aweme)/", RegexOption.IGNORE_CASE), "mp4", "video/mp4"),
        CdnRule(Regex("^v\\.redd\\.it$", RegexOption.IGNORE_CASE), Regex("/(?:DASH_|HLSPlaylist|CMAF_)", RegexOption.IGNORE_CASE), "mp4", "video/mp4"),
        CdnRule(Regex("(?:^|\\.)(?:vimeocdn\\.com|vod-progressive\\.akamaized\\.net)$", RegexOption.IGNORE_CASE), Regex("/"), "mp4", "video/mp4")
    )

    private val TRACKING_PARAMS = setOf(
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
        "fbclid", "igshid", "igsh", "ref_src", "ref_url", "si", "feature", "gclid",
        "mc_cid", "mc_eid", "s", "t"
    )

    private data class PlatformRule(
        val platform: PlatformExtractorKey,
        val hostRe: Regex,
        val idRe: Regex? = null,
        val kindRe: Regex? = null
    )

    private val PLATFORM_RULES = listOf(
        PlatformRule(
            PlatformExtractorKey.X_TWITTER,
            Regex("(?:^|\\.)(?:x\\.com|twitter\\.com|mobile\\.twitter\\.com|fxtwitter\\.com|vxtwitter\\.com|fixupx\\.com|t\\.co)$", RegexOption.IGNORE_CASE),
            Regex("/(?:[^/]+/status|i/(?:web/)?status)/(\\d+)", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.INSTAGRAM,
            Regex("(?:^|\\.)(?:instagram\\.com|instagr\\.am|ddinstagram\\.com)$", RegexOption.IGNORE_CASE),
            Regex("/(?:reel|reels|p|tv|stories/[^/]+)/([A-Za-z0-9_-]+)", RegexOption.IGNORE_CASE),
            Regex("/(reel|reels|p|tv|stories)/", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.TIKTOK,
            Regex("(?:^|\\.)(?:tiktok\\.com|vm\\.tiktok\\.com|vt\\.tiktok\\.com)$", RegexOption.IGNORE_CASE),
            Regex("/(?:video|v)/(\\d+)|^/([A-Za-z0-9_-]{6,})/?$", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.FACEBOOK,
            Regex("(?:^|\\.)(?:facebook\\.com|fb\\.watch|fb\\.com|mbasic\\.facebook\\.com)$", RegexOption.IGNORE_CASE),
            Regex("/(?:videos|reel|watch/?\\?v=|share/[rv])/?([A-Za-z0-9_-]+)?", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.REDDIT,
            Regex("(?:^|\\.)(?:reddit\\.com|redd\\.it|v\\.redd\\.it)$", RegexOption.IGNORE_CASE),
            Regex("/comments/([a-z0-9]+)|^/([a-z0-9]{5,})(?:/|$)", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.VIMEO,
            Regex("(?:^|\\.)(?:vimeo\\.com|player\\.vimeo\\.com)$", RegexOption.IGNORE_CASE),
            Regex("/(?:video/|channels/[^/]+/)?(\\d{5,})", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.DAILYMOTION,
            Regex("(?:^|\\.)(?:dailymotion\\.com|dai\\.ly)$", RegexOption.IGNORE_CASE),
            Regex("(?:^/|/video/)([a-z0-9]{5,})", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.PINTEREST,
            Regex("(?:^|\\.)(?:pinterest\\.[a-z.]+|pin\\.it)$", RegexOption.IGNORE_CASE),
            Regex("/pin/(\\d+)|^/([A-Za-z0-9]+)", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.STREAMABLE,
            Regex("(?:^|\\.)streamable\\.com$", RegexOption.IGNORE_CASE),
            Regex("/(?:e/)?([a-z0-9]{4,})", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.THREADS,
            Regex("(?:^|\\.)threads\\.(?:net|com)$", RegexOption.IGNORE_CASE),
            Regex("/post/([A-Za-z0-9_-]+)", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.TWITCH,
            Regex("(?:^|\\.)twitch\\.tv$", RegexOption.IGNORE_CASE),
            Regex("/videos/(\\d+)|/clip/([A-Za-z0-9_-]+)", RegexOption.IGNORE_CASE)
        ),
        PlatformRule(
            PlatformExtractorKey.SOUNDCLOUD,
            Regex("(?:^|\\.)soundcloud\\.com$", RegexOption.IGNORE_CASE)
        )
    )

    fun isYouTubeHostname(hostname: String): Boolean {
        return YOUTUBE_HOST_RE.containsMatchIn(hostname.lowercase().trimEnd('.'))
    }

    fun isYouTubeUrl(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false
        val canonical = canonicalizeUrl(rawUrl) ?: return false
        return isYouTubeHostname(canonical.host.orEmpty())
    }

    fun unwrapRedirector(uri: URI): URI {
        val host = uri.host?.lowercase().orEmpty()
        val path = uri.path.orEmpty()
        val targetParam = when {
            host == "l.instagram.com" && path.startsWith("/") -> "u"
            (host == "l.facebook.com" || host == "lm.facebook.com") && path.startsWith("/l.php") -> "u"
            host == "www.google.com" && path.startsWith("/url") -> "q"
            else -> null
        } ?: return uri

        val rawQuery = uri.rawQuery ?: return uri
        for (pair in rawQuery.split('&')) {
            val eq = pair.indexOf('=')
            val key = if (eq >= 0) pair.substring(0, eq) else pair
            if (key == targetParam && eq >= 0) {
                val decoded = try {
                    URLDecoder.decode(pair.substring(eq + 1), "UTF-8")
                } catch (_: Exception) {
                    null
                }
                if (!decoded.isNullOrBlank()) {
                    try {
                        val unwrapped = URI(decoded)
                        val scheme = unwrapped.scheme?.lowercase()
                        if ((scheme == "http" || scheme == "https") && !unwrapped.host.isNullOrBlank()) {
                            return unwrapped
                        }
                    } catch (_: Exception) {
                    }
                }
            }
        }
        return uri
    }

    fun canonicalizeUrl(rawUrl: String): URI? {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return null
        val parsed = try {
            URI(trimmed)
        } catch (_: Exception) {
            return null
        }
        val scheme = parsed.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return null
        if (parsed.host.isNullOrBlank() || !parsed.userInfo.isNullOrEmpty()) return null

        val unwrapped = unwrapRedirector(parsed)
        val host = unwrapped.host?.lowercase()?.trimEnd('.') ?: return null
        val isTwitter = host == "x.com" || host.endsWith(".x.com") || host == "twitter.com" || host.endsWith(".twitter.com")

        val rawQuery = unwrapped.rawQuery
        val rebuiltQuery = if (!rawQuery.isNullOrBlank()) {
            rawQuery.split('&')
                .filter { it.isNotEmpty() }
                .filter { pair ->
                    val eq = pair.indexOf('=')
                    val rawKey = if (eq >= 0) pair.substring(0, eq) else pair
                    val decodedKey = try {
                        URLDecoder.decode(rawKey, "UTF-8").lowercase()
                    } catch (_: Exception) {
                        rawKey.lowercase()
                    }
                    if (decodedKey == "t" && !isTwitter) {
                        true
                    } else {
                        !TRACKING_PARAMS.contains(decodedKey)
                    }
                }
                .joinToString("&")
                .ifEmpty { null }
        } else {
            null
        }

        return try {
            val basePrefix = "${unwrapped.scheme?.lowercase()}://${unwrapped.rawAuthority}"
            val rawPath = unwrapped.rawPath.orEmpty()
            val queryPart = rebuiltQuery?.let { "?$it" }.orEmpty()
            val fragPart = unwrapped.rawFragment?.let { "#$it" }.orEmpty()
            URI("$basePrefix$rawPath$queryPart$fragPart")
        } catch (_: Exception) {
            unwrapped
        }
    }

    private data class InferredMedia(val ext: String?, val mime: String?, val isCdnDirect: Boolean)

    private fun inferExtensionAndMime(uri: URI): InferredMedia {
        val full = uri.toString()
        val extMatch = DIRECT_EXT_RE.find(full)
        if (extMatch != null) {
            val ext = extMatch.groupValues[1].lowercase()
            val mime = when (ext) {
                "m3u8" -> "application/vnd.apple.mpegurl"
                "mpd" -> "application/dash+xml"
                "mp3" -> "audio/mpeg"
                "m4a", "m4b", "aac", "ogg", "oga", "opus", "flac", "wav" -> "audio/$ext"
                "mov" -> "video/quicktime"
                "mkv" -> "video/x-matroska"
                else -> "video/$ext"
            }
            return InferredMedia(ext, mime, false)
        }

        val queryMatch = QUERY_MEDIA_HINT_RE.find(full)
        if (queryMatch != null) {
            val rawMime = queryMatch.groupValues[1].takeIf { it.isNotBlank() }?.let {
                try {
                    URLDecoder.decode(it, "UTF-8").lowercase()
                } catch (_: Exception) {
                    it.lowercase()
                }
            }
            val rawExt = queryMatch.groupValues[2].takeIf { it.isNotBlank() }?.lowercase()
            val ext = rawExt ?: when {
                rawMime?.contains("mp4") == true -> "mp4"
                rawMime?.contains("webm") == true -> "webm"
                rawMime?.contains("mpegurl") == true -> "m3u8"
                rawMime?.startsWith("audio/") == true -> "m4a"
                else -> "mp4"
            }
            val mime = rawMime ?: if (ext == "m3u8") "application/vnd.apple.mpegurl" else "video/$ext"
            return InferredMedia(ext, mime, true)
        }

        val host = uri.host?.lowercase()?.trimEnd('.').orEmpty()
        val path = uri.path.orEmpty()
        for (cdn in CDN_RULES) {
            if (cdn.hostRe.containsMatchIn(host) && cdn.pathRe.containsMatchIn(path)) {
                if (host == "v.redd.it" && !Regex("/(?:DASH_|HLSPlaylist|CMAF_)", RegexOption.IGNORE_CASE).containsMatchIn(path)) {
                    continue
                }
                val pathExt = Regex("\\.([a-z0-9]{2,5})$", RegexOption.IGNORE_CASE).find(path)?.groupValues?.getOrNull(1)?.lowercase() ?: cdn.ext
                val mime = when (pathExt) {
                    "m3u8" -> "application/vnd.apple.mpegurl"
                    "mpd" -> "application/dash+xml"
                    else -> cdn.mime
                }
                return InferredMedia(pathExt, mime, true)
            }
        }

        return InferredMedia(null, null, false)
    }

    fun classify(rawUrl: String): LinkPatternMatch? {
        val canonical = canonicalizeUrl(rawUrl) ?: return null
        val canonicalStr = canonical.toString()
        val host = canonical.host?.lowercase()?.trimEnd('.').orEmpty()

        if (isYouTubeHostname(host)) {
            return LinkPatternMatch(
                rawUrl = rawUrl,
                canonicalUrl = canonicalStr,
                hostname = host,
                category = LinkPatternCategory.YOUTUBE_EXCLUDED,
                platform = PlatformExtractorKey.GENERIC,
                mediaSubKind = if (canonical.path.orEmpty().contains("/shorts/")) "shorts" else "video"
            )
        }

        val inferred = inferExtensionAndMime(canonical)
        if (inferred.ext != null && (inferred.isCdnDirect || host == "v.redd.it")) {
            return LinkPatternMatch(
                rawUrl = rawUrl,
                canonicalUrl = canonicalStr,
                hostname = host,
                category = LinkPatternCategory.DIRECT_MEDIA,
                platform = PlatformExtractorKey.GENERIC,
                inferredExtension = inferred.ext,
                inferredMime = inferred.mime,
                isCdnDirect = inferred.isCdnDirect
            )
        }

        val path = canonical.path.orEmpty()
        for (rule in PLATFORM_RULES) {
            if (rule.hostRe.containsMatchIn(host)) {
                val idMatch = rule.idRe?.let { it.find(path) ?: it.find(canonicalStr) }
                val mediaId = idMatch?.let { m ->
                    m.groupValues.getOrNull(1)?.takeIf { it.isNotEmpty() }
                        ?: m.groupValues.getOrNull(2)?.takeIf { it.isNotEmpty() }
                }
                val kindMatch = rule.kindRe?.find(path)
                val subKind = kindMatch?.groupValues?.getOrNull(1)?.lowercase()
                return LinkPatternMatch(
                    rawUrl = rawUrl,
                    canonicalUrl = canonicalStr,
                    hostname = host,
                    category = LinkPatternCategory.PLATFORM_PAGE,
                    platform = rule.platform,
                    mediaId = mediaId,
                    mediaSubKind = subKind
                )
            }
        }

        if (inferred.ext != null) {
            return LinkPatternMatch(
                rawUrl = rawUrl,
                canonicalUrl = canonicalStr,
                hostname = host,
                category = LinkPatternCategory.DIRECT_MEDIA,
                platform = PlatformExtractorKey.GENERIC,
                inferredExtension = inferred.ext,
                inferredMime = inferred.mime,
                isCdnDirect = inferred.isCdnDirect
            )
        }

        return LinkPatternMatch(
            rawUrl = rawUrl,
            canonicalUrl = canonicalStr,
            hostname = host,
            category = LinkPatternCategory.GENERIC_PAGE,
            platform = PlatformExtractorKey.GENERIC
        )
    }

    fun encodeQueryComponent(value: String): String = URLEncoder.encode(value, "UTF-8")
}
