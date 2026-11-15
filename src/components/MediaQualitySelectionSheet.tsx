import React, { useEffect, useState } from 'react';
import { Check, CircleDot, Download, Film, Square, X } from 'lucide-react';
import { formatDurationSeconds, formatFileSize, sanitizeFilename } from '../core/mediaResolver';
import { useApp } from '../store/AppContext';
import type { MediaFormat } from '../types/models';

export const MediaQualitySelectionSheet: React.FC = () => {
  const {
    qualitySheet,
    closeQualitySheet,
    startDownloadFromFormat,
    recording,
    startRecordingPlayback,
    stopRecordingPlayback,
    t,
  } = useApp();

  const [selectedId, setSelectedId] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');

  useEffect(() => {
    if (!qualitySheet) return;
    const allFormats = [
      ...qualitySheet.mediaInfo.formats,
      ...qualitySheet.mediaInfo.audioFormats.filter(
        (af) => !qualitySheet.mediaInfo.formats.some((vf) => vf.id === af.id)
      ),
    ];
    setSelectedId((prev) => (allFormats.some((f) => f.id === prev) ? prev : allFormats[0]?.id || ''));
    setFileName((prev) => prev || sanitizeFilename(qualitySheet.mediaInfo.title));
  }, [qualitySheet]);

  useEffect(() => {
    if (!qualitySheet) {
      setFileName('');
      setSelectedId('');
    }
  }, [qualitySheet]);

  if (!qualitySheet) return null;

  const { mediaInfo, isResolving, unsupported, canRecord } = qualitySheet;
  const videoFormats: MediaFormat[] = mediaInfo.formats;
  const audioFormats: MediaFormat[] = mediaInfo.audioFormats.filter(
    (af) => !videoFormats.some((vf) => vf.id === af.id)
  );
  const formats: MediaFormat[] = [...videoFormats, ...audioFormats];
  const selectedFormat = formats.find((f) => f.id === selectedId) || formats[0] || null;

  const unsupportedText = (() => {
    if (unsupported === 'DASH') return t('error_dash_unsupported');
    if (unsupported === 'LIVE') return t('error_live_unsupported');
    if (unsupported === 'DRM') return t('error_drm_protected');
    if (unsupported === 'BLOB_STREAM') return t('error_blob_stream_unsupported');
    return null;
  })();

  const formatLineMeta = (f: MediaFormat): string => {
    const parts: string[] = [
      f.isHls ? 'HLS' : f.isDash ? 'DASH' : null,
      f.extension.toUpperCase(),
      f.width && f.height ? `${f.width}×${f.height}` : null,
      f.bitrate ? `${Math.round(f.bitrate / 1000)} kbps` : null,
      f.size && f.size > 0 ? formatFileSize(f.size) : t('error_size_unavailable'),
    ].filter((item): item is string => Boolean(item));
    return parts.join(' · ');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4 backdrop-blur-sm"
      onClick={closeQualitySheet}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('select_quality')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-[#312556] bg-[#100C20] sm:rounded-3xl shadow-2xl"
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#312556] sm:hidden" />

        <div className="flex items-start justify-between gap-3 border-b border-[#312556]/60 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {mediaInfo.thumbnail ? (
              <img
                src={mediaInfo.thumbnail}
                alt={mediaInfo.title}
                referrerPolicy="no-referrer"
                className="h-12 w-16 shrink-0 rounded-xl bg-[#070510] object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#18122E] text-[#8F6BFF] ring-1 ring-[#312556]">
                <Film className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-display truncate text-[16px] font-bold text-[#F4F2FF]">
                {mediaInfo.title || t('media_fallback_title')}
              </h2>
              <p className="font-data mt-0.5 text-[12px] text-[#A6ACC4]">
                {[
                  mediaInfo.duration ? formatDurationSeconds(mediaInfo.duration / 1000) : null,
                  isResolving ? t('quality_checking') : t('quality_options', { count: formats.length }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeQualitySheet}
            aria-label={t('action_dismiss')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {unsupportedText ? (
            <div className="rounded-2xl border border-[#EF7BF0]/40 bg-[#EF7BF0]/10 p-4 text-[13px] text-[#F4F2FF]">
              {unsupportedText}
            </div>
          ) : null}

          {canRecord ? (
            <div className="rounded-2xl border border-[#312556] bg-[#18122E] p-4">
              <p className="text-[13px] text-[#A6ACC4]">{t('record_playback_hint')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {recording.isRecording ? (
                  <>
                    <button
                      type="button"
                      onClick={stopRecordingPlayback}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#EF7BF0] px-4 text-[13px] font-semibold text-[#000000]"
                    >
                      <Square className="h-4 w-4 fill-current" />
                      {t('action_stop_recording')}
                    </button>
                    <span className="font-data text-[13px] font-medium text-[#4CC4FF]">
                      {t('recording_in_progress')} · {formatFileSize(recording.bytes)}
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={startRecordingPlayback}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#8F6BFF] bg-[#8F6BFF]/15 px-4 text-[13px] font-semibold text-[#F4F2FF] hover:bg-[#8F6BFF]/25"
                  >
                    <CircleDot className="h-4 w-4 text-[#EF7BF0]" />
                    {t('action_record_playback')}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {!unsupportedText ? (
            <>
              <div>
                <label
                  htmlFor="salvia-quality-filename"
                  className="mb-1.5 block text-[12px] font-semibold text-[#A6ACC4]"
                >
                  {t('file_name_label')}
                </label>
                <input
                  id="salvia-quality-filename"
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="h-11 w-full rounded-xl border border-[#312556] bg-[#070510] px-3.5 text-[14px] text-[#F4F2FF] outline-none focus:border-[#8F6BFF]"
                />
              </div>

              {videoFormats.length > 0 ? (
                <div className="space-y-2">
                  {audioFormats.length > 0 ? (
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#A8E6FF]">
                      {t('quality_section_video')}
                    </p>
                  ) : null}
                  {videoFormats.map((format) => {
                    const selected = format.id === selectedFormat?.id;
                    return (
                      <button
                        key={format.id}
                        type="button"
                        onClick={() => setSelectedId(format.id)}
                        className={`flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 py-3 text-start transition-colors duration-150 ${
                          selected
                            ? 'border-[#8F6BFF] bg-[#18122E] ring-1 ring-[#4CC4FF]/40'
                            : 'border-[#312556]/70 bg-[#070510]/60 hover:border-[#8F6BFF]/50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[#F4F2FF]">{format.format}</p>
                          <p className="font-data mt-0.5 text-[12px] text-[#A6ACC4]">
                            {formatLineMeta(format)}
                          </p>
                        </div>
                        {selected ? <Check className="h-5 w-5 shrink-0 text-[#4CC4FF]" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {audioFormats.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#D9AE54]">
                    {t('quality_section_audio')}
                  </p>
                  {audioFormats.map((format) => {
                    const selected = format.id === selectedFormat?.id;
                    return (
                      <button
                        key={format.id}
                        type="button"
                        onClick={() => setSelectedId(format.id)}
                        className={`flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 py-3 text-start transition-colors duration-150 ${
                          selected
                            ? 'border-[#D9AE54] bg-[#18122E] ring-1 ring-[#D9AE54]/40'
                            : 'border-[#312556]/70 bg-[#070510]/60 hover:border-[#D9AE54]/50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[#F4F2FF]">{format.format}</p>
                          <p className="font-data mt-0.5 text-[12px] text-[#A6ACC4]">
                            {formatLineMeta(format)}
                          </p>
                        </div>
                        {selected ? <Check className="h-5 w-5 shrink-0 text-[#D9AE54]" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {!unsupportedText && selectedFormat ? (
          <div className="border-t border-[#312556]/60 p-4 sm:p-5">
            <button
              type="button"
              onClick={() => startDownloadFromFormat(selectedFormat, fileName)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#8F6BFF] to-[#4CC4FF] px-5 text-[15px] font-bold text-white shadow-lg transition-opacity hover:opacity-95"
            >
              <Download className="h-5 w-5" />
              {t('confirm_download_cta')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
