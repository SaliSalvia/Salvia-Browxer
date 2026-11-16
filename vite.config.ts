import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {
  DEFAULT_USER_AGENT_DESKTOP,
  DEFAULT_USER_AGENT_MOBILE,
  extractMediaWithPatterns,
  hostMatchesBlocked,
  unescapeEmbeddedText,
  validateRemoteUrl,
} from './server/mediaExtractor';
import { DASH_EXTENSION, MEDIA_EXTENSIONS, SEGMENT_EXTENSIONS } from './src/core/mediaUrlRules';

/**
 * The injected detector used to keep its own short extension list, so it missed
 * formats the rest of the app accepts. It now derives from the single media rule
 * set, minus the segment extensions, which are never offered as media.
 */
const BRIDGE_MEDIA_EXTENSIONS = Array.from(MEDIA_EXTENSIONS)
  .filter((ext) => !SEGMENT_EXTENSIONS.has(ext))
  .concat(DASH_EXTENSION)
  .join('|');

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
  headersOnlyTimeout = false
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (headersOnlyTimeout) {
      clearTimeout(timer);
    }
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  } finally {
    if (!headersOnlyTimeout) {
      clearTimeout(timer);
    }
  }
}

function injectBrowserBridge(html: string, finalUrl: string, adBlock: boolean): { html: string; blockedCount: number } {
  let blockedCount = 0;
  let cleaned = html
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');

  if (adBlock) {
    cleaned = cleaned.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/script>/gi, (match, src) => {
      try {
        const u = new URL(src, finalUrl);
        if (hostMatchesBlocked(u.hostname)) {
          blockedCount++;
          return '<!-- blocked by SalviaBrowxer -->';
        }
      } catch {
        // ignore invalid src
      }
      return match;
    });
  }

  const baseTag = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
  const bridgeScript = `<script>(function() {
  var PAGE_URL = ${JSON.stringify(finalUrl)};
  var SEEN = Object.create(null);
  function report(type, payload) {
    try { window.parent.postMessage({ source: 'salvia-browser-bridge', type: type, payload: payload }, '*'); } catch (e) {}
  }
  function isMediaUrl(u) {
    if (!u || typeof u !== 'string' || u.startsWith('data:') || u.startsWith('javascript:')) return false;
    if (/\\.(${BRIDGE_MEDIA_EXTENSIONS})(\\?|#|$)/i.test(u)) return true;
    return /[?&](?:mime|type)=video|[?&]format=mp4/i.test(u) || /video\\.twimg\\.com\\/|cdninstagram\\.com\\/v\\/t|fbcdn\\.net\\/v\\/t|tiktokcdn/i.test(u);
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
    var isAdUrl = /(\\/ads\\/|\\/ad\\/|preroll|pre-roll|midroll|imasdk|doubleclick|googlesyndication|vmap|\\/vast|adserver|sponsor|bumper)/i.test(lowUrl);
    var isAdDom = /\\b(ad-player|preroll|pre-roll|ima-ad|vast|vmap|ad-container|advertisement|sponsored|data_ad)\\b/i.test(lowCtx);
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
  var scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function() {
      scanTimer = null;
      scanMedia();
    }, 150);
  }
  function scanMedia() {
    var items = [];
    document.querySelectorAll('video, audio').forEach(function(el) {
      var src = el.currentSrc || el.src || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-video-src') || el.getAttribute('data-mp4') || el.getAttribute('data-hls');
      if (src) {
        var meta = classifyEl(el, src);
        pushCandidate(items, src, el.tagName.toLowerCase(), el.getAttribute('type') || (el.tagName === 'AUDIO' ? 'audio/mpeg' : 'video/mp4'), meta.width >= 200 && meta.height >= 110, meta);
      }
      el.querySelectorAll('source').forEach(function(s) {
        var ssrc = s.getAttribute('src') || s.getAttribute('data-src') || s.getAttribute('data-lazy-src');
        if (ssrc) pushCandidate(items, ssrc, el.tagName.toLowerCase(), s.getAttribute('type') || '', false, classifyEl(el, ssrc));
      });
    });
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function(sc) {
      try {
        var text = sc.textContent || '';
        if (!text || text.length > 200000) return;
        var parsed = JSON.parse(text);
        var stack = Array.isArray(parsed) ? parsed.slice() : [parsed];
        while (stack.length > 0) {
          var node = stack.pop();
          if (!node || typeof node !== 'object') continue;
          if (typeof node.contentUrl === 'string') pushCandidate(items, node.contentUrl, 'video', node.encodingFormat || 'video/mp4', false, null);
          if (typeof node.embedUrl === 'string' && isMediaUrl(node.embedUrl)) pushCandidate(items, node.embedUrl, 'video', '', false, null);
          for (var k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k) && node[k] && typeof node[k] === 'object') {
              stack.push(node[k]);
            }
          }
        }
      } catch (e) {}
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
      if (u && isMediaUrl(u)) emitItems([{ url: new URL(u, PAGE_URL).href, tag: 'video', type: '', visible: false }]);
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
  if (window.history) {
    ['pushState', 'replaceState'].forEach(function(fnName) {
      var orig = window.history[fnName];
      if (typeof orig === 'function') {
        window.history[fnName] = function() {
          var ret = orig.apply(this, arguments);
          PAGE_URL = window.location.href || PAGE_URL;
          scheduleScan();
          return ret;
        };
      }
    });
    window.addEventListener('popstate', function() {
      PAGE_URL = window.location.href || PAGE_URL;
      scheduleScan();
    });
  }
  if (window.MutationObserver) {
    var obs = new MutationObserver(function() { scheduleScan(); });
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
})();</script>`;

  if (/<head[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${bridgeScript}`);
  } else {
    cleaned = `${baseTag}${bridgeScript}${cleaned}`;
  }
  return { html: cleaned, blockedCount };
}

const MAX_HTML_BYTES = 8 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function salviaMiddlewarePlugin(): Plugin {
  return {
    name: 'salvia-browser-proxy',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          next();
          return;
        }
        const parsedReq = new URL(req.url, 'http://localhost');

        if (parsedReq.pathname === '/api/browse') {
          const target = validateRemoteUrl(parsedReq.searchParams.get('url'));
          if (!target) {
            return sendJson(res, 400, { error: 'Invalid or restricted URL' });
          }
          const desktop = parsedReq.searchParams.get('desktop') === '1';
          const adBlock = parsedReq.searchParams.get('adblock') === '1';
          try {
            const response = await fetchWithTimeout(
              target.toString(),
              {
                headers: {
                  'User-Agent': desktop ? DEFAULT_USER_AGENT_DESKTOP : DEFAULT_USER_AGENT_MOBILE,
                  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
              },
              15000
            );
            const contentType = response.headers.get('content-type') || '';
            const finalUrl = response.url || target.toString();
            if (!response.ok) {
              return sendJson(res, 200, {
                ok: false,
                status: response.status,
                statusText: response.statusText,
                finalUrl,
              });
            }
            if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || contentType === '') {
              const declaredLength = Number(response.headers.get('content-length') || 0) || 0;
              if (declaredLength > MAX_HTML_BYTES) {
                return sendJson(res, 200, {
                  ok: false,
                  status: 413,
                  statusText: 'Page is too large to proxy',
                  finalUrl,
                });
              }
              const rawHtml = await response.text();
              if (rawHtml.length > MAX_HTML_BYTES) {
                return sendJson(res, 200, {
                  ok: false,
                  status: 413,
                  statusText: 'Page is too large to proxy',
                  finalUrl,
                });
              }
              const titleMatch = rawHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
              const title = titleMatch ? unescapeEmbeddedText(titleMatch[1]).trim() : new URL(finalUrl).hostname;
              const { html, blockedCount } = injectBrowserBridge(rawHtml, finalUrl, adBlock);
              return sendJson(res, 200, { ok: true, finalUrl, title, contentType, blockedCount, html });
            }
            const isDirect =
              contentType.startsWith('video/') ||
              contentType.startsWith('audio/') ||
              contentType.includes('mpegurl') ||
              contentType.includes('dash+xml');
            return sendJson(res, 200, {
              ok: true,
              finalUrl,
              title: finalUrl.split('/').pop() || target.hostname,
              contentType,
              blockedCount: 0,
              isDirectMedia: isDirect,
              contentLength: Number(response.headers.get('content-length') || 0) || null,
            });
          } catch (err) {
            return sendJson(res, 200, {
              ok: false,
              error: err instanceof Error ? err.message : 'Network error',
              finalUrl: target.toString(),
            });
          }
        }

        if (parsedReq.pathname === '/api/media/probe') {
          const target = validateRemoteUrl(parsedReq.searchParams.get('url'));
          if (!target) {
            return sendJson(res, 400, { error: 'Invalid or restricted URL' });
          }
          const refererUrl = validateRemoteUrl(parsedReq.searchParams.get('referer'));
          const reqHeaders: Record<string, string> = { 'User-Agent': DEFAULT_USER_AGENT_MOBILE };
          if (refererUrl) {
            reqHeaders.Referer = refererUrl.toString();
            reqHeaders.Origin = refererUrl.origin;
          }
          try {
            let headRes = await fetchWithTimeout(
              target.toString(),
              {
                method: 'HEAD',
                headers: reqHeaders,
                redirect: 'follow',
              },
              10000
            );
            if (!headRes.ok || !headRes.headers.get('content-length')) {
              headRes = await fetchWithTimeout(
                target.toString(),
                {
                  method: 'GET',
                  headers: { ...reqHeaders, Range: 'bytes=0-0' },
                  redirect: 'follow',
                },
                10000
              );
            }
            const contentType = headRes.headers.get('content-type') || '';
            const contentDisposition = headRes.headers.get('content-disposition') || '';
            let size = Number(headRes.headers.get('content-length') || 0) || null;
            const cr = headRes.headers.get('content-range');
            if (cr && cr.includes('/')) {
              const total = Number(cr.split('/').pop());
              if (Number.isFinite(total) && total > 0) size = total;
            }
            const acceptRanges =
              headRes.headers.get('accept-ranges') === 'bytes' || headRes.status === 206;
            const finalUrl = headRes.url || target.toString();

            let manifestText: string | null = null;
            if (
              target.pathname.toLowerCase().endsWith('.m3u8') ||
              target.pathname.toLowerCase().endsWith('.mpd') ||
              contentType.includes('mpegurl') ||
              contentType.includes('dash+xml')
            ) {
              const mRes = await fetchWithTimeout(
                target.toString(),
                {
                  headers: reqHeaders,
                  redirect: 'follow',
                },
                12000
              );
              if (mRes.ok) {
                manifestText = await mRes.text();
              }
            }

            return sendJson(res, 200, {
              ok: true,
              finalUrl,
              contentType,
              contentDisposition,
              size,
              acceptRanges,
              manifestText,
            });
          } catch (err) {
            return sendJson(res, 200, {
              ok: false,
              error: err instanceof Error ? err.message : 'Probe failed',
            });
          }
        }

        if (parsedReq.pathname === '/api/media/extract') {
          const rawUrl = parsedReq.searchParams.get('url');
          if (!rawUrl) {
            return sendJson(res, 400, { error: 'Missing URL' });
          }
          const result = await extractMediaWithPatterns(rawUrl);
          const status = result.error === 'Invalid or restricted URL' ? 400 : 200;
          return sendJson(res, status, result);
        }

        if (parsedReq.pathname === '/api/media/fetch') {
          const target = validateRemoteUrl(parsedReq.searchParams.get('url'));
          if (!target) {
            return sendJson(res, 400, { error: 'Invalid or restricted URL' });
          }
          const refererUrl = validateRemoteUrl(parsedReq.searchParams.get('referer'));
          try {
            const upstreamHeaders: Record<string, string> = {
              'User-Agent': DEFAULT_USER_AGENT_MOBILE,
            };
            if (refererUrl) {
              upstreamHeaders.Referer = refererUrl.toString();
              upstreamHeaders.Origin = refererUrl.origin;
            }
            if (req.headers.range) {
              upstreamHeaders.Range = String(req.headers.range);
            }
            const upstream = await fetchWithTimeout(
              target.toString(),
              {
                headers: upstreamHeaders,
                redirect: 'follow',
              },
              20000,
              true
            );
            res.statusCode = upstream.status;
            const ct = upstream.headers.get('content-type');
            const cl = upstream.headers.get('content-length');
            const cr = upstream.headers.get('content-range');
            const ar = upstream.headers.get('accept-ranges');
            if (ct) res.setHeader('Content-Type', ct);
            if (cl) res.setHeader('Content-Length', cl);
            if (cr) res.setHeader('Content-Range', cr);
            if (ar) res.setHeader('Accept-Ranges', ar);
            if (!upstream.body) {
              res.end();
              return;
            }
            const reader = upstream.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) res.write(Buffer.from(value));
            }
            res.end();
            return;
          } catch (err) {
            return sendJson(res, 502, {
              error: err instanceof Error ? err.message : 'Fetch proxy failed',
            });
          }
        }

        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), salviaMiddlewarePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
});
