/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { apiService } from '../services/api';
import { presenceStore } from '../services/presenceStore';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import type { FriendDto } from '../types/api';
import { Search, X, Users } from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Deterministic hashing                                      */
/* ────────────────────────────────────────────────────────── */

function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function stableRandom(seed: string, salt: string): number {
  const h = hashStr(seed + '|' + salt);
  return (h % 100000) / 100000;
}

/* ────────────────────────────────────────────────────────── */
/* Environment / device capabilities                          */
/* ────────────────────────────────────────────────────────── */

/**
 * Touch-first / low-power detection. Used to:
 *  - pause animations when the tab is backgrounded (Android kills frames)
 *  - cut the starfield density on low-end phones
 *  - avoid continuous `will-change` promotion on rotating layers
 */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(mq.matches);
    update();
    // Safari <14 uses addListener
    if (mq.addEventListener) mq.addEventListener('change', update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else mq.removeListener(update);
    };
  }, []);
  return coarse;
}

function useLowPowerDevice(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
    const mem = nav.deviceMemory ?? 8;
    const cores = nav.hardwareConcurrency ?? 8;
    // Heuristic: <=4GB RAM or <=4 cores → treat as low power.
    setLow(mem <= 4 || cores <= 4);
  }, []);
  return low;
}

/* ────────────────────────────────────────────────────────── */
/* Tunables                                                   */
/* ────────────────────────────────────────────────────────── */

const ONLINE_RADIUS = '26vmin';
const OFFLINE_RADIUS = '39vmin';
const ONLINE_SPIN_SEC = 120;
const OFFLINE_SPIN_SEC = 240;
const MAX_ORBIT = 30;
const ONLINE_SLOT_RATIO = 2 / 3;
/** Minimum angular gap between two avatars on the same ring, in degrees. */
const MIN_ANGLE_GAP_DEG = 26;

const STAR_COUNT_DESKTOP = 70;
const STAR_COUNT_MOBILE = 40;

/* ────────────────────────────────────────────────────────── */
/* Starfield                                                  */
/* ────────────────────────────────────────────────────────── */

interface Star {
  top: number;
  left: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

function buildStars(count: number): Star[] {
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    const seed = `star-${i}`;
    out.push({
      top: stableRandom(seed, 'top') * 100,
      left: stableRandom(seed, 'left') * 100,
      size: 1 + stableRandom(seed, 'size') * 2,
      delay: stableRandom(seed, 'delay') * 6,
      duration: 3 + stableRandom(seed, 'dur') * 4,
      opacity: 0.15 + stableRandom(seed, 'op') * 0.55,
    });
  }
  return out;
}

interface StarfieldProps {
  reduced: boolean;
  count: number;
  /** When false, the CSS animation is disabled so we stop burning GPU. */
  animate: boolean;
}

