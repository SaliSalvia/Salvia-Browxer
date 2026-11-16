import { sanitizeFilename } from './mediaResolver';
import {
  apiUrl,
  getSalviaNative,
  isNativeAndroid,
  registerNativeDownloadListener,
} from './nativeBridge';

export interface ActiveTransferCallbacks {
  onProgress: (downloadedBytes: number, totalBytes: number | null, bytesPerSecond: number, etaSeconds: number | null) => void;
  onComplete: (blobUrl: string, finalSize: number, mimeType: string, nativeUri?: string | null) => void;
  onError: (message: string) => void;
  onPaused: () => void;
  onCancelled: () => void;
}

export interface TransferOptions {
  filename?: string;
  parallelConnections?: number;
  autoSaveToGallery?: boolean;
  audioTrackUrl?: string | null;
  referer?: string | null;
}

const activeControllers = new Map<string, { controller: AbortController; reason: 'pause' | 'cancel' | null }>();
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

export function releaseBlobUrl(downloadId: string): void {
  const url = completedBlobUrls.get(downloadId);
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
  completedBlobUrls.delete(downloadId);
}

async function fetchHlsSegments(
  playlistUrl: string,
  signal: AbortSignal,
  onBytes: (downloaded: number, total: number | null) => void,
  referer?: string | null
): Promise<{ blob: Blob; mimeType: string }> {
  const refParam = referer ? `&referer=${encodeURIComponent(referer)}` : '';
  const playlistRes = await fetch(apiUrl(`/api/media/fetch?url=${encodeURIComponent(playlistUrl)}${refParam}`), { signal });
  if (!playlistRes.ok) throw new Error(`HTTP ${playlistRes.status}`);
  const text = await playlistRes.text();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (lines.length === 0) throw new Error('Empty playlist');

  const segmentUrls = lines.map((line) => new URL(line, playlistUrl).href);
  const chunks: Uint8Array[] = new Array(segmentUrls.length);
  let downloaded = 0;

  let nextIdx = 0;
  const workerCount = Math.min(3, segmentUrls.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= segmentUrls.length) break;
        const segRes = await fetch(apiUrl(`/api/media/fetch?url=${encodeURIComponent(segmentUrls[idx])}${refParam}`), { signal });
        if (!segRes.ok) throw new Error(`Segment HTTP ${segRes.status}`);
        const buf = new Uint8Array(await segRes.arrayBuffer());
        chunks[idx] = buf;
        downloaded += buf.byteLength;
        const estimatedTotal = Math.round((downloaded / (idx + 1)) * segmentUrls.length);
        onBytes(downloaded, estimatedTotal);
      }
    })
  );

  const blobParts: BlobPart[] = chunks.map(
    (chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
  );
  const blob = new Blob(blobParts, { type: 'video/mp2t' });
  return { blob, mimeType: 'video/mp4' };
}

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
  const refParam = referer ? `&referer=${encodeURIComponent(referer)}` : '';
  const res = await fetch(apiUrl(`/api/media/fetch?url=${encodeURIComponent(cleanUrl)}${refParam}`), { signal });
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

  const videoReps = reps
    .filter((r) => !r.mime.startsWith('audio/'))
    .sort((a, b) => b.bw - a.bw);
  const picked = (desiredRep ? reps.find((r) => r.id === desiredRep) : null) || videoReps[0] || reps[0];
  if (!picked) throw new Error('No DASH representation found');

  const segmentUrls: string[] = [];
  if (picked.list) {
    const init = picked.list.querySelector('Initialization')?.getAttribute('sourceURL');
    if (init) segmentUrls.push(new URL(init, cleanUrl).href);
    picked.list.querySelectorAll('SegmentURL').forEach((s) => {
      const m = s.getAttribute('media');
      if (m) segmentUrls.push(new URL(m, cleanUrl).href);
    });
  } else if (picked.tpl) {
    const initTpl = picked.tpl.getAttribute('initialization');
    const mediaTpl = picked.tpl.getAttribute('media');
    const startNum = Number(picked.tpl.getAttribute('startNumber') || 1);
    const expand = (t: string, num: number, time: number) =>
      t
        .replace(/\$RepresentationID\$/g, picked.id)
        .replace(/\$Bandwidth\$/g, String(picked.bw))
        .replace(/\$Number\$/g, String(num))
        .replace(/\$Number%0(\d+)d\$/g, (_, p) => String(num).padStart(Number(p), '0'))
        .replace(/\$Time\$/g, String(time));
    if (initTpl) segmentUrls.push(new URL(expand(initTpl, startNum, 0), cleanUrl).href);
    const timeline = Array.from(picked.tpl.querySelectorAll('SegmentTimeline > S'));
    if (mediaTpl && timeline.length > 0) {
      let num = startNum;
      let tCursor = 0;
      for (const s of timeline) {
        const tAttr = s.getAttribute('t');
        if (tAttr !== null) tCursor = Number(tAttr);
        const d = Number(s.getAttribute('d') || 0);
        const r = Number(s.getAttribute('r') || 0);
        const count = Math.max(1, r + 1);
        for (let i = 0; i < count; i++) {
          segmentUrls.push(new URL(expand(mediaTpl, num, tCursor), cleanUrl).href);
          num++;
          tCursor += d;
        }
      }
    }
  } else if (picked.base) {
    segmentUrls.push(new URL(picked.base, cleanUrl).href);
  }

  if (segmentUrls.length === 0) throw new Error('Empty DASH segment plan');
  const chunks: Uint8Array[] = new Array(segmentUrls.length);
  let downloaded = 0;
  let nextIdx = 0;
  const workerCount = Math.min(3, segmentUrls.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= segmentUrls.length) break;
        const segRes = await fetch(
          apiUrl(`/api/media/fetch?url=${encodeURIComponent(segmentUrls[idx])}${refParam}`),
          { signal }
        );
        if (!segRes.ok) throw new Error(`DASH segment HTTP ${segRes.status}`);
        const buf = new Uint8Array(await segRes.arrayBuffer());
        chunks[idx] = buf;
        downloaded += buf.byteLength;
        onBytes(downloaded, Math.round((downloaded / (idx + 1)) * segmentUrls.length));
      }
    })
  );
  const blobParts: BlobPart[] = chunks.map(
    (c) => c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer
  );
  return { blob: new Blob(blobParts, { type: 'video/mp4' }), mimeType: 'video/mp4' };
}

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
  const state = { controller, reason: null as 'pause' | 'cancel' | null };
  activeControllers.set(downloadId, state);

  const startedAt = performance.now();
  let lastReportAt = startedAt;

  const reportSpeed = (downloadedBytes: number, totalBytes: number | null, force = false) => {
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
    const refParam = options?.referer ? `&referer=${encodeURIComponent(options.referer)}` : '';
    if (isHls) {
      const { blob, mimeType: outMime } = await fetchHlsSegments(url, controller.signal, (dl, estTotal) => {
        reportSpeed(dl, estTotal);
      }, options?.referer);
      const blobUrl = URL.createObjectURL(blob);
      completedBlobUrls.set(downloadId, blobUrl);
      callbacks.onComplete(blobUrl, blob.size, outMime, null);
      return;
    }

    if (isDash) {
      const { blob, mimeType: outMime } = await fetchDashSegments(url, controller.signal, (dl, estTotal) => {
        reportSpeed(dl, estTotal);
      }, options?.referer);
      const blobUrl = URL.createObjectURL(blob);
      completedBlobUrls.set(downloadId, blobUrl);
      callbacks.onComplete(blobUrl, blob.size, outMime, null);
      return;
    }

    const res = await fetch(apiUrl(`/api/media/fetch?url=${encodeURIComponent(url)}${refParam}`), {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const headerTotal = Number(res.headers.get('content-length') || 0) || null;
    const contentType = res.headers.get('content-type') || mimeType || 'application/octet-stream';

    if (!res.body) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      completedBlobUrls.set(downloadId, blobUrl);
      callbacks.onComplete(blobUrl, blob.size, contentType, null);
      return;
    }

    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        downloaded += value.byteLength;
        reportSpeed(downloaded, headerTotal);
      }
    }

    reportSpeed(downloaded, headerTotal ?? downloaded, true);
    const blobParts: BlobPart[] = parts.map(
      (part) => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
    );
    const blob = new Blob(blobParts, { type: contentType });
    const blobUrl = URL.createObjectURL(blob);
    completedBlobUrls.set(downloadId, blobUrl);
    callbacks.onComplete(blobUrl, blob.size, contentType, null);
  } catch (err) {
    if (state.reason === 'pause') {
      callbacks.onPaused();
    } else if (state.reason === 'cancel') {
      callbacks.onCancelled();
    } else if (err instanceof DOMException && err.name === 'AbortError') {
      callbacks.onPaused();
    } else {
      callbacks.onError(err instanceof Error ? err.message : 'Download failed');
    }
  } finally {
    activeControllers.delete(downloadId);
  }
}
