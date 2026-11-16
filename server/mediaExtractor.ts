import { DEFAULT_BLOCKED_HOSTS } from '../src/core/adBlockRules';
import {
  classifyUrlByPattern,
  isYouTubeUrl,
  type LinkPatternMatch,
} from '../src/core/linkPatternEngine';

export const DEFAULT_USER_AGENT_MOBILE =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
export const DEFAULT_USER_AGENT_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface ExtractedMediaItem {
  url: string;
  mimeType?: string;
  source: 'DOM' | 'JS' | 'FETCH';
  format?: string;
  width?: number | null;
  height?: number | null;
  bitrate?: number | null;
  audioTrackUrl?: string | null;
}

export interface ExtractionResponse {
  ok: boolean;
  youtubeExcluded?: boolean;
  finalUrl: string;
  title?: string;
  thumbnail?: string | null;
  durationMs?: number | null;
  items: ExtractedMediaItem[];
  error?: string;
}

// One block list for the whole product: the proxy and the media extractor must not
// drift away from the rules the browser UI uses.
const BLOCKED_HOSTS = DEFAULT_BLOCKED_HOSTS;

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '::' ||
    host === '0.0.0.0' ||
    host === '::ffff:127.0.0.1' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (host.includes(':')) {
    // IPv6 literals: unique-local (fc00::/7) and link-local (fe80::/10).
    const firstGroup = parseInt(host.split(':')[0] || '0', 16);
    if (Number.isFinite(firstGroup)) {
      if ((firstGroup & 0xfe00) === 0xfc00) return true;
      if ((firstGroup & 0xffc0) === 0xfe80) return true;
    }
    return false;
  }
  if (/^\d+$/.test(host)) {
    // Decimal-encoded IPv4 such as http://2130706433/
    return true;
  }
  if (
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    host.startsWith('0.')
  ) {
    return true;
  }
  if (host.startsWith('172.')) {
    const second = Number(host.split('.')[1]);
    if (Number.isFinite(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

export function validateRemoteUrl(rawUrl: string | null): URL | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (isPrivateOrLocalHostname(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hostMatchesBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase();
  for (const domain of BLOCKED_HOSTS) {
    if (h === domain || h.endsWith(`.${domain}`)) return true;
  }
  return false;
}

export function unescapeEmbeddedText(raw: string): string {
  return raw
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003F/gi, '?')
    .replace(/\\u0025/gi, '%')
    .replace(/\\u003C/gi, '<')
    .replace(/\\u003E/gi, '>')
    .replace(/\\x2F/gi, '/')
    .replace(/\\x3A/gi, ':')
    .replace(/\\x26/gi, '&')
    .replace(/\\x3D/gi, '=')
    .replace(/\\x3F/gi, '?')
    .replace(/\\\//g, '/')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#38;|&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'");
}

export function collectUrlsFromHtml(
  html: string,
  baseUrl: string,
  found: Map<string, ExtractedMediaItem>
): void {
  const unescaped = unescapeEmbeddedText(html);

  const addItem = (raw: string, source: 'DOM' | 'JS' | 'FETCH', mimeType?: string, format?: string) => {
    try {
      const resolved = new URL(raw, baseUrl).href;
      if (!/^https?:\/\//i.test(resolved)) return;
      if (isYouTubeUrl(resolved)) return;
      if (!found.has(resolved)) {
        found.set(resolved, { url: resolved, source, mimeType, format });
      }
    } catch {
      // ignore invalid URL
    }
  };

  // 1. Direct media extension URLs in HTML/JSON
  const directRegex =
    /https?:\/\/[^\s"'<>\\]+\.(?:mp4|webm|mov|m4v|m3u8|mpd|mp3|m4a)(?:\?[^\s"'<>\\]*)?/gi;
  for (const m of unescaped.match(directRegex) || []) {
    addItem(m, 'JS');
  }

  // 2. Named JSON video/stream keys (including Instagram, Facebook, TikTok, Reddit, JWPlayer, generic CDNs)
  const keyRegex =
    /"(?:contentUrl|playbackUrl|playable_url(?:_quality_hd)?|browser_native_hd_url|browser_native_sd_url|hd_src(?:_no_ratelimit)?|sd_src(?:_no_ratelimit)?|video_url|video_hls_url|playAddr|downloadAddr|fallback_url|hls_url|hls_manifest_url|dash_url|dashManifestUrl|playlistUrl|manifestUrl|streamUrl|mediaUrl|hdUrl|sdUrl|mp4_url|file|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  let km: RegExpExecArray | null;
  while ((km = keyRegex.exec(unescaped)) !== null) {
    const k = km[0].toLowerCase();
    const fmt = k.includes('hd') ? 'HD MP4' : k.includes('sd') ? 'SD MP4' : undefined;
    addItem(km[1], 'DOM', undefined, fmt);
  }

  // 3. Instagram / Meta video_versions array entries
  const igVersionRegex =
    /"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)\s*,\s*"url"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  let ivm: RegExpExecArray | null;
  while ((ivm = igVersionRegex.exec(unescaped)) !== null) {
    const w = Number(ivm[1]);
    const h = Number(ivm[2]);
    const url = ivm[3];
    if (url.includes('.mp4') || url.includes('cdninstagram') || url.includes('fbcdn')) {
      try {
        const abs = new URL(url, baseUrl).href;
        if (!found.has(abs)) {
          found.set(abs, {
            url: abs,
            mimeType: 'video/mp4',
            source: 'DOM',
            format: h > 0 ? `${h}p MP4` : 'MP4',
            width: w || null,
            height: h || null,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  // 4. <video>, <audio>, <source> tags
  const tagRegex = /<(?:source|video|audio)\b[^>]+?\b(?:src|data-src|data-video-src|data-mp4|data-hls)=["']([^"']+)["']/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tagRegex.exec(unescaped)) !== null) {
    addItem(tm[1], 'DOM');
  }

  // 5. OpenGraph / Twitter player meta tags
  const ogVideoRegex =
    /<meta[^>]+?(?:property=["']og:video(?::url|:secure_url)?["']|name=["']twitter:player:stream["'])[^>]+?content=["']([^"']+)["']/gi;
  let om: RegExpExecArray | null;
  while ((om = ogVideoRegex.exec(unescaped)) !== null) {
    addItem(om[1], 'DOM', 'video/mp4');
  }
}

async function fetchJsonWithTimeout(url: string, headers: Record<string, string>, timeoutMs = 8000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<{ ok: boolean; status: number; finalUrl: string; text: string; contentType: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      return { ok: false, status: res.status, finalUrl: res.url || url, text: '', contentType: ct };
    }
    const text = await res.text();
    return { ok: true, status: res.status, finalUrl: res.url || url, text, contentType: ct };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseMetaFromHtml(html: string, finalUrl: string): { title: string; thumbnail: string | null } {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? unescapeEmbeddedText(titleMatch[1]).trim() : new URL(finalUrl).hostname;
  const thumbMatch = html.match(
    /<meta[^>]+?(?:property=["']og:image["']|name=["']twitter:image["'])[^>]+?content=["']([^"']+)["']/i
  );
  let thumbnail: string | null = null;
  if (thumbMatch?.[1]) {
    try {
      thumbnail = new URL(unescapeEmbeddedText(thumbMatch[1]), finalUrl).href;
    } catch {
      thumbnail = null;
    }
  }
  return { title, thumbnail };
}

function syndicationTokenForTweetId(tweetId: string): string {
  const idNum = Number(tweetId);
  if (!Number.isFinite(idNum)) return '0';
  return ((idNum / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

async function extractXTwitter(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  let effectiveUrl = pattern.canonicalUrl;
  let tweetId = pattern.mediaId;

  // Resolve t.co or non-status URLs first
  if (!tweetId) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch(effectiveUrl, {
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_USER_AGENT_DESKTOP },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.url) {
        effectiveUrl = res.url;
        const reparsed = classifyUrlByPattern(effectiveUrl);
        if (reparsed?.mediaId) tweetId = reparsed.mediaId;
      }
    } catch {
      // continue
    }
  }

  if (!tweetId) return null;

  // Run FxTwitter, VxTwitter, and official Syndication concurrently to eliminate sequential timeouts
  const token = syndicationTokenForTweetId(tweetId);
  const [fxRaw, vxRaw, synRaw] = await Promise.all([
    fetchJsonWithTimeout(`https://api.fxtwitter.com/status/${tweetId}`, {
      'User-Agent': 'SalviaBrowxer/1.0',
      Accept: 'application/json',
    }),
    fetchJsonWithTimeout(`https://api.vxtwitter.com/Twitter/status/${tweetId}`, {
      'User-Agent': 'SalviaBrowxer/1.0',
      Accept: 'application/json',
    }),
    fetchJsonWithTimeout(
      `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`,
      {
        'User-Agent': DEFAULT_USER_AGENT_DESKTOP,
        Accept: 'application/json',
      }
    ),
  ]);

  const fx = fxRaw as {
    tweet?: {
      text?: string;
      author?: { name?: string; screen_name?: string };
      media?: {
        videos?: Array<{
          url?: string;
          thumbnail_url?: string;
          width?: number;
          height?: number;
          duration?: number;
          formats?: Array<{ url?: string; bitrate?: number; container?: string; codec?: string }>;
          variants?: Array<{ url?: string; bitrate?: number; content_type?: string }>;
        }>;
      };
    };
  } | null;

  if (fx?.tweet?.media?.videos?.length) {
    const items: ExtractedMediaItem[] = [];
    const seen = new Set<string>();
    const video = fx.tweet.media.videos[0];
    const variants = [
      ...(video.variants || []),
      ...(video.formats || []).map((f) => ({
        url: f.url,
        bitrate: f.bitrate,
        content_type: f.container === 'm3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp4',
      })),
    ];

    const mp4s = variants
      .filter((v) => v.url && (!v.content_type || v.content_type.includes('mp4')))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    for (const v of mp4s) {
      if (!v.url || seen.has(v.url)) continue;
      seen.add(v.url);
      const resMatch = v.url.match(/\/(\d{3,4})x(\d{3,4})\//);
      const w = resMatch ? Number(resMatch[1]) : video.width ?? null;
      const h = resMatch ? Number(resMatch[2]) : video.height ?? null;
      const kbps = v.bitrate ? Math.round(v.bitrate / 1000) : null;
      items.push({
        url: v.url,
        mimeType: 'video/mp4',
        source: 'FETCH',
        format: h ? `${h}p MP4` : kbps ? `${kbps} kbps MP4` : 'MP4',
        width: w,
        height: h,
        bitrate: kbps,
      });
    }

    if (video.url && !seen.has(video.url)) {
      seen.add(video.url);
      items.push({
        url: video.url,
        mimeType: video.url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
        source: 'FETCH',
        format: video.url.includes('.m3u8') ? 'HLS Stream' : video.height ? `${video.height}p MP4` : 'MP4',
        width: video.width ?? null,
        height: video.height ?? null,
      });
    }

    for (const v of variants) {
      if (v.url && !seen.has(v.url) && v.url.includes('.m3u8')) {
        seen.add(v.url);
        items.push({
          url: v.url,
          mimeType: 'application/vnd.apple.mpegurl',
          source: 'FETCH',
          format: 'HLS Adaptive',
        });
      }
    }

    if (items.length > 0) {
      const author = fx.tweet.author?.screen_name ? `@${fx.tweet.author.screen_name}` : 'X';
      const title = fx.tweet.text ? `${author}: ${fx.tweet.text.slice(0, 72)}` : `X Video ${tweetId}`;
      return {
        ok: true,
        finalUrl: effectiveUrl,
        title,
        thumbnail: video.thumbnail_url ?? null,
        durationMs: video.duration ? Math.round(video.duration * 1000) : null,
        items,
      };
    }
  }

  const vx = vxRaw as {
    text?: string;
    user_screen_name?: string;
    media_extended?: Array<{
      type?: string;
      url?: string;
      thumbnail_url?: string;
      duration_millis?: number;
      size?: { width?: number; height?: number };
    }>;
  } | null;

  if (vx?.media_extended?.length) {
    const items: ExtractedMediaItem[] = [];
    let thumb: string | null = null;
    let durationMs: number | null = null;
    for (const m of vx.media_extended) {
      if ((m.type === 'video' || m.type === 'gif') && m.url) {
        if (!thumb && m.thumbnail_url) thumb = m.thumbnail_url;
        if (!durationMs && m.duration_millis) durationMs = m.duration_millis;
        items.push({
          url: m.url,
          mimeType: m.url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
          source: 'FETCH',
          format: m.size?.height ? `${m.size.height}p MP4` : 'MP4',
          width: m.size?.width ?? null,
          height: m.size?.height ?? null,
        });
      }
    }
    if (items.length > 0) {
      const author = vx.user_screen_name ? `@${vx.user_screen_name}` : 'X';
      return {
        ok: true,
        finalUrl: effectiveUrl,
        title: vx.text ? `${author}: ${vx.text.slice(0, 72)}` : `X Video ${tweetId}`,
        thumbnail: thumb,
        durationMs,
        items,
      };
    }
  }

  const syn = synRaw as {
    text?: string;
    user?: { screen_name?: string };
    video?: {
      poster?: string;
      durationMs?: number;
      variants?: Array<{ src?: string; type?: string }>;
    };
    mediaDetails?: Array<{
      media_url_https?: string;
      video_info?: {
        duration_millis?: number;
        variants?: Array<{ url?: string; bitrate?: number; content_type?: string }>;
      };
    }>;
  } | null;

  if (syn) {
    const items: ExtractedMediaItem[] = [];
    const seen = new Set<string>();
    const rawVariants = [
      ...(syn.video?.variants || []).map((v) => ({ url: v.src, content_type: v.type, bitrate: 0 })),
      ...(syn.mediaDetails?.flatMap((m) => m.video_info?.variants || []) || []),
    ];
    for (const v of rawVariants) {
      if (!v.url || seen.has(v.url)) continue;
      seen.add(v.url);
      const resMatch = v.url.match(/\/(\d{3,4})x(\d{3,4})\//);
      items.push({
        url: v.url,
        mimeType: v.content_type || (v.url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'),
        source: 'FETCH',
        format: resMatch ? `${resMatch[2]}p MP4` : v.url.includes('.m3u8') ? 'HLS' : 'MP4',
        width: resMatch ? Number(resMatch[1]) : null,
        height: resMatch ? Number(resMatch[2]) : null,
        bitrate: v.bitrate ? Math.round(v.bitrate / 1000) : null,
      });
    }
    if (items.length > 0) {
      items.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
      const author = syn.user?.screen_name ? `@${syn.user.screen_name}` : 'X';
      return {
        ok: true,
        finalUrl: effectiveUrl,
        title: syn.text ? `${author}: ${syn.text.slice(0, 72)}` : `X Video ${tweetId}`,
        thumbnail: syn.video?.poster || syn.mediaDetails?.[0]?.media_url_https || null,
        durationMs: syn.video?.durationMs || syn.mediaDetails?.[0]?.video_info?.duration_millis || null,
        items,
      };
    }
  }

  return null;
}

async function extractInstagram(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  const shortcode = pattern.mediaId;
  const kind = pattern.mediaSubKind === 'p' || pattern.mediaSubKind === 'tv' ? pattern.mediaSubKind : 'reel';
  const found = new Map<string, ExtractedMediaItem>();
  let title = `Instagram ${shortcode || ''}`.trim();
  let thumbnail: string | null = null;

  const candidateUrls: string[] = [];
  if (shortcode) {
    candidateUrls.push(`https://www.instagram.com/${kind}/${shortcode}/embed/captioned/`);
    candidateUrls.push(`https://www.instagram.com/p/${shortcode}/embed/captioned/`);
    candidateUrls.push(`https://www.instagram.com/${kind}/${shortcode}/?__a=1&__d=dis`);
  }
  candidateUrls.push(pattern.canonicalUrl);
  if (shortcode) {
    candidateUrls.push(`https://d.ddinstagram.com/${kind}/${shortcode}`);
  }

  const probeResults = await Promise.allSettled(
    candidateUrls.map((probeUrl) =>
      fetchTextWithTimeout(
        probeUrl,
        {
          'User-Agent': probeUrl.includes('ddinstagram')
            ? 'TelegramBot (like TwitterBot)'
            : DEFAULT_USER_AGENT_MOBILE,
          Accept: 'text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-Mode': 'navigate',
        },
        7500
      )
    )
  );

  for (const settled of probeResults) {
    if (settled.status !== 'fulfilled') continue;
    const res = settled.value;
    if (!res?.ok || !res.text) continue;

    if (res.text.trim().startsWith('{')) {
      const unescaped = unescapeEmbeddedText(res.text);
      collectUrlsFromHtml(unescaped, pattern.canonicalUrl, found);
    } else {
      const meta = parseMetaFromHtml(res.text, res.finalUrl);
      if (meta.title && !meta.title.toLowerCase().includes('instagram')) title = meta.title;
      if (!thumbnail && meta.thumbnail) thumbnail = meta.thumbnail;
      collectUrlsFromHtml(res.text, res.finalUrl, found);
    }
  }

  if (found.size > 0) {
    const items = Array.from(found.values()).sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    return {
      ok: true,
      finalUrl: pattern.canonicalUrl,
      title,
      thumbnail,
      items,
    };
  }

  return null;
}

async function extractTikTok(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  const found = new Map<string, ExtractedMediaItem>();
  let finalUrl = pattern.canonicalUrl;
  let title = 'TikTok Video';
  let thumbnail: string | null = null;

  const page = await fetchTextWithTimeout(pattern.canonicalUrl, {
    'User-Agent': DEFAULT_USER_AGENT_DESKTOP,
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  });
  if (page?.ok && page.text) {
    finalUrl = page.finalUrl || finalUrl;
    const meta = parseMetaFromHtml(page.text, finalUrl);
    if (meta.title) title = meta.title;
    if (meta.thumbnail) thumbnail = meta.thumbnail;
    collectUrlsFromHtml(page.text, finalUrl, found);
  }

  if (found.size === 0) {
    const tikwm = (await fetchJsonWithTimeout(
      `https://www.tikwm.com/api/?url=${encodeURIComponent(finalUrl)}&hd=1`,
      { 'User-Agent': 'SalviaBrowxer/1.0', Accept: 'application/json' }
    )) as {
      code?: number;
      data?: {
        title?: string;
        cover?: string;
        duration?: number;
        hdplay?: string;
        play?: string;
        wmplay?: string;
        music?: string;
      };
    } | null;

    if (tikwm?.code === 0 && tikwm.data) {
      const d = tikwm.data;
      if (d.title) title = d.title;
      if (d.cover) thumbnail = d.cover;
      if (d.hdplay) {
        found.set(d.hdplay, { url: d.hdplay, mimeType: 'video/mp4', source: 'FETCH', format: 'HD MP4 (No Watermark)', height: 1080 });
      }
      if (d.play && !found.has(d.play)) {
        found.set(d.play, { url: d.play, mimeType: 'video/mp4', source: 'FETCH', format: 'SD MP4 (No Watermark)', height: 720 });
      }
      if (d.music && !found.has(d.music)) {
        found.set(d.music, { url: d.music, mimeType: 'audio/mpeg', source: 'FETCH', format: 'Audio MP3' });
      }
    }
  }

  if (found.size === 0) return null;
  return {
    ok: true,
    finalUrl,
    title,
    thumbnail,
    items: Array.from(found.values()),
  };
}

async function extractFacebook(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  const found = new Map<string, ExtractedMediaItem>();
  let finalUrl = pattern.canonicalUrl;
  let title = 'Facebook Video';
  let thumbnail: string | null = null;

  const page = await fetchTextWithTimeout(pattern.canonicalUrl, {
    'User-Agent': DEFAULT_USER_AGENT_DESKTOP,
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
  });
  if (page?.ok && page.text) {
    finalUrl = page.finalUrl || finalUrl;
    const meta = parseMetaFromHtml(page.text, finalUrl);
    if (meta.title) title = meta.title;
    if (meta.thumbnail) thumbnail = meta.thumbnail;
    collectUrlsFromHtml(page.text, finalUrl, found);
  }

  if (found.size === 0) return null;
  return {
    ok: true,
    finalUrl,
    title,
    thumbnail,
    items: Array.from(found.values()),
  };
}

async function extractReddit(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  const parsed = new URL(pattern.canonicalUrl);
  const jsonUrl = `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}.json`;
  const data = (await fetchJsonWithTimeout(jsonUrl, {
    'User-Agent': 'SalviaBrowxer/1.0 (media resolver)',
    Accept: 'application/json',
  })) as Array<{
    data?: {
      children?: Array<{
        data?: {
          title?: string;
          thumbnail?: string;
          url?: string;
          secure_media?: { reddit_video?: { fallback_url?: string; hls_url?: string; height?: number; width?: number; duration?: number } };
          crosspost_parent_list?: Array<{
            secure_media?: { reddit_video?: { fallback_url?: string; hls_url?: string; height?: number; width?: number; duration?: number } };
          }>;
        };
      }>;
    };
  }> | null;

  const post = data?.[0]?.data?.children?.[0]?.data;
  const rv = post?.secure_media?.reddit_video || post?.crosspost_parent_list?.[0]?.secure_media?.reddit_video;
  if (!rv) return null;

  const items: ExtractedMediaItem[] = [];
  if (rv.hls_url) {
    items.push({
      url: rv.hls_url,
      mimeType: 'application/vnd.apple.mpegurl',
      source: 'FETCH',
      format: rv.height ? `${rv.height}p HLS (Video + Audio)` : 'HLS (Video + Audio)',
      height: rv.height ?? null,
      width: rv.width ?? null,
    });
  }
  if (rv.fallback_url) {
    const cleanFallback = rv.fallback_url.split('?')[0];
    const baseDir = cleanFallback.slice(0, cleanFallback.lastIndexOf('/'));
    const audioCandidate = `${baseDir}/DASH_AUDIO_128.mp4`;
    items.push({
      url: rv.fallback_url,
      mimeType: 'video/mp4',
      source: 'FETCH',
      format: rv.height ? `${rv.height}p MP4` : 'MP4',
      height: rv.height ?? null,
      width: rv.width ?? null,
      audioTrackUrl: audioCandidate,
    });
  }

  if (items.length === 0) return null;
  return {
    ok: true,
    finalUrl: pattern.canonicalUrl,
    title: post?.title || 'Reddit Video',
    thumbnail: post?.thumbnail?.startsWith('http') ? post.thumbnail : null,
    durationMs: rv.duration ? rv.duration * 1000 : null,
    items,
  };
}

async function extractVimeo(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  if (!pattern.mediaId) return null;
  const config = (await fetchJsonWithTimeout(`https://player.vimeo.com/video/${pattern.mediaId}/config`, {
    'User-Agent': DEFAULT_USER_AGENT_DESKTOP,
    Referer: 'https://vimeo.com/',
    Accept: 'application/json',
  })) as {
    video?: { title?: string; duration?: number; thumbs?: { base?: string } };
    request?: {
      files?: {
        progressive?: Array<{ url?: string; width?: number; height?: number; quality?: string; mime?: string }>;
        hls?: { cdns?: Record<string, { url?: string }>; default_cdn?: string };
      };
    };
  } | null;

  if (!config?.request?.files) return null;
  const items: ExtractedMediaItem[] = [];
  const progressive = [...(config.request.files.progressive || [])].sort(
    (a, b) => (b.height || 0) - (a.height || 0)
  );
  for (const p of progressive) {
    if (!p.url) continue;
    items.push({
      url: p.url,
      mimeType: p.mime || 'video/mp4',
      source: 'FETCH',
      format: p.height ? `${p.height}p MP4` : p.quality || 'MP4',
      width: p.width ?? null,
      height: p.height ?? null,
    });
  }
  const hlsMap = config.request.files.hls?.cdns;
  const defCdn = config.request.files.hls?.default_cdn;
  const hlsUrl = (defCdn && hlsMap?.[defCdn]?.url) || (hlsMap ? Object.values(hlsMap)[0]?.url : undefined);
  if (hlsUrl) {
    items.push({
      url: hlsUrl,
      mimeType: 'application/vnd.apple.mpegurl',
      source: 'FETCH',
      format: 'HLS Adaptive',
    });
  }

  if (items.length === 0) return null;
  return {
    ok: true,
    finalUrl: pattern.canonicalUrl,
    title: config.video?.title || `Vimeo ${pattern.mediaId}`,
    thumbnail: config.video?.thumbs?.base ?? null,
    durationMs: config.video?.duration ? config.video.duration * 1000 : null,
    items,
  };
}

async function extractDailymotion(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  if (!pattern.mediaId) return null;
  const meta = (await fetchJsonWithTimeout(
    `https://www.dailymotion.com/player/metadata/video/${pattern.mediaId}`,
    { 'User-Agent': DEFAULT_USER_AGENT_DESKTOP, Accept: 'application/json' }
  )) as {
    title?: string;
    duration?: number;
    posters?: Record<string, string>;
    qualities?: Record<string, Array<{ type?: string; url?: string }>>;
  } | null;

  if (!meta?.qualities) return null;
  const items: ExtractedMediaItem[] = [];
  const seen = new Set<string>();
  for (const [qKey, entries] of Object.entries(meta.qualities)) {
    for (const entry of entries || []) {
      if (!entry.url || seen.has(entry.url)) continue;
      seen.add(entry.url);
      const height = /^\d+$/.test(qKey) ? Number(qKey) : null;
      items.push({
        url: entry.url,
        mimeType: entry.type || (entry.url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'),
        source: 'FETCH',
        format: height ? `${height}p` : qKey.toUpperCase(),
        height,
      });
    }
  }
  if (items.length === 0) return null;
  const thumb = meta.posters ? Object.values(meta.posters).pop() || null : null;
  return {
    ok: true,
    finalUrl: pattern.canonicalUrl,
    title: meta.title || `Dailymotion ${pattern.mediaId}`,
    thumbnail: thumb,
    durationMs: meta.duration ? meta.duration * 1000 : null,
    items,
  };
}

async function extractStreamable(pattern: LinkPatternMatch): Promise<ExtractionResponse | null> {
  if (!pattern.mediaId) return null;
  const data = (await fetchJsonWithTimeout(
    `https://api.streamable.com/videos/${pattern.mediaId}`,
    { 'User-Agent': DEFAULT_USER_AGENT_DESKTOP, Accept: 'application/json' }
  )) as {
    title?: string;
    thumbnail_url?: string;
    files?: Record<string, { url?: string; width?: number; height?: number; bitrate?: number }>;
  } | null;

  if (!data?.files) return null;
  const items: ExtractedMediaItem[] = [];
  for (const [key, f] of Object.entries(data.files)) {
    if (!f.url) continue;
    const abs = f.url.startsWith('//') ? `https:${f.url}` : f.url;
    items.push({
      url: abs,
      mimeType: 'video/mp4',
      source: 'FETCH',
      format: f.height ? `${f.height}p MP4 (${key})` : key.toUpperCase(),
      width: f.width ?? null,
      height: f.height ?? null,
      bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
    });
  }
  if (items.length === 0) return null;
  items.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return {
    ok: true,
    finalUrl: pattern.canonicalUrl,
    title: data.title || `Streamable ${pattern.mediaId}`,
    thumbnail: data.thumbnail_url ? (data.thumbnail_url.startsWith('//') ? `https:${data.thumbnail_url}` : data.thumbnail_url) : null,
    items,
  };
}

export async function extractMediaWithPatterns(rawUrl: string): Promise<ExtractionResponse> {
  const validated = validateRemoteUrl(rawUrl);
  if (!validated) {
    return { ok: false, finalUrl: rawUrl, items: [], error: 'Invalid or restricted URL' };
  }

  const pattern = classifyUrlByPattern(validated.toString());
  if (!pattern) {
    return { ok: false, finalUrl: rawUrl, items: [], error: 'Invalid URL' };
  }

  if (pattern.category === 'YOUTUBE_EXCLUDED') {
    return {
      ok: false,
      youtubeExcluded: true,
      finalUrl: pattern.canonicalUrl,
      title: pattern.canonicalUrl,
      thumbnail: null,
      items: [],
      error: 'YOUTUBE_EXCLUDED',
    };
  }

  if (pattern.category === 'DIRECT_MEDIA') {
    return {
      ok: true,
      finalUrl: pattern.canonicalUrl,
      title: pattern.canonicalUrl.split('/').pop()?.split('?')[0] || pattern.hostname,
      thumbnail: null,
      items: [
        {
          url: pattern.canonicalUrl,
          mimeType: pattern.inferredMime || 'video/mp4',
          source: 'FETCH',
          format: pattern.inferredExtension?.toUpperCase() || 'MP4',
        },
      ],
    };
  }

  // Platform-specific pattern routes
  try {
    let specialized: ExtractionResponse | null = null;
    switch (pattern.platform) {
      case 'x_twitter':
        specialized = await extractXTwitter(pattern);
        break;
      case 'instagram':
        specialized = await extractInstagram(pattern);
        break;
      case 'tiktok':
        specialized = await extractTikTok(pattern);
        break;
      case 'facebook':
        specialized = await extractFacebook(pattern);
        break;
      case 'reddit':
        specialized = await extractReddit(pattern);
        break;
      case 'vimeo':
        specialized = await extractVimeo(pattern);
        break;
      case 'dailymotion':
        specialized = await extractDailymotion(pattern);
        break;
      case 'streamable':
        specialized = await extractStreamable(pattern);
        break;
      default:
        break;
    }
    if (specialized && specialized.ok && specialized.items.length > 0) {
      return specialized;
    }
  } catch {
    // Fall through to universal HTML/JSON/iframe deep extraction
  }

  // Universal deep HTML / JSON-LD / Script / Iframe extraction for all other websites
  try {
    const response = await fetchTextWithTimeout(pattern.canonicalUrl, {
      'User-Agent': DEFAULT_USER_AGENT_MOBILE,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (!response) {
      return { ok: false, finalUrl: pattern.canonicalUrl, items: [], error: 'Request timed out' };
    }
    if (!response.ok) {
      return { ok: false, finalUrl: response.finalUrl, items: [], error: `HTTP ${response.status}` };
    }

    const ct = response.contentType;
    const finalUrl = response.finalUrl;
    if (
      ct.startsWith('video/') ||
      ct.startsWith('audio/') ||
      ct.includes('mpegurl') ||
      ct.includes('dash+xml')
    ) {
      return {
        ok: true,
        finalUrl,
        title: finalUrl.split('/').pop() || pattern.hostname,
        items: [{ url: finalUrl, mimeType: ct, source: 'FETCH' }],
      };
    }

    const { title, thumbnail } = parseMetaFromHtml(response.text, finalUrl);
    const found = new Map<string, ExtractedMediaItem>();
    collectUrlsFromHtml(response.text, finalUrl, found);

    // Inspect up to 3 embedded iframes one hop deep
    const iframeMatches: string[] = [];
    const iframeRegex = /<iframe\b[^>]+?\b(?:src|data-src)=["']([^"']+)["']/gi;
    let im: RegExpExecArray | null;
    while ((im = iframeRegex.exec(response.text)) !== null && iframeMatches.length < 3) {
      try {
        const resolvedIframe = validateRemoteUrl(new URL(im[1], finalUrl).href);
        if (resolvedIframe && !iframeMatches.includes(resolvedIframe.toString())) {
          iframeMatches.push(resolvedIframe.toString());
        }
      } catch {
        // ignore
      }
    }

    if (iframeMatches.length > 0) {
      const iframeResults = await Promise.allSettled(
        iframeMatches.map((iframeUrl) =>
          fetchTextWithTimeout(
            iframeUrl,
            { 'User-Agent': DEFAULT_USER_AGENT_MOBILE, Referer: finalUrl },
            6500
          )
        )
      );
      for (const settled of iframeResults) {
        if (settled.status === 'fulfilled' && settled.value?.ok && settled.value.text) {
          collectUrlsFromHtml(settled.value.text, settled.value.finalUrl, found);
        }
      }
    }

    return {
      ok: true,
      finalUrl,
      title,
      thumbnail,
      items: Array.from(found.values()),
    };
  } catch (err) {
    return {
      ok: false,
      finalUrl: pattern.canonicalUrl,
      items: [],
      error: err instanceof Error ? err.message : 'Extract failed',
    };
  }
}
