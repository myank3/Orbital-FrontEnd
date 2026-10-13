/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiService, extractErrorMessage } from '../services/api';
import { FriendDto, PendingFriendRequestDto, UserProfileDto } from '../types/api';
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
} from 'lucide-react';

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
    return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

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

  // Match if any word in the handle or display name STARTS WITH the query.
  // "ma" matches "mayank" but not "isharma" (buried mid-word).
    // Exact word match — the query must equal a whole word in the handle
  // or display name. "may" does NOT match "mayank". "mayank" does.
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
      const fullHandle = (
        u.fullHandle || `${u.userHandle}@orbit`
      ).replace(/^@/, '');
      return (
        hasExactWord(fullHandle) ||
        hasExactWord(u.displayName)
      );
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
      {/* Header */}
      <div className="h-16 px-4 sm:px-6 border-b border-white/[0.05] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#D97706]/20 to-[#D97706]/5 border border-[#D97706]/25 flex items-center justify-center text-[#D97706] shrink-0">
            <Users className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15.5px] font-semibold text-[#EDE5D4] tracking-tight truncate">
              Friends
            </h2>
            <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5 flex items-center gap-1.5">
              <span>
                {friends.length} friend{friends.length === 1 ? '' : 's'}
              </span>
              {onlineCount > 0 && (
                <>
                  <span className="text-[#6B6259]/60">·</span>
                  <span className="inline-flex items-center gap-1 text-[#22C55E]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                    {onlineCount} online
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="px-4 sm:px-6 py-3 border-b border-white/[0.05] flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`h-8 px-3 rounded-lg text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-white/[0.06] text-[#EDE5D4] border border-white/[0.08]'
                : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.035] border border-transparent'
            }`}
          >
            <span>All</span>
            <span className="text-[11px] tabular-nums text-[#6B6259]">
              {friends.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('pending')}
            className={`h-8 px-3 rounded-lg text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
              activeTab === 'pending'
                ? 'bg-white/[0.06] text-[#EDE5D4] border border-white/[0.08]'
                : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.035] border border-transparent'
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
            className={`h-8 px-3 rounded-lg text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 ${
              activeTab === 'discover'
                ? 'bg-white/[0.06] text-[#EDE5D4] border border-white/[0.08]'
                : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.035] border border-transparent'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Discover</span>
          </button>
        </div>

        {activeTab === 'all' && friends.length > 0 && (
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0F0D0A] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors max-w-sm sm:ml-auto">
            <Search className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search friends by @handle or name..."
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading && activeTab !== 'discover' ? (
          <div className="h-40 flex items-center justify-center text-[12.5px] text-[#6B6259]">
            <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#D97706]" />
            Loading contacts…
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AnimatePresence initial={false}>
                {filteredFriends.map((friend) => {
                  const isOnline = presenceStore.isOnline(friend.userId);
                  return (
                    <motion.div
                      key={friend.friendshipId}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                      className="group bg-[#1A1816] border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3 hover:border-white/[0.12] hover:bg-[#1E1C19] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => setProfileModalUserId(friend.userId)}
                        className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50 transition-transform group-hover:scale-[1.03]"
                        aria-label={`View ${friend.displayName}'s profile`}
                      >
                        <Avatar
                          name={friend.displayName}
                          src={friend.avatarUrl}
                          size="md"
                          isOnline={isOnline}
                        />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[13.5px] font-semibold text-[#EDE5D4] truncate">
                            {friend.displayName}
                          </p>
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                              isOnline ? 'bg-[#22C55E]' : 'bg-[#6B6259]'
                            }`}
                            title={isOnline ? 'Online' : 'Offline'}
                          />
                        </div>
                        <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5">
                          @{friend.handle}
                        </p>
                      </div>

                      <button
                        onClick={() => navigate(`/app/dm/${friend.userId}`)}
                        className="shrink-0 h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-[#D97706] border border-white/[0.06] hover:border-[#D97706] text-[12px] font-medium text-[#EDE5D4] hover:text-[#0F0D0A] inline-flex items-center gap-1.5 transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Message</span>
                      </button>
                    </motion.div>
                  );
                })}
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
            <div className="space-y-2">
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
                subtitle="Type at least 2 characters. Matches word start of @handle or display name."
              />
            )}

            {discoverQuery.trim().length >= 2 && discoverLoading && (
              <div className="mt-12 flex items-center justify-center text-[12.5px] text-[#6B6259]">
                <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#D97706]" />
                Searching…
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
                    {filteredDiscoverResults.map((user) => {
                      const isFriend = friendUserIds.has(user.id);
                      const sent = sentTo.has(user.id);
                      return (
                        <motion.div
                          key={user.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                          className="bg-[#1A1816] border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3 hover:border-white/[0.12] transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => setProfileModalUserId(user.id)}
                            className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50"
                            aria-label={`View ${user.displayName}'s profile`}
                          >
                            <Avatar name={user.displayName} src={user.avatarUrl} size="md" />
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] font-semibold text-[#EDE5D4] truncate">
                              {user.displayName}
                            </p>
                            <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5">
                              @{user.userHandle}
                            </p>
                          </div>

                          {isFriend ? (
                            <button
                              onClick={() => navigate(`/app/dm/${user.id}`)}
                              className="shrink-0 h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[12px] font-medium text-[#EDE5D4] inline-flex items-center gap-1.5 transition-colors"
                            >
                              <MessageSquare className="w-3.5 h-3.5 text-[#D97706]" />
                              <span>Message</span>
                            </button>
                          ) : sent ? (
                            <span className="shrink-0 h-8 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] font-medium text-[#6B6259] inline-flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#4ADE80]" />
                              <span>Sent</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => void handleDiscoverAdd(user)}
                              className="shrink-0 h-8 px-3 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>Add</span>
                            </button>
                          )}
                        </motion.div>
                      );
                    })}
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

export default FriendsPane;