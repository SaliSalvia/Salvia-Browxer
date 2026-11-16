export interface BridgeMediaItem {
  url: string;
  tag: string;
  type: string;
  visible: boolean;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  muted?: boolean;
  hasControls?: boolean;
  isAd?: boolean;
  isSuggested?: boolean;
}

export interface SalviaNativeApi {
  isAndroidApp: () => boolean;
  getApiBase: () => string;
  supportsNativeBrowser?: () => boolean;
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
  nativeLoadUrl?: (
    tabId: string,
    url: string,
    desktopMode: boolean,
    jsEnabled: boolean,
    adBlockEnabled: boolean
  ) => void;
  nativeUpdateBrowserSettings?: (
    desktopMode: boolean,
    jsEnabled: boolean,
    adBlockEnabled: boolean,
    cookiesEnabled: BooleanLike,
    pageZoom: number
  ) => void;
  nativeGoBack?: () => void;
  nativeGoForward?: () => void;
  nativeReload?: () => void;
  nativeStopLoading?: () => void;
  nativeFindInPage?: (query: string, backwards: boolean) => void;
  nativeClearFindInPage?: () => void;
  nativeClearBrowserData?: () => void;
  setBrowserViewport?: (
    visible: boolean,
    leftCss: number,
    topCss: number,
    widthCss: number,
    heightCss: number
  ) => void;
  setFloatingOrbState?: (
    visible: boolean,
    highlighted: boolean,
    mediaCount: number,
    sizeDp: number,
    xCss: number,
    yCss: number,
    contentDesc: string
  ) => void;
}

type BooleanLike = boolean;

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

export type NativeBrowserEvent =
  | {
      type: 'page-started';
      tabId: string;
      url: string;
      canGoBack?: boolean;
      canGoForward?: boolean;
    }
  | {
      type: 'page-finished';
      tabId: string;
      url: string;
      title?: string;
      canGoBack?: boolean;
      canGoForward?: boolean;
    }
  | { type: 'progress'; tabId: string; progress: number }
  | { type: 'title'; tabId: string; url?: string; title: string }
  | { type: 'adblock-blocked'; tabId: string; host?: string }
  | {
      type: 'media-sniffed';
      tabId: string;
      pageUrl: string;
      mediaUrl: string;
      mimeType?: string;
      source?: 'FETCH' | 'DOM';
    }
  | {
      type: 'media-dom';
      tabId: string;
      pageUrl: string;
      items: BridgeMediaItem[];
    }
  | { type: 'visible-media'; tabId: string; pageUrl: string; mediaUrl: string }
  | { type: 'find-result'; tabId: string; matches: number; active: number };

declare global {
  interface Window {
    SalviaNative?: SalviaNativeApi;
    __salviaNativeDownloadEvent?: (event: NativeDownloadEvent) => void;
    __salviaNativeBrowserEvent?: (event: NativeBrowserEvent) => void;
    __salviaNativeBack?: () => boolean;
    __salviaNativeFabTap?: () => void;
    __salviaNativeFabLongPress?: () => void;
    __salviaNativeFabMove?: (xCss: number, yCss: number) => void;
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

export function supportsNativeBrowser(): boolean {
  try {
    return Boolean(getSalviaNative()?.supportsNativeBrowser?.());
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

export function registerNativeBrowserListener(
  handler: (event: NativeBrowserEvent) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  window.__salviaNativeBrowserEvent = handler;
  return () => {
    if (window.__salviaNativeBrowserEvent === handler) {
      delete window.__salviaNativeBrowserEvent;
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
