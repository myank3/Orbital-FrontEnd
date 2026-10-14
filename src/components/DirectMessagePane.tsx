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
  decryptBatch,
  decryptOne,
  encryptFor,
  getPublicKeyFor,
} from '../services/cryptoService';
import { compressImage } from '../services/imageCompress';
import { playReceive, playSend, unlockSounds } from '../services/sounds';
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
import {
  formatFileSize,
  MAX_FILE_SIZE,
} from '../services/upload';
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
  CheckCheck,
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  EyeOff,
  Info,
  UserMinus,
  Eraser,
  Flag,
  ZoomIn,
  MoreHorizontal,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Date / time helpers — always interpret server dates as UTC */
/* ────────────────────────────────────────────────────────── */

function parseUtc(dateStr: string): Date {
  if (!dateStr) return new Date();
  if (
    dateStr.endsWith('Z') ||
    /[+-]\d{2}:\d{2}$/.test(dateStr) ||
    /[+-]\d{4}$/.test(dateStr)
  ) {
    return new Date(dateStr);
  }
  return new Date(dateStr + 'Z');
}

function formatDayDivider(dateStr: string): string {
  try {
    const d = parseUtc(dateStr);
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
    return parseUtc(dateStr).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatRelativeShort(dateStr: string): string {
  try {
    const then = parseUtc(dateStr).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return parseUtc(dateStr).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function getMessageTime(msg: DirectMessageDto): number {
  return parseUtc(msg.sentAt).getTime();
}

/* ────────────────────────────────────────────────────────── */
/* Sidebar preview snippet                                    */
/* ────────────────────────────────────────────────────────── */

interface LastMessagePreview {
  text: string;
  sentAt: string;
  isMe: boolean;
}

function previewText(msg: DirectMessageDto, myUserId: string): LastMessagePreview {
  const isMe = msg.senderId === myUserId;
  const body = msg.plaintext ?? msg.content ?? '';

  let text: string;
  if (msg.mediaType === MediaType.Image) text = '📷 Photo';
  else if (msg.mediaType === MediaType.Video) text = '🎥 Video';
  else if (msg.mediaType === MediaType.Audio) text = '🎤 Audio';
  else if (msg.mediaType === MediaType.File) text = '📎 File';
  else text = body;

  return { text, sentAt: msg.sentAt, isMe };
}

/* ────────────────────────────────────────────────────────── */
/* Full-size image viewer                                     */
/* ────────────────────────────────────────────────────────── */

interface ImageViewerProps {
  images: Array<{ url: string; senderName: string; sentAt: string }>;
  startIndex: number;
  onClose: () => void;
}

function ImageViewer({ images, startIndex, onClose }: ImageViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const reduceMotion = useReducedMotion();

  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) setIndex((i) => i - 1);
      else if (e.key === 'ArrowRight' && hasNext) setIndex((i) => i + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hasPrev, hasNext]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!current) return null;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3.5 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-10">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-white truncate tracking-tight">
            {current.senderName}
          </p>
          <p className="text-[11px] text-white/50 tabular-nums mt-0.5">
            {formatTime(current.sentAt)}
            {images.length > 1 ? ` · ${index + 1} / ${images.length}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={current.url}
            download
            onClick={(e) => e.stopPropagation()}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="Download"
            aria-label="Download image"
          >
            <Download className="w-[18px] h-[18px]" />
          </a>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
            title="Close"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => Math.max(0, i - 1));
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/[0.08] hover:bg-white/[0.16] backdrop-blur text-white flex items-center justify-center z-10 transition-colors"
          aria-label="Previous"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => Math.min(images.length - 1, i + 1));
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/[0.08] hover:bg-white/[0.16] backdrop-blur text-white flex items-center justify-center z-10 transition-colors"
          aria-label="Next"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      <motion.img
        key={index}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        src={current.url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[88vh] object-contain select-none rounded-lg"
      />
    </motion.div>
  );
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
  onOpenImage: (m: DirectMessageDto, senderName: string) => void;
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
  onOpenImage,
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
  const displayText = message.plaintext ?? message.content ?? '';

  const tailClass = isLastOfGroup
    ? isMe
      ? 'rounded-br-[6px]'
      : 'rounded-bl-[6px]'
    : '';

  return (
    <div
      className={`group/row relative flex gap-3 px-1 ${
        grouped ? 'mt-[3px]' : 'mt-3.5'
      } ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="w-8 shrink-0 pt-0.5">
        {!grouped && !isMe ? (
          <button
            type="button"
            onClick={() => onRequestProfile(message.senderId)}
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50 transition-transform hover:scale-[1.05]"
            aria-label={`View ${senderName}'s profile`}
          >
            <Avatar name={senderName} src={senderAvatar} size="sm" />
          </button>
        ) : (
          <span className="block w-8 h-8" aria-hidden />
        )}
      </div>

      <div
        className={`flex flex-col min-w-0 max-w-[85%] sm:max-w-[72%] md:max-w-[65%] ${
          isMe ? 'items-end' : 'items-start'
        }`}
      >
        {!grouped && (
          <div className="flex items-baseline gap-2 mb-1 px-2">
            <span className="text-[12px] font-semibold text-[#A8A29E] tracking-tight">
              {isMe ? 'You' : senderName}
            </span>
            <span className="text-[10.5px] text-[#5A524A] tabular-nums">
              {formatTime(message.sentAt)}
            </span>
          </div>
        )}

        <div className="relative inline-flex items-end gap-1 max-w-full">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={`hidden sm:flex absolute top-1/2 -translate-y-1/2 ${
              isMe ? '-left-8' : '-right-8'
            } w-6 h-6 rounded-full items-center justify-center text-[#5A524A] hover:text-[#EDE5D4] hover:bg-white/[0.06] opacity-0 group-hover/row:opacity-100 transition-opacity`}
            aria-label="Message options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          <div
            className={`inline-block max-w-full text-[14px] leading-[1.45] break-words rounded-[20px] ${tailClass} ${
              isMe
                ? 'bg-gradient-to-br from-[#E58E1E] to-[#C96A05] text-[#171106] shadow-[0_1px_2px_rgba(0,0,0,0.35)]'
                : 'bg-[#1C1A17] border border-white/[0.05] text-[#F2EDE4]'
            } ${hasMedia ? 'p-1.5' : 'px-3.5 py-2'}`}
          >
            {hasMedia && (
              <div className={displayText ? 'mb-1' : ''}>
                {message.mediaType === MediaType.Image && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenImage(message, senderName);
                    }}
                    className="relative group/img cursor-zoom-in rounded-[14px] overflow-hidden block"
                    aria-label="View full image"
                  >
                    <img
                      src={message.mediaUrl ?? undefined}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="rounded-[14px] max-h-80 w-auto object-cover"
                    />
                    <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                      <ZoomIn className="w-3.5 h-3.5" />
                    </span>
                  </button>
                )}
                {message.mediaType === MediaType.Video && (
                  <video
                    src={message.mediaUrl ?? undefined}
                    controls
                    preload="metadata"
                    className="rounded-[14px] max-h-80 w-full bg-black"
                  />
                )}
                {message.mediaType === MediaType.Audio && (
                  <audio
                    src={message.mediaUrl ?? undefined}
                    controls
                    preload="metadata"
                    className="w-full my-0.5"
                  />
                )}
                {message.mediaType === MediaType.File && (
                  <a
                    href={message.mediaUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-[14px] text-[12.5px] ${
                      isMe
                        ? 'bg-black/[0.14] text-[#171106]'
                        : 'bg-white/[0.04] text-[#F2EDE4]'
                    }`}
                  >
                    <FileText className="w-4 h-4 shrink-0 opacity-70" />
                    <span className="truncate max-w-[180px]">Attached file</span>
                    <Download className="w-3.5 h-3.5 shrink-0 ml-1 opacity-70" />
                  </a>
                )}
              </div>
            )}

            {displayText && (
              <p className={`whitespace-pre-wrap ${hasMedia ? 'px-1.5 pb-1 pt-0' : ''}`}>
                {displayText}
              </p>
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
                className={`absolute z-40 top-full mt-1.5 ${
                  isMe ? 'right-0' : 'left-0'
                } min-w-[190px] rounded-2xl bg-[#1C1A17] border border-white/[0.08] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.9)] overflow-hidden backdrop-blur-md`}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteForMe(message);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                >
                  <EyeOff className="w-3.5 h-3.5 opacity-70" />
                  <span>Delete for me</span>
                </button>

                {isMe && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteForEveryone(message);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px] text-[#F87171] hover:bg-[#B91C1C]/[0.10] transition-colors border-t border-white/[0.04]"
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
          <div className="flex items-center gap-1.5 mt-1 px-2">
            <CheckCheck
              className={`w-3 h-3 transition-colors ${
                message.isRead ? 'text-[#4ADE80]' : 'text-[#5A524A]'
              }`}
            />
            <span className="text-[10px] text-[#5A524A] tabular-nums">
              {message.isRead ? 'Read' : 'Sent'}
            </span>
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

  const confirmCopy: Record<
    NonNullable<InfoAction>,
    { title: string; body: string; cta: string }
  > = {
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
            className="w-full max-w-sm rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden"
          >
            <div className="p-6 flex flex-col items-center text-center border-b border-white/[0.06]">
              <div className="p-[3px] rounded-full bg-gradient-to-tr from-[#D97706]/50 via-[#D97706]/20 to-transparent">
                <div className="p-[3px] rounded-full bg-[#1C1A17]">
                  <Avatar
                    name={targetUser.displayName}
                    src={targetUser.avatarUrl}
                    size="xl"
                    isOnline={presenceStore.isOnline(targetUser.id)}
                  />
                </div>
              </div>
              <p className="mt-4 text-[15.5px] font-semibold text-[#EDE5D4] tracking-tight">
                {targetUser.displayName}
              </p>
              <p className="text-[12px] text-[#7A6F65] mt-0.5">
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
                <div className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#5A524A] cursor-not-allowed">
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

            <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2">
              {!confirmAction ? (
                <button
                  onClick={handleClose}
                  className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setConfirmAction(null);
                      setError(null);
                    }}
                    disabled={busy}
                    className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] text-[#EDE5D4] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => void runAction(confirmAction)}
                    disabled={busy}
                    className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5"
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
  const { initiateCall } = useCall();
  const reduceMotion = useReducedMotion();

  const { onType, stop: stopTyping } = useDmTypingEmitter(userId);
  const isPeerTyping = useDmTypingReceiver(userId);

  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [targetUser, setTargetUser] = useState<UserProfileDto | null>(null);
  const [messages, setMessages] = useState<DirectMessageDto[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [inputContent, setInputContent] = useState('');

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [friendRequestStatus, setFriendRequestStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [lastMessages, setLastMessages] = useState<Record<string, DirectMessageDto>>({});

  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<
    string | number | null
  >(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);

  const [viewerOpenIndex, setViewerOpenIndex] = useState<number | null>(null);

  const [composerVisible, setComposerVisible] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

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

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (friends.length === 0 || !user?.id) return;
    let active = true;

    const seedPreviews = async () => {
      const results = await Promise.all(
        friends.map(async (f) => {
          try {
            const history = await apiService.getDmHistory(f.userId, 1);
            if (history.length === 0) return null;
            const decrypted = await decryptBatch(history, user.id);
            return { userId: f.userId, msg: decrypted[0] };
          } catch {
            return null;
          }
        }),
      );

      if (!active) return;

      setLastMessages((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (!r) continue;
          const existing = next[r.userId];
          if (!existing || getMessageTime(r.msg) > getMessageTime(existing)) {
            next[r.userId] = r.msg;
          }
        }
        return next;
      });
    };

    void seedPreviews();
    return () => {
      active = false;
    };
  }, [friends, user?.id]);

  const isConfirmedFriend = useMemo(() => {
    if (!userId) return false;
    return friends.some((f) => f.userId === userId);
  }, [userId, friends]);

  const isTargetOnline = presenceStore.isOnline(userId);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = [...friends];
    const list = q
      ? base.filter(
          (f) =>
            f.displayName.toLowerCase().includes(q) ||
            (f.handle ?? '').toLowerCase().includes(q),
        )
      : base;

    list.sort((a, b) => {
      const ma = lastMessages[a.userId];
      const mb = lastMessages[b.userId];
      const ta = ma ? getMessageTime(ma) : 0;
      const tb = mb ? getMessageTime(mb) : 0;
      return tb - ta;
    });

    return list;
  }, [friends, searchQuery, lastMessages]);

  const chatImages = useMemo(
    () =>
      messages
        .filter((m) => m.mediaType === MediaType.Image && m.mediaUrl)
        .map((m) => ({
          url: m.mediaUrl as string,
          senderName: m.senderId === user?.id ? 'You' : targetUser?.displayName ?? 'Them',
          sentAt: m.sentAt,
        })),
    [messages, user?.id, targetUser?.displayName],
  );

  const handleOpenImage = useCallback(
    (m: DirectMessageDto, _senderName: string) => {
      const idx = chatImages.findIndex((img) => img.url === m.mediaUrl);
      if (idx >= 0) setViewerOpenIndex(idx);
    },
    [chatImages],
  );

  useEffect(() => {
    if (!userId) {
      setTargetUser(null);
      setMessages([]);
      return;
    }
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
    return () => {
      active = false;
    };
  }, [userId, friends]);

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
      setHistoryError(null);
      try {
        const history = await apiService.getDmHistory(userId, 50);
        if (!active) return;

        const sorted = [...history].sort(
          (a, b) => getMessageTime(a) - getMessageTime(b),
        );
        const decrypted = await decryptBatch(sorted, user?.id ?? '');
        if (!active) return;

        setMessages(decrypted);
        setHasMore(history.length >= 50);

        if (decrypted.length > 0) {
          const latest = decrypted[decrypted.length - 1];
          setLastMessages((prev) => ({ ...prev, [userId]: latest }));
        }

        void apiService.markDmRead(userId);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 50);
      } catch (err) {
        if (!active) return;
        console.error('Error fetching DM history:', err);
        setHistoryError(
          extractErrorMessage(err, 'Could not load messages. Tap retry.'),
        );
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    void fetchHistory();
    return () => {
      active = false;
    };
  }, [userId, user?.id]);

  const handleLoadEarlier = async () => {
    if (!userId || loadingMore || !hasMore || messages.length === 0) return;
    const oldestMessageId = messages[0].id;
    setLoadingMore(true);
    try {
      const earlier = await apiService.getDmHistory(userId, 50, oldestMessageId);
      if (earlier.length > 0) {
        const sortedEarlier = [...earlier].sort(
          (a, b) => getMessageTime(a) - getMessageTime(b),
        );
        const decrypted = await decryptBatch(sortedEarlier, user?.id ?? '');
        setMessages((prev) => [...decrypted, ...prev]);
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
    const unsub = signalRService.onReceiveDirectMessage(async (msg: DirectMessageDto) => {
      const decrypted = await decryptOne(msg, user?.id ?? '');

      const otherId = msg.senderId === user?.id ? msg.recipientId : msg.senderId;
      if (otherId) {
        setLastMessages((prev) => {
          const existing = prev[otherId];
          if (existing && getMessageTime(existing) >= getMessageTime(decrypted)) {
            return prev;
          }
          return { ...prev, [otherId]: decrypted };
        });
      }

      const isCurrentChat =
        (msg.senderId === userId && msg.recipientId === user?.id) ||
        (msg.senderId === user?.id && msg.recipientId === userId);

      if (isCurrentChat) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, decrypted];
        });
        if (msg.senderId === userId) {
          playReceive();
          void apiService.markDmRead(userId);
        }
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      } else if (msg.recipientId === user?.id && msg.senderId !== user?.id) {
        playReceive();
        setUnreadCounts((prev) => ({
          ...prev,
          [msg.senderId]: (prev[msg.senderId] ?? 0) + 1,
        }));
      }
    });
    return () => {
      unsub();
    };
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

  /* ─────────────────────────────────────────────────────────
     FILE PICKER — images only, 5 MB cap after compression
     ───────────────────────────────────────────────────────── */

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const accepted: File[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        setFileError(`${file.name}: only images can be sent.`);
        continue;
      }

      let toSend = file;
      try {
        toSend = await compressImage(file);
      } catch {
        toSend = file;
      }

      if (toSend.size > MAX_FILE_SIZE) {
        setFileError(
          `${file.name}: still ${formatFileSize(toSend.size)} after compression — max is ${formatFileSize(MAX_FILE_SIZE)}.`,
        );
        continue;
      }

      accepted.push(toSend);
    }

    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted]);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /* ─────────────────────────────────────────────────────────
     SEND — images as base64 data URLs (no upload endpoint)
     ───────────────────────────────────────────────────────── */

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (!inputContent.trim() && pendingFiles.length === 0) return;

    stopTyping();
    setIsSending(true);
    setFileError(null);

    const text = inputContent.trim();
    const filesToSend = [...pendingFiles];

    try {
      if (filesToSend.length > 0) {
        for (let i = 0; i < filesToSend.length; i++) {
          const file = filesToSend[i];

          if (!file.type.startsWith('image/')) {
            setFileError(`${file.name}: only images can be sent.`);
            continue;
          }

          if (file.size > MAX_FILE_SIZE) {
            setFileError(
              `${file.name} is ${formatFileSize(file.size)} — max is ${formatFileSize(MAX_FILE_SIZE)}.`,
            );
            continue;
          }

          // Read as base64 data URL — matches the existing backend,
          // which stores MediaUrl directly.
          const reader = new FileReader();
          const dataUrlPromise = new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
          });
          reader.readAsDataURL(file);
          const mediaUrl = await dataUrlPromise;
          const mediaType = MediaType.Image;

          const includeText = i === 0 && text.length > 0;
          let ciphertext = '';
          let nonce = '';
          if (includeText) {
            const recipientPub = await getPublicKeyFor(userId);
            const enc = await encryptFor(recipientPub, text);
            ciphertext = enc.ciphertext;
            nonce = enc.nonce;
          }

          await signalRService.sendDirectMessage({
            recipientId: userId,
            ciphertext,
            nonce,
            mediaUrl,
            mediaType,
          });

          playSend();
        }
      } else if (text.length > 0) {
        const recipientPub = await getPublicKeyFor(userId);
        const enc = await encryptFor(recipientPub, text);

        await signalRService.sendDirectMessage({
          recipientId: userId,
          ciphertext: enc.ciphertext,
          nonce: enc.nonce,
          mediaUrl: undefined,
          mediaType: undefined,
        });

        playSend();
      }

      setInputContent('');
      setPendingFiles([]);
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
        [...prev, m].sort((a, b) => getMessageTime(a) - getMessageTime(b)),
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
            (a, b) => getMessageTime(a) - getMessageTime(b),
          );
          const decrypted = await decryptBatch(sorted, user?.id ?? '');
          setMessages(decrypted);
        } catch {
          /* ignore */
        }
      }
      alert(`Delete for everyone failed: ${extractErrorMessage(err)}`);
    }
  }, [pendingDeleteEveryoneId, userId, user?.id]);

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
    setLastMessages((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
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
      const day = parseUtc(m.sentAt).toDateString();
      if (day !== lastDate) {
        out.push({ type: 'date', key: `d-${day}`, label: formatDayDivider(m.sentAt) });
        lastDate = day;
        lastSenderId = '';
        lastTs = 0;
      }

      const ts = getMessageTime(m);
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
    <div className="flex h-full w-full bg-[#0A0908] text-[#EDE5D4] overflow-hidden">
      {/* LEFT: conversation list */}
      <div
        className={`${
          hasActiveChat ? 'hidden md:flex' : 'flex'
        } w-full md:w-[320px] md:shrink-0 border-r border-white/[0.05] bg-[#0D0C0A] flex-col h-full`}
      >
        <div className="h-[68px] px-5 flex items-center justify-between shrink-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[20px] font-semibold text-[#EDE5D4] tracking-tight">
              Chats
            </h2>
            <span className="text-[11.5px] text-[#5A524A] tabular-nums">
              {friends.length}
            </span>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5A524A] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations"
              className="w-full h-10 pl-10 pr-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-[13px] text-[#EDE5D4] placeholder:text-[#5A524A] focus:outline-none focus:border-[#D97706]/40 focus:bg-white/[0.05] transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-0.5">
          {filteredFriends.length === 0 ? (
            <div className="p-8 text-center text-[12.5px] text-[#5A524A]">
              {friends.length === 0 ? 'No contacts yet.' : 'No matches.'}
            </div>
          ) : (
            filteredFriends.map((friend) => {
              const isSelected = friend.userId === userId;
              const isOnline = presenceStore.isOnline(friend.userId);
              const unread = unreadCounts[friend.userId] ?? 0;
              const last = lastMessages[friend.userId];
              const preview: LastMessagePreview | null =
                last && user?.id ? previewText(last, user.id) : null;

              return (
                <button
                  key={friend.friendshipId}
                  onClick={() => navigate(`/app/dm/${friend.userId}`)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all duration-150 ${
                    isSelected
                      ? 'bg-white/[0.06] ring-1 ring-inset ring-white/[0.06]'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <Avatar
                    name={friend.displayName}
                    src={friend.avatarUrl}
                    size="md"
                    isOnline={isOnline}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13.5px] font-semibold text-[#EDE5D4] truncate tracking-tight">
                        {friend.displayName}
                      </p>
                      {preview && (
                        <span
                          className={`shrink-0 text-[10.5px] tabular-nums ${
                            unread > 0 ? 'text-[#D97706]' : 'text-[#5A524A]'
                          }`}
                        >
                          {formatRelativeShort(preview.sentAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className={`text-[11.5px] truncate ${
                          unread > 0 ? 'text-[#EDE5D4] font-medium' : 'text-[#7A6F65]'
                        }`}
                      >
                        {preview
                          ? `${preview.isMe ? 'You: ' : ''}${preview.text}`
                          : `@${friend.handle}`}
                      </p>
                      {unread > 0 && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#D97706] text-[#171106] text-[10px] font-bold tabular-nums flex items-center justify-center">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                  </div>
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
        } flex-1 flex-col h-full min-w-0 bg-[#0A0908] relative`}
      >
        {userId && targetUser ? (
          <>
            <div className="h-[68px] px-3 sm:px-5 border-b border-white/[0.05] bg-[#0A0908]/80 backdrop-blur-xl flex items-center justify-between shrink-0 gap-2 z-10">
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
                  className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50 transition-transform hover:scale-[1.03]"
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
                  <h3 className="text-[14.5px] font-semibold text-[#EDE5D4] truncate tracking-tight">
                    {targetUser.displayName}
                  </h3>
                  <p className="text-[11px] text-[#7A6F65] truncate mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isTargetOnline ? 'bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-[#5A524A]'
                      }`}
                    />
                    <span>
                      {isTargetOnline ? 'Active now' : 'Offline'}
                      <span className="text-[#5A524A] hidden sm:inline">
                        {' '}· @{targetUser.userHandle}
                      </span>
                    </span>
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

            {!isConfirmedFriend && (
              <div className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#D97706]/[0.06] border-b border-[#D97706]/20 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
                <div className="flex items-center gap-2 text-[#A8A29E] min-w-0">
                  <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0" />
                  <span className="truncate">You're not friends yet — messaging is limited.</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {friendRequestStatus && (
                    <span className="text-[11.5px] text-[#4ADE80]">{friendRequestStatus}</span>
                  )}
                  <button
                    onClick={() => void handleSendFriendRequest()}
                    className="h-7 px-3 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-[#171106] text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-colors"
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
              className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-5"
            >
              {hasMore && !loadingHistory && (
                <div className="text-center pb-4">
                  <button
                    onClick={() => void handleLoadEarlier()}
                    disabled={loadingMore}
                    className="px-3.5 py-1.5 rounded-full bg-white/[0.035] border border-white/[0.06] text-[11.5px] text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
                  >
                    {loadingMore ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              )}

              {loadingHistory ? (
                <MessageSkeleton />
              ) : historyError ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div className="w-14 h-14 rounded-2xl bg-[#B91C1C]/[0.10] border border-[#B91C1C]/30 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-[#F87171]" />
                  </div>
                  <div>
                    <p className="text-[14px] text-[#EDE5D4] font-semibold tracking-tight">
                      Couldn't load messages
                    </p>
                    <p className="text-[12.5px] text-[#A8A29E] mt-1 max-w-[300px]">
                      {historyError}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const current = userId;
                      navigate('/app/dm');
                      setTimeout(() => navigate(`/app/dm/${current}`), 10);
                    }}
                    className="h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#171106] text-[12.5px] font-semibold transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#D97706]/20 to-transparent flex items-center justify-center">
                      <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                        <User className="w-6 h-6 text-[#7A6F65]" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-[15px] text-[#EDE5D4] font-semibold tracking-tight">
                      No messages yet
                    </p>
                    <p className="text-[12.5px] text-[#7A6F65] mt-1">
                      Say hi to {targetUser.displayName}.
                    </p>
                  </div>
                </div>
              ) : (
                grouped.map((item) => {
                  if (item.type === 'date') {
                    return (
                      <div key={item.key} className="flex justify-center my-5">
                        <span className="px-3 py-1 rounded-full bg-white/[0.035] border border-white/[0.05] text-[10.5px] uppercase tracking-[0.14em] text-[#7A6F65] font-medium">
                          {item.label}
                        </span>
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
                      onOpenImage={handleOpenImage}
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
                    <div className="w-8 shrink-0">
                      <Avatar
                        name={targetUser.displayName}
                        src={targetUser.avatarUrl}
                        size="sm"
                      />
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-4 py-3 rounded-[20px] rounded-bl-[6px] bg-[#1C1A17] border border-white/[0.05]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A8A29E] animate-bounce [animation-delay:-0.32s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A8A29E] animate-bounce [animation-delay:-0.16s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#A8A29E] animate-bounce" />
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
                  className="absolute bottom-24 right-6 z-30 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] text-[#171106] shadow-[0_8px_24px_-6px_rgba(217,119,6,0.5)] flex items-center justify-center transition-colors"
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
              <div className="border-t border-white/[0.05] bg-[#0A0908]/80 backdrop-blur-xl px-2 sm:px-4 py-2.5 sm:py-3.5">
                <AnimatePresence>
                  {pendingFiles.length > 0 && (
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 6, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: 6, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="pb-2 sm:pb-3 overflow-hidden"
                    >
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {pendingFiles.map((file, index) => {
                          const isImage = file.type.startsWith('image/');
                          const previewUrl = isImage ? URL.createObjectURL(file) : null;
                          return (
                            <div
                              key={`${file.name}-${index}`}
                              className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-white/[0.035] border border-white/[0.06]"
                            >
                              {isImage && previewUrl ? (
                                <img
                                  src={previewUrl}
                                  alt={file.name}
                                  className="w-full h-full object-cover"
                                  onLoad={() => URL.revokeObjectURL(previewUrl)}
                                />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center px-1 text-center">
                                  <FileText className="w-5 h-5 text-[#D97706]" />
                                  <span className="text-[9px] text-[#7A6F65] truncate w-full mt-1">
                                    {file.name}
                                  </span>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => removePendingFile(index)}
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 hover:bg-[#B91C1C] text-white flex items-center justify-center transition-colors"
                                aria-label={`Remove ${file.name}`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-[#7A6F65] mt-1.5">
                        {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} ready to send
                      </p>
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
                      <div className="flex items-center gap-1.5 text-[12px] text-[#F87171] px-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{fileError}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*"
                    className="hidden"
                    multiple
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                    title="Attach image"
                    aria-label="Attach image"
                  >
                    <Paperclip className="w-[18px] h-[18px]" />
                  </button>

                  <div className="flex-1 min-w-0 relative">
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
                      className="w-full resize-none px-4 py-2.5 text-[14px] text-[#EDE5D4] placeholder:text-[#5A524A] focus:outline-none leading-[1.5] max-h-[140px] overflow-y-auto rounded-[22px] bg-white/[0.045] border border-white/[0.06] focus:border-[#D97706]/40 focus:bg-white/[0.06] transition-colors"
                    />
                  </div>

                  <AnimatePresence mode="popLayout" initial={false}>
                    {(inputContent.trim().length > 0 || pendingFiles.length > 0) && (
                      <motion.button
                        key="send-btn"
                        type="submit"
                        disabled={isSending}
                        initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={reduceMotion ? undefined : { scale: 0.6, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                        className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-[#E58E1E] to-[#C96A05] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-[#171106] flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(217,119,6,0.4)]"
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
            <div className="relative mb-6">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#D97706]/15 to-transparent flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                  <User className="w-7 h-7 text-[#7A6F65]" />
                </div>
              </div>
            </div>
            <h3 className="text-[17px] text-[#EDE5D4] font-semibold mb-2 tracking-tight">
              Your messages
            </h3>
            <p className="text-[13px] text-[#7A6F65] max-w-[320px] leading-relaxed">
              Pick a conversation from the list to start chatting.
            </p>
          </div>
        )}
      </div>

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
              className="w-full max-w-sm rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden"
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
              <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2">
                <button
                  onClick={() => setPendingDeleteEveryoneId(null)}
                  className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleConfirmDeleteForEveryone()}
                  className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[12.5px] font-medium transition-colors"
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

      <AnimatePresence>
        {viewerOpenIndex != null && (
          <ImageViewer
            images={chatImages}
            startIndex={viewerOpenIndex}
            onClose={() => setViewerOpenIndex(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default DirectMessagePane;