import React from 'react';
import {
  Download,
  Lock,
  Pause,
  Play,
  RotateCw,
  Share2,
  Trash2,
  Unlock,
  WifiOff,
  X,
} from 'lucide-react';
import { WIFI_HOLD_MARKER } from '../core/constants';
import { formatDurationSeconds, formatFileSize, formatTransferRate } from '../core/mediaResolver';
import { useApp } from '../store/AppContext';
import type { DownloadItemRecord } from '../types/models';

interface DownloadItemRowProps {
  item: DownloadItemRecord;
}

export const DownloadItemRow: React.FC<DownloadItemRowProps> = ({ item }) => {
  const {
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    deleteDownload,
    exportDownloadToDevice,
    playDownloadInApp,
    shareDownload,
    setDownloadLocked,
    t,
  } = useApp();

  const progressPct =
    item.totalBytes && item.totalBytes > 0
      ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
      : item.status === 'COMPLETED'
        ? 100
        : 0;

  const isWifiHeld = item.status === 'PAUSED' && item.error === WIFI_HOLD_MARKER;
  const isActive =
    item.status === 'DOWNLOADING' || item.status === 'PREPARING' || item.status === 'RESOLVING';
  const labelTitle = item.mediaTitle || item.filename;

  const statusText = (() => {
    if (isWifiHeld) return t('download_waiting_for_wifi');
    if (item.status === 'FAILED' && item.error) return item.error;
    if (item.status === 'COMPLETED') {
      return [item.isHls ? 'HLS' : null, item.totalBytes ? formatFileSize(item.totalBytes) : t('download_completed')]
        .filter(Boolean)
        .join(' · ');
    }
    const parts: string[] = [];
    if (item.isHls) parts.push('HLS');
    if (item.totalBytes && item.totalBytes > 0) {
      parts.push(`${formatFileSize(item.downloadedBytes)} / ${formatFileSize(item.totalBytes)}`);
    } else if (item.downloadedBytes > 0) {
      parts.push(formatFileSize(item.downloadedBytes));
    }
    if (isActive && item.bytesPerSecond > 0) {
      parts.push(t('download_speed', { speed: formatTransferRate(item.bytesPerSecond) }));
    }
    if (isActive && item.etaSeconds != null && item.etaSeconds > 0) {
      parts.push(t('download_eta_left', { eta: formatDurationSeconds(item.etaSeconds) }));
    }
    return parts.join(' · ') || item.status;
  })();

  return (
    <div className="rounded-2xl border border-[#312556]/70 bg-[#100C20] p-4 transition-colors duration-150 hover:border-[#8F6BFF]/60">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-[#F4F2FF]">{labelTitle}</h3>
          <p className="truncate text-[12px] text-[#7F86A3]">{item.filename}</p>
          <p
            className={`font-data mt-1 flex items-center gap-1.5 text-[12px] ${
              item.status === 'FAILED'
                ? 'text-[#EF7BF0]'
                : isWifiHeld
                  ? 'text-[#D9AE54]'
                  : 'text-[#A6ACC4]'
            }`}
          >
            {isWifiHeld ? <WifiOff className="h-3.5 w-3.5 shrink-0" /> : null}
            <span>{statusText}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {isActive ? (
            <>
              <button
                type="button"
                onClick={() => pauseDownload(item.id)}
                title={t('download_pause')}
                aria-label={`${t('download_pause')} ${labelTitle}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18122E] text-[#F4F2FF] hover:bg-[#312556]"
              >
                <Pause className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => cancelDownload(item.id)}
                title={t('download_cancel')}
                aria-label={`${t('download_cancel')} ${labelTitle}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18122E] text-[#EF7BF0] hover:bg-[#312556]"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : null}

          {item.status === 'PAUSED' ? (
            <>
              <button
                type="button"
                onClick={() => resumeDownload(item.id)}
                title={t('download_resume')}
                aria-label={`${t('download_resume')} ${labelTitle}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#8F6BFF] text-white hover:bg-[#5A34D9]"
              >
                <Play className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => cancelDownload(item.id)}
                title={t('download_cancel')}
                aria-label={`${t('download_cancel')} ${labelTitle}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18122E] text-[#EF7BF0] hover:bg-[#312556]"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : null}

          {item.status === 'FAILED' || item.status === 'CANCELLED' ? (
            <button
              type="button"
              onClick={() => retryDownload(item.id)}
              title={t('download_retry')}
              aria-label={`${t('download_retry')} ${labelTitle}`}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#8F6BFF] text-white hover:bg-[#5A34D9]"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          ) : null}

          {item.status === 'COMPLETED' ? (
            <>
              <button
                type="button"
                onClick={() => playDownloadInApp(item.id)}
                title={t('download_open')}
                aria-label={`${t('download_open')} ${labelTitle}`}
                className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-xl bg-gradient-to-r from-[#8F6BFF] to-[#5A34D9] px-3.5 text-[13px] font-semibold text-white hover:opacity-95"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>{t('download_open')}</span>
              </button>
              <button
                type="button"
                onClick={() => exportDownloadToDevice(item.id)}
                title={t('download_export')}
                aria-label={`${t('download_export')} ${labelTitle}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18122E] text-[#4CC4FF] hover:bg-[#312556]"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setDownloadLocked(item.id, !item.isLocked)}
                title={item.isLocked ? t('action_unlock_download') : t('action_lock_download')}
                aria-label={`${item.isLocked ? t('action_unlock_download') : t('action_lock_download')} ${labelTitle}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18122E] text-[#D9AE54] hover:bg-[#312556]"
              >
                {item.isLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => shareDownload(item.id)}
                title={t('download_share')}
                aria-label={`${t('download_share')} ${labelTitle}`}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18122E] text-[#A6ACC4] hover:bg-[#312556] hover:text-[#F4F2FF]"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => deleteDownload(item.id)}
            title={t('download_delete')}
            aria-label={`${t('download_delete')} ${labelTitle}`}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#18122E] text-[#7F86A3] hover:bg-[#312556] hover:text-[#EF7BF0]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {item.status !== 'COMPLETED' && item.status !== 'FAILED' && item.status !== 'CANCELLED' ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#18122E]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#8F6BFF] via-[#4CC4FF] to-[#D9AE54] transition-all duration-200"
            style={{ width: `${Math.max(item.totalBytes ? 4 : 18, progressPct)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};
