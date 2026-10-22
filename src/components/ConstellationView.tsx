/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      hardwareConcurrency?: number;
    };
    const mem = nav.deviceMemory ?? 8;
    const cores = nav.hardwareConcurrency ?? 8;
    setLow(mem <= 4 || cores <= 4);
  }, []);
  return low;
}

/* ────────────────────────────────────────────────────────── */
/* Tunables                                                   */
/* ────────────────────────────────────────────────────────── */

const ONLINE_RADIUS = '26vmin';
const OFFLINE_RADIUS = '39vmin';

/**
 * Top N most-recently-chatted-to friends orbit around you.
 * 12 is the sweet spot: on the online ring that's 360/12 = 30° apart,
 * which stays above MIN_ANGLE_GAP_DEG and leaves room for the hover
 * glow without avatars colliding on mobile.
 */
const MAX_ORBIT = 12;

/** Minimum angle between avatars — jitter clamps below this. */
const MIN_ANGLE_GAP_DEG = 26;

const STAR_COUNT_DESKTOP = 80;
const STAR_COUNT_MOBILE = 45;
const DUST_COUNT_DESKTOP = 20;
const DUST_COUNT_MOBILE = 10;

/** Steady-state auto-spin (deg/sec). Slow, calm. Full rotation ≈ 28s. */
const IDLE_VELOCITY = 12.8;
/** Fraction of velocity that survives each second — gentle decay. */
const FRICTION_PER_SEC = 0.83;
/** Below this angular speed at release, don't fling — snap to idle. */
const MIN_FLING = 40;
/** Minimum pointer travel (px) before we treat a press as a drag, not a tap. */
const DRAG_THRESHOLD = 7;
/** If the pointer sits still this long before release, don't fling. */
const PAUSE_BEFORE_RELEASE_MS = 160;
/** Velocity low-pass filter time constant (seconds) — smooths high-polling input. */
const VELOCITY_SMOOTHING_TAU = 0.06;
/** Max dt so a stalled tab never causes a huge jump. */
const MAX_DT = 1 / 30;

/* ────────────────────────────────────────────────────────── */
/* Affinity — "who do I actually talk to?"                    */
/* ────────────────────────────────────────────────────────── */

/**
 * Conversation-history fields are optional on FriendDto — this type
 * documents what affinityScore reads, without forcing your API
 * contract. If the backend returns any of these, the orbit favours
 * the right people automatically.
 */
type FriendWithHistory = FriendDto & {
  /** ISO timestamp of the last DM. Preferred signal. */
  lastMessageAt?: string | null;
  /** Fallback: last interaction of any kind. */
  lastInteractionAt?: string | null;
  /** Fallback: total DMs exchanged. */
  messageCount?: number;
};

/** Higher = closer to the front of the ranking. Stable across renders. */
function affinityScore(f: FriendDto): number {
  const f2 = f as FriendWithHistory;

  if (f2.lastMessageAt) {
    const t = Date.parse(f2.lastMessageAt);
    if (!Number.isNaN(t)) return t;
  }
  if (f2.lastInteractionAt) {
    const t = Date.parse(f2.lastInteractionAt);
    if (!Number.isNaN(t)) return t;
  }
  if (typeof f2.messageCount === 'number') return f2.messageCount;

  // No signal — deterministic hash keeps ordering stable between renders
  // so nobody visibly shuffles into the orbit when presence ticks.
  return hashStr(f.userId);
}

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
      size: 1 + stableRandom(seed, 'size') * 2.2,
      delay: stableRandom(seed, 'delay') * 6,
      duration: 2.5 + stableRandom(seed, 'dur') * 4,
      opacity: 0.18 + stableRandom(seed, 'op') * 0.6,
    });
  }
  return out;
}

const Starfield = React.memo(function Starfield({
  reduced,
  count,
  animate,
}: {
  reduced: boolean;
  count: number;
  animate: boolean;
}) {
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
/* Floating dust                                              */
/* ────────────────────────────────────────────────────────── */

const FloatingDust = React.memo(function FloatingDust({
  count,
  enabled,
}: {
  count: number;
  enabled: boolean;
}) {
  const dust = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: stableRandom(`dust-${i}`, 'x') * 100,
        y: stableRandom(`dust-${i}`, 'y') * 100,
        size: 1.5 + stableRandom(`dust-${i}`, 's') * 3,
        dur: 10 + stableRandom(`dust-${i}`, 'd') * 14,
        delay: stableRandom(`dust-${i}`, 'dl') * 6,
        opacity: 0.15 + stableRandom(`dust-${i}`, 'o') * 0.5,
        warm: stableRandom(`dust-${i}`, 'c') > 0.5,
      })),
    [count],
  );

  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {dust.map((d, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            borderRadius: '50%',
            background: d.warm
              ? 'radial-gradient(circle, rgba(255,214,150,1) 0%, rgba(255,214,150,0) 70%)'
              : 'radial-gradient(circle, rgba(220,240,255,1) 0%, rgba(220,240,255,0) 70%)',
            opacity: d.opacity,
            animation: enabled
              ? `dustDrift ${d.dur}s ease-in-out ${d.delay}s infinite`
              : undefined,
          }}
        />
      ))}
    </div>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Shooting stars — fast, bright, two hues                    */
/* ────────────────────────────────────────────────────────── */

interface ShotConfig {
  id: number;
  startX: number;
  startY: number;
  angle: number;
  distance: number;
  duration: number;
  scale: number;
  hue: 'white' | 'warm';
}

const ShootingStars = React.memo(function ShootingStars({
  enabled,
  dense,
}: {
  enabled: boolean;
  dense: boolean;
}) {
  const [shots, setShots] = useState<ShotConfig[]>([]);
  const nextIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setShots([]);
      return;
    }

    let timer: number | null = null;
    const cleanupTimers: number[] = [];

    const spawnOne = () => {
      const id = nextIdRef.current++;
      const shot: ShotConfig = {
        id,
        startX: -8 + Math.random() * 70,
        startY: -5 + Math.random() * 45,
        angle: 15 + Math.random() * 35,
        distance: 140 + Math.random() * 70,
        duration: 0.85 + Math.random() * 0.6,
        scale: 0.85 + Math.random() * 0.7,
        hue: Math.random() > 0.45 ? 'white' : 'warm',
      };
      setShots((prev) => [...prev, shot]);
      cleanupTimers.push(
        window.setTimeout(() => {
          setShots((prev) => prev.filter((s) => s.id !== id));
        }, shot.duration * 1000 + 250),
      );
    };

    const schedule = () => {
      spawnOne();
      const delay = dense ? 1800 + Math.random() * 1600 : 3000 + Math.random() * 2200;
      timer = window.setTimeout(schedule, delay);
    };

    timer = window.setTimeout(schedule, 2800);

    return () => {
      if (timer) clearTimeout(timer);
      cleanupTimers.forEach((t) => clearTimeout(t));
      setShots([]);
    };
  }, [enabled, dense]);

  if (!enabled) return null;

  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {shots.map((s) => (
        <span
          key={s.id}
          className="shooting-star"
          data-hue={s.hue}
          style={{
            top: `${s.startY}%`,
            left: `${s.startX}%`,
            animationDuration: `${s.duration}s`,
            ['--shoot-angle' as string]: `${s.angle}deg`,
            ['--shoot-dist' as string]: `${s.distance}vmin`,
            ['--shoot-scale' as string]: String(s.scale),
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
/* Tier — counter-rotation via inherited CSS custom property  */
/* ────────────────────────────────────────────────────────── */

interface TierProps {
  nodes: OrbitNode[];
  radius: string;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onLeave: () => void;
  onClick: (id: string) => void;
  online: boolean;
  reduced: boolean;
  glowPulse: boolean;
}

const Tier = React.memo(function Tier({
  nodes,
  radius,
  hoveredId,
  onHover,
  onLeave,
  onClick,
  online,
  reduced,
  glowPulse,
}: TierProps) {
  if (nodes.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
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
              }}
            >
              <div
                className="flex flex-col items-center"
                style={{ transform: 'translate(-50%, -50%)' }}
              >
                {/*
                 * Counter-rotation reads --rot inherited from the stage
                 * (one write/frame on the stage instead of N+1 leaf writes).
                 */}
                <div
                  style={{
                    transform: 'rotate(calc(-1 * var(--rot, 0deg)))',
                    willChange: 'transform',
                    animation: reduced
                      ? undefined
                      : `avatarFade 320ms ${0.02 + i * 0.012}s ease-out both`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onClick(f.userId)}
                    onMouseEnter={() => onHover(f.userId)}
                    onMouseLeave={onLeave}
                    onFocus={() => onHover(f.userId)}
                    onBlur={onLeave}
                    className="relative flex flex-col items-center focus:outline-none rounded-full touch-manipulation select-none"
                    style={{
                      WebkitTapHighlightColor: 'transparent',
                      transform: isHovered ? 'scale(1.15)' : 'scale(1)',
                      opacity: isDimmed ? 0.35 : 1,
                      transition: 'transform 120ms ease-out, opacity 120ms ease-out',
                    }}
                    aria-label={`Open chat with ${f.displayName}`}
                  >
                    {online && glowPulse && (
                      <span
                        aria-hidden
                        className="absolute rounded-full pointer-events-none"
                        style={{
                          inset: '-10px',
                          background:
                            'radial-gradient(circle, rgba(74,222,128,0.34) 0%, rgba(74,222,128,0) 70%)',
                          filter: 'blur(7px)',
                          animation: reduced
                            ? undefined
                            : `onlineGlow ${2.4 + i * 0.11}s ease-in-out infinite`,
                        }}
                      />
                    )}

                    <span
                      aria-hidden
                      className="absolute rounded-full pointer-events-none"
                      style={{
                        inset: '-16px',
                        background:
                          'radial-gradient(circle, rgba(217,119,6,0.65) 0%, rgba(217,119,6,0) 70%)',
                        filter: 'blur(11px)',
                        opacity: isHovered ? 1 : 0,
                        transition: 'opacity 120ms ease-out',
                      }}
                    />

                    <span
                      aria-hidden
                      className="absolute rounded-full border border-[#D97706]/70 pointer-events-none"
                      style={{
                        inset: '-6px',
                        opacity: isHovered ? 1 : 0,
                        transition: 'opacity 120ms ease-out',
                      }}
                    />

                    <div className="relative rounded-full ring-0 focus-visible:ring-2 focus-visible:ring-[#D97706]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0A08]">
                      <Avatar
                        name={f.displayName}
                        src={f.avatarUrl}
                        size="md"
                        isOnline={online}
                      />
                    </div>

                    <span
                      className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 text-[10.5px] whitespace-nowrap font-medium text-[#EDE5D4] pointer-events-none"
                      style={{
                        opacity: isHovered ? 1 : 0,
                        transition: 'opacity 120ms ease-out',
                      }}
                    >
                      {f.displayName.split(' ')[0]}
                    </span>
                  </button>
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

  const [internalFriends, setInternalFriends] = useState<FriendDto[]>([]);
  const [loading, setLoading] = useState(!friendsProp);
  const [presenceTick, setPresenceTick] = useState(0);
  const [query, setQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Spin engine ──────────────────────────────────────────
  const pageRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rotationRef = useRef(0);
  const velocityRef = useRef(IDLE_VELOCITY);
  const idleDirRef = useRef(1);
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const suppressClickRef = useRef(false);

  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startRotation: 0,
    startAngle: 0,
    lastAngle: 0,
    lastTime: 0,
    moved: false,
    velocity: 0,
    // Cached on pointerdown — avoids getBoundingClientRect() at 240Hz
    center: { cx: 0, cy: 0 },
  });

  // ── friends ──────────────────────────────────────────────
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

  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((n) => n + 1));
    return () => {
      unsub();
    };
  }, []);

  // ── rotation: single CSS-var write/frame, inherited by all leaves ──
  const applyRotation = useCallback((deg: number) => {
    rotationRef.current = deg;
    if (stageRef.current) {
      stageRef.current.style.setProperty('--rot', `${deg}deg`);
    }
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startRaf = useCallback(() => {
    if (rafRef.current !== null) return;
    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      const rawDt = (now - lastTimeRef.current) / 1000;
      const dt = Math.min(MAX_DT, Math.max(0, rawDt));
      lastTimeRef.current = now;

      const d = dragRef.current;
      if (d.active || pausedRef.current) {
        rafRef.current = null;
        return;
      }

      // Frame-rate-independent exponential friction, eased into idle target
      // so the handoff at the end of a fling is invisible at any refresh rate.
      const speed = velocityRef.current;
      const decayed = speed * Math.pow(FRICTION_PER_SEC, dt);
      let next = decayed;

      if (Math.abs(decayed) < IDLE_VELOCITY) {
        const idleTarget = idleDirRef.current * IDLE_VELOCITY;
        const alpha = 1 - Math.exp(-dt * 8);
        next = decayed + (idleTarget - decayed) * alpha;
      }

      velocityRef.current = next;
      applyRotation(rotationRef.current + next * dt);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [applyRotation]);

  useEffect(() => {
    if (!pageVisible) {
      stopRaf();
      return;
    }
    if (!pausedRef.current && !dragRef.current.active) startRaf();
    return () => stopRaf();
  }, [pageVisible, startRaf, stopRaf]);

  useEffect(() => () => stopRaf(), [stopRaf]);

  // ── pointer helpers ──────────────────────────────────────
  const pointerAngle = useCallback((clientX: number, clientY: number): number => {
    const c = dragRef.current.center;
    return Math.atan2(clientY - c.cy, clientX - c.cx) * (180 / Math.PI);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = stageRef.current;
      if (!el) return;

      // One layout read per drag, not per move.
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);

      pausedRef.current = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }

      dragRef.current = {
        active: true,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRotation: rotationRef.current,
        startAngle: angle,
        lastAngle: angle,
        lastTime: performance.now(),
        moved: false,
        velocity: 0,
        center: { cx, cy },
      };
      velocityRef.current = 0;
      stopRaf();
    },
    [stopRaf],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d.active || e.pointerId !== d.pointerId) return;

      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) d.moved = true;
      if (!d.moved) return;

      const angle = pointerAngle(e.clientX, e.clientY);

      let totalDelta = angle - d.startAngle;
      if (totalDelta > 180) totalDelta -= 360;
      else if (totalDelta < -180) totalDelta += 360;

      applyRotation(d.startRotation + totalDelta);

      const now = performance.now();
      const dt = (now - d.lastTime) / 1000;
      if (dt > 0.001) {
        let angleDelta = angle - d.lastAngle;
        if (angleDelta > 180) angleDelta -= 360;
        else if (angleDelta < -180) angleDelta += 360;

        const instantVelocity = angleDelta / dt;
        // Low-pass filter so 240Hz jitter doesn't produce a noisy fling.
        const alpha = 1 - Math.exp(-dt / VELOCITY_SMOOTHING_TAU);
        d.velocity = d.velocity + (instantVelocity - d.velocity) * alpha;
      }
      d.lastAngle = angle;
      d.lastTime = now;
    },
    [applyRotation, pointerAngle],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d.active || e.pointerId !== d.pointerId) return;

      try { stageRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      d.active = false;

      if (d.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);

        const paused = performance.now() - d.lastTime > PAUSE_BEFORE_RELEASE_MS;
        const v = paused ? 0 : d.velocity;

        if (Math.abs(v) >= MIN_FLING) {
          velocityRef.current = v;
          idleDirRef.current = Math.sign(v) || idleDirRef.current;
        } else {
          velocityRef.current = idleDirRef.current * IDLE_VELOCITY;
        }
      }

      if (!pausedRef.current) startRaf();
    },
    [startRaf],
  );

  // ── wheel spin (desktop) ─────────────────────────────────
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) return;
      e.preventDefault();

      velocityRef.current += e.deltaY * 0.3;
      const dir = Math.sign(velocityRef.current);
      if (dir !== 0) idleDirRef.current = dir;
      if (!pausedRef.current) startRaf();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [startRaf]);

  // ── hover brake ──────────────────────────────────────────
  const handleHover = useCallback(
    (id: string | null) => {
      if (dragRef.current.active) return;
      setHoveredId(id);
      if (id !== null) {
        pausedRef.current = true;
        velocityRef.current = 0;
        stopRaf();
      } else if (pausedRef.current) {
        pausedRef.current = false;
        velocityRef.current = idleDirRef.current * IDLE_VELOCITY;
        startRaf();
      }
    },
    [startRaf, stopRaf],
  );

  const handleLeave = useCallback(() => {
    setHoveredId(null);
    if (pausedRef.current) {
      pausedRef.current = false;
      velocityRef.current = idleDirRef.current * IDLE_VELOCITY;
      startRaf();
    }
  }, [startRaf]);

  const handleClick = useCallback(
    (id: string) => {
      if (suppressClickRef.current) return;
      navigate(`/app/dm/${id}`);
    },
    [navigate],
  );

  // ── derived ──────────────────────────────────────────────
  const friends = friendsProp ?? internalFriends;

  const onlineIds = useMemo(
    () =>
      new Set(
        friends.filter((f) => presenceStore.isOnline(f.userId)).map((f) => f.userId),
      ),
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

  /**
   * Orbit membership = top N friends by conversation affinity.
   * Surivors are then split by presence for ring placement; order is
   * preserved inside each tier, but the exact angle on the ring is
   * deterministically shuffled by layoutTier so your favourite isn't
   * always parked at the same clock position.
   */
  const layout = useMemo(() => {
    const ranked = [...filtered].sort(
      (a, b) => affinityScore(b) - affinityScore(a),
    );
    const top = ranked.slice(0, MAX_ORBIT);

    const online = top.filter((f) => onlineIds.has(f.userId));
    const offline = top.filter((f) => !onlineIds.has(f.userId));

    const visibleOnline = layoutTier(online, MIN_ANGLE_GAP_DEG);
    const visibleOffline = layoutTier(offline, MIN_ANGLE_GAP_DEG);

    return {
      visibleOnline,
      visibleOffline,
      hiddenCount: filtered.length - top.length,
    };
  }, [filtered, onlineIds]);

  const { visibleOnline, visibleOffline, hiddenCount } = layout;
  const inOrbit = visibleOnline.length + visibleOffline.length;

  /**
   * Header stat — how many of my friends are online, independent of
   * the MAX_ORBIT cap. Uses `friends` (not `filtered`) so typing a
   * search doesn't lie about your presence count.
   */
  const onlineTotal = useMemo(
    () => friends.reduce((n, f) => (onlineIds.has(f.userId) ? n + 1 : n), 0),
    [friends, onlineIds],
  );

  const animationsEnabled = pageVisible;
  const starfieldAnimate = animationsEnabled && !reduced;
  const dustEnabled = animationsEnabled && !reduced && !lowPower;
  const shootingEnabled = animationsEnabled && !reduced;
  const starCount = lowPower || coarse ? STAR_COUNT_MOBILE : STAR_COUNT_DESKTOP;
  const dustCount = lowPower || coarse ? DUST_COUNT_MOBILE : DUST_COUNT_DESKTOP;

  return (
    <div
      ref={pageRef}
      className="relative w-full h-full bg-[#0B0A08] text-[#EDE5D4] overflow-hidden isolate"
    >
      <style>{`
        @keyframes starTwinkle {
          0%, 100% { opacity: 0.08; transform: scale(1); }
          50%      { opacity: 0.95; transform: scale(1.55); }
        }
        @keyframes dustDrift {
          0%   { transform: translate(0, 0) scale(1);          opacity: 0.1; }
          25%  { transform: translate(18px, -10px) scale(1.2);  opacity: 0.65; }
          50%  { transform: translate(-10px, 14px) scale(0.9);  opacity: 0.4; }
          75%  { transform: translate(-14px, -8px) scale(1.1);  opacity: 0.55; }
          100% { transform: translate(0, 0) scale(1);           opacity: 0.1; }
        }
        @keyframes ringPulse {
          0%, 100% { opacity: 0.32; }
          50%      { opacity: 0.75; }
        }
        @keyframes ringRotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes corePulse {
          0%, 100% { transform: scale(1);     opacity: 0.5; }
          50%      { transform: scale(1.22);  opacity: 0.9; }
        }
        @keyframes onlineGlow {
          0%, 100% { opacity: 0.65; }
          50%      { opacity: 1; }
        }
        @keyframes satelliteOrbit {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes avatarFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes shoot {
          0% {
            transform: rotate(var(--shoot-angle, 30deg)) translateX(0) scaleX(0.35) scale(var(--shoot-scale, 1));
            opacity: 0;
          }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% {
            transform: rotate(var(--shoot-angle, 30deg)) translateX(var(--shoot-dist, 70vmin)) scaleX(1) scale(var(--shoot-scale, 1));
            opacity: 0;
          }
        }
        .shooting-star {
          position: absolute;
          width: 140px;
          height: 2.5px;
          border-radius: 2px;
          transform-origin: left center;
          pointer-events: none;
          animation: shoot linear forwards;
        }
        .shooting-star[data-hue="white"] {
          background: linear-gradient(90deg,
            rgba(255,255,255,0) 0%,
            rgba(220,235,255,0.35) 35%,
            rgba(240,248,255,0.9) 82%,
            #ffffff 100%);
          box-shadow: 0 0 10px rgba(255,255,255,0.85), 0 0 20px rgba(180,210,255,0.55);
        }
        .shooting-star[data-hue="warm"] {
          background: linear-gradient(90deg,
            rgba(255,180,90,0) 0%,
            rgba(255,190,110,0.4) 35%,
            rgba(255,210,140,0.95) 82%,
            #FFF3D6 100%);
          box-shadow: 0 0 10px rgba(255,190,120,0.9), 0 0 22px rgba(255,150,60,0.55);
        }
      `}</style>

      <Starfield reduced={reduced} count={starCount} animate={starfieldAnimate} />
      <FloatingDust count={dustCount} enabled={dustEnabled} />
      <ShootingStars enabled={shootingEnabled} dense={!lowPower} />

      {/* Header — solid bg, no backdrop-blur (was forcing per-frame re-blur) */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="absolute top-[env(safe-area-inset-top,0px)] left-4 md:top-5 md:left-5 z-20 pointer-events-none pt-4 md:pt-0"
      >
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#0F0D0A]/85 border border-white/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7)] pointer-events-auto">
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
                    ? 'bg-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.9)]'
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

      {/* Search — solid bg */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.03, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="absolute top-[env(safe-area-inset-top,0px)] right-4 md:top-5 md:right-5 z-20 pt-4 md:pt-0"
      >
        <motion.div
          layout
          animate={{ width: searchFocused || query ? 240 : 160 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 34 }}
          className="relative"
        >
          <div className="absolute inset-0 rounded-2xl bg-[#0F0D0A]/85 border border-white/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7)] pointer-events-none" />
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
                transition={{ duration: 0.12 }}
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
              transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
              className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[#D97706]/30 border-t-[#D97706]"
            />
            Charting your orbit…
          </motion.div>
        ) : friends.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-3 text-center px-6"
          >
            <motion.div
              animate={reduced || !animationsEnabled ? undefined : { scale: [1, 1.06, 1] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
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
                  'radial-gradient(circle at center, rgba(217,119,6,0.18) 0%, rgba(217,119,6,0.05) 34%, rgba(217,119,6,0) 64%)',
              }}
            />

            <div aria-hidden className="absolute inset-0 pointer-events-none">
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: `calc(${ONLINE_RADIUS} * 2)`,
                  height: `calc(${ONLINE_RADIUS} * 2)`,
                  animation:
                    reduced || !animationsEnabled
                      ? undefined
                      : 'ringRotate 40s linear infinite',
                }}
              >
                <div
                  className="absolute inset-0 rounded-full border border-dashed border-[#4ADE80]/20"
                  style={{
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'ringPulse 4s ease-in-out infinite',
                  }}
                />
              </div>
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: `calc(${OFFLINE_RADIUS} * 2)`,
                  height: `calc(${OFFLINE_RADIUS} * 2)`,
                  animation:
                    reduced || !animationsEnabled
                      ? undefined
                      : 'ringRotate 80s linear infinite reverse',
                }}
              >
                <div
                  className="absolute inset-0 rounded-full border border-dashed border-white/[0.08]"
                  style={{
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'ringPulse 7s ease-in-out infinite',
                  }}
                />
              </div>
            </div>

            {/* Center avatar */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
              <div className="relative">
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(217,119,6,0.7) 0%, rgba(217,119,6,0) 65%)',
                    transform: 'scale(3.4)',
                    filter: 'blur(16px)',
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'corePulse 4.2s ease-in-out infinite',
                  }}
                />
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(255,200,120,0.5) 0%, rgba(255,200,120,0) 60%)',
                    transform: 'scale(2)',
                    filter: 'blur(10px)',
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'corePulse 5.5s ease-in-out infinite reverse',
                  }}
                />
                <span
                  aria-hidden
                  className="absolute rounded-full border border-[#D97706]/35"
                  style={{
                    inset: '-18px',
                    animation:
                      reduced || !animationsEnabled
                        ? undefined
                        : 'ringPulse 3s ease-in-out infinite',
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
                        : 'ringPulse 4.5s ease-in-out infinite 0.4s',
                  }}
                />

                {!reduced && animationsEnabled && (
                  <>
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ animation: 'satelliteOrbit 8s linear infinite' }}
                    >
                      <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#FFB347] shadow-[0_0_8px_rgba(255,179,71,1)]" />
                    </div>
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ animation: 'satelliteOrbit 14s linear infinite reverse' }}
                    >
                      <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[#FFF3D6] shadow-[0_0_6px_rgba(255,243,214,0.95)]" />
                    </div>
                  </>
                )}

                <motion.div
                  animate={reduced || !animationsEnabled ? undefined : { scale: [1, 1.05, 1] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
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

            {/*
             * Rotating disc — auto-spins + drag to fling.
             *
             * No `contain` / `translateZ(0)` — those clipped the outer-ring
             * avatars (and their hover glow) to the stage's box. `will-change:
             * transform` alone is enough for GPU promotion; the actual rotation
             * happens via the `--rot` custom property so leaves read it for free.
             */}
            <div
              ref={stageRef}
              className="absolute inset-0"
              style={{
                transform: 'rotate(var(--rot, 0deg))',
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                touchAction: 'none',
                userSelect: 'none',
                cursor: coarse ? 'default' : 'grab',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <Tier
                nodes={visibleOffline}
                radius={OFFLINE_RADIUS}
                hoveredId={hoveredId}
                onHover={handleHover}
                onLeave={handleLeave}
                onClick={handleClick}
                online={false}
                reduced={reduced}
                glowPulse={!lowPower}
              />
              <Tier
                nodes={visibleOnline}
                radius={ONLINE_RADIUS}
                hoveredId={hoveredId}
                onHover={handleHover}
                onLeave={handleLeave}
                onClick={handleClick}
                online
                reduced={reduced}
                glowPulse={!lowPower}
              />
            </div>

            <AnimatePresence>
              {hiddenCount > 0 && !query && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => navigate('/app/friends')}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-full bg-[#1A1816]/90 border border-white/[0.08] hover:border-[#D97706]/40 text-[11.5px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)] touch-manipulation"
                >
                  +{hiddenCount} more in your list
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Status pill — solid bg */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none pb-[env(safe-area-inset-bottom,0px)] bottom-4"
      >
        <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#0F0D0A]/85 border border-white/[0.06] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7)] pointer-events-auto">
          <span className="flex items-center gap-2 text-[11.5px] text-[#6B6259]">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                hoveredId
                  ? 'bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.75)]'
                  : 'bg-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.85)]'
              }`}
            />
            Drag to spin
          </span>
          {inOrbit > 0 && (
            <>
              <span className="w-px h-3 bg-white/[0.08]" />
              <span className="text-[11.5px] text-[#6B6259] tabular-nums">
                {inOrbit} in orbit
              </span>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}