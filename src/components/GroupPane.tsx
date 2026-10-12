/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiService, extractErrorMessage } from '../services/api';
import { signalRService } from '../services/signalr';
import { useAuth } from '../context/AuthContext';
import {
  playReceive,
  playSend,
  unlockSounds,
} from '../services/sounds';
import {
  GroupDto,
  GroupDetailDto,
  GroupMessageDto,
  MediaType,
  FriendDto,
} from '../types/api';
import { Avatar } from './Avatar';
import { UserProfileModal } from './UserProfileModal';
import MessageSkeleton from './MessageSkeleton';
import { validateFileSize } from '../services/upload';
import {
  Plus,
  Paperclip,
  Send,
  Loader2,
  FileText,
  Download,
  AlertCircle,
  X,
  Hash,
  Info,
  LogOut,
  Trash2,
  UserMinus,
  ChevronLeft,
  Search,
} from 'lucide-react';
import {
  useGroupTypingEmitter,
  useGroupTypingReceiver,
} from '../hooks/useTypingIndicator';

/* ────────────────────────────────────────────────────────── */
/* Helpers                                                    */
/* ────────────────────────────────────────────────────────── */

function formatDayDivider(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today.getTime() - that.getTime()) / 86_400_000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/* ────────────────────────────────────────────────────────── */
/* Message row                                                */
/* ────────────────────────────────────────────────────────── */

interface GroupMessageItemProps {
  message: GroupMessageDto;
  isMe: boolean;
  grouped: boolean;
  onRequestProfile: (userId: string) => void;
}

