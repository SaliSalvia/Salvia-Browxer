export type DownloadState =
  | 'QUEUED'
  | 'RESOLVING'
  | 'PREPARING'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'RETRYING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type MediaSource = 'DOM' | 'XHR' | 'FETCH' | 'MSE' | 'JS';

export interface MediaCandidate {
  id: string;
  pageUrl: string;
  mediaUrl: string;
  title?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  source: MediaSource;
  confidence: number;
  isLive?: boolean;
  isMediaSource?: boolean;
  isBlobFile?: boolean;
  duration?: number | null;
  estimatedSize?: number | null;
  thumbnail?: string;
  width?: number | null;
  height?: number | null;
  muted?: boolean;
  hasControls?: boolean;
  isAd?: boolean;
  isSuggested?: boolean;
  audioTrackUrl?: string | null;
  bitrate?: number | null;
  formatLabel?: string | null;
  variants?: MediaFormat[];
}

export interface MediaFormat {
  id: string;
  format: string;
  url: string;
  mimeType: string;
  extension: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  frameRate?: number | null;
  bitrate?: number | null;
  audioBitrate?: number | null;
  isVideo?: boolean;
  isAudio?: boolean;
  isHls?: boolean;
  isDash?: boolean;
  audioTrackUrl?: string | null;
  referer?: string | null;
}

export interface MediaInfo {
  title: string;
  thumbnail?: string | null;
  duration?: number | null;
  formats: MediaFormat[];
  audioFormats: MediaFormat[];
  videoFormats: MediaFormat[];
  combinedFormats: MediaFormat[];
  source: string;
  extractor?: string | null;
  webpageUrl: string;
}

export interface Tab {
  id: string;
  title: string;
  url: string;
  isPrivate: boolean;
  isDesktopMode: boolean;
  createdAt: number;
  lastVisited: number;
  favicon?: string | null;
  position: number;
  historyStack: string[];
  historyIndex: number;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

export interface HistoryItem {
  id: string;
  title: string;
  url: string;
  visitedAt: number;
}

export interface DownloadItemRecord {
  id: string;
  url: string;
  mediaTitle?: string | null;
  filename: string;
  mimeType?: string | null;
  thumbnail?: string | null;
  status: DownloadState;
  downloadedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  etaSeconds: number | null;
  error?: string | null;
  isLocked: boolean;
  exportedToGallery: boolean;
  isHls?: boolean;
  isDash?: boolean;
  blobUrl?: string | null;
  nativeUri?: string | null;
  audioTrackUrl?: string | null;
  createdAt: number;
  completedAt?: number | null;
  pageUrl?: string | null;
}

export type SearchEngineKey = 'Google' | 'DuckDuckGo' | 'Bing' | 'Yahoo' | 'Ecosia';

export type LanguageMode = 'system' | 'en' | 'fa';

export interface AppSettings {
  searchEngine: SearchEngineKey;
  homepage: string;
  isJavaScriptEnabled: boolean;
  areCookiesEnabled: boolean;
  isDesktopSite: boolean;
  isCleartextAllowed: boolean;
  isAdBlockEnabled: boolean;
  adBlockDisabledSites: string[];
  adBlockBlockedRequests: number;
  maxSimultaneousDownloads: number;
  parallelConnections: number;
  isWifiOnly: boolean;
  isExportToGallery: boolean;
  isFloatingButtonAlwaysVisible: boolean;
  floatingButtonSize: number;
  floatingButtonX: number;
  floatingButtonY: number;
  destinationMode: 'internal' | 'chosen';
  chosenFolderLabel: string | null;
  language: LanguageMode;
}

export type PlaybackOrder = 'SEQUENTIAL' | 'LOOP_ALL' | 'REVERSE' | 'SHUFFLE';

export interface AddressSuggestion {
  title: string;
  url: string;
  source: 'BOOKMARK' | 'HISTORY';
}

export interface DiagnosticsEntry {
  timestamp: number;
  kind: 'transfer' | 'navigation' | 'adblock' | 'system';
  host: string;
  event: string;
}

export type AppRoute =
  | 'home'
  | 'browser'
  | 'downloads'
  | 'bookmarks'
  | 'history'
  | 'settings'
  | 'player';
