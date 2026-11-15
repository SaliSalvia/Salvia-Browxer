import type { MediaCandidate } from '../types/models';
import {
  classifyUrlByPattern,
  isYouTubeUrl,
  type LinkPatternMatch,
} from './linkPatternEngine';
import {
  AUDIO_EXTENSIONS,
  DASH_EXTENSION,
  DASH_MIME_TYPE,
  MEDIA_EXTENSIONS,
  isDashUrl,
  isPlaylistUrl,
  pathExtension,
} from './mediaUrlRules';

export type PastedLinkKind = 'MEDIA_FILE' | 'WEB_PAGE';

export function analyzePastedLink(url: string): LinkPatternMatch | null {
  return classifyUrlByPattern(url);
}

export function isYouTubeExcludedUrl(url: string): boolean {
  return isYouTubeUrl(url);
}

export function classifyPastedLink(url: string): PastedLinkKind | null {
  const match = classifyUrlByPattern(url);
  if (!match) return null;
  return match.category === 'DIRECT_MEDIA' ? 'MEDIA_FILE' : 'WEB_PAGE';
}

export function isPastedMediaFile(url: string): boolean {
  const match = classifyUrlByPattern(url);
  return match?.category === 'DIRECT_MEDIA';
}

function titleFromUrl(url: string): string | null {
  const clean = url.split('#')[0].split('?')[0];
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  const base = dot > 0 ? last.slice(0, dot) : last;
  return base.trim().length > 2 ? base.trim() : null;
}

export function pastedMediaCandidate(url: string): MediaCandidate | null {
  const match = classifyUrlByPattern(url);
  if (!match || match.category !== 'DIRECT_MEDIA') return null;

  const rawExt = pathExtension(match.canonicalUrl) || match.inferredExtension;
  const extension =
    rawExt && (MEDIA_EXTENSIONS.has(rawExt) || rawExt === DASH_EXTENSION)
      ? rawExt
      : isPlaylistUrl(match.canonicalUrl)
        ? 'm3u8'
        : isDashUrl(match.canonicalUrl)
          ? DASH_EXTENSION
          : match.inferredExtension || 'mp4';

  let mimeType: string;
  if (match.inferredMime) {
    mimeType = match.inferredMime;
  } else if (extension === DASH_EXTENSION) {
    mimeType = DASH_MIME_TYPE;
  } else if (extension === 'm3u8' || extension === 'ts') {
    mimeType = 'application/vnd.apple.mpegurl';
  } else if (AUDIO_EXTENSIONS.has(extension)) {
    mimeType = `audio/${extension}`;
  } else {
    mimeType = `video/${extension}`;
  }

  return {
    id: `pasted-${match.canonicalUrl}`,
    pageUrl: match.canonicalUrl,
    mediaUrl: match.canonicalUrl,
    title: titleFromUrl(match.canonicalUrl),
    mimeType,
    extension,
    source: 'JS',
    confidence: 0.85,
  };
}
