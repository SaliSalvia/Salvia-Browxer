import { sanitizeFilename } from './mediaResolver';
import {
  apiUrl,
  getSalviaNative,
  isNativeAndroid,
  registerNativeDownloadListener,
} from './nativeBridge';

export interface ActiveTransferCallbacks {
  onProgress: (
    downloadedBytes: number,
    totalBytes: number | null,
    bytesPerSecond: number,
    etaSeconds: number | null
  ) => void;
  onComplete: (
    blobUrl: string,
    finalSize: number,
    mimeType: string,
    nativeUri?: string | null
  ) => void;
  onError: (message: string) => void;
  onPaused: (downloadedBytes?: number) => void;
  onCancelled: (downloadedBytes?: number) => void;
}

export interface TransferOptions {
  filename?: string;
  parallelConnections?: number;
  autoSaveToGallery?: boolean;
  audioTrackUrl?: string | null;
  referer?: string | null;
  /** Byte offset already present in the queue row; only used for direct files. */
  resumeFrom?: number;
}

const activeControllers = new Map<
  string,
  { controller: AbortController; reason: 'pause' | 'cancel' | null; downloadedBytes: number }
>();
const nativeCallbacks = new Map<string, ActiveTransferCallbacks>();
const completedBlobUrls = new Map<string, string>();

let nativeListenerRegistered = false;
function ensureNativeListener(): void {
  if (nativeListenerRegistered) return;
  nativeListenerRegistered = true;
  registerNativeDownloadListener((ev) => {
    const cb = nativeCallbacks.get(ev.id);
    if (!cb) return;
    if (ev.type === 'progress') {
      cb.onProgress(ev.downloadedBytes, ev.totalBytes, ev.bytesPerSecond, ev.etaSeconds);
    } else if (ev.type === 'complete') {
      completedBlobUrls.set(ev.id, ev.blobUrl);
      nativeCallbacks.delete(ev.id);
      cb.onComplete(ev.blobUrl, ev.finalSize, ev.mimeType, ev.nativeUri ?? null);
    } else if (ev.type === 'paused') {
      nativeCallbacks.delete(ev.id);
      cb.onPaused();
    } else if (ev.type === 'cancelled') {
      nativeCallbacks.delete(ev.id);
      cb.onCancelled();
    } else if (ev.type === 'error') {
      nativeCallbacks.delete(ev.id);
      cb.onError(ev.message);
    }
  });
}

export function getCompletedBlobUrl(downloadId: string): string | null {
  return completedBlobUrls.get(downloadId) ?? null;
}

/** Registers an externally produced blob (for example a finished playback recording). */
export function registerCompletedBlobUrl(downloadId: string, blobUrl: string): void {
  completedBlobUrls.set(downloadId, blobUrl);
}

export function triggerBrowserFileSave(blobUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = sanitizeFilename(filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function pauseTransfer(downloadId: string): void {
  const native = getSalviaNative();
  if (native && nativeCallbacks.has(downloadId)) {
    native.pauseDownload(downloadId);
    return;
  }
  const entry = activeControllers.get(downloadId);
  if (entry) {
    entry.reason = 'pause';
    entry.controller.abort();
  }
}

export function cancelTransfer(downloadId: string): void {
  const native = getSalviaNative();
  if (native && nativeCallbacks.has(downloadId)) {
    native.cancelDownload(downloadId);
    return;
  }
  const entry = activeControllers.get(downloadId);
  if (entry) {
    entry.reason = 'cancel';
    entry.controller.abort();
  }
}

export function discardPartialTransfer(downloadId: string): void {
  partialTransfers.delete(downloadId);
}

export function releaseBlobUrl(downloadId: string): void {
  const url = completedBlobUrls.get(downloadId);
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
  completedBlobUrls.delete(downloadId);
}

/* ------------------------------------------------------------------ *
 * Shared HTTP helpers
 * ------------------------------------------------------------------ */

function proxyUrl(url: string, referer?: string | null): string {
  const ref = referer ? `&referer=${encodeURIComponent(referer)}` : '';
  return apiUrl(`/api/media/fetch?url=${encodeURIComponent(url)}${ref}`);
}

function absolute(base: string, maybeRelative: string): string | null {
  try {
    return new URL(maybeRelative, base).href;
  } catch {
    return null;
  }
}

function parseAttributeList(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const value = m[2] ?? '';
    attrs[m[1].toUpperCase()] = value.startsWith('"') ? value.slice(1, -1) : value.trim();
  }
  return attrs;
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function sequenceIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  let value = Math.max(0, Math.floor(sequence));
  for (let i = 15; i >= 8 && value > 0; i--) {
    iv[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return iv;
}

async function runBounded<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    })
  );
}

