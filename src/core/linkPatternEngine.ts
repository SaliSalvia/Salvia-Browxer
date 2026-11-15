export type LinkPatternCategory =
  | 'YOUTUBE_EXCLUDED'
  | 'DIRECT_MEDIA'
  | 'PLATFORM_PAGE'
  | 'GENERIC_PAGE';

export type PlatformExtractorKey =
  | 'x_twitter'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'reddit'
  | 'vimeo'
  | 'dailymotion'
  | 'pinterest'
  | 'streamable'
  | 'threads'
  | 'twitch'
  | 'soundcloud'
  | 'generic';

export interface LinkPatternMatch {
  rawUrl: string;
  canonicalUrl: string;
  hostname: string;
  category: LinkPatternCategory;
  platform: PlatformExtractorKey;
  mediaId: string | null;
  mediaSubKind: string | null;
  inferredExtension: string | null;
  inferredMime: string | null;
  isCdnDirect: boolean;
}

const YOUTUBE_HOST_RE =
  /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com)$/i;

const DIRECT_EXT_RE =
  /\.(mp4|m4v|mov|webm|mkv|avi|flv|3gp|3g2|ts|m3u8|mpd|mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav)(?:[?#]|$)/i;

const QUERY_MEDIA_HINT_RE =
  /(?:^|[?&])(?:mime|type|content_type)=((?:video|audio)(?:%2F|\/)[a-z0-9.+-]+)|(?:^|[?&])(?:format|ext)=(mp4|m4v|mov|webm|m3u8|mpd|mp3|m4a|aac)\b/i;

const CDN_MEDIA_PATTERNS: ReadonlyArray<{
  hostRe: RegExp;
  pathRe: RegExp;
  ext: string;
  mime: string;
}> = [
  {
    hostRe: /(?:^|\.)video\.twimg\.com$/i,
    pathRe: /\/(?:ext_tw_video|amplify_video|tweet_video|vid)\//i,
    ext: 'mp4',
    mime: 'video/mp4',
  },
  {
    hostRe: /(?:^|\.)cdninstagram\.com$/i,
    pathRe: /\/v\/t\d+(?:\.[0-9-]+)*\//i,
    ext: 'mp4',
    mime: 'video/mp4',
  },
  {
    hostRe: /(?:^|\.)fbcdn\.net$/i,
    pathRe: /\/v\/t\d+(?:\.[0-9-]+)*\//i,
    ext: 'mp4',
    mime: 'video/mp4',
  },
  {
    hostRe: /(?:^|\.)tiktokcdn(?:-us|-eu|-in)?\.com$/i,
    pathRe: /\/(?:video|play|aweme)\//i,
    ext: 'mp4',
    mime: 'video/mp4',
  },
  {
    hostRe: /^v\.redd\.it$/i,
    pathRe: /\/(?:DASH_|HLSPlaylist|CMAF_)/i,
    ext: 'mp4',
    mime: 'video/mp4',
  },
  {
    hostRe: /(?:^|\.)(?:vimeocdn\.com|vod-progressive\.akamaized\.net)$/i,
    pathRe: /\//,
    ext: 'mp4',
    mime: 'video/mp4',
  },
];

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'igshid',
  'igsh',
  'ref_src',
  'ref_url',
  'si',
  'feature',
  'gclid',
  'mc_cid',
  'mc_eid',
  's',
  't',
]);

const REDIRECTOR_RULES: ReadonlyArray<{
  hostRe: RegExp;
  pathPrefix: string;
  param: string;
}> = [
  { hostRe: /^l\.instagram\.com$/i, pathPrefix: '/', param: 'u' },
  { hostRe: /^(?:l|lm)\.facebook\.com$/i, pathPrefix: '/l.php', param: 'u' },
  { hostRe: /^www\.google\.com$/i, pathPrefix: '/url', param: 'q' },
];

export function unwrapRedirectorUrl(parsed: URL): URL {
  const host = parsed.hostname.toLowerCase();
  for (const rule of REDIRECTOR_RULES) {
    if (rule.hostRe.test(host) && parsed.pathname.startsWith(rule.pathPrefix)) {
      const inner = parsed.searchParams.get(rule.param);
      if (inner) {
        try {
          const unwrapped = new URL(inner);
          if (unwrapped.protocol === 'http:' || unwrapped.protocol === 'https:') {
            return unwrapped;
          }
        } catch {
          // keep original URL
        }
      }
    }
  }
  return parsed;
}

export function canonicalizeUrlForPattern(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;

  parsed = unwrapRedirectorUrl(parsed);

  // Preserve x.com/twitter.com functional query params only if not pure share-tracking
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const isTwitter = /(?:^|\.)(?:x\.com|twitter\.com)$/i.test(host);
  const cleaned = new URL(parsed.toString());
  for (const key of Array.from(cleaned.searchParams.keys())) {
    const lk = key.toLowerCase();
    if (lk === 't' && !isTwitter) continue;
    if (TRACKING_PARAMS.has(lk)) {
      cleaned.searchParams.delete(key);
    }
  }
  return cleaned;
}

