/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { apiService, extractErrorMessage } from '../services/api';
import { signalRService } from '../services/signalr';
import { presenceStore } from '../services/presenceStore';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import {
  playReceive,
  playSend,
  unlockSounds,
} from '../services/sounds';
import {
  useDmTypingEmitter,
  useDmTypingReceiver,
} from '../hooks/useTypingIndicator';
import {
  CallType,
  DirectMessageDto,
  FriendDto,
  MediaType,
  UserProfileDto,
} from '../types/api';
import { Avatar } from './Avatar';
import { UserProfileModal } from './UserProfileModal';
import MessageSkeleton from './MessageSkeleton';
import { validateFileSize, formatFileSize } from '../services/upload';
import {
  Phone,
  Video,
  Paperclip,
  Send,
  Loader2,
  FileText,
  Download,
  AlertCircle,
  X,
  User,
  UserPlus,
  Check,
  CheckCheck,
  PhoneCall,
  Search,
  ChevronLeft,
  ChevronDown,
  Trash2,
  EyeOff,
  Info,
  UserMinus,
  Eraser,
  Flag,
} from 'lucide-react';

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

interface MessageRowProps {
  message: DirectMessageDto;
  isMe: boolean;
  senderName: string;
  senderAvatar?: string | null;
  grouped: boolean;
  isLastOfGroup: boolean;
  onDeleteForMe: (m: DirectMessageDto) => void;
  onDeleteForEveryone: (m: DirectMessageDto) => void;
  onRequestProfile: (userId: string) => void;
}

const MessageRow = React.memo(function MessageRow({
  message,
  isMe,
  senderName,
  senderAvatar,
  grouped,
  isLastOfGroup,
  onDeleteForMe,
  onDeleteForEveryone,
  onRequestProfile,
}: MessageRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressRef = useRef<number | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const onTouchStart = () => {
    longPressRef.current = window.setTimeout(() => setMenuOpen(true), 500);
  };
  const onTouchEnd = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const hasMedia = Boolean(message.mediaUrl);

  return (
    <div
      className={`relative flex gap-3 px-1 ${
        grouped ? 'mt-0.5' : 'mt-4'
      } ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
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
            aria-label={`View ${senderName}'s profile`}
          >
            <Avatar name={senderName} src={senderAvatar} size="sm" />
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
              {isMe ? 'You' : senderName}
            </span>
            <span className="text-[10.5px] text-[#6B6259] tabular-nums">
              {formatTime(message.sentAt)}
            </span>
          </div>
        )}

        <div className="relative inline-flex items-end gap-1 max-w-full">
          <div
            className={`inline-block max-w-full px-3 py-1.5 text-[13.5px] leading-[1.55] break-words rounded-2xl ${
              isMe
                ? 'bg-[#D97706] text-[#0F0D0A] rounded-br-md'
                : 'bg-[#1A1816] text-[#EDE5D4] rounded-bl-md'
            }`}
          >
            {hasMedia && (
              <div className="mb-2 -mx-1">
                {message.mediaType === MediaType.Image && (
                  <img
                    src={message.mediaUrl ?? undefined}
                    alt=""
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
                    <span className="truncate max-w-[180px]">Attached file</span>
                    <Download className="w-3.5 h-3.5 shrink-0 ml-1" />
                  </a>
                )}
              </div>
            )}

            {message.content && (
              <p className="whitespace-pre-wrap">{message.content}</p>
            )}
          </div>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.94, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: -4 }}
                transition={{ duration: 0.14 }}
                className={`absolute z-40 top-full mt-1 ${
                  isMe ? 'right-0' : 'left-0'
                } min-w-[190px] rounded-xl bg-[#1A1816] border border-white/[0.08] shadow-[0_16px_40px_-10px_rgba(0,0,0,0.9)] overflow-hidden`}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteForMe(message);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Delete for me</span>
                </button>

                {isMe && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteForEveryone(message);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-[#F87171] hover:bg-[#B91C1C]/[0.10] transition-colors border-t border-white/[0.04]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete for everyone</span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {isMe && isLastOfGroup && (
          <div
            className="flex items-center mt-0.5 px-1"
            aria-label={message.isRead ? 'Read' : 'Delivered'}
          >
            <CheckCheck
              className={`w-3.5 h-3.5 transition-colors ${
                message.isRead ? 'text-[#4ADE80]' : 'text-[#6B6259]'
              }`}
            />
          </div>
        )}
      </div>
    </div>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Info modal                                                 */
/* ────────────────────────────────────────────────────────── */

type InfoAction = 'unfriend' | 'clear' | null;

interface InfoModalProps {
  open: boolean;
  targetUser: UserProfileDto;
  isFriend: boolean;
  onClose: () => void;
  onUnfriend: () => Promise<void>;
  onClear: () => Promise<void>;
}

function InfoModal({
  open,
  targetUser,
  isFriend,
  onClose,
  onUnfriend,
  onClear,
}: InfoModalProps) {
  const [confirmAction, setConfirmAction] = useState<InfoAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setConfirmAction(null);
    setError(null);
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const runAction = async (action: InfoAction) => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'unfriend') await onUnfriend();
      if (action === 'clear') await onClear();
      reset();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Something went wrong.'));
      setBusy(false);
    }
  };

  const confirmCopy: Record<NonNullable<InfoAction>, { title: string; body: string; cta: string }> = {
    unfriend: {
      title: 'Unfriend?',
      body: `You will no longer be friends with ${targetUser.displayName}. You can send a new friend request later.`,
      cta: 'Unfriend',
    },
    clear: {
      title: 'Clear this chat?',
      body: `Messages will be hidden from your view only. ${targetUser.displayName} keeps their copy.`,
      cta: 'Clear',
    },
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
            className="w-full max-w-sm rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden"
          >
            <div className="p-5 flex flex-col items-center text-center border-b border-white/[0.06]">
              <Avatar
                name={targetUser.displayName}
                src={targetUser.avatarUrl}
                size="xl"
                isOnline={presenceStore.isOnline(targetUser.id)}
              />
              <p className="mt-3 text-[15px] font-semibold text-[#EDE5D4] tracking-tight">
                {targetUser.displayName}
              </p>
              <p className="text-[12px] text-[#6B6259] mt-0.5">
                @{targetUser.userHandle}
              </p>
            </div>

            {!confirmAction ? (
              <div className="divide-y divide-white/[0.04]">
                {isFriend && (
                  <button
                    onClick={() => setConfirmAction('unfriend')}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <UserMinus className="w-4 h-4 text-[#A8A29E] shrink-0" />
                    <span>Unfriend</span>
                  </button>
                )}
                <button
                  onClick={() => setConfirmAction('clear')}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
                >
                  <Eraser className="w-4 h-4 text-[#A8A29E] shrink-0" />
                  <span>Clear this chat</span>
                </button>
                <div className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#6B6259] cursor-not-allowed">
                  <Flag className="w-4 h-4 shrink-0" />
                  <span>Report (coming soon)</span>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <h3 className="text-[14px] font-semibold text-[#EDE5D4] mb-1.5">
                  {confirmCopy[confirmAction].title}
                </h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                  {confirmCopy[confirmAction].body}
                </p>

                {error && (
                  <p className="mt-3 text-[12px] text-[#F87171] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{error}</span>
                  </p>
                )}
              </div>
            )}

            <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
              {!confirmAction ? (
                <button
                  onClick={handleClose}
                  className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    onClick={() => { setConfirmAction(null); setError(null); }}
                    disabled={busy}
                    className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] text-[#EDE5D4] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => void runAction(confirmAction)}
                    disabled={busy}
                    className="h-9 px-4 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{busy ? 'Working…' : confirmCopy[confirmAction].cta}</span>
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Main pane                                                  */
/* ────────────────────────────────────────────────────────── */

function DirectMessagePane(): React.JSX.Element {
  const { userId } = useParams<{ userId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { initiateCall, incomingCall, acceptCall, rejectCall } = useCall();
  const reduceMotion = useReducedMotion();

  const { onType, stop: stopTyping } = useDmTypingEmitter(userId);
  const isPeerTyping = useDmTypingReceiver(userId);

  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [targetUser, setTargetUser] = useState<UserProfileDto | null>(null);
  const [messages, setMessages] = useState<DirectMessageDto[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [inputContent, setInputContent] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [friendRequestStatus, setFriendRequestStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<
    string | number | null
  >(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);

  const [composerVisible, setComposerVisible] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Local unread counters per friend (device-only)
  const UNREAD_KEY = `orbital.unreadDms.${user?.id ?? 'anon'}`;
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem(`orbital.unreadDms.${user?.id ?? 'anon'}`);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(UNREAD_KEY, JSON.stringify(unreadCounts));
    } catch {
      /* quota */
    }
  }, [unreadCounts, UNREAD_KEY]);

  const [, setPresenceTick] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const lastScrollTopRef = useRef(0);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

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

  const loadFriends = useCallback(async () => {
    try {
      const friendList = await apiService.getFriends();
      setFriends(friendList);
    } catch (err) {
      console.error('Failed to load friends list:', err);
    }
  }, []);

  useEffect(() => { void loadFriends(); }, [loadFriends]);

  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => { unsub(); };
  }, []);

  const isConfirmedFriend = useMemo(() => {
    if (!userId) return false;
    return friends.some((f) => f.userId === userId);
  }, [userId, friends]);

  const isTargetOnline = presenceStore.isOnline(userId);

  const incomingFromThisUser = useMemo(() => {
    if (!incomingCall || !userId) return false;
    return incomingCall.initiatorId === userId;
  }, [incomingCall, userId]);

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.trim().toLowerCase();
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        (f.handle ?? '').toLowerCase().includes(q),
    );
  }, [friends, searchQuery]);

  useEffect(() => {
    if (!userId) { setTargetUser(null); setMessages([]); return; }
    let active = true;

    const loadTarget = async () => {
      const match = friends.find((f) => f.userId === userId);
      if (match) {
        setTargetUser({
          id: match.userId,
          userHandle: match.handle,
          fullHandle: match.fullHandle,
          displayName: match.displayName,
          avatarUrl: match.avatarUrl,
          createdAt: match.establishedAt,
        });
      } else {
        try {
          const profile = await apiService.getUserProfile(userId);
          if (active) setTargetUser(profile);
        } catch {
          if (active) {
            setTargetUser({
              id: userId,
              userHandle: 'user',
              fullHandle: `${userId}@orbit`,
              displayName: 'Contact',
              createdAt: '',
            });
          }
        }
      }
    };
    void loadTarget();
    return () => { active = false; };
  }, [userId, friends]);

  // Clear unread badge when opening a conversation
  useEffect(() => {
    if (!userId) return;
    setUnreadCounts((prev) => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    const fetchHistory = async () => {
      setLoadingHistory(true);
      try {
        const history = await apiService.getDmHistory(userId, 50);
        if (active) {
          const sorted = [...history].sort(
            (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
          );
          setMessages(sorted);
          setHasMore(history.length >= 50);
          void apiService.markDmRead(userId);
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 50);
        }
      } catch (err) {
        console.error('Error fetching DM history:', err);
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    void fetchHistory();
    return () => { active = false; };
  }, [userId]);

  const handleLoadEarlier = async () => {
    if (!userId || loadingMore || !hasMore || messages.length === 0) return;
    const oldestMessageId = messages[0].id;
    setLoadingMore(true);
    try {
      const earlier = await apiService.getDmHistory(userId, 50, oldestMessageId);
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
      console.error('Error loading older messages:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const unsub = signalRService.onReceiveDirectMessage((msg: DirectMessageDto) => {
      const isCurrentChat =
        (msg.senderId === userId && msg.recipientId === user?.id) ||
        (msg.senderId === user?.id && msg.recipientId === userId);

      if (isCurrentChat) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (msg.senderId === userId) {
          playReceive();
          void apiService.markDmRead(userId);
        }
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      } else if (msg.recipientId === user?.id && msg.senderId !== user?.id) {
        // Incoming message from someone else
        playReceive();
        setUnreadCounts((prev) => ({
          ...prev,
          [msg.senderId]: (prev[msg.senderId] ?? 0) + 1,
        }));
      }
    });
    return () => { unsub(); };
  }, [userId, user?.id]);

  useEffect(() => {
    if (isPeerTyping && messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [isPeerTyping]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateFileSize(file);
    if (!validation.valid) {
      setFileError('File is too large (max 25 MB).');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setPendingFile(file);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (!inputContent.trim() && !pendingFile) return;

    stopTyping();
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
        mediaType = validateFileSize(pendingFile).mediaType;
      }

      await signalRService.sendDirectMessage({
        recipientId: userId,
        content: inputContent.trim(),
        mediaUrl,
        mediaType,
      });

      playSend();

      setInputContent('');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (composerRef.current) composerRef.current.style.height = 'auto';

      setComposerVisible(true);

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } catch (err) {
      setFileError(extractErrorMessage(err));
    } finally {
      setIsSending(false);
    }
  };

  const handleSendFriendRequest = async () => {
    if (!targetUser?.userHandle) return;
    try {
      await apiService.sendFriendRequest({ targetIdentifier: targetUser.userHandle });
      setFriendRequestStatus('Request sent');
      setTimeout(() => setFriendRequestStatus(null), 3000);
    } catch (err) {
      setFriendRequestStatus(extractErrorMessage(err));
    }
  };

  const handleAudioCall = async () => {
    if (!userId) return;
    try {
      await initiateCall(userId, CallType.Audio);
    } catch (err) {
      alert(`Call failed: ${extractErrorMessage(err)}`);
    }
  };

  const handleVideoCall = async () => {
    if (!userId) return;
    try {
      await initiateCall(userId, CallType.Video);
    } catch (err) {
      alert(`Call failed: ${extractErrorMessage(err)}`);
    }
  };

  const handleDeleteForMe = useCallback(async (m: DirectMessageDto) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await apiService.deleteDm(m.id);
    } catch (err) {
      setMessages((prev) =>
        [...prev, m].sort(
          (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
        ),
      );
      alert(`Delete failed: ${extractErrorMessage(err)}`);
    }
  }, []);

  const handleRequestDeleteForEveryone = useCallback((m: DirectMessageDto) => {
    setPendingDeleteEveryoneId(m.id);
  }, []);

  const handleConfirmDeleteForEveryone = useCallback(async () => {
    if (pendingDeleteEveryoneId == null) return;
    const targetId = pendingDeleteEveryoneId;

    setMessages((prev) => prev.filter((x) => x.id !== targetId));
    setPendingDeleteEveryoneId(null);

    try {
      await apiService.deleteDmForEveryone(targetId);
    } catch (err) {
      if (userId) {
        try {
          const history = await apiService.getDmHistory(userId, 50);
          const sorted = [...history].sort(
            (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
          );
          setMessages(sorted);
        } catch {
          /* ignore */
        }
      }
      alert(`Delete for everyone failed: ${extractErrorMessage(err)}`);
    }
  }, [pendingDeleteEveryoneId, userId]);

  const handleUnfriend = async () => {
    if (!userId) return;
    await apiService.unfriend(userId);
    setFriends((prev) => prev.filter((f) => f.userId !== userId));
    navigate('/app/dm');
  };

  const handleClearConversation = async () => {
    if (!userId) return;
    await apiService.clearConversation(userId);
    setMessages([]);
  };

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const scrollTop = el.scrollTop;
    const lastScrollTop = lastScrollTopRef.current;

    const nearBottom = el.scrollHeight - scrollTop - el.clientHeight < 120;

    if (scrollTop < lastScrollTop - 6) {
      if (composerVisible) setComposerVisible(false);
      if (!nearBottom) setShowJumpToLatest(true);
    } else if (scrollTop > lastScrollTop + 6) {
      if (nearBottom) {
        setComposerVisible(true);
        setShowJumpToLatest(false);
      }
    }

    if (nearBottom) {
      setComposerVisible(true);
      setShowJumpToLatest(false);
    }

    lastScrollTopRef.current = scrollTop;
  };

  const handleJumpToLatest = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setComposerVisible(true);
    setShowJumpToLatest(false);
  };

  const grouped = useMemo(() => {
    type Item =
      | { type: 'date'; key: string; label: string }
      | { type: 'msg'; key: string; message: DirectMessageDto; grouped: boolean };

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

  const isLastOfGroup = useMemo(() => {
    const map = new Map<string, boolean>();
    for (let i = 0; i < grouped.length; i++) {
      const item = grouped[i];
      if (item.type !== 'msg') continue;
      const next = grouped[i + 1];
      const nextIsSameSender =
        next && next.type === 'msg' && next.message.senderId === item.message.senderId;
      map.set(item.key, !nextIsSameSender);
    }
    return map;
  }, [grouped]);

  const hasActiveChat = Boolean(userId && targetUser);

  return (
    <div className="flex h-full w-full bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* LEFT: conversation list */}
      <div
        className={`${
          hasActiveChat ? 'hidden md:flex' : 'flex'
        } w-full md:w-[300px] md:shrink-0 border-r border-white/[0.05] bg-[#0F0D0A] flex-col h-full`}
      >
        <div className="h-16 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[18px] font-semibold text-[#EDE5D4] tracking-tight">
              Messages
            </h2>
            <span className="text-[11.5px] text-[#6B6259] tabular-nums">
              {friends.length}
            </span>
          </div>
        </div>

        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6259] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-[13px] text-[#EDE5D4] placeholder:text-[#6B6259] focus:outline-none focus:border-[#D97706]/40 focus:bg-white/[0.05] transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {filteredFriends.length === 0 ? (
            <div className="p-8 text-center text-[12.5px] text-[#6B6259]">
              {friends.length === 0 ? 'No contacts yet.' : 'No matches.'}
            </div>
          ) : (
            filteredFriends.map((friend) => {
              const isSelected = friend.userId === userId;
              const isOnline = presenceStore.isOnline(friend.userId);
              const unread = unreadCounts[friend.userId] ?? 0;
              return (
                <button
                  key={friend.friendshipId}
                  onClick={() => navigate(`/app/dm/${friend.userId}`)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${
                    isSelected
                      ? 'bg-[#D97706]/[0.10] ring-1 ring-inset ring-[#D97706]/20'
                      : 'hover:bg-white/[0.035]'
                  }`}
                >
                  <Avatar
                    name={friend.displayName}
                    src={friend.avatarUrl}
                    size="md"
                    isOnline={isOnline}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-[#EDE5D4] truncate">
                      {friend.displayName}
                    </p>
                    <p className="text-[11.5px] text-[#6B6259] truncate mt-0.5">
                      @{friend.handle}
                    </p>
                  </div>
                  {unread > 0 && (
                    <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#D97706] text-[#0F0D0A] text-[11px] font-semibold tabular-nums flex items-center justify-center">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT: chat */}
      <div
        className={`${
          hasActiveChat ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col h-full min-w-0 bg-[#0B0A08] relative`}
      >
        {userId && targetUser ? (
          <>
            <div className="h-16 px-3 sm:px-5 border-b border-white/[0.05] flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => navigate('/app/dm')}
                  className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors shrink-0"
                  aria-label="Back to conversations"
                >
                  <ChevronLeft className="w-[18px] h-[18px]" />
                </button>

                <button
                  type="button"
                  onClick={() => setProfileModalUserId(targetUser.id)}
                  className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50"
                  aria-label={`View ${targetUser.displayName}'s profile`}
                >
                  <Avatar
                    name={targetUser.displayName}
                    src={targetUser.avatarUrl}
                    size="md"
                    isOnline={isTargetOnline}
                  />
                </button>

                <div className="min-w-0">
                  <h3 className="text-[14px] sm:text-[14.5px] font-semibold text-[#EDE5D4] truncate tracking-tight">
                    {targetUser.displayName}
                  </h3>
                  <p className="text-[11px] sm:text-[11.5px] text-[#6B6259] truncate mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isTargetOnline ? 'bg-[#15803D]' : 'bg-[#6B6259]'
                      }`}
                    />
                    <span className="hidden sm:inline">
                      {isTargetOnline ? 'Online' : 'Offline'} ·
                    </span>
                    <span>@{targetUser.userHandle}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <button
                  onClick={() => void handleAudioCall()}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  title="Audio call"
                >
                  <Phone className="w-[17px] h-[17px]" />
                </button>
                <button
                  onClick={() => void handleVideoCall()}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  title="Video call"
                >
                  <Video className="w-[17px] h-[17px]" />
                </button>
                <button
                  onClick={() => setInfoOpen(true)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  title="Info"
                  aria-label="Info"
                >
                  <Info className="w-[17px] h-[17px]" />
                </button>
              </div>
            </div>

            {incomingFromThisUser && (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28 }}
                className="shrink-0 px-4 sm:px-5 py-3 bg-[#0F0D0A] border-b border-[#15803D]/40 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <motion.div
                    animate={reduceMotion ? undefined : { scale: [1, 1.08, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="w-9 h-9 rounded-full bg-[#15803D]/15 border border-[#15803D]/30 text-[#15803D] flex items-center justify-center shrink-0"
                  >
                    <PhoneCall className="w-4 h-4" />
                  </motion.div>
                  <div className="min-w-0">
                    <p className="text-[10.5px] sm:text-[11px] uppercase tracking-[0.24em] text-[#15803D]">
                      Incoming call
                    </p>
                    <p className="text-[13px] sm:text-[13.5px] text-[#EDE5D4] truncate">
                      {targetUser.displayName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => void rejectCall()}
                    className="h-9 px-3 sm:px-4 rounded-lg bg-white/[0.05] hover:bg-[#B91C1C]/15 border border-white/[0.08] hover:border-[#B91C1C]/40 text-[#EDE5D4] hover:text-[#B91C1C] text-[12.5px] sm:text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Decline</span>
                  </button>
                  <button
                    onClick={() => void acceptCall()}
                    className="h-9 px-3 sm:px-4 rounded-lg bg-[#15803D] hover:bg-[#15803D]/90 text-white text-[12.5px] sm:text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Accept
                  </button>
                </div>
              </motion.div>
            )}

            {!isConfirmedFriend && (
              <div className="shrink-0 px-4 sm:px-5 py-3 bg-[#D97706]/[0.06] border-b border-[#D97706]/20 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
                <div className="flex items-center gap-2 text-[#A8A29E] min-w-0">
                  <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0" />
                  <span className="truncate">You're not friends yet — messaging is limited.</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {friendRequestStatus && (
                    <span className="text-[11.5px] text-[#15803D]">{friendRequestStatus}</span>
                  )}
                  <button
                    onClick={() => void handleSendFriendRequest()}
                    className="h-7 px-3 rounded-md bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <UserPlus className="w-3 h-3" />
                    Add friend
                  </button>
                </div>
              </div>
            )}

            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4"
            >
              {hasMore && !loadingHistory && (
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
                    <User className="w-7 h-7 text-[#6B6259]" />
                  </div>
                  <div>
                    <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight">
                      No messages yet
                    </p>
                    <p className="text-[12.5px] text-[#6B6259] mt-1">
                      Say hi to {targetUser.displayName}.
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
                  const m = item.message;
                  const isMe = m.senderId === user?.id;
                  return (
                    <MessageRow
                      key={item.key}
                      message={m}
                      isMe={isMe}
                      senderName={isMe ? 'You' : targetUser.displayName}
                      senderAvatar={isMe ? user?.avatarUrl : targetUser.avatarUrl}
                      grouped={item.grouped}
                      isLastOfGroup={isLastOfGroup.get(item.key) ?? true}
                      onDeleteForMe={handleDeleteForMe}
                      onDeleteForEveryone={handleRequestDeleteForEveryone}
                      onRequestProfile={setProfileModalUserId}
                    />
                  );
                })
              )}

              <AnimatePresence>
                {isPeerTyping && (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                    transition={{ duration: 0.16 }}
                    className="flex items-end gap-3 px-1 mt-3"
                  >
                    <div className="w-9 shrink-0">
                      <Avatar
                        name={targetUser.displayName}
                        src={targetUser.avatarUrl}
                        size="sm"
                      />
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-[#1A1816] border border-white/[0.05]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce [animation-delay:-0.32s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce [animation-delay:-0.16s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-bounce" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>

            <AnimatePresence>
              {showJumpToLatest && (
                <motion.button
                  key="jump-btn"
                  initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  onClick={handleJumpToLatest}
                  className="absolute bottom-24 right-6 z-30 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] shadow-[0_8px_24px_-6px_rgba(217,119,6,0.5)] flex items-center justify-center transition-colors"
                  title="Jump to latest"
                  aria-label="Jump to latest"
                >
                  <ChevronDown className="w-5 h-5" />
                </motion.button>
              )}
            </AnimatePresence>

            <motion.div
              initial={false}
              animate={{
                y: composerVisible ? 0 : 80,
                opacity: composerVisible ? 1 : 0,
                height: composerVisible ? 'auto' : 0,
              }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="shrink-0 overflow-hidden"
            >
              <div className="border-t border-white/[0.05] bg-[#0B0A08] px-2 sm:px-4 py-2 sm:py-3">
                <AnimatePresence>
                  {pendingFile && (
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 6, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: 6, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="pb-2 sm:pb-3 overflow-hidden"
                    >
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.035] border border-white/[0.06] text-[12px] text-[#EDE5D4]">
                        <Paperclip className="w-3.5 h-3.5 text-[#D97706]" />
                        <span className="truncate max-w-[180px] sm:max-w-[240px]">
                          {pendingFile.name}
                        </span>
                        <span className="text-[#6B6259] hidden sm:inline">
                          ({formatFileSize(pendingFile.size)})
                        </span>
                        <button
                          onClick={() => {
                            setPendingFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="text-[#6B6259] hover:text-[#B91C1C] ml-1 transition-colors"
                          aria-label="Remove attachment"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {fileError && (
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      className="pb-2 sm:pb-3"
                    >
                      <div className="flex items-center gap-1.5 text-[12px] text-[#F87171]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{fileError}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form
                  onSubmit={handleSendMessage}
                  className="flex items-end gap-2"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                    title="Attach file"
                    aria-label="Attach file"
                  >
                    <Paperclip className="w-[18px] h-[18px]" />
                  </button>

                  <textarea
                    ref={composerRef}
                    value={inputContent}
                    onChange={(e) => {
                      setInputContent(e.target.value);
                      autoGrow(e.currentTarget);
                      if (!composerVisible) setComposerVisible(true);
                      if (e.target.value.trim().length > 0) {
                        onType();
                      } else {
                        stopTyping();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendMessage(e as unknown as React.FormEvent);
                      }
                    }}
                    placeholder={`Message ${targetUser.displayName}`}
                    rows={1}
                    className="flex-1 min-w-0 resize-none px-4 py-2.5 text-[13.5px] text-[#EDE5D4] placeholder:text-[#6B6259] focus:outline-none leading-[1.5] max-h-[140px] overflow-y-auto rounded-2xl bg-white/[0.035] border border-white/[0.05]"
                  />

                  <AnimatePresence mode="popLayout" initial={false}>
                    {(inputContent.trim().length > 0 || pendingFile) && (
                      <motion.button
                        key="send-btn"
                        type="submit"
                        disabled={isSending}
                        initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={reduceMotion ? undefined : { scale: 0.6, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                        className="shrink-0 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 disabled:cursor-not-allowed text-[#0F0D0A] flex items-center justify-center"
                        title="Send"
                        aria-label="Send"
                      >
                        {isSending ? (
                          <Loader2 className="w-[18px] h-[18px] animate-spin" />
                        ) : (
                          <Send className="w-[18px] h-[18px]" />
                        )}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </form>
              </div>
            </motion.div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-5">
              <User className="w-7 h-7 text-[#6B6259]" />
            </div>
            <h3 className="text-[16px] text-[#EDE5D4] font-semibold mb-2 tracking-tight">
              Select a conversation
            </h3>
            <p className="text-[13px] text-[#6B6259] max-w-[320px] leading-relaxed">
              Pick someone from the list to start messaging.
            </p>
          </div>
        )}
      </div>

      {/* Delete-for-everyone confirmation modal */}
      <AnimatePresence>
        {pendingDeleteEveryoneId != null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPendingDeleteEveryoneId(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 6 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden"
            >
              <div className="p-5">
                <h3 className="text-[14.5px] font-semibold text-[#EDE5D4] mb-1.5">
                  Delete for everyone?
                </h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                  This message will be removed for both you and{' '}
                  {targetUser?.displayName ?? 'the other person'}. Cannot be undone.
                </p>
              </div>
              <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
                <button
                  onClick={() => setPendingDeleteEveryoneId(null)}
                  className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleConfirmDeleteForEveryone()}
                  className="h-9 px-4 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[12.5px] font-medium transition-colors"
                >
                  Delete for everyone
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {targetUser && (
        <InfoModal
          open={infoOpen}
          targetUser={targetUser}
          isFriend={isConfirmedFriend}
          onClose={() => setInfoOpen(false)}
          onUnfriend={handleUnfriend}
          onClear={handleClearConversation}
        />
      )}

      <UserProfileModal
        userId={profileModalUserId}
        onClose={() => setProfileModalUserId(null)}
      />
    </div>
  );
}

export default DirectMessagePane;