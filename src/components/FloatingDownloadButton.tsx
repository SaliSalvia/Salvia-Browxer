import React, { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { LOGO_ASSET_PATH } from './OrbitalBrandMark';
import { snapFloatingPosition } from '../core/floatingSnap';
import { useApp } from '../store/AppContext';

interface FloatingDownloadButtonProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const FloatingDownloadButton: React.FC<FloatingDownloadButtonProps> = ({ containerRef }) => {
  const {
    settings,
    updateSettings,
    currentTabCandidates,
    currentMainCandidate,
    downloadMainMedia,
    openMediaTray,
    t,
  } = useApp();

  const mediaCount = currentTabCandidates.length;
  const visible = settings.isFloatingButtonAlwaysVisible || mediaCount > 0;
  const size = Math.min(76, Math.max(46, settings.floatingButtonSize || 56));
  const isHighlighted = currentMainCandidate !== null || mediaCount > 0;

  const [pos, setPos] = useState<{ x: number; y: number } | null>(() =>
    settings.floatingButtonX > 0 || settings.floatingButtonY > 0
      ? { x: settings.floatingButtonX, y: settings.floatingButtonY }
      : null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [wakeCycle, setWakeCycle] = useState(0);
  const prevHighlightedRef = useRef(isHighlighted);

  useEffect(() => {
    if (!prevHighlightedRef.current && isHighlighted) {
      setWakeCycle((c) => c + 1);
    }
    prevHighlightedRef.current = isHighlighted;
  }, [isHighlighted]);

  useEffect(() => {
    if (settings.floatingButtonX === 0 && settings.floatingButtonY === 0) {
      setPos(null);
    }
  }, [settings.floatingButtonX, settings.floatingButtonY]);

  useEffect(() => {
    const onResize = () => {
      const parent = containerRef.current;
      if (!parent || !pos) return;
      const rect = parent.getBoundingClientRect();
      const snapped = snapFloatingPosition(pos.x, pos.y, rect.width, rect.height, size, 14);
      setPos(snapped);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [containerRef, pos, size]);

  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    latestX: number;
    latestY: number;
    moved: boolean;
    longPressTimer: number | null;
    longPressed: boolean;
  } | null>(null);

  if (!visible) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const parent = containerRef.current;
    if (!parent) return;

    const btnRect = e.currentTarget.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const currentX = pos ? pos.x : btnRect.left - parentRect.left;
    const currentY = pos ? pos.y : btnRect.top - parentRect.top;

    e.currentTarget.setPointerCapture(e.pointerId);

    const timer = window.setTimeout(() => {
      if (dragState.current && !dragState.current.moved) {
        dragState.current.longPressed = true;
        openMediaTray();
      }
    }, 500);

    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: currentX,
      originY: currentY,
      latestX: currentX,
      latestY: currentY,
      moved: false,
      longPressTimer: timer,
      longPressed: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    const parent = containerRef.current;
    if (!state || state.pointerId !== e.pointerId || !parent) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) > 8) {
      state.moved = true;
      setIsDragging(true);
      if (state.longPressTimer) {
        window.clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
    }

    if (state.moved) {
      const parentRect = parent.getBoundingClientRect();
      const pad = 14;
      const maxX = Math.max(pad, parentRect.width - size - pad);
      const maxY = Math.max(pad, parentRect.height - size - pad);
      const nextX = Math.min(maxX, Math.max(pad, state.originX + dx));
      const nextY = Math.min(maxY, Math.max(pad, state.originY + dy));
      state.latestX = nextX;
      state.latestY = nextY;
      setPos({ x: nextX, y: nextY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    const parent = containerRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (state.longPressTimer) window.clearTimeout(state.longPressTimer);
    setIsDragging(false);

    if (state.moved && parent) {
      const parentRect = parent.getBoundingClientRect();
      const snapped = snapFloatingPosition(
        state.latestX,
        state.latestY,
        parentRect.width,
        parentRect.height,
        size,
        14
      );
      setPos(snapped);
      updateSettings({ floatingButtonX: snapped.x, floatingButtonY: snapped.y });
    } else if (!state.longPressed) {
      downloadMainMedia();
    }
    dragState.current = null;
  };

  const positionStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, width: size, height: size }
    : { right: 16, bottom: 18, width: size, height: size };

  return (
    <button
      key={isHighlighted ? `lit-${wakeCycle}` : 'idle'}
      type="button"
      data-testid="floating-download-btn"
      data-active={isHighlighted ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        openMediaTray();
      }}
      title={
        isHighlighted
          ? t('media_floating_ready', { count: mediaCount })
          : t('media_floating_idle')
      }
      aria-label={
        isHighlighted
          ? t('media_floating_ready', { count: mediaCount })
          : t('media_floating_idle')
      }
      style={positionStyle}
      className={`group absolute z-30 flex touch-none select-none items-center justify-center rounded-full ${
        isDragging
          ? 'scale-105 transition-none'
          : 'transition-[left,top,transform,box-shadow,opacity,filter] duration-300 ease-out hover:scale-105'
      } ${
        isHighlighted
          ? 'animate-salvia-wake bg-[#070510] text-white shadow-[0_10px_30px_rgba(143,107,255,0.52)] ring-2 ring-[#4CC4FF]/80'
          : 'border border-[#2A214A] bg-[#0A0814]/85 text-[#7F86A3] opacity-50 grayscale-[75%] shadow-lg backdrop-blur-md hover:opacity-80'
      }`}
    >
      {/* Orbital luminous arc when page has downloadable media */}
      {isHighlighted ? (
        <span
          aria-hidden="true"
          className="animate-salvia-comet pointer-events-none -inset-1.5 absolute rounded-full border-2 border-transparent border-t-[#4CC4FF] border-e-[#D9AE54] border-s-[#8F6BFF]/70"
        />
      ) : null}

      {/* Circular App Logo core */}
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-[#070510]">
        {!logoFailed ? (
          <img
            src={LOGO_ASSET_PATH}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setLogoFailed(true)}
            className={`h-full w-full select-none object-cover transition-all duration-300 ${
              isHighlighted ? 'opacity-90 brightness-110' : 'opacity-40'
            }`}
          />
        ) : null}

        {/* Centered translucent cosmic download emblem overlay */}
        <span
          className={`absolute inset-0 flex items-center justify-center rounded-full transition-colors duration-300 ${
            isHighlighted
              ? 'bg-gradient-to-br from-[#5A34D9]/55 via-[#070510]/40 to-[#4CC4FF]/45'
              : 'bg-[#070510]/60'
          }`}
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-all duration-300 ${
              isHighlighted
                ? 'bg-[#070510]/80 text-[#A8E6FF] ring-1 ring-[#4CC4FF]/70 shadow-[0_0_12px_rgba(76,196,255,0.45)]'
                : 'bg-[#100C20]/80 text-[#7F86A3] ring-1 ring-[#312556]/60'
            }`}
          >
            <Download className="h-4 w-4" />
          </span>
        </span>
      </span>

      {/* Detected Media Counter Badge */}
      {isHighlighted ? (
        <span className="font-data absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-[#D9AE54] to-[#F2CD72] px-1.5 text-[11px] font-bold text-[#000000] shadow-md ring-2 ring-[#070510]">
          {mediaCount}
        </span>
      ) : null}
    </button>
  );
};