/* ------------------------------------------------------------------ *
 * HLS
 * ------------------------------------------------------------------ */

interface HlsKeyReference {
  uri: string;
  iv: Uint8Array | null;
}

interface HlsByteRange {
  offset: number;
  length: number;
}

interface HlsSegmentPlan {
  url: string;
  sequence: number;
  key: HlsKeyReference | null;
  byteRange: HlsByteRange | null;
}

interface HlsMediaPlan {
  initSegment: { url: string; byteRange: HlsByteRange | null; key: HlsKeyReference | null } | null;
  segments: HlsSegmentPlan[];
  isTransportStream: boolean;
}

class UnsupportedMediaError extends Error {}

function findVariantPlaylistLine(lines: string[], fromIndex: number): string | null {
  for (let i = fromIndex + 1; i < lines.length; i++) {
    if (!lines[i].startsWith('#')) return lines[i];
  }
  return null;
}

function parseHlsMediaPlaylist(lines: string[], baseUrl: string): HlsMediaPlan {
  let sequence = 0;
  let pendingRange: { length: number; offset: number | null } | null = null;
  let currentKey: HlsKeyReference | null = null;
  let byteCursor = 0;
  let initSegment: HlsMediaPlan['initSegment'] = null;
  const segments: HlsSegmentPlan[] = [];
  let isTransportStream = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const parsed = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length).trim());
      if (Number.isFinite(parsed) && parsed >= 0) sequence = parsed;
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-KEY:'.length));
      const method = (attrs.METHOD || '').toUpperCase();
      if (!method || method === 'NONE') {
        currentKey = null;
        continue;
      }
      if (method !== 'AES-128') {
        throw new UnsupportedMediaError(
          `HLS_DRM: ${method} encrypted playlists are not downloadable`
        );
      }
      const uri = attrs.URI ? absolute(baseUrl, attrs.URI) : null;
      if (!uri) {
        throw new UnsupportedMediaError('HLS_KEY_MISSING: AES-128 key URI is missing');
      }
      currentKey = { uri, iv: attrs.IV ? hexToBytes(attrs.IV) : null };
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      const uri = attrs.URI ? absolute(baseUrl, attrs.URI) : null;
      if (uri) {
        let byteRange: HlsByteRange | null = null;
        if (attrs.BYTERANGE) {
          const [lengthRaw, offsetRaw] = attrs.BYTERANGE.split('@');
          const length = Number(lengthRaw);
          const offset = offsetRaw ? Number(offsetRaw) : 0;
          if (Number.isFinite(length) && length > 0) {
            byteRange = { offset: Number.isFinite(offset) ? offset : 0, length };
          }
        }
        initSegment = { url: uri, byteRange, key: currentKey };
        // An initialisation segment means fragmented MP4 output.
        if (/\.(mp4|m4s|m4v)(\?|#|$)/i.test(uri)) isTransportStream = false;
      }
      continue;
    }

    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const [lengthRaw, offsetRaw] = line.slice('#EXT-X-BYTERANGE:'.length).split('@');
      const length = Number(lengthRaw);
      const offset = offsetRaw ? Number(offsetRaw) : null;
      if (Number.isFinite(length) && length > 0) {
        pendingRange = { length, offset: offset !== null && Number.isFinite(offset) ? offset : null };
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    const url = absolute(baseUrl, line);
    if (!url) continue;

    let byteRange: HlsByteRange | null = null;
    if (pendingRange) {
      const offset = pendingRange.offset ?? byteCursor;
      byteRange = { offset, length: pendingRange.length };
      byteCursor = offset + pendingRange.length;
      pendingRange = null;
    } else {
      byteCursor = 0;
    }

    if (/\.ts(\?|#|$)/i.test(url)) isTransportStream = true;

    segments.push({ url, sequence, key: currentKey, byteRange });
    sequence += 1;
  }

  return { initSegment, segments, isTransportStream };
}

function pickBestVariant(lines: string[], baseUrl: string): string | null {
  let best: { url: string; bandwidth: number; height: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
    const nextUrl = findVariantPlaylistLine(lines, i);
    if (!nextUrl) continue;
    const resolved = absolute(baseUrl, nextUrl);
    if (!resolved) continue;
    if (attrs.AUDIO) {
      throw new UnsupportedMediaError(
        'HLS_SEPARATE_AUDIO: this variant keeps audio in a separate rendition, which this build does not mux'
      );
    }
    const bandwidth = Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0) || 0;
    const resolution = (attrs.RESOLUTION || '').split('x');
    const height = Number(resolution[1] || 0) || 0;
    if (!best || height > best.height || (height === best.height && bandwidth > best.bandwidth)) {
      best = { url: resolved, bandwidth, height };
    }
  }
  return best?.url ?? null;
}

async function decryptAes128(
  data: Uint8Array,
  keyUri: string,
  iv: Uint8Array,
  referer: string | null | undefined,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (data.byteLength === 0) return data;
  if (data.byteLength % 16 !== 0) {
    throw new UnsupportedMediaError('HLS_DECRYPT: encrypted segment length is not a multiple of 16');
  }
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new UnsupportedMediaError('HLS_DECRYPT: WebCrypto is unavailable in this runtime');
  }
  const keyRes = await fetch(proxyUrl(keyUri, referer), { signal });
  if (!keyRes.ok) {
    throw new UnsupportedMediaError(`HLS_KEY_HTTP: key request failed with HTTP ${keyRes.status}`);
  }
  const rawKey = new Uint8Array(await keyRes.arrayBuffer());
  if (rawKey.byteLength !== 16) {
    throw new UnsupportedMediaError('HLS_KEY_INVALID: AES-128 keys must be 16 bytes');
  }
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, [
    'decrypt',
  ]);
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivBuffer },
    cryptoKey,
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  );
  return new Uint8Array(plain);
}

async function fetchHlsSegments(
  playlistUrl: string,
  signal: AbortSignal,
  onBytes: (downloaded: number, total: number | null) => void,
  referer?: string | null
): Promise<{ blob: Blob; mimeType: string }> {
  const first = await fetch(proxyUrl(playlistUrl, referer), { signal });
  if (!first.ok) throw new Error(`HTTP ${first.status}`);
  let playlistUrlResolved = first.url && first.url.startsWith('http') ? first.url : playlistUrl;
  let text = await first.text();

  if (!text.includes('#EXTM3U')) {
    throw new Error('HLS_INVALID: the response is not an HLS playlist');
  }

  // Follow a master playlist down to its highest quality variant.
  if (text.includes('#EXT-X-STREAM-INF:')) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const variantUrl = pickBestVariant(lines, playlistUrlResolved);
    if (!variantUrl) throw new Error('HLS_EMPTY: the master playlist lists no playable variant');
    const variantRes = await fetch(proxyUrl(variantUrl, referer), { signal });
    if (!variantRes.ok) throw new Error(`HTTP ${variantRes.status}`);
    playlistUrlResolved = variantUrl;
    text = await variantRes.text();
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (text.includes('#EXT-X-PLAYLIST-TYPE:VOD') === false && !text.includes('#EXT-X-ENDLIST')) {
    if (text.includes('#EXT-X-TARGETDURATION')) {
      throw new UnsupportedMediaError('HLS_LIVE: live playlists cannot be downloaded as a file');
    }
  }

  const plan = parseHlsMediaPlaylist(lines, playlistUrlResolved);
  if (plan.segments.length === 0) throw new Error('HLS_EMPTY: the playlist contains no segments');

  const chunks: Uint8Array[] = new Array(plan.segments.length);
  let downloaded = 0;

  const fetchRange = async (
    url: string,
    byteRange: HlsByteRange | null
  ): Promise<Uint8Array> => {
    const headers: Record<string, string> = {};
    if (byteRange) {
      headers.Range = `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`;
    }
    const res = await fetch(proxyUrl(url, referer), { signal, headers });
    if (!res.ok) throw new Error(`Segment HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };

  let initBytes: Uint8Array | null = null;
  if (plan.initSegment) {
    const rawInit = await fetchRange(plan.initSegment.url, plan.initSegment.byteRange);
    initBytes =
      plan.initSegment.key && plan.initSegment.key.uri
        ? await decryptAes128(
            rawInit,
            plan.initSegment.key.uri,
            plan.initSegment.key.iv ?? new Uint8Array(16),
            referer,
            signal
          )
        : rawInit;
    downloaded += initBytes.byteLength;
  }

  await runBounded(plan.segments, 3, async (segment, index) => {
    const raw = await fetchRange(segment.url, segment.byteRange);
    const bytes = segment.key
      ? await decryptAes128(
          raw,
          segment.key.uri,
          segment.key.iv ?? sequenceIv(segment.sequence),
          referer,
          signal
        )
      : raw;
    chunks[index] = bytes;
    downloaded += bytes.byteLength;
    onBytes(downloaded, null);
  });

  const usable = chunks.filter((chunk) => chunk && chunk.byteLength > 0);
  if (usable.length === 0) throw new Error('HLS_EMPTY: no segment could be downloaded');

  const ordered: Uint8Array[] = initBytes ? [initBytes, ...usable] : usable;
  const blobParts: BlobPart[] = ordered.map(
    (chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
  );
  const mimeType = plan.isTransportStream ? 'video/mp2t' : 'video/mp4';
  return { blob: new Blob(blobParts, { type: mimeType }), mimeType };
}

/* ------------------------------------------------------------------ *
 * DASH
 * ------------------------------------------------------------------ */

async function fetchDashSegments(
  mpdUrl: string,
  signal: AbortSignal,
  onBytes: (downloaded: number, total: number | null) => void,
  referer?: string | null
): Promise<{ blob: Blob; mimeType: string }> {
  const cleanUrl = mpdUrl.split('#')[0];
  const desiredRep = mpdUrl.includes('#salvia_rep=')
    ? decodeURIComponent(mpdUrl.split('#salvia_rep=')[1] || '')
    : null;
  const res = await fetch(proxyUrl(cleanUrl, referer), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  if (typeof DOMParser === 'undefined') {
    return { blob: new Blob([xml], { type: 'application/dash+xml' }), mimeType: 'application/dash+xml' };
  }

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const reps = Array.from(doc.querySelectorAll('AdaptationSet')).flatMap((set) => {
    const setMime = (set.getAttribute('mimeType') || '').toLowerCase();
    const setTpl = set.querySelector(':scope > SegmentTemplate');
    const setBase = set.querySelector(':scope > BaseURL')?.textContent?.trim() || null;
    return Array.from(set.querySelectorAll('Representation')).map((rep) => ({
      id: rep.getAttribute('id') || '',
      mime: (rep.getAttribute('mimeType') || setMime || '').toLowerCase(),
      bw: Number(rep.getAttribute('bandwidth') || 0),
      tpl: rep.querySelector('SegmentTemplate') || setTpl,
      list: rep.querySelector('SegmentList'),
      base: rep.querySelector('BaseURL')?.textContent?.trim() || setBase,
    }));
  });

  const audioReps = reps.filter((rep) => rep.mime.startsWith('audio/'));
  const videoReps = reps.filter((rep) => !rep.mime.startsWith('audio/')).sort((a, b) => b.bw - a.bw);
  const picked = (desiredRep ? reps.find((rep) => rep.id === desiredRep) : null) || videoReps[0] || reps[0];
  if (!picked) throw new Error('No DASH representation found');

  const pickedIsProgressive = !picked.tpl && !picked.list && Boolean(picked.base);
  if (!picked.mime.startsWith('audio/') && audioReps.length > 0) {
    throw new UnsupportedMediaError(
      'DASH_SEPARATE_AUDIO: this manifest stores audio in a separate track, which this build does not mux into the video file. Download the audio track from the quality sheet, or use the Android app where the tracks are merged.'
    );
  }
  if (pickedIsProgressive && picked.base) {
    const directUrl = absolute(cleanUrl, picked.base);
    if (!directUrl) throw new Error('DASH_INVALID: BaseURL could not be resolved');
    const directRes = await fetch(proxyUrl(directUrl, referer), { signal });
    if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
    const bytes = new Uint8Array(await directRes.arrayBuffer());
    onBytes(bytes.byteLength, bytes.byteLength);
    return {
      blob: new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: picked.mime || 'video/mp4',
      }),
      mimeType: picked.mime || 'video/mp4',
    };
  }

  const segmentUrls: string[] = [];
  if (picked.list) {
    const init = picked.list.querySelector('Initialization')?.getAttribute('sourceURL');
    if (init) segmentUrls.push(new URL(init, cleanUrl).href);
    picked.list.querySelectorAll('SegmentURL').forEach((s) => {
      const media = s.getAttribute('media');
      if (media) segmentUrls.push(new URL(media, cleanUrl).href);
    });
  } else if (picked.tpl) {
    const initTpl = picked.tpl.getAttribute('initialization');
    const mediaTpl = picked.tpl.getAttribute('media');
    const startNum = Number(picked.tpl.getAttribute('startNumber') || 1);
    const expand = (template: string, num: number, time: number) =>
      template
        .replace(/\$RepresentationID\$/g, picked.id)
        .replace(/\$Bandwidth\$/g, String(picked.bw))
        .replace(/\$Number\$/g, String(num))
        .replace(/\$Number%0(\d+)d\$/g, (_, p) => String(num).padStart(Number(p), '0'))
        .replace(/\$Time\$/g, String(time));
    if (initTpl) segmentUrls.push(new URL(expand(initTpl, startNum, 0), cleanUrl).href);
    const timeline = Array.from(picked.tpl.querySelectorAll('SegmentTimeline > S'));
    if (mediaTpl && timeline.length > 0) {
      let num = startNum;
      let cursor = 0;
      for (const s of timeline) {
        const tAttr = s.getAttribute('t');
        if (tAttr !== null) cursor = Number(tAttr);
        const d = Number(s.getAttribute('d') || 0);
        const r = Number(s.getAttribute('r') || 0);
        const count = Math.max(1, r + 1);
        for (let i = 0; i < count; i++) {
          segmentUrls.push(new URL(expand(mediaTpl, num, cursor), cleanUrl).href);
          num++;
          cursor += d;
        }
      }
    } else if (mediaTpl) {
      const duration = Number(picked.tpl.getAttribute('duration') || 0);
      const timescale = Number(picked.tpl.getAttribute('timescale') || 1) || 1;
      const period = Number(doc.querySelector('Period')?.getAttribute('duration') || 0);
      if (duration > 0 && period > 0) {
        const count = Math.max(1, Math.round((period * timescale) / duration));
        for (let i = 0; i < count; i++) {
          segmentUrls.push(new URL(expand(mediaTpl, startNum + i, i * duration), cleanUrl).href);
        }
      }
    }
  } else if (picked.base) {
    segmentUrls.push(new URL(picked.base, cleanUrl).href);
  }

  if (segmentUrls.length === 0) throw new Error('Empty DASH segment plan');
  const chunks: Uint8Array[] = new Array(segmentUrls.length);
  let downloaded = 0;
  await runBounded(segmentUrls, 3, async (url, index) => {
    const segRes = await fetch(proxyUrl(url, referer), { signal });
    if (!segRes.ok) throw new Error(`DASH segment HTTP ${segRes.status}`);
    const bytes = new Uint8Array(await segRes.arrayBuffer());
    chunks[index] = bytes;
    downloaded += bytes.byteLength;
    onBytes(downloaded, null);
  });

  const blobParts: BlobPart[] = chunks
    .filter((chunk) => chunk && chunk.byteLength > 0)
    .map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
  return { blob: new Blob(blobParts, { type: 'video/mp4' }), mimeType: 'video/mp4' };
}

/* ------------------------------------------------------------------ *
 * Transfer entry point
 * ------------------------------------------------------------------ */

function isDashTransfer(url: string, mimeType: string, isHls: boolean): boolean {
  if (isHls) return false;
  const loweredMime = mimeType.toLowerCase();
  const cleanUrl = url.split('#')[0].toLowerCase();
  return loweredMime.includes('dash+xml') || cleanUrl.endsWith('.mpd');
}

/**
 * Partial bytes of a paused direct transfer, kept only for the lifetime of this
 * page. A browser build has no filesystem to persist them to, so a resume after
 * a reload honestly restarts from zero instead of producing a truncated file.
 */
interface PartialTransfer {
  url: string;
  bytes: number;
  parts: Uint8Array[];
}
const partialTransfers = new Map<string, PartialTransfer>();

export async function startTransfer(
  downloadId: string,
  url: string,
  isHls: boolean,
  mimeType: string,
  callbacks: ActiveTransferCallbacks,
  options?: TransferOptions
): Promise<void> {
  const isDash =
    !isHls &&
    (mimeType.toLowerCase().includes('dash+xml') ||
      url.split('#')[0].toLowerCase().includes('.mpd'));

  const native = getSalviaNative();
  if (native && isNativeAndroid()) {
    ensureNativeListener();
    nativeCallbacks.set(downloadId, callbacks);
    const safeName = sanitizeFilename(options?.filename || 'media.mp4');
    const safeMime = isDash ? 'application/dash+xml' : mimeType || 'video/mp4';
    const conns = options?.parallelConnections ?? 4;
    const autoSave = options?.autoSaveToGallery ?? true;
    const audioTrack = options?.audioTrackUrl ?? null;
    const referer = options?.referer ?? null;
    if (typeof native.startDownloadWithReferer === 'function') {
      native.startDownloadWithReferer(downloadId, url, safeName, safeMime, isHls, conns, autoSave, audioTrack, referer);
    } else {
      native.startDownload(downloadId, url, safeName, safeMime, isHls, conns, autoSave, audioTrack);
    }
    return;
  }

  const controller = new AbortController();
  const state = {
    controller,
    reason: null as 'pause' | 'cancel' | null,
    downloadedBytes: 0,
  };
  activeControllers.set(downloadId, state);

  const startedAt = performance.now();
  let lastReportAt = startedAt;
  let resumeOffset = 0;
  const bufferedParts: Uint8Array[] = [];

  const reportSpeed = (downloadedBytes: number, totalBytes: number | null, force = false) => {
    state.downloadedBytes = downloadedBytes;
    const now = performance.now();
    if (!force && now - lastReportAt < 250) return;
    lastReportAt = now;
    const elapsedSec = Math.max(0.1, (now - startedAt) / 1000);
    const speed = Math.round(downloadedBytes / elapsedSec);
    const eta =
      totalBytes && totalBytes > downloadedBytes && speed > 0
        ? Math.ceil((totalBytes - downloadedBytes) / speed)
        : null;
    callbacks.onProgress(downloadedBytes, totalBytes, speed, eta);
  };

  try {
    if (isHls) {
      const { blob, mimeType: outMime } = await fetchHlsSegments(
        url,
        controller.signal,
        (dl, estTotal) => reportSpeed(dl, estTotal),
        options?.referer
      );
      const blobUrl = URL.createObjectURL(blob);
      completedBlobUrls.set(downloadId, blobUrl);
      callbacks.onComplete(blobUrl, blob.size, outMime, null);
      return;
    }

    if (isDashTransfer(url, mimeType, isHls)) {
      const { blob, mimeType: outMime } = await fetchDashSegments(
        url,
        controller.signal,
        (dl, estTotal) => reportSpeed(dl, estTotal),
        options?.referer
      );
      const blobUrl = URL.createObjectURL(blob);
      completedBlobUrls.set(downloadId, blobUrl);
      callbacks.onComplete(blobUrl, blob.size, outMime, null);
      return;
    }

    const pending = partialTransfers.get(downloadId);
    const requestedOffset = Math.max(0, Math.floor(options?.resumeFrom ?? 0));
    const buffered = pending && pending.url === url ? pending.bytes : 0;
    const keptParts = pending && pending.url === url ? pending.parts : [];
    if (pending && pending.url !== url) partialTransfers.delete(downloadId);
    // Only resume when the bytes we already hold match the offset the row reports.
    const offset = buffered > 0 && requestedOffset === buffered ? buffered : 0;
    if (offset === 0) partialTransfers.delete(downloadId);

    const headers: Record<string, string> = {};
    if (offset > 0) headers.Range = `bytes=${offset}-`;
    const res = await fetch(proxyUrl(url, options?.referer), {
      signal: controller.signal,
      headers,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    // The proxy mirrors upstream status; only honour the offset when the server really resumed.
    resumeOffset = res.status === 206 ? offset : 0;
    const carriedParts: Uint8Array[] = resumeOffset > 0 ? keptParts : [];
    const headerTotal = Number(res.headers.get('content-length') || 0) || null;
    const declaredTotal = headerTotal !== null ? headerTotal + resumeOffset : null;
    const contentType = res.headers.get('content-type') || mimeType || 'application/octet-stream';

    if (!res.body) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      completedBlobUrls.set(downloadId, blobUrl);
      partialTransfers.delete(downloadId);
      callbacks.onComplete(blobUrl, blob.size, contentType, null);
      return;
    }

    const reader = res.body.getReader();
    const parts: Uint8Array[] = bufferedParts;
    for (const carried of carriedParts) parts.push(carried);
    let received = 0;
    if (resumeOffset > 0) reportSpeed(resumeOffset, declaredTotal, true);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        received += value.byteLength;
        reportSpeed(resumeOffset + received, declaredTotal);
      }
    }

    const blobParts: BlobPart[] = parts.map(
      (part) => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
    );
    const blob = new Blob(blobParts, { type: contentType });
    reportSpeed(blob.size, blob.size, true);
    const blobUrl = URL.createObjectURL(blob);
    completedBlobUrls.set(downloadId, blobUrl);
    partialTransfers.delete(downloadId);
    callbacks.onComplete(blobUrl, blob.size, contentType, null);
  } catch (err) {
    if (state.reason === 'pause') {
      if (!isHls && !isDash) {
        // Keep what we already streamed so the next press of Resume continues
        // exactly where this transfer stopped instead of corrupting the file.
        partialTransfers.set(downloadId, {
          url,
          bytes: state.downloadedBytes,
          parts: bufferedParts.slice(),
        });
      }
      callbacks.onPaused(state.downloadedBytes);
    } else if (state.reason === 'cancel') {
      partialTransfers.delete(downloadId);
      callbacks.onCancelled(state.downloadedBytes);
    } else if (err instanceof DOMException && err.name === 'AbortError') {
      callbacks.onPaused(state.downloadedBytes);
    } else if (err instanceof UnsupportedMediaError) {
      partialTransfers.delete(downloadId);
      callbacks.onError(err.message);
    } else {
      partialTransfers.delete(downloadId);
      callbacks.onError(err instanceof Error ? err.message : 'Download failed');
    }
  } finally {
    activeControllers.delete(downloadId);
  }
}
