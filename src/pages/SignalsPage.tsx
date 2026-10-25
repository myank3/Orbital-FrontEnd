/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Film, Newspaper, RefreshCw } from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Types & data                                               */
/* ────────────────────────────────────────────────────────── */

type SignalKey = 'movies' | 'news';
type ActiveSignal = SignalKey | null;

interface Channel {
  id: SignalKey;
  kicker: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  url: string;
  accent: string;
  accentRgb: string;
  panelBg: string;
}

const CHANNELS: Record<SignalKey, Channel> = {
  movies: {
    id: 'movies',
    kicker: 'Channel 01',
    title: 'Chalachitra',
    shortTitle: 'Chalachitra',
    subtitle: 'Movies, ratings, and your watchlist.',
    icon: Film,
    url: 'https://chalachitra.vercel.app/',
    accent: '#F59E0B',
    accentRgb: '245,158,11',
    panelBg:
      'linear-gradient(170deg, #1A120A 0%, #0F0B06 55%, #0B0A08 100%)',
  },
  news: {
    id: 'news',
    kicker: 'Channel 02',
    title: 'The Daily',
    shortTitle: 'The Daily',
    subtitle: "Today's top stories, in one place.",
    icon: Newspaper,
    url: 'https://thedailyheadline.vercel.app/',
    accent: '#22D3EE',
    accentRgb: '34,211,238',
    panelBg:
      'linear-gradient(170deg, #0A1316 0%, #081014 55%, #0B0A08 100%)',
  },
};

/* ────────────────────────────────────────────────────────── */
/* WebView detection                                          */
/* ────────────────────────────────────────────────────────── */

function detectAndroidWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\bwv\b/i.test(ua) || /Android.*;\s*wv\)/i.test(ua);
}

function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(max-width: 767px)').matches ||
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  );
}

/* ────────────────────────────────────────────────────────── */
/* CSS — animations tiered by device capability               */
/* ────────────────────────────────────────────────────────── */

const SIGNALS_CSS = `
  @keyframes s-rotate      { to { transform: rotate(360deg); } }
  @keyframes s-rotate-rev  { to { transform: rotate(-360deg); } }
  @keyframes s-pulse {
    0%   { transform: scale(1);   opacity: 0.65; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  @keyframes s-blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.25; }
  }
  @keyframes s-drift {
    0%   { transform: translate3d(0, -100%, 0); }
    100% { transform: translate3d(0, 100vh, 0); }
  }

  /* ── Tier 1: Desktop — full animation set ── */
  .s-rotate      { animation: s-rotate 32s linear infinite; }
  .s-rotate-rev  { animation: s-rotate-rev 22s linear infinite; }
  .s-pulse       { animation: s-pulse 3s cubic-bezier(0,0,0.6,1) infinite; }
  .s-blink       { animation: s-blink 1.8s ease-in-out infinite; }
  .s-drift       { animation: s-drift 11s linear infinite; will-change: transform; }

  /* ── Tier 2: Mobile browser (Chrome/Safari on phone) ── */
  @media (max-width: 767px) {
    .s-drift      { display: none !important; }
    .s-rotate-rev { animation: none !important; display: none !important; }
    .s-pulse      { animation: none !important; opacity: 0.35 !important; }
    .s-rotate     { animation-duration: 60s; }
    .s-blink      { animation-duration: 2.5s; }
  }

  /* ── Tier 3: Android WebView — nuke ALL animations ── */
  .android-webview .s-rotate,
  .android-webview .s-rotate-rev,
  .android-webview .s-pulse,
  .android-webview .s-blink,
  .android-webview .s-drift {
    animation: none !important;
    will-change: auto !important;
  }
  .android-webview .s-pulse       { display: none !important; }
  .android-webview .s-rotate      { opacity: 0.55 !important; }
  .android-webview .s-rotate-rev  { display: none !important; }
  .android-webview .s-blink       { opacity: 0.9 !important; }
  .android-webview .s-drift       { display: none !important; }

  .android-webview .expensive-shadow {
    box-shadow: none !important;
  }

  @media (hover: none) and (pointer: coarse) {
    .tap-safe:active { opacity: 0.75 !important; }
  }

  @media (prefers-reduced-motion: reduce) {
    .s-rotate, .s-rotate-rev, .s-pulse, .s-blink, .s-drift {
      animation: none !important;
    }
  }

  /* Mobile landscape */
  @media (orientation: landscape) and (max-width: 767px) {
    .signals-grid {
      grid-template-rows: 1fr !important;
      grid-template-columns: 1fr 1fr !important;
    }
    .signal-panel-inner {
      flex-direction: column !important;
      gap: 0 !important;
      padding: 10px !important;
    }
    .signal-orbital {
      width: 76px !important;
      height: 76px !important;
      margin-bottom: 6px;
    }
    .signal-panel-text { text-align: center !important; }
    .signal-kicker-row { justify-content: center !important; }
    .signal-subtitle {
      font-size: 10.5px !important;
      line-height: 1.35 !important;
    }
  }
`;

