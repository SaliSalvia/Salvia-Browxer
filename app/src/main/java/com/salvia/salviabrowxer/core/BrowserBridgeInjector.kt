package com.salvia.salviabrowxer.core

import org.json.JSONObject

object BrowserBridgeInjector {
    private val cspMetaRegex = Regex(
        "<meta[^>]+http-equiv=[\"']?Content-Security-Policy[\"']?[^>]*>",
        setOf(RegexOption.IGNORE_CASE)
    )
    private val xfoMetaRegex = Regex(
        "<meta[^>]+http-equiv=[\"']?X-Frame-Options[\"']?[^>]*>",
        setOf(RegexOption.IGNORE_CASE)
    )
    private val scriptSrcRegex = Regex(
        "<script\\b[^>]*\\bsrc=[\"']([^\"']+)[\"'][^>]*>[\\s\\S]*?</script>",
        setOf(RegexOption.IGNORE_CASE)
    )
    private val headOpenRegex = Regex("<head([^>]*)>", setOf(RegexOption.IGNORE_CASE))
    private val titleRegex = Regex("<title[^>]*>([^<]*)</title>", setOf(RegexOption.IGNORE_CASE))

    data class InjectedResult(
        val html: String,
        val title: String?,
        val blockedCount: Int
    )

    fun inject(rawHtml: String, finalUrl: String, adBlock: Boolean): InjectedResult {
        val title = titleRegex.find(rawHtml)?.groupValues?.getOrNull(1)?.trim()?.takeIf { it.isNotEmpty() }
        var blockedCount = 0
        var cleaned = rawHtml
            .replace(cspMetaRegex, "")
            .replace(xfoMetaRegex, "")

        if (adBlock) {
            cleaned = scriptSrcRegex.replace(cleaned) { match ->
                val src = match.groupValues.getOrNull(1).orEmpty()
                val resolved = try {
                    java.net.URI(finalUrl).resolve(src).toString()
                } catch (_: Exception) {
                    src
                }
                if (AdBlockHostRules.isBlockedUrl(resolved)) {
                    blockedCount++
                    "<!-- blocked by SalviaBrowxer -->"
                } else {
                    match.value
                }
            }
        }

        val escapedBase = finalUrl.replace("\"", "&quot;")
        val baseTag = "<base href=\"$escapedBase\">"
        val quotedUrl = JSONObject.quote(finalUrl)
        val bridgeScript = """
<script>
(function() {
  var PAGE_URL = $quotedUrl;
  var SEEN = Object.create(null);
  function report(type, payload) {
    try { window.parent.postMessage({ source: 'salvia-browser-bridge', type: type, payload: payload }, '*'); } catch (e) {}
  }
  function isMediaUrl(u) {
    if (!u || typeof u !== 'string' || u.startsWith('data:') || u.startsWith('javascript:')) return false;
    if (/\.(mp4|webm|mov|m4v|m3u8|mpd|mp3|m4a|aac|ogg)(\?|#|${'$'})/i.test(u)) return true;
    if (/(?:mime|type|content_type)=(?:video|audio)(?:%2F|\/)/i.test(u)) return true;
    if (/(?:^https?:\/\/)(?:[^/]*\.)?(?:video\.twimg\.com\/(?:ext_tw_video|amplify_video|tweet_video|vid)|(?:cdninstagram\.com|fbcdn\.net)\/v\/t\d+|tiktokcdn[^/]*\/(?:video|play|aweme)|v\.redd\.it\/(?:DASH_|HLSPlaylist|CMAF_)|vimeocdn\.com)/i.test(u)) return true;
    return false;
  }
  function classifyEl(el, url) {
    var ctx = '';
    var p = el;
    var depth = 0;
    while (p && depth < 6) {
      ctx += ' ' + (p.id || '') + ' ' + (p.className || '') + ' ' + (p.getAttribute ? (p.getAttribute('aria-label') || '') + ' ' + (p.getAttribute('data-testid') || '') : '');
      if (p.tagName === 'ASIDE') ctx += ' aside ';
      if (p.hasAttribute && (p.hasAttribute('data-ad') || p.hasAttribute('data-ad-slot'))) ctx += ' data_ad ';
      p = p.parentElement;
      depth++;
    }
    var lowCtx = ctx.toLowerCase();
    var lowUrl = (url || '').toLowerCase();
    var isAdUrl = /(\/ads\/|\/ad\/|preroll|pre-roll|midroll|imasdk|doubleclick|googlesyndication|vmap|\/vast|adserver|sponsor|bumper)/i.test(lowUrl);
    var isAdDom = /\b(ad-player|preroll|pre-roll|ima-ad|vast|vmap|ad-container|advertisement|sponsored|data_ad)\b/i.test(lowCtx);
    var isSugUrl = /(suggest|recommend|related|upnext|up-next|preview_clip|thumb_video)/i.test(lowUrl);
    var isSugDom = /(suggest|recommend|related|upnext|up-next|sidebar|playlist|aside)/i.test(lowCtx);
    var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    var durMs = el && Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null;
    var w = Math.round(rect.width || 0);
    var h = Math.round(rect.height || 0);
    return {
      durationMs: durMs,
      width: w,
      height: h,
      muted: Boolean(el && el.muted),
      hasControls: Boolean(el && el.controls),
      isAd: isAdUrl || isAdDom || (durMs !== null && durMs > 0 && durMs <= 15000 && Boolean(el && el.muted) && !Boolean(el && el.controls)),
      isSuggested: isSugUrl || isSugDom || (w > 0 && w < 250 && h > 0 && h < 150)
    };
  }
  function emitItems(items) {
    var fresh = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.url) continue;
      var key = it.url + '|' + (it.durationMs || 0) + '|' + (it.isAd ? 1 : 0) + '|' + (it.isSuggested ? 1 : 0) + '|' + (it.width || 0);
      if (SEEN[key]) continue;
      SEEN[key] = true;
      fresh.push(it);
    }
    if (fresh.length > 0) report('media-dom', { pageUrl: PAGE_URL, items: fresh });
  }
  function pushCandidate(list, rawUrl, tag, type, visible, meta) {
    if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('javascript:')) return;
    try {
      var abs = new URL(rawUrl, PAGE_URL).href;
      if (!/^https?:/i.test(abs)) return;
      var entry = { url: abs, tag: tag || 'video', type: type || '', visible: !!visible };
      if (meta) {
        entry.durationMs = meta.durationMs;
        entry.width = meta.width;
        entry.height = meta.height;
        entry.muted = meta.muted;
        entry.hasControls = meta.hasControls;
        entry.isAd = meta.isAd;
        entry.isSuggested = meta.isSuggested;
      }
      list.push(entry);
    } catch (e) {}
  }
  function scanMedia() {
    var items = [];
    document.querySelectorAll('video, audio').forEach(function(el) {
      var src = el.currentSrc || el.src || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-video-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-mp4') || el.getAttribute('data-hls');
      if (src) {
        var meta = classifyEl(el, src);
        pushCandidate(items, src, el.tagName.toLowerCase(), el.getAttribute('type') || (el.tagName === 'AUDIO' ? 'audio/mpeg' : 'video/mp4'), meta.width >= 200 && meta.height >= 110, meta);
      }
      el.querySelectorAll('source').forEach(function(s) {
        var ssrc = s.getAttribute('src') || s.getAttribute('data-src') || s.getAttribute('data-lazy-src');
        if (ssrc) pushCandidate(items, ssrc, el.tagName.toLowerCase(), s.getAttribute('type') || '', false, classifyEl(el, ssrc));
      });
    });
    if (window.performance && performance.getEntriesByType) {
      try {
        var res = performance.getEntriesByType('resource') || [];
        for (var i = 0; i < res.length; i++) {
          if (isMediaUrl(res[i].name)) pushCandidate(items, res[i].name, 'video', '', false, null);
        }
      } catch (e) {}
    }
    emitItems(items);
  }
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = function(input) {
      var u = typeof input === 'string' ? input : (input && input.url);
      if (isMediaUrl(u)) emitItems([{ url: new URL(u, PAGE_URL).href, tag: 'video', type: '', visible: false }]);
      return origFetch.apply(this, arguments).then(function(resp) {
        try {
          var ct = (resp.headers && resp.headers.get('content-type')) || '';
          if (ct.indexOf('video/') === 0 || ct.indexOf('audio/') === 0 || ct.indexOf('mpegurl') !== -1 || ct.indexOf('dash+xml') !== -1) {
            emitItems([{ url: resp.url || u, tag: ct.indexOf('audio/') === 0 ? 'audio' : 'video', type: ct, visible: false }]);
          }
        } catch (e) {}
        return resp;
      });
    };
  }
  if (window.XMLHttpRequest) {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        if (typeof url === 'string' && isMediaUrl(url)) {
          emitItems([{ url: new URL(url, PAGE_URL).href, tag: 'video', type: '', visible: false }]);
        }
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  }
  if (window.MutationObserver) {
    var obs = new MutationObserver(function() { scanMedia(); });
    window.addEventListener('DOMContentLoaded', function() {
      scanMedia();
      if (document.body) obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src', 'data-video-src', 'data-mp4', 'data-hls'] });
    });
  } else {
    window.addEventListener('DOMContentLoaded', scanMedia);
  }
  window.addEventListener('load', scanMedia);
  function handlePlaybackEvent(e) {
    var t = e.target;
    if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) {
      var src = t.currentSrc || t.src;
      if (src) {
        try {
          var abs = new URL(src, PAGE_URL).href;
          var meta = classifyEl(t, abs);
          var isShortPreRoll = meta.durationMs !== null && meta.durationMs > 0 && meta.durationMs < 16000;
          emitItems([{
            url: abs,
            tag: t.tagName.toLowerCase(),
            type: '',
            visible: !meta.isAd && !meta.isSuggested && !isShortPreRoll,
            durationMs: meta.durationMs,
            width: meta.width,
            height: meta.height,
            muted: meta.muted,
            hasControls: meta.hasControls,
            isAd: meta.isAd,
            isSuggested: meta.isSuggested
          }]);
          if (!meta.isAd && !meta.isSuggested && !isShortPreRoll) {
            report('visible-media', { pageUrl: PAGE_URL, mediaUrl: abs });
          }
        } catch(err) {}
      }
    }
  }
  document.addEventListener('loadedmetadata', handlePlaybackEvent, true);
  document.addEventListener('durationchange', handlePlaybackEvent, true);
  document.addEventListener('playing', handlePlaybackEvent, true);
  document.addEventListener('play', handlePlaybackEvent, true);
  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a && a.href && !a.href.startsWith('javascript:')) {
      e.preventDefault();
      report('navigate', { url: a.href });
    }
  }, true);
  window.addEventListener('message', function(ev) {
    if (!ev.data || ev.data.target !== 'salvia-iframe') return;
    if (ev.data.type === 'find') {
      var q = (ev.data.query || '').trim();
      if (!q) { report('find-result', { matches: 0, active: 0 }); return; }
      var text = document.body ? (document.body.innerText || '') : '';
      var lower = text.toLowerCase();
      var needle = q.toLowerCase();
      var count = 0, idx = 0;
      while ((idx = lower.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
      if (window.find && count > 0) {
        window.find(q, false, !!ev.data.backwards, true, false, true, false);
      }
      report('find-result', { matches: count, active: count > 0 ? 1 : 0 });
    }
  });
})();
</script>
""".trimIndent()

        cleaned = if (headOpenRegex.containsMatchIn(cleaned)) {
            headOpenRegex.replaceFirst(cleaned) { match ->
                "${match.value}$baseTag$bridgeScript"
            }
        } else {
            "$baseTag$bridgeScript$cleaned"
        }

        return InjectedResult(html = cleaned, title = title, blockedCount = blockedCount)
    }
}
