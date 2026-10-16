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
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from './Avatar';
import { apiService, extractErrorMessage } from '../services/api';
import { FriendDto } from '../types/api';
import { presenceStore } from '../services/presenceStore';
import { useCall } from '../context/CallContext';

/* ────────────────────────────────────────────────────────── */
/* Calls pane                                                 */
/* ────────────────────────────────────────────────────────── */

function CallsPane(): React.JSX.Element {
  const navigate = useNavigate();
  const { initiateCall, session: activeSession, incomingCall } = useCall();

  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyPeerId, setBusyPeerId] = useState<string | null>(null);

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

  const handleCall = async (peerId: string, callType: number) => {
    if (callBusy) {
      toast.error('You are already in a call.');
      return;
    }
    setBusyPeerId(peerId);
    try {
      await initiateCall(peerId, callType);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Could not start call.'));
    } finally {
      setBusyPeerId(null);
    }
  };

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

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
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
///working
export default CallsPane;