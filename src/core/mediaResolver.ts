import type { MediaCandidate, MediaFormat, MediaInfo } from '../types/models';
import {
  AUDIO_EXTENSIONS,
  DASH_MIME_TYPE,
  MEDIA_EXTENSIONS,
  extensionForMime,
  hasMediaExtension,
  isDashUrl,
  isMediaMime,
  isPlaylistMime,
  isPlaylistUrl,
  looksLikeNonMedia,
  looksLikeSegment,
  pathExtension,
} from './mediaUrlRules';
import type { UnsupportedMedia } from './mediaOfferability';
import { apiUrl } from './nativeBridge';
import { classifyUrlByPattern } from './linkPatternEngine';

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIdx]}`;
}

export function formatTransferRate(bytesPerSecond: number): string {
  return formatFileSize(bytesPerSecond);
}

export function formatDurationSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export function formatDurationMs(ms: number): string {
  return formatDurationSeconds(ms / 1000);
}

export function sanitizeFilename(raw: string | null | undefined): string {
  const cleaned = (raw || 'media')
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 110) || 'media';
}

function resolveRelativeUrl(base: string, maybeRelative: string): string | null {
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return null;
  }
}

export function scanHtmlForMedia(html: string, pageUrl: string, pageTitle?: string): MediaCandidate[] {
  const candidates = new Map<string, MediaCandidate>();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = pageTitle || doc.title || pageUrl;

  const addCandidate = (
    rawUrl: string | null | undefined,
    mimeType: string | null | undefined,
    confidence: number,
    explicitTitle?: string | null
  ) => {
    if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('javascript:')) return;
    const abs = resolveRelativeUrl(pageUrl, rawUrl.trim());
    if (!abs || (!abs.startsWith('http://') && !abs.startsWith('https://'))) return;
    if (looksLikeNonMedia(abs) || looksLikeSegment(abs)) return;

    const ext = pathExtension(abs) || extensionForMime(mimeType) || (isPlaylistUrl(abs, mimeType) ? 'm3u8' : null);
    const hasEvidence =
      isMediaMime(mimeType) ||
      isPlaylistMime(mimeType) ||
      isDashUrl(abs, mimeType) ||
      hasMediaExtension(abs) ||
      isPlaylistUrl(abs, mimeType);
    if (!hasEvidence || !ext) return;

    const existing = candidates.get(abs);
    if (existing && existing.confidence >= confidence) return;
    candidates.set(abs, {
      id: `dom-${abs}`,
      pageUrl,
      mediaUrl: abs,
      title: explicitTitle || title,
      mimeType: mimeType || (ext === 'm3u8' ? 'application/vnd.apple.mpegurl' : AUDIO_EXTENSIONS.has(ext) ? `audio/${ext}` : `video/${ext}`),
      extension: ext,
      source: 'DOM',
      confidence,
    });
  };

  doc.querySelectorAll('video, audio').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const defaultMime = tag === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const src =
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      el.getAttribute('data-lazy-src') ||
      el.getAttribute('data-video-src') ||
      el.getAttribute('data-mp4') ||
      el.getAttribute('data-hls') ||
      el.getAttribute('data-stream') ||
      el.getAttribute('data-url');
    addCandidate(src, el.getAttribute('type') || defaultMime, 0.88, el.getAttribute('title') || title);
    el.querySelectorAll('source').forEach((source) => {
      addCandidate(
        source.getAttribute('src') || source.getAttribute('data-src') || source.getAttribute('data-lazy-src'),
        source.getAttribute('type') || defaultMime,
        0.86,
        title
      );
    });
  });

  doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[property="og:audio"], meta[name="twitter:player:stream"]').forEach((meta) => {
    const content = meta.getAttribute('content');
    const prop = meta.getAttribute('property') || '';
    addCandidate(content, prop.includes('audio') ? 'audio/mpeg' : 'video/mp4', 0.8);
  });

  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const json = JSON.parse(script.textContent || '{}');
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item && typeof item.contentUrl === 'string') {
          addCandidate(item.contentUrl, item.encodingFormat || 'video/mp4', 0.82, item.name || title);
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  });

  doc.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (href && (hasMediaExtension(href) || isDashUrl(href))) {
      addCandidate(href, null, 0.72, anchor.textContent?.trim() || title);
    }
  });

  const unescapedHtml = html
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003F/gi, '?')
    .replace(/\\u0025/gi, '%')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');

  const keyRegex =
    /"(?:contentUrl|playbackUrl|playable_url(?:_quality_hd)?|browser_native_hd_url|browser_native_sd_url|hd_src(?:_no_ratelimit)?|sd_src(?:_no_ratelimit)?|video_url|playAddr|downloadAddr|fallback_url|hls_url|hls_manifest_url|dash_url|mp4_url|file|src)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  let km: RegExpExecArray | null;
  while ((km = keyRegex.exec(unescapedHtml)) !== null) {
    addCandidate(km[1], null, 0.84, title);
  }

  const urlRegex = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|webm|mov|m4v|m3u8|mpd|mp3|m4a)(?:\?[^\s"'<>\\]*)?/gi;
  const rawMatches = unescapedHtml.match(urlRegex) || [];
  for (const match of rawMatches.slice(0, 30)) {
    addCandidate(match, null, 0.65, title);
  }

  return Array.from(candidates.values());
}

function parseAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    attrs[match[1]] = match[3] ?? match[4] ?? '';
  }
  return attrs;
}

export interface HlsParseResult {
  formats: MediaFormat[];
  audioFormats?: MediaFormat[];
  unsupported: UnsupportedMedia | 'DRM' | null;
}

export function parseHlsPlaylist(manifestText: string, baseUrl: string, title: string): HlsParseResult {
  const lines = manifestText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (manifestText.includes('METHOD=SAMPLE-AES')) {
    return { formats: [], unsupported: 'DRM' };
  }

  const audioGroups = new Map<string, string>();
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      if (attrs.TYPE === 'AUDIO' && attrs['GROUP-ID'] && attrs.URI) {
        const resolved = resolveRelativeUrl(baseUrl, attrs.URI);
        if (resolved && !audioGroups.has(attrs['GROUP-ID'])) {
          audioGroups.set(attrs['GROUP-ID'], resolved);
        }
      }
    }
  }

  const variants: MediaFormat[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      const nextUrlLine = lines.slice(i + 1).find((l) => !l.startsWith('#'));
      if (!nextUrlLine) continue;
      const resolvedUrl = resolveRelativeUrl(baseUrl, nextUrlLine);
      if (!resolvedUrl) continue;

      const bandwidth = Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0);
      const kbps = bandwidth > 0 ? Math.round(bandwidth / 1000) : null;
      let width: number | null = null;
      let height: number | null = null;
      if (attrs.RESOLUTION && attrs.RESOLUTION.includes('x')) {
        const [w, h] = attrs.RESOLUTION.split('x').map(Number);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          width = w;
          height = h;
        }
      }
      const audioGroup = attrs.AUDIO ? audioGroups.get(attrs.AUDIO) ?? null : null;
      const qualityLabel = height
        ? `${height}p${audioGroup ? ' + audio' : ''}`
        : kbps
          ? `${kbps} kbps`
          : `Variant ${variants.length + 1}`;

      variants.push({
        id: `hls-${variants.length}-${resolvedUrl}`,
        format: qualityLabel,
        url: resolvedUrl,
        mimeType: 'application/vnd.apple.mpegurl',
        extension: 'mp4',
        width,
        height,
        bitrate: kbps,
        isVideo: true,
        isAudio: Boolean(audioGroup),
        isHls: true,
        audioTrackUrl: audioGroup,
      });
    }
  }

  if (variants.length > 0) {
    variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
    const audioFormats: MediaFormat[] = Array.from(audioGroups.entries()).map(([groupId, audioUrl]) => ({
      id: `hls-audio-${groupId}`,
      format: `Audio (${groupId})`,
      url: audioUrl,
      mimeType: 'audio/mp4',
      extension: 'm4a',
      isVideo: false,
      isAudio: true,
      isHls: true,
    }));
    return { formats: variants, audioFormats, unsupported: null };
  }

  // Media playlist (non-master)
  const isVod = manifestText.includes('#EXT-X-ENDLIST') || manifestText.includes('#EXT-X-PLAYLIST-TYPE:VOD');
  if (!isVod && manifestText.includes('#EXT-X-TARGETDURATION')) {
    return { formats: [], unsupported: 'LIVE' };
  }

  return {
    formats: [
      {
        id: `hls-single-${baseUrl}`,
        format: `${title} (HLS)`,
        url: baseUrl,
        mimeType: 'application/vnd.apple.mpegurl',
        extension: 'mp4',
        isVideo: true,
        isHls: true,
      },
    ],
    unsupported: null,
  };
}

export function parseDashManifest(manifestText: string, baseUrl: string): HlsParseResult {
  const lower = manifestText.toLowerCase();
  if (lower.includes('contentprotection')) {
    return { formats: [], unsupported: 'DRM' };
  }
  if (lower.includes('type="dynamic"') || (manifestText.match(/<Period\b/gi)?.length ?? 0) > 1) {
    return { formats: [], unsupported: 'DASH' };
  }

  const doc = new DOMParser().parseFromString(manifestText, 'application/xml');
  const adaptations = Array.from(doc.querySelectorAll('AdaptationSet'));
  const formats: MediaFormat[] = [];
  let bestAudioUrl: string | null = null;
  let bestAudioBitrate = 0;

  for (const set of adaptations) {
    const mime = set.getAttribute('mimeType') || '';
    if (mime.startsWith('audio/')) {
      set.querySelectorAll('Representation').forEach((rep) => {
        const bw = Number(rep.getAttribute('bandwidth') || 0);
        const base = rep.querySelector('BaseURL')?.textContent?.trim();
        if (base && bw >= bestAudioBitrate) {
          bestAudioBitrate = bw;
          bestAudioUrl = resolveRelativeUrl(baseUrl, base);
        }
      });
    }
  }

  for (const set of adaptations) {
    const mime = set.getAttribute('mimeType') || 'video/mp4';
    if (!mime.startsWith('video/')) continue;
    set.querySelectorAll('Representation').forEach((rep) => {
      const bw = Number(rep.getAttribute('bandwidth') || 0);
      const width = Number(rep.getAttribute('width') || 0) || null;
      const height = Number(rep.getAttribute('height') || 0) || null;
      const base = rep.querySelector('BaseURL')?.textContent?.trim();
      const repUrl = base ? resolveRelativeUrl(baseUrl, base) : baseUrl;
      if (!repUrl) return;
      formats.push({
        id: `dash-${formats.length}-${rep.getAttribute('id') || height || bw}`,
        format: height ? `${height}p${bestAudioUrl ? ' + audio' : ''}` : `${Math.round(bw / 1000)} kbps`,
        url: repUrl,
        mimeType: DASH_MIME_TYPE,
        extension: 'mp4',
        width,
        height,
        bitrate: bw > 0 ? Math.round(bw / 1000) : null,
        isVideo: true,
        isAudio: Boolean(bestAudioUrl),
        isDash: true,
        audioTrackUrl: bestAudioUrl,
      });
    });
  }

  if (formats.length === 0) {
    return { formats: [], unsupported: 'DASH' };
  }

  formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return { formats, unsupported: null };
}

export function initialMediaInfoForCandidate(candidate: MediaCandidate): MediaInfo {
  const ext = candidate.extension || pathExtension(candidate.mediaUrl) || 'mp4';
  const title = candidate.title?.trim() || sanitizeFilename(candidate.mediaUrl.split('/').pop()?.split('?')[0]);
  const isPlaylist = ext === 'm3u8' || isPlaylistMime(candidate.mimeType);
  const isDash = ext === 'mpd' || isDashUrl(candidate.mediaUrl, candidate.mimeType);
  const isAudio = AUDIO_EXTENSIONS.has(ext) || (candidate.mimeType?.startsWith('audio/') ?? false);

  if (candidate.variants && candidate.variants.length > 0) {
    const videoFormats = candidate.variants.filter((f) => f.isVideo !== false);
    const audioFormats = candidate.variants.filter((f) => f.isAudio && f.isVideo === false);
    return {
      title,
      thumbnail: candidate.thumbnail ?? null,
      duration: candidate.duration ?? null,
      formats: candidate.variants,
      audioFormats,
      videoFormats,
      combinedFormats: candidate.variants,
      source: candidate.source,
      webpageUrl: candidate.pageUrl,
    };
  }

  const fallbackFormat: MediaFormat = {
    id: `direct-${candidate.mediaUrl}`,
    format: candidate.formatLabel || (candidate.height ? `${candidate.height}p ${ext.toUpperCase()}` : ext.toUpperCase()),
    url: candidate.mediaUrl,
    mimeType: candidate.mimeType || (isAudio ? `audio/${ext}` : `video/${ext}`),
    extension: isPlaylist || isDash ? 'mp4' : MEDIA_EXTENSIONS.has(ext) ? ext : 'mp4',
    size: candidate.estimatedSize ?? null,
    width: candidate.width ?? null,
    height: candidate.height ?? null,
    bitrate: candidate.bitrate ?? null,
    isVideo: !isAudio,
    isAudio,
    isHls: isPlaylist,
    isDash,
    audioTrackUrl: candidate.audioTrackUrl ?? null,
    referer: candidate.pageUrl || null,
  };

  return {
    title,
    thumbnail: candidate.thumbnail ?? null,
    duration: candidate.duration ?? null,
    formats: [fallbackFormat],
    audioFormats: isAudio ? [fallbackFormat] : [],
    videoFormats: !isAudio ? [fallbackFormat] : [],
    combinedFormats: [fallbackFormat],
    source: candidate.source,
    webpageUrl: candidate.pageUrl,
  };
}

export async function probeMediaCandidate(candidate: MediaCandidate): Promise<{
  mediaInfo: MediaInfo;
  unsupported: UnsupportedMedia | 'DRM' | null;
}> {
  const baseInfo = initialMediaInfoForCandidate(candidate);
  if (candidate.variants && candidate.variants.length > 1) {
    return { mediaInfo: baseInfo, unsupported: null };
  }
  try {
    const refParam = candidate.pageUrl ? `&referer=${encodeURIComponent(candidate.pageUrl)}` : '';
    const res = await fetch(apiUrl(`/api/media/probe?url=${encodeURIComponent(candidate.mediaUrl)}${refParam}`));
    if (!res.ok) return { mediaInfo: baseInfo, unsupported: null };
    const data = (await res.json()) as {
      ok?: boolean;
      finalUrl?: string;
      contentType?: string;
      size?: number | null;
      manifestText?: string | null;
    };
    if (!data.ok) return { mediaInfo: baseInfo, unsupported: null };

    const effectiveUrl = data.finalUrl || candidate.mediaUrl;
    const effectiveMime = data.contentType || candidate.mimeType || baseInfo.formats[0].mimeType;

    if (data.manifestText && (isPlaylistUrl(effectiveUrl, effectiveMime) || data.manifestText.includes('#EXTM3U'))) {
      const parsed = parseHlsPlaylist(data.manifestText, effectiveUrl, baseInfo.title);
      if (parsed.unsupported) {
        return { mediaInfo: { ...baseInfo, formats: [], combinedFormats: [] }, unsupported: parsed.unsupported };
      }
      const withRef = parsed.formats.map((f) => ({ ...f, referer: candidate.pageUrl || null }));
      return {
        mediaInfo: {
          ...baseInfo,
          formats: withRef,
          audioFormats: parsed.audioFormats ?? baseInfo.audioFormats,
          combinedFormats: withRef,
        },
        unsupported: null,
      };
    }

    if (data.manifestText && (isDashUrl(effectiveUrl, effectiveMime) || data.manifestText.includes('<MPD'))) {
      const parsed = parseDashManifest(data.manifestText, effectiveUrl);
      if (parsed.unsupported) {
        return { mediaInfo: { ...baseInfo, formats: [], combinedFormats: [] }, unsupported: parsed.unsupported };
      }
      const withRef = parsed.formats.map((f) => ({ ...f, referer: candidate.pageUrl || null }));
      return {
        mediaInfo: {
          ...baseInfo,
          formats: withRef,
          combinedFormats: withRef,
        },
        unsupported: null,
      };
    }

    const updatedFormat: MediaFormat = {
      ...baseInfo.formats[0],
      url: effectiveUrl,
      mimeType: effectiveMime,
      size: data.size ?? baseInfo.formats[0].size ?? null,
      referer: candidate.pageUrl || null,
    };

    return {
      mediaInfo: {
        ...baseInfo,
        formats: [updatedFormat],
        combinedFormats: [updatedFormat],
      },
      unsupported: null,
    };
  } catch {
    return { mediaInfo: baseInfo, unsupported: null };
  }
}

interface ExtractCacheEntry {
  expiresAt: number;
  result: {
    ok: boolean;
    youtubeExcluded?: boolean;
    finalUrl: string;
    title: string;
    thumbnail: string | null;
    candidates: MediaCandidate[];
  };
}

const EXTRACT_CACHE_TTL_MS = 3 * 60 * 1000;
const extractCache = new Map<string, ExtractCacheEntry>();

export async function extractMediaFromPageUrl(pageUrl: string): Promise<{
  ok: boolean;
  youtubeExcluded?: boolean;
  finalUrl: string;
  title: string;
  thumbnail: string | null;
  candidates: MediaCandidate[];
}> {
  const pattern = classifyUrlByPattern(pageUrl);
  if (pattern?.category === 'YOUTUBE_EXCLUDED') {
    return {
      ok: false,
      youtubeExcluded: true,
      finalUrl: pattern.canonicalUrl,
      title: pattern.canonicalUrl,
      thumbnail: null,
      candidates: [],
    };
  }

  const cacheKey = pattern?.canonicalUrl || pageUrl;
  const cached = extractCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const res = await fetch(apiUrl(`/api/media/extract?url=${encodeURIComponent(cacheKey)}`));
    if (!res.ok) {
      return { ok: false, finalUrl: cacheKey, title: cacheKey, thumbnail: null, candidates: [] };
    }
    const data = (await res.json()) as {
      ok?: boolean;
      youtubeExcluded?: boolean;
      finalUrl?: string;
      title?: string;
      thumbnail?: string | null;
      durationMs?: number | null;
      items?: Array<{
        url: string;
        mimeType?: string;
        source?: 'DOM' | 'JS' | 'FETCH';
        format?: string;
        width?: number | null;
        height?: number | null;
        bitrate?: number | null;
        audioTrackUrl?: string | null;
      }>;
    };
    if (data.youtubeExcluded) {
      return {
        ok: false,
        youtubeExcluded: true,
        finalUrl: data.finalUrl || cacheKey,
        title: data.title || cacheKey,
        thumbnail: null,
        candidates: [],
      };
    }
    if (!data.ok || !Array.isArray(data.items)) {
      return { ok: false, finalUrl: data.finalUrl || cacheKey, title: data.title || cacheKey, thumbnail: null, candidates: [] };
    }
    const effectivePage = data.finalUrl || cacheKey;
    const title = data.title || effectivePage;
    const seen = new Set<string>();
    const rawItems: Array<{
      url: string;
      ext: string;
      mimeType: string;
      source: 'DOM' | 'JS' | 'FETCH';
      formatLabel?: string;
      width?: number | null;
      height?: number | null;
      bitrate?: number | null;
      audioTrackUrl?: string | null;
    }> = [];

    for (const item of data.items) {
      if (!item.url || seen.has(item.url)) continue;
      if (looksLikeNonMedia(item.url) || looksLikeSegment(item.url)) continue;
      seen.add(item.url);
      const ext =
        pathExtension(item.url) ||
        extensionForMime(item.mimeType) ||
        (isPlaylistUrl(item.url, item.mimeType) ? 'm3u8' : isDashUrl(item.url, item.mimeType) ? 'mpd' : 'mp4');
      const mimeType =
        item.mimeType ||
        (ext === 'm3u8'
          ? 'application/vnd.apple.mpegurl'
          : ext === 'mpd'
            ? DASH_MIME_TYPE
            : AUDIO_EXTENSIONS.has(ext)
              ? `audio/${ext}`
              : `video/${ext}`);
      rawItems.push({
        url: item.url,
        ext,
        mimeType,
        source: item.source || 'DOM',
        formatLabel: item.format,
        width: item.width ?? null,
        height: item.height ?? null,
        bitrate: item.bitrate ?? null,
        audioTrackUrl: item.audioTrackUrl ?? null,
      });
    }

    // If extractor returned multiple quality variants for a social video (e.g. X/Vimeo/Instagram),
    // group MP4/HLS variants onto the primary candidate so the Quality Sheet presents them cleanly.
    const candidates: MediaCandidate[] = [];
    const hasRichVariants = rawItems.length > 1 && rawItems.some((r) => Boolean(r.height || r.bitrate || r.formatLabel));
    if (hasRichVariants) {
      const variants: MediaFormat[] = rawItems.map((r, idx) => {
        const isHls = r.ext === 'm3u8' || isPlaylistMime(r.mimeType);
        const isDash = r.ext === 'mpd' || isDashUrl(r.url, r.mimeType);
        const isAudio = AUDIO_EXTENSIONS.has(r.ext) || r.mimeType.startsWith('audio/');
        return {
          id: `ext-var-${idx}-${r.url}`,
          format: r.formatLabel || (r.height ? `${r.height}p ${r.ext.toUpperCase()}` : r.ext.toUpperCase()),
          url: r.url,
          mimeType: r.mimeType,
          extension: isHls || isDash ? 'mp4' : r.ext,
          width: r.width ?? null,
          height: r.height ?? null,
          bitrate: r.bitrate ?? null,
          isVideo: !isAudio,
          isAudio,
          isHls,
          isDash,
          audioTrackUrl: r.audioTrackUrl ?? null,
          referer: effectivePage,
        };
      });
      const primary = rawItems[0];
      candidates.push({
        id: `extract-${primary.url}`,
        pageUrl: effectivePage,
        mediaUrl: primary.url,
        title,
        mimeType: primary.mimeType,
        extension: primary.ext,
        source: primary.source,
        confidence: 0.96,
        thumbnail: data.thumbnail ?? undefined,
        duration: data.durationMs ?? null,
        width: primary.width ?? null,
        height: primary.height ?? null,
        bitrate: primary.bitrate ?? null,
        formatLabel: primary.formatLabel ?? null,
        audioTrackUrl: primary.audioTrackUrl ?? null,
        variants,
      });
    } else {
      for (const r of rawItems) {
        candidates.push({
          id: `extract-${r.url}`,
          pageUrl: effectivePage,
          mediaUrl: r.url,
          title,
          mimeType: r.mimeType,
          extension: r.ext,
          source: r.source,
          confidence: r.source === 'FETCH' ? 0.95 : 0.85,
          thumbnail: data.thumbnail ?? undefined,
          duration: data.durationMs ?? null,
          width: r.width ?? null,
          height: r.height ?? null,
          bitrate: r.bitrate ?? null,
          formatLabel: r.formatLabel ?? null,
          audioTrackUrl: r.audioTrackUrl ?? null,
        });
      }
    }

    const result = {
      ok: true,
      finalUrl: effectivePage,
      title,
      thumbnail: data.thumbnail ?? null,
      candidates,
    };
    if (candidates.length > 0) {
      extractCache.set(cacheKey, { expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS, result });
    }
    return result;
  } catch {
    return { ok: false, finalUrl: cacheKey, title: cacheKey, thumbnail: null, candidates: [] };
  }
}