export function isYouTubeHostname(hostname: string): boolean {
  const clean = hostname.toLowerCase().replace(/\.+$/, '');
  return YOUTUBE_HOST_RE.test(clean);
}

export function isYouTubeUrl(rawUrl: string): boolean {
  const parsed = canonicalizeUrlForPattern(rawUrl);
  return parsed ? isYouTubeHostname(parsed.hostname) : false;
}

function inferExtensionAndMime(urlStr: string): {
  ext: string | null;
  mime: string | null;
  isCdnDirect: boolean;
} {
  const extMatch = urlStr.match(DIRECT_EXT_RE);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    const mime =
      ext === 'm3u8'
        ? 'application/vnd.apple.mpegurl'
        : ext === 'mpd'
          ? 'application/dash+xml'
          : ext === 'mp3'
            ? 'audio/mpeg'
            : ext === 'm4a' || ext === 'm4b' || ext === 'aac'
              ? `audio/${ext}`
              : ext === 'ogg' || ext === 'oga' || ext === 'opus' || ext === 'flac' || ext === 'wav'
                ? `audio/${ext}`
                : `video/${ext === 'mov' ? 'quicktime' : ext === 'mkv' ? 'x-matroska' : ext}`;
    return { ext, mime, isCdnDirect: false };
  }

  const queryMatch = urlStr.match(QUERY_MEDIA_HINT_RE);
  if (queryMatch) {
    const rawMime = queryMatch[1] ? decodeURIComponent(queryMatch[1]).toLowerCase() : null;
    const rawExt = queryMatch[2] ? queryMatch[2].toLowerCase() : null;
    const ext =
      rawExt ||
      (rawMime?.includes('mp4')
        ? 'mp4'
        : rawMime?.includes('webm')
          ? 'webm'
          : rawMime?.includes('mpegurl')
            ? 'm3u8'
            : rawMime?.startsWith('audio/')
              ? 'm4a'
              : 'mp4');
    return {
      ext,
      mime: rawMime || (ext === 'm3u8' ? 'application/vnd.apple.mpegurl' : `video/${ext}`),
      isCdnDirect: true,
    };
  }

  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    for (const cdn of CDN_MEDIA_PATTERNS) {
      if (cdn.hostRe.test(host) && cdn.pathRe.test(parsed.pathname)) {
        // v.redd.it without DASH_/HLSPlaylist is a webpage/folder, not direct media
        if (host === 'v.redd.it' && !/\/(?:DASH_|HLSPlaylist|CMAF_)/i.test(parsed.pathname)) {
          continue;
        }
        const pathExt = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || cdn.ext;
        const mime = pathExt === 'm3u8' ? 'application/vnd.apple.mpegurl' : pathExt === 'mpd' ? 'application/dash+xml' : cdn.mime;
        return { ext: pathExt, mime, isCdnDirect: true };
      }
    }
  } catch {
    // ignore
  }

  return { ext: null, mime: null, isCdnDirect: false };
}

interface PlatformPatternRule {
  platform: PlatformExtractorKey;
  hostRe: RegExp;
  idRe?: RegExp;
  kindRe?: RegExp;
}

