import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  ArrowRight,
  ListMusic,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { OrbitalBrandMark } from '../components/OrbitalBrandMark';
import { getCompletedBlobUrl } from '../core/downloadEngine';
import { formatDurationSeconds } from '../core/mediaResolver';
import { useApp } from '../store/AppContext';
import type { DownloadItemRecord, PlaybackOrder } from '../types/models';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ORDER_SEQUENCE: PlaybackOrder[] = ['SEQUENTIAL', 'LOOP_ALL', 'REVERSE', 'SHUFFLE'];

export const MediaPlayerScreen: React.FC = () => {
  const {
    navigate,
    isRtl,
    t,
    playerTarget,
    downloads,
    isLockedFolderUnlocked,
    deleteDownload,
    playDownloadInApp,
  } = useApp();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [order, setOrder] = useState<PlaybackOrder>('SEQUENTIAL');
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const playlist: DownloadItemRecord[] = useMemo(
    () =>
      downloads.filter(
        (d) => d.status === 'COMPLETED' && (!d.isLocked || isLockedFolderUnlocked)
      ),
    [downloads, isLockedFolderUnlocked]
  );

  const activeUrl = playerTarget?.url || '';
  const activeTitle = playerTarget?.title || t('media_fallback_title');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeUrl) return;

    setLoadError(null);
    setCurrentTime(0);
    setDuration(0);

    let hls: Hls | null = null;
    const isHlsSource = activeUrl.toLowerCase().includes('.m3u8');

    if (isHlsSource && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(activeUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (data.fatal) {
          setLoadError(t('player_playback_failed'));
        }
      });
    } else {
      video.src = activeUrl;
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [activeUrl, t]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const stepTrack = (direction: 1 | -1) => {
    if (playlist.length === 0) return;
    const idx = playlist.findIndex((item) => item.id === playerTarget?.downloadId);
    if (order === 'SHUFFLE') {
      const randIdx = Math.floor(Math.random() * playlist.length);
      playDownloadInApp(playlist[randIdx].id);
      return;
    }
    const delta = order === 'REVERSE' ? -direction : direction;
    const nextIdx = idx === -1 ? 0 : (idx + delta + playlist.length) % playlist.length;
    playDownloadInApp(playlist[nextIdx].id);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    if (playlist.length === 0) return;
    const idx = playlist.findIndex((item) => item.id === playerTarget?.downloadId);
    if (order === 'SEQUENTIAL' && idx !== -1 && idx === playlist.length - 1) return;
    stepTrack(1);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => setLoadError(t('player_playback_failed')));
    } else {
      v.pause();
    }
  };

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v || !('pictureInPictureEnabled' in document)) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      // Ignore if PiP unsupported in current environment
    }
  };

  const cycleOrder = () => {
    const nextIdx = (ORDER_SEQUENCE.indexOf(order) + 1) % ORDER_SEQUENCE.length;
    setOrder(ORDER_SEQUENCE[nextIdx]);
  };

  const orderLabel = (() => {
    if (order === 'LOOP_ALL') return t('player_order_loop');
    if (order === 'REVERSE') return t('player_order_reverse');
    if (order === 'SHUFFLE') return t('player_order_shuffle');
    return t('player_order_sequential');
  })();

  return (
    <div ref={containerRef} className="flex min-h-screen flex-col bg-[#000000] text-[#F4F2FF]">
      <header className="flex h-14 items-center justify-between border-b border-[#312556]/60 bg-[#070510] px-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('downloads', { downloadsTab: 2 })}
            aria-label={t('go_back')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#F4F2FF] hover:bg-[#18122E]"
          >
            {isRtl ? <ArrowRight className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
          </button>
          <OrbitalBrandMark size={28} />
          <h1 className="font-display truncate text-[15px] font-bold text-[#F4F2FF]">
            {activeTitle}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowPlaylist((prev) => !prev)}
            title={t('player_queue_toggle')}
            aria-label={t('player_queue_toggle')}
            className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
              showPlaylist ? 'bg-[#8F6BFF] text-white' : 'text-[#A6ACC4] hover:bg-[#18122E]'
            }`}
          >
            <ListMusic className="h-5 w-5" />
          </button>
          {'pictureInPictureEnabled' in document ? (
            <button
              type="button"
              onClick={togglePip}
              title={t('player_pip')}
              aria-label={t('player_pip')}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#4CC4FF]"
            >
              <PictureInPicture2 className="h-5 w-5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? t('player_exit_fullscreen') : t('player_fullscreen')}
            aria-label={isFullscreen ? t('player_exit_fullscreen') : t('player_fullscreen')}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
          >
            {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex flex-1 flex-col justify-between bg-[#000000]">
          <div className="relative flex flex-1 items-center justify-center p-2 sm:p-4">
            {!activeUrl || loadError ? (
              <div className="max-w-sm rounded-3xl border border-[#312556] bg-[#100C20] p-6 text-center">
                <p className="text-[15px] font-semibold text-[#F4F2FF]">
                  {loadError || t('player_file_missing')}
                </p>
                <div className="mt-4 flex justify-center gap-3">
                  {playerTarget?.downloadId ? (
                    <button
                      type="button"
                      onClick={() => {
                        deleteDownload(playerTarget.downloadId!);
                        navigate('downloads', { downloadsTab: 2 });
                      }}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#EF7BF0]/20 px-4 text-[13px] font-semibold text-[#EF7BF0]"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('player_delete_download')}
                    </button>
                  ) : null}
                  {activeUrl ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLoadError(null);
                        videoRef.current?.load();
                      }}
                      className="min-h-10 rounded-xl bg-[#8F6BFF] px-4 text-[13px] font-semibold text-white"
                    >
                      {t('player_retry')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <video
                ref={videoRef}
                playsInline
                onClick={togglePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                onEnded={handleEnded}
                onError={() => {
                  const hasLive =
                    playerTarget?.downloadId && getCompletedBlobUrl(playerTarget.downloadId);
                  setLoadError(hasLive ? t('player_playback_failed') : t('player_file_missing'));
                }}
                className="max-h-[68vh] w-full rounded-2xl bg-[#070510] object-contain"
              />
            )}
          </div>

          <div className="space-y-3 border-t border-[#312556]/60 bg-[#070510] p-4 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="font-data w-12 text-[12px] text-[#A6ACC4]">
                {formatDurationSeconds(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.5}
                value={Math.min(currentTime, duration || 100)}
                aria-label={t('player_speed')}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (videoRef.current) videoRef.current.currentTime = val;
                  setCurrentTime(val);
                }}
                className="h-1.5 flex-1 cursor-pointer accent-[#8F6BFF]"
              />
              <span className="font-data w-12 text-end text-[12px] text-[#A6ACC4]">
                {formatDurationSeconds(duration)}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => stepTrack(-1)}
                  aria-label={t('player_previous')}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
                >
                  <SkipBack className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => seekBy(-10)}
                  aria-label="-10s"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? t('player_pause') : t('player_play')}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-[#8F6BFF] to-[#4CC4FF] text-white shadow-lg"
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="h-5 w-5 fill-current" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => seekBy(10)}
                  aria-label="+10s"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
                >
                  <RotateCw className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => stepTrack(1)}
                  aria-label={t('player_next')}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
                >
                  <SkipForward className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsMuted((prev) => !prev)}
                  aria-label={isMuted ? t('player_unmute') : t('player_mute')}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[#A6ACC4] hover:bg-[#18122E] hover:text-[#F4F2FF]"
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={cycleOrder}
                  title={t('player_order')}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#312556] bg-[#100C20] px-3 text-[12px] font-semibold text-[#A8E6FF] hover:border-[#8F6BFF]"
                >
                  <Shuffle className="h-3.5 w-3.5 text-[#4CC4FF]" />
                  <span>{orderLabel}</span>
                </button>

                <div className="flex items-center gap-1 rounded-xl border border-[#312556] bg-[#100C20] p-1">
                  {SPEED_OPTIONS.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setSpeed(rate)}
                      className={`font-data min-h-8 rounded-lg px-2 text-[12px] font-semibold transition-colors ${
                        speed === rate
                          ? 'bg-[#8F6BFF] text-white'
                          : 'text-[#A6ACC4] hover:text-[#F4F2FF]'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {showPlaylist ? (
          <aside className="w-full border-t border-[#312556]/60 bg-[#070510] p-4 lg:w-80 lg:border-t-0 lg:border-s">
            <h2 className="font-display mb-3 text-[14px] font-bold text-[#F4F2FF]">
              {t('downloads_title')} ({playlist.length})
            </h2>
            <div className="space-y-2">
              {playlist.map((item) => {
                const active = item.id === playerTarget?.downloadId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => playDownloadInApp(item.id)}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-start ${
                      active
                        ? 'border-[#8F6BFF] bg-[#18122E]'
                        : 'border-[#312556]/50 bg-[#100C20] hover:border-[#8F6BFF]/50'
                    }`}
                  >
                    <span className="truncate text-[13px] font-medium text-[#F4F2FF]">
                      {item.mediaTitle || item.filename}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
};
