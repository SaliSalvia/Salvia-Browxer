import React from 'react';
import { Copy, Lock, Plus, X } from 'lucide-react';
import { hostOfUrl } from '../core/adBlockRules';
import { useApp } from '../store/AppContext';
import type { Tab } from '../types/models';

export const TabSwitcher: React.FC = () => {
  const {
    isTabSwitcherVisible,
    closeTabSwitcher,
    tabs,
    currentTabId,
    hibernatedTabIds,
    createTab,
    switchTab,
    closeTab,
    duplicateTab,
    t,
  } = useApp();

  if (!isTabSwitcherVisible) return null;

  const normalTabs = tabs.filter((tab) => !tab.isPrivate);
  const privateTabs = tabs.filter((tab) => tab.isPrivate);

  const renderTabCard = (tab: Tab) => {
    const isCurrent = tab.id === currentTabId;
    const isSleeping = hibernatedTabIds.has(tab.id);
    const host = hostOfUrl(tab.url) || '';
    const monogram = (tab.title || host || 'S').trim().charAt(0).toUpperCase();

    return (
      <div
        key={tab.id}
        className={`group relative flex flex-col justify-between rounded-2xl border p-3.5 transition-colors duration-150 ${
          isCurrent
            ? 'border-[#8F6BFF] bg-[#18122E] ring-1 ring-[#4CC4FF]/35'
            : tab.isPrivate
              ? 'border-[#312556] bg-[#070510] hover:border-[#8F6BFF]/60'
              : 'border-[#312556]/70 bg-[#100C20] hover:border-[#8F6BFF]/60'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => switchTab(tab.id)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold ${
                tab.isPrivate
                  ? 'bg-[#8F6BFF]/25 text-[#C3AEFF]'
                  : 'bg-[#0B2C44] text-[#4CC4FF]'
              }`}
            >
              {tab.isPrivate ? <Lock className="h-4 w-4" /> : monogram}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[#F4F2FF]">
                {tab.title || t('new_tab')}
              </p>
              <p className="font-data truncate text-[11px] text-[#7F86A3]">
                {[host || t('browser_title'), isSleeping ? t('tab_hibernated') : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </button>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => duplicateTab(tab.id)}
              title={t('duplicate_tab')}
              aria-label={`${t('duplicate_tab')}: ${tab.title || t('new_tab')}`}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[#7F86A3] hover:bg-[#312556]/60 hover:text-[#4CC4FF]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => closeTab(tab.id)}
              title={t('close_tab')}
              aria-label={`${t('close_tab')}: ${tab.title || t('new_tab')}`}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[#7F86A3] hover:bg-[#312556]/60 hover:text-[#EF7BF0]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => switchTab(tab.id)}
          className="mt-3 w-full truncate text-start font-data text-[11px] text-[#A6ACC4] hover:text-[#F4F2FF]"
        >
          {tab.url || t('home_start_screen')}
        </button>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#000000]/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t('tabs')}
    >
      <div className="flex items-center justify-between border-b border-[#312556]/60 px-4 py-3">
        <h2 className="font-display tabular-nums text-[18px] font-bold text-[#F4F2FF]">
          {t('tabs')} · {tabs.length}
        </h2>
        <button
          type="button"
          onClick={closeTabSwitcher}
          aria-label={t('action_dismiss')}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {normalTabs.length > 0 ? (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {normalTabs.map(renderTabCard)}
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#C3AEFF]">
            <Lock className="h-4 w-4" />
            <span>{t('private_browsing')}</span>
          </div>
          <p className="rounded-2xl border border-[#312556]/60 bg-[#070510] px-4 py-3 text-[12px] text-[#A6ACC4]">
            {t('private_tabs_disclosure')}
          </p>
          {privateTabs.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {privateTabs.map(renderTabCard)}
            </div>
          ) : null}
        </section>
      </div>

      <div className="border-t border-[#312556]/60 bg-[#070510] px-4 py-3">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => createTab({ isPrivate: false })}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8F6BFF] to-[#5A34D9] px-4 text-[14px] font-semibold text-white hover:opacity-95"
          >
            <Plus className="h-4 w-4" />
            {t('new_tab')}
          </button>
          <button
            type="button"
            onClick={() => createTab({ isPrivate: true })}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#312556] bg-[#18122E] px-4 text-[14px] font-semibold text-[#F4F2FF] hover:border-[#8F6BFF]"
          >
            <Lock className="h-4 w-4 text-[#C3AEFF]" />
            {t('new_private_tab')}
          </button>
        </div>
      </div>
    </div>
  );
};