const GroupMessageItem = React.memo(function GroupMessageItem({
  message,
  isMe,
  grouped,
  onRequestProfile,
}: GroupMessageItemProps): React.JSX.Element {
  const hasMedia = Boolean(message.mediaUrl);

  return (
    <div
      className={`relative flex gap-3 px-1 ${
        grouped ? 'mt-0.5' : 'mt-4'
      } ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
    >
      <div className="w-9 shrink-0 pt-0.5">
        {!grouped ? (
          <button
            type="button"
            onClick={() => {
              if (isMe) return;
              onRequestProfile(message.senderId);
            }}
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50"
            aria-label={`View ${message.senderDisplayName}'s profile`}
          >
            <Avatar
              name={message.senderDisplayName || 'User'}
              src={message.senderAvatarUrl}
              size="sm"
            />
          </button>
        ) : (
          <span className="block w-8 h-8" aria-hidden />
        )}
      </div>

      <div
        className={`flex flex-col min-w-0 max-w-[85%] sm:max-w-[75%] md:max-w-[70%] ${
          isMe ? 'items-end' : 'items-start'
        }`}
      >
        {!grouped && (
          <div className="flex items-baseline gap-2 mb-0.5 px-1">
            <span className="text-[12.5px] font-semibold text-[#EDE5D4] tracking-tight">
              {isMe ? 'You' : message.senderDisplayName}
            </span>
            <span className="text-[10.5px] text-[#6B6259] tabular-nums">
              {formatTime(message.sentAt)}
            </span>
          </div>
        )}

        <div
          className={`inline-block max-w-full px-3 py-1.5 text-[13.5px] leading-[1.55] break-words rounded-2xl ${
            isMe
              ? 'bg-[#D97706] text-[#0F0D0A] rounded-br-md font-medium'
              : 'bg-[#1A1816] text-[#EDE5D4] rounded-bl-md border border-white/[0.04]'
          }`}
        >
          {hasMedia && (
            <div className="mb-2 -mx-1">
              {message.mediaType === MediaType.Image && (
                <img
                  src={message.mediaUrl ?? undefined}
                  alt="Attachment"
                  className="rounded-xl max-h-72 w-auto object-cover"
                />
              )}
              {message.mediaType === MediaType.Video && (
                <video
                  src={message.mediaUrl ?? undefined}
                  controls
                  className="rounded-xl max-h-72 w-full bg-black"
                />
              )}
              {message.mediaType === MediaType.Audio && (
                <audio src={message.mediaUrl ?? undefined} controls className="w-full my-1" />
              )}
              {message.mediaType === MediaType.File && (
                <a
                  href={message.mediaUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className={`inline-flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[12px] ${
                    isMe
                      ? 'bg-black/10 border-black/15 text-[#0F0D0A]'
                      : 'bg-white/[0.04] border-white/[0.08] text-[#EDE5D4]'
                  }`}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span className="truncate max-w-[180px]">Download attachment</span>
                  <Download className="w-3.5 h-3.5 shrink-0 ml-1" />
                </a>
              )}
            </div>
          )}

          {message.content && (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </div>
      </div>
    </div>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Group Info modal                                           */
/* ────────────────────────────────────────────────────────── */

type GroupInfoAction = 'leave' | 'delete' | null;

interface GroupInfoModalProps {
  open: boolean;
  group: GroupDetailDto;
  currentUserId: string | undefined;
  onClose: () => void;
  onLeave: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onAddMember: (userId: string) => Promise<void>;
  onViewProfile: (userId: string) => void;
}

function GroupInfoModal({
  open,
  group,
  currentUserId,
  onClose,
  onLeave,
  onDelete,
  onRemoveMember,
  onAddMember,
  onViewProfile,
}: GroupInfoModalProps) {
  const [confirmAction, setConfirmAction] = useState<GroupInfoAction>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isAddingMember, setIsAddingMember] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');
  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);

  const isCreator = group.createdById === currentUserId;

  useEffect(() => {
    if (!isAddingMember || friends.length > 0) return;
    let active = true;
    setLoadingFriends(true);
    apiService
      .getFriends()
      .then((data) => {
        if (active) setFriends(data);
      })
      .catch(() => {
        if (active) setFriends([]);
      })
      .finally(() => {
        if (active) setLoadingFriends(false);
      });
    return () => {
      active = false;
    };
  }, [isAddingMember, friends.length]);

  const reset = () => {
    setConfirmAction(null);
    setPendingRemoveId(null);
    setIsAddingMember(false);
    setFriendQuery('');
    setError(null);
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const runAddMember = async (userId: string) => {
    if (!userId) {
      setError('Could not resolve that friend to a user ID.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAddMember(userId);
      setIsAddingMember(false);
      setFriendQuery('');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to add member.'));
    } finally {
      setBusy(false);
    }
  };

  const runLeave = async () => {
    setBusy(true);
    setError(null);
    try {
      await onLeave();
      reset();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to leave group.'));
      setBusy(false);
    }
  };

  const runDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      reset();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete group.'));
      setBusy(false);
    }
  };

  const runRemoveMember = async (userId: string) => {
    setBusy(true);
    setError(null);
    try {
      await onRemoveMember(userId);
      setPendingRemoveId(null);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to remove member.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 6 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="p-5 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                  <Hash className="w-5 h-5 text-[#D97706]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-[#EDE5D4] tracking-tight truncate">
                    {group.name}
                  </p>
                  <p className="text-[12px] text-[#6B6259] truncate mt-0.5">
                    {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              {group.description && (
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed mt-3">
                  {group.description}
                </p>
              )}
            </div>

            {!confirmAction && !pendingRemoveId ? (
              <>
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#6B6259] font-medium">
                    Members ({group.members?.length ?? 0})
                  </p>
                  {isCreator && (
                    <button
                      onClick={() => {
                        setIsAddingMember((prev) => !prev);
                        setError(null);
                      }}
                      className="text-[12px] text-[#D97706] hover:text-[#F59E0B] font-medium inline-flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Member</span>
                    </button>
                  )}
                </div>

                {isAddingMember && (
                  <div className="border-b border-white/[0.06] bg-black/20">
                    <div className="p-3 flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0F0D0A] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors">
                        <Search className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
                        <input
                          type="text"
                          autoFocus
                          value={friendQuery}
                          onChange={(e) => setFriendQuery(e.target.value)}
                          placeholder="Search friends by @handle or name..."
                          className="flex-1 bg-transparent text-[12.5px] text-[#EDE5D4] placeholder-[#6B6259] outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingMember(false);
                          setFriendQuery('');
                          setError(null);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-[#EDE5D4] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="max-h-56 overflow-y-auto divide-y divide-white/[0.04] border-t border-white/[0.04]">
                      {loadingFriends ? (
                        <div className="px-5 py-4 text-center text-[12px] text-[#6B6259] flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97706]" />
                          Loading friends…
                        </div>
                      ) : friends.length === 0 ? (
                        <div className="px-5 py-4 text-center text-[12px] text-[#6B6259]">
                          You have no friends yet.
                        </div>
                      ) : (
                        (() => {
                          const memberIds = new Set((group.members ?? []).map((m) => m.id));
                          const q = friendQuery.trim().replace(/^@/, '').toLowerCase();
                          const candidates = friends.filter((f) => {
                            if (memberIds.has(f.userId)) return false;
                            if (!q) return true;
                            return (
                              f.handle.toLowerCase().includes(q) ||
                              f.displayName.toLowerCase().includes(q)
                            );
                          });
                          if (candidates.length === 0) {
                            return (
                              <div className="px-5 py-4 text-center text-[12px] text-[#6B6259]">
                                {friendQuery.trim()
                                  ? 'No matching friends.'
                                  : 'All your friends are already in this group.'}
                              </div>
                            );
                          }
                          return candidates.map((f) => (
                            <button
                              key={f.friendshipId}
                              type="button"
                              disabled={busy}
                              onClick={() => void runAddMember(f.userId)}
                              className="w-full px-5 py-2.5 flex items-center gap-3 hover:bg-white/[0.04] disabled:opacity-50 transition-colors text-left"
                            >
                              <Avatar name={f.displayName} src={f.avatarUrl} size="sm" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] text-[#EDE5D4] truncate">
                                  {f.displayName}
                                </p>
                                <p className="text-[11px] text-[#6B6259] truncate mt-0.5">
                                  @{f.handle}
                                </p>
                              </div>
                              <Plus className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
                            </button>
                          ));
                        })()
                      )}
                    </div>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
                  {(group.members ?? []).map((m) => {
                    const isMe = m.id === currentUserId;
                    return (
                      <div key={m.id} className="px-5 py-2.5 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onViewProfile(m.id)}
                          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50 shrink-0"
                          aria-label={`View ${m.displayName}'s profile`}
                        >
                          <Avatar name={m.displayName} src={m.avatarUrl} size="sm" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-[#EDE5D4] truncate">
                            {m.displayName}
                            {isMe && (
                              <span className="text-[11px] text-[#6B6259] ml-1.5">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-[#6B6259] truncate mt-0.5">
                            @{m.userHandle}
                          </p>
                        </div>
                        {isCreator && !isMe && (
                          <button
                            onClick={() => setPendingRemoveId(m.id)}
                            className="shrink-0 p-1.5 rounded-md text-[#A8A29E] hover:text-[#B91C1C] hover:bg-[#B91C1C]/[0.10] transition-colors"
                            title="Remove member"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                  <button
                    onClick={() => setConfirmAction('leave')}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <LogOut className="w-4 h-4 text-[#A8A29E] shrink-0" />
                    <span>Leave group</span>
                  </button>
                  {isCreator && (
                    <button
                      onClick={() => setConfirmAction('delete')}
                      className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#F87171] hover:bg-[#B91C1C]/[0.08] transition-colors text-left"
                    >
                      <Trash2 className="w-4 h-4 shrink-0" />
                      <span>Delete group (creator only)</span>
                    </button>
                  )}
                </div>

                {error && (
                  <div className="px-5 py-3 border-t border-white/[0.06]">
                    <p className="text-[12px] text-[#F87171] flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{error}</span>
                    </p>
                  </div>
                )}

                <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end">
                  <button
                    onClick={handleClose}
                    className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : confirmAction ? (
              <div className="p-5">
                <h3 className="text-[14px] font-semibold text-[#EDE5D4] mb-1.5">
                  {confirmAction === 'leave' ? 'Leave group?' : 'Delete group?'}
                </h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                  {confirmAction === 'leave'
                    ? `You'll be removed from ${group.name}. ${
                        isCreator && group.memberCount > 1
                          ? 'Ownership will transfer to another member.'
                          : 'If you are the last member, the group will be deleted.'
                      }`
                    : `${group.name} and all its messages will be permanently deleted for everyone. This cannot be undone.`}
                </p>
                {error && (
                  <p className="mt-3 text-[12px] text-[#F87171] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{error}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="p-5">
                <h3 className="text-[14px] font-semibold text-[#EDE5D4] mb-1.5">
                  Remove member?
                </h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                  They will be removed from {group.name} and will not see future messages.
                </p>
                {error && (
                  <p className="mt-3 text-[12px] text-[#F87171] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{error}</span>
                  </p>
                )}
              </div>
            )}

            {(confirmAction || pendingRemoveId) && (
              <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setConfirmAction(null);
                    setPendingRemoveId(null);
                    setError(null);
                  }}
                  disabled={busy}
                  className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (confirmAction === 'leave') void runLeave();
                    else if (confirmAction === 'delete') void runDelete();
                    else if (pendingRemoveId) void runRemoveMember(pendingRemoveId);
                  }}
                  disabled={busy}
                  className="h-9 px-4 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5"
                >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {busy
                      ? 'Working…'
                      : confirmAction === 'leave'
                      ? 'Leave'
                      : confirmAction === 'delete'
                      ? 'Delete'
                      : 'Remove'}
                  </span>
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Main GroupPane                                             */
/* ────────────────────────────────────────────────────────── */

export default function GroupPane(): React.JSX.Element {
  const { groupId: groupIdParam } = useParams<{ groupId?: string }>();
  const activeGroupId = groupIdParam ? parseInt(groupIdParam, 10) : undefined;
  const navigate = useNavigate();
  const { user } = useAuth();

  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [activeGroup, setActiveGroup] = useState<GroupDetailDto | null>(null);
  const [messages, setMessages] = useState<GroupMessageDto[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);

  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>('');
  const [newGroupDescription, setNewGroupDescription] = useState<string>('');
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [inputContent, setInputContent] = useState<string>('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { onType: onGroupType, stop: stopGroupTyping } = useGroupTypingEmitter(activeGroupId);
  const typingUsers = useGroupTypingReceiver(activeGroupId, user?.id);

  // One-time audio unlock on first gesture
  useEffect(() => {
    const unlock = () => {
      unlockSounds();
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const data = await apiService.getMyGroups();
      setGroups(data);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  }, []);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    if (!activeGroupId || isNaN(activeGroupId)) {
      setActiveGroup(null);
      setMessages([]);
      return;
    }

    let active = true;

    const loadGroup = async () => {
      setLoadingHistory(true);
      try {
        const detail = await apiService.getGroupDetail(activeGroupId);
        if (active) setActiveGroup(detail);

        await signalRService.joinGroupChannel(activeGroupId);

        const msgs = await apiService.getGroupMessages(activeGroupId, 50);
        if (active) {
          const sorted = [...msgs].sort(
            (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
          );
          setMessages(sorted);
          setHasMore(msgs.length >= 50);
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 50);
        }
      } catch (err) {
        console.error('Error loading group details/messages:', err);
      } finally {
        if (active) setLoadingHistory(false);
      }
    };

    void loadGroup();
    return () => {
      active = false;
    };
  }, [activeGroupId]);

  const handleLoadEarlier = async () => {
    if (!activeGroupId || loadingMore || !hasMore || messages.length === 0) return;
    const oldestId = messages[0].id;
    setLoadingMore(true);
    try {
      const earlier = await apiService.getGroupMessages(activeGroupId, 50, oldestId);
      if (earlier.length > 0) {
        const sortedEarlier = [...earlier].sort(
          (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
        );
        setMessages((prev) => [...sortedEarlier, ...prev]);
        setHasMore(earlier.length >= 50);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Error loading earlier group messages:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const unsub = signalRService.onReceiveGroupMessage((msg: GroupMessageDto) => {
      if (activeGroupId && msg.groupId === activeGroupId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (msg.senderId !== user?.id) playReceive();
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      }
    });
    return () => {
      unsub();
    };
  }, [activeGroupId, user?.id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateFileSize(file);
    if (!validation.valid) {
      setFileError('File size exceeds the 25 MB limit.');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setPendingFile(file);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeGroupId) return;
    if (!inputContent.trim() && !pendingFile) return;

    stopGroupTyping();
    setIsSending(true);
    setFileError(null);

    try {
      let mediaUrl: string | undefined;
      let mediaType: number | undefined;

      if (pendingFile) {
        const reader = new FileReader();
        const dataUrlPromise = new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
        });
        reader.readAsDataURL(pendingFile);
        mediaUrl = await dataUrlPromise;
        const validation = validateFileSize(pendingFile);
        mediaType = validation.mediaType;
      }

      await signalRService.sendGroupMessage({
        groupId: activeGroupId,
        content: inputContent.trim(),
        mediaUrl,
        mediaType,
      });

      playSend();

      setInputContent('');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (textareaRef.current) textareaRef.current.style.height = 'auto';

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } catch (err) {
      setFileError(extractErrorMessage(err));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputContent(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
    onGroupType();
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      setCreateError('Channel name is required.');
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      const created = await apiService.createGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || undefined,
      });
      await fetchGroups();
      setCreateModalOpen(false);
      setNewGroupName('');
      setNewGroupDescription('');
      navigate(`/app/groups/${created.id}`);
    } catch (err) {
      setCreateError(extractErrorMessage(err));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!activeGroupId) return;
    await apiService.leaveGroup(activeGroupId);
    await fetchGroups();
    navigate('/app/groups');
  };

  const handleDeleteGroup = async () => {
    if (!activeGroupId) return;
    await apiService.deleteGroup(activeGroupId);
    await fetchGroups();
    navigate('/app/groups');
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!activeGroupId) return;
    await apiService.removeGroupMember(activeGroupId, targetUserId);
    const detail = await apiService.getGroupDetail(activeGroupId);
    setActiveGroup(detail);
  };

  const handleAddMember = async (userId: string) => {
    if (!activeGroupId) return;
    await apiService.addGroupMember(activeGroupId, userId);
    const detail = await apiService.getGroupDetail(activeGroupId);
    setActiveGroup(detail);
  };

  const grouped = useMemo(() => {
    type Item =
      | { type: 'date'; key: string; label: string }
      | { type: 'msg'; key: string; message: GroupMessageDto; grouped: boolean };

    const out: Item[] = [];
    let lastDate = '';
    let lastSenderId = '';
    let lastTs = 0;

    for (const m of messages) {
      const day = new Date(m.sentAt).toDateString();
      if (day !== lastDate) {
        out.push({ type: 'date', key: `d-${day}`, label: formatDayDivider(m.sentAt) });
        lastDate = day;
        lastSenderId = '';
        lastTs = 0;
      }
      const ts = new Date(m.sentAt).getTime();
      const sameSender = m.senderId === lastSenderId;
      const within = ts - lastTs < 7 * 60 * 1000;
      const isGrouped = sameSender && within;
      out.push({ type: 'msg', key: String(m.id), message: m, grouped: isGrouped });
      lastSenderId = m.senderId ?? '';
      lastTs = ts;
    }
    return out;
  }, [messages]);

  const hasActiveGroup = Boolean(activeGroupId && activeGroup);

  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) {
      return `${typingUsers[0].handle || 'Someone'} is typing…`;
    }
    if (typingUsers.length === 2) {
      return `${typingUsers[0].handle}, ${typingUsers[1].handle} are typing…`;
    }
    return `${typingUsers.length} people are typing…`;
  }, [typingUsers]);

  return (
    <div className="flex h-full w-full bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* LEFT: Groups list */}
      <div
        className={`${
          hasActiveGroup ? 'hidden md:flex' : 'flex'
        } w-full md:w-[300px] md:shrink-0 border-r border-white/[0.05] bg-[#0F0D0A] flex-col h-full`}
      >
        <div className="h-16 px-4 flex items-center justify-between shrink-0 border-b border-white/[0.05]">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[18px] font-semibold text-[#EDE5D4] tracking-tight">
              Groups
            </h2>
            <span className="text-[11.5px] text-[#6B6259] tabular-nums font-mono">
              {groups.length}
            </span>
          </div>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] transition-colors"
            title="Create group"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {groups.length === 0 ? (
            <div className="p-8 text-center text-[12.5px] text-[#6B6259]">
              No groups yet. Click + to create one.
            </div>
          ) : (
            groups.map((group) => {
              const isSelected = group.id === activeGroupId;
              return (
                <button
                  key={group.id}
                  onClick={() => navigate(`/app/groups/${group.id}`)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${
                    isSelected
                      ? 'bg-[#D97706]/[0.10] ring-1 ring-inset ring-[#D97706]/20'
                      : 'hover:bg-white/[0.035]'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#D97706] shrink-0">
                    <Hash className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-[#EDE5D4] truncate">
                      {group.name}
                    </p>
                    <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5">
                      {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT: Channel view */}
      <div
        className={`${
          hasActiveGroup ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col h-full min-w-0 bg-[#0B0A08]`}
      >
        {activeGroupId && activeGroup ? (
          <>
            <div className="h-16 px-3 sm:px-5 border-b border-white/[0.05] flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => navigate('/app/groups')}
                  className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors shrink-0"
                  aria-label="Back to groups"
                >
                  <ChevronLeft className="w-[18px] h-[18px]" />
                </button>

                <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#D97706] shrink-0">
                  <Hash className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[14px] sm:text-[14.5px] font-semibold text-[#EDE5D4] truncate tracking-tight">
                    {activeGroup.name}
                  </h3>
                  <p className="text-[11px] sm:text-[11.5px] text-[#6B6259] truncate mt-0.5">
                    {activeGroup.memberCount} member{activeGroup.memberCount === 1 ? '' : 's'}
                    {activeGroup.description ? ` · ${activeGroup.description}` : ''}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setInfoOpen(true)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors shrink-0"
                title="Group info"
                aria-label="Group info"
              >
                <Info className="w-[17px] h-[17px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4">
              {hasMore && (
                <div className="text-center pb-4">
                  <button
                    onClick={() => void handleLoadEarlier()}
                    disabled={loadingMore}
                    className="px-3 py-1.5 rounded-full bg-white/[0.035] border border-white/[0.06] text-[11.5px] text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
                  >
                    {loadingMore ? 'Loading…' : 'Load earlier'}
                  </button>
                </div>
              )}

              {loadingHistory ? (
                <MessageSkeleton />
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                    <Hash className="w-7 h-7 text-[#6B6259]" />
                  </div>
                  <div>
                    <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight">
                      No messages yet
                    </p>
                    <p className="text-[12.5px] text-[#6B6259] mt-1">
                      Start the conversation in {activeGroup.name}.
                    </p>
                  </div>
                </div>
              ) : (
                grouped.map((item) => {
                  if (item.type === 'date') {
                    return (
                      <div key={item.key} className="flex items-center gap-4 my-6">
                        <div className="flex-1 h-px bg-white/[0.05]" />
                        <span className="text-[10.5px] uppercase tracking-[0.22em] text-[#6B6259] font-medium">
                          {item.label}
                        </span>
                        <div className="flex-1 h-px bg-white/[0.05]" />
                      </div>
                    );
                  }
                  return (
                    <GroupMessageItem
                      key={item.key}
                      message={item.message}
                      isMe={item.message.senderId === user?.id}
                      grouped={item.grouped}
                      onRequestProfile={setProfileModalUserId}
                    />
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t border-white/[0.05] bg-[#0F0D0A]">
              <div className="h-6 flex items-center px-1">
                <AnimatePresence mode="wait">
                  {typingLabel && (
                    <motion.span
                      key={typingLabel}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.15 }}
                      className="text-[11.5px] text-[#6B6259] italic truncate"
                    >
                      {typingLabel}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {fileError && (
                <div className="mb-2 px-3 py-1.5 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-[12px] text-[#F87171] flex items-center justify-between">
                  <span>{fileError}</span>
                  <button onClick={() => setFileError(null)}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {pendingFile && (
                <div className="mb-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[12px] text-[#EDE5D4] flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-[#D97706] shrink-0" />
                    <span className="truncate">{pendingFile.name}</span>
                  </div>
                  <button
                    onClick={() => {
                      setPendingFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="p-1 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSendMessage} className="flex items-end gap-2 pt-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[#A8A29E] hover:text-[#EDE5D4] border border-white/[0.06] transition-colors shrink-0"
                  title="Attach file"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <div className="flex-1 relative rounded-xl bg-[#1A1816] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputContent}
                    onChange={handleTextareaInput}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message #${activeGroup.name}`}
                    className="w-full bg-transparent px-3.5 py-2.5 text-[13.5px] text-[#EDE5D4] placeholder-[#6B6259] resize-none outline-none leading-relaxed block max-h-40"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSending || (!inputContent.trim() && !pendingFile)}
                  className="p-2.5 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:opacity-40 text-[#0F0D0A] font-semibold transition-all shrink-0"
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 p-6">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Hash className="w-7 h-7 text-[#6B6259]" />
            </div>
            <div>
              <p className="text-[15px] text-[#EDE5D4] font-semibold tracking-tight">
                Select a group
              </p>
              <p className="text-[12.5px] text-[#6B6259] mt-1">
                Choose a channel from the left sidebar or create a new one.
              </p>
            </div>
          </div>
        )}
      </div>

      {activeGroup && (
        <GroupInfoModal
          open={infoOpen}
          group={activeGroup}
          currentUserId={user?.id}
          onClose={() => setInfoOpen(false)}
          onLeave={handleLeaveGroup}
          onDelete={handleDeleteGroup}
          onRemoveMember={handleRemoveMember}
          onAddMember={handleAddMember}
          onViewProfile={setProfileModalUserId}
        />
      )}

      <UserProfileModal
        userId={profileModalUserId}
        onClose={() => setProfileModalUserId(null)}
      />

      <AnimatePresence>
        {createModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setCreateModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#1A1816] border border-white/[0.08] rounded-2xl p-6 shadow-2xl"
            >
              <h2 className="text-[16px] font-semibold text-[#EDE5D4] mb-1">Create Channel</h2>
              <p className="text-[12px] text-[#6B6259] mb-4">
                Start a group to chat with multiple teammates or friends.
              </p>

              {createError && (
                <div className="mb-4 p-2.5 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-[12px] text-[#F87171] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <form onSubmit={handleCreateGroup} className="space-y-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#A8A29E] font-medium mb-1.5">
                    Channel Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g. general-discussion"
                    className="w-full px-3 py-2 rounded-lg bg-[#0F0D0A] border border-white/[0.08] text-[#EDE5D4] text-[13px] outline-none focus:border-[#D97706]/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#A8A29E] font-medium mb-1.5">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={newGroupDescription}
                    onChange={(e) => setNewGroupDescription(e.target.value)}
                    placeholder="What is this channel about?"
                    className="w-full px-3 py-2 rounded-lg bg-[#0F0D0A] border border-white/[0.08] text-[#EDE5D4] text-[13px] outline-none focus:border-[#D97706]/60 transition-colors"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createLoading || !newGroupName.trim()}
                    className="px-4 py-2 rounded-lg bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 text-[#0F0D0A] font-semibold text-[12.5px] transition-colors flex items-center gap-1.5"
                  >
                    {createLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Create</span>
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