/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiService } from '../services/api';
import { presenceStore } from '../services/presenceStore';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import type { FriendDto } from '../types/api';
import { Search, X, Users, Sparkles } from 'lucide-react';

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
/* Tunables                                                   */
/* ────────────────────────────────────────────────────────── */

const ONLINE_RADIUS = '28vmin';
const OFFLINE_RADIUS = '42vmin';
const ONLINE_SPIN_SEC = 120;
const OFFLINE_SPIN_SEC = 240;
const MAX_ORBIT = 30;

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

const STARS: Star[] = (() => {
  const out: Star[] = [];
  for (let i = 0; i < 70; i++) {
    const seed = `star-${i}`;
    out.push({
      top: stableRandom(seed, 'top') * 100,
      left: stableRandom(seed, 'left') * 100,
      size: 1 + stableRandom(seed, 'size') * 2,
      delay: stableRandom(seed, 'delay') * 6,
      duration: 3 + stableRandom(seed, 'dur') * 4,
      opacity: 0.15 + stableRandom(seed, 'op') * 0.5,
    });
  }
  return out;
})();

function Starfield() {
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {STARS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animation: `starTwinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Tier — one rotating ring of friends                        */
/* ────────────────────────────────────────────────────────── */

interface TierProps {
  friends: FriendDto[];
  radius: string;
  spinSeconds: number;
  reverse: boolean;
  paused: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
  online: boolean;
}

function Tier({
  friends,
  radius,
  spinSeconds,
  reverse,
  paused,
  hoveredId,
  onHover,
  onClick,
  online,
}: TierProps) {
  if (friends.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        animation: `constellationSpin ${spinSeconds}s linear infinite${reverse ? ' reverse' : ''}`,
        animationPlayState: paused ? 'paused' : 'running',
        willChange: 'transform',
      }}
    >
      {friends.map((f, i) => {
        const angle = stableRandom(f.userId, 'angle') * 360;
        const radiusJitter = (stableRandom(f.userId, 'rjit') - 0.5) * 5;
        const finalRadius = `calc(${radius} + ${radiusJitter}vmin)`;
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
                <div
                  style={{
                    animation: `constellationSpin ${spinSeconds}s linear infinite${reverse ? '' : ' reverse'}`,
                    animationPlayState: paused ? 'paused' : 'running',
                  }}
                >
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: 1,
                      opacity: isDimmed ? 0.35 : 1,
                    }}
                    transition={{
                      delay: 0.05 + i * 0.025,
                      type: 'spring',
                      stiffness: 280,
                      damping: 22,
                    }}
                  >
                    <motion.button
                      type="button"
                      onClick={() => onClick(f.userId)}
                      onMouseEnter={() => onHover(f.userId)}
                      onMouseLeave={() => onHover(null)}
                      className="relative flex flex-col items-center focus:outline-none group"
                      aria-label={`Open chat with ${f.displayName}`}
                      animate={{ scale: isHovered ? 1.2 : 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                    >
                      {/* Online glow */}
                      {online && (
                        <motion.span
                          aria-hidden
                          className="absolute rounded-full pointer-events-none"
                          style={{
                            inset: '-8px',
                            background:
                              'radial-gradient(circle, rgba(74,222,128,0.28) 0%, rgba(74,222,128,0) 70%)',
                            filter: 'blur(6px)',
                          }}
                          animate={{ opacity: [0.7, 1, 0.7] }}
                          transition={{
                            duration: 2.6 + i * 0.13,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />
                      )}

                      {/* Hover glow */}
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

                      {/* Hover ring */}
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

                      <div className="relative">
                        <Avatar
                          name={f.displayName}
                          src={f.avatarUrl}
                          size="md"
                          isOnline={online}
                        />

                        {/* Sparkle badge on hover */}
                        <AnimatePresence>
                          {isHovered && (
                            <motion.span
                              aria-hidden
                              initial={{ opacity: 0, scale: 0, rotate: -30 }}
                              animate={{ opacity: 1, scale: 1, rotate: 0 }}
                              exit={{ opacity: 0, scale: 0, rotate: 30 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#D97706] text-[#0F0D0A] flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(217,119,6,0.7)]"
                            >
                              <Sparkles className="w-3 h-3" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>

                      <AnimatePresence>
                        {isHovered && (
                          <motion.span
                            initial={{ opacity: 0, y: -2 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -2 }}
                            transition={{ duration: 0.15 }}
                            className="mt-1.5 text-[10.5px] whitespace-nowrap font-medium text-[#EDE5D4]"
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
}

/* ────────────────────────────────────────────────────────── */
/* Main                                                       */
/* ────────────────────────────────────────────────────────── */

interface ConstellationViewProps {
  friends?: FriendDto[];
}

export default function ConstellationView({ friends: friendsProp }: ConstellationViewProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [internalFriends, setInternalFriends] = useState<FriendDto[]>([]);
  const [loading, setLoading] = useState(!friendsProp);
  const [, setPresenceTick] = useState(0);
  const [query, setQuery] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

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

  const friends = friendsProp ?? internalFriends;

  const filtered = useMemo(() => {
    if (!query.trim()) return friends;
    const q = query.trim().toLowerCase();
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        (f.handle ?? '').toLowerCase().includes(q),
    );
  }, [friends, query]);

  const { visibleOnline, visibleOffline, hiddenCount, onlineTotal } = useMemo(() => {
    const online = filtered.filter((f) => presenceStore.isOnline(f.userId));
    const offline = filtered.filter((f) => !presenceStore.isOnline(f.userId));

    const visOnline = online.slice(0, MAX_ORBIT);
    const remaining = MAX_ORBIT - visOnline.length;
    const visOffline = offline.slice(0, Math.max(0, remaining));

    return {
      visibleOnline: visOnline,
      visibleOffline: visOffline,
      hiddenCount: online.length + offline.length - visOnline.length - visOffline.length,
      onlineTotal: online.length,
    };
  }, [filtered]);

  const paused = hoveredId !== null;
  const inOrbit = visibleOnline.length + visibleOffline.length;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
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
      `}</style>

      {/* ─── Header ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 px-5 py-4 border-b border-white/[0.05] flex items-center justify-between gap-3 shrink-0"
      >
        <div className="min-w-0">
          <h2
            className="text-[18px] font-semibold tracking-tight flex items-center gap-2"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            Your orbit
          </h2>
          <p className="text-[12px] text-[#6B6259] mt-0.5 tabular-nums flex items-center gap-1.5">
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

        <motion.div
          className="relative shrink-0"
          animate={{ width: searchFocused || query ? 240 : 160 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6259] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Find someone"
            className="h-8 w-full pl-8 pr-7 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] text-[#EDE5D4] placeholder:text-[#6B6259] focus:outline-none focus:border-[#D97706]/40 focus:bg-white/[0.05] transition-colors"
          />
          <AnimatePresence>
            {query && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B6259] hover:text-[#EDE5D4] transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* ─── Stage ─────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        <Starfield />

        {loading ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[12.5px] text-[#6B6259] flex items-center gap-2"
          >
            <motion.span
              animate={{ rotate: 360 }}
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
              animate={{ scale: [1, 1.06, 1] }}
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
              width: '88vmin',
              height: '88vmin',
              maxWidth: '820px',
              maxHeight: '820px',
            }}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Core ambient glow */}
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at center, rgba(217,119,6,0.14) 0%, rgba(217,119,6,0.04) 32%, rgba(217,119,6,0) 62%)',
              }}
            />

            {/* Orbit rings */}
            <div aria-hidden className="absolute inset-0 pointer-events-none">
              {/* Online ring */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[#4ADE80]/15"
                style={{
                  width: `calc(${ONLINE_RADIUS} * 2)`,
                  height: `calc(${ONLINE_RADIUS} * 2)`,
                  animation: 'ringPulse 6s ease-in-out infinite',
                }}
              />
              {/* Offline ring */}
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/[0.06]"
                style={{
                  width: `calc(${OFFLINE_RADIUS} * 2)`,
                  height: `calc(${OFFLINE_RADIUS} * 2)`,
                  animation: 'ringPulse 9s ease-in-out infinite',
                }}
              />
            </div>

            {/* Offline tier */}
            <Tier
              friends={visibleOffline}
              radius={OFFLINE_RADIUS}
              spinSeconds={OFFLINE_SPIN_SEC}
              reverse
              paused={paused}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onClick={(id) => navigate(`/app/dm/${id}`)}
              online={false}
            />

            {/* Online tier */}
            <Tier
              friends={visibleOnline}
              radius={ONLINE_RADIUS}
              spinSeconds={ONLINE_SPIN_SEC}
              reverse={false}
              paused={paused}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onClick={(id) => navigate(`/app/dm/${id}`)}
              online
            />

            {/* Center — you */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
              <div className="relative">
                {/* Triple glow layers */}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(217,119,6,0.55) 0%, rgba(217,119,6,0) 70%)',
                    transform: 'scale(3.2)',
                    filter: 'blur(14px)',
                    animation: 'corePulse 5s ease-in-out infinite',
                  }}
                />
                <span
                  aria-hidden
                  className="absolute rounded-full border border-[#D97706]/30"
                  style={{
                    inset: '-18px',
                    animation: 'ringPulse 3.5s ease-in-out infinite',
                  }}
                />
                <span
                  aria-hidden
                  className="absolute rounded-full border border-[#D97706]/20"
                  style={{
                    inset: '-30px',
                    animation: 'ringPulse 5s ease-in-out infinite 0.5s',
                  }}
                />

                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
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

            {/* +N more */}
            <AnimatePresence>
              {hiddenCount > 0 && !query && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => navigate('/app/friends')}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-full bg-[#1A1816]/90 backdrop-blur border border-white/[0.08] hover:border-[#D97706]/40 text-[11.5px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)]"
                >
                  +{hiddenCount} more in your list
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ─── Footer ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 px-5 py-3 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-[#6B6259] shrink-0"
      >
        <motion.span
          key={paused ? 'paused' : 'live'}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="flex items-center gap-1.5"
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              paused
                ? 'bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.7)]'
                : 'bg-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.7)]'
            }`}
          />
          {paused ? 'Paused while you browse' : 'Live — tap a face to chat'}
        </motion.span>

        {inOrbit > 0 && (
          <motion.span
            key={inOrbit}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="tabular-nums"
          >
            {inOrbit} in orbit
          </motion.span>
        )}
      </motion.div>
    </div>
  );
}