import React, { useMemo, useState } from 'react';
import { Clock, ExternalLink, Search, Trash2, X } from 'lucide-react';
import { BrowserNavRail } from '../components/BrowserNavRail';
import { ScreenHeader } from '../components/ScreenHeader';
import { useApp } from '../store/AppContext';

export const HistoryScreen: React.FC = () => {
  const { history, deleteHistoryEntry, clearHistory, openUrlFromLibrary, navigate, t } = useApp();
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
    );
  }, [history, query]);

  return (
    <div className="flex min-h-screen bg-[#000000] text-[#F4F2FF]">
      <BrowserNavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader
          title={t('history')}
          onBack={() => navigate('home')}
          actions={
            history.length > 0 ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-[#EF7BF0] hover:bg-[#18122E]"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">{t('action_clear')}</span>
              </button>
            ) : null
          }
        />

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-4 sm:p-6">
          <div className="relative">
            <Search className="pointer-events-none absolute top-3.5 start-3.5 h-4 w-4 text-[#7F86A3]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('history_search_hint')}
              aria-label={t('history_search_hint')}
              className="h-11 w-full rounded-2xl border border-[#312556] bg-[#100C20] ps-10 pe-10 text-[14px] text-[#F4F2FF] placeholder-[#7F86A3] outline-none focus:border-[#8F6BFF]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('home_clear_input')}
                className="absolute top-1.5 end-1.5 flex h-8 w-8 items-center justify-center rounded-xl text-[#7F86A3] hover:text-[#F4F2FF]"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-[#312556]/60 bg-[#070510] px-6 py-14 text-center text-[14px] text-[#A6ACC4]">
              {history.length === 0 ? t('no_history') : t('no_history_match')}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[#312556]/70 bg-[#100C20] p-3.5 transition-colors hover:border-[#8F6BFF]/60"
                >
                  <button
                    type="button"
                    onClick={() => openUrlFromLibrary(item.url)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-start"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#18122E] text-[#8F6BFF]">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[#F4F2FF]">
                        {item.title}
                      </p>
                      <p className="font-data truncate text-[12px] text-[#7F86A3]">
                        {item.url} · {new Date(item.visitedAt).toLocaleString()}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openUrlFromLibrary(item.url)}
                      aria-label={`${t('action_open')} ${item.title}`}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-[#4CC4FF] hover:bg-[#18122E]"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHistoryEntry(item.id)}
                      aria-label={`${t('action_delete')} ${item.title}`}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-[#7F86A3] hover:bg-[#18122E] hover:text-[#EF7BF0]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {confirmClear ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setConfirmClear(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-3xl border border-[#312556] bg-[#100C20] p-5"
          >
            <h2 className="font-display text-[16px] font-bold text-[#F4F2FF]">
              {t('settings_clear_history')}
            </h2>
            <p className="text-[14px] text-[#A6ACC4]">{t('clear_history_confirm')}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-10 rounded-xl px-4 text-[13px] font-semibold text-[#A6ACC4] hover:text-[#F4F2FF]"
              >
                {t('action_cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearHistory();
                  setConfirmClear(false);
                }}
                className="min-h-10 rounded-xl bg-[#EF7BF0] px-4 text-[13px] font-bold text-[#000000]"
              >
                {t('action_clear')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
