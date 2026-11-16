import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  APP_VERSION,
  BUILTIN_SHOWCASE_PAGES,
  DEFAULT_SETTINGS,
  MAX_LIVE_TABS,
  RELEASES_API_URL,
  WIFI_HOLD_MARKER,
} from '../core/constants';
import {
  cancelTransfer,
  discardPartialTransfer,
  getCompletedBlobUrl,
  pauseTransfer,
  registerCompletedBlobUrl,
  releaseBlobUrl,
  startTransfer,
  triggerBrowserFileSave,
} from '../core/downloadEngine';
import {
  isStreamRecordingSupported,
  startStreamRecording,
  type StreamRecorderHandle,
} from '../core/streamRecorder';
import {
  extractMediaFromPageUrl,
  initialMediaInfoForCandidate,
  probeMediaCandidate,
  sanitizeFilename,
  scanHtmlForMedia,
} from '../core/mediaResolver';
import {
  rankAndClassifyCandidates,
  type ClassifiedCandidate,
} from '../core/mainContentSelector';
import { unsupportedReasonFor, type UnsupportedMedia } from '../core/mediaOfferability';
import {
  analyzePastedLink,
  classifyPastedLink,
  isYouTubeExcludedUrl,
  pastedMediaCandidate,
} from '../core/pastedLink';
import { resolveAddressBarInput } from '../core/addressBarResolver';
import { hostOfUrl } from '../core/adBlockRules';
import {
  LockoutPolicy,
  isPasswordConfigured,
  removeLockedFolderPassword,
  setLockedFolderPassword,
  verifyLockedFolderPassword,
} from '../core/security';
import {
  apiUrl,
  getSalviaNative,
  isNativeAndroid,
  registerNativeBackHandler,
  registerNativeBrowserListener,
  supportsNativeBrowser,
} from '../core/nativeBridge';
import { capMediaCandidates, pruneTabPagesCache } from '../core/memoryCachePolicy';
import { getTranslator, resolveActiveLocale, type TranslationMap } from '../i18n/translations';
import type {
  AddressSuggestion,
  AppRoute,
  AppSettings,
  BookmarkItem,
  DiagnosticsEntry,
  DownloadItemRecord,
  HistoryItem,
  MediaCandidate,
  MediaFormat,
  MediaInfo,
  Tab,
} from '../types/models';