const Starfield = React.memo(function Starfield({ reduced, count, animate }: StarfieldProps) {
  const stars = useMemo(() => buildStars(count), [count]);
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animation:
              reduced || !animate
                ? undefined
                : `starTwinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Layout                                                     */
/* ────────────────────────────────────────────────────────── */

interface OrbitNode {
  friend: FriendDto;
  angle: number;
  jitter: number;
}

/**
 * Deterministically lay out friends around a ring with a guaranteed
 * minimum angular gap, so no two avatars can collapse into each other.
 */
function layoutTier(friends: FriendDto[], minGapDeg: number): OrbitNode[] {
  const n = friends.length;
  if (n === 0) return [];

  const sorted = [...friends].sort(
    (a, b) => hashStr(a.userId + '|slot') - hashStr(b.userId + '|slot'),
  );

  const slotSize = 360 / n;
  const maxJitter = Math.max(0, (slotSize - minGapDeg) / 2);

  return sorted.map((friend, i) => {
    const baseAngle = i * slotSize + slotSize / 2;
    const angleJitter = (stableRandom(friend.userId, 'angle') - 0.5) * 2 * maxJitter;
    return {
      friend,
      angle: (baseAngle + angleJitter + 360) % 360,
      jitter: (stableRandom(friend.userId, 'rjit') - 0.5) * 5,
    };
  });
}

/* ────────────────────────────────────────────────────────── */
/* Tier                                                       */
/* ────────────────────────────────────────────────────────── */

interface TierProps {
  nodes: OrbitNode[];
  radius: string;
  spinSeconds: number;
  reverse: boolean;
  paused: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onLeave: () => void;
  onClick: (id: string) => void;
  online: boolean;
  reduced: boolean;
  /** Stop all animation entirely (tab hidden / low-power idle). */
  active: boolean;
  /** Skip the constant glow pulse on online avatars on low-power devices. */
  glowPulse: boolean;
}

const Tier = React.memo(function Tier({
  nodes,
  radius,
  spinSeconds,
  reverse,
  paused,
  hoveredId,
  onHover,
  onLeave,
  onClick,
  online,
  reduced,
  active,
  glowPulse,
}: TierProps) {
  if (nodes.length === 0) return null;

  const spinning = !reduced && active;
  const outerAnimation = spinning
    ? `constellationSpin ${spinSeconds}s linear infinite${reverse ? ' reverse' : ''}`
    : undefined;
  const innerAnimation = spinning
    ? `constellationSpin ${spinSeconds}s linear infinite${reverse ? '' : ' reverse'}`
    : undefined;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        animation: outerAnimation,
        animationPlayState: paused ? 'paused' : 'running',
        // Only promote while actually spinning — on Android, leaving
        // will-change on too many layers eats GPU memory and causes jank.
        willChange: spinning && !paused ? 'transform' : undefined,
        backfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
      }}
    >
      {nodes.map(({ friend: f, angle, jitter }, i) => {
        const finalRadius = `calc(${radius} + ${jitter}vmin)`;
        const isHovered = hoveredId === f.userId;
        const isDimmed = hoveredId !== null && !isHovered;

        return (
          <div
            key={f.userId}
            className="absolute"
            style={{ left: '50%', top: '50%', width: 0, height: 0 }}
          >
            <div
              className="pointer-events-auto"
              style={{
                transform: `rotate(${angle}deg) translateX(${finalRadius}) rotate(${-angle}deg)`,
                transformOrigin: '0 0',
                backfaceVisibility: 'hidden',
              }}
            >
              <div
                className="flex flex-col items-center"
                style={{ transform: 'translate(-50%, -50%)' }}
              >
                <div
                  style={{
                    animation: innerAnimation,
                    animationPlayState: paused ? 'paused' : 'running',
                    backfaceVisibility: 'hidden',
                  }}
                >
                  <motion.div
                    initial={reduced ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: isDimmed ? 0.35 : 1 }}
                    transition={{
                      delay: reduced ? 0 : 0.05 + i * 0.025,
                      type: 'spring',
                      stiffness: 280,
                      damping: 22,
                    }}
                  >
                    <motion.button
                      type="button"
                      onClick={() => onClick(f.userId)}
                      onMouseEnter={() => onHover(f.userId)}
                      onMouseLeave={onLeave}
                      onFocus={() => onHover(f.userId)}
                      onBlur={onLeave}
                      // Use pointer events for touch: treat tap as hover
                      // briefly so the name reveals without a real hover.
                      onPointerDown={() => onHover(f.userId)}
                      className="relative flex flex-col items-center focus:outline-none group rounded-full touch-manipulation select-none"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                      aria-label={`Open chat with ${f.displayName}`}
                      animate={{ scale: isHovered ? 1.18 : 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                    >
                      {online && (
                        <span
                          aria-hidden
                          className="absolute rounded-full pointer-events-none"
                          style={{
                            inset: '-8px',
                            background:
                              'radial-gradient(circle, rgba(74,222,128,0.28) 0%, rgba(74,222,128,0) 70%)',
                            filter: 'blur(6px)',
                            ...(glowPulse && active && !reduced
                              ? {
                                  animation: `onlineGlow ${2.6 + i * 0.13}s ease-in-out infinite`,
                                }
                              : {}),
                          }}
                        />
                      )}

                      <AnimatePresence>
                        {isHovered && (
                          <motion.span
                            aria-hidden
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.6 }}
                            transition={{ duration: 0.2 }}
                            className="absolute rounded-full pointer-events-none"
                            style={{
                              inset: '-14px',
                              background:
                                'radial-gradient(circle, rgba(217,119,6,0.55) 0%, rgba(217,119,6,0) 70%)',
                              filter: 'blur(10px)',
                            }}
                          />
                        )}
                      </AnimatePresence>

                      <AnimatePresence>
                        {isHovered && (
                          <motion.span
                            aria-hidden
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.7 }}
                            className="absolute rounded-full border border-[#D97706]/60 pointer-events-none"
                            style={{ inset: '-6px' }}
                          />
                        )}
                      </AnimatePresence>

                      <div className="relative rounded-full ring-0 focus-visible:ring-2 focus-visible:ring-[#D97706]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0A08] transition-shadow">
                        <Avatar
                          name={f.displayName}
                          src={f.avatarUrl}
                          size="md"
                          isOnline={online}
                        />
                      </div>

                      <AnimatePresence>
                        {isHovered && (
                          <motion.span
                            initial={{ opacity: 0, y: -2 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -2 }}
                            transition={{ duration: 0.15 }}
                            className="mt-1.5 text-[10.5px] whitespace-nowrap font-medium text-[#EDE5D4] pointer-events-none"
                          >
                            {f.displayName.split(' ')[0]}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Main                                                       */
/* ────────────────────────────────────────────────────────── */

interface ConstellationViewProps {
  friends?: FriendDto[];
}

export default function ConstellationView({ friends: friendsProp }: ConstellationViewProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reduced = useReducedMotion() ?? false;

  const pageVisible = usePageVisible();
  const coarse = useIsCoarsePointer();
  const lowPower = useLowPowerDevice();
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);

  const [internalFriends, setInternalFriends] = useState<FriendDto[]>([]);
  const [loading, setLoading] = useState(!friendsProp);
  const [presenceTick, setPresenceTick] = useState(0);
  const [query, setQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // ── friend loading ────────────────────────────────────────
  useEffect(() => {
    if (friendsProp) {
      setLoading(false);
      return;
    }
    let active = true;
    apiService
      .getFriends()
      .then((list) => {
        if (active) setInternalFriends(list);
      })
      .catch((err) => console.error('[Constellation] getFriends failed:', err))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [friendsProp]);

  // ── presence subscription ─────────────────────────────────
  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((n) => n + 1));
    return () => {
      unsub();
    };
  }, []);

  // ── idle: stop spin on mobile after 15s of no interaction
  useEffect(() => {
    if (!coarse) return; // only bother on touch devices
    const reset = () => {
      setIdle(false);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 15_000);
    };
    reset();
    window.addEventListener('touchstart', reset, { passive: true });
    window.addEventListener('pointerdown', reset, { passive: true });
    return () => {
      window.removeEventListener('touchstart', reset);
      window.removeEventListener('pointerdown', reset);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [coarse]);

  // Clear transient tap-hover after a moment so touch labels hide again.
  useEffect(() => {
    if (!hoveredId || !coarse) return;
    const t = window.setTimeout(() => setHoveredId(null), 2200);
    return () => window.clearTimeout(t);
  }, [hoveredId, coarse]);

  const friends = friendsProp ?? internalFriends;

  const onlineIds = useMemo(
    () => new Set(friends.filter((f) => presenceStore.isOnline(f.userId)).map((f) => f.userId)),
    [friends, presenceTick],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return friends;
    const q = query.trim().toLowerCase();
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        (f.handle ?? '').toLowerCase().includes(q),
    );
  }, [friends, query]);

  const layout = useMemo(() => {
    const online = filtered.filter((f) => onlineIds.has(f.userId));
    const offline = filtered.filter((f) => !onlineIds.has(f.userId));

    const onlineSlots = Math.min(online.length, Math.ceil(MAX_ORBIT * ONLINE_SLOT_RATIO));
    const offlineSlots = Math.min(offline.length, Math.max(0, MAX_ORBIT - onlineSlots));

    const visibleOnline = layoutTier(online.slice(0, onlineSlots), MIN_ANGLE_GAP_DEG);
    const visibleOffline = layoutTier(offline.slice(0, offlineSlots), MIN_ANGLE_GAP_DEG);

    return {
      visibleOnline,
      visibleOffline,
      hiddenCount: online.length + offline.length - onlineSlots - offlineSlots,
      onlineTotal: online.length,
    };
  }, [filtered, onlineIds]);

  const { visibleOnline, visibleOffline, hiddenCount, onlineTotal } = layout;

  const paused = hoveredId !== null;
  const inOrbit = visibleOnline.length + visibleOffline.length;

  // Animation gates — these are what make it usable on Android.
  const animationsEnabled = pageVisible;
  const spinEnabled = !reduced && animationsEnabled && !(coarse && idle);
  const starfieldAnimate = animationsEnabled && !reduced;
  const starCount = lowPower || coarse ? STAR_COUNT_MOBILE : STAR_COUNT_DESKTOP;
  const onlineSpin = spinEnabled ? ONLINE_SPIN_SEC : 0;
  const offlineSpin = spinEnabled ? OFFLINE_SPIN_SEC : 0;

  const handleHover = useMemo(() => (id: string | null) => setHoveredId(id), []);
  const handleLeave = useMemo(() => () => setHoveredId(null), []);
  const handleClick = useMemo(
    () => (id: string) => navigate(`/app/dm/${id}`),
    [navigate],
  );

  // Detect when the page is actually visible to gate expensive motion.
  return (
    <div className="relative w-full h-full bg-[#0B0A08] text-[#EDE5D4] overflow-hidden isolate">
      <style>{`
        @keyframes constellationSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes starTwinkle {
          0%, 100% { opacity: 0.1; transform: scale(1); }
          50%      { opacity: 0.9; transform: scale(1.4); }
        }
        @keyframes ringPulse {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.7; }
        }
        @keyframes corePulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50%      { transform: scale(1.15); opacity: 0.85; }
        }
        @keyframes onlineGlow {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1; }
        }
      `}</style>

      <Starfield
        reduced={reduced}
        count={starCount}
        animate={starfieldAnimate}
      />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute top-[env(safe-area-inset-top,0px)] left-4 md:top-5 md:left-5 z-20 pointer-events-none pt-4 md:pt-0"
      >
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#0F0D0A]/60 backdrop-blur-xl border border-white/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7)] pointer-events-auto">
          <div>
            <h2
              className="text-[16px] sm:text-[17px] font-medium tracking-tight text-[#EDE5D4]"
              style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
            >
              Your Orbit
            </h2>
            <p className="text-[11px] text-[#6B6259] tabular-nums flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  onlineTotal > 0
                    ? 'bg-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.8)]'
                    : 'bg-[#6B6259]'
                }`}
              />
              <span className="text-[#4ADE80] font-medium">{onlineTotal}</span>
              <span>online ·</span>
              <span>{friends.length} total</span>
            </p>
          </div>
        </div>
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute top-[env(safe-area-inset-top,0px)] right-4 md:top-5 md:right-5 z-20 pt-4 md:pt-0"
      >
        <motion.div
          layout
          animate={{ width: searchFocused || query ? 240 : 160 }}
          transition={
            reduced
              ? { duration: 0 }
              : { type: 'spring', stiffness: 340, damping: 30 }
          }
          className="relative"
        >
          <div className="absolute inset-0 rounded-2xl bg-[#0F0D0A]/60 backdrop-blur-xl border border-white/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7)] pointer-events-none" />
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6259] pointer-events-none z-10" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Find someone"
            aria-label="Find a friend"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="relative z-10 h-10 w-full pl-9 pr-8 rounded-2xl bg-transparent text-[16px] md:text-[12.5px] text-[#EDE5D4] placeholder:text-[#6B6259] focus:outline-none"
          />
          <AnimatePresence>
            {query && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#6B6259] hover:text-[#EDE5D4] active:text-[#EDE5D4] transition-colors z-10 touch-manipulation"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* Stage */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        role="region"
        aria-label="Friends orbit"
      >
        {loading ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[12.5px] text-[#6B6259] flex items-center gap-2"
            role="status"
          >
            <motion.span
              animate={reduced || !animationsEnabled ? undefined : { rotate: 360 }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
              className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[#D97706]/30 border-t-[#D97706]"
            />
            Charting your orbit…
          </motion.div>
        ) : friends.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-3 text-center px-6"
          >
            <motion.div
              animate={
                reduced || !animationsEnabled ? undefined : { scale: [1, 1.06, 1] }
              }
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center"
            >
              <Users className="w-6 h-6 text-[#6B6259]" />
            </motion.div>
            <p className="text-[14px] text-[#EDE5D4] font-medium">
              No one in your orbit yet
            </p>
            <p className="text-[12.5px] text-[#6B6259] max-w-[280px]">
              Add friends and they'll appear here, orbiting around you.
            </p>
          </motion.div>
        ) : inOrbit === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[12.5px] text-[#6B6259]"
          >
            No matches for "{query}"
          </motion.div>
        ) : (
          <div
            className="relative"
            style={{
              width: '80vmin',
              height: '80vmin',
              maxWidth: '760px',
              maxHeight: '760px',
            }}
            onMouseLeave={handleLeave}
            onTouchEnd={handleLeave}
          >
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at center, rgba(217,119,6,0.14) 0%, rgba(217,119,6,0.04) 32%, rgba(217,119,6,0) 62%)',
              }}
            />

            <div aria-hidden className="absolute inset-0 pointer-events-none">
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[#4ADE80]/15"
                style={{
                  width: `calc(${ONLINE_RADIUS} * 2)`,
                  height: `calc(${ONLINE_RADIUS} * 2)`,
                  animation:
                    reduced || !animationsEnabled
                      ? undefined
                      : 'ringPulse 6s ease-in-out infinite',
                }}
              />
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/[0.06]"
                style={{
                  width: `calc(${OFFLINE_RADIUS} * 2)`,
                  height: `calc(${OFFLINE_RADIUS} * 2)`,
                  animation:
                    reduced || !animationsEnabled
                      ? undefined
                      : 'ringPulse 9s ease-in-out infinite',
                }}
              />
            </div>

            <Tier
              nodes={visibleOffline}
              radius={OFFLINE_RADIUS}
              spinSeconds={offlineSpin}
              reverse
              paused={paused}
              hoveredId={hoveredId}
              onHover={handleHover}
              onLeave={handleLeave}
              onClick={handleClick}
              online={false}
              reduced={reduced}
              active={spinEnabled}
              glowPulse={!lowPower}
            />

            <Tier
              nodes={visibleOnline}
              radius={ONLINE_RADIUS}
              spinSeconds={onlineSpin}
              reverse={false}
              paused={paused}
              hoveredId={hoveredId}
              onHover={handleHover}
              onLeave={handleLeave}
              onClick={handleClick}
              online
              reduced={reduced}
              active={spinEnabled}
              glowPulse={!lowPower}
            />

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
              <div className="relative">
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(217,119,6,0.55) 0%, rgba(217,119,6,0) 70%)',
                    transform: 'scale(3.2)',
                    filter: 'blur(14px)',
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'corePulse 5s ease-in-out infinite',
                  }}
                />
                <span
                  aria-hidden
                  className="absolute rounded-full border border-[#D97706]/30"
                  style={{
                    inset: '-18px',
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'ringPulse 3.5s ease-in-out infinite',
                  }}
                />
                <span
                  aria-hidden
                  className="absolute rounded-full border border-[#D97706]/20"
                  style={{
                    inset: '-30px',
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'ringPulse 5s ease-in-out infinite 0.5s',
                  }}
                />

                <motion.div
                  animate={
                    reduced || !animationsEnabled
                      ? undefined
                      : { scale: [1, 1.05, 1] }
                  }
                  transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="relative"
                >
                  <Avatar
                    name={user?.displayName ?? 'You'}
                    src={user?.avatarUrl}
                    size="xl"
                    isOnline
                  />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {hiddenCount > 0 && !query && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => navigate('/app/friends')}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-full bg-[#1A1816]/90 backdrop-blur border border-white/[0.08] hover:border-[#D97706]/40 text-[11.5px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] touch-manipulation"
                >
                  +{hiddenCount} more in your list
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Status pill */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none pb-[env(safe-area-inset-bottom,0px)] bottom-4"
      >
        <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#0F0D0A]/60 backdrop-blur-xl border border-white/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7)] pointer-events-auto">
          <motion.span
            key={paused ? 'paused' : 'live'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-2 text-[11.5px] text-[#6B6259]"
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                paused
                  ? 'bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.7)]'
                  : 'bg-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.7)]'
              }`}
            />
            {paused ? 'Paused' : 'Live'}
          </motion.span>

          {inOrbit > 0 && (
            <>
              <span className="w-px h-3 bg-white/[0.08]" />
              <motion.span
                key={inOrbit}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-[11.5px] text-[#6B6259] tabular-nums"
              >
                {inOrbit} in orbit
              </motion.span>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}