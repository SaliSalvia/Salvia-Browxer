import {
  AUDIO_EXTENSIONS,
  DASH_EXTENSION,
  PLAYLIST_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isAudioMime,
  isDashUrl,
  isPlaylistMime,
  isVideoMime,
  normalizeMime,
} from './mediaUrlRules';

export type MediaKind = 'VIDEO' | 'AUDIO' | 'PLAYLIST';
export type UnsupportedMedia = 'DASH' | 'LIVE' | 'BLOB_STREAM';

export function kindOfMedia(
  mimeType: string | null | undefined,
  extension: string | null | undefined
): MediaKind | null {
  const mime = normalizeMime(mimeType);
  const ext = extension?.toLowerCase() ?? null;
  if ((ext && PLAYLIST_EXTENSIONS.has(ext)) || isPlaylistMime(mime)) return 'PLAYLIST';
  if (isVideoMime(mime) || (ext && VIDEO_EXTENSIONS.has(ext))) return 'VIDEO';
  if (isAudioMime(mime) || (ext && AUDIO_EXTENSIONS.has(ext))) return 'AUDIO';
  return null;
}

export function isDashMedia(
  url: string,
  mimeType: string | null | undefined,
  extension: string | null | undefined
): boolean {
  return extension?.toLowerCase() === DASH_EXTENSION || isDashUrl(url, mimeType);
}

export function unsupportedReasonFor(params: {
  url: string;
  mimeType?: string | null;
  extension?: string | null;
  isLive?: boolean;
  isMediaSource?: boolean;
  isBlobFile?: boolean;
  dashIsSupported?: boolean;
}): UnsupportedMedia | null {
  if (isDashMedia(params.url, params.mimeType, params.extension)) {
    return params.dashIsSupported ? null : 'DASH';
  }
  if (params.isLive) return 'LIVE';
  if (params.url.startsWith('blob:') && (params.isMediaSource || !params.isBlobFile)) {
    return 'BLOB_STREAM';
  }
  return null;
}
