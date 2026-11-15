import React from 'react';
import { Bookmark, Clock, Download, Globe, Home, Settings } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { AppRoute } from '../types/models';
import { OrbitalBrandMark } from './OrbitalBrandMark';

export const BrowserNavRail: React.FC = () => {
  const { route, navigate, tabs, activeDownloadsCount, t } = useApp();

  const items: Array<{
    id: AppRoute;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeTone?: 'violet' | 'cyan';
  }> = [
    {
      id: 'home',
      label: t('home'),
      icon: <Home className="h-[19px] w-[19px]" />,
    },
    {
      id: 'browser',
      label: t('browser_title'),
      icon: <Globe className="h-[19px] w-[19px]" />,
      badge: tabs.length > 1 ? tabs.length : undefined,
      badgeTone: 'cyan',
    },
    {
      id: 'downloads',
      label: t('downloads'),
      icon: <Download className="h-[19px] w-[19px]" />,
      badge: activeDownloadsCount > 0 ? activeDownloadsCount : undefined,
      badgeTone: 'violet',
    },
    {
      id: 'bookmarks',
      label: t('bookmarks'),
      icon: <Bookmark className="h-[19px] w-[19px]" />,
    },
    {
      id: 'history',
      label: t('history'),
      icon: <Clock className="h-[19px] w-[19px]" />,
    },
  ];

  return (
    <aside
      aria-label={t('app_name')}
      className="hidden md:flex w-[68px] shrink-0 flex-col items-center justify-between border-e border-[#312556]/60 bg-[#070510] py-3.5 z-30"
    >
      <div className="flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('home')}
          title={t('app_name')}
          aria-label={t('home')}
          className="flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105"
        >
          <OrbitalBrandMark size={38} />
        </button>

        <div className="h-px w-7 bg-[#312556]/70" />

        <nav className="flex flex-col items-center gap-2">
          {items.map((item) => {
            const active = route === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-11 w-11 items-center justify-center rounded-2xl transition-colors duration-150 ${
                  active
                    ? 'bg-[#18122E] text-[#F4F2FF] ring-1 ring-[#8F6BFF]/70 shadow-[0_0_16px_rgba(143,107,255,0.2)]'
                    : 'text-[#7F86A3] hover:bg-[#100C20] hover:text-[#F4F2FF]'
                }`}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2.5 start-0 w-[3px] rounded-full bg-gradient-to-b from-[#4CC4FF] to-[#8F6BFF]"
                  />
                ) : null}
                {item.icon}
                {item.badge ? (
                  <span
                    className={`font-data absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                      item.badgeTone === 'cyan'
                        ? 'bg-[#4CC4FF] text-[#000000]'
                        : 'bg-[#D9AE54] text-[#000000]'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        onClick={() => navigate('settings')}
        title={t('settings')}
        aria-label={t('settings')}
        aria-current={route === 'settings' ? 'page' : undefined}
        className={`relative flex h-11 w-11 items-center justify-center rounded-2xl transition-colors duration-150 ${
          route === 'settings'
            ? 'bg-[#18122E] text-[#F4F2FF] ring-1 ring-[#8F6BFF]/70'
            : 'text-[#7F86A3] hover:bg-[#100C20] hover:text-[#F4F2FF]'
        }`}
      >
        <Settings className="h-[19px] w-[19px]" />
      </button>
    </aside>
  );
};
