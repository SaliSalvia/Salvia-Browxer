package com.salvia.salviabrowxer.core

import java.net.URI

object AdBlockHostRules {
    private val blockedHosts = setOf(
        "doubleclick.net",
        "googleadservices.com",
        "googlesyndication.com",
        "googletagmanager.com",
        "google-analytics.com",
        "adservice.google.com",
        "pagead2.googlesyndication.com",
        "adnxs.com",
        "adsrvr.org",
        "amazon-adsystem.com",
        "casalemedia.com",
        "criteo.com",
        "criteo.net",
        "dotomi.com",
        "openx.net",
        "pubmatic.com",
        "rubiconproject.com",
        "smartadserver.com",
        "sovrn.com",
        "yieldmo.com",
        "33across.com",
        "adform.net",
        "bidswitch.net",
        "districtm.io",
        "sharethrough.com",
        "teads.tv",
        "gumgum.com",
        "inmobi.com",
        "ironsrc.com",
        "smaato.net",
        "vungle.com",
        "applovin.com",
        "taboola.com",
        "outbrain.com",
        "revcontent.com",
        "mgid.com",
        "aniview.com",
        "spotxchange.com",
        "springserve.com",
        "scorecardresearch.com",
        "quantserve.com",
        "moatads.com",
        "hotjar.com",
        "mixpanel.com",
        "amplitude.com",
        "segment.com",
        "segment.io",
        "branch.io",
        "adjust.com",
        "appsflyer.com",
        "newrelic.com",
        "bugsnag.com",
        "sentry.io"
    )

    private val unblockableHosts = setOf(
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "appassets.androidplatform.net"
    )

    private val mediaUrlExtRe = Regex(
        "\\.(mp4|m4v|mov|webm|m3u8|mpd|ts|m4s|mp3|m4a|aac|ogg)(?:[?#]|$)",
        RegexOption.IGNORE_CASE
    )

    fun isBlockedHost(host: String?): Boolean {
        val h = host?.trim()?.lowercase()?.trimEnd('.') ?: return false
        if (h.isEmpty() || h in unblockableHosts) return false
        return blockedHosts.any { domain -> h == domain || h.endsWith(".$domain") }
    }

    fun isBlockedUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        if (mediaUrlExtRe.containsMatchIn(url)) return false
        return try {
            val host = URI(url).host
            isBlockedHost(host)
        } catch (_: Exception) {
            false
        }
    }
}
