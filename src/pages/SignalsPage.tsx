/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Film,
  Newspaper,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

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
    subtitle: 'Movies, ratings, and your personal watchlist.',
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
/* CSS — GPU-only animations                                  */
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

  .s-rotate      { animation: s-rotate 32s linear infinite; }
  .s-rotate-rev  { animation: s-rotate-rev 22s linear infinite; }
  .s-pulse       { animation: s-pulse 3s cubic-bezier(0,0,0.6,1) infinite; }
  .s-blink       { animation: s-blink 1.8s ease-in-out infinite; }
  .s-drift       { animation: s-drift 11s linear infinite; will-change: transform; }

  @media (max-width: 767px) {
    .s-rotate     { animation-duration: 64s; }
    .s-rotate-rev { animation-duration: 48s; }
    .s-drift      { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .s-rotate, .s-rotate-rev, .s-pulse, .s-blink, .s-drift {
      animation: none !important;
    }
  }
`;

/* ────────────────────────────────────────────────────────── */
/* Isolated clock                                             */
/* ────────────────────────────────────────────────────────── */

const Clock = React.memo(function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const hh = String(time.getUTCHours()).padStart(2, '0');
  const mm = String(time.getUTCMinutes()).padStart(2, '0');
  const ss = String(time.getUTCSeconds()).padStart(2, '0');
  return (
    <span className="tabular-nums text-[10.5px] font-semibold tracking-wider text-[#A8A29E]">
      {hh}:{mm}
      <span className="opacity-50">:{ss}</span>
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
}

function ChannelPanel({ channel, index, onOpen }: ChannelPanelProps) {
  const Icon = channel.icon;
  const fromX = index === 0 ? -32 : 32;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: fromX }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.06 * index,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileTap={{ scale: 0.995 }}
      onClick={() => onOpen(channel.id)}
      className="group relative snap-start shrink-0 h-full min-h-0 rounded-3xl overflow-hidden flex flex-col text-left touch-manipulation md:h-full"
      style={{
        background: channel.panelBg,
        border: '1px solid rgba(255,255,255,0.06)',
        willChange: 'transform',
      }}
    >
      {/* Ambient center glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 55%, rgba(${channel.accentRgb},0.10) 0%, transparent 55%)`,
        }}
      />
      {/* Bottom accent bloom — brightens on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] opacity-60 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse at 50% 100%, rgba(${channel.accentRgb},0.18) 0%, transparent 60%)`,
        }}
      />

      {/* Corner brackets */}
      {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
        <span
          key={corner}
          aria-hidden
          className={`absolute w-4 h-4 transition-colors duration-300 ${
            corner === 'tl'
              ? 'top-4 left-4 border-t-2 border-l-2 rounded-tl-md'
              : corner === 'tr'
              ? 'top-4 right-4 border-t-2 border-r-2 rounded-tr-md'
              : corner === 'bl'
              ? 'bottom-4 left-4 border-b-2 border-l-2 rounded-bl-md'
              : 'bottom-4 right-4 border-b-2 border-r-2 rounded-br-md'
          }`}
          style={{
            borderColor: `rgba(${channel.accentRgb},0.28)`,
          }}
        />
      ))}

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full p-5 pt-14 sm:pt-16 md:p-7 md:pt-14">
        {/* Top kicker + live pill */}
        <div className="flex items-center justify-between gap-3">
          <span
            className="text-[9px] md:text-[10px] font-bold tracking-[0.3em] uppercase"
            style={{ color: channel.accent }}
          >
            {channel.kicker}
          </span>
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
            <span
              className="w-1 h-1 rounded-full s-blink"
              style={{ background: '#22C55E' }}
            />
            <span className="text-[8.5px] font-bold tracking-[0.2em] text-[#A8A29E] uppercase">
              Live
            </span>
          </span>
        </div>

        {/* Center — orbital icon */}
        <div className="flex-1 flex items-center justify-center relative min-h-0 py-3">
          {/* Outer ring with satellite */}
          <div
            aria-hidden
            className="absolute rounded-full border border-dashed s-rotate pointer-events-none
                       w-[180px] h-[180px] sm:w-[220px] sm:h-[220px] md:w-[260px] md:h-[260px]"
            style={{ borderColor: `rgba(${channel.accentRgb},0.18)` }}
          >
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
              style={{
                background: channel.accent,
                boxShadow: `0 0 14px ${channel.accent}`,
              }}
            />
            <span
              className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1.5 h-1.5 rounded-full opacity-60"
              style={{ background: channel.accent }}
            />
          </div>

          {/* Inner ring with satellite */}
          <div
            aria-hidden
            className="absolute rounded-full border s-rotate-rev pointer-events-none
                       w-[120px] h-[120px] sm:w-[150px] sm:h-[150px] md:w-[180px] md:h-[180px]"
            style={{ borderColor: `rgba(${channel.accentRgb},0.09)` }}
          >
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full opacity-70"
              style={{ background: channel.accent }}
            />
          </div>

          {/* Icon with pulse rings */}
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
              className="relative w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-transform duration-500 group-hover:scale-110"
              style={{
                background: `linear-gradient(135deg, rgba(${channel.accentRgb},0.32) 0%, rgba(${channel.accentRgb},0.10) 100%)`,
                boxShadow: `0 0 44px -8px rgba(${channel.accentRgb},0.65), inset 0 1px 0 rgba(255,255,255,0.14)`,
              }}
            >
              <Icon
                className="w-7 h-7 md:w-9 md:h-9 relative z-10"
                style={{ color: channel.accent }}
              />
            </div>
          </div>
        </div>

        {/* Bottom — title, subtitle, CTA */}
        <div className="text-center">
          <h2
            className="text-[26px] sm:text-[32px] md:text-[40px] font-medium text-[#EDE5D4] tracking-[-0.02em] leading-[1.02]"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            {channel.title}
          </h2>
          <p className="text-[11.5px] md:text-[13px] text-[#A8A29E] leading-relaxed mt-2 mb-4 max-w-[260px] mx-auto">
            {channel.subtitle}
          </p>
          <div
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full border transition-all duration-300 group-hover:gap-2.5"
            style={{
              borderColor: `rgba(${channel.accentRgb},0.35)`,
              background: `rgba(${channel.accentRgb},0.10)`,
              color: channel.accent,
            }}
          >
            <span className="text-[10.5px] font-bold tracking-[0.18em] uppercase">
              Tune in
            </span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </motion.button>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Ambient background                                         */
