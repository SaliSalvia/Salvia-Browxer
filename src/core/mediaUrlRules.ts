export const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'avi',
  '3gp',
  '3g2',
  'm4v',
  'mkv',
  'flv',
  'ogv',
  'mpg',
  'mpeg',
  'wmv',
  'f4v',
  'm2ts',
  'mts',
  'vob',
  'asf',
]);

export const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'm4b',
  'aac',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'mka',
  'wma',
  'aif',
  'aiff',
  'amr',
  'ac3',
]);

export const PLAYLIST_EXTENSIONS = new Set(['m3u8', 'ts']);

export const MEDIA_EXTENSIONS = new Set([
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...PLAYLIST_EXTENSIONS,
]);

export const DASH_EXTENSION = 'mpd';
export const DASH_MIME_TYPE = 'application/dash+xml';

export const PLAYLIST_MIME_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
]);

export const SEGMENT_MIME_TYPES = new Set(['video/mp2t']);
export const SEGMENT_EXTENSIONS = new Set(['ts', 'm4s', 'cmfv', 'cmfa', 'cmft', 'mp4a']);

export const WEAK_MEDIA_MIME_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/download',
  'application/x-download',
  'application/force-download',
]);

export const NON_MEDIA_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
  'heic',
  'css',
  'js',
  'mjs',
  'map',
  'json',
  'webmanifest',
  'xml',
  'txt',
  'html',
  'htm',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'pdf',
  'zip',
  'gz',
  'vtt',
  'srt',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'csv',
]);

const SEGMENT_QUERY_MARKERS = ['bytestart=', 'byteend='];

export function normalizeMime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.split(';')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return cleaned || null;
}

export function pathExtension(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null;
  const path = url.split('#')[0].split('?')[0];
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot <= slash || dot === path.length - 1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  if (ext.length >= 1 && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) {
    return ext;
  }
  return null;
}

export function hasMediaExtension(url: string): boolean {
  const ext = pathExtension(url);
  return ext !== null && MEDIA_EXTENSIONS.has(ext);
}

export function isVideoMime(mimeType: string | null | undefined): boolean {
  const norm = normalizeMime(mimeType);
  return norm !== null && norm.startsWith('video/');
}

export function isAudioMime(mimeType: string | null | undefined): boolean {
  const norm = normalizeMime(mimeType);
  return norm !== null && norm.startsWith('audio/');
}

export function isPlaylistMime(mimeType: string | null | undefined): boolean {
  const norm = normalizeMime(mimeType);
  return norm !== null && PLAYLIST_MIME_TYPES.has(norm);
}

export function isDashMime(mimeType: string | null | undefined): boolean {
  return normalizeMime(mimeType) === DASH_MIME_TYPE;
}

export function isSegmentMime(mimeType: string | null | undefined): boolean {
  const norm = normalizeMime(mimeType);
  return norm !== null && SEGMENT_MIME_TYPES.has(norm);
}

export function isWeakMediaMime(mimeType: string | null | undefined): boolean {
  const norm = normalizeMime(mimeType);
  return norm !== null && WEAK_MEDIA_MIME_TYPES.has(norm);
}

export function isMediaMime(mimeType: string | null | undefined): boolean {
  const mime = normalizeMime(mimeType);
  if (!mime || isSegmentMime(mime)) return false;
  return mime.startsWith('video/') || mime.startsWith('audio/') || PLAYLIST_MIME_TYPES.has(mime);
}

export function isDashUrl(url: string, mimeType?: string | null): boolean {
  return pathExtension(url) === DASH_EXTENSION || isDashMime(mimeType);
}

export function isPlaylistUrl(url: string, mimeType?: string | null): boolean {
  if (isPlaylistMime(mimeType)) return true;
  const path = url.split('#')[0].split('?')[0].toLowerCase();
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!name) return false;
  if (name.endsWith('.json') || name.endsWith('.webmanifest') || name.endsWith('.xml')) return false;
  if (name.endsWith('.m3u8')) return true;
  return name === 'manifest' || name.startsWith('manifest.');
}

export function looksLikeNonMedia(url: string): boolean {
  const ext = pathExtension(url);
  if (ext && NON_MEDIA_EXTENSIONS.has(ext)) return true;
  const path = url.split('#')[0].split('?')[0].toLowerCase();
  return path.endsWith('.webmanifest');
}

export function looksLikeSegment(url: string): boolean {
  const ext = pathExtension(url);
  if (ext && SEGMENT_EXTENSIONS.has(ext)) return true;
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return false;
  const query = url.slice(qIdx + 1).toLowerCase();
  return SEGMENT_QUERY_MARKERS.some((marker) => query.includes(marker));
}

export function extensionForMime(mimeType: string | null | undefined): string | null {
  const mime = normalizeMime(mimeType);
  if (!mime) return null;
  if (PLAYLIST_MIME_TYPES.has(mime)) return 'm3u8';
  if (mime === DASH_MIME_TYPE) return 'mpd';
  if (mime.startsWith('video/mp4')) return 'mp4';
  if (mime.startsWith('video/webm')) return 'webm';
  if (mime.startsWith('video/quicktime')) return 'mov';
  if (mime.startsWith('video/x-matroska')) return 'mkv';
  if (mime.startsWith('video/x-flv')) return 'flv';
  if (mime.startsWith('video/3gpp2')) return '3g2';
  if (mime.startsWith('video/3gpp')) return '3gp';
  if (mime.startsWith('video/ogg')) return 'ogv';
  if (mime.startsWith('video/x-msvideo') || mime.startsWith('video/avi')) return 'avi';
  if (mime.startsWith('video/x-ms-wmv') || mime.startsWith('video/x-ms-asf')) return 'wmv';
  if (mime.startsWith('video/mpeg')) return 'mpg';
  if (mime.startsWith('audio/mpeg')) return 'mp3';
  if (mime.startsWith('audio/mp4') || mime.startsWith('audio/x-m4a')) return 'm4a';
  if (mime.startsWith('audio/aac')) return 'aac';
  if (mime.startsWith('audio/wav') || mime.startsWith('audio/x-wav')) return 'wav';
  if (mime.startsWith('audio/flac') || mime.startsWith('audio/x-flac')) return 'flac';
  if (mime.startsWith('audio/ogg')) return 'ogg';
  if (mime.startsWith('audio/opus')) return 'opus';
  if (mime.startsWith('audio/x-matroska')) return 'mka';
  if (mime.startsWith('audio/x-ms-wma')) return 'wma';
  if (mime.startsWith('audio/aiff') || mime.startsWith('audio/x-aiff')) return 'aiff';
  if (mime.startsWith('audio/amr')) return 'amr';
  if (mime.startsWith('audio/ac3')) return 'ac3';
  return null;
}
