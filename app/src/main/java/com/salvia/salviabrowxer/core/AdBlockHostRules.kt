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
        "adnxs.com",
        "adsrvr.org",
        "amazon-adsystem.com",
        "criteo.com",
        "criteo.net",
        "openx.net",
        "pubmatic.com",
        "rubiconproject.com",
        "taboola.com",
        "outbrain.com",
        "scorecardresearch.com",
        "quantserve.com",
        "hotjar.com",
        "mixpanel.com",
        "amplitude.com",
        "segment.io",
        "sentry.io"
    )

    fun isBlockedHost(host: String?): Boolean {
        val h = host?.trim()?.lowercase()?.trimEnd('.') ?: return false
        if (h.isEmpty()) return false
        return blockedHosts.any { domain -> h == domain || h.endsWith(".$domain") }
    }

    fun isBlockedUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        return try {
            val host = URI(url).host
            isBlockedHost(host)
        } catch (_: Exception) {
            false
        }
    }
}
