/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiService, extractErrorMessage } from '../services/api';
import { FriendDto, PendingFriendRequestDto } from '../types/api';
import { presenceStore } from '../services/presenceStore';
import { Avatar } from './Avatar';
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
} from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Helpers                                                    */
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
    return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/* ────────────────────────────────────────────────────────── */
/* Main pane                                                  */
/* ────────────────────────────────────────────────────────── */

function FriendsPane(): React.JSX.Element {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingFriendRequestDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [targetHandle, setTargetHandle] = useState<string>('');
  const [addLoading, setAddLoading] = useState<boolean>(false);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Re-render trigger when the shared presence store changes.
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

  // Subscribe to the shared presence store once.
  useEffect(() => {
    const unsub = presenceStore.subscribe(() => {
      setPresenceTick((v) => v + 1);
    });
    return () => {
      unsub();
    };
  }, []);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().replace(/^@/, '').toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        f.handle.toLowerCase().includes(q),
    );
  }, [friends, searchQuery]);

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

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const handleClean = targetHandle.trim().replace(/^@/, '').replace(/@orbit$/, '');
    if (!handleClean) {
      setAddError('Please enter a valid handle.');
      return;
    }

    setAddLoading(true);
    setAddError(null);
    setAddSuccess(null);

    try {
      const res = await apiService.sendFriendRequest({ targetIdentifier: handleClean });
      setAddSuccess(res.message || `Friend request dispatched to @${handleClean}.`);
      setTargetHandle('');
      void fetchFriendsAndPending();
    } catch (err) {
      setAddError(extractErrorMessage(err));
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* ─── Header ───────────────────────────────────── */}
      <div className="h-16 px-4 sm:px-6 border-b border-white/[0.05] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#D97706] shrink-0">
            <Users className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] sm:text-[15.5px] font-semibold text-[#EDE5D4] tracking-tight truncate">
              Friends
            </h2>
            <p className="text-[11px] sm:text-[11.5px] text-[#6B6259] truncate mt-0.5">
              {friends.length} friend{friends.length === 1 ? '' : 's'}
              {onlineCount > 0 ? ` · ${onlineCount} online` : ''}
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            setAddModalOpen(true);
            setAddSuccess(null);
            setAddError(null);
          }}
          className="h-9 px-3 sm:px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Friend</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* ─── Tabs + search ────────────────────────────── */}
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

      {/* ─── Content ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-[12.5px] text-[#6B6259]">
            <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#D97706]" />
            Loading contacts…
          </div>
        ) : activeTab === 'all' ? (
          friends.length === 0 ? (
            /* Empty: no friends */
            <div className="max-w-md mx-auto mt-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
                <UserCheck className="w-7 h-7 text-[#6B6259]" />
              </div>
              <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight mt-4">
                No friends yet
              </p>
              <p className="text-[12.5px] text-[#6B6259] mt-1 leading-relaxed">
                Connect with people by clicking <span className="text-[#EDE5D4]">Add Friend</span> and entering their handle.
              </p>
              <button
                onClick={() => setAddModalOpen(true)}
                className="mt-5 h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Friend</span>
              </button>
            </div>
          ) : filteredFriends.length === 0 ? (
            /* Empty: search returned nothing */
            <div className="max-w-md mx-auto mt-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
                <Search className="w-7 h-7 text-[#6B6259]" />
              </div>
              <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight mt-4">
                No matches
              </p>
              <p className="text-[12.5px] text-[#6B6259] mt-1">
                No friends matched &ldquo;{searchQuery}&rdquo;.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredFriends.map((friend) => {
                const isOnline = presenceStore.isOnline(friend.userId);
                return (
                  <div
                    key={friend.friendshipId}
                    className="bg-[#1A1816] border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3 hover:border-white/[0.12] transition-colors"
                  >
                    <div className="shrink-0">
                      <Avatar
                        name={friend.displayName}
                        src={friend.avatarUrl}
                        size="md"
                        isOnline={isOnline}
                      />
                    </div>

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
                      className="shrink-0 h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[12px] font-medium text-[#EDE5D4] inline-flex items-center gap-1.5 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#D97706]" />
                      <span>Message</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : pendingRequests.length === 0 ? (
          /* Empty: no pending */
          <div className="max-w-md mx-auto mt-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
              <Inbox className="w-7 h-7 text-[#6B6259]" />
            </div>
            <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight mt-4">
              No pending requests
            </p>
            <p className="text-[12.5px] text-[#6B6259] mt-1 leading-relaxed">
              Incoming friend requests will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingRequests.map((req) => (
              <div
                key={req.friendshipId}
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
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Add Friend modal ─────────────────────────── */}
      <AnimatePresence>
        {addModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setAddModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden"
            >
              <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#D97706] shrink-0">
                    <UserPlus className="w-[18px] h-[18px]" />
                  </div>
                  <div>
                    <p className="text-[14.5px] font-semibold text-[#EDE5D4] tracking-tight">
                      Add Friend
                    </p>
                    <p className="text-[11.5px] text-[#6B6259] mt-0.5">
                      Send a request by handle
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setAddModalOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSendFriendRequest} className="p-5 space-y-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-[0.16em] text-[#6B6259] font-medium mb-2">
                    Target Handle
                  </label>
                  <div className="h-10 w-full rounded-lg bg-[#0F0D0A] px-3.5 flex items-center border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors">
                    <span className="text-[12.5px] text-[#6B6259] select-none mr-1">@</span>
                    <input
                      type="text"
                      value={targetHandle}
                      onChange={(e) => setTargetHandle(e.target.value)}
                      placeholder="elena_rostova"
                      className="flex-1 bg-transparent border-none outline-none text-[12.5px] text-[#EDE5D4] placeholder-[#6B6259]"
                      autoFocus
                      required
                    />
                    <span className="text-[11.5px] font-mono text-[#6B6259] select-none">
                      @orbit
                    </span>
                  </div>
                </div>

                {addError && (
                  <div className="p-3 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-[12px] text-[#F87171] flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{addError}</span>
                  </div>
                )}

                {addSuccess && (
                  <div className="p-3 rounded-lg bg-[#15803D]/10 border border-[#15803D]/20 text-[12px] text-[#4ADE80] flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{addSuccess}</span>
                  </div>
                )}

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAddModalOpen(false)}
                    className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={addLoading}
                    className="h-9 px-4 rounded-lg bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    {addLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Send Request</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default FriendsPane;