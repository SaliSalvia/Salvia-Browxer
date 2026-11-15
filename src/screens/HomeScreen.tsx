import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Download,
  Film,
  Globe,
  History,
  Lock,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { BrowserNavRail } from '../components/BrowserNavRail';
import { DownloadItemRow } from '../components/DownloadItemRow';
import { LOGO_ASSET_PATH, OrbitalBrandMark } from '../components/OrbitalBrandMark';
import {
  BUILTIN_SHOWCASE_PAGES,
  SEARCH_ENGINE_OPTIONS,
  WIFI_HOLD_MARKER,
} from '../core/constants';
import { hostOfUrl } from '../core/adBlockRules';
import { classifyPastedLink } from '../core/pastedLink';
import { useApp } from '../store/AppContext';
import type { SearchEngineKey } from '../types/models';

export const HomeScreen: React.FC = () => {
  const {
    navigate,
    isRtl,
    t,
    settings,
    updateSettings,
    tabs,
    bookmarks,
    history,
    downloads,
    activeDownloadsCount,
    createTab,
    openPastedLink,
    isExtractingLink,
    extractFromPastedPage,
    openUrlFromLibrary,
    getAddressSuggestions,
    showToast,
  } = useApp();

  const [pasteInput, setPasteInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [clipboardBanner, setClipboardBanner] = useState<{
    url: string;
    kind: 'MEDIA_FILE' | 'WEB_PAGE';
  } | null>(null);
  const [dismissedClipboard, setDismissedClipboard] = useState(false);

  const trimmedInput = pasteInput.trim();
  const normalizedPasteInput = (() => {
    if (!trimmedInput) return '';
    if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmedInput) && !/\s/.test(trimmedInput) && trimmedInput.includes('.')) {
      return `https://${trimmedInput}`;
    }
    return trimmedInput;
  })();

  const linkKind = classifyPastedLink(normalizedPasteInput);
  const isSearchQuery = Boolean(trimmedInput) && !linkKind;
  const suggestions = inputFocused ? getAddressSuggestions(trimmedInput) : [];

  const activeItems = downloads
    .filter(
      (d) =>
        d.status === 'DOWNLOADING' ||
        d.status === 'QUEUED' ||
        d.status === 'PREPARING' ||
        d.status === 'RESOLVING' ||
        (d.status === 'PAUSED' && d.error === WIFI_HOLD_MARKER)
    )
    .slice(0, 3);

  useEffect(() => {
    let active = true;
    const inspectClipboard = async () => {
      if (dismissedClipboard || !navigator.clipboard?.readText) return;
      try {
        const text = await navigator.clipboard.readText();
        if (!active || !text) return;
        const kind = classifyPastedLink(text);
        if (kind) {
          setClipboardBanner({ url: text.trim(), kind });
        }
      } catch {
        // Ignore silent permission denial
      }
    };
    inspectClipboard();
    return () => {
      active = false;
    };
  }, [dismissedClipboard]);

  const handlePasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      showToast(t('home_empty_clipboard'));
      return;
    }
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        showToast(t('home_empty_clipboard'));
        return;
      }
      setPasteInput(text);
    } catch {
      showToast(t('home_empty_clipboard'));
    }
  };

  const handleSubmitOmnibox = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!trimmedInput) {
      showToast(t('home_invalid_link'));
      return;
    }
    setInputFocused(false);
    openPastedLink(linkKind ? normalizedPasteInput : trimmedInput);
  };

  const ForwardArrow = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="relative flex min-h-screen overflow-x-hidden bg-[#000000] text-[#F4F2FF]">
      <BrowserNavRail />

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Large transparent-background low-opacity watermark logo in HomeScreen backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden md:ps-[68px]"
        >
          <img
            src={LOGO_ASSET_PATH}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            className="h-[min(92vw,760px)] w-[min(92vw,760px)] select-none object-contain opacity-[0.17] mix-blend-screen"
            style={{
              maskImage:
                'radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0.65) 70%, rgba(0,0,0,0) 88%)',
              WebkitMaskImage:
                'radial-gradient(circle at center, rgba(0,0,0,1) 50%, rgba(0,0,0,0.65) 70%, rgba(0,0,0,0) 88%)',
            }}
          />
        </div>

        {/* Compact Mobile Top Bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#312556]/60 bg-[#070510]/85 px-4 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-2.5">
            <OrbitalBrandMark size={30} showRing={false} />
            <span className="font-display text-[17px] font-bold tracking-tight text-[#F4F2FF]">
              {t('app_name')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate('settings')}
              aria-label={t('settings')}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate('browser')}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8F6BFF] to-[#5A34D9] px-3.5 text-[13px] font-semibold text-white"
            >
              <Globe className="h-4 w-4" />
              <span>{t('home_open_browser')}</span>
            </button>
          </div>
        </header>

        <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-between gap-8 px-4 py-6 sm:px-8 sm:py-10">
          {/* Cosmic Emblem + Hero Omnibox */}
          <section className="flex flex-col items-center text-center">
            <div className="relative mb-4 flex items-center justify-center">
              <OrbitalBrandMark size={104} showRing={false} />
            </div>

            <h1 className="font-display text-balance text-[26px] font-bold tracking-tight text-[#F4F2FF] sm:text-[34px]">
              {t('home_hero_title')}
            </h1>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[#A6ACC4] sm:text-[15px]">
              {t('home_hero_subtitle')}
            </p>

            {/* Unified Smart Omnibox + Link Classifier */}
            <div className="mt-6 w-full max-w-3xl text-start">
              {clipboardBanner ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#4CC4FF]/45 bg-[#0B2C44]/75 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-[#A8E6FF]">
                      {clipboardBanner.kind === 'MEDIA_FILE'
                        ? t('home_clipboard_media')
                        : t('home_clipboard_page')}
                    </p>
                    <p className="font-data truncate text-[12px] text-[#F4F2FF]">
                      {clipboardBanner.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPasteInput(clipboardBanner.url);
                        setClipboardBanner(null);
                      }}
                      className="min-h-10 rounded-xl bg-[#4CC4FF] px-3.5 text-[12px] font-bold text-[#000000]"
                    >
                      {t('home_clipboard_use')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClipboardBanner(null);
                        setDismissedClipboard(true);
                      }}
                      className="min-h-10 rounded-xl px-2.5 text-[12px] font-medium text-[#A6ACC4] hover:text-[#F4F2FF]"
                    >
                      {t('home_clipboard_dismiss')}
                    </button>
                  </div>
                </div>
              ) : null}

              <form onSubmit={handleSubmitOmnibox} className="relative">
                <div className="flex flex-col gap-2.5 rounded-3xl border border-[#312556] bg-[#100C20]/80 p-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-md focus-within:border-[#8F6BFF] sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 border-b border-[#312556]/60 pb-2 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-2">
                    <label htmlFor="home-search-engine" className="sr-only">
                      {t('settings_search_engine')}
                    </label>
                    <select
                      id="home-search-engine"
                      value={settings.searchEngine}
                      onChange={(e) =>
                        updateSettings({ searchEngine: e.target.value as SearchEngineKey })
                      }
                      className="h-10 cursor-pointer rounded-xl bg-[#18122E] px-2.5 text-[12px] font-semibold text-[#A8E6FF] outline-none hover:bg-[#312556]/60"
                    >
                      {SEARCH_ENGINE_OPTIONS.map((eng) => (
                        <option key={eng} value={eng} className="bg-[#100C20] text-[#F4F2FF]">
                          {eng}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="relative flex min-w-0 flex-1 items-center">
                    <Search className="pointer-events-none ms-1.5 h-4 w-4 shrink-0 text-[#7F86A3]" />
                    <input
                      type="text"
                      value={pasteInput}
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => window.setTimeout(() => setInputFocused(false), 160)}
                      onChange={(e) => setPasteInput(e.target.value)}
                      placeholder={`${t('search_or_type_url')} · ${t('home_paste_hint')}`}
                      dir="ltr"
                      aria-label={t('home_paste_title')}
                      className="h-11 min-w-0 flex-1 bg-transparent px-2.5 text-[14px] text-[#F4F2FF] placeholder-[#7F86A3] outline-none"
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      {pasteInput ? (
                        <button
                          type="button"
                          onClick={() => setPasteInput('')}
                          aria-label={t('home_clear_input')}
                          title={t('home_clear_input')}
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-[#7F86A3] hover:bg-[#18122E] hover:text-[#F4F2FF]"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={handlePasteFromClipboard}
                        aria-label={t('home_paste_from_clipboard')}
                        title={t('home_paste_from_clipboard')}
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-[#4CC4FF] hover:bg-[#18122E]"
                      >
                        <ClipboardPaste className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {linkKind === 'WEB_PAGE' ? (
                      <button
                        type="button"
                        disabled={isExtractingLink}
                        onClick={() => extractFromPastedPage(normalizedPasteInput)}
                        className="flex h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl border border-[#D9AE54]/60 bg-[#D9AE54]/15 px-3.5 text-[13px] font-bold text-[#F5D68A] transition-colors hover:bg-[#D9AE54]/25 disabled:opacity-50"
                      >
                        <Download className="h-4 w-4 text-[#D9AE54]" />
                        <span>{t('home_extract_video')}</span>
                      </button>
                    ) : null}

                    <button
                      type="submit"
                      className={`flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-5 text-[14px] font-bold shadow-md transition-opacity hover:opacity-95 ${
                        linkKind === 'MEDIA_FILE'
                          ? 'bg-gradient-to-r from-[#D9AE54] to-[#4CC4FF] text-[#000000]'
                          : 'bg-gradient-to-r from-[#8F6BFF] to-[#4CC4FF] text-white'
                      }`}
                    >
                      {linkKind === 'MEDIA_FILE' ? (
                        <>
                          <Download className="h-4 w-4" />
                          <span>{t('home_download_file')}</span>
                        </>
                      ) : (
                        <>
                          <span>{isSearchQuery ? t('address_go') : t('home_open_link')}</span>
                          <ForwardArrow className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {suggestions.length > 0 ? (
                  <div className="absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-2xl border border-[#312556] bg-[#100C20] shadow-2xl">
                    {suggestions.map((sug) => (
                      <button
                        key={sug.url}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setPasteInput(sug.url);
                          setInputFocused(false);
                          openUrlFromLibrary(sug.url);
                        }}
                        className="flex w-full items-center justify-between gap-3 border-b border-[#312556]/40 px-4 py-3 text-start last:border-none hover:bg-[#18122E]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-[#F4F2FF]">
                            {sug.title}
                          </p>
                          <p className="font-data truncate text-[11px] text-[#7F86A3]">{sug.url}</p>
                        </div>
                        <span className="shrink-0 text-[11px] font-medium text-[#4CC4FF]">
                          {sug.source}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </form>
            </div>
          </section>

          {/* Speed Dial & Workspace Shortcuts */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[16px] font-bold text-[#F4F2FF]">
                {t('speed_dial_title')}
              </h2>
              <span className="font-data text-[12px] text-[#7F86A3]">
                {tabs.length}{' '}
                {!isRtl && tabs.length === 1 ? 'Tab' : t('tabs')}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => openUrlFromLibrary(BUILTIN_SHOWCASE_PAGES[0].url)}
                className="group flex min-h-[96px] flex-col items-start justify-between rounded-2xl border border-[#312556]/80 bg-[#100C20]/78 p-4 text-start backdrop-blur-md transition-colors duration-150 hover:border-[#4CC4FF]/70"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#18122E] text-[#4CC4FF]">
                  <Film className="h-5 w-5" />
                </div>
                <div className="mt-3 w-full">
                  <p className="truncate text-[13px] font-semibold text-[#F4F2FF]">
                    {BUILTIN_SHOWCASE_PAGES[0].title}
                  </p>
                  <p className="font-data truncate text-[11px] text-[#7F86A3]">salvia.showcase</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate('browser')}
                className="flex min-h-[96px] flex-col items-start justify-between rounded-2xl border border-[#312556]/80 bg-[#100C20]/78 p-4 text-start backdrop-blur-md transition-colors duration-150 hover:border-[#8F6BFF]/70"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#18122E] text-[#8F6BFF]">
                  <Globe className="h-5 w-5" />
                </div>
                <div className="mt-3 w-full">
                  <p className="truncate text-[13px] font-semibold text-[#F4F2FF]">
                    {t('home_open_browser')}
                  </p>
                  <p className="font-data truncate text-[11px] text-[#7F86A3]">
                    {settings.searchEngine}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  createTab({ isPrivate: true });
                  navigate('browser');
                }}
                className="flex min-h-[96px] flex-col items-start justify-between rounded-2xl border border-[#312556]/80 bg-[#100C20]/78 p-4 text-start backdrop-blur-md transition-colors duration-150 hover:border-[#8F6BFF]/70"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#18122E] text-[#C3AEFF]">
                  <Lock className="h-5 w-5" />
                </div>
                <div className="mt-3 w-full">
                  <p className="truncate text-[13px] font-semibold text-[#F4F2FF]">
                    {t('new_private_tab')}
                  </p>
                  <p className="truncate text-[11px] text-[#7F86A3]">{t('private_browsing')}</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate('downloads')}
                className="flex min-h-[96px] flex-col items-start justify-between rounded-2xl border border-[#312556]/80 bg-[#100C20]/78 p-4 text-start backdrop-blur-md transition-colors duration-150 hover:border-[#D9AE54]/70"
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#18122E] text-[#D9AE54]">
                    <Download className="h-5 w-5" />
                  </div>
                  {activeDownloadsCount > 0 ? (
                    <span className="font-data text-[12px] font-bold text-[#D9AE54]">
                      {activeDownloadsCount}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 w-full">
                  <p className="truncate text-[13px] font-semibold text-[#F4F2FF]">
                    {t('downloads')}
                  </p>
                  <p className="truncate text-[11px] text-[#7F86A3]">
                    {t('download_active')}
                  </p>
                </div>
              </button>
            </div>

            {/* Bookmarks & Recent Visits compact strip */}
            <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#312556]/60 bg-[#070510]/74 p-4 backdrop-blur-sm">
                <div className="mb-2.5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => navigate('bookmarks')}
                    className="flex items-center gap-2 text-[13px] font-semibold text-[#D9AE54] hover:underline"
                  >
                    <Bookmark className="h-4 w-4" />
                    <span>{t('bookmarks')}</span>
                  </button>
                  <span className="font-data text-[11px] text-[#7F86A3]">{bookmarks.length}</span>
                </div>
                {bookmarks.length === 0 ? (
                  <p className="py-2 text-[12px] text-[#7F86A3]">{t('no_bookmarks')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {bookmarks.slice(0, 3).map((bm) => (
                      <button
                        key={bm.id}
                        type="button"
                        onClick={() => openUrlFromLibrary(bm.url)}
                        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl px-2.5 text-start hover:bg-[#18122E]"
                      >
                        <span className="truncate text-[13px] text-[#F4F2FF]">{bm.title}</span>
                        <span className="font-data shrink-0 text-[11px] text-[#7F86A3]">
                          {hostOfUrl(bm.url) || ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#312556]/60 bg-[#070510]/74 p-4 backdrop-blur-sm">
                <div className="mb-2.5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => navigate('history')}
                    className="flex items-center gap-2 text-[13px] font-semibold text-[#4CC4FF] hover:underline"
                  >
                    <History className="h-4 w-4" />
                    <span>{t('recent_history_title')}</span>
                  </button>
                  <span className="font-data text-[11px] text-[#7F86A3]">{history.length}</span>
                </div>
                {history.length === 0 ? (
                  <p className="py-2 text-[12px] text-[#7F86A3]">{t('no_history')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {history.slice(0, 3).map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => openUrlFromLibrary(h.url)}
                        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl px-2.5 text-start hover:bg-[#18122E]"
                      >
                        <span className="truncate text-[13px] text-[#F4F2FF]">{h.title}</span>
                        <span className="font-data shrink-0 text-[11px] text-[#7F86A3]">
                          {hostOfUrl(h.url) || ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Downloading now */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[16px] font-bold text-[#F4F2FF]">
                {t('home_active_title')}
              </h2>
              <button
                type="button"
                onClick={() => navigate('downloads')}
                className="flex min-h-10 items-center gap-1 text-[13px] font-semibold text-[#4CC4FF] hover:underline"
              >
                <span>{t('home_active_see_all')}</span>
                <ForwardArrow className="h-4 w-4" />
              </button>
            </div>

            {activeItems.length === 0 ? (
              <div className="rounded-2xl border border-[#312556]/50 bg-[#070510]/74 p-4 text-[13px] text-[#A6ACC4] backdrop-blur-sm">
                {t('home_active_empty')}
              </div>
            ) : (
              <div className="space-y-2.5">
                {activeItems.map((item) => (
                  <DownloadItemRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};