/* ────────────────────────────────────────────────────────── */

function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Warm center bloom */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 900px 700px at 50% 40%, rgba(217,119,6,0.05) 0%, transparent 70%)',
        }}
      />
      {/* Cool corner accents */}
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
      {/* Masked grid */}
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
      {/* Drifting scan line */}
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
/* Viewer — full-bleed iframe + floating chrome pill          */
/* ────────────────────────────────────────────────────────── */

interface ViewerProps {
  channel: Channel;
  isLoading: boolean;
  reloadKey: number;
  onClose: () => void;
  onReload: () => void;
  onOpenNewTab: () => void;
  onLoaded: () => void;
}

function Viewer({
  channel,
  isLoading,
  reloadKey,
  onClose,
  onReload,
  onOpenNewTab,
  onLoaded,
}: ViewerProps) {
  const Icon = channel.icon;
  return (
    <div className="relative h-full w-full bg-[#0B0A08]">
      {/* iframe fills everything */}
      <iframe
        key={`${channel.id}-${reloadKey}`}
        src={channel.url}
        className="absolute inset-0 w-full h-full border-0"
        title={channel.title}
        onLoad={onLoaded}
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
      />

      {/* Floating chrome pill */}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5 h-10 px-1.5 rounded-full bg-[#0F0D0A] border border-white/[0.10] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.9)] max-w-[calc(100%-24px)]"
        role="toolbar"
        aria-label="Signal controls"
      >
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors touch-manipulation"
          aria-label="Back to Signals"
          title="Back to Signals"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <span
          aria-hidden
          className="w-px h-5 bg-white/[0.08] shrink-0"
        />

        <div className="flex items-center gap-1.5 px-2 shrink-0 max-w-[180px]">
          <Icon
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: channel.accent }}
          />
          <span className="text-[12px] font-semibold text-[#EDE5D4] tracking-tight truncate">
            {channel.shortTitle}
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full s-blink shrink-0"
            style={{ background: '#22C55E' }}
          />
        </div>

        <span
          aria-hidden
          className="w-px h-5 bg-white/[0.08] shrink-0"
        />

        <button
          type="button"
          onClick={onReload}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors touch-manipulation"
          aria-label="Reload"
          title="Reload"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onOpenNewTab}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors touch-manipulation"
          aria-label="Open in new tab"
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Loader overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0B0A08] pointer-events-none"
          >
            {/* Orbital spinner */}
            <div className="relative w-20 h-20 mb-6">
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
              className="text-[10px] font-bold uppercase tracking-[0.3em] s-blink"
              style={{ color: channel.accent }}
            >
              Establishing Link
            </span>
          </motion.div>
        )}
      </AnimatePresence>
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
  const openInNewTab = () => {
    if (!activeSignal) return;
    window.open(CHANNELS[activeSignal].url, '_blank', 'noopener,noreferrer');
  };

  // Escape → close viewer, or leave the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeSignal) close();
      else navigate('/app/orbit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSignal, navigate]);

  return (
    <div className="h-full w-full bg-[#0B0A08] overflow-hidden relative">
      <style>{SIGNALS_CSS}</style>

      <AmbientBackground />

      <AnimatePresence mode="wait" initial={false}>
        {!activeSignal ? (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative z-10 h-full w-full"
          >
            {/* Floating HUD */}
            <div className="absolute top-3 left-3 z-20">
              <button
                type="button"
                onClick={() => navigate('/app/orbit')}
                className="h-9 pl-2 pr-3 rounded-full flex items-center gap-1.5 bg-[#0F0D0A]/95 border border-white/[0.08] text-[12px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:border-white/[0.14] transition-colors touch-manipulation"
                aria-label="Back to Orbit"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Orbit</span>
              </button>
            </div>

            <div className="absolute top-3 right-3 z-20">
              <div className="h-9 px-3 rounded-full flex items-center gap-2 bg-[#0F0D0A]/95 border border-white/[0.08]">
                <Clock />
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] s-blink" />
              </div>
            </div>

            {/* Split panels */}
            <div
              className="h-full w-full p-3 pt-14 md:pt-3 flex flex-col gap-3 overflow-y-auto snap-y snap-mandatory
                         md:grid md:grid-cols-2 md:gap-3 md:overflow-hidden md:snap-none"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              <ChannelPanel
                channel={CHANNELS.movies}
                index={0}
                onOpen={open}
              />
              <ChannelPanel
                channel={CHANNELS.news}
                index={1}
                onOpen={open}
              />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative z-10 h-full w-full"
          >
            <Viewer
              channel={CHANNELS[activeSignal]}
              isLoading={isLoading}
              reloadKey={reloadKey}
              onClose={close}
              onReload={reload}
              onOpenNewTab={openInNewTab}
              onLoaded={() => setIsLoading(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}