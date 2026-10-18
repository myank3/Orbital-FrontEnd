/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiService, extractErrorMessage } from '../services/api';
import {
  FriendDto,
  PendingFriendRequestDto,
  UserProfileDto,
} from '../types/api';
import { presenceStore } from '../services/presenceStore';
import { Avatar } from './Avatar';
import { UserProfileModal } from './UserProfileModal';
import {
  UserCheck,
  UserPlus,
  Clock,
  MessageSquare,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
  Search,
  Inbox,
  Compass,
  Zap,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* helpers                                                    */
/* ────────────────────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
  try {
    const then = new Date(dateStr).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function bannerAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/* ────────────────────────────────────────────────────────── */
/* Memory moments — auto-spinning shelf                       */
/* ────────────────────────────────────────────────────────── */

const MEMORY_MOMENTS = [
  {
    id: 'coffee-chats',
    title: 'Coffee chats',
    subtitle: 'Catch up over espresso.',
    image:
      'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=600&q=80&auto=format&fit=crop',
    tag: '☕ Cafe',
  },
  {
    id: 'late-laughs',
    title: 'Late night laughs',
    subtitle: 'Nothing serious. Everything funny.',
    image:
      'https://images.unsplash.com/photo-1543269865-cbf427effbad?w=600&q=80&auto=format&fit=crop',
    tag: '😄 Fun',
  },
  {
    id: 'group-hangs',
    title: 'Group hangs',
    subtitle: 'The whole crew. Finally.',
    image:
      'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=600&q=80&auto=format&fit=crop',
    tag: '🎉 Friends',
  },
  {
    id: 'deep-talks',
    title: 'Deep talks',
    subtitle: 'When the world melts away.',
    image:
      'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=600&q=80&auto=format&fit=crop',
    tag: '💬 Talk',
  },
  {
    id: 'sunday-brunch',
    title: 'Sunday brunch',
    subtitle: 'Eggs, stories, seconds.',
    image:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80&auto=format&fit=crop',
    tag: '🍳 Brunch',
  },
  {
    id: 'quick-catchups',
    title: 'Quick catch-ups',
    subtitle: 'Ten minutes. One good story.',
    image:
      'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&q=80&auto=format&fit=crop',
    tag: '👋 Casual',
  },
  {
    id: 'night-out',
    title: 'Night out',
    subtitle: 'Music, laughs, memories.',
    image:
      'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=600&q=80&auto=format&fit=crop',
    tag: '🌃 Hangout',
  },
];

function MemoryShelf() {
  const looped = useMemo(() => [...MEMORY_MOMENTS, ...MEMORY_MOMENTS], []);

  return (
    <div className="mt-8">
      <style>{`
        @keyframes memory-scroll {
          0%   { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
        .memory-track {
          display: flex;
          width: max-content;
          animation: memory-scroll 70s linear infinite;
          will-change: transform;
          backface-visibility: hidden;
        }
        .memory-track:hover,
        .memory-track:active {
          animation-play-state: paused;
        }
        .memory-viewport {
          overflow: hidden;
          -webkit-mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 6%,
            black 94%,
            transparent 100%
          );
          mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 6%,
            black 94%,
            transparent 100%
          );
        }
        @media (prefers-reduced-motion: reduce) {
          .memory-track { animation: none; }
        }
      `}</style>

      <div className="flex items-baseline justify-between mb-3 px-1">
        <div>
          <h3 className="text-[15px] font-semibold text-[#EDE5D4] tracking-tight">
            Make memories with friends
          </h3>
          <p className="text-[11.5px] text-[#6B6259] mt-0.5">
            Real conversations. Real moments.
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[#6B6259] font-mono hidden sm:inline">
          
        </span>
      </div>

      <div className="memory-viewport -mx-4 sm:-mx-6">
        <div className="memory-track py-1">
          {looped.map((m, i) => (
            <div
              key={`${m.id}-${i}`}
              className="shrink-0 w-[200px] h-[260px] mr-3 relative rounded-2xl overflow-hidden border border-white/[0.06] hover:border-[#D97706]/40 transition-colors group"
            >
              <img
                src={m.image}
                alt={m.title}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
              <div className="absolute top-3 left-3">
                <span className="text-[9.5px] font-mono uppercase tracking-[0.12em] text-white/90 bg-black/50 backdrop-blur-md px-2 py-1 rounded-full border border-white/10">
                  {m.tag}
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3.5">
                <p className="text-[15px] font-semibold text-white leading-tight">
                  {m.title}
                </p>
                <p className="text-[11px] text-white/70 mt-1 leading-snug">
                  {m.subtitle}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Skeletons                                                  */
/* ────────────────────────────────────────────────────────── */

function FriendRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-10 h-10 rounded-full bg-white/[0.06] animate-pulse shrink-0" />
      <div className="flex-1 flex items-center gap-2">
        <div className="h-3.5 w-24 rounded bg-white/[0.06] animate-pulse" />
        <div className="h-2.5 w-16 rounded bg-white/[0.04] animate-pulse" />
      </div>
    </div>
  );
}

function DiscoverCardSkeleton() {
  return (
    <div className="rounded-2xl bg-[#1A1816] border border-white/[0.06] overflow-hidden">
      <div className="h-20 bg-gradient-to-br from-white/[0.04] to-transparent" />
      <div className="px-3 pb-3 -mt-8">
        <div className="w-12 h-12 rounded-full bg-white/[0.06] border-4 border-[#1A1816] animate-pulse" />
        <div className="mt-2 h-3.5 w-24 rounded bg-white/[0.06] animate-pulse" />
        <div className="mt-1.5 h-2.5 w-16 rounded bg-white/[0.04] animate-pulse" />
        <div className="mt-3 h-8 w-full rounded-lg bg-white/[0.05] animate-pulse" />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Friend row — borderless, contact-list style                */
/* ────────────────────────────────────────────────────────── */

interface FriendRowProps {
  friend: FriendDto;
  isOnline: boolean;
  onOpenProfile: (id: string) => void;
  onMessage: (id: string) => void;
}

function FriendRow({ friend, isOnline, onOpenProfile, onMessage }: FriendRowProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="group flex items-center gap-3.5 px-2 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
    >
      <button
        type="button"
        onClick={() => onOpenProfile(friend.userId)}
        className="shrink-0 relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/60"
        aria-label={`View ${friend.displayName}'s profile`}
      >
        <Avatar name={friend.displayName} src={friend.avatarUrl} size="md" />
        {isOnline && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#22C55E] border-[2.5px] border-[#0B0A08]" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-[#EDE5D4] truncate leading-tight">
          {friend.displayName}
        </p>
        <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5 font-mono">
          @{friend.handle}
        </p>
      </div>

      <button
        onClick={() => onMessage(friend.userId)}
        className="shrink-0 h-8 w-8 sm:w-auto sm:px-3 rounded-lg bg-transparent hover:bg-[#D97706] border border-white/[0.06] hover:border-[#D97706] text-[12px] font-medium text-[#A8A29E] hover:text-[#0F0D0A] inline-flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.97]"
        aria-label={`Message ${friend.displayName}`}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Message</span>
      </button>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Discover card                                              */
/* ────────────────────────────────────────────────────────── */

interface DiscoverCardProps {
  user: UserProfileDto;
  isFriend: boolean;
  sent: boolean;
  onOpenProfile: (id: string) => void;
  onMessage: (id: string) => void;
  onAdd: (u: UserProfileDto) => void;
}

function DiscoverCard({
  user,
  isFriend,
  sent,
  onOpenProfile,
  onMessage,
  onAdd,
}: DiscoverCardProps) {
  const angle = useMemo(() => bannerAngle(user.id), [user.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="group relative rounded-2xl bg-[#1A1816] border border-white/[0.06] hover:border-[#D97706]/35 overflow-hidden transition-colors"
    >
      <div
        className="relative h-20 overflow-hidden"
        style={{
          background: `linear-gradient(${angle}deg, rgba(217,119,6,0.22) 0%, rgba(217,119,6,0.06) 45%, transparent 80%)`,
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.10] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <span
          aria-hidden
          className="absolute -right-2 -top-3 text-[84px] leading-none font-bold text-[#D97706]/[0.07] select-none pointer-events-none"
        >
          {(user.displayName || '?')[0].toUpperCase()}
        </span>
      </div>

      <div className="px-3 pb-3 -mt-7">
        <button
          type="button"
          onClick={() => onOpenProfile(user.id)}
          className="block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/60 transition-transform duration-150 group-hover:scale-[1.04]"
          aria-label={`View ${user.displayName}'s profile`}
        >
          <span className="block p-[2.5px] rounded-full bg-gradient-to-tr from-[#D97706]/45 to-[#D97706]/[0.05] group-hover:from-[#D97706]/70 transition-all duration-150">
            <span className="block p-[2px] rounded-full bg-[#1A1816]">
              <Avatar name={user.displayName} src={user.avatarUrl} size="md" />
            </span>
          </span>
        </button>

        <p className="text-[13px] font-semibold text-[#EDE5D4] truncate tracking-tight mt-2">
          {user.displayName}
        </p>
        <p className="text-[11px] text-[#7A6F65] font-mono truncate mt-0.5">
          @{user.userHandle}
        </p>

        <div className="mt-2.5">
          {isFriend ? (
            <button
              onClick={() => onMessage(user.id)}
              className="w-full h-8 rounded-lg bg-white/[0.04] hover:bg-[#D97706] border border-white/[0.06] hover:border-[#D97706] text-[11.5px] font-medium text-[#EDE5D4] hover:text-[#0F0D0A] inline-flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.97]"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Message</span>
            </button>
          ) : sent ? (
            <span className="w-full h-8 rounded-lg bg-[#15803D]/[0.10] border border-[#22C55E]/25 text-[11.5px] font-semibold text-[#4ADE80] inline-flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Sent</span>
            </span>
          ) : (
            <button
              onClick={() => onAdd(user)}
              className="w-full h-8 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[11.5px] font-semibold inline-flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-[0.97]"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Empty state                                                */
/* ────────────────────────────────────────────────────────── */

function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
        {icon}
      </div>
      <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight mt-4">
        {title}
      </p>
      <p className="text-[12.5px] text-[#6B6259] mt-1 leading-relaxed">
        {subtitle}
      </p>
      {action}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Section divider — "Online" / "Offline" group header        */
/* ────────────────────────────────────────────────────────── */

function SectionHeader({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-2 mb-1 mt-4 first:mt-0">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-[10.5px] uppercase tracking-[0.16em] text-[#6B6259] font-mono font-medium">
        {label}
      </span>
      <span className="text-[10.5px] text-[#6B6259]/70 font-mono tabular-nums">
        {count}
      </span>
      <div className="flex-1 h-px bg-white/[0.04]" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Main pane                                                  */
/* ────────────────────────────────────────────────────────── */

function FriendsPane(): React.JSX.Element {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'discover'>('all');
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingFriendRequestDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoverResults, setDiscoverResults] = useState<UserProfileDto[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const discoverDebounceRef = useRef<number | null>(null);

  const [, setPresenceTick] = useState(0);

  const fetchFriendsAndPending = useCallback(async () => {
    setLoading(true);
    try {
      const [friendsData, pendingData] = await Promise.all([
        apiService.getFriends().catch(() => [] as FriendDto[]),
        apiService.getPendingRequests().catch(() => [] as PendingFriendRequestDto[]),
      ]);
      setFriends(friendsData);
      setPendingRequests(pendingData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFriendsAndPending();
  }, [fetchFriendsAndPending]);

  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'discover') return;

    if (discoverDebounceRef.current != null) {
      window.clearTimeout(discoverDebounceRef.current);
    }

    const q = discoverQuery.trim();
    if (q.length < 2) {
      setDiscoverResults([]);
      setDiscoverError(null);
      setDiscoverLoading(false);
      return;
    }

    setDiscoverLoading(true);
    setDiscoverError(null);

    discoverDebounceRef.current = window.setTimeout(async () => {
      try {
        const results = await apiService.searchUsers(q, 30);
        setDiscoverResults(results);
      } catch (err) {
        setDiscoverError(extractErrorMessage(err, 'Search failed.'));
        setDiscoverResults([]);
      } finally {
        setDiscoverLoading(false);
      }
    }, 300);

    return () => {
      if (discoverDebounceRef.current != null) {
        window.clearTimeout(discoverDebounceRef.current);
      }
    };
  }, [discoverQuery, activeTab]);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().replace(/^@/, '').toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        f.handle.toLowerCase().includes(q),
    );
  }, [friends, searchQuery]);

  /** Split friends into online / offline groups. */
  const { onlineFriends, offlineFriends } = useMemo(() => {
    const online: FriendDto[] = [];
    const offline: FriendDto[] = [];
    for (const f of filteredFriends) {
      if (presenceStore.isOnline(f.userId)) online.push(f);
      else offline.push(f);
    }
    return { onlineFriends: online, offlineFriends: offline };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFriends, presenceStore]);

  const filteredDiscoverResults = useMemo(() => {
    const q = discoverQuery.trim().replace(/^@/, '').toLowerCase();
    if (!q) return discoverResults;

    const hasExactWord = (haystack: string): boolean => {
      const words = haystack
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      return words.some((w) => w === q);
    };

    return discoverResults.filter((u) => {
      const fullHandle = (u.fullHandle || `${u.userHandle}@orbit`).replace(/^@/, '');
      return hasExactWord(fullHandle) || hasExactWord(u.displayName);
    });
  }, [discoverResults, discoverQuery]);

  const onlineCount = useMemo(
    () => friends.filter((f) => presenceStore.isOnline(f.userId)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [friends, presenceStore],
  );

  const handleRespondRequest = async (friendshipId: number, accept: boolean) => {
    try {
      await apiService.respondFriendRequest({ friendshipId, accept });
      await fetchFriendsAndPending();
    } catch (err) {
      alert(`Could not process request: ${extractErrorMessage(err)}`);
    }
  };

  const handleDiscoverAdd = useCallback(
    async (user: UserProfileDto) => {
      const handle = user.userHandle;
      if (!handle) return;

      setSentTo((prev) => new Set(prev).add(user.id));

      try {
        await apiService.sendFriendRequest({ targetIdentifier: handle });
        void fetchFriendsAndPending();
      } catch (err) {
        setSentTo((prev) => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
        alert(`Could not send request: ${extractErrorMessage(err)}`);
      }
    },
    [fetchFriendsAndPending],
  );

  const friendUserIds = useMemo(
    () => new Set(friends.map((f) => f.userId)),
    [friends],
  );

  return (
    <div className="h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* ── Hero header ─────────────────────────────────── */}
      <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-white/[0.05] shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold text-[#EDE5D4] tracking-tight">
                Friends
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#D97706]/[0.10] border border-[#D97706]/25 text-[10.5px] font-semibold text-[#D97706]">
                {friends.length}
              </span>
            </div>
            <p className="text-[12.5px] text-[#6B6259] mt-1 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                <span className="text-[#A8A29E]">
                  {onlineCount} online
                </span>
              </span>
              {pendingRequests.length > 0 && (
                <>
                  <span className="text-[#6B6259]/50">·</span>
                  <button
                    onClick={() => setActiveTab('pending')}
                    className="inline-flex items-center gap-1 text-[#D97706] hover:text-[#F59E0B] transition-colors"
                  >
                    <Zap className="w-3 h-3" />
                    {pendingRequests.length} pending
                  </button>
                </>
              )}
            </p>
          </div>

          <button
            onClick={() => setActiveTab('discover')}
            className="shrink-0 h-9 px-3.5 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Discover</span>
          </button>
        </div>
      </div>

      {/* ── Tabs + search ──────────────────────────────── */}
      <div className="px-4 sm:px-6 py-3 border-b border-white/[0.05] flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.05] w-fit">
          <button
            onClick={() => setActiveTab('all')}
            className={`h-7 px-3 rounded-lg text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-white/[0.08] text-[#EDE5D4]'
                : 'text-[#A8A29E] hover:text-[#EDE5D4]'
            }`}
          >
            <span>All</span>
            <span className="text-[10.5px] tabular-nums text-[#6B6259]">
              {friends.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('pending')}
            className={`h-7 px-3 rounded-lg text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
              activeTab === 'pending'
                ? 'bg-white/[0.08] text-[#EDE5D4]'
                : 'text-[#A8A29E] hover:text-[#EDE5D4]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Pending</span>
            {pendingRequests.length > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#D97706] text-[#0F0D0A] text-[10px] font-bold flex items-center justify-center tabular-nums">
                {pendingRequests.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('discover')}
            className={`h-7 px-3 rounded-lg text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
              activeTab === 'discover'
                ? 'bg-white/[0.08] text-[#EDE5D4]'
                : 'text-[#A8A29E] hover:text-[#EDE5D4]'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Discover</span>
          </button>
        </div>

        {activeTab === 'all' && friends.length > 0 && (
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0F0D0A] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors max-w-sm sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search friends…"
              className="flex-1 bg-transparent text-[12.5px] text-[#EDE5D4] placeholder-[#6B6259] outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-0.5 rounded text-[#6B6259] hover:text-[#EDE5D4]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        {loading && activeTab !== 'discover' ? (
          <div className="max-w-2xl mx-auto space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <FriendRowSkeleton key={i} />
            ))}
          </div>
        ) : activeTab === 'all' ? (
          friends.length === 0 ? (
            <EmptyState
              icon={<UserCheck className="w-7 h-7 text-[#6B6259]" />}
              title="No friends yet"
              subtitle="Head to Discover to find people by their @handle."
              action={
                <button
                  onClick={() => setActiveTab('discover')}
                  className="mt-5 h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
                >
                  <Compass className="w-4 h-4" />
                  <span>Discover people</span>
                </button>
              }
            />
          ) : filteredFriends.length === 0 ? (
            <EmptyState
              icon={<Search className="w-7 h-7 text-[#6B6259]" />}
              title="No matches"
              subtitle={`No friends matched "${searchQuery}".`}
            />
          ) : (
            <div className="max-w-2xl mx-auto">
              {/* Online section */}
              {onlineFriends.length > 0 && (
                <section>
                  <SectionHeader
                    label="Online"
                    count={onlineFriends.length}
                    color="bg-[#22C55E]"
                  />
                  <AnimatePresence initial={false}>
                    {onlineFriends.map((friend) => (
                      <FriendRow
                        key={friend.friendshipId}
                        friend={friend}
                        isOnline
                        onOpenProfile={setProfileModalUserId}
                        onMessage={(id) => navigate(`/app/dm/${id}`)}
                      />
                    ))}
                  </AnimatePresence>
                </section>
              )}

              {/* Offline section */}
              {offlineFriends.length > 0 && (
                <section className={onlineFriends.length > 0 ? 'mt-5' : ''}>
                  <SectionHeader
                    label="Offline"
                    count={offlineFriends.length}
                    color="bg-[#6B6259]"
                  />
                  <AnimatePresence initial={false}>
                    {offlineFriends.map((friend) => (
                      <FriendRow
                        key={friend.friendshipId}
                        friend={friend}
                        isOnline={false}
                        onOpenProfile={setProfileModalUserId}
                        onMessage={(id) => navigate(`/app/dm/${id}`)}
                      />
                    ))}
                  </AnimatePresence>
                </section>
              )}
            </div>
          )
        ) : activeTab === 'pending' ? (
          pendingRequests.length === 0 ? (
            <EmptyState
              icon={<Inbox className="w-7 h-7 text-[#6B6259]" />}
              title="No pending requests"
              subtitle="Incoming friend requests will appear here."
            />
          ) : (
            <div className="max-w-2xl mx-auto space-y-2">
              <AnimatePresence initial={false}>
                {pendingRequests.map((req) => (
                  <motion.div
                    key={req.friendshipId}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    className="bg-[#1A1816] border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3"
                  >
                    <Avatar
                      name={req.requesterDisplayName}
                      src={req.requesterAvatarUrl}
                      size="md"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-[#EDE5D4] truncate">
                        {req.requesterDisplayName}
                      </p>
                      <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5">
                        @{req.requesterHandle} · {relativeTime(req.sentAt)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => void handleRespondRequest(req.friendshipId, true)}
                        className="h-8 px-3 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12px] font-semibold inline-flex items-center gap-1 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Accept</span>
                      </button>
                      <button
                        onClick={() => void handleRespondRequest(req.friendshipId, false)}
                        className="h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-[#B91C1C]/[0.12] border border-white/[0.06] text-[#F87171] text-[12px] font-medium inline-flex items-center gap-1 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Decline</span>
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )
        ) : (
          /* ── Discover ────────────────────────────────── */
          <div className="max-w-2xl mx-auto">
            {/* Borderless search — underline only */}
            <div className="flex items-center gap-3 px-1 pb-3 border-b border-white/[0.06] focus-within:border-[#D97706]/50 transition-colors">
              <Search className="w-4 h-4 text-[#6B6259] shrink-0" />
              <input
                type="text"
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                placeholder="Search by @handle or name"
                autoFocus
                className="flex-1 bg-transparent text-[14px] text-[#EDE5D4] placeholder-[#6B6259] outline-none py-1"
              />
              {discoverQuery && (
                <button
                  onClick={() => setDiscoverQuery('')}
                  className="w-6 h-6 rounded-md hover:bg-white/[0.04] flex items-center justify-center text-[#6B6259] hover:text-[#EDE5D4] transition-colors"
                  aria-label="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Empty state — memory shelf + CTA */}
            {discoverQuery.trim().length < 2 && (
              <div>
                <MemoryShelf />

                <div className="my-8 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[#D97706]/[0.08] border border-[#D97706]/20 flex items-center justify-center">
                    <Compass className="w-5 h-5 text-[#D97706]" />
                  </div>
                  <h2 className="text-[22px] leading-tight text-[#EDE5D4] tracking-tight mt-4 font-semibold">
                    Find your people
                  </h2>
                  <p className="text-[12.5px] text-[#7A6F65] mt-1.5 max-w-xs">
                    Search by @handle or name to start connecting.
                  </p>
                </div>
              </div>
            )}

            {/* Loading */}
            {discoverQuery.trim().length >= 2 && discoverLoading && (
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <DiscoverCardSkeleton key={i} />
                ))}
              </div>
            )}

            {/* Error */}
            {discoverQuery.trim().length >= 2 && !discoverLoading && discoverError && (
              <div className="mt-4 p-4 rounded-xl bg-[#B91C1C]/[0.08] border border-[#B91C1C]/25 text-[12.5px] text-[#F87171] flex items-center gap-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{discoverError}</span>
              </div>
            )}

            {/* No results */}
            {discoverQuery.trim().length >= 2 &&
              !discoverLoading &&
              !discoverError &&
              filteredDiscoverResults.length === 0 && (
                <div className="mt-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
                    <Search className="w-6 h-6 text-[#6B6259]" />
                  </div>
                  <p className="text-[13px] text-[#7A6F65] mt-4">
                    No one found for &ldquo;{discoverQuery}&rdquo;
                  </p>
                </div>
              )}

            {/* Results */}
            {discoverQuery.trim().length >= 2 &&
              !discoverLoading &&
              !discoverError &&
              filteredDiscoverResults.length > 0 && (
                <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <AnimatePresence initial={false}>
                    {filteredDiscoverResults.map((user) => (
                      <DiscoverCard
                        key={user.id}
                        user={user}
                        isFriend={friendUserIds.has(user.id)}
                        sent={sentTo.has(user.id)}
                        onOpenProfile={setProfileModalUserId}
                        onMessage={(id) => navigate(`/app/dm/${id}`)}
                        onAdd={handleDiscoverAdd}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
          </div>
        )}
      </div>

      <UserProfileModal
        userId={profileModalUserId}
        onClose={() => setProfileModalUserId(null)}
      />
    </div>
  );
}

export default FriendsPane;