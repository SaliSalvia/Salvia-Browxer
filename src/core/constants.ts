import type { AppSettings, SearchEngineKey } from '../types/models';

export const APP_NAME = 'SalviaBrowxer';
export const APP_VERSION = '1.0.0';
export const MAX_LIVE_TABS = 8;

export const DEFAULT_HOMEPAGE = 'https://www.google.com';
export const DEFAULT_SEARCH_ENGINE: SearchEngineKey = 'Google';

export const SOURCE_CODE_URL = 'https://github.com/SaliSalvia/SalviaBrowxer';
export const LICENSE_URL = 'https://www.gnu.org/licenses/gpl-3.0.txt';
export const PRIVACY_POLICY_URL =
  'https://github.com/SaliSalvia/SalviaBrowxer/blob/main/docs/privacy-policy.md';
export const RELEASES_API_URL =
  'https://api.github.com/repos/SaliSalvia/SalviaBrowxer/releases/latest';

export const WIFI_HOLD_MARKER = '__SALVIA_WIFI_HOLD__';

export const SEARCH_ENGINES: Record<SearchEngineKey, string> = {
  Google: 'https://www.google.com/search?q=%s',
  DuckDuckGo: 'https://duckduckgo.com/?q=%s',
  Bing: 'https://www.bing.com/search?q=%s',
  Yahoo: 'https://search.yahoo.com/search?p=%s',
  Ecosia: 'https://www.ecosia.org/search?q=%s',
};

export const SEARCH_ENGINE_OPTIONS: SearchEngineKey[] = [
  'Google',
  'DuckDuckGo',
  'Bing',
  'Yahoo',
  'Ecosia',
];

export const DEFAULT_SETTINGS: AppSettings = {
  searchEngine: DEFAULT_SEARCH_ENGINE,
  homepage: DEFAULT_HOMEPAGE,
  isJavaScriptEnabled: true,
  areCookiesEnabled: true,
  isDesktopSite: false,
  isCleartextAllowed: false,
  isAdBlockEnabled: false,
  adBlockDisabledSites: [],
  adBlockBlockedRequests: 0,
  maxSimultaneousDownloads: 3,
  parallelConnections: 4,
  isWifiOnly: false,
  isExportToGallery: true,
  isFloatingButtonAlwaysVisible: true,
  floatingButtonSize: 54,
  floatingButtonX: 0,
  floatingButtonY: 0,
  destinationMode: 'internal',
  chosenFolderLabel: null,
  language: 'system',
};

export interface DemoWebPage {
  url: string;
  title: string;
  description: string;
  media: Array<{
    mediaUrl: string;
    title: string;
    mimeType: string;
    extension: string;
    duration?: number;
    estimatedSize?: number;
    isLive?: boolean;
  }>;
}

/**
 * Curated public-domain media showcase pages that work even when external websites block proxy fetches
 * or in offline/sandboxed evaluations.
 */
export const BUILTIN_SHOWCASE_PAGES: DemoWebPage[] = [
  {
    url: 'https://salvia.showcase/blender-open-movies',
    title: 'Blender Open Movies — Sample Media Gallery',
    description:
      'Public-domain sample videos and adaptive HLS streams for testing SalviaBrowxer media detection, quality selection, and in-app playback.',
    media: [
      {
        mediaUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
        title: 'Sintel Trailer — Blender Open Movie (MP4)',
        mimeType: 'video/mp4',
        extension: 'mp4',
        duration: 52000,
        estimatedSize: 4372373,
      },
      {
        mediaUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        title: 'Big Buck Bunny Adaptive Stream (HLS Master)',
        mimeType: 'application/vnd.apple.mpegurl',
        extension: 'm3u8',
        duration: 596000,
      },
      {
        mediaUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        title: 'Blooming Flower CC0 Clip (MP4)',
        mimeType: 'video/mp4',
        extension: 'mp4',
        duration: 5000,
        estimatedSize: 1128375,
      },
    ],
  },
];
