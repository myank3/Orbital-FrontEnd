/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone,
  Video as VideoIcon,
  Search,
  Loader2,
  PhoneCall,
  UserPlus,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { apiService, extractErrorMessage } from '../services/api';
import { FriendDto } from '../types/api';
import { presenceStore } from '../services/presenceStore';
import { useCall } from '../context/CallContext';
import { CallLogEntry, getCallLog, deleteCallLogEntry } from '../services/callLog';

/* ────────────────────────────────────────────────────────── */
/* Helpers                                                    */
/* ────────────────────────────────────────────────────────── */

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today.getTime() - that.getTime()) / 86_400_000);

    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return time;
    if (diffDays === 1) return `Yesterday · ${time}`;
    if (diffDays < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} · ${time}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` · ${time}`;
  } catch {
    return '';
  }
}

/* ────────────────────────────────────────────────────────── */
/* Calls pane                                                 */
/* ────────────────────────────────────────────────────────── */

function CallsPane(): React.JSX.Element {
  const navigate = useNavigate();
  const { initiateCall, session: activeSession, incomingCall } = useCall();

  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyPeerId, setBusyPeerId] = useState<string | null>(null);

  /* Silent call log — read from local storage. Never surfaced as "history". */
  const [log, setLog] = useState<CallLogEntry[]>(() => getCallLog());
  const [profileCache, setProfileCache] = useState<
    Record<string, { name: string; avatar: string | null }>
  >({});

  // Live presence
  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => unsub();
  }, []);

  // Load friends
  useEffect(() => {
    let active = true;
    setLoading(true);
    apiService
      .getFriends()
      .then((data) => {
        if (active) setFriends(data);
      })
      .catch((err) => {
        if (active) setError(extractErrorMessage(err, 'Failed to load friends.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Reload log on updates
  useEffect(() => {
    const reload = () => setLog(getCallLog());
    window.addEventListener('callLog:updated', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('callLog:updated', reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  // Resolve placeholder peer names for log entries
  useEffect(() => {
    if (log.length === 0) return;
    const missing = log.filter(
      (e) => e.peerName === 'Peer' && e.peerId && !profileCache[e.peerId],
    );
    if (missing.length === 0) return;
    let cancelled = false;
    missing.forEach((entry) => {
      apiService
        .getUserProfile(entry.peerId)
        .then((p) => {
          if (cancelled) return;
          setProfileCache((prev) => ({
            ...prev,
            [entry.peerId]: {
              name: p.displayName || p.userHandle || 'Peer',
              avatar: p.avatarUrl,
            },
          }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [log, profileCache]);

  const callBusy = Boolean(activeSession) || Boolean(incomingCall);

  const filteredFriends = useMemo(() => {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        f.handle.toLowerCase().includes(q),
    );
  }, [friends, query]);

  const recentCalls = useMemo(() => log.slice(0, 6), [log]);

  const handleCall = async (peerId: string, callType: number) => {
    if (callBusy) {
      setError('You are already in a call.');
      return;
    }
    setBusyPeerId(peerId);
    setError(null);
    try {
      await initiateCall(peerId, callType);
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not start call.'));
    } finally {
      setBusyPeerId(null);
    }
  };

  const resolveName = (entry: CallLogEntry) =>
    profileCache[entry.peerId]?.name ?? entry.peerName;
  const resolveAvatar = (entry: CallLogEntry) =>
    profileCache[entry.peerId]?.avatar ?? entry.peerAvatarUrl ?? undefined;

  return (
    <div className="h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* Header */}
      <div className="h-16 px-4 sm:px-6 border-b border-white/[0.05] flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#D97706] shrink-0">
          <PhoneCall className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] sm:text-[15.5px] font-semibold text-[#EDE5D4] tracking-tight truncate">
            Calls
          </h2>
          <p className="text-[11px] sm:text-[11.5px] text-[#6B6259] truncate mt-0.5">
            {friends.length} friend{friends.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Search */}
      {friends.length > 0 && (
        <div className="px-4 sm:px-6 py-3 border-b border-white/[0.05] shrink-0">
          <div className="max-w-md flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0F0D0A] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors">
            <Search className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search friends by @handle or name..."
              className="flex-1 bg-transparent text-[12.5px] text-[#EDE5D4] placeholder-[#6B6259] outline-none"
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 sm:mx-6 mt-3 p-3 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-[12px] text-[#F87171]">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {/* Silent recent strip — no label, no explainer, only if there's data */}
        {recentCalls.length > 0 && (
          <div className="mb-6">
            <div className="space-y-0.5">
              {recentCalls.map((entry) => {
                const name = resolveName(entry);
                const avatar = resolveAvatar(entry);
                const isMissed =
                  entry.outcome === 'missed' || entry.outcome === 'declined';
                const isOutgoing = entry.direction === 'outgoing';
                const isVideo = entry.callType === 1;
                const DirectionIcon = isMissed
                  ? PhoneMissed
                  : isOutgoing
                  ? PhoneOutgoing
                  : PhoneIncoming;
                const iconColor = isMissed ? 'text-[#F87171]' : 'text-[#6B6259]';

                return (
                  <div
                    key={entry.id}
                    className="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.035] transition-colors"
                  >
                    <button
                      onClick={() => navigate(`/app/dm/${entry.peerId}`)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                    >
                      <Avatar name={name} src={avatar} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <DirectionIcon className={`w-3 h-3 shrink-0 ${iconColor}`} />
                          <p
                            className={`text-[12.5px] font-medium truncate ${
                              isMissed ? 'text-[#F87171]' : 'text-[#EDE5D4]'
                            }`}
                          >
                            {name}
                          </p>
                        </div>
                        <p className="text-[10.5px] text-[#6B6259] truncate mt-0.5">
                          {formatWhen(entry.startedAt)}
                          {entry.durationSeconds > 0
                            ? ` · ${formatDuration(entry.durationSeconds)}`
                            : ''}
                          {isVideo ? ' · Video' : ''}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => void handleCall(entry.peerId, 0)}
                        disabled={callBusy}
                        className="p-1.5 rounded-md text-[#6B6259] hover:text-[#D97706] hover:bg-[#D97706]/[0.10] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                        title="Call again"
                      >
                        <Phone className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => void handleCall(entry.peerId, 1)}
                        disabled={callBusy}
                        className="p-1.5 rounded-md text-[#6B6259] hover:text-[#D97706] hover:bg-[#D97706]/[0.10] disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                        title="Video call again"
                      >
                        <VideoIcon className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteCallLogEntry(entry.id)}
                        className="p-1.5 rounded-md text-[#6B6259] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.10] transition-colors"
                        title="Remove"
                      >
                        <span className="text-[12px] leading-none">×</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 mb-5 h-px bg-white/[0.04]" />
          </div>
        )}

        {/* Friends list */}
        {loading ? (
          <div className="h-40 flex items-center justify-center text-[12.5px] text-[#6B6259]">
            <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#D97706]" />
            Loading friends…
          </div>
        ) : friends.length === 0 ? (
          <div className="max-w-md mx-auto mt-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
              <UserPlus className="w-7 h-7 text-[#6B6259]" />
            </div>
            <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight mt-4">
              No friends to call
            </p>
            <p className="text-[12.5px] text-[#6B6259] mt-1 leading-relaxed max-w-sm mx-auto">
              Add friends first, then come back here to call them.
            </p>
            <button
              onClick={() => navigate('/app/friends')}
              className="mt-5 h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add friends</span>
            </button>
          </div>
        ) : filteredFriends.length === 0 ? (
          <div className="max-w-md mx-auto mt-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
              <Search className="w-7 h-7 text-[#6B6259]" />
            </div>
            <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight mt-4">
              No matches
            </p>
            <p className="text-[12.5px] text-[#6B6259] mt-1">
              No friends matched &ldquo;{query}&rdquo;.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredFriends.map((friend) => {
              const isOnline = presenceStore.isOnline(friend.userId);
              const isBusy = busyPeerId === friend.userId;

              return (
                <div
                  key={friend.friendshipId}
                  className="bg-[#1A1816] border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3 hover:border-white/[0.12] transition-colors"
                >
                  <Avatar
                    name={friend.displayName}
                    src={friend.avatarUrl}
                    size="md"
                    isOnline={isOnline}
                  />

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

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => void handleCall(friend.userId, 0)}
                      disabled={callBusy || isBusy}
                      className="h-8 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed border border-white/[0.06] text-[12px] font-medium text-[#EDE5D4] inline-flex items-center gap-1.5 transition-colors"
                      title="Audio call"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Phone className="w-3.5 h-3.5 text-[#D97706]" />
                      )}
                      <span className="hidden sm:inline">Audio</span>
                    </button>

                    <button
                      onClick={() => void handleCall(friend.userId, 1)}
                      disabled={callBusy || isBusy}
                      className="h-8 px-3 rounded-lg bg-[#D97706] hover:bg-[#B45309] disabled:opacity-40 disabled:cursor-not-allowed text-[#0F0D0A] text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors"
                      title="Video call"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <VideoIcon className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">Video</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default CallsPane;