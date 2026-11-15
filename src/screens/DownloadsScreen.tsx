import React, { useState } from 'react';
import { Lock, Trash2, Unlock, X } from 'lucide-react';
import { BrowserNavRail } from '../components/BrowserNavRail';
import { DownloadItemRow } from '../components/DownloadItemRow';
import { ScreenHeader } from '../components/ScreenHeader';
import { useApp } from '../store/AppContext';

export const DownloadsScreen: React.FC = () => {
  const {
    navigate,
    downloadsInitialTab,
    downloads,
    clearDownloadsByBucket,
    isLockedFolderConfigured,
    isLockedFolderUnlocked,
    isUnlockingFolder,
    unlockLockedFolder,
    lockLockedFolder,
    t,
  } = useApp();

  const [activeTab, setActiveTab] = useState<number>(downloadsInitialTab);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  const activeItems = downloads.filter(
    (d) =>
      d.status === 'DOWNLOADING' ||
      d.status === 'PAUSED' ||
      d.status === 'PREPARING' ||
      d.status === 'RESOLVING'
  );
  const queuedItems = downloads.filter((d) => d.status === 'QUEUED' || d.status === 'RETRYING');
  const completedAll = downloads.filter((d) => d.status === 'COMPLETED');
  const lockedHiddenCount = completedAll.filter((d) => d.isLocked).length;
  const completedVisible = completedAll.filter((d) => !d.isLocked || isLockedFolderUnlocked);
  const failedItems = downloads.filter((d) => d.status === 'FAILED' || d.status === 'CANCELLED');

  const tabsList = [
    { label: t('download_active'), count: activeItems.length, items: activeItems, bucket: 'active' as const },
    { label: t('download_queue'), count: queuedItems.length, items: queuedItems, bucket: null },
    { label: t('download_completed'), count: completedVisible.length, items: completedVisible, bucket: 'completed' as const },
    { label: t('download_failed'), count: failedItems.length, items: failedItems, bucket: 'failed' as const },
  ];

  const currentBucket = tabsList[activeTab] ?? tabsList[0];

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput) return;
    await unlockLockedFolder(passwordInput);
    setPasswordInput('');
    setUnlockOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-[#000000] text-[#F4F2FF]">
      <BrowserNavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader
          title={t('downloads_title')}
          onBack={() => navigate('home')}
          actions={
            currentBucket.bucket && currentBucket.items.length > 0 ? (
              <button
                type="button"
                onClick={() => clearDownloadsByBucket(currentBucket.bucket!)}
                aria-label={t('action_clear')}
                title={t('action_clear')}
                className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-[#EF7BF0] hover:bg-[#18122E]"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">{t('action_clear')}</span>
              </button>
            ) : null
          }
        />

        {/* Tabs */}
        <div className="border-b border-[#312556]/60 bg-[#070510]">
          <div className="mx-auto grid max-w-5xl grid-cols-4 px-2 sm:px-6">
            {tabsList.map((tab, idx) => {
              const selected = idx === activeTab;
              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => setActiveTab(idx)}
                  className={`relative flex min-h-12 items-center justify-center gap-1.5 text-[13px] font-semibold transition-colors ${
                    selected ? 'text-[#4CC4FF]' : 'text-[#A6ACC4] hover:text-[#F4F2FF]'
                  }`}
                >
                  <span className="truncate">{tab.label}</span>
                  {tab.count > 0 ? (
                    <span className="font-data text-[11px] text-[#D9AE54]">({tab.count})</span>
                  ) : null}
                  {selected ? (
                    <span className="absolute right-3 bottom-0 left-3 h-0.5 rounded-full bg-gradient-to-r from-[#8F6BFF] to-[#4CC4FF]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-4 sm:p-6">
          {/* Locked Folder Bar on Completed tab */}
          {activeTab === 2 && isLockedFolderConfigured && (lockedHiddenCount > 0 || isLockedFolderUnlocked) ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D9AE54]/45 bg-[#100C20] px-4 py-3">
              <div className="flex items-center gap-3">
                {isLockedFolderUnlocked ? (
                  <Unlock className="h-5 w-5 text-[#D9AE54]" />
                ) : (
                  <Lock className="h-5 w-5 text-[#D9AE54]" />
                )}
                <div>
                  <p className="text-[14px] font-semibold text-[#F4F2FF]">
                    {t('downloads_locked_folder')}
                  </p>
                  <p className="font-data text-[12px] text-[#A6ACC4]">
                    {t('downloads_locked_count', { count: lockedHiddenCount })}
                  </p>
                </div>
              </div>
              {isLockedFolderUnlocked ? (
                <button
                  type="button"
                  onClick={lockLockedFolder}
                  className="min-h-10 rounded-xl border border-[#312556] bg-[#18122E] px-4 text-[13px] font-semibold text-[#F4F2FF] hover:border-[#D9AE54]"
                >
                  {t('action_lock_folder')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setUnlockOpen(true)}
                  className="min-h-10 rounded-xl bg-[#D9AE54] px-4 text-[13px] font-bold text-[#000000]"
                >
                  {t('action_unlock_folder')}
                </button>
              )}
            </div>
          ) : null}

          {currentBucket.items.length === 0 ? (
            <div className="rounded-3xl border border-[#312556]/60 bg-[#070510] px-6 py-14 text-center text-[14px] text-[#A6ACC4]">
              {activeTab === 0
                ? t('no_active_downloads')
                : activeTab === 1
                  ? t('no_queued_downloads')
                  : activeTab === 2
                    ? t('no_completed_downloads')
                    : t('no_failed_downloads')}
            </div>
          ) : (
            <div className="space-y-3">
              {currentBucket.items.map((item) => (
                <DownloadItemRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Unlock Password Dialog */}
      {unlockOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setUnlockOpen(false)}
        >
          <form
            onSubmit={handleUnlockSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-3xl border border-[#312556] bg-[#100C20] p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[16px] font-bold text-[#F4F2FF]">
                {t('action_unlock_folder')}
              </h2>
              <button
                type="button"
                onClick={() => setUnlockOpen(false)}
                aria-label={t('action_cancel')}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={t('locked_folder_password_label')}
              autoFocus
              className="h-11 w-full rounded-xl border border-[#312556] bg-[#070510] px-3.5 text-[14px] text-[#F4F2FF] outline-none focus:border-[#8F6BFF]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnlockOpen(false)}
                className="min-h-10 rounded-xl px-4 text-[13px] font-semibold text-[#A6ACC4] hover:text-[#F4F2FF]"
              >
                {t('action_cancel')}
              </button>
              <button
                type="submit"
                disabled={isUnlockingFolder}
                className="min-h-10 rounded-xl bg-gradient-to-r from-[#8F6BFF] to-[#5A34D9] px-4 text-[13px] font-semibold text-white"
              >
                {t('action_unlock_folder')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};