const PLATFORM_RULES: ReadonlyArray<PlatformPatternRule> = [
  {
    platform: 'x_twitter',
    hostRe: /(?:^|\.)(?:x\.com|twitter\.com|mobile\.twitter\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com|t\.co)$/i,
    idRe: /\/(?:[^/]+\/status|i\/(?:web\/)?status)\/(\d+)/i,
  },
  {
    platform: 'instagram',
    hostRe: /(?:^|\.)(?:instagram\.com|instagr\.am|ddinstagram\.com)$/i,
    idRe: /\/(?:reel|reels|p|tv|stories\/[^/]+)\/([A-Za-z0-9_-]+)/i,
    kindRe: /\/(reel|reels|p|tv|stories)\//i,
  },
  {
    platform: 'tiktok',
    hostRe: /(?:^|\.)(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)$/i,
    idRe: /\/(?:video|v)\/(\d+)|^\/([A-Za-z0-9_-]{6,})\/?$/i,
  },
  {
    platform: 'facebook',
    hostRe: /(?:^|\.)(?:facebook\.com|fb\.watch|fb\.com|mbasic\.facebook\.com)$/i,
    idRe: /\/(?:videos|reel|watch\/?\?v=|share\/[rv])\/?([A-Za-z0-9_-]+)?/i,
  },
  {
    platform: 'reddit',
    hostRe: /(?:^|\.)(?:reddit\.com|redd\.it|v\.redd\.it)$/i,
    idRe: /\/comments\/([a-z0-9]+)|^\/([a-z0-9]{5,})(?:\/|$)/i,
  },
  {
    platform: 'vimeo',
    hostRe: /(?:^|\.)(?:vimeo\.com|player\.vimeo\.com)$/i,
    idRe: /\/(?:video\/|channels\/[^/]+\/)?(\d{5,})/i,
  },
  {
    platform: 'dailymotion',
    hostRe: /(?:^|\.)(?:dailymotion\.com|dai\.ly)$/i,
    idRe: /(?:\/video\/|^\/)([a-z0-9]{5,})/i,
  },
  {
    platform: 'pinterest',
    hostRe: /(?:^|\.)(?:pinterest\.[a-z.]+|pin\.it)$/i,
    idRe: /\/pin\/(\d+)|^\/([A-Za-z0-9]+)/i,
  },
  {
    platform: 'streamable',
    hostRe: /(?:^|\.)streamable\.com$/i,
    idRe: /\/(?:e\/)?([a-z0-9]{4,})/i,
  },
  {
    platform: 'threads',
    hostRe: /(?:^|\.)threads\.(?:net|com)$/i,
    idRe: /\/post\/([A-Za-z0-9_-]+)/i,
  },
  {
    platform: 'twitch',
    hostRe: /(?:^|\.)twitch\.tv$/i,
    idRe: /\/videos\/(\d+)|\/clip\/([A-Za-z0-9_-]+)/i,
  },
  {
    platform: 'soundcloud',
    hostRe: /(?:^|\.)soundcloud\.com$/i,
  },
];

export function classifyUrlByPattern(rawUrl: string): LinkPatternMatch | null {
  const canonical = canonicalizeUrlForPattern(rawUrl);
  if (!canonical) return null;

  const canonicalStr = canonical.toString();
  const hostname = canonical.hostname.toLowerCase().replace(/\.+$/, '');

  // 1. Explicit YouTube exclusion (per user product policy)
  if (isYouTubeHostname(hostname)) {
    return {
      rawUrl,
      canonicalUrl: canonicalStr,
      hostname,
      category: 'YOUTUBE_EXCLUDED',
      platform: 'generic',
      mediaId: canonical.searchParams.get('v') || canonical.pathname.split('/').filter(Boolean).pop() || null,
      mediaSubKind: canonical.pathname.includes('/shorts/') ? 'shorts' : 'video',
      inferredExtension: null,
      inferredMime: null,
      isCdnDirect: false,
    };
  }

  // 2. Check direct CDN stream patterns (e.g. v.redd.it/id/DASH_720.mp4, video.twimg.com, cdninstagram.com)
  const inferred = inferExtensionAndMime(canonicalStr);
  if (inferred.ext && (inferred.isCdnDirect || hostname === 'v.redd.it')) {
    return {
      rawUrl,
      canonicalUrl: canonicalStr,
      hostname,
      category: 'DIRECT_MEDIA',
      platform: 'generic',
      mediaId: null,
      mediaSubKind: null,
      inferredExtension: inferred.ext,
      inferredMime: inferred.mime,
      isCdnDirect: inferred.isCdnDirect,
    };
  }

  // 3. Check known platform page patterns FIRST for social links (even if URL slug contains .mp4)
  for (const rule of PLATFORM_RULES) {
    if (rule.hostRe.test(hostname)) {
      const idMatch = rule.idRe ? canonical.pathname.match(rule.idRe) || canonicalStr.match(rule.idRe) : null;
      const mediaId = idMatch ? idMatch[1] || idMatch[2] || null : null;
      const kindMatch = rule.kindRe ? canonical.pathname.match(rule.kindRe) : null;
      const mediaSubKind = kindMatch ? kindMatch[1].toLowerCase() : null;
      return {
        rawUrl,
        canonicalUrl: canonicalStr,
        hostname,
        category: 'PLATFORM_PAGE',
        platform: rule.platform,
        mediaId,
        mediaSubKind,
        inferredExtension: null,
        inferredMime: null,
        isCdnDirect: false,
      };
    }
  }

  // 4. Direct media URLs with explicit file extensions
  if (inferred.ext) {
    return {
      rawUrl,
      canonicalUrl: canonicalStr,
      hostname,
      category: 'DIRECT_MEDIA',
      platform: 'generic',
      mediaId: null,
      mediaSubKind: null,
      inferredExtension: inferred.ext,
      inferredMime: inferred.mime,
      isCdnDirect: inferred.isCdnDirect,
    };
  }

  // 4. Generic webpage (extracted via multi-strategy DOM/JSON/iframe probe)
  return {
    rawUrl,
    canonicalUrl: canonicalStr,
    hostname,
    category: 'GENERIC_PAGE',
    platform: 'generic',
    mediaId: null,
    mediaSubKind: null,
    inferredExtension: null,
    inferredMime: null,
    isCdnDirect: false,
  };
}
