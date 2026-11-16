import React, { useEffect, useMemo, useState } from 'react';
import { AudioLines, Check, Download, Film, ListVideo, SlidersHorizontal, Sparkles, ShieldAlert, X } from 'lucide-react';
import { hostOfUrl } from '../core/adBlockRules';
import { unsupportedReasonFor, type UnsupportedMedia } from '../core/mediaOfferability';
import { formatDurationSeconds, formatFileSize } from '../core/mediaResolver';
import { useApp } from '../store/AppContext';
import type { MediaCandidate } from '../types/models';

export const MediaTraySheet: React.FC = () => {
  const {
    isMediaTrayVisible,
    closeMediaTray,
    rankedTabCandidates,
    currentMainCandidate,
    openQualitySheetForCandidate,
    startBatchDownloadFromCandidates,
    t,
  } = useApp();

  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);

  const offerableRanked = useMemo(
    () =>
      rankedTabCandidates.filter(
        ({ candidate }) =>
          unsupportedReasonFor({
            url: candidate.mediaUrl,
            mimeType: candidate.mimeType,
            extension: candidate.extension,
            isLive: candidate.isLive,
            isMediaSource: candidate.isMediaSource,
            isBlobFile: candidate.isBlobFile,
            dashIsSupported: true,
          }) === null
      ),
    [rankedTabCandidates]
  );

  // Pre-check only the smart Main Video when the sheet opens (leaving 5s ads & suggested unchecked)
  useEffect(() => {
    if (!isMediaTrayVisible) {
      setIsConfirming(false);
      return;
    }
    if (currentMainCandidate) {
      setSelectedUrls(new Set([currentMainCandidate.mediaUrl]));
    } else if (offerableRanked.length > 0 && offerableRanked[0].role !== 'AD') {
      setSelectedUrls(new Set([offerableRanked[0].candidate.mediaUrl]));
    } else {
      setSelectedUrls(new Set());
    }
  }, [isMediaTrayVisible, currentMainCandidate, offerableRanked]);

  useEffect(() => {
    if (!isMediaTrayVisible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMediaTray();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMediaTrayVisible, closeMediaTray]);

  if (!isMediaTrayVisible) return null;

  const toggleUrl = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const nonAdUrls = offerableRanked.filter((r) => r.role !== 'AD').map((r) => r.candidate.mediaUrl);
  const allNonAdSelected = nonAdUrls.length > 0 && nonAdUrls.every((u) => selectedUrls.has(u));

  const toggleSelectAll = () => {
    if (allNonAdSelected) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(nonAdUrls));
    }
  };

  const checkedCandidates = offerableRanked
    .filter(({ candidate }) => selectedUrls.has(candidate.mediaUrl))
    .map(({ candidate }) => candidate);

  const handleConfirmBatch = async () => {
    if (checkedCandidates.length === 0 || isConfirming) return;
    setIsConfirming(true);
    try {
      await startBatchDownloadFromCandidates(checkedCandidates);
    } finally {
      setIsConfirming(false);
    }
  };

  const refusalMessage = (reason: UnsupportedMedia | null): string | null => {
    if (reason === 'DASH') return t('error_dash_unsupported');
    if (reason === 'LIVE') return t('error_live_unsupported');
    if (reason === 'BLOB_STREAM') return t('error_blob_stream_unsupported');
    return null;
  };

  const renderIcon = (candidate: MediaCandidate) => {
    const ext = (candidate.extension || '').toLowerCase();
    const mime = (candidate.mimeType || '').toLowerCase();
    if (ext === 'm3u8' || ext === 'mpd' || mime.includes('mpegurl')) {
      return <ListVideo className="h-5 w-5 text-[#4CC4FF]" />;
    }
    if (mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav'].includes(ext)) {
      return <AudioLines className="h-5 w-5 text-[#D9AE54]" />;
    }
    return <Film className="h-5 w-5 text-[#8F6BFF]" />;
  };

  const mediaKindLabel = (candidate: MediaCandidate) => {
    const ext = (candidate.extension || '').toLowerCase();
    const mime = (candidate.mimeType || '').toLowerCase();
    if (ext === 'm3u8' || ext === 'mpd' || mime.includes('mpegurl')) return t('media_kind_playlist');
    if (mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav'].includes(ext)) {
      return t('media_kind_audio');
    }
    return t('media_kind_video');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4 backdrop-blur-sm"
      onClick={closeMediaTray}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('media_tray_title')}
        onClick={(e) => e.stopPropagation()}
        className="animate-salvia-sheet-in flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-[#312556] bg-[#100C20] sm:rounded-3xl shadow-2xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#312556] sm:hidden" />

        <div className="flex items-center justify-between gap-2 border-b border-[#312556]/60 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-[17px] font-bold text-[#F4F2FF]">{t('media_tray_title')}</h2>
            <p className="font-data mt-0.5 text-[12px] text-[#A6ACC4]">
              {t('media_tray_count', { count: rankedTabCandidates.length })}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {nonAdUrls.length > 1 ? (
              <button
                type="button"
                onClick={toggleSelectAll}
                className="min-h-10 rounded-xl border border-[#312556] bg-[#18122E] px-3 text-[12px] font-semibold text-[#A8E6FF] hover:border-[#4CC4FF]/60"
              >
                {t('media_select_all')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={closeMediaTray}
              aria-label={t('action_dismiss')}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] transition-colors hover:bg-[#18122E] hover:text-[#F4F2FF]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto p-4 sm:p-5">
          {rankedTabCandidates.length === 0 ? (
            <p className="py-12 text-center text-[14px] text-[#A6ACC4]">{t('media_tray_empty')}</p>
          ) : (
            rankedTabCandidates.map(({ candidate, role }) => {
              const reason = unsupportedReasonFor({
                url: candidate.mediaUrl,
                mimeType: candidate.mimeType,
                extension: candidate.extension,
                isLive: candidate.isLive,
                isMediaSource: candidate.isMediaSource,
                isBlobFile: candidate.isBlobFile,
                dashIsSupported: true,
              });
              const note = refusalMessage(reason);
              const isOfferable = reason === null;
              const isChecked = isOfferable && selectedUrls.has(candidate.mediaUrl);
              const host = hostOfUrl(candidate.mediaUrl) || '';
              const metaParts = [
                mediaKindLabel(candidate),
                candidate.extension ? candidate.extension.toUpperCase() : null,
                candidate.duration ? formatDurationSeconds(candidate.duration / 1000) : null,
                candidate.estimatedSize ? formatFileSize(candidate.estimatedSize) : null,
                host || null,
              ].filter(Boolean);

              const roleBadge =
                role === 'MAIN' ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-[#4CC4FF]/15 px-2 py-0.5 text-[11px] font-bold text-[#A8E6FF] ring-1 ring-[#4CC4FF]/40">
                    <Sparkles className="h-3 w-3 text-[#4CC4FF]" />
                    {t('media_role_main')}
                  </span>
                ) : role === 'AD' ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-[#EF7BF0]/10 px-2 py-0.5 text-[11px] font-semibold text-[#EF7BF0]/85 ring-1 ring-[#EF7BF0]/30">
                    <ShieldAlert className="h-3 w-3" />
                    {t('media_role_ad')}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-lg bg-[#18122E] px-2 py-0.5 text-[11px] font-medium text-[#A6ACC4]">
                    {t('media_role_suggested')}
                  </span>
                );

              const displayTitle =
                candidate.title ||
                candidate.mediaUrl.split('/').pop()?.split('?')[0] ||
                t('media_fallback_title');

              return (
                <div
                  key={candidate.id}
                  className={`flex items-center justify-between gap-2.5 rounded-2xl border p-3 transition-colors ${
                    isChecked
                      ? role === 'MAIN'
                        ? 'border-[#4CC4FF]/70 bg-[#18122E] ring-1 ring-[#8F6BFF]/40'
                        : 'border-[#8F6BFF]/70 bg-[#18122E]'
                      : role === 'AD'
                        ? 'border-[#312556]/40 bg-[#070510]/45 opacity-70'
                        : 'border-[#312556]/70 bg-[#070510]/65'
                  }`}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isChecked}
                    aria-label={displayTitle}
                    disabled={!isOfferable}
                    onClick={() => isOfferable && toggleUrl(candidate.mediaUrl)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-start disabled:cursor-not-allowed"
                  >
                    <span
                      className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                        isChecked
                          ? 'border-[#4CC4FF] bg-gradient-to-br from-[#8F6BFF] to-[#4CC4FF] text-white shadow-sm'
                          : 'border-[#312556] bg-[#070510] text-transparent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    </span>

                    <div className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#18122E] ring-1 ring-[#312556]/70 sm:flex">
                      {renderIcon(candidate)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">{roleBadge}</div>
                      <p className="truncate text-[14px] font-semibold text-[#F4F2FF]">{displayTitle}</p>
                      <p className="font-data mt-0.5 truncate text-[12px] text-[#A6ACC4]">
                        {metaParts.join(' · ')}
                      </p>
                      {note ? <p className="mt-1 text-[12px] text-[#EF7BF0]">{note}</p> : null}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => openQualitySheetForCandidate(candidate)}
                    title={t('media_open_quality')}
                    aria-label={`${t('media_open_quality')}: ${displayTitle}`}
                    className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[#312556] bg-[#18122E] px-3 text-[12px] font-semibold text-[#C3AEFF] transition-colors hover:border-[#8F6BFF] hover:text-[#F4F2FF]"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('media_open_quality')}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {offerableRanked.length > 0 ? (
          <div className="border-t border-[#312556]/60 bg-[#0A0716] p-4 sm:px-5">
            <button
              type="button"
              disabled={checkedCandidates.length === 0 || isConfirming}
              onClick={handleConfirmBatch}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#8F6BFF] to-[#4CC4FF] px-5 text-[15px] font-bold text-white shadow-lg transition-opacity hover:opacity-95 disabled:opacity-40"
            >
              <Download className="h-5 w-5" />
              <span>{t('confirm_download_selected', { count: checkedCandidates.length })}</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