const STORAGE_KEYS = {
  settings: 'salvia_settings_v1',
  bookmarks: 'salvia_bookmarks_v1',
  history: 'salvia_history_v1',
  downloads: 'salvia_downloads_v1',
  tabs: 'salvia_session_tabs_v1',
  diagnostics: 'salvia_diagnostics_v1',
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface TabPageRenderState {
  url: string;
  title: string;
  html: string | null;
  isLoading: boolean;
  progress: number;
  error: string | null;
  isDemoShowcase: boolean;
}

export interface QualitySheetState {
  candidate: MediaCandidate;
  mediaInfo: MediaInfo;
  isResolving: boolean;
  unsupported: UnsupportedMedia | 'DRM' | null;
  canRecord: boolean;
}

export interface RecordingState {
  isRecording: boolean;
  bytes: number;
}

export interface UpdateCheckState {
  isChecking: boolean;
  availableVersion: string | null;
  availableUrl: string | null;
  availableNotes: string | null;
}

export interface PlayerTarget {
  url: string;
  title: string;
  downloadId?: string;
  isHls?: boolean;
}

interface AppContextValue {
  route: AppRoute;
  downloadsInitialTab: number;
  playerTarget: PlayerTarget | null;
  navigate: (route: AppRoute, options?: { downloadsTab?: number; player?: PlayerTarget }) => void;

  locale: 'en' | 'fa';
  isRtl: boolean;
  t: (key: keyof TranslationMap, vars?: Record<string, string | number>) => string;

  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;

  tabs: Tab[];
  currentTabId: string;
  currentTab: Tab;
  hibernatedTabIds: Set<string>;
  tabPages: Record<string, TabPageRenderState>;
  tabMedia: Record<string, MediaCandidate[]>;
  tabVisibleMedia: Record<string, string | null>;
  isTabSwitcherVisible: boolean;
  openTabSwitcher: () => void;
  closeTabSwitcher: () => void;
  createTab: (options?: { isPrivate?: boolean; url?: string }) => void;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;

  navigateCurrentTab: (input: string) => void;
  openPastedLink: (url: string) => void;
  isExtractingLink: boolean;
  extractFromPastedPage: (url: string) => Promise<void>;
  reloadCurrentTab: () => void;
  stopLoadingCurrentTab: () => void;
  goBackCurrentTab: () => void;
  goForwardCurrentTab: () => void;
  goHomeInCurrentTab: () => void;

  findInPage: { query: string; matches: number; activeMatch: number } | null;
  openFindInPage: () => void;
  closeFindInPage: () => void;
  updateFindQuery: (query: string) => void;
  setFindResult: (matches: number, activeMatch: number) => void;

  isNativeBrowserEngine: boolean;
  nativeNavCaps: Record<string, { canGoBack: boolean; canGoForward: boolean }>;

  blockedCleartextUrl: string | null;
  allowCleartextAndRetry: () => void;
  dismissCleartextBlock: () => void;

  isAdBlockOffForCurrentSite: () => boolean;
  toggleAdBlockForCurrentSite: () => void;

  bookmarks: BookmarkItem[];
  isCurrentTabBookmarked: boolean;
  addBookmarkForCurrentTab: () => void;
  toggleBookmarkForCurrentTab: () => void;
  deleteBookmark: (id: string) => void;
  openUrlFromLibrary: (url: string) => void;
  duplicateTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  pageZoom: number;
  setPageZoom: (zoom: number) => void;

  history: HistoryItem[];
  deleteHistoryEntry: (id: string) => void;
  clearHistory: () => void;
  clearCookiesAndStorage: () => void;
  clearAllBrowsingData: () => void;

  getAddressSuggestions: (query: string) => AddressSuggestion[];

  currentTabCandidates: MediaCandidate[];
  rankedTabCandidates: ClassifiedCandidate[];
  currentMainCandidate: MediaCandidate | null;
  isMediaTrayVisible: boolean;
  openMediaTray: () => void;
  closeMediaTray: () => void;
  qualitySheet: QualitySheetState | null;
  openQualitySheetForCandidate: (candidate: MediaCandidate) => void;
  closeQualitySheet: () => void;
  startDownloadFromFormat: (format: MediaFormat, customFilename: string | null) => void;
  startBatchDownloadFromCandidates: (candidates: MediaCandidate[]) => Promise<void>;
  downloadMainMedia: () => void;

  recording: RecordingState;
  startRecordingPlayback: () => void;
  stopRecordingPlayback: () => void;

  downloads: DownloadItemRecord[];
  activeDownloadsCount: number;
  completedDownloadsCount: number;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  retryDownload: (id: string) => void;
  deleteDownload: (id: string) => void;
  clearDownloadsByBucket: (bucket: 'active' | 'completed' | 'failed') => void;
  exportDownloadToDevice: (id: string) => void;
  playDownloadInApp: (id: string) => void;
  shareDownload: (id: string) => void;
  setDownloadLocked: (id: string, locked: boolean) => void;

  isLockedFolderConfigured: boolean;
  isLockedFolderUnlocked: boolean;
  isUnlockingFolder: boolean;
  unlockLockedFolder: (password: string) => Promise<void>;
  lockLockedFolder: () => void;
  saveLockedFolderPassword: (password: string) => Promise<boolean>;
  removeLockedFolderPasswordAction: () => void;

  // duplicate findInPage removed from original position — already declared above

  reportDetectedMediaFromBridge: (
    tabId: string,
    pageUrl: string,
    items: Array<{
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
    }>
  ) => void;
  reportVisibleMediaFromBridge: (tabId: string, pageUrl: string, mediaUrl: string) => void;

  connectionKind: 'WIFI' | 'MOBILE' | 'OTHER' | 'OFFLINE';

  updateCheck: UpdateCheckState;
  checkForUpdates: () => Promise<void>;
  dismissUpdateDialog: () => void;

  diagnostics: DiagnosticsEntry[];
  exportDiagnostics: () => void;

  toastMessage: string | null;
  showToast: (msg: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadJson<Partial<AppSettings>>(STORAGE_KEYS.settings, {}),
  }));

  const locale = resolveActiveLocale(settings.language);
  const isRtl = locale === 'fa';
  const t = useMemo(() => getTranslator(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  }, [locale, isRtl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  const [route, setRoute] = useState<AppRoute>('home');
  const [downloadsInitialTab, setDownloadsInitialTab] = useState(0);
  const [playerTarget, setPlayerTarget] = useState<PlayerTarget | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    if (!msg) return;
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 3200);
  }, []);

  const [diagnostics, setDiagnostics] = useState<DiagnosticsEntry[]>(() =>
    loadJson<DiagnosticsEntry[]>(STORAGE_KEYS.diagnostics, [])
  );
  const logEvent = useCallback((kind: DiagnosticsEntry['kind'], host: string, event: string) => {
    setDiagnostics((prev) => {
      const next = [{ timestamp: Date.now(), kind, host, event }, ...prev].slice(0, 120);
      localStorage.setItem(STORAGE_KEYS.diagnostics, JSON.stringify(next));
      return next;
    });
  }, []);

  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() =>
    loadJson<BookmarkItem[]>(STORAGE_KEYS.bookmarks, [
      {
        id: 'bm-showcase',
        title: 'Blender Open Movies — Sample Media Gallery',
        url: BUILTIN_SHOWCASE_PAGES[0].url,
        createdAt: Date.now(),
      },
    ])
  );
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.bookmarks, JSON.stringify(bookmarks));
  }, [bookmarks]);

  const [history, setHistory] = useState<HistoryItem[]>(() =>
    loadJson<HistoryItem[]>(STORAGE_KEYS.history, [])
  );
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
  }, [history]);

  const [downloads, setDownloads] = useState<DownloadItemRecord[]>(() =>
    loadJson<DownloadItemRecord[]>(STORAGE_KEYS.downloads, []).map((d) =>
      d.status === 'DOWNLOADING' || d.status === 'PREPARING' || d.status === 'RESOLVING'
        ? // The bytes of an interrupted transfer live in memory only, so a reloaded row
          // reports zero instead of promising a resume point it can no longer honour.
          { ...d, status: 'PAUSED', downloadedBytes: 0, bytesPerSecond: 0, etaSeconds: null }
        : d
    )
  );
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  const lastDownloadsSaveRef = useRef(0);
  useEffect(() => {
    const hasActiveProgress = downloads.some(
      (d) => d.status === 'DOWNLOADING' || d.status === 'PREPARING' || d.status === 'RESOLVING'
    );
    const now = Date.now();
    if (!hasActiveProgress || now - lastDownloadsSaveRef.current >= 900) {
      lastDownloadsSaveRef.current = now;
      localStorage.setItem(STORAGE_KEYS.downloads, JSON.stringify(downloads));
      return;
    }
    const timer = window.setTimeout(() => {
      lastDownloadsSaveRef.current = Date.now();
      localStorage.setItem(STORAGE_KEYS.downloads, JSON.stringify(downloadsRef.current));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [downloads]);

  useEffect(() => {
    const flushDownloads = () => {
      try {
        localStorage.setItem(STORAGE_KEYS.downloads, JSON.stringify(downloadsRef.current));
      } catch {
        // ignore quota errors
      }
    };
    window.addEventListener('beforeunload', flushDownloads);
    return () => {
      window.removeEventListener('beforeunload', flushDownloads);
      flushDownloads();
    };
  }, []);

  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = loadJson<Tab[]>(STORAGE_KEYS.tabs, []);
    if (saved.length > 0) return saved;
    return [
      {
        id: 'tab-initial',
        title: 'New Tab',
        url: '',
        isPrivate: false,
        isDesktopMode: false,
        createdAt: Date.now(),
        lastVisited: Date.now(),
        position: 0,
        historyStack: [],
        historyIndex: -1,
      },
    ];
  });
  const [currentTabId, setCurrentTabId] = useState<string>(() => tabs[0]?.id || 'tab-initial');

  useEffect(() => {
    const persistable = tabs.filter((tab) => !tab.isPrivate);
    localStorage.setItem(STORAGE_KEYS.tabs, JSON.stringify(persistable));
  }, [tabs]);

  const hibernatedTabIds = useMemo(() => {
    if (tabs.length <= MAX_LIVE_TABS) return new Set<string>();
    const sorted = [...tabs].sort((a, b) => b.lastVisited - a.lastVisited);
    const liveIds = new Set(sorted.slice(0, MAX_LIVE_TABS).map((item) => item.id));
    liveIds.add(currentTabId);
    return new Set(tabs.filter((item) => !liveIds.has(item.id)).map((item) => item.id));
  }, [tabs, currentTabId]);

  const currentTab = useMemo(
    () => tabs.find((item) => item.id === currentTabId) ?? tabs[0],
    [tabs, currentTabId]
  );
  const tabsRef = useRef<Tab[]>(tabs);
  tabsRef.current = tabs;
  const tabAbortRef = useRef<Map<string, AbortController>>(new Map());

  const currentTabIdRef = useRef(currentTabId);
  currentTabIdRef.current = currentTabId;
  const isNativeBrowserEngine = useMemo(() => supportsNativeBrowser(), []);
  const [nativeNavCaps, setNativeNavCaps] = useState<
    Record<string, { canGoBack: boolean; canGoForward: boolean }>
  >({});

  const [tabPages, setTabPages] = useState<Record<string, TabPageRenderState>>({});
  const tabPagesRef = useRef<Record<string, TabPageRenderState>>(tabPages);
  tabPagesRef.current = tabPages;
  const [tabMedia, setTabMedia] = useState<Record<string, MediaCandidate[]>>({});
  const [tabVisibleMedia, setTabVisibleMedia] = useState<Record<string, string | null>>({});
  const [isTabSwitcherVisible, setIsTabSwitcherVisible] = useState(false);
  const [isMediaTrayVisible, setIsMediaTrayVisible] = useState(false);
  const [qualitySheet, setQualitySheet] = useState<QualitySheetState | null>(null);
  const [blockedCleartextUrl, setBlockedCleartextUrl] = useState<string | null>(null);
  const [findInPage, setFindInPage] = useState<{ query: string; matches: number; activeMatch: number } | null>(null);

  // Connection state
  const [connectionKind, setConnectionKind] = useState<'WIFI' | 'MOBILE' | 'OTHER' | 'OFFLINE'>(() => {
    if (typeof navigator === 'undefined' || !navigator.onLine) return 'OFFLINE';
    const conn = (navigator as unknown as { connection?: { type?: string } }).connection;
    if (conn?.type === 'wifi') return 'WIFI';
    if (conn?.type === 'cellular') return 'MOBILE';
    return 'WIFI';
  });

  useEffect(() => {
    const refresh = () => {
      if (!navigator.onLine) {
        setConnectionKind('OFFLINE');
        return;
      }
      const conn = (navigator as unknown as { connection?: { type?: string } }).connection;
      if (conn?.type === 'cellular') setConnectionKind('MOBILE');
      else if (conn?.type === 'wifi') setConnectionKind('WIFI');
      else setConnectionKind('WIFI');
    };
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const navigate = useCallback(
    (nextRoute: AppRoute, options?: { downloadsTab?: number; player?: PlayerTarget }) => {
      if (nextRoute === 'downloads') {
        setDownloadsInitialTab(options?.downloadsTab ?? 0);
      }
      if (nextRoute === 'player' && options?.player) {
        setPlayerTarget(options.player);
      }
      setRoute(nextRoute);
    },
    []
  );

  const mergeTabCandidates = useCallback((tabId: string, incoming: MediaCandidate[]) => {
    const filtered = incoming.filter(
      (item) => !isYouTubeExcludedUrl(item.pageUrl) && !isYouTubeExcludedUrl(item.mediaUrl)
    );
    if (filtered.length === 0) return;
    setTabMedia((prev) => {
      const existing = prev[tabId] || [];
      const byUrl = new Map<string, MediaCandidate>();
      for (const item of existing) byUrl.set(item.mediaUrl, item);
      for (const item of filtered) {
        const current = byUrl.get(item.mediaUrl);
        if (!current) {
          byUrl.set(item.mediaUrl, item);
        } else {
          byUrl.set(item.mediaUrl, {
            ...current,
            ...item,
            confidence: Math.max(current.confidence, item.confidence),
            duration: item.duration ?? current.duration ?? null,
            estimatedSize: item.estimatedSize ?? current.estimatedSize ?? null,
            width: item.width ?? current.width ?? null,
            height: item.height ?? current.height ?? null,
            isAd: item.isAd ?? current.isAd,
            isSuggested: item.isSuggested ?? current.isSuggested,
            muted: item.muted ?? current.muted,
            hasControls: item.hasControls ?? current.hasControls,
          });
        }
      }
      return { ...prev, [tabId]: capMediaCandidates(Array.from(byUrl.values()), 60) };
    });
  }, []);

  const loadUrlIntoTab = useCallback(
    async (tabId: string, rawUrl: string, pushHistory = true, overrideCleartext = false) => {
      const url = rawUrl.trim();
      if (!url) return;

      if (url.startsWith('http://') && !settings.isCleartextAllowed && !overrideCleartext) {
        setBlockedCleartextUrl(url);
        return;
      }
      setBlockedCleartextUrl(null);

      // Cancel any in-flight navigation for this tab so stale fetches never overwrite newer state
      tabAbortRef.current.get(tabId)?.abort();
      const ctrl = new AbortController();
      tabAbortRef.current.set(tabId, ctrl);

      const isPrivateTab = Boolean(tabsRef.current.find((tItem) => tItem.id === tabId)?.isPrivate);

      // Update tab metadata and reset media candidates for this new page
      setTabMedia((prev) => ({ ...prev, [tabId]: [] }));
      setTabVisibleMedia((prev) => ({ ...prev, [tabId]: null }));
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab;
          const nextStack = pushHistory
            ? [...tab.historyStack.slice(0, tab.historyIndex + 1), url]
            : tab.historyStack;
          const nextIdx = pushHistory ? nextStack.length - 1 : tab.historyIndex;
          return {
            ...tab,
            url,
            lastVisited: Date.now(),
            historyStack: nextStack,
            historyIndex: nextIdx,
          };
        })
      );

      // Built-in showcase page
      const showcase = BUILTIN_SHOWCASE_PAGES.find((p) => p.url === url);
      if (showcase) {
        tabAbortRef.current.delete(tabId);
        setTabPages((prev) => ({
          ...prev,
          [tabId]: {
            url,
            title: showcase.title,
            html: null,
            isLoading: false,
            progress: 100,
            error: null,
            isDemoShowcase: true,
          },
        }));
        setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, title: showcase.title } : tab)));
        const candidates: MediaCandidate[] = showcase.media.map((m, idx) => ({
          id: `demo-${idx}-${m.mediaUrl}`,
          pageUrl: url,
          mediaUrl: m.mediaUrl,
          title: m.title,
          mimeType: m.mimeType,
          extension: m.extension,
          source: 'DOM',
          confidence: 0.95 - idx * 0.05,
          duration: m.duration ?? null,
          estimatedSize: m.estimatedSize ?? null,
          isLive: m.isLive ?? false,
        }));
        setTabMedia((prev) => ({ ...prev, [tabId]: candidates }));
        setTabVisibleMedia((prev) => ({ ...prev, [tabId]: candidates[0]?.mediaUrl ?? null }));
        if (!isPrivateTab) {
          setHistory((prev) => [
            { id: makeId('hist'), title: showcase.title, url, visitedAt: Date.now() },
            ...prev.filter((h) => h.url !== url).slice(0, 199),
          ]);
        }
        return;
      }

      setTabPages((prev) => ({
        ...prev,
        [tabId]: {
          url,
          title: url,
          html: null,
          isLoading: true,
          progress: 25,
          error: null,
          isDemoShowcase: false,
        },
      }));

      // Kick off platform pattern extraction concurrently with page load so X/Instagram/etc. highlight fast
      const isPlatformPage = !isYouTubeExcludedUrl(url) && analyzePastedLink(url)?.category === 'PLATFORM_PAGE';
      if (isPlatformPage) {
        void extractMediaFromPageUrl(url).then((extracted) => {
          if (!ctrl.signal.aborted && extracted.ok && extracted.candidates.length > 0) {
            mergeTabCandidates(tabId, extracted.candidates);
          }
        });
      }

      const host = hostOfUrl(url) || '';
      const adBlockActive = settings.isAdBlockEnabled && !settings.adBlockDisabledSites.includes(host);

      // Android APK native Chromium WebView handles real sites directly with zero HTML heap bloat
      const native = getSalviaNative();
      if (isNativeBrowserEngine && native?.nativeLoadUrl) {
        tabAbortRef.current.delete(tabId);
        native.nativeLoadUrl(tabId, url, settings.isDesktopSite, settings.isJavaScriptEnabled, adBlockActive);
        return;
      }

      try {
        const res = await fetch(
          apiUrl(`/api/browse?url=${encodeURIComponent(url)}&desktop=${settings.isDesktopSite ? '1' : '0'}&adblock=${adBlockActive ? '1' : '0'}`),
          { signal: ctrl.signal }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          status?: number;
          statusText?: string;
          finalUrl?: string;
          title?: string;
          html?: string;
          blockedCount?: number;
          isDirectMedia?: boolean;
          contentType?: string;
          contentLength?: number | null;
          error?: string;
        };

        if (ctrl.signal.aborted) return;

        if (!data.ok) {
          const errMsg = data.status
            ? t('error_page_http', { status: `${data.status} ${data.statusText || ''}`.trim() })
            : data.error || t('error_page_load_failed');
          setTabPages((prev) => ({
            ...prev,
            [tabId]: {
              url,
              title: host || url,
              html: null,
              isLoading: false,
              progress: 100,
              error: errMsg,
              isDemoShowcase: false,
            },
          }));
          logEvent('navigation', host, `load_failed:${data.status || 'network'}`);
          return;
        }

        const finalUrl = data.finalUrl || url;
        const pageTitle = data.title || host || finalUrl;

        if (data.blockedCount && data.blockedCount > 0) {
          setSettings((prev) => ({
            ...prev,
            adBlockBlockedRequests: prev.adBlockBlockedRequests + (data.blockedCount || 0),
          }));
          logEvent('adblock', host, `blocked:${data.blockedCount}`);
        }

        if (data.isDirectMedia) {
          const candidate: MediaCandidate = {
            id: `direct-${finalUrl}`,
            pageUrl: finalUrl,
            mediaUrl: finalUrl,
            title: pageTitle,
            mimeType: data.contentType || 'video/mp4',
            extension: finalUrl.split('.').pop()?.split('?')[0] || 'mp4',
            source: 'FETCH',
            confidence: 0.95,
            estimatedSize: data.contentLength ?? null,
          };
          mergeTabCandidates(tabId, [candidate]);
        }

        const scanned =
          !isYouTubeExcludedUrl(finalUrl) && data.html
            ? scanHtmlForMedia(data.html, finalUrl, pageTitle)
            : [];
        mergeTabCandidates(tabId, scanned);

        if (
          scanned.length === 0 &&
          !data.isDirectMedia &&
          !isYouTubeExcludedUrl(finalUrl) &&
          !isPlatformPage &&
          analyzePastedLink(finalUrl)?.category === 'PLATFORM_PAGE'
        ) {
          void extractMediaFromPageUrl(finalUrl).then((extracted) => {
            if (!ctrl.signal.aborted && extracted.ok && extracted.candidates.length > 0) {
              mergeTabCandidates(tabId, extracted.candidates);
            }
          });
        }

        setTabPages((prev) =>
          pruneTabPagesCache(
            {
              ...prev,
              [tabId]: {
                url: finalUrl,
                title: pageTitle,
                html: data.html ?? null,
                isLoading: false,
                progress: 100,
                error: null,
                isDemoShowcase: false,
              },
            },
            currentTabIdRef.current,
            2
          )
        );

        setTabs((prev) =>
          prev.map((tab) => (tab.id === tabId ? { ...tab, url: finalUrl, title: pageTitle } : tab))
        );

        if (!isPrivateTab) {
          setHistory((prev) => [
            { id: makeId('hist'), title: pageTitle, url: finalUrl, visitedAt: Date.now() },
            ...prev.filter((h) => h.url !== finalUrl).slice(0, 199),
          ]);
        }
      } catch (err) {
        if (ctrl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setTabPages((prev) => ({
          ...prev,
          [tabId]: {
            url,
            title: host || url,
            html: null,
            isLoading: false,
            progress: 100,
            error: t('error_page_load_failed'),
            isDemoShowcase: false,
          },
        }));
      } finally {
        if (tabAbortRef.current.get(tabId) === ctrl) {
          tabAbortRef.current.delete(tabId);
        }
      }
    },
    [
      settings.isCleartextAllowed,
      settings.isDesktopSite,
      settings.isJavaScriptEnabled,
      settings.isAdBlockEnabled,
      settings.adBlockDisabledSites,
      isNativeBrowserEngine,
      t,
      logEvent,
      mergeTabCandidates,
    ]
  );

  const navigateCurrentTab = useCallback(
    (input: string) => {
      const resolved = resolveAddressBarInput(input, settings.searchEngine);
      if (!resolved) return;
      loadUrlIntoTab(currentTabId, resolved, true);
    },
    [currentTabId, settings.searchEngine, loadUrlIntoTab]
  );

  const openQualitySheetForCandidate = useCallback(async (candidate: MediaCandidate) => {
    const unsupported = unsupportedReasonFor({
      url: candidate.mediaUrl,
      mimeType: candidate.mimeType,
      extension: candidate.extension,
      isLive: candidate.isLive,
      isMediaSource: candidate.isMediaSource,
      isBlobFile: candidate.isBlobFile,
      dashIsSupported: true,
    });
    const initial = initialMediaInfoForCandidate(candidate);
    setQualitySheet({
      candidate,
      mediaInfo: initial,
      isResolving: unsupported === null,
      unsupported,
      canRecord: unsupported === 'BLOB_STREAM' || candidate.isMediaSource === true,
    });

    if (unsupported !== null) return;

    const probed = await probeMediaCandidate(candidate);
    setQualitySheet((prev) => {
      if (!prev || prev.candidate.mediaUrl !== candidate.mediaUrl) return prev;
      return {
        ...prev,
        mediaInfo: probed.mediaInfo,
        isResolving: false,
        unsupported: probed.unsupported,
      };
    });
  }, []);

  const [isExtractingLink, setIsExtractingLink] = useState(false);

  const openPastedLink = useCallback(
    (rawUrl: string) => {
      const kind = classifyPastedLink(rawUrl);
      if (kind === 'MEDIA_FILE') {
        const candidate = pastedMediaCandidate(rawUrl);
        if (candidate) {
          setRoute('browser');
          openQualitySheetForCandidate(candidate);
          return;
        }
      }
      setRoute('browser');
      const resolved = resolveAddressBarInput(rawUrl, settings.searchEngine);
      if (resolved) loadUrlIntoTab(currentTabId, resolved, true);
    },
    [currentTabId, settings.searchEngine, loadUrlIntoTab, openQualitySheetForCandidate]
  );

  const extractFromPastedPage = useCallback(
    async (rawUrl: string) => {
      if (isYouTubeExcludedUrl(rawUrl)) {
        showToast(t('error_youtube_excluded'));
        return;
      }
      const kind = classifyPastedLink(rawUrl);
      if (kind === 'MEDIA_FILE') {
        const candidate = pastedMediaCandidate(rawUrl);
        if (candidate) {
          openQualitySheetForCandidate(candidate);
          return;
        }
      }
      const resolved = resolveAddressBarInput(rawUrl, settings.searchEngine);
      if (!resolved) return;
      if (isYouTubeExcludedUrl(resolved)) {
        showToast(t('error_youtube_excluded'));
        return;
      }
      setIsExtractingLink(true);
      showToast(t('extracting_media'));
      try {
        const extracted = await extractMediaFromPageUrl(resolved);
        if (extracted.youtubeExcluded) {
          showToast(t('error_youtube_excluded'));
          return;
        }
        if (extracted.ok && extracted.candidates.length > 0) {
          setRoute('browser');
          setTabMedia((prev) => ({
            ...prev,
            [currentTabId]: extracted.candidates,
          }));
          if (extracted.candidates.length === 1) {
            openQualitySheetForCandidate(extracted.candidates[0]);
          } else {
            setIsMediaTrayVisible(true);
          }
          return;
        }
        showToast(t('extract_none_found'));
        setRoute('browser');
        loadUrlIntoTab(currentTabId, resolved, true);
      } finally {
        setIsExtractingLink(false);
      }
    },
    [currentTabId, settings.searchEngine, loadUrlIntoTab, openQualitySheetForCandidate, showToast, t]
  );

  const reloadCurrentTab = useCallback(() => {
    if (!currentTab?.url) return;
    const showcase = BUILTIN_SHOWCASE_PAGES.some((p) => p.url === currentTab.url);
    const native = getSalviaNative();
    if (isNativeBrowserEngine && !showcase && native?.nativeReload) {
      native.nativeReload();
      return;
    }
    loadUrlIntoTab(currentTab.id, currentTab.url, false);
  }, [currentTab, isNativeBrowserEngine, loadUrlIntoTab]);

  const stopLoadingCurrentTab = useCallback(() => {
    tabAbortRef.current.get(currentTabId)?.abort();
    tabAbortRef.current.delete(currentTabId);
    const native = getSalviaNative();
    if (isNativeBrowserEngine && native?.nativeStopLoading) {
      native.nativeStopLoading();
    }
    setTabPages((prev) => {
      const cur = prev[currentTabId];
      if (!cur) return prev;
      return { ...prev, [currentTabId]: { ...cur, isLoading: false, progress: 100 } };
    });
  }, [currentTabId, isNativeBrowserEngine]);

  const goBackCurrentTab = useCallback(() => {
    if (!currentTab) return;
    const showcase = BUILTIN_SHOWCASE_PAGES.some((p) => p.url === currentTab.url);
    const native = getSalviaNative();
    if (isNativeBrowserEngine && !showcase && nativeNavCaps[currentTab.id]?.canGoBack && native?.nativeGoBack) {
      native.nativeGoBack();
      return;
    }
    if (currentTab.historyIndex <= 0) return;
    const nextIdx = currentTab.historyIndex - 1;
    const targetUrl = currentTab.historyStack[nextIdx];
    setTabs((prev) =>
      prev.map((tab) => (tab.id === currentTab.id ? { ...tab, historyIndex: nextIdx } : tab))
    );
    loadUrlIntoTab(currentTab.id, targetUrl, false);
  }, [currentTab, isNativeBrowserEngine, nativeNavCaps, loadUrlIntoTab]);

  const goForwardCurrentTab = useCallback(() => {
    if (!currentTab) return;
    const showcase = BUILTIN_SHOWCASE_PAGES.some((p) => p.url === currentTab.url);
    const native = getSalviaNative();
    if (isNativeBrowserEngine && !showcase && nativeNavCaps[currentTab.id]?.canGoForward && native?.nativeGoForward) {
      native.nativeGoForward();
      return;
    }
    if (currentTab.historyIndex >= currentTab.historyStack.length - 1) return;
    const nextIdx = currentTab.historyIndex + 1;
    const targetUrl = currentTab.historyStack[nextIdx];
    setTabs((prev) =>
      prev.map((tab) => (tab.id === currentTab.id ? { ...tab, historyIndex: nextIdx } : tab))
    );
    loadUrlIntoTab(currentTab.id, targetUrl, false);
  }, [currentTab, isNativeBrowserEngine, nativeNavCaps, loadUrlIntoTab]);

  const goHomeInCurrentTab = useCallback(() => {
    if (currentTab?.url) {
      loadUrlIntoTab(currentTab.id, settings.homepage, true);
    } else {
      setRoute('home');
    }
  }, [currentTab, settings.homepage, loadUrlIntoTab]);

  const createTab = useCallback(
    (options?: { isPrivate?: boolean; url?: string }) => {
      const newTab: Tab = {
        id: makeId('tab'),
        title: options?.isPrivate ? t('new_private_tab') : t('new_tab'),
        url: options?.url || '',
        isPrivate: Boolean(options?.isPrivate),
        isDesktopMode: settings.isDesktopSite,
        createdAt: Date.now(),
        lastVisited: Date.now(),
        position: tabs.length,
        historyStack: options?.url ? [options.url] : [],
        historyIndex: options?.url ? 0 : -1,
      };
      setTabs((prev) => [...prev, newTab]);
      setCurrentTabId(newTab.id);
      setIsTabSwitcherVisible(false);
      if (options?.url) {
        loadUrlIntoTab(newTab.id, options.url, false);
      }
    },
    [settings.isDesktopSite, tabs.length, t, loadUrlIntoTab]
  );

  const switchTab = useCallback(
    (tabId: string) => {
      const wasHibernated = hibernatedTabIds.has(tabId);
      setTabs((prev) =>
        prev.map((tab) => (tab.id === tabId ? { ...tab, lastVisited: Date.now() } : tab))
      );
      setCurrentTabId(tabId);
      setIsTabSwitcherVisible(false);
      const target = tabs.find((item) => item.id === tabId);
      if (!target?.url) return;
      if (isNativeBrowserEngine) {
        // The native engine renders through one shared browser WebView, so the tab has
        // to be navigated before it can be shown.
        loadUrlIntoTab(tabId, target.url, false);
        return;
      }
      const page = tabPagesRef.current[tabId];
      const hasRenderablePage = Boolean(
        page && (page.html || page.isLoading || page.error || page.isDemoShowcase)
      );
      if (wasHibernated || !hasRenderablePage) {
        loadUrlIntoTab(tabId, target.url, false);
      }
    },
    [hibernatedTabIds, tabs, isNativeBrowserEngine, loadUrlIntoTab]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      tabAbortRef.current.get(tabId)?.abort();
      tabAbortRef.current.delete(tabId);
      setTabPages((prev) => {
        if (!(tabId in prev)) return prev;
        const copy = { ...prev };
        delete copy[tabId];
        return copy;
      });
      setTabMedia((prev) => {
        if (!(tabId in prev)) return prev;
        const copy = { ...prev };
        delete copy[tabId];
        return copy;
      });
      setTabVisibleMedia((prev) => {
        if (!(tabId in prev)) return prev;
        const copy = { ...prev };
        delete copy[tabId];
        return copy;
      });
      setTabs((prev) => {
        const remaining = prev.filter((item) => item.id !== tabId);
        if (remaining.length === 0) {
          const fresh: Tab = {
            id: makeId('tab'),
            title: t('new_tab'),
            url: '',
            isPrivate: false,
            isDesktopMode: settings.isDesktopSite,
            createdAt: Date.now(),
            lastVisited: Date.now(),
            position: 0,
            historyStack: [],
            historyIndex: -1,
          };
          setCurrentTabId(fresh.id);
          return [fresh];
        }
        if (tabId === currentTabId) {
          setCurrentTabId(remaining[remaining.length - 1].id);
        }
        return remaining;
      });
    },
    [currentTabId, settings.isDesktopSite, t]
  );

  // Download Queue & Scheduling
  const startingIdsRef = useRef<Set<string>>(new Set());
  const runDownloadItem = useCallback(
    (record: DownloadItemRecord) => {
      if (startingIdsRef.current.has(record.id)) return;
      startingIdsRef.current.add(record.id);
      if (settings.isWifiOnly && connectionKind !== 'WIFI') {
        startingIdsRef.current.delete(record.id);
        setDownloads((prev) =>
          prev.map((d) =>
            d.id === record.id
              ? { ...d, status: 'PAUSED', error: WIFI_HOLD_MARKER, bytesPerSecond: 0, etaSeconds: null }
              : d
          )
        );
        return;
      }

      setDownloads((prev) =>
        prev.map((d) =>
          d.id === record.id ? { ...d, status: 'DOWNLOADING', error: null } : d
        )
      );

      void startTransfer(
        record.id,
        record.url,
        Boolean(record.isHls),
        record.mimeType || 'video/mp4',
        {
          onProgress: (downloadedBytes, totalBytes, bytesPerSecond, etaSeconds) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.id === record.id
                  ? {
                      ...d,
                      status: 'DOWNLOADING',
                      downloadedBytes,
                      totalBytes: totalBytes ?? d.totalBytes,
                      bytesPerSecond,
                      etaSeconds,
                    }
                  : d
              )
            );
          },
          onComplete: (blobUrl, finalSize, mimeType, nativeUri) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.id === record.id
                  ? {
                      ...d,
                      status: 'COMPLETED',
                      downloadedBytes: finalSize,
                      totalBytes: finalSize,
                      bytesPerSecond: 0,
                      etaSeconds: null,
                      mimeType,
                      // A concatenated MPEG-TS playlist is a .ts file, calling it .mp4
                      // would hand the user a file most players refuse to open.
                      filename:
                        mimeType === 'video/mp2t'
                          ? d.filename.replace(/\.(mp4|m4v|m4a|webm)$/i, '.ts')
                          : d.filename,
                      blobUrl,
                      nativeUri: nativeUri ?? d.nativeUri ?? null,
                      exportedToGallery: settings.isExportToGallery,
                      completedAt: Date.now(),
                    }
                  : d
              )
            );
            if (settings.isExportToGallery && !isNativeAndroid()) {
              triggerBrowserFileSave(blobUrl, record.filename);
            }
            showToast(t('download_finished_named', { name: record.mediaTitle || record.filename }));
            logEvent('transfer', hostOfUrl(record.url) || 'media', 'completed');
          },
          onPaused: (downloadedBytes) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.id === record.id
                  ? {
                      ...d,
                      status: 'PAUSED',
                      downloadedBytes: downloadedBytes ?? d.downloadedBytes,
                      bytesPerSecond: 0,
                      etaSeconds: null,
                    }
                  : d
              )
            );
          },
          onCancelled: (downloadedBytes) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.id === record.id
                  ? {
                      ...d,
                      status: 'CANCELLED',
                      downloadedBytes: downloadedBytes ?? d.downloadedBytes,
                      bytesPerSecond: 0,
                      etaSeconds: null,
                    }
                  : d
              )
            );
          },
          onError: (message) => {
            setDownloads((prev) =>
              prev.map((d) =>
                d.id === record.id
                  ? { ...d, status: 'FAILED', error: message, bytesPerSecond: 0, etaSeconds: null }
                  : d
              )
            );
            logEvent('transfer', hostOfUrl(record.url) || 'media', `failed:${message}`);
          },
        },
        {
          filename: record.filename,
          parallelConnections: settings.parallelConnections,
          autoSaveToGallery: settings.isExportToGallery,
          audioTrackUrl: record.audioTrackUrl ?? null,
          referer: record.pageUrl ?? null,
          resumeFrom: record.downloadedBytes,
        }
      ).finally(() => {
        startingIdsRef.current.delete(record.id);
      });
    },
    [settings.isWifiOnly, settings.isExportToGallery, settings.parallelConnections, connectionKind, showToast, t, logEvent]
  );

  // Process queue slots up to maxSimultaneousDownloads
  useEffect(() => {
    const activeCount = downloads.filter((d) => d.status === 'DOWNLOADING' || d.status === 'PREPARING').length;
    const freeSlots = settings.maxSimultaneousDownloads - activeCount;
    if (freeSlots <= 0) return;
    if (settings.isWifiOnly && connectionKind !== 'WIFI') return;
    const queued = downloads.filter((d) => d.status === 'QUEUED');
    for (const item of queued.slice(0, freeSlots)) {
      runDownloadItem(item);
    }
  }, [downloads, settings.maxSimultaneousDownloads, settings.isWifiOnly, connectionKind, runDownloadItem]);

  // Resume wifi-held transfers when back on Wi-Fi
  useEffect(() => {
    if (!settings.isWifiOnly || connectionKind === 'WIFI') {
      const held = downloads.filter((d) => d.status === 'PAUSED' && d.error === WIFI_HOLD_MARKER);
      if (held.length > 0) {
        setDownloads((prev) =>
          prev.map((d) =>
            d.status === 'PAUSED' && d.error === WIFI_HOLD_MARKER
              ? { ...d, status: 'QUEUED', error: null }
              : d
          )
        );
      }
    }
  }, [settings.isWifiOnly, connectionKind, downloads]);

  const startDownloadFromFormat = useCallback(
    (format: MediaFormat, customFilename: string | null) => {
      const existing = downloads.find(
        (d) =>
          d.url === format.url &&
          (d.status === 'DOWNLOADING' || d.status === 'QUEUED' || d.status === 'PAUSED')
      );
      if (existing) {
        showToast(t('download_already_downloading', { name: existing.mediaTitle || existing.filename }));
        setQualitySheet(null);
        return;
      }

      const title = qualitySheet?.mediaInfo.title || format.format;
      const baseName = sanitizeFilename(customFilename || title);
      const ext = format.extension || 'mp4';
      const filename = baseName.endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`;

      const record: DownloadItemRecord = {
        id: makeId('dl'),
        url: format.url,
        mediaTitle: title,
        filename,
        mimeType: format.mimeType,
        thumbnail: qualitySheet?.mediaInfo.thumbnail ?? null,
        status: 'QUEUED',
        downloadedBytes: 0,
        totalBytes: format.size ?? null,
        bytesPerSecond: 0,
        etaSeconds: null,
        isLocked: false,
        exportedToGallery: false,
        isHls: format.isHls,
        isDash: format.isDash,
        audioTrackUrl: format.audioTrackUrl ?? null,
        createdAt: Date.now(),
        pageUrl: qualitySheet?.mediaInfo.webpageUrl,
      };

      setDownloads((prev) => [record, ...prev]);
      setQualitySheet(null);
      setIsMediaTrayVisible(false);
      showToast(t('download_enqueued'));
    },
    [downloads, qualitySheet, showToast, t]
  );

  const startBatchDownloadFromCandidates = useCallback(
    async (selectedCandidates: MediaCandidate[]) => {
      const offerables = selectedCandidates.filter(
        (c) =>
          unsupportedReasonFor({
            url: c.mediaUrl,
            mimeType: c.mimeType,
            extension: c.extension,
            isLive: c.isLive,
            isMediaSource: c.isMediaSource,
            isBlobFile: c.isBlobFile,
            dashIsSupported: true,
          }) === null
      );
      if (offerables.length === 0) {
        showToast(t('no_media_detected'));
        return;
      }

      const resolved = await Promise.all(
        offerables.map(async (candidate) => {
          const fallback = initialMediaInfoForCandidate(candidate);
          try {
            const probed = await probeMediaCandidate(candidate);
            const fmt = probed.mediaInfo.formats[0] || probed.mediaInfo.audioFormats[0] || fallback.formats[0];
            return { candidate, info: probed.mediaInfo, fmt };
          } catch {
            return { candidate, info: fallback, fmt: fallback.formats[0] };
          }
        })
      );

      const activeUrls = new Set(
        downloads
          .filter((d) => d.status === 'DOWNLOADING' || d.status === 'QUEUED' || d.status === 'PAUSED')
          .map((d) => d.url)
      );

      const newRecords: DownloadItemRecord[] = [];
      for (const item of resolved) {
        const fmt = item.fmt;
        if (!fmt || activeUrls.has(fmt.url)) continue;
        activeUrls.add(fmt.url);
        const title = item.info.title || item.candidate.title || fmt.format;
        const baseName = sanitizeFilename(title);
        const ext = fmt.extension || item.candidate.extension || 'mp4';
        const filename = baseName.endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`;
        newRecords.push({
          id: makeId('dl'),
          url: fmt.url,
          mediaTitle: title,
          filename,
          mimeType: fmt.mimeType,
          thumbnail: item.info.thumbnail ?? item.candidate.thumbnail ?? null,
          status: 'QUEUED',
          downloadedBytes: 0,
          totalBytes: fmt.size ?? item.candidate.estimatedSize ?? null,
          bytesPerSecond: 0,
          etaSeconds: null,
          isLocked: false,
          exportedToGallery: false,
          isHls: fmt.isHls,
          isDash: fmt.isDash,
          audioTrackUrl: fmt.audioTrackUrl ?? null,
          createdAt: Date.now(),
          pageUrl: item.candidate.pageUrl,
        });
      }

      if (newRecords.length > 0) {
        setDownloads((prev) => [...newRecords, ...prev]);
        setIsMediaTrayVisible(false);
        showToast(t('download_enqueued'));
      } else {
        setIsMediaTrayVisible(false);
      }
    },
    [downloads, showToast, t]
  );

  const pauseDownload = useCallback((id: string) => {
    pauseTransfer(id);
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'PAUSED', bytesPerSecond: 0, etaSeconds: null } : d))
    );
  }, []);

  const resumeDownload = useCallback((id: string) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'QUEUED', error: null } : d))
    );
  }, []);

  const cancelDownload = useCallback((id: string) => {
    cancelTransfer(id);
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'CANCELLED', bytesPerSecond: 0, etaSeconds: null } : d))
    );
  }, []);

  const retryDownload = useCallback((id: string) => {
    setDownloads((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, status: 'QUEUED', downloadedBytes: 0, error: null } : d
      )
    );
  }, []);

  const deleteDownload = useCallback((id: string) => {
    cancelTransfer(id);
    discardPartialTransfer(id);
    releaseBlobUrl(id);
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const clearDownloadsByBucket = useCallback((bucket: 'active' | 'completed' | 'failed') => {
    setDownloads((prev) =>
      prev.filter((d) => {
        if (bucket === 'active') {
          const isAct = d.status === 'DOWNLOADING' || d.status === 'PAUSED' || d.status === 'PREPARING';
          if (isAct) {
            cancelTransfer(d.id);
            discardPartialTransfer(d.id);
          }
          return !isAct;
        }
        if (bucket === 'completed') {
          if (d.status === 'COMPLETED' && !d.isLocked) {
            releaseBlobUrl(d.id);
            return false;
          }
          return true;
        }
        return !(d.status === 'FAILED' || d.status === 'CANCELLED');
      })
    );
  }, []);

  const exportDownloadToDevice = useCallback(
    (id: string) => {
      const target = downloads.find((d) => d.id === id);
      if (!target) return;
      const native = getSalviaNative();
      if (native && target.nativeUri) {
        native.openNativeFile(target.nativeUri, target.mimeType || 'video/mp4');
        return;
      }
      const liveBlob = getCompletedBlobUrl(id) || target.blobUrl;
      if (liveBlob) {
        triggerBrowserFileSave(liveBlob, target.filename);
      } else {
        triggerBrowserFileSave(apiUrl(`/api/media/fetch?url=${encodeURIComponent(target.url)}`), target.filename);
      }
      setDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, exportedToGallery: true } : d))
      );
      showToast(t('download_exported'));
    },
    [downloads, showToast, t]
  );

  const playDownloadInApp = useCallback(
    (id: string) => {
      const target = downloads.find((d) => d.id === id);
      if (!target) return;
      const liveBlob = getCompletedBlobUrl(id) || (target.blobUrl?.startsWith('https://appassets.androidplatform.net/') ? target.blobUrl : null);
      const playableUrl = liveBlob || (target.isHls ? apiUrl(`/api/media/fetch?url=${encodeURIComponent(target.url)}`) : target.url);
      navigate('player', {
        player: {
          url: playableUrl,
          title: target.mediaTitle || target.filename,
          downloadId: target.id,
          isHls: Boolean(target.isHls && !liveBlob),
        },
      });
    },
    [downloads, navigate]
  );

  const shareDownload = useCallback(
    async (id: string) => {
      const target = downloads.find((d) => d.id === id);
      if (!target) return;
      const native = getSalviaNative();
      if (native && target.nativeUri) {
        if (native.shareNativeFile(target.nativeUri, target.mediaTitle || target.filename, target.mimeType || 'video/mp4')) {
          return;
        }
      }
      if (navigator.share) {
        try {
          await navigator.share({ title: target.mediaTitle || target.filename, url: target.url });
          return;
        } catch {
          // fallback to clipboard
        }
      }
      await navigator.clipboard?.writeText(target.url);
      showToast(t('link_copied'));
    },
    [downloads, showToast, t]
  );

  // Locked Folder State
  const [isLockedFolderConfigured, setIsLockedFolderConfigured] = useState(() => isPasswordConfigured());
  const [isLockedFolderUnlocked, setIsLockedFolderUnlocked] = useState(false);
  const [isUnlockingFolder, setIsUnlockingFolder] = useState(false);
  const lockoutRef = useRef(new LockoutPolicy());

  const unlockLockedFolder = useCallback(
    async (password: string) => {
      const now = Date.now();
      if (lockoutRef.current.isLockedOut(now)) {
        const seconds = Math.ceil(lockoutRef.current.remainingMillis(now) / 1000);
        showToast(t('locked_folder_try_later', { seconds }));
        return;
      }
      setIsUnlockingFolder(true);
      try {
        const ok = await verifyLockedFolderPassword(password);
        if (ok) {
          lockoutRef.current.onSuccess();
          setIsLockedFolderUnlocked(true);
        } else {
          lockoutRef.current.onFailure(now);
          showToast(t('locked_folder_wrong_password'));
        }
      } finally {
        setIsUnlockingFolder(false);
      }
    },
    [showToast, t]
  );

  const lockLockedFolder = useCallback(() => {
    setIsLockedFolderUnlocked(false);
  }, []);

  const saveLockedFolderPassword = useCallback(
    async (password: string) => {
      const ok = await setLockedFolderPassword(password);
      if (ok) {
        setIsLockedFolderConfigured(true);
        showToast(t('locked_folder_set'));
      }
      return ok;
    },
    [showToast, t]
  );

  const removeLockedFolderPasswordAction = useCallback(() => {
    removeLockedFolderPassword();
    setIsLockedFolderConfigured(false);
    setIsLockedFolderUnlocked(false);
    setDownloads((prev) => prev.map((d) => ({ ...d, isLocked: false })));
    showToast(t('locked_folder_removed'));
  }, [showToast, t]);

  const setDownloadLocked = useCallback(
    (id: string, locked: boolean) => {
      if (locked && !isLockedFolderConfigured) {
        showToast(t('locked_folder_not_configured'));
        return;
      }
      setDownloads((prev) => prev.map((d) => (d.id === id ? { ...d, isLocked: locked } : d)));
      showToast(t(locked ? 'download_locked' : 'download_unlocked'));
    },
    [isLockedFolderConfigured, showToast, t]
  );

  // Media candidates for current tab
  const currentTabCandidates = useMemo(() => tabMedia[currentTabId] || [], [tabMedia, currentTabId]);
  const { main: currentMainCandidate, ranked: rankedTabCandidates } = useMemo(
    () =>
      rankAndClassifyCandidates(
        currentTabCandidates,
        tabVisibleMedia[currentTabId] ?? null,
        currentTab?.url ?? null
      ),
    [currentTabCandidates, tabVisibleMedia, currentTabId, currentTab?.url]
  );

  const downloadMainMedia = useCallback(() => {
    if (rankedTabCandidates.length === 1 && currentMainCandidate) {
      openQualitySheetForCandidate(currentMainCandidate);
    } else if (currentTabCandidates.length > 0) {
      setIsMediaTrayVisible(true);
    } else {
      showToast(t('no_media_detected'));
    }
  }, [rankedTabCandidates.length, currentMainCandidate, currentTabCandidates.length, openQualitySheetForCandidate, showToast, t]);

  // Playback capture for blob/MSE streams: real MediaRecorder output, never a
  // simulated byte counter. Unsupported runtimes get an honest refusal.
  const [recording, setRecording] = useState<RecordingState>({ isRecording: false, bytes: 0 });
  const recorderRef = useRef<StreamRecorderHandle | null>(null);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  const startRecordingPlayback = useCallback(() => {
    const candidate = qualitySheet?.candidate;
    if (!candidate?.mediaUrl) return;
    if (!isStreamRecordingSupported()) {
      showToast(t('recording_unavailable'));
      return;
    }
    if (recorderRef.current) return;
    setRecording({ isRecording: false, bytes: 0 });
    void (async () => {
      const handle = await startStreamRecording(candidate.mediaUrl, {
        referer: candidate.pageUrl ?? null,
        onBytes: (bytes) => setRecording({ isRecording: true, bytes }),
      });
      if (!handle) {
        setRecording({ isRecording: false, bytes: 0 });
        showToast(t('recording_unavailable'));
        return;
      }
      recorderRef.current = handle;
      setRecording({ isRecording: true, bytes: 0 });
    })();
  }, [qualitySheet?.candidate, showToast, t]);

  const stopRecordingPlayback = useCallback(() => {
    const handle = recorderRef.current;
    recorderRef.current = null;
    void (async () => {
      const result = handle ? await handle.stop() : null;
      if (!result || result.blob.size === 0) {
        setRecording({ isRecording: false, bytes: 0 });
        showToast(t('recording_unavailable'));
        return;
      }
      const title = qualitySheet?.mediaInfo.title || currentTab?.title || 'Recording';
      const id = makeId('rec');
      const blobUrl = URL.createObjectURL(result.blob);
      registerCompletedBlobUrl(id, blobUrl);
      const extension = result.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const rec: DownloadItemRecord = {
        id,
        url: qualitySheet?.candidate.mediaUrl || currentTab?.url || '',
        mediaTitle: `${title} (Recording)`,
        filename: `${sanitizeFilename(title)}_recording.${extension}`,
        mimeType: result.mimeType || 'video/webm',
        status: 'COMPLETED',
        downloadedBytes: result.blob.size,
        totalBytes: result.blob.size,
        bytesPerSecond: 0,
        etaSeconds: null,
        isLocked: false,
        exportedToGallery: false,
        blobUrl,
        createdAt: Date.now(),
        completedAt: Date.now(),
        pageUrl: qualitySheet?.mediaInfo.webpageUrl ?? null,
      };
      setDownloads((prev) => [rec, ...prev]);
      setRecording({ isRecording: false, bytes: 0 });
      showToast(t('recording_saved'));
    })();
  }, [
    qualitySheet?.candidate,
    qualitySheet?.mediaInfo.title,
    qualitySheet?.mediaInfo.webpageUrl,
    currentTab?.title,
    currentTab?.url,
    showToast,
    t,
  ]);

  // Bridge callbacks
  const reportDetectedMediaFromBridge = useCallback(
    (
      tabId: string,
      pageUrl: string,
      items: Array<{
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
      }>
    ) => {
      const converted: MediaCandidate[] = items
        .filter((item) => Boolean(item) && /^https?:\/\//i.test(item.url))
        .slice(0, 40)
        .map((item, idx) => ({
        id: `bridge-${idx}-${item.url}`,
        pageUrl,
        mediaUrl: item.url,
        title: tabPages[tabId]?.title || item.url.split('/').pop(),
        mimeType: item.type || (item.tag === 'audio' ? 'audio/mpeg' : 'video/mp4'),
        extension: item.url.split('.').pop()?.split('?')[0]?.toLowerCase() || 'mp4',
        source: 'DOM',
        confidence: item.visible && !item.isAd && !item.isSuggested ? 0.94 : item.isAd ? 0.25 : 0.78,
        duration: item.durationMs ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        muted: item.muted,
        hasControls: item.hasControls,
        isAd: item.isAd,
        isSuggested: item.isSuggested,
      }));
      mergeTabCandidates(tabId, converted);
    },
    [tabPages, mergeTabCandidates]
  );

  const reportVisibleMediaFromBridge = useCallback((tabId: string, _pageUrl: string, mediaUrl: string) => {
    setTabVisibleMedia((prev) => ({ ...prev, [tabId]: mediaUrl }));
  }, []);

  const [pageZoom, setPageZoom] = useState<number>(100);

  // Bookmarks & History helpers
  const isCurrentTabBookmarked = useMemo(
    () => Boolean(currentTab?.url && bookmarks.some((b) => b.url === currentTab.url)),
    [bookmarks, currentTab?.url]
  );

  const addBookmarkForCurrentTab = useCallback(() => {
    if (!currentTab?.url) return;
    setBookmarks((prev) => {
      if (prev.some((b) => b.url === currentTab.url)) return prev;
      return [{ id: makeId('bm'), title: currentTab.title || currentTab.url, url: currentTab.url, createdAt: Date.now() }, ...prev];
    });
    showToast(t('bookmark_added'));
  }, [currentTab, showToast, t]);

  const toggleBookmarkForCurrentTab = useCallback(() => {
    if (!currentTab?.url) return;
    const existing = bookmarks.find((b) => b.url === currentTab.url);
    if (existing) {
      setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
      showToast(t('bookmark_removed'));
    } else {
      addBookmarkForCurrentTab();
    }
  }, [currentTab?.url, bookmarks, addBookmarkForCurrentTab, showToast, t]);

  const deleteBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const duplicateTab = useCallback(
    (tabId: string) => {
      const source = tabs.find((item) => item.id === tabId);
      if (!source) return;
      createTab({ isPrivate: source.isPrivate, url: source.url || undefined });
    },
    [tabs, createTab]
  );

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      const target = tabs.find((item) => item.id === tabId);
      if (!target) return;
      setTabs([target]);
      setCurrentTabId(target.id);
    },
    [tabs]
  );

  const deleteHistoryEntry = useCallback((id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    showToast(t('settings_history_cleared'));
  }, [showToast, t]);

  const clearCookiesAndStorage = useCallback(() => {
    getSalviaNative()?.nativeClearBrowserData?.();
    showToast(t('settings_cookies_cleared'));
  }, [showToast, t]);

  const clearAllBrowsingData = useCallback(() => {
    getSalviaNative()?.nativeClearBrowserData?.();
    setHistory([]);
    showToast(t('settings_browsing_data_cleared'));
  }, [showToast, t]);

  const openUrlFromLibrary = useCallback(
    (url: string) => {
      setRoute('browser');
      loadUrlIntoTab(currentTabId, url, true);
    },
    [currentTabId, loadUrlIntoTab]
  );

  const getAddressSuggestions = useCallback(
    (query: string): AddressSuggestion[] => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const results: AddressSuggestion[] = [];
      const seen = new Set<string>();
      for (const b of bookmarks) {
        if (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) {
          seen.add(b.url);
          results.push({ title: b.title, url: b.url, source: 'BOOKMARK' });
        }
      }
      for (const h of history) {
        if (!seen.has(h.url) && (h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))) {
          seen.add(h.url);
          results.push({ title: h.title, url: h.url, source: 'HISTORY' });
        }
      }
      return results.slice(0, 6);
    },
    [bookmarks, history]
  );

  const isAdBlockOffForCurrentSite = useCallback(() => {
    const host = hostOfUrl(currentTab?.url);
    return host ? settings.adBlockDisabledSites.includes(host) : false;
  }, [currentTab?.url, settings.adBlockDisabledSites]);

  const toggleAdBlockForCurrentSite = useCallback(() => {
    const host = hostOfUrl(currentTab?.url);
    if (!host) return;
    setSettings((prev) => {
      const isOff = prev.adBlockDisabledSites.includes(host);
      const nextList = isOff
        ? prev.adBlockDisabledSites.filter((h) => h !== host)
        : [...prev.adBlockDisabledSites, host];
      showToast(t(isOff ? 'ad_block_on_here' : 'ad_block_off_here', { host }));
      return { ...prev, adBlockDisabledSites: nextList };
    });
  }, [currentTab?.url, showToast, t]);

  const allowCleartextAndRetry = useCallback(() => {
    const target = blockedCleartextUrl;
    if (!target) return;
    setSettings((prev) => ({ ...prev, isCleartextAllowed: true }));
    setBlockedCleartextUrl(null);
    loadUrlIntoTab(currentTabId, target, true, true);
  }, [blockedCleartextUrl, currentTabId, loadUrlIntoTab]);

  const dismissCleartextBlock = useCallback(() => setBlockedCleartextUrl(null), []);

  // Update check
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({
    isChecking: false,
    availableVersion: null,
    availableUrl: null,
    availableNotes: null,
  });

  const checkForUpdates = useCallback(async () => {
    if (updateCheck.isChecking) return;
    setUpdateCheck((prev) => ({ ...prev, isChecking: true }));
    try {
      const res = await fetch(RELEASES_API_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { tag_name?: string; html_url?: string; body?: string };
      const remoteVersion = (json.tag_name || '').replace(/^v/i, '').trim();
      if (remoteVersion && remoteVersion !== APP_VERSION) {
        setUpdateCheck({
          isChecking: false,
          availableVersion: remoteVersion,
          availableUrl: json.html_url || null,
          availableNotes: json.body || null,
        });
      } else {
        setUpdateCheck({ isChecking: false, availableVersion: null, availableUrl: null, availableNotes: null });
        showToast(t('update_up_to_date'));
      }
    } catch {
      setUpdateCheck({ isChecking: false, availableVersion: null, availableUrl: null, availableNotes: null });
      showToast(t('update_check_failed'));
    }
  }, [updateCheck.isChecking, showToast, t]);

  const dismissUpdateDialog = useCallback(() => {
    setUpdateCheck((prev) => ({ ...prev, availableVersion: null }));
  }, []);

  const exportDiagnostics = useCallback(() => {
    const payload = {
      app: 'SalviaBrowxer',
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      adBlockStats: {
        enabled: settings.isAdBlockEnabled,
        blockedRequests: settings.adBlockBlockedRequests,
        exemptSites: settings.adBlockDisabledSites.length,
      },
      events: diagnostics,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    triggerBrowserFileSave(url, 'salviabrowxer-diagnostics.json');
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [settings.isAdBlockEnabled, settings.adBlockBlockedRequests, settings.adBlockDisabledSites.length, diagnostics]);

  const activeDownloadsCount = useMemo(
    () =>
      downloads.filter(
        (d) =>
          d.status === 'DOWNLOADING' ||
          d.status === 'QUEUED' ||
          d.status === 'PREPARING' ||
          d.status === 'RESOLVING' ||
          d.status === 'PAUSED'
      ).length,
    [downloads]
  );

  const completedDownloadsCount = useMemo(
    () => downloads.filter((d) => d.status === 'COMPLETED' && (!d.isLocked || isLockedFolderUnlocked)).length,
    [downloads, isLockedFolderUnlocked]
  );

  const value: AppContextValue = {
    route,
    downloadsInitialTab,
    playerTarget,
    navigate,
    locale,
    isRtl,
    t,
    settings,
    updateSettings,
    tabs,
    currentTabId,
    currentTab,
    hibernatedTabIds,
    tabPages,
    tabMedia,
    tabVisibleMedia,
    isTabSwitcherVisible,
    openTabSwitcher: () => setIsTabSwitcherVisible(true),
    closeTabSwitcher: () => setIsTabSwitcherVisible(false),
    createTab,
    switchTab,
    closeTab,
    navigateCurrentTab,
    openPastedLink,
    isExtractingLink,
    extractFromPastedPage,
    reloadCurrentTab,
    stopLoadingCurrentTab,
    goBackCurrentTab,
    goForwardCurrentTab,
    goHomeInCurrentTab,
    blockedCleartextUrl,
    allowCleartextAndRetry,
    dismissCleartextBlock,
    isAdBlockOffForCurrentSite,
    toggleAdBlockForCurrentSite,
    bookmarks,
    isCurrentTabBookmarked,
    addBookmarkForCurrentTab,
    toggleBookmarkForCurrentTab,
    deleteBookmark,
    openUrlFromLibrary,
    duplicateTab,
    closeOtherTabs,
    pageZoom,
    setPageZoom,
    history,
    deleteHistoryEntry,
    clearHistory,
    clearCookiesAndStorage,
    clearAllBrowsingData,
    getAddressSuggestions,
    currentTabCandidates,
    rankedTabCandidates,
    currentMainCandidate,
    isMediaTrayVisible,
    openMediaTray: () => setIsMediaTrayVisible(true),
    closeMediaTray: () => setIsMediaTrayVisible(false),
    qualitySheet,
    openQualitySheetForCandidate,
    closeQualitySheet: () => setQualitySheet(null),
    startDownloadFromFormat,
    startBatchDownloadFromCandidates,
    downloadMainMedia,
    recording,
    startRecordingPlayback,
    stopRecordingPlayback,
    downloads,
    activeDownloadsCount,
    completedDownloadsCount,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    deleteDownload,
    clearDownloadsByBucket,
    exportDownloadToDevice,
    playDownloadInApp,
    shareDownload,
    setDownloadLocked,
    isLockedFolderConfigured,
    isLockedFolderUnlocked,
    isUnlockingFolder,
    unlockLockedFolder,
    lockLockedFolder,
    saveLockedFolderPassword,
    removeLockedFolderPasswordAction,
    findInPage,
    openFindInPage: () => setFindInPage({ query: '', matches: 0, activeMatch: 0 }),
    closeFindInPage: () => {
      getSalviaNative()?.nativeClearFindInPage?.();
      setFindInPage(null);
    },
    updateFindQuery: (query: string) => setFindInPage((prev) => (prev ? { ...prev, query } : { query, matches: 0, activeMatch: 0 })),
    setFindResult: (matches: number, activeMatch: number) =>
      setFindInPage((prev) => (prev ? { ...prev, matches, activeMatch } : null)),
    isNativeBrowserEngine,
    nativeNavCaps,
    reportDetectedMediaFromBridge,
    reportVisibleMediaFromBridge,
    connectionKind,
    updateCheck,
    checkForUpdates,
    dismissUpdateDialog,
    diagnostics,
    exportDiagnostics,
    toastMessage,
    showToast,
  };

  // Sync browser runtime preferences to Android native WebView cleanly
  useEffect(() => {
    if (!isNativeBrowserEngine) return;
    const host = hostOfUrl(currentTab?.url) || '';
    const adBlockActive = settings.isAdBlockEnabled && !settings.adBlockDisabledSites.includes(host);
    getSalviaNative()?.nativeUpdateBrowserSettings?.(
      settings.isDesktopSite,
      settings.isJavaScriptEnabled,
      adBlockActive,
      settings.areCookiesEnabled,
      pageZoom
    );
  }, [
    isNativeBrowserEngine,
    currentTab?.url,
    settings.isDesktopSite,
    settings.isJavaScriptEnabled,
    settings.isAdBlockEnabled,
    settings.adBlockDisabledSites,
    settings.areCookiesEnabled,
    pageZoom,
  ]);

  // Listen to native Chromium browserWebView events & live network media sniffing
  useEffect(() => {
    if (!isNativeBrowserEngine) return;
    return registerNativeBrowserListener((ev) => {
      const targetTabId = ev.tabId || currentTabIdRef.current;
      if (ev.type === 'page-started') {
        const host = hostOfUrl(ev.url) || ev.url;
        setTabPages((prev) => ({
          ...prev,
          [targetTabId]: {
            url: ev.url,
            title: prev[targetTabId]?.title || host,
            html: null,
            isLoading: true,
            progress: 18,
            error: null,
            isDemoShowcase: false,
          },
        }));
        setTabs((prev) =>
          prev.map((tab) => (tab.id === targetTabId ? { ...tab, url: ev.url } : tab))
        );
        setNativeNavCaps((prev) => ({
          ...prev,
          [targetTabId]: {
            canGoBack: Boolean(ev.canGoBack),
            canGoForward: Boolean(ev.canGoForward),
          },
        }));
        if (!isYouTubeExcludedUrl(ev.url) && analyzePastedLink(ev.url)?.category === 'PLATFORM_PAGE') {
          void extractMediaFromPageUrl(ev.url).then((extracted) => {
            if (extracted.ok && extracted.candidates.length > 0) {
              mergeTabCandidates(targetTabId, extracted.candidates);
            }
          });
        }
      } else if (ev.type === 'progress') {
        setTabPages((prev) => {
          const cur = prev[targetTabId];
          if (!cur || !cur.isLoading) return prev;
          if (Math.abs(ev.progress - cur.progress) < 5 && ev.progress < 100) return prev;
          return {
            ...prev,
            [targetTabId]: {
              ...cur,
              progress: ev.progress,
              isLoading: ev.progress < 100,
            },
          };
        });
      } else if (ev.type === 'title') {
        setTabPages((prev) => {
          const cur = prev[targetTabId];
          if (!cur) return prev;
          return { ...prev, [targetTabId]: { ...cur, title: ev.title } };
        });
        setTabs((prev) =>
          prev.map((tab) => (tab.id === targetTabId ? { ...tab, title: ev.title } : tab))
        );
      } else if (ev.type === 'page-finished') {
        const finalTitle = ev.title || hostOfUrl(ev.url) || ev.url;
        setTabPages((prev) => ({
          ...prev,
          [targetTabId]: {
            url: ev.url,
            title: finalTitle,
            html: null,
            isLoading: false,
            progress: 100,
            error: null,
            isDemoShowcase: false,
          },
        }));
        setTabs((prev) =>
          prev.map((tab) => (tab.id === targetTabId ? { ...tab, url: ev.url, title: finalTitle } : tab))
        );
        setNativeNavCaps((prev) => ({
          ...prev,
          [targetTabId]: {
            canGoBack: Boolean(ev.canGoBack),
            canGoForward: Boolean(ev.canGoForward),
          },
        }));
        const tabObj = tabsRef.current.find((tItem) => tItem.id === targetTabId);
        if (tabObj && !tabObj.isPrivate) {
          setHistory((prev) => [
            { id: makeId('hist'), title: finalTitle, url: ev.url, visitedAt: Date.now() },
            ...prev.filter((h) => h.url !== ev.url).slice(0, 199),
          ]);
        }
      } else if (ev.type === 'adblock-blocked') {
        setSettings((prev) => ({
          ...prev,
          adBlockBlockedRequests: prev.adBlockBlockedRequests + 1,
        }));
      } else if (ev.type === 'media-sniffed') {
        if (!ev.mediaUrl || isYouTubeExcludedUrl(ev.mediaUrl) || isYouTubeExcludedUrl(ev.pageUrl)) {
          return;
        }
        const ext = ev.mediaUrl.split('.').pop()?.split('?')[0]?.split('#')[0]?.toLowerCase() || 'mp4';
        const sniffedCandidate: MediaCandidate = {
          id: `sniff-${ev.mediaUrl}`,
          pageUrl: ev.pageUrl || tabsRef.current.find((x) => x.id === targetTabId)?.url || '',
          mediaUrl: ev.mediaUrl,
          title: tabsRef.current.find((x) => x.id === targetTabId)?.title || ev.mediaUrl.split('/').pop(),
          mimeType: ev.mimeType || (ext === 'm3u8' ? 'application/vnd.apple.mpegurl' : ext === 'mpd' ? 'application/dash+xml' : 'video/mp4'),
          extension: ext.length <= 5 ? ext : 'mp4',
          source: ev.source || 'FETCH',
          confidence: 0.92,
        };
        mergeTabCandidates(targetTabId, [sniffedCandidate]);
      } else if (ev.type === 'media-dom') {
        reportDetectedMediaFromBridge(targetTabId, ev.pageUrl, ev.items);
      } else if (ev.type === 'visible-media') {
        reportVisibleMediaFromBridge(targetTabId, ev.pageUrl, ev.mediaUrl);
      } else if (ev.type === 'find-result') {
        setFindInPage((prev) => (prev ? { ...prev, matches: ev.matches, activeMatch: ev.active } : null));
      }
    });
  }, [
    isNativeBrowserEngine,
    mergeTabCandidates,
    reportDetectedMediaFromBridge,
    reportVisibleMediaFromBridge,
  ]);

  useEffect(() => {
    return registerNativeBackHandler(() => {
      if (qualitySheet) {
        setQualitySheet(null);
        return true;
      }
      if (isMediaTrayVisible) {
        setIsMediaTrayVisible(false);
        return true;
      }
      if (isTabSwitcherVisible) {
        setIsTabSwitcherVisible(false);
        return true;
      }
      if (route === 'player') {
        setRoute('downloads');
        return true;
      }
      if (route === 'browser' && currentTab.historyIndex > 0) {
        goBackCurrentTab();
        return true;
      }
      if (route !== 'home') {
        setRoute('home');
        return true;
      }
      return false;
    });
  }, [
    qualitySheet,
    isMediaTrayVisible,
    isTabSwitcherVisible,
    route,
    currentTab.historyIndex,
    goBackCurrentTab,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openUrl = params.get('open');
    if (openUrl && /^https?:\/\//i.test(openUrl)) {
      loadUrlIntoTab(currentTabId, openUrl, true);
    }
    const win = window as unknown as { __salviaOpenUrl?: (url: string) => void };
    win.__salviaOpenUrl = (nextUrl: string) => {
      if (nextUrl && /^https?:\/\//i.test(nextUrl)) {
        loadUrlIntoTab(currentTabId, nextUrl, true);
      }
    };
    return () => {
      delete win.__salviaOpenUrl;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
