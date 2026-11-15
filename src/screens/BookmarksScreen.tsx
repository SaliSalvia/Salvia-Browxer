import React, { useMemo, useState } from 'react';
import { Bookmark, ExternalLink, Search, Trash2, X } from 'lucide-react';
import { BrowserNavRail } from '../components/BrowserNavRail';
import { ScreenHeader } from '../components/ScreenHeader';
import { useApp } from '../store/AppContext';

export const BookmarksScreen: React.FC = () => {
  const { bookmarks, deleteBookmark, openUrlFromLibrary, navigate, t } = useApp();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter(
      (b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    );
  }, [bookmarks, query]);

  return (
    <div className="flex min-h-screen bg-[#000000] text-[#F4F2FF]">
      <BrowserNavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader title={t('bookmarks')} onBack={() => navigate('home')} />

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-4 sm:p-6">
          <div className="relative">
            <Search className="pointer-events-none absolute top-3.5 start-3.5 h-4 w-4 text-[#7F86A3]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('bookmarks_search_hint')}
              aria-label={t('bookmarks_search_hint')}
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
              {bookmarks.length === 0 ? t('no_bookmarks') : t('no_bookmarks_match')}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
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
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#18122E] text-[#D9AE54]">
                      <Bookmark className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[#F4F2FF]">
                        {item.title}
                      </p>
                      <p className="font-data truncate text-[12px] text-[#7F86A3]">{item.url}</p>
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
                      onClick={() => deleteBookmark(item.id)}
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
    </div>
  );
};
