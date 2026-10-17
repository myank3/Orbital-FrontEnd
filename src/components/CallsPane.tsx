/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone,
  Video as VideoIcon,
  Search,
  Loader2,
  PhoneCall,
  UserPlus,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from './Avatar';
import { apiService, extractErrorMessage } from '../services/api';
import { FriendDto } from '../types/api';
import { presenceStore } from '../services/presenceStore';
import { useCall, type CallState } from '../context/CallContext';
import { useAuth } from '../context/AuthContext';

/* ────────────────────────────────────────────────────────── */
/* WhatsApp-style call timer pill                             */
/* ────────────────────────────────────────────────────────── */

function CallTimerPill({ callState, duration }: { callState: CallState; duration: number }) {
  if (callState !== 'active') return null;
  const m = Math.floor(duration / 60).toString().padStart(2, '0');
  const s = Math.floor(duration % 60).toString().padStart(2, '0');
  return (
    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#22C55E] text-white shadow-[0_8px_24px_-6px_rgba(34,197,94,0.6)]">
      <PhoneCall className="w-3.5 h-3.5" />
      <span className="text-[12.5px] font-semibold tabular-nums">{m}:{s}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Custom toast: offline call warning                         */
/* ────────────────────────────────────────────────────────── */

interface OfflineCallToastProps {
  name: string;
  avatarUrl?: string | null;
  type: 'audio' | 'video';
  onDismiss: () => void;
}

function OfflineCallToast({ name, avatarUrl, type, onDismiss }: OfflineCallToastProps) {
  const Icon = type === 'video' ? VideoIcon : Phone;
  return (
    <div className="w-[320px] rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-2xl overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <div className="shrink-0">
          <Avatar name={name} src={avatarUrl} size="md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[#F87171]">
            <Icon className="w-3.5 h-3.5" />
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {type === 'video' ? 'Video call' : 'Audio call'}
            </span>
          </div>
          <p className="text-[13.5px] font-semibold text-[#EDE5D4] truncate mt-0.5">
            {name} is offline
          </p>
          <p className="text-[12px] text-[#A8A29E] mt-0.5 leading-snug">
            You can still send them a message.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 w-6 h-6 -mr-1 -mt-1 rounded-md flex items-center justify-center text-[#6B6259] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="h-[3px] bg-gradient-to-r from-[#D97706] via-[#F59E0B] to-transparent" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Local Call History Storage (Cookie/LS based)               */
/* ────────────────────────────────────────────────────────── */

type LocalCallLog = {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar?: string | null;
  type: 'audio' | 'video';
  direction: 'outgoing' | 'incoming';
  status: 'answered' | 'missed';
  durationSec: number;
  timestamp: number;
};

function getHistoryKey(userId?: string) {
  return `orbital.localCallHistory.${userId ?? 'anon'}`;
}

function loadLocalHistory(userId?: string): LocalCallLog[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getHistoryKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(userId: string | undefined, logs: LocalCallLog[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getHistoryKey(userId), JSON.stringify(logs.slice(0, 50))); // keep last 50
  } catch {
    /* quota */
  }
}

/* ────────────────────────────────────────────────────────── */
/* Calls pane                                                 */
/* ────────────────────────────────────────────────────────── */

function CallsPane(): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { initiateCall, session: activeSession, incomingCall, callState, duration } = useCall();

  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyPeerId, setBusyPeerId] = useState<string | null>(null);

  // Local call history state
  const [history, setHistory] = useState<LocalCallLog[]>(() => loadLocalHistory(user?.id));

  // Track the active call to log it when it ends
  const pendingCallRef = useRef<{
    peerId: string;
    peerName: string;
    peerAvatar?: string | null;
    type: 'audio' | 'video';
    direction: 'outgoing' | 'incoming';
    startedAt: number;
  } | null>(null);

  // Live presence
  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => unsub();
  }, []);

  // Sync history when user changes
  useEffect(() => {
    setHistory(loadLocalHistory(user?.id));
  }, [user?.id]);

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
        if (active) {
          toast.error(extractErrorMessage(err, 'Failed to load friends.'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Watch call state to start/end logging
  useEffect(() => {
    const isInCall = Boolean(activeSession || incomingCall || callState !== 'idle');

    if (isInCall && !pendingCallRef.current) {
      // Call started
      const peerId = activeSession?.peerId || incomingCall?.initiatorId;
      const isOutgoing = Boolean(activeSession) || callState === 'outgoing';

      if (peerId) {
        const friend = friends.find((f) => f.userId === peerId);
        pendingCallRef.current = {
          peerId,
          peerName: friend?.displayName || 'Unknown',
          peerAvatar: friend?.avatarUrl,
          type: activeSession?.callType === 1 ? 'video' : 'audio',
          direction: isOutgoing ? 'outgoing' : 'incoming',
          startedAt: Date.now(),
        };
      }
    } else if (!isInCall && pendingCallRef.current) {
      // Call ended
      const pending = pendingCallRef.current;
      pendingCallRef.current = null;

      // Only log if we actually connected (assume > 1 second is a real answer)
      const durationSec = Math.max(0, Math.round((Date.now() - pending.startedAt) / 1000));

      if (durationSec > 1) {
        const newLog: LocalCallLog = {
          id: `${Date.now()}-${Math.random()}`,
          peerId: pending.peerId,
          peerName: pending.peerName,
          peerAvatar: pending.peerAvatar,
          type: pending.type,
          direction: pending.direction,
          status: 'answered',
          durationSec,
          timestamp: Date.now(),
        };

        setHistory((prev) => {
          const updated = [newLog, ...prev];
          saveLocalHistory(user?.id, updated);
          return updated;
        });
      }
    }
  }, [activeSession, incomingCall, callState, friends, user?.id]);

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

  const handleCall = async (
    peerId: string,
    callType: number,
    peerName?: string,
    peerAvatar?: string | null,
  ) => {
    if (callBusy) {
      toast.error('You are already in a call.');
      return;
    }
    if (!presenceStore.isOnline(peerId)) {
      toast.custom(
        (t) => (
          <OfflineCallToast
            name={peerName ?? 'This friend'}
            avatarUrl={peerAvatar}
            type={callType === 1 ? 'video' : 'audio'}
            onDismiss={() => toast.dismiss(t)}
          />
        ),
        { duration: 5000 },
      );
      return;
    }
    setBusyPeerId(peerId);
    try {
      await initiateCall(peerId, callType);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Could not start call.'));
      // Clear the pending ref if initiation fails immediately
      pendingCallRef.current = null;
    } finally {
      setBusyPeerId(null);
    }
  };

  // Format duration (e.g. 1:24)
  const formatDur = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Format time for history list
  const formatWhen = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="h-full flex flex-col bg-[#0B0A08] text-[#EDE5D4] overflow-hidden relative">
      {callState === 'active' && (
        <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 z-30">
          <CallTimerPill callState={callState} duration={duration} />
        </div>
      )}

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

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* Call History Section */}
        {history.length > 0 && (
          <div className="px-4 sm:px-6 py-4 border-b border-white/[0.05]">
            <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[#6B6259] mb-3 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Recent Calls
            </h3>
            <div className="space-y-1">
              {history.slice(0, 10).map((log) => (
                <div key={log.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-xl hover:bg-white/[0.04] transition-colors">
                  <Avatar name={log.peerName} src={log.peerAvatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#EDE5D4] truncate">{log.peerName}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#6B6259]">
                      {log.direction === 'outgoing' ? (
                        <ArrowUpRight className="w-3 h-3 text-[#D97706]" />
                      ) : (
                        <ArrowDownLeft className="w-3 h-3 text-[#22C55E]" />
                      )}
                      <span className={log.status === 'missed' ? 'text-[#F87171]' : ''}>
                        {log.status === 'missed' ? 'Missed' : formatDur(log.durationSec)}
                      </span>
                      <span>·</span>
                      <span>{formatWhen(log.timestamp)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      handleCall(
                        log.peerId,
                        log.type === 'video' ? 1 : 0,
                        log.peerName,
                        log.peerAvatar,
                      )
                    }
                    disabled={callBusy}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed"
                    title={log.type === 'video' ? 'Video call' : 'Audio call'}
                  >
                    {log.type === 'video' ? <VideoIcon className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        {friends.length > 0 && (
          <div className="px-4 sm:px-6 py-3 shrink-0">
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

        {/* Friends List */}
        <div className="px-4 sm:px-6 pb-4">
          {loading ? (
            <div className="h-40 flex items-center justify-center text-[12.5px] text-[#6B6259]">
              <Loader2 className="w-4 h-4 animate-spin mr-2 text-[#D97706]" />
              Loading friends…
            </div>
          ) : friends.length === 0 ? (
            <div className="max-w-md mx-auto mt-8 text-center">
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
            <div className="max-w-md mx-auto mt-8 text-center">
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
                        onClick={() =>
                          void handleCall(
                            friend.userId,
                            0,
                            friend.displayName,
                            friend.avatarUrl,
                          )
                        }
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
                        onClick={() =>
                          void handleCall(
                            friend.userId,
                            1,
                            friend.displayName,
                            friend.avatarUrl,
                          )
                        }
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
    </div>
  );
}

export default CallsPane;