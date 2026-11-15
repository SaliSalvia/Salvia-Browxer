export interface SalviaNativeApi {
  isAndroidApp: () => boolean;
  getApiBase: () => string;
  startDownload: (
    id: string,
    url: string,
    filename: string,
    mimeType: string,
    isHls: boolean,
    parallelConnections: number,
    autoSaveToGallery: boolean,
    audioTrackUrl?: string | null
  ) => void;
  startDownloadWithReferer?: (
    id: string,
    url: string,
    filename: string,
    mimeType: string,
    isHls: boolean,
    parallelConnections: number,
    autoSaveToGallery: boolean,
    audioTrackUrl: string | null,
    referer: string | null
  ) => void;
  pauseDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  openNativeFile: (uriString: string, mimeType: string) => boolean;
  shareNativeFile: (uriString: string, title: string, mimeType: string) => boolean;
  minimizeApp: () => void;
}

export type NativeDownloadEvent =
  | {
      type: 'progress';
      id: string;
      downloadedBytes: number;
      totalBytes: number | null;
      bytesPerSecond: number;
      etaSeconds: number | null;
    }
  | {
      type: 'complete';
      id: string;
      blobUrl: string;
      finalSize: number;
      mimeType: string;
      nativeUri?: string | null;
    }
  | { type: 'paused'; id: string }
  | { type: 'cancelled'; id: string }
  | { type: 'error'; id: string; message: string };

declare global {
  interface Window {
    SalviaNative?: SalviaNativeApi;
    __salviaNativeDownloadEvent?: (event: NativeDownloadEvent) => void;
    __salviaNativeBack?: () => boolean;
  }
}

export function getSalviaNative(): SalviaNativeApi | null {
  if (typeof window === 'undefined') return null;
  return window.SalviaNative && typeof window.SalviaNative.isAndroidApp === 'function'
    ? window.SalviaNative
    : null;
}

export function isNativeAndroid(): boolean {
  try {
    return Boolean(getSalviaNative()?.isAndroidApp());
  } catch {
    return false;
  }
}

export function apiUrl(path: string): string {
  const native = getSalviaNative();
  if (!native) return path;
  const base = native.getApiBase?.() || '';
  return `${base}${path}`;
}

export function registerNativeDownloadListener(
  handler: (event: NativeDownloadEvent) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  window.__salviaNativeDownloadEvent = handler;
  return () => {
    if (window.__salviaNativeDownloadEvent === handler) {
      delete window.__salviaNativeDownloadEvent;
    }
  };
}

export function registerNativeBackHandler(handler: () => boolean): () => void {
  if (typeof window === 'undefined') return () => {};
  window.__salviaNativeBack = handler;
  return () => {
    if (window.__salviaNativeBack === handler) {
      delete window.__salviaNativeBack;
    }
  };
}