/* ────────────────────────────────────────────────────────── */
/* Clock                                                      */
/* ────────────────────────────────────────────────────────── */

const Clock = React.memo(function Clock({ isWebView }: { isWebView: boolean }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const ms = isWebView ? 30000 : 1000;
    const id = window.setInterval(() => setTime(new Date()), ms);
    return () => window.clearInterval(id);
  }, [isWebView]);
  const hh = String(time.getUTCHours()).padStart(2, '0');
  const mm = String(time.getUTCMinutes()).padStart(2, '0');
  const ss = String(time.getUTCSeconds()).padStart(2, '0');
  return (
    <span className="tabular-nums text-[10.5px] font-semibold tracking-wider text-[#A8A29E]">
      {hh}:{mm}
      {!isWebView && <span className="opacity-50">:{ss}</span>}
      <span className="ml-1 text-[9px] opacity-60">UTC</span>
    </span>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Channel panel                                              */
/* ────────────────────────────────────────────────────────── */

interface ChannelPanelProps {
  channel: Channel;
  index: number;
  onOpen: (key: SignalKey) => void;
  onPrefetch?: (url: string) => void;
  isWebView: boolean;
}

function ChannelPanel({
  channel,
  index,
  onOpen,
  onPrefetch,
  isWebView,
}: ChannelPanelProps) {
  const Icon = channel.icon;
  const prefetch = () => onPrefetch?.(channel.url);
  const initialAnim = isWebView ? false : { opacity: 0, scale: 0.97 };

  return (
    <motion.button
      type="button"
      initial={initialAnim}
      animate={isWebView ? undefined : { opacity: 1, scale: 1 }}
      transition={
        isWebView
          ? undefined
          : {
              duration: 0.4,
              delay: index * 0.06,
              ease: [0.16, 1, 0.3, 1],
            }
      }
      whileTap={isWebView ? undefined : { scale: 0.985 }}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
      onClick={() => onOpen(channel.id)}
      className="group relative w-full h-full min-h-0 rounded-2xl md:rounded-3xl overflow-hidden touch-manipulation text-left tap-safe"
      style={{
        background: channel.panelBg,
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 55%, rgba(${channel.accentRgb},0.10) 0%, transparent 55%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] opacity-50 md:opacity-60 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse at 50% 100%, rgba(${channel.accentRgb},0.18) 0%, transparent 60%)`,
        }}
      />

      {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
        <span
          key={corner}
          aria-hidden
          className={`absolute w-3 h-3 md:w-4 md:h-4 ${
            corner === 'tl'
              ? 'top-2.5 left-2.5 md:top-4 md:left-4 border-t-2 border-l-2 rounded-tl-md'
              : corner === 'tr'
              ? 'top-2.5 right-2.5 md:top-4 md:right-4 border-t-2 border-r-2 rounded-tr-md'
              : corner === 'bl'
              ? 'bottom-2.5 left-2.5 md:bottom-4 md:left-4 border-b-2 border-l-2 rounded-bl-md'
              : 'bottom-2.5 right-2.5 md:bottom-4 md:right-4 border-b-2 border-r-2 rounded-br-md'
          }`}
          style={{ borderColor: `rgba(${channel.accentRgb},0.28)` }}
        />
      ))}

      <div className="signal-panel-inner relative z-10 flex h-full w-full items-center gap-3 p-3 md:flex-col md:justify-center md:gap-0 md:p-7">
        <div className="signal-orbital relative shrink-0 flex items-center justify-center w-[100px] h-[100px] sm:w-[120px] sm:h-[120px] md:w-[240px] md:h-[240px]">
          <div
            aria-hidden
            className="absolute inset-0 rounded-full border border-dashed s-rotate pointer-events-none"
            style={{ borderColor: `rgba(${channel.accentRgb},0.18)` }}
          >
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 md:w-2 md:h-2 rounded-full"
              style={{
                background: channel.accent,
                boxShadow: isWebView ? 'none' : `0 0 14px ${channel.accent}`,
              }}
            />
          </div>

          <div
            aria-hidden
            className="absolute inset-[20%] rounded-full border s-rotate-rev pointer-events-none"
            style={{ borderColor: `rgba(${channel.accentRgb},0.10)` }}
          />

          <div className="relative">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full s-pulse"
              style={{ border: `1px solid rgba(${channel.accentRgb},0.55)` }}
            />
            <span
              aria-hidden
              className="absolute inset-0 rounded-full s-pulse"
              style={{
                border: `1px solid rgba(${channel.accentRgb},0.35)`,
                animationDelay: '1.5s',
              }}
            />
            <div
              className="relative w-11 h-11 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-transform duration-500 group-hover:scale-110"
              style={{
                background: `linear-gradient(135deg, rgba(${channel.accentRgb},0.32) 0%, rgba(${channel.accentRgb},0.10) 100%)`,
                boxShadow: isWebView
                  ? `inset 0 1px 0 rgba(255,255,255,0.14)`
                  : `0 0 44px -8px rgba(${channel.accentRgb},0.65), inset 0 1px 0 rgba(255,255,255,0.14)`,
              }}
            >
              <Icon
                className="w-5 h-5 md:w-9 md:h-9 relative z-10"
                style={{ color: channel.accent }}
              />
            </div>
          </div>
        </div>

        <div className="signal-panel-text flex-1 min-w-0 text-left md:text-center md:flex-none md:mt-4">
          <div className="signal-kicker-row flex items-center gap-2 mb-1 md:justify-center md:mb-2">
            <span
              className="text-[8.5px] md:text-[10px] font-bold tracking-[0.28em] uppercase whitespace-nowrap"
              style={{ color: channel.accent }}
            >
              {channel.kicker}
            </span>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] shrink-0">
              <span
                className="w-1 h-1 rounded-full s-blink"
                style={{ background: '#22C55E' }}
              />
              <span className="text-[7.5px] md:text-[8.5px] font-bold tracking-[0.18em] text-[#A8A29E] uppercase">
                Live
              </span>
            </span>
          </div>

          <h2
            className="text-[22px] sm:text-[26px] md:text-[40px] font-medium text-[#EDE5D4] tracking-[-0.02em] leading-[1.02]"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            {channel.title}
          </h2>

          <p className="signal-subtitle text-[11.5px] md:text-[13px] text-[#A8A29E] leading-snug mt-1 md:mt-2 max-w-[280px] md:max-w-[260px] md:mx-auto">
            {channel.subtitle}
          </p>

          <div
            className="hidden md:inline-flex items-center gap-2 h-9 px-4 rounded-full border mt-4 transition-all duration-300 group-hover:gap-2.5"
            style={{
              borderColor: `rgba(${channel.accentRgb},0.35)`,
              background: `rgba(${channel.accentRgb},0.10)`,
              color: channel.accent,
            }}
          >
            <span className="text-[10.5px] font-bold tracking-[0.18em] uppercase">
              Tune in
            </span>
            <svg
              className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Ambient background (desktop only)                          */
/* ────────────────────────────────────────────────────────── */

function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 900px 700px at 50% 40%, rgba(217,119,6,0.05) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute -top-52 -right-52 w-[560px] h-[560px] opacity-50"
        style={{
          background:
            'radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute -bottom-52 -left-52 w-[560px] h-[560px] opacity-50"
        style={{
          background:
            'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(237,229,212,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(237,229,212,0.7) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 70% 70% at 50% 50%, black 25%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 70% at 50% 50%, black 25%, transparent 80%)',
        }}
      />
      <div
        className="absolute inset-x-0 h-px opacity-20 s-drift"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(217,119,6,0.9) 50%, transparent 100%)',
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Viewer                                                     */
/* ────────────────────────────────────────────────────────── */

interface ViewerProps {
  channel: Channel;
  isLoading: boolean;
  reloadKey: number;
  onClose: () => void;
  onReload: () => void;
  onLoaded: () => void;
  isWebView: boolean;
}

function Viewer({
  channel,
  isLoading,
  reloadKey,
  onClose,
  onReload,
  onLoaded,
  isWebView,
}: ViewerProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        backgroundColor: '#0B0A09',
        contain: isWebView ? undefined : 'layout paint style',
        isolation: isWebView ? undefined : 'isolate',
      }}
    >
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px] z-20 pointer-events-none"
        style={{
          background: `linear-gradient(90deg, transparent 0%, rgba(${channel.accentRgb},0.6) 50%, transparent 100%)`,
        }}
      />

      <iframe
        key={`${channel.id}-${reloadKey}`}
        src={channel.url}
        className="absolute inset-0 w-full h-full border-0 block"
        title={channel.title}
        onLoad={onLoaded}
        loading="eager"
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write; clipboard-read"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        style={{
          transform: isWebView ? undefined : 'translateZ(0)',
          backfaceVisibility: isWebView ? undefined : 'hidden',
          width: '100%',
          height: '100%',
        }}
      />

      <button
        type="button"
        onClick={onClose}
        className="
          absolute z-30
          inline-flex items-center justify-center gap-2
          h-12 px-4 rounded-full
          bg-[#0B0A09] text-[#F5EFE6]
          border border-white/20
          font-semibold text-[15px] tracking-tight whitespace-nowrap
          tap-safe
          transition-opacity duration-100
          touch-manipulation
          expensive-shadow
          shadow-[0_2px_8px_rgba(0,0,0,0.5)]
        "
        style={{
          top: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
          left: 'calc(0.75rem + env(safe-area-inset-left, 0px))',
          willChange: isWebView ? undefined : 'transform',
        }}
        aria-label="Back to Signals"
        title="Back to Signals"
      >
        <ArrowLeft className="w-5 h-5 shrink-0" strokeWidth={2.4} />
        <span></span>
      </button>

      {isLoading && !isWebView && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B0A09] pointer-events-none"
          >
            <div className="relative w-16 h-16 md:w-20 md:h-20 mb-5">
              <div
                className="absolute inset-0 rounded-full border-2 s-rotate"
                style={{
                  borderColor: `rgba(${channel.accentRgb},0.15)`,
                  borderTopColor: channel.accent,
                  animationDuration: '1.2s',
                }}
              />
              <div
                className="absolute inset-3 rounded-full border-2 s-rotate-rev"
                style={{
                  borderColor: 'transparent',
                  borderBottomColor: `rgba(${channel.accentRgb},0.6)`,
                  animationDuration: '1.8s',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className="w-1.5 h-1.5 rounded-full s-blink"
                  style={{ background: channel.accent }}
                />
              </div>
            </div>
            <span
              className="text-[9.5px] md:text-[10px] font-bold uppercase tracking-[0.3em] s-blink"
              style={{ color: channel.accent }}
            >
              Establishing Link
            </span>
          </motion.div>
        </AnimatePresence>
      )}

      {isLoading && isWebView && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B0A09] pointer-events-none">
          <div
            className="w-10 h-10 rounded-full border-2 border-white/15 animate-spin"
            style={{ borderTopColor: channel.accent }}
          />
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Main page                                                  */
/* ────────────────────────────────────────────────────────── */

export default function SignalsPage() {
  const navigate = useNavigate();
  const [activeSignal, setActiveSignal] = useState<ActiveSignal>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [isWebView, setIsWebView] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const webView = detectAndroidWebView();
    const mobile = detectMobile();
    setIsWebView(webView);
    setIsMobile(mobile);
    if (webView) {
      document.documentElement.classList.add('android-webview');
    }
    return () => {
      document.documentElement.classList.remove('android-webview');
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const origins = Array.from(
      new Set(
        Object.values(CHANNELS).map((c) => {
          try {
            return new URL(c.url).origin;
          } catch {
            return c.url;
          }
        }),
      ),
    );

    origins.forEach((origin) => {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });

    const prefetchAll = () => {
      Object.values(CHANNELS).forEach((ch) => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = ch.url;
        link.as = 'document';
        document.head.appendChild(link);
      });
    };

    let idleId: number | undefined;
    if (typeof (window as any).requestIdleCallback === 'function') {
      idleId = (window as any).requestIdleCallback(prefetchAll, {
        timeout: 1500,
      });
    } else {
      idleId = window.setTimeout(prefetchAll, 500);
    }

    return () => {
      if (idleId === undefined) return;
      if (typeof (window as any).cancelIdleCallback === 'function') {
        (window as any).cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, []);

  const prefetchChannel = useCallback((url: string) => {
    if (typeof document === 'undefined') return;
    const selector = `link[rel="prefetch"][href="${url}"]`;
    if (document.querySelector(selector)) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'document';
    document.head.appendChild(link);
  }, []);

  const open = (key: SignalKey) => {
    setIsLoading(true);
    setReloadKey(0);
    setActiveSignal(key);
  };
  const close = () => {
    setActiveSignal(null);
    setIsLoading(false);
  };
  const reload = () => {
    setIsLoading(true);
    setReloadKey((k) => k + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeSignal) close();
      else navigate('/app/orbit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSignal, navigate]);

  const isViewerActive = activeSignal !== null;
  const exitDuration = isWebView ? 0 : 0.15;

  return (
    <div
      className="h-[100dvh] w-full bg-[#0B0A08] overflow-hidden relative"
      style={{
        contain: isViewerActive && !isWebView ? 'layout paint style' : undefined,
      }}
    >
      <style>{SIGNALS_CSS}</style>

      {!isViewerActive && !isWebView && <AmbientBackground />}

      <AnimatePresence initial={false}>
        {!activeSignal ? (
          <motion.div
            key="landing"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: exitDuration } }}
            // 🔥 FIXED: Applied env(safe-area-inset-top) to prevent notch overlap
            className="relative z-10 h-full w-full flex flex-col px-2 pb-2 md:p-3 gap-2 md:gap-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          >
            <div className="shrink-0 h-9 flex items-center justify-between gap-2 mt-1">
              <button
                type="button"
                onClick={() => navigate('/app/orbit')}
                className="h-9 pl-2 pr-3 rounded-full flex items-center gap-1.5 bg-[#0F0D0A] border border-white/[0.08] text-[12px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:border-white/[0.14] active:bg-white/[0.04] transition-colors touch-manipulation"
                aria-label="Back to Orbit"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Orbit</span>
              </button>

              <div className="h-9 px-3 rounded-full flex items-center gap-2 bg-[#0F0D0A] border border-white/[0.08] shrink-0">
                <Clock isWebView={isWebView} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] s-blink" />
              </div>
            </div>

            <div className="signals-grid flex-1 min-h-0 grid grid-rows-2 gap-2 md:grid-rows-1 md:grid-cols-2 md:gap-3">
              <div className="min-h-0">
                <ChannelPanel
                  channel={CHANNELS.movies}
                  index={0}
                  onOpen={open}
                  onPrefetch={prefetchChannel}
                  isWebView={isWebView}
                />
              </div>
              <div className="min-h-0">
                <ChannelPanel
                  channel={CHANNELS.news}
                  index={1}
                  onOpen={open}
                  onPrefetch={prefetchChannel}
                  isWebView={isWebView}
                />
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="viewer"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: exitDuration } }}
            className="relative z-10 h-full w-full"
          >
            <Viewer
              channel={CHANNELS[activeSignal]}
              isLoading={isLoading}
              reloadKey={reloadKey}
              onClose={close}
              onReload={reload}
              onLoaded={() => setIsLoading(false)}
              isWebView={isWebView}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}