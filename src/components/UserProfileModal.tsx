/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { apiService, extractErrorMessage } from '../services/api';
import { presenceStore } from '../services/presenceStore';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import {
  X,
  Loader2,
  AlertCircle,
  Calendar,
  AtSign,
  UserPlus,
  UserMinus,
  MessageSquare,
  Check,
} from 'lucide-react';
import type { UserProfileDto, FriendDto } from '../types/api';

interface UserProfileModalProps {
  userId: string | null;
  onClose: () => void;
}

export function UserProfileModal({ userId, onClose }: UserProfileModalProps) {
  const navigate = useNavigate();
  const { user: me } = useAuth();

  const [profile, setProfile] = useState<UserProfileDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFriend, setIsFriend] = useState<boolean | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [, setPresenceTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setError(null);
      setIsFriend(null);
      setActionMessage(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setProfile(null);
    setIsFriend(null);
    setActionMessage(null);

    Promise.all([
      apiService.getUserProfile(userId),
      apiService.getFriends().catch(() => [] as FriendDto[]),
    ])
      .then(([p, friends]) => {
        if (!active) return;
        setProfile(p);
        setIsFriend(friends.some((f) => f.userId === userId));
      })
      .catch((err) => {
        if (active) setError(extractErrorMessage(err, 'Failed to load profile.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((n) => n + 1));
    return () => {
      unsub();
    };
  }, []);

  const isMe = userId != null && userId === me?.id;
  const isOnline = userId ? presenceStore.isOnline(userId) : false;

  const handleAddFriend = async () => {
    if (!profile) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      await apiService.sendFriendRequest({ targetIdentifier: profile.userHandle });
      setActionMessage('Friend request sent');
    } catch (err) {
      setActionMessage(extractErrorMessage(err, 'Failed to send request.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleUnfriend = async () => {
    if (!userId) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      await apiService.unfriend(userId);
      setIsFriend(false);
      setActionMessage('Unfriended');
    } catch (err) {
      setActionMessage(extractErrorMessage(err, 'Failed to unfriend.'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleMessage = () => {
    if (!userId) return;
    onClose();
    navigate(`/app/dm/${userId}`);
  };

  const handleClose = () => {
    if (actionBusy) return;
    onClose();
  };

  return (
    <AnimatePresence>
      {userId && (
        <motion.div
          key="user-profile-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 6 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden"
          >
            {loading ? (
              <div className="h-56 flex items-center justify-center text-[#6B6259] text-[12.5px]">
                <Loader2 className="w-5 h-5 animate-spin mr-2 text-[#D97706]" />
                Loading profile…
              </div>
            ) : error ? (
              <div className="p-6 text-center">
                <AlertCircle className="w-8 h-8 text-[#F87171] mx-auto mb-3" />
                <p className="text-[13px] text-[#F87171]">{error}</p>
                <button
                  onClick={handleClose}
                  className="mt-4 h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Close
                </button>
              </div>
            ) : profile ? (
              <>
                <div className="relative p-5 flex flex-col items-center text-center border-b border-white/[0.06]">
                  <button
                    onClick={handleClose}
                    className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center text-[#6B6259] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>

                  <Avatar
                    name={profile.displayName}
                    src={profile.avatarUrl}
                    size="xl"
                    isOnline={isOnline}
                  />

                  <p className="mt-3 text-[16px] font-semibold text-[#EDE5D4] tracking-tight">
                    {profile.displayName}
                  </p>

                  <p className="text-[12.5px] text-[#6B6259] mt-1 flex items-center gap-1">
                    <AtSign className="w-3 h-3" />
                    {profile.userHandle}
                  </p>

                  <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isOnline ? 'bg-[#15803D]' : 'bg-[#6B6259]'
                      }`}
                    />
                    <span className={isOnline ? 'text-[#4ADE80]' : 'text-[#6B6259]'}>
                      {isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>

                <div className="p-5 space-y-3 text-[12.5px]">
                  {profile.fullHandle && (
                    <div className="flex items-center gap-2.5 text-[#A8A29E]">
                      <AtSign className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
                      <span className="truncate">{profile.fullHandle}</span>
                    </div>
                  )}
                  {profile.createdAt && (
                    <div className="flex items-center gap-2.5 text-[#A8A29E]">
                      <Calendar className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
                      <span>Joined {formatJoin(profile.createdAt)}</span>
                    </div>
                  )}
                </div>

                {!isMe && (
                  <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                    <button
                      onClick={handleMessage}
                      disabled={actionBusy}
                      className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#EDE5D4] hover:bg-white/[0.04] disabled:opacity-50 transition-colors text-left"
                    >
                      <MessageSquare className="w-4 h-4 text-[#A8A29E] shrink-0" />
                      <span>Send message</span>
                    </button>

                    {isFriend === false && (
                      <button
                        onClick={() => void handleAddFriend()}
                        disabled={actionBusy || actionMessage !== null}
                        className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#D97706] hover:bg-[#D97706]/[0.06] disabled:opacity-50 transition-colors text-left"
                      >
                        {actionBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : actionMessage ? (
                          <Check className="w-4 h-4 shrink-0" />
                        ) : (
                          <UserPlus className="w-4 h-4 shrink-0" />
                        )}
                        <span>{actionMessage ?? 'Add friend'}</span>
                      </button>
                    )}

                    {isFriend === true && (
                      <button
                        onClick={() => void handleUnfriend()}
                        disabled={actionBusy}
                        className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#F87171] hover:bg-[#B91C1C]/[0.08] disabled:opacity-50 transition-colors text-left"
                      >
                        {actionBusy ? (
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        ) : (
                          <UserMinus className="w-4 h-4 shrink-0" />
                        )}
                        <span>Unfriend</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function formatJoin(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export default UserProfileModal;