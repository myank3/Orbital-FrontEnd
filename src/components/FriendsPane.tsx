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
  Loader2,
  AlertCircle,
  CheckCircle2,
  Search,
  Users,
  Inbox,
  Compass,
  Sparkles,
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

/* ────────────────────────────────────────────────────────── */
/* Skeleton card for loading state                            */
/* ────────────────────────────────────────────────────────── */

function FriendCardSkeleton() {
  return (
    <div className="rounded-2xl bg-[#1A1816] border border-white/[0.06] overflow-hidden">
      <div className="h-20 bg-gradient-to-br from-white/[0.04] to-transparent" />
      <div className="px-4 pb-4 -mt-8">
        <div className="w-16 h-16 rounded-full bg-white/[0.06] border-4 border-[#1A1816] animate-pulse" />
        <div className="mt-3 h-3.5 w-24 rounded bg-white/[0.06] animate-pulse" />
        <div className="mt-2 h-2.5 w-16 rounded bg-white/[0.04] animate-pulse" />
        <div className="mt-4 h-8 w-full rounded-lg bg-white/[0.05] animate-pulse" />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Friend card (Instagram-ish)                                */
/* ────────────────────────────────────────────────────────── */

interface FriendCardProps {
  friend: FriendDto;
  isOnline: boolean;
  onOpenProfile: (id: string) => void;
  onMessage: (id: string) => void;
}

function FriendCard({ friend, isOnline, onOpenProfile, onMessage }: FriendCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="group relative rounded-2xl bg-[#1A1816] border border-white/[0.06] hover:border-white/[0.14] overflow-hidden transition-colors"
    >
      {/* Cover strip — subtle gradient band */}
      <div className="h-20 bg-gradient-to-br from-[#D97706]/[0.10] via-[#D97706]/[0.03] to-transparent relative">
        {isOnline && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#15803D]/20 border border-[#22C55E]/30 text-[10px] font-semibold text-[#4ADE80]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
            Online
          </span>
        )}
      </div>

      {/* Avatar with gradient ring */}
      <button
        type="button"
        onClick={() => onOpenProfile(friend.userId)}
        className="absolute top-8 left-4 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/60"
        aria-label={`View ${friend.displayName}'s profile`}
      >
        <span
          className={`block p-[3px] rounded-full ${
            isOnline
              ? 'bg-gradient-to-tr from-[#22C55E] via-[#D97706] to-[#4ADE80]'
              : 'bg-gradient-to-tr from-white/[0.10] to-white/[0.02]'
          }`}
        >
          <span className="block p-[2px] rounded-full bg-[#1A1816]">
            <Avatar name={friend.displayName} src={friend.avatarUrl} size="lg" />
          </span>
        </span>
      </button>

      {/* Card body */}
      <div className="px-4 pt-10 pb-4">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#EDE5D4] truncate tracking-tight">
            {friend.displayName}
          </p>
          <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5">
            @{friend.handle}
          </p>
        </div>

        {/* Stat chips */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.05] text-[10.5px] text-[#A8A29E]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isOnline ? 'bg-[#22C55E]' : 'bg-[#6B6259]'
              }`}
            />
            {isOnline ? 'Active now' : 'Offline'}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.05] text-[10.5px] text-[#A8A29E]">
            <Clock className="w-3 h-3" />
            {relativeTime(friend.establishedAt)}
          </span>
        </div>

        {/* Message CTA — appears on hover, always tappable */}
        <button
          onClick={() => onMessage(friend.userId)}
          className="mt-4 w-full h-9 rounded-xl bg-white/[0.04] hover:bg-[#D97706] border border-white/[0.06] hover:border-[#D97706] text-[12.5px] font-medium text-[#EDE5D4] hover:text-[#0F0D0A] inline-flex items-center justify-center gap-1.5 transition-all"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Message</span>
        </button>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Discover result row                                        */
/* ────────────────────────────────────────────────────────── */

interface DiscoverRowProps {
  user: UserProfileDto;
  isFriend: boolean;
  sent: boolean;
  onOpenProfile: (id: string) => void;
  onMessage: (id: string) => void;
  onAdd: (u: UserProfileDto) => void;
}

function DiscoverRow({
  user,
  isFriend,
  sent,
  onOpenProfile,
  onMessage,
  onAdd,
}: DiscoverRowProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="group relative rounded-2xl bg-[#1A1816] border border-white/[0.06] hover:border-white/[0.14] p-3.5 flex items-center gap-3.5 transition-colors"
    >
      <button
        type="button"
        onClick={() => onOpenProfile(user.id)}
        className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50 transition-transform group-hover:scale-[1.03]"
        aria-label={`View ${user.displayName}'s profile`}
      >
        <span className="block p-[2.5px] rounded-full bg-gradient-to-tr from-[#D97706]/40 to-[#D97706]/[0.05]">
          <span className="block p-[2px] rounded-full bg-[#1A1816]">
            <Avatar name={user.displayName} src={user.avatarUrl} size="md" />
          </span>
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-[#EDE5D4] truncate tracking-tight">
          {user.displayName}
        </p>
        <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5">
          @{user.userHandle}
        </p>
      </div>

      {isFriend ? (
        <button
          onClick={() => onMessage(user.id)}
          className="shrink-0 h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-[#D97706] border border-white/[0.06] hover:border-[#D97706] text-[12px] font-medium text-[#EDE5D4] hover:text-[#0F0D0A] inline-flex items-center gap-1.5 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Message</span>
        </button>
      ) : sent ? (
        <span className="shrink-0 h-8 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] font-medium text-[#6B6259] inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#4ADE80]" />
          <span>Sent</span>
        </span>
      ) : (
        <button
          onClick={() => onAdd(user)}
          className="shrink-0 h-8 px-3 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Add</span>
        </button>
      )}
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

  // Exact-word match. "may" does NOT match "mayank". "mayank" does.
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
                <Sparkles className="w-3 h-3" />
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
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <FriendCardSkeleton key={i} />
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <AnimatePresence initial={false}>
                {filteredFriends.map((friend) => (
                  <FriendCard
                    key={friend.friendshipId}
                    friend={friend}
                    isOnline={presenceStore.isOnline(friend.userId)}
                    onOpenProfile={setProfileModalUserId}
                    onMessage={(id) => navigate(`/app/dm/${id}`)}
                  />
                ))}
              </AnimatePresence>
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
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#0F0D0A] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors">
              <Search className="w-4 h-4 text-[#6B6259] shrink-0" />
              <input
                type="text"
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                placeholder="Search people by @handle or name..."
                autoFocus
                className="flex-1 bg-transparent text-[13.5px] text-[#EDE5D4] placeholder-[#6B6259] outline-none"
              />
              {discoverQuery && (
                <button
                  onClick={() => setDiscoverQuery('')}
                  className="p-0.5 rounded text-[#6B6259] hover:text-[#EDE5D4]"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {discoverQuery.trim().length < 2 && (
              <EmptyState
                icon={<Compass className="w-7 h-7 text-[#6B6259]" />}
                title="Discover people"
                subtitle="Type at least 2 characters. Matches the start of a @handle or display name."
              />
            )}

            {discoverQuery.trim().length >= 2 && discoverLoading && (
              <div className="mt-6 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[72px] rounded-2xl bg-[#1A1816] border border-white/[0.06] animate-pulse"
                  />
                ))}
              </div>
            )}

            {discoverQuery.trim().length >= 2 && !discoverLoading && discoverError && (
              <div className="mt-8 p-4 rounded-xl bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-[12.5px] text-[#F87171] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{discoverError}</span>
              </div>
            )}

            {discoverQuery.trim().length >= 2 &&
              !discoverLoading &&
              !discoverError &&
              filteredDiscoverResults.length === 0 && (
                <EmptyState
                  icon={<Search className="w-7 h-7 text-[#6B6259]" />}
                  title="No users found"
                  subtitle={`No one matched "${discoverQuery}".`}
                />
              )}

            {discoverQuery.trim().length >= 2 &&
              !discoverLoading &&
              !discoverError &&
              filteredDiscoverResults.length > 0 && (
                <div className="mt-4 space-y-2">
                  <AnimatePresence initial={false}>
                    {filteredDiscoverResults.map((user) => (
                      <DiscoverRow
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