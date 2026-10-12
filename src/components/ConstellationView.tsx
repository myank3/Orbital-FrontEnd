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
import { Search, X, Users } from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Deterministic hashing — gives each friend a stable spot    */
/* on the map so positions don't jump around between renders. */
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
      {friends.map((f) => {
        const angle = stableRandom(f.userId, 'angle') * 360;
        const jitter = (stableRandom(f.userId, 'jitter') - 0.5) * 6;
        const finalRadius = `calc(${radius} + ${jitter}vmin)`;
        const isHovered = hoveredId === f.userId;

        return (
          <div
            key={f.userId}
            className="absolute"
            style={{
              left: '50%',
              top: '50%',
              width: 0,
              height: 0,
            }}
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
                style={{
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  style={{
                    animation: `constellationSpin ${spinSeconds}s linear infinite${reverse ? '' : ' reverse'}`,
                    animationPlayState: paused ? 'paused' : 'running',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onClick(f.userId)}
                    onMouseEnter={() => onHover(f.userId)}
                    onMouseLeave={() => onHover(null)}
                    className="relative flex flex-col items-center focus:outline-none group"
                    aria-label={`Open chat with ${f.displayName}`}
                  >
                    {/* Glow */}
                    {online && (
                      <span
                        aria-hidden
                        className="absolute rounded-full pointer-events-none"
                        style={{
                          inset: '-8px',
                          background:
                            'radial-gradient(circle, rgba(74,222,128,0.28) 0%, rgba(74,222,128,0) 70%)',
                          filter: 'blur(6px)',
                        }}
                      />
                    )}
                    {isHovered && (
                      <span
                        aria-hidden
                        className="absolute rounded-full pointer-events-none"
                        style={{
                          inset: '-10px',
                          background:
                            'radial-gradient(circle, rgba(217,119,6,0.35) 0%, rgba(217,119,6,0) 70%)',
                          filter: 'blur(8px)',
                        }}
                      />
                    )}

                    <motion.div
                      animate={
                        isHovered
                          ? { scale: 1.15 }
                          : { scale: 1 }
                      }
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className="relative"
                    >
                      <Avatar
                        name={f.displayName}
                        src={f.avatarUrl}
                        size="md"
                        isOnline={online}
                      />
                    </motion.div>

                    <span
                      className={`mt-1.5 text-[10.5px] whitespace-nowrap font-medium transition-opacity duration-150 ${
                        isHovered ? 'opacity-100 text-[#EDE5D4]' : 'opacity-0 text-[#A8A29E]'
                      }`}
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

  // Fetch friends if not passed in
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

  // Re-render on presence changes
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

  const onlineFriends = filtered.filter((f) => presenceStore.isOnline(f.userId));
  const offlineFriends = filtered.filter((f) => !presenceStore.isOnline(f.userId));

  const paused = hoveredId !== null;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* Global keyframes for the spin */}
      <style>{`
        @keyframes constellationSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      {/* Header */}
      <div className="relative z-10 px-5 py-4 border-b border-white/[0.05] flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold tracking-tight flex items-center gap-2">
            Your orbit
          </h2>
          <p className="text-[12px] text-[#6B6259] mt-0.5 tabular-nums">
            <span className="text-[#4ADE80]">{onlineFriends.length}</span> online ·{' '}
            {friends.length} total
          </p>
        </div>
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6259] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find someone"
            className="h-8 pl-8 pr-7 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] text-[#EDE5D4] placeholder:text-[#6B6259] focus:outline-none focus:border-[#D97706]/40 w-40 sm:w-52 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B6259] hover:text-[#EDE5D4] transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {loading ? (
          <div className="text-[12.5px] text-[#6B6259]">Loading orbit…</div>
        ) : friends.length === 0 ? (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Users className="w-6 h-6 text-[#6B6259]" />
            </div>
            <p className="text-[14px] text-[#EDE5D4] font-medium">
              No one in your orbit yet
            </p>
            <p className="text-[12.5px] text-[#6B6259] max-w-[280px]">
              Add friends and they'll appear here, orbiting around you.
            </p>
          </div>
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
            {/* Ambient core glow */}
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at center, rgba(217,119,6,0.10) 0%, rgba(217,119,6,0.03) 35%, rgba(217,119,6,0) 65%)',
              }}
            />

            {/* Orbit rings */}
            <div aria-hidden className="absolute inset-0 pointer-events-none">
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
                style={{
                  width: `calc(${ONLINE_RADIUS} * 2)`,
                  height: `calc(${ONLINE_RADIUS} * 2)`,
                }}
              />
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.04]"
                style={{
                  width: `calc(${OFFLINE_RADIUS} * 2)`,
                  height: `calc(${OFFLINE_RADIUS} * 2)`,
                }}
              />
            </div>

            {/* Offline tier (behind) */}
            <Tier
              friends={offlineFriends}
              radius={OFFLINE_RADIUS}
              spinSeconds={OFFLINE_SPIN_SEC}
              reverse
              paused={paused}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onClick={(id) => navigate(`/app/dm/${id}`)}
              online={false}
            />

            {/* Online tier (front) */}
            <Tier
              friends={onlineFriends}
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
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(217,119,6,0.45) 0%, rgba(217,119,6,0) 70%)',
                    transform: 'scale(3)',
                    filter: 'blur(12px)',
                  }}
                />
                <motion.div
                  animate={{ scale: [1, 1.04, 1] }}
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
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="relative z-10 px-5 py-3 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-[#6B6259] shrink-0">
        <span>
          {paused ? 'Paused while you browse' : 'Tap a face to open the conversation'}
        </span>
        <AnimatePresence>
          {hoveredId && (
            <motion.span
              key={hoveredId}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              className="text-[#D97706]"
            >
              →
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}