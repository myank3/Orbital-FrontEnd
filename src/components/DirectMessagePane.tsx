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
import { formatFileSize, MAX_FILE_SIZE } from '../services/upload';
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
  Check,
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  EyeOff,
  Eye,
  Info,
  UserMinus,
  Eraser,
  Flag,
  ZoomIn,
  MoreHorizontal,
  Palette,
  ExternalLink,
  Link2,
  Pin,
  PinOff,
  Bell,
  BellOff,
  ShieldOff,
  Smile,
  Mic,
  Reply,
  Copy,
  CornerUpLeft,
} from 'lucide-react';
import {
  EmojiPanel,
  AttachmentSheet,
  VoiceRecorder,
  type VoiceRecording,
} from './dm/ComposerToolkit';

/* ────────────────────────────────────────────────────────── */
/* Animated theme CSS                                         */
/* ────────────────────────────────────────────────────────── */

const THEME_ANIMATIONS = `
@keyframes theme-drift {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(-2%, 2%, 0) scale(1.05); }
}
@keyframes theme-breathe {
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50% { transform: scale(1.08); opacity: 0.85; }
}
@keyframes theme-scan {
  0% { background-position: 0 0; }
  100% { background-position: 0 8px; }
}
@keyframes theme-twinkle {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.9; transform: scale(1.02); }
}
@keyframes theme-aurora {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(0deg); }
  33% { transform: translate3d(3%, -2%, 0) rotate(120deg); }
  66% { transform: translate3d(-2%, 3%, 0) rotate(240deg); }
}
@keyframes theme-pulse-glow {
  0%, 100% { filter: blur(45px) brightness(1); }
  50% { filter: blur(50px) brightness(1.3); }
}
@keyframes bubble-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes react-pop {
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  [class*="theme-anim-"] { animation: none !important; }
}
`;

/* ────────────────────────────────────────────────────────── */
/* Themes                                                     */
/* ────────────────────────────────────────────────────────── */

type ChatThemeKey =
  | 'obsidian'
  | 'paper'
  | 'terminal'
  | 'rose'
  | 'cobalt'
  | 'mint'
  | 'crimson'
  | 'void';

interface ChatTheme {
  label: string;
  swatch: string;
  isLight: boolean;
  bg: string;
  sidebarBg: string;
  sidebarActive: string;
  composerBg: string;
  bubbleSent: string;
  bubbleReceived: string;
  accent: string;
  accentText: string;
  glow: string;
  textPrimary: string;
  textSecondary: string;
  subtleBg: string;
  subtleBgStrong: string;
  subtleBorder: string;
  hoverBg: string;
  ambientStyle?: React.CSSProperties;
  ambientClass?: string;
}

const CHAT_THEMES: Record<ChatThemeKey, ChatTheme> = {
  obsidian: {
    label: 'Obsidian',
    swatch: 'linear-gradient(135deg, #2A2A2A, #050505)',
    isLight: false,
    bg: 'bg-[#080808]',
    sidebarBg: 'bg-[#0E0E0E]',
    sidebarActive: 'bg-white/[0.08] ring-1 ring-inset ring-white/[0.08]',
    composerBg: 'bg-[#0E0E0E]/90',
    bubbleSent: 'bg-[#2E2E2E] text-white shadow-sm',
    bubbleReceived: 'bg-[#181818] text-[#EDEDED] border border-white/[0.04]',
    accent: 'bg-white hover:bg-[#E5E5E5] text-black shadow-sm',
    accentText: 'text-white',
    glow: 'shadow-none',
    textPrimary: 'text-white',
    textSecondary: 'text-[#949494]',
    subtleBg: 'bg-white/[0.04]',
    subtleBgStrong: 'bg-white/[0.08]',
    subtleBorder: 'border-white/[0.08]',
    hoverBg: 'hover:bg-white/[0.05]',
  },
  paper: {
    label: 'Paper',
    swatch: 'linear-gradient(135deg, #F5F1EA, #B8894A)',
    isLight: true,
    bg: 'bg-[#F7F4EE]',
    sidebarBg: 'bg-[#EFE8DD]',
    sidebarActive: 'bg-black/[0.06] ring-1 ring-inset ring-black/[0.06]',
    composerBg: 'bg-[#F7F4EE]/95',
    bubbleSent: 'bg-[#B8894A] text-white shadow-sm',
    bubbleReceived:
      'bg-white text-[#1F1B16] shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-black/[0.05]',
    accent: 'bg-[#B8894A] hover:bg-[#9F7439] text-white shadow-sm',
    accentText: 'text-[#B8894A]',
    glow: 'shadow-[0_1px_3px_rgba(0,0,0,0.06)]',
    textPrimary: 'text-[#1F1B16]',
    textSecondary: 'text-[#857B72]',
    subtleBg: 'bg-black/[0.03]',
    subtleBgStrong: 'bg-black/[0.06]',
    subtleBorder: 'border-black/[0.07]',
    hoverBg: 'hover:bg-black/[0.05]',
  },
  terminal: {
    label: 'Terminal',
    swatch: 'linear-gradient(135deg, #22C55E, #07100A)',
    isLight: false,
    bg: 'bg-[#07100A]',
    sidebarBg: 'bg-[#0A1A0F]',
    sidebarActive: 'bg-[#22C55E]/[0.12] ring-1 ring-inset ring-[#22C55E]/30',
    composerBg: 'bg-[#07100A]/95',
    bubbleSent: 'bg-[#14361F] text-[#A7F3D0] border border-[#22C55E]/40',
    bubbleReceived: 'bg-[#0D2214] text-[#86EFAC] border border-[#22C55E]/[0.18]',
    accent: 'bg-[#22C55E] hover:bg-[#16A34A] text-[#07100A]',
    accentText: 'text-[#22C55E]',
    glow: 'shadow-[0_0_12px_-2px_rgba(34,197,94,0.3)]',
    textPrimary: 'text-[#86EFAC]',
    textSecondary: 'text-[#4D8060]',
    subtleBg: 'bg-white/[0.02]',
    subtleBgStrong: 'bg-white/[0.06]',
    subtleBorder: 'border-[#22C55E]/[0.12]',
    hoverBg: 'hover:bg-[#22C55E]/[0.08]',
    ambientClass: 'theme-anim-terminal',
    ambientStyle: {
      background:
        'repeating-linear-gradient(0deg, rgba(34,197,94,0.05) 0px, rgba(34,197,94,0.05) 1px, transparent 1px, transparent 6px)',
      animation: 'theme-scan 4s linear infinite',
    },
  },
  rose: {
    label: 'Rose',
    swatch: 'linear-gradient(135deg, #FB7185, #F9A8D4)',
    isLight: true,
    bg: 'bg-[#FFF0F4]',
    sidebarBg: 'bg-[#FFE2EC]',
    sidebarActive: 'bg-[#FB7185]/[0.12] ring-1 ring-inset ring-[#FB7185]/30',
    composerBg: 'bg-[#FFF0F4]/95',
    bubbleSent:
      'bg-gradient-to-br from-[#FB7185] to-[#F43F5E] text-white shadow-[0_2px_8px_-2px_rgba(251,113,133,0.4)]',
    bubbleReceived:
      'bg-white text-[#4A1B2C] shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#FB7185]/[0.12]',
    accent: 'bg-[#FB7185] hover:bg-[#E11D48] text-white',
    accentText: 'text-[#FB7185]',
    glow: 'shadow-[0_2px_8px_-2px_rgba(251,113,133,0.35)]',
    textPrimary: 'text-[#4A1B2C]',
    textSecondary: 'text-[#9A7280]',
    subtleBg: 'bg-black/[0.03]',
    subtleBgStrong: 'bg-black/[0.06]',
    subtleBorder: 'border-black/[0.07]',
    hoverBg: 'hover:bg-black/[0.05]',
    ambientStyle: {
      background:
        'radial-gradient(60% 50% at 80% 0%, rgba(251,113,133,0.12), transparent 60%), radial-gradient(50% 50% at 0% 100%, rgba(244,114,182,0.10), transparent 60%)',
      animation: 'theme-breathe 12s ease-in-out infinite',
      filter: 'blur(50px)',
    },
  },
  cobalt: {
    label: 'Cobalt',
    swatch: 'linear-gradient(135deg, #3B82F6, #0A1628)',
    isLight: false,
    bg: 'bg-[#0A1628]',
    sidebarBg: 'bg-[#0D1E36]',
    sidebarActive: 'bg-[#3B82F6]/[0.15] ring-1 ring-inset ring-[#3B82F6]/35',
    composerBg: 'bg-[#0A1628]/90',
    bubbleSent:
      'bg-gradient-to-br from-[#2563EB] to-[#3B82F6] text-white shadow-[0_2px_12px_-2px_rgba(59,130,246,0.4)]',
    bubbleReceived:
      'bg-[#132238] text-[#DBEAFE] border border-[#3B82F6]/[0.15]',
    accent: 'bg-[#3B82F6] hover:bg-[#2563EB] text-white',
    accentText: 'text-[#60A5FA]',
    glow: 'shadow-[0_2px_12px_-2px_rgba(59,130,246,0.4)]',
    textPrimary: 'text-[#DBEAFE]',
    textSecondary: 'text-[#6E8EB8]',
    subtleBg: 'bg-white/[0.04]',
    subtleBgStrong: 'bg-white/[0.07]',
    subtleBorder: 'border-white/[0.08]',
    hoverBg: 'hover:bg-white/[0.05]',
    ambientClass: 'theme-anim-cobalt',
    ambientStyle: {
      background:
        'radial-gradient(55% 45% at 20% 0%, rgba(59,130,246,0.14), transparent 60%), radial-gradient(50% 50% at 100% 100%, rgba(37,99,235,0.12), transparent 60%)',
      animation: 'theme-drift 16s ease-in-out infinite',
      filter: 'blur(45px)',
    },
  },
  mint: {
    label: 'Mint',
    swatch: 'linear-gradient(135deg, #34D399, #F0FDF4)',
    isLight: true,
    bg: 'bg-[#EFFDF4]',
    sidebarBg: 'bg-[#DAFBE5]',
    sidebarActive: 'bg-[#34D399]/[0.15] ring-1 ring-inset ring-[#34D399]/35',
    composerBg: 'bg-[#EFFDF4]/95',
    bubbleSent:
      'bg-gradient-to-br from-[#10B981] to-[#34D399] text-white shadow-[0_2px_8px_-2px_rgba(52,211,153,0.4)]',
    bubbleReceived:
      'bg-white text-[#052E16] shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#34D399]/[0.18]',
    accent: 'bg-[#10B981] hover:bg-[#059669] text-white',
    accentText: 'text-[#059669]',
    glow: 'shadow-[0_2px_8px_-2px_rgba(52,211,153,0.35)]',
    textPrimary: 'text-[#052E16]',
    textSecondary: 'text-[#487358]',
    subtleBg: 'bg-black/[0.03]',
    subtleBgStrong: 'bg-black/[0.06]',
    subtleBorder: 'border-black/[0.07]',
    hoverBg: 'hover:bg-black/[0.05]',
    ambientStyle: {
      background:
        'radial-gradient(55% 50% at 0% 0%, rgba(52,211,153,0.12), transparent 60%), radial-gradient(50% 50% at 100% 100%, rgba(16,185,129,0.10), transparent 60%)',
      animation: 'theme-breathe 14s ease-in-out infinite',
      filter: 'blur(50px)',
    },
  },
  crimson: {
    label: 'Crimson',
    swatch: 'linear-gradient(135deg, #DC2626, #150404)',
    isLight: false,
    bg: 'bg-[#150404]',
    sidebarBg: 'bg-[#200707]',
    sidebarActive: 'bg-[#DC2626]/[0.15] ring-1 ring-inset ring-[#DC2626]/35',
    composerBg: 'bg-[#150404]/90',
    bubbleSent:
      'bg-gradient-to-br from-[#DC2626] to-[#991B1B] text-white shadow-[0_2px_12px_-2px_rgba(220,38,38,0.35)]',
    bubbleReceived: 'bg-[#280909] text-[#FEE2E2] border border-[#DC2626]/[0.16]',
    accent: 'bg-[#DC2626] hover:bg-[#B91C1C] text-white',
    accentText: 'text-[#F87171]',
    glow: 'shadow-[0_2px_12px_-2px_rgba(220,38,38,0.35)]',
    textPrimary: 'text-[#FEE2E2]',
    textSecondary: 'text-[#966161]',
    subtleBg: 'bg-white/[0.03]',
    subtleBgStrong: 'bg-white/[0.07]',
    subtleBorder: 'border-white/[0.08]',
    hoverBg: 'hover:bg-white/[0.05]',
    ambientClass: 'theme-anim-crimson',
    ambientStyle: {
      background:
        'radial-gradient(60% 50% at 50% 100%, rgba(220,38,38,0.14), transparent 60%), radial-gradient(40% 40% at 20% 0%, rgba(153,27,27,0.12), transparent 60%)',
      animation: 'theme-breathe 12s ease-in-out infinite',
      filter: 'blur(45px)',
    },
  },
  void: {
    label: 'Void',
    swatch: 'linear-gradient(135deg, #A855F7, #05010F)',
    isLight: false,
    bg: 'bg-[#05010F]',
    sidebarBg: 'bg-[#0E061B]',
    sidebarActive: 'bg-[#A855F7]/[0.15] ring-1 ring-inset ring-[#A855F7]/35',
    composerBg: 'bg-[#05010F]/90',
    bubbleSent:
      'bg-gradient-to-br from-[#7C3AED] via-[#A855F7] to-[#C084FC] text-white shadow-[0_2px_16px_-2px_rgba(168,85,247,0.5)]',
    bubbleReceived:
      'bg-[#120822] text-[#F3E8FF] border border-[#A855F7]/[0.20]',
    accent: 'bg-[#A855F7] hover:bg-[#9333EA] text-white',
    accentText: 'text-[#C084FC]',
    glow: 'shadow-[0_2px_16px_-2px_rgba(168,85,247,0.5)]',
    textPrimary: 'text-[#F3E8FF]',
    textSecondary: 'text-[#7D5F9F]',
    subtleBg: 'bg-white/[0.04]',
    subtleBgStrong: 'bg-white/[0.07]',
    subtleBorder: 'border-white/[0.08]',
    hoverBg: 'hover:bg-white/[0.05]',
    ambientClass: 'theme-anim-void',
    ambientStyle: {
      background:
        'radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,0.7), transparent 50%), radial-gradient(1.5px 1.5px at 60% 70%, rgba(192,132,252,0.8), transparent 50%), radial-gradient(1px 1px at 80% 20%, rgba(255,255,255,0.6), transparent 50%), radial-gradient(2px 2px at 30% 80%, rgba(168,85,247,0.8), transparent 50%), radial-gradient(1.5px 1.5px at 75% 50%, rgba(192,132,252,0.7), transparent 50%), radial-gradient(60% 50% at 50% 0%, rgba(124,58,237,0.16), transparent 60%), radial-gradient(50% 50% at 50% 100%, rgba(168,85,247,0.12), transparent 60%)',
      animation: 'theme-twinkle 8s ease-in-out infinite',
    },
  },
};

/* ────────────────────────────────────────────────────────── */
/* Reactions + replies — encoding layer                       */
/* ────────────────────────────────────────────────────────── */

const REACT_RE = /^\[react:(-?\d+):([^:\]]+)(?::(add|remove))?\]$/;
const REPLY_RE = /^\[reply:(-?\d+)\]/;
const V1_RE = /^\[v1\]/;

export interface ReactionEntry {
  emoji: string;
  userId: string;
}

export interface DecodedMessage {
  viewOnce: boolean;
  body: string;
  replyToId: number | null;
  isReaction: false;
}

export interface DecodedReaction {
  isReaction: true;
  messageId: number;
  emoji: string;
  action: 'add' | 'remove';
}

export type Decoded = DecodedMessage | DecodedReaction;

export function decodeIncoming(text: string): Decoded {
  const react = text.match(REACT_RE);
  if (react) {
    return {
      isReaction: true,
      messageId: parseInt(react[1], 10),
      emoji: react[2],
      action: (react[3] as 'add' | 'remove') ?? 'add',
    };
  }

  let body = text;
  let viewOnce = false;
  let replyToId: number | null = null;

  const v1 = body.match(V1_RE);
  if (v1) {
    viewOnce = true;
    body = body.slice(v1[0].length);
  }

  const reply = body.match(REPLY_RE);
  if (reply) {
    replyToId = parseInt(reply[1], 10);
    body = body.slice(reply[0].length);
  }

  return { viewOnce, body, replyToId, isReaction: false };
}

export function encodeReaction(
  messageId: number,
  emoji: string,
  action: 'add' | 'remove' = 'add',
): string {
  return `[react:${messageId}:${emoji}:${action}]`;
}

export function encodeReply(replyToId: number, text: string): string {
  return `[reply:${replyToId}]${text}`;
}

/* ────────────────────────────────────────────────────────── */
/* Local message + persistence                                */
/* ────────────────────────────────────────────────────────── */

type LocalMessage = DirectMessageDto & {
  viewOnce?: boolean;
  viewed?: boolean;
  replyToId?: number | null;
};

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function themeKey(userId: string | undefined, peerId: string | undefined) {
  return `orbital.chatTheme.v3.${userId ?? 'anon'}.${peerId ?? 'none'}`;
}
function v1SeenKey(userId: string | undefined) {
  return `orbital.v1seen.${userId ?? 'anon'}`;
}
function pinnedKey(userId: string | undefined) {
  return `orbital.pinned.${userId ?? 'anon'}`;
}
function mutedKey(userId: string | undefined) {
  return `orbital.muted.${userId ?? 'anon'}`;
}
function reactionsKey(userId: string | undefined, peerId: string | undefined) {
  return `orbital.reactions.${userId ?? 'anon'}.${peerId ?? 'none'}`;
}

function readThemeFor(
  userId: string | undefined,
  peerId: string | undefined,
): ChatThemeKey {
  const raw = lsGet<string | null>(themeKey(userId, peerId), null);
  if (raw && raw in CHAT_THEMES) return raw as ChatThemeKey;
  return 'obsidian';
}

function writeThemeFor(
  userId: string | undefined,
  peerId: string | undefined,
  key: ChatThemeKey,
) {
  lsSet(themeKey(userId, peerId), key);
}

function readV1Seen(userId: string | undefined): Set<number> {
  return new Set(lsGet<number[]>(v1SeenKey(userId), []));
}
function markV1Seen(userId: string | undefined, messageId: number) {
  const set = readV1Seen(userId);
  set.add(messageId);
  lsSet(v1SeenKey(userId), Array.from(set));
}
function readPinned(userId: string | undefined): Set<string> {
  return new Set(lsGet<string[]>(pinnedKey(userId), []));
}
function writePinned(userId: string | undefined, set: Set<string>) {
  lsSet(pinnedKey(userId), Array.from(set));
}
function readMuted(userId: string | undefined): Set<string> {
  return new Set(lsGet<string[]>(mutedKey(userId), []));
}
function writeMuted(userId: string | undefined, set: Set<string>) {
  lsSet(mutedKey(userId), Array.from(set));
}
function readReactions(
  userId: string | undefined,
  peerId: string | undefined,
): Record<string, ReactionEntry[]> {
  return lsGet<Record<string, ReactionEntry[]>>(
    reactionsKey(userId, peerId),
    {},
  );
}
function writeReactions(
  userId: string | undefined,
  peerId: string | undefined,
  data: Record<string, ReactionEntry[]>,
) {
  lsSet(reactionsKey(userId, peerId), data);
}

/* ────────────────────────────────────────────────────────── */
/* Date / time helpers                                        */
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
    return d.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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

function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ────────────────────────────────────────────────────────── */
/* Sidebar preview                                            */
/* ────────────────────────────────────────────────────────── */

interface LastMessagePreview {
  text: string;
  sentAt: string;
  isMe: boolean;
}

function previewText(msg: DirectMessageDto, myUserId: string): LastMessagePreview {
  const isMe = msg.senderId === myUserId;
  const body = msg.plaintext ?? msg.content ?? '';
  const decoded = decodeIncoming(body);
  let text: string;
  if (decoded.isReaction) text = '👍 Reacted';
  else if (msg.mediaType === MediaType.Image) text = '📷 Photo';
  else if (msg.mediaType === MediaType.Video) text = '🎥 Video';
  else if (msg.mediaType === MediaType.Audio) text = '🎤 Voice message';
  else if (msg.mediaType === MediaType.File) text = '📎 File';
  else text = decoded.body;
  return { text, sentAt: msg.sentAt, isMe };
}

/* ────────────────────────────────────────────────────────── */
/* Links                                                      */
/* ────────────────────────────────────────────────────────── */

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

function extractUrls(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      out.push(m[0]);
    }
  }
  return out;
}

function getYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LinkifiedText({ text, isMe }: { text: string; isMe: boolean }) {
  const parts = useMemo(() => {
    if (!text) return [] as Array<{ type: 'text' | 'link'; value: string }>;
    const out: Array<{ type: 'text' | 'link'; value: string }> = [];
    let lastIdx = 0;
    URL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_REGEX.exec(text)) !== null) {
      if (m.index > lastIdx) {
        out.push({ type: 'text', value: text.slice(lastIdx, m.index) });
      }
      out.push({ type: 'link', value: m[0] });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) {
      out.push({ type: 'text', value: text.slice(lastIdx) });
    }
    return out;
  }, [text]);

  return (
    <p className="whitespace-pre-wrap break-words leading-relaxed select-text">
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <React.Fragment key={i}>{p.value}</React.Fragment>
        ) : (
          <a
            key={i}
            href={p.value}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`underline underline-offset-2 break-all transition-opacity ${
              isMe ? 'opacity-90 hover:opacity-100 font-medium' : 'hover:opacity-80 font-medium'
            }`}
          >
            {p.value}
          </a>
        ),
      )}
    </p>
  );
}

function LinkPreviews({ urls, theme }: { urls: string[]; theme: ChatTheme }) {
  if (urls.length === 0) return null;

  return (
    <div className="mt-2.5 space-y-2">
      {urls.slice(0, 2).map((url) => {
        const yt = getYouTubeId(url);
        if (yt) {
          return (
            <div
              key={url}
              className="rounded-[18px] overflow-hidden border border-black/[0.08] bg-black aspect-video w-full max-w-[420px] shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <iframe
                src={`https://www.youtube.com/embed/${yt}`}
                title="YouTube preview"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="w-full h-full border-0"
              />
            </div>
          );
        }
        const vimeo = getVimeoId(url);
        if (vimeo) {
          return (
            <div
              key={url}
              className="rounded-[18px] overflow-hidden border border-black/[0.08] bg-black aspect-video w-full max-w-[420px] shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <iframe
                src={`https://player.vimeo.com/video/${vimeo}`}
                title="Vimeo preview"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="w-full h-full border-0"
              />
            </div>
          );
        }
        const host = getHostname(url);
        const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
          host,
        )}&sz=64`;

        return (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`flex items-stretch gap-3 rounded-[16px] border overflow-hidden transition-all max-w-[420px] shadow-sm ${theme.subtleBg} ${theme.subtleBorder} ${theme.hoverBg}`}
          >
            <div
              className={`w-[68px] shrink-0 flex items-center justify-center ${theme.subtleBgStrong}`}
            >
              <img
                src={favicon}
                alt=""
                width={28}
                height={28}
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
                className="rounded"
              />
            </div>
            <div className="flex-1 min-w-0 py-2.5 pr-3.5">
              <div className={`flex items-center gap-1.5 ${theme.textPrimary}`}>
                <Link2 className="w-3.5 h-3.5 opacity-60 shrink-0" />
                <span className="text-[12.5px] font-semibold truncate">
                  {host}
                </span>
                <ExternalLink className="w-3 h-3 opacity-40 shrink-0" />
              </div>
              <p
                className={`text-[11.5px] opacity-70 truncate mt-0.5 ${theme.textSecondary}`}
              >
                {url}
              </p>
            </div>
          </a>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Image viewer                                               */
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
      className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center select-none"
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
        className="max-w-[95vw] max-h-[88vh] object-contain select-none rounded-xl shadow-2xl"
      />
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* View-once viewer                                           */
/* ────────────────────────────────────────────────────────── */

function ViewOnceViewerModal({
  url,
  senderName,
  sentAt,
  onClose,
}: {
  url: string;
  senderName: string;
  sentAt: string;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[210] bg-black/98 backdrop-blur-md flex flex-col items-center justify-center select-none"
      onClick={onClose}
    >
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3.5 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-10">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white text-[10px] font-bold tracking-wide">
            <Eye className="w-3 h-3" />
            VIEW ONCE
          </span>
          <p className="text-[12px] text-white/60 tabular-nums mt-1.5">
            {senderName} · {formatTime(sentAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      <motion.img
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        src={url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[80vh] object-contain select-none rounded-xl shadow-2xl"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
      />

      <p className="absolute bottom-8 text-[12.5px] font-medium text-white/60 pointer-events-none">
        Tap anywhere to close · Disappears once dismissed
      </p>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Reaction picker + bar                                      */
/* ────────────────────────────────────────────────────────── */

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

function ReactionPicker({
  onPick,
  onClose,
  isMe,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  isMe: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 10 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`absolute z-50 bottom-full mb-2 ${
        isMe ? 'right-0' : 'left-0'
      } flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#1A1816]/95 border border-white/[0.12] shadow-[0_16px_40px_-8px_rgba(0,0,0,0.85)] backdrop-blur-md`}
    >
      {QUICK_REACTIONS.map((e, i) => (
        <motion.button
          key={e}
          onClick={() => {
            onPick(e);
            onClose();
          }}
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.03, type: 'spring', stiffness: 500, damping: 22 }}
          whileHover={{ scale: 1.35, y: -3 }}
          whileTap={{ scale: 0.85 }}
          className="w-9 h-9 rounded-full flex items-center justify-center text-[22px] hover:bg-white/[0.08] transition-colors"
        >
          {e}
        </motion.button>
      ))}
    </motion.div>
  );
}

function ReactionChips({
  reactions,
  currentUserId,
  isMe,
  onToggle,
}: {
  reactions: ReactionEntry[];
  currentUserId: string | undefined;
  isMe: boolean;
  onToggle: (emoji: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, ReactionEntry[]>();
    for (const r of reactions) {
      const arr = map.get(r.emoji) ?? [];
      arr.push(r);
      map.set(r.emoji, arr);
    }
    return Array.from(map.entries());
  }, [reactions]);

  if (grouped.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-1.5 mt-1.5 px-1 flex-wrap ${
        isMe ? 'justify-end' : 'justify-start'
      }`}
    >
      {grouped.map(([emoji, entries]) => {
        const mine = entries.some((e) => e.userId === currentUserId);
        return (
          <motion.button
            key={emoji}
            onClick={() => onToggle(emoji)}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-medium border transition-colors shadow-sm ${
              mine
                ? 'bg-[#D97706]/[0.18] border-[#D97706]/50 text-[#F59E0B]'
                : 'bg-white/[0.08] border-white/[0.12] text-[#EDE5D4] hover:bg-white/[0.12]'
            }`}
            title={`${entries.length} reaction${entries.length > 1 ? 's' : ''}`}
          >
            <span className="text-[14px] leading-none">{emoji}</span>
            {entries.length > 1 && (
              <span className="tabular-nums text-[11px] opacity-90 font-semibold">
                {entries.length}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Reply preview                                              */
/* ────────────────────────────────────────────────────────── */

function ReplyPreviewBubble({
  replyTo,
  isMe,
  currentUserId,
}: {
  replyTo: LocalMessage;
  isMe: boolean;
  currentUserId: string | undefined;
}) {
  const body =
    replyTo.plaintext ??
    replyTo.content ??
    (replyTo.mediaType === MediaType.Image
      ? '📷 Photo'
      : replyTo.mediaType === MediaType.Audio
        ? '🎤 Voice message'
        : replyTo.mediaType === MediaType.Video
          ? '🎥 Video'
          : replyTo.mediaType === MediaType.File
            ? '📎 File'
            : 'Attachment');
  const isTargetMine = replyTo.senderId === currentUserId;
  const senderLabel = isTargetMine ? 'You' : 'Reply';
  const display = body.length > 80 ? body.slice(0, 80) + '…' : body;

  return (
    <div
      className={`mb-2 rounded-xl border-l-[3px] pl-2.5 pr-2 py-1.5 text-[12px] select-none ${
        isMe
          ? 'bg-black/[0.18] border-white/60 text-white/90'
          : 'bg-white/[0.08] border-[#D97706] text-[#EDE5D4]/90'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <CornerUpLeft className="w-3 h-3 opacity-70 shrink-0" />
        <span className="font-bold tracking-tight opacity-95">{senderLabel}</span>
      </div>
      <p className="line-clamp-2 opacity-85 leading-snug">{display}</p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Sidebar context menu                                       */
/* ────────────────────────────────────────────────────────── */

function ChatContextMenu({
  friend,
  isPinned,
  isMuted,
  onClose,
  onPin,
  onMute,
  onMarkRead,
  onClearChat,
  onBlock,
  onUnfriend,
}: {
  friend: FriendDto;
  isPinned: boolean;
  isMuted: boolean;
  onClose: () => void;
  onPin: () => void;
  onMute: () => void;
  onMarkRead: () => void;
  onClearChat: () => void;
  onBlock: () => void;
  onUnfriend: () => void;
}) {
  const actions = [
    { key: 'pin', label: isPinned ? 'Unpin chat' : 'Pin chat', icon: isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />, onClick: onPin, danger: false },
    { key: 'mute', label: isMuted ? 'Unmute notifications' : 'Mute notifications', icon: isMuted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />, onClick: onMute, danger: false },
    { key: 'read', label: 'Mark as read', icon: <CheckCheck className="w-4 h-4" />, onClick: onMarkRead, danger: false },
    { key: 'clear', label: 'Clear chat', icon: <Eraser className="w-4 h-4" />, onClick: onClearChat, danger: false },
    { key: 'block', label: `Block @${friend.handle}`, icon: <ShieldOff className="w-4 h-4" />, onClick: onBlock, danger: true },
    { key: 'unfriend', label: `Unfriend @${friend.handle}`, icon: <UserMinus className="w-4 h-4" />, onClick: onUnfriend, danger: true },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 40, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xs rounded-t-[22px] sm:rounded-[22px] bg-[#1C1A17] border-t sm:border border-white/[0.08] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
          <Avatar name={friend.displayName} src={friend.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#EDE5D4] truncate tracking-tight">
              {friend.displayName}
            </p>
            <p className="text-[11.5px] text-[#7A6F65] truncate mt-0.5">
              @{friend.handle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="py-1.5 max-h-[60vh] overflow-y-auto">
          {actions.map((a) => (
            <button
              key={a.key}
              onClick={() => {
                a.onClick();
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium transition-colors text-left ${
                a.danger
                  ? 'text-[#F87171] hover:bg-[#B91C1C]/[0.10]'
                  : 'text-[#EDE5D4] hover:bg-white/[0.04]'
              }`}
            >
              <span className="shrink-0 opacity-80">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Theme grid                                                 */
/* ────────────────────────────────────────────────────────── */

function ThemeGrid({
  current,
  onSelect,
}: {
  current: ChatThemeKey;
  onSelect: (k: ChatThemeKey) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {(Object.keys(CHAT_THEMES) as ChatThemeKey[]).map((k) => {
        const t = CHAT_THEMES[k];
        const active = k === current;
        return (
          <button
            key={k}
            onClick={() => onSelect(k)}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all ${
              active
                ? 'bg-white/[0.08] ring-1 ring-inset ring-white/[0.14]'
                : 'hover:bg-white/[0.04]'
            }`}
          >
            <span
              className={`w-8 h-8 rounded-full border-2 transition-transform ${
                active
                  ? 'border-[#4ADE80] shadow-[0_0_12px_rgba(74,222,128,0.4)] scale-105'
                  : 'border-white/[0.12]'
              }`}
              style={{ background: t.swatch }}
            />
            <span
              className={`text-[10.5px] font-medium truncate max-w-full ${
                active ? 'text-[#EDE5D4] font-semibold' : 'text-[#A8A29E]'
              }`}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Voice message bubble                                       */
/* ────────────────────────────────────────────────────────── */

function VoiceBubble({
  url,
  isMe,
  theme,
}: {
  url: string;
  isMe: boolean;
  theme: ChatTheme;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.currentTime);
    const onMeta = () => {
      if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onMeta);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  };

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <div
      className={`inline-flex items-center gap-3 px-3.5 py-2.5 rounded-[22px] shadow-sm select-none ${
        isMe ? theme.bubbleSent : theme.bubbleReceived
      } min-w-[220px] max-w-[280px]`}
    >
      <button
        type="button"
        onClick={toggle}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all ${
          isMe ? 'bg-black/[0.18] hover:bg-black/[0.28]' : 'bg-white/[0.08] hover:bg-white/[0.15]'
        }`}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <span className="flex gap-1">
            <span className="w-[3px] h-3.5 rounded-sm bg-current" />
            <span className="w-[3px] h-3.5 rounded-sm bg-current" />
          </span>
        ) : (
          <span
            className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] ml-0.5"
            style={{ borderLeftColor: 'currentColor' }}
          />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-0.5 h-6">
          {Array.from({ length: 24 }).map((_, i) => {
            const height = 18 + Math.sin(i * 0.7) * 10 + (i % 3) * 4;
            const active = (i / 24) * 100 <= pct;
            return (
              <span
                key={i}
                className="w-[2.5px] rounded-full transition-all"
                style={{
                  height: `${Math.max(4, Math.min(24, height))}px`,
                  background: 'currentColor',
                  opacity: active ? 1 : 0.3,
                }}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10.5px] font-medium tabular-nums opacity-80">
            {playing || progress > 0 ? formatDuration(progress) : '0:00'}
          </span>
          <span className="text-[10.5px] font-medium tabular-nums opacity-80">
            {duration > 0 ? formatDuration(duration) : '–:––'}
          </span>
        </div>
      </div>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Message row                                                */
/* ────────────────────────────────────────────────────────── */

interface MessageRowProps {
  message: LocalMessage;
  isMe: boolean;
  senderName: string;
  senderAvatar?: string | null;
  grouped: boolean;
  isLastOfGroup: boolean;
  theme: ChatTheme;
  reactions: ReactionEntry[];
  currentUserId: string | undefined;
  replyTarget: LocalMessage | null;
  onDeleteForMe: (m: LocalMessage) => void;
  onDeleteForEveryone: (m: LocalMessage) => void;
  onRequestProfile: (userId: string) => void;
  onOpenImage: (m: LocalMessage, senderName: string) => void;
  onReact: (messageId: number, emoji: string) => void;
  onStartReply: (m: LocalMessage) => void;
  onOpenMenu: (m: LocalMessage) => void;
}

const MessageRow = React.memo(
  function MessageRow({
    message,
    isMe,
    senderName,
    senderAvatar,
    grouped,
    isLastOfGroup,
    theme,
    reactions,
    currentUserId,
    replyTarget,
    onRequestProfile,
    onOpenImage,
    onReact,
    onStartReply,
    onOpenMenu,
  }: MessageRowProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [swipeX, setSwipeX] = useState(0);
    const longPressRef = useRef<number | null>(null);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const swipingRef = useRef(false);

    const onTouchStart = (e: React.TouchEvent) => {
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY };
      swipingRef.current = false;

      longPressRef.current = window.setTimeout(() => {
        if (!swipingRef.current) {
          setPickerOpen(true);
          if (navigator.vibrate) navigator.vibrate(10);
        }
      }, 450);
    };

    const onTouchMove = (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;

      if (Math.abs(dy) > 15 && !swipingRef.current) {
        if (longPressRef.current) {
          window.clearTimeout(longPressRef.current);
          longPressRef.current = null;
        }
        return;
      }

      if (!swipingRef.current && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        swipingRef.current = true;
        if (longPressRef.current) {
          window.clearTimeout(longPressRef.current);
          longPressRef.current = null;
        }
      }

      if (swipingRef.current) {
        const clamped = Math.max(0, Math.min(80, dx));
        setSwipeX(clamped);
      }
    };

    const onTouchEnd = () => {
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
      if (swipingRef.current && swipeX > 55) {
        onStartReply(message);
        if (navigator.vibrate) navigator.vibrate(15);
      }
      setSwipeX(0);
      swipingRef.current = false;
      touchStartRef.current = null;
    };

    const hasMedia = Boolean(message.mediaUrl);
    const displayText = message.plaintext ?? message.content ?? '';
    const isTemp = typeof message.id === 'number' && message.id < 0;
    const isViewOnce = Boolean(message.viewOnce);
    const hasText = Boolean(displayText);
    const urls = useMemo(() => extractUrls(displayText), [displayText]);

    const isEmojiOnly = useMemo(() => {
      if (!hasText) return false;
      const stripped = displayText.replace(/\s/g, '');
      if (stripped.length === 0 || stripped.length > 12) return false;
      const emojiCount = Array.from(stripped).filter((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 0x1f000 || (code >= 0x2600 && code <= 0x27bf);
      }).length;
      return emojiCount > 0 && emojiCount * 1.5 >= Array.from(stripped).length;
    }, [displayText, hasText]);

    const isVoice = message.mediaType === MediaType.Audio;

    const tailClass = isLastOfGroup
      ? isMe
        ? 'rounded-br-[4px]'
        : 'rounded-bl-[4px]'
      : '';

    const replyProgress = Math.min(1, swipeX / 60);

    return (
      <div
        className={`group/row relative flex w-full ${
          grouped ? 'mt-[3px]' : 'mt-3.5'
        } ${isMe ? 'justify-end' : 'justify-start'} ${
          isTemp ? 'opacity-80' : ''
        }`}
      >
        {/* Swipe-to-reply indicator */}
        <div
          className={`absolute inset-y-0 flex items-center pointer-events-none transition-opacity ${
            isMe ? 'right-0' : 'left-0'
          }`}
          style={{ opacity: replyProgress }}
        >
          <div className="w-9 h-9 rounded-full bg-[#D97706]/[0.18] border border-[#D97706]/50 flex items-center justify-center">
            <Reply className="w-4 h-4 text-[#F59E0B]" />
          </div>
        </div>

        {/* ✅ FIX #1: inner row now carries justify-* so bubbles land on the correct side */}
        <div
          className={`relative flex w-full ${
            isMe ? 'justify-end' : 'justify-start'
          } transition-transform`}
          style={{
            transform: swipeX > 0 ? `translateX(${swipeX}px)` : undefined,
            transitionDuration: swipingRef.current ? '0ms' : '180ms',
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onContextMenu={(e) => {
            e.preventDefault();
            setPickerOpen(true);
          }}
        >
          {!isMe && (
            <div className="w-8 shrink-0 pt-0.5 mr-2.5">
              {!grouped ? (
                <button
                  type="button"
                  onClick={() => onRequestProfile(message.senderId)}
                  className="rounded-full focus:outline-none transition-transform hover:scale-105"
                  aria-label={`View ${senderName}'s profile`}
                >
                  <Avatar name={senderName} src={senderAvatar} size="sm" />
                </button>
              ) : (
                <span className="block w-8 h-8" aria-hidden />
              )}
            </div>
          )}

          <div
            className={`flex flex-col min-w-0 max-w-[85%] sm:max-w-[74%] md:max-w-[65%] ${
              isMe ? 'items-end' : 'items-start'
            }`}
          >
            {!grouped && !isMe && (
              <div className="flex items-baseline gap-2 mb-1 px-1.5">
                <span
                  className={`text-[12px] font-semibold tracking-tight ${theme.textSecondary}`}
                >
                  {senderName}
                </span>
                <span
                  className={`text-[10.5px] tabular-nums opacity-75 ${theme.textSecondary}`}
                >
                  {formatTime(message.sentAt)}
                </span>
              </div>
            )}

            {hasMedia && !isVoice && (
              <div className="relative group/media max-w-full">
                {message.mediaType === MediaType.Image && !isViewOnce && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenImage(message, senderName);
                    }}
                    className="relative cursor-zoom-in overflow-hidden rounded-[20px] block transition-transform hover:scale-[1.008] shadow-md border border-white/[0.04]"
                    aria-label="View full image"
                  >
                    <img
                      src={message.mediaUrl ?? undefined}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="rounded-[20px] max-h-[380px] w-auto object-cover"
                    />
                    <span className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 transition-opacity pointer-events-none">
                      <ZoomIn className="w-3.5 h-3.5" />
                    </span>
                  </button>
                )}

                {message.mediaType === MediaType.Image && isViewOnce && isMe && (
                  <div
                    className={`inline-flex items-center gap-3 px-4 py-3.5 rounded-[22px] text-[13px] ${theme.subtleBg} border ${theme.subtleBorder} shadow-sm`}
                  >
                    <span className="w-9 h-9 rounded-full bg-gradient-to-br from-[#7C3AED] to-[#A855F7] flex items-center justify-center shrink-0 shadow-sm">
                      <Eye className="w-4 h-4 text-white" />
                    </span>
                    <span className="text-left">
                      <span
                        className={`block font-semibold text-[13px] ${theme.textPrimary}`}
                      >
                        View-once photo sent
                      </span>
                      <span
                        className={`block opacity-75 text-[11px] ${theme.textSecondary}`}
                      >
                        Only visible to recipient
                      </span>
                    </span>
                  </div>
                )}

                {message.mediaType === MediaType.Image && isViewOnce && !isMe && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!message.viewed) onOpenImage(message, senderName);
                    }}
                    disabled={message.viewed}
                    className={`inline-flex items-center gap-3 px-4 py-3.5 rounded-[22px] text-[13px] transition-all shadow-sm ${
                      message.viewed
                        ? `${theme.subtleBg} border ${theme.subtleBorder} opacity-60 cursor-default`
                        : 'bg-gradient-to-br from-[#7C3AED]/[0.18] to-[#A855F7]/[0.18] border border-[#A855F7]/40 hover:from-[#7C3AED]/[0.26] hover:to-[#A855F7]/[0.26]'
                    }`}
                  >
                    <span
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        message.viewed
                          ? theme.subtleBgStrong
                          : 'bg-gradient-to-br from-[#7C3AED] to-[#A855F7] text-white shadow-sm'
                      }`}
                    >
                      {message.viewed ? (
                        <EyeOff className="w-4 h-4 opacity-60" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </span>
                    <span className="text-left">
                      <span
                        className={`block font-semibold text-[13px] ${theme.textPrimary}`}
                      >
                        {message.viewed ? 'Opened' : 'View once'}
                      </span>
                      {!message.viewed && (
                        <span
                          className={`block opacity-80 text-[11px] font-medium ${theme.textSecondary}`}
                        >
                          Tap to reveal
                        </span>
                      )}
                    </span>
                  </button>
                )}

                {message.mediaType === MediaType.Video && (
                  <video
                    src={message.mediaUrl ?? undefined}
                    controls
                    preload="metadata"
                    className="rounded-[20px] max-h-[380px] w-full bg-black shadow-md border border-white/[0.04]"
                  />
                )}

                {message.mediaType === MediaType.File && (
                  <a
                    href={message.mediaUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className={`inline-flex items-center gap-3 px-4 py-3 rounded-[18px] text-[13px] border shadow-sm transition-all ${theme.subtleBg} ${theme.subtleBorder} ${theme.hoverBg} ${theme.textPrimary}`}
                  >
                    <FileText className="w-4 h-4 shrink-0 opacity-80" />
                    <span className="truncate max-w-[200px] font-medium">Attached file</span>
                    <Download className="w-4 h-4 shrink-0 opacity-70" />
                  </a>
                )}
              </div>
            )}

            {isVoice && message.mediaUrl && (
              <VoiceBubble url={message.mediaUrl} isMe={isMe} theme={theme} />
            )}

            {hasText && (
              <div
                className={`relative inline-flex items-end gap-1.5 max-w-full ${
                  hasMedia ? 'mt-1.5' : 'mt-0'
                } ${isMe ? 'flex-row-reverse' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className={`hidden sm:flex absolute top-1/2 -translate-y-1/2 ${
                    isMe ? '-left-8' : '-right-8'
                  } w-6 h-6 rounded-full items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity ${theme.textSecondary} ${theme.hoverBg}`}
                  aria-label="Message options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {isEmojiOnly ? (
                  <div className="px-1 py-0.5 text-[44px] leading-[1.15] break-words max-w-full">
                    {displayText}
                  </div>
                ) : (
                  <div
                    className={`inline-block max-w-full text-[14.5px] leading-[1.5] break-words rounded-[20px] ${tailClass} px-4 py-2 shadow-sm ${
                      isMe ? theme.bubbleSent : theme.bubbleReceived
                    }`}
                  >
                    {replyTarget && (
                      <ReplyPreviewBubble
                        replyTo={replyTarget}
                        isMe={isMe}
                        currentUserId={currentUserId}
                      />
                    )}
                    <LinkifiedText text={displayText} isMe={isMe} />
                  </div>
                )}

                <AnimatePresence>
                  {pickerOpen && (
                    <ReactionPicker
                      isMe={isMe}
                      onPick={(emoji) => {
                        if (typeof message.id === 'number' && message.id > 0) {
                          onReact(message.id, emoji);
                        }
                      }}
                      onClose={() => setPickerOpen(false)}
                    />
                  )}
                </AnimatePresence>
              </div>
            )}

            {!hasText && hasMedia && (
              <AnimatePresence>
                {pickerOpen && (
                  <ReactionPicker
                    isMe={isMe}
                    onPick={(emoji) => {
                      if (typeof message.id === 'number' && message.id > 0) {
                        onReact(message.id, emoji);
                      }
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </AnimatePresence>
            )}

            {reactions.length > 0 && (
              <ReactionChips
                reactions={reactions}
                currentUserId={currentUserId}
                isMe={isMe}
                onToggle={(emoji) => {
                  if (typeof message.id === 'number' && message.id > 0) {
                    onReact(message.id, emoji);
                  }
                }}
              />
            )}

            {urls.length > 0 && <LinkPreviews urls={urls} theme={theme} />}

            {isMe && isLastOfGroup && (
              <div className="flex items-center gap-1 mt-1 px-1.5 select-none">
                <span className={`text-[10px] tabular-nums opacity-60 ${theme.textSecondary}`}>
                  {formatTime(message.sentAt)}
                </span>
                {isTemp ? (
                  <Loader2
                    className={`w-3 h-3 animate-spin ${theme.textSecondary}`}
                  />
                ) : message.isRead ? (
                  <CheckCheck className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Check className={`w-3.5 h-3.5 ${theme.textSecondary}`} />
                )}
              </div>
            )}
          </div>

          <AnimatePresence>
            {pickerOpen && (
              <motion.button
                key="menu-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setPickerOpen(false);
                  onOpenMenu(message);
                }}
                className="fixed inset-0 z-40 cursor-default bg-transparent"
                aria-label="Message menu"
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.message.id === next.message.id &&
      prev.message.isRead === next.message.isRead &&
      prev.message.mediaUrl === next.message.mediaUrl &&
      prev.message.content === next.message.content &&
      prev.message.plaintext === next.message.plaintext &&
      prev.message.viewed === next.message.viewed &&
      prev.grouped === next.grouped &&
      prev.isLastOfGroup === next.isLastOfGroup &&
      prev.isMe === next.isMe &&
      prev.senderName === next.senderName &&
      prev.senderAvatar === next.senderAvatar &&
      prev.theme === next.theme &&
      prev.reactions === next.reactions &&
      prev.replyTarget === next.replyTarget
    );
  },
);

/* ────────────────────────────────────────────────────────── */
/* Info modal                                                 */
/* ────────────────────────────────────────────────────────── */

type InfoAction = 'unfriend' | 'clear' | null;

interface InfoModalProps {
  open: boolean;
  targetUser: UserProfileDto;
  isFriend: boolean;
  currentTheme: ChatThemeKey;
  onThemeChange: (k: ChatThemeKey) => void;
  onClose: () => void;
  onUnfriend: () => Promise<void>;
  onClear: () => Promise<void>;
}

function InfoModal({
  open,
  targetUser,
  isFriend,
  currentTheme,
  onThemeChange,
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
            className="w-full max-w-md rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 flex flex-col items-center text-center border-b border-white/[0.06] shrink-0">
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
              <p className="mt-4 text-[16px] font-bold text-[#EDE5D4] tracking-tight">
                {targetUser.displayName}
              </p>
              <p className="text-[12px] text-[#7A6F65] mt-0.5">
                @{targetUser.userHandle}
              </p>
            </div>

            {!confirmAction ? (
              <div className="overflow-y-auto flex-1">
                <div className="px-5 py-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-3">
                    <Palette className="w-3.5 h-3.5 text-[#7A6F65]" />
                    <span className="text-[11px] uppercase tracking-[0.16em] text-[#7A6F65] font-semibold">
                      Chat theme
                    </span>
                  </div>
                  <ThemeGrid current={currentTheme} onSelect={onThemeChange} />
                </div>

                <div className="divide-y divide-white/[0.04]">
                  {isFriend && (
                    <button
                      onClick={() => setConfirmAction('unfriend')}
                      className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] font-medium text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
                    >
                      <UserMinus className="w-4 h-4 text-[#A8A29E] shrink-0" />
                      <span>Unfriend</span>
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmAction('clear')}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] font-medium text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
                  >
                    <Eraser className="w-4 h-4 text-[#A8A29E] shrink-0" />
                    <span>Clear this chat</span>
                  </button>
                  <div className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#5A524A] cursor-not-allowed">
                    <Flag className="w-4 h-4 shrink-0" />
                    <span>Report (coming soon)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <h3 className="text-[14.5px] font-bold text-[#EDE5D4] mb-1.5">
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

            <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2 shrink-0">
              {!confirmAction ? (
                <button
                  onClick={handleClose}
                  className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] font-medium text-[#EDE5D4] transition-colors"
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
                    className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] font-medium text-[#EDE5D4] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => void runAction(confirmAction)}
                    disabled={busy}
                    className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-semibold transition-colors inline-flex items-center gap-1.5"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>
                      {busy ? 'Working…' : confirmCopy[confirmAction].cta}
                    </span>
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

export function DirectMessagePane(): React.JSX.Element {
  const { userId } = useParams<{ userId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const reduceMotion = useReducedMotion();

  const { onType, stop: stopTyping } = useDmTypingEmitter(userId);
  const isPeerTyping = useDmTypingReceiver(userId);

  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [targetUser, setTargetUser] = useState<UserProfileDto | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [inputContent, setInputContent] = useState('');

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingViewOnce, setPendingViewOnce] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [friendRequestStatus, setFriendRequestStatus] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');

  const [lastMessages, setLastMessages] = useState<
    Record<string, DirectMessageDto>
  >({});

  const [reactions, setReactions] = useState<Record<string, ReactionEntry[]>>(
    () => readReactions(user?.id, userId),
  );

  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<LocalMessage | null>(null);

  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<
    string | number | null
  >(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(
    null,
  );
  const [viewerOpenIndex, setViewerOpenIndex] = useState<number | null>(null);
  const [viewOnceViewer, setViewOnceViewer] = useState<{
    url: string;
    senderName: string;
    sentAt: string;
    messageId: number;
  } | null>(null);
  const [chatMenuFriend, setChatMenuFriend] = useState<FriendDto | null>(null);
  const sidebarLongPressRef = useRef<number | null>(null);

  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const [voiceRecorderOpen, setVoiceRecorderOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
    readPinned(user?.id),
  );
  const [mutedIds, setMutedIds] = useState<Set<string>>(() =>
    readMuted(user?.id),
  );

  useEffect(() => {
    setPinnedIds(readPinned(user?.id));
    setMutedIds(readMuted(user?.id));
  }, [user?.id]);

  const [chatThemeKey, setChatThemeKey] = useState<ChatThemeKey>(() =>
    readThemeFor(user?.id, userId),
  );

  useEffect(() => {
    setChatThemeKey(readThemeFor(user?.id, userId));
    setReactions(readReactions(user?.id, userId));
  }, [userId, user?.id]);

  useEffect(() => {
    writeThemeFor(user?.id, userId, chatThemeKey);
  }, [user?.id, userId, chatThemeKey]);

  useEffect(() => {
    writeReactions(user?.id, userId, reactions);
  }, [user?.id, userId, reactions]);

  const theme = CHAT_THEMES[chatThemeKey];

  const [composerVisible, setComposerVisible] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const UNREAD_KEY = `orbital.unreadDms.${user?.id ?? 'anon'}`;
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(
    () => lsGet(UNREAD_KEY, {} as Record<string, number>),
  );

  useEffect(() => {
    lsSet(UNREAD_KEY, unreadCounts);
  }, [unreadCounts, UNREAD_KEY]);

  const [, setPresenceTick] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const userIdRef = useRef(userId);
  const currentUserIdRef = useRef(user?.id);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
  useEffect(() => {
    currentUserIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(() => {
    if (!userId) return;
    void getPublicKeyFor(userId).catch(() => {});
  }, [userId]);

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
    return () => unsub();
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
      const aPinned = pinnedIds.has(a.userId) ? 1 : 0;
      const bPinned = pinnedIds.has(b.userId) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const ma = lastMessages[a.userId];
      const mb = lastMessages[b.userId];
      const ta = ma ? getMessageTime(ma) : 0;
      const tb = mb ? getMessageTime(mb) : 0;
      return tb - ta;
    });
    return list;
  }, [friends, searchQuery, lastMessages, pinnedIds]);

  const chatImages = useMemo(
    () =>
      messages
        .filter(
          (m) =>
            m.mediaType === MediaType.Image && m.mediaUrl && !m.viewOnce,
        )
        .map((m) => ({
          url: m.mediaUrl as string,
          senderName:
            m.senderId === user?.id ? 'You' : targetUser?.displayName ?? 'Them',
          sentAt: m.sentAt,
        })),
    [messages, user?.id, targetUser?.displayName],
  );

  const handleOpenImage = useCallback(
    (m: LocalMessage, _senderName: string) => {
      if (m.viewOnce && typeof m.id === 'number' && m.id > 0) {
        if (m.viewed) return;
        setViewOnceViewer({
          url: m.mediaUrl ?? '',
          senderName:
            m.senderId === currentUserIdRef.current
              ? 'You'
              : targetUser?.displayName ?? 'Them',
          sentAt: m.sentAt,
          messageId: m.id,
        });
        return;
      }
      const idx = chatImages.findIndex((img) => img.url === m.mediaUrl);
      if (idx >= 0) setViewerOpenIndex(idx);
    },
    [chatImages, targetUser?.displayName],
  );

  const handleCloseViewOnce = useCallback(() => {
    if (viewOnceViewer && typeof viewOnceViewer.messageId === 'number') {
      markV1Seen(currentUserIdRef.current, viewOnceViewer.messageId);
      setMessages((prev) =>
        prev.map((x) =>
          x.id === viewOnceViewer.messageId ? { ...x, viewed: true } : x,
        ),
      );
    }
    setViewOnceViewer(null);
  }, [viewOnceViewer]);

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

  const decodeMessages = useCallback(
    async (
      raw: DirectMessageDto[],
      currentUserId: string,
      seenSet: Set<number>,
    ): Promise<{ msgs: LocalMessage[]; reactions: Record<string, ReactionEntry[]> }> => {
      const decrypted = await decryptBatch(raw, currentUserId);
      const msgs: LocalMessage[] = [];
      const reacts: Record<string, ReactionEntry[]> = {};

      for (const d of decrypted) {
        const text = d.plaintext ?? d.content ?? '';
        const decoded = decodeIncoming(text);
        if (decoded.isReaction) {
          const key = String(decoded.messageId);
          const arr = reacts[key] ?? [];
          if (decoded.action === 'remove') {
            const idx = arr.findIndex(
              (r) => r.userId === d.senderId && r.emoji === decoded.emoji,
            );
            if (idx >= 0) arr.splice(idx, 1);
          } else {
            const exists = arr.some(
              (r) => r.userId === d.senderId && r.emoji === decoded.emoji,
            );
            if (!exists) arr.push({ emoji: decoded.emoji, userId: d.senderId });
          }
          reacts[key] = arr;
          continue;
        }
        const viewed =
          decoded.viewOnce &&
          typeof d.id === 'number' &&
          seenSet.has(d.id);
        msgs.push({
          ...d,
          plaintext: decoded.body,
          content: decoded.body,
          viewOnce: decoded.viewOnce,
          viewed,
          replyToId: decoded.replyToId,
        });
      }

      return { msgs, reactions: reacts };
    },
    [],
  );

  useEffect(() => {
    if (!userId || !user?.id) return;
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
        const seen = readV1Seen(user.id);
        const { msgs, reactions: reacts } = await decodeMessages(
          sorted,
          user.id,
          seen,
        );
        if (!active) return;
        setMessages(msgs);
        setReactions((prev) => {
          const merged: Record<string, ReactionEntry[]> = { ...prev };
          for (const [k, list] of Object.entries(reacts)) {
            merged[k] = list;
          }
          return merged;
        });
        setHasMore(history.length >= 50);
        if (msgs.length > 0) {
          const latest = msgs[msgs.length - 1];
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
  }, [userId, user?.id, decodeMessages]);

  useEffect(() => {
    if (!userId || !user?.id) return;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const history = await apiService.getDmHistory(userId, 50);
        if (cancelled) return;
        const sorted = [...history].sort(
          (a, b) => getMessageTime(a) - getMessageTime(b),
        );
        const seen = readV1Seen(user.id);
        const { msgs: decrypted, reactions: reacts } = await decodeMessages(
          sorted,
          user.id,
          seen,
        );
        if (cancelled) return;

        setMessages((prev) => {
          const temps = prev.filter(
            (m) => typeof m.id === 'number' && m.id < 0,
          );
          const prevMap = new Map(
            prev
              .filter((m) => !(typeof m.id === 'number' && m.id < 0))
              .map((m) => [m.id, m]),
          );

          const merged = decrypted.map((d) => {
            const existing = prevMap.get(d.id);
            if (!existing) return d;
            return {
              ...existing,
              isRead: d.isRead,
              content: d.content ?? existing.content,
              plaintext: d.plaintext ?? existing.plaintext,
              mediaUrl: d.mediaUrl ?? existing.mediaUrl,
              mediaType: d.mediaType ?? existing.mediaType,
              viewOnce: d.viewOnce ?? existing.viewOnce,
              viewed: existing.viewed || d.viewed,
              replyToId: d.replyToId ?? existing.replyToId,
            };
          });

          const stillPending = temps.filter((t) => {
            const tText = t.plaintext ?? t.content ?? '';
            const tMedia = t.mediaUrl ?? '';
            return !decrypted.some((d) => {
              const dText = d.plaintext ?? d.content ?? '';
              const dMedia = d.mediaUrl ?? '';
              return (
                d.senderId === t.senderId &&
                dText === tText &&
                dMedia === tMedia
              );
            });
          });

          const final = [...merged, ...stillPending].sort(
            (a, b) => getMessageTime(a) - getMessageTime(b),
          );

          const sameLength = final.length === prev.length;
          const allSame =
            sameLength &&
            final.every(
              (m, i) =>
                m.id === prev[i]?.id &&
                m.isRead === prev[i]?.isRead &&
                m.mediaUrl === prev[i]?.mediaUrl &&
                m.viewed === prev[i]?.viewed,
            );

          return allSame ? prev : final;
        });

        setReactions((prev) => {
          const merged: Record<string, ReactionEntry[]> = { ...prev };
          let changed = false;
          for (const [k, list] of Object.entries(reacts)) {
            const existing = prev[k] ?? [];
            if (
              existing.length !== list.length ||
              list.some(
                (r, i) =>
                  existing[i]?.emoji !== r.emoji ||
                  existing[i]?.userId !== r.userId,
              )
            ) {
              merged[k] = list;
              changed = true;
            }
          }
          return changed ? merged : prev;
        });
      } catch {
        /* silent */
      } finally {
        inFlight = false;
      }
    };

    const interval = window.setInterval(poll, 1500);
    const onVis = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [userId, user?.id, decodeMessages]);

  const handleLoadEarlier = async () => {
    if (!userId || !user?.id || loadingMore || !hasMore || messages.length === 0)
      return;
    const oldestMessageId = messages[0].id;
    setLoadingMore(true);
    try {
      const earlier = await apiService.getDmHistory(userId, 50, oldestMessageId);
      if (earlier.length > 0) {
        const sortedEarlier = [...earlier].sort(
          (a, b) => getMessageTime(a) - getMessageTime(b),
        );
        const seen = readV1Seen(user.id);
        const { msgs, reactions: reacts } = await decodeMessages(
          sortedEarlier,
          user.id,
          seen,
        );
        setMessages((prev) => [...msgs, ...prev]);
        setReactions((prev) => {
          const merged = { ...prev };
          for (const [k, list] of Object.entries(reacts)) {
            merged[k] = list;
          }
          return merged;
        });
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
    const unsub = signalRService.onReceiveDirectMessage(
      async (msg: DirectMessageDto) => {
        const decrypted = await decryptOne(msg, user?.id ?? '');
        const text = decrypted.plaintext ?? decrypted.content ?? '';
        const decoded = decodeIncoming(text);

        if (decoded.isReaction) {
          const key = String(decoded.messageId);
          setReactions((prev) => {
            const arr = [...(prev[key] ?? [])];
            if (decoded.action === 'remove') {
              const idx = arr.findIndex(
                (r) => r.userId === decrypted.senderId && r.emoji === decoded.emoji,
              );
              if (idx >= 0) arr.splice(idx, 1);
            } else {
              const exists = arr.some(
                (r) => r.userId === decrypted.senderId && r.emoji === decoded.emoji,
              );
              if (!exists) arr.push({ emoji: decoded.emoji, userId: decrypted.senderId });
            }
            return { ...prev, [key]: arr };
          });
          return;
        }

        const local: LocalMessage = {
          ...decrypted,
          plaintext: decoded.body,
          content: decoded.body,
          viewOnce: decoded.viewOnce,
          viewed: false,
          replyToId: decoded.replyToId,
        };

        const otherId =
          msg.senderId === user?.id ? msg.recipientId : msg.senderId;
        if (otherId) {
          setLastMessages((prev) => {
            const existing = prev[otherId];
            if (existing && getMessageTime(existing) >= getMessageTime(local)) {
              return prev;
            }
            return { ...prev, [otherId]: local };
          });
        }

        const isCurrentChat =
          (msg.senderId === userIdRef.current &&
            msg.recipientId === user?.id) ||
          (msg.senderId === user?.id && msg.recipientId === userIdRef.current);

        if (isCurrentChat) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            const newText = decoded.body;
            const newMedia = decrypted.mediaUrl ?? '';
            const tempIdx = prev.findIndex(
              (m) =>
                typeof m.id === 'number' &&
                m.id < 0 &&
                m.senderId === decrypted.senderId &&
                (m.plaintext ?? m.content ?? '') === newText &&
                (m.mediaUrl ?? '') === newMedia,
            );
            if (tempIdx >= 0) {
              const next = [...prev];
              next[tempIdx] = local;
              return next;
            }
            return [...prev, local];
          });
          if (msg.senderId === userIdRef.current) {
            playReceive();
            void apiService.markDmRead(userIdRef.current!);
          }
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 50);
        } else if (
          msg.recipientId === user?.id &&
          msg.senderId !== user?.id
        ) {
          playReceive();
          setUnreadCounts((prev) => ({
            ...prev,
            [msg.senderId]: (prev[msg.senderId] ?? 0) + 1,
          }));
        }
      },
    );
    return () => {
      unsub();
    };
  }, [user?.id]);

  useEffect(() => {
    if (isPeerTyping && messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      const isNearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [isPeerTyping]);

  /* ── Send helpers ──────────────────────────────────────── */

  const sendImageOrMedia = useCallback(
    async (
      mediaUrl: string,
      mediaType: number,
      extraText = '',
      viewOnce = false,
      replyToId: number | null = null,
    ): Promise<void> => {
      if (!userId || !user?.id) return;
      const tempId = -Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          senderId: user.id,
          recipientId: userId,
          ciphertext: null,
          nonce: null,
          content: extraText || null,
          plaintext: extraText || undefined,
          mediaUrl,
          mediaType,
          isRead: false,
          sentAt: new Date().toISOString(),
          viewOnce,
          viewed: false,
          replyToId,
        },
      ]);
      let ciphertext = '';
      let nonce = '';
      let payload = extraText;
      if (replyToId != null) payload = encodeReply(replyToId, payload);
      if (viewOnce) payload = `[v1]${payload}`;
      if (payload) {
        const pub = await getPublicKeyFor(userId);
        const enc = await encryptFor(pub, payload);
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
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    },
    [userId, user?.id],
  );

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

  const handleCameraCapture = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    try {
      let toSend = file;
      try {
        toSend = await compressImage(file);
      } catch {
        toSend = file;
      }
      if (toSend.size > MAX_FILE_SIZE) {
        setFileError(
          `Photo too large after compression: ${formatFileSize(toSend.size)}`,
        );
        return;
      }
      const reader = new FileReader();
      const url = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Read failed'));
        reader.readAsDataURL(toSend);
      });
      await sendImageOrMedia(url, MediaType.Image);
    } catch (err) {
      setFileError(extractErrorMessage(err));
    } finally {
      const el = document.getElementById(
        'orbital-camera-input',
      ) as HTMLInputElement | null;
      if (el) el.value = '';
    }
  };

  const handleDocumentSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_FILE_SIZE) {
      setFileError(
        `File is ${formatFileSize(file.size)} — max is ${formatFileSize(MAX_FILE_SIZE)}.`,
      );
      if (documentInputRef.current) documentInputRef.current.value = '';
      return;
    }
    try {
      const reader = new FileReader();
      const url = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Read failed'));
        reader.readAsDataURL(file);
      });
      await sendImageOrMedia(url, MediaType.File);
    } catch (err) {
      setFileError(extractErrorMessage(err));
    } finally {
      if (documentInputRef.current) documentInputRef.current.value = '';
    }
  };

  const handleAudioFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_FILE_SIZE) {
      setFileError(
        `Audio is ${formatFileSize(file.size)} — max is ${formatFileSize(MAX_FILE_SIZE)}.`,
      );
      if (audioFileInputRef.current) audioFileInputRef.current.value = '';
      return;
    }
    try {
      const reader = new FileReader();
      const url = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Read failed'));
        reader.readAsDataURL(file);
      });
      await sendImageOrMedia(url, MediaType.Audio);
    } catch (err) {
      setFileError(extractErrorMessage(err));
    } finally {
      if (audioFileInputRef.current) audioFileInputRef.current.value = '';
    }
  };

  const handleVoiceComplete = useCallback(
    async (rec: VoiceRecording) => {
      setVoiceRecorderOpen(false);
      if (!userId) return;

      const reader = new FileReader();
      const dataUrlPromise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read audio'));
      });
      reader.readAsDataURL(rec.blob);
      const mediaUrl = await dataUrlPromise;
      await sendImageOrMedia(mediaUrl, MediaType.Audio);
    },
    [userId, sendImageOrMedia],
  );

  const handleEmojiPick = useCallback((emoji: string) => {
    setInputContent((prev) => prev + emoji);
    if (composerRef.current) {
      composerRef.current.focus();
      autoGrow(composerRef.current);
    }
  }, []);

  const handleSendGif = useCallback(
    (url: string) => {
      void sendImageOrMedia(url, MediaType.Image);
    },
    [sendImageOrMedia],
  );

  const handleSendSticker = useCallback(
    (url: string) => {
      void sendImageOrMedia(url, MediaType.Image);
    },
    [sendImageOrMedia],
  );

  /* ── React to a message ─────────────────────────────────── */

  const handleReact = useCallback(
    async (messageId: number, emoji: string) => {
      if (!userId || !user?.id) return;
      const key = String(messageId);
      const existing = reactions[key] ?? [];
      const mine = existing.find(
        (r) => r.userId === user.id && r.emoji === emoji,
      );
      const action: 'add' | 'remove' = mine ? 'remove' : 'add';

      setReactions((prev) => {
        const arr = [...(prev[key] ?? [])];
        if (action === 'remove') {
          const idx = arr.findIndex(
            (r) => r.userId === user.id && r.emoji === emoji,
          );
          if (idx >= 0) arr.splice(idx, 1);
        } else {
          const cleaned = arr.filter((r) => r.userId !== user.id);
          cleaned.push({ emoji, userId: user.id });
          return { ...prev, [key]: cleaned };
        }
        return { ...prev, [key]: arr };
      });

      try {
        const payload = encodeReaction(messageId, emoji, action);
        const pub = await getPublicKeyFor(userId);
        const enc = await encryptFor(pub, payload);
        await signalRService.sendDirectMessage({
          recipientId: userId,
          ciphertext: enc.ciphertext,
          nonce: enc.nonce,
          mediaUrl: undefined,
          mediaType: undefined,
        });
      } catch (err) {
        console.warn('Reaction send failed:', err);
      }
    },
    [userId, user?.id, reactions],
  );

  const handleStartReply = useCallback((m: LocalMessage) => {
    if (typeof m.id === 'number' && m.id < 0) return;
    setReplyTo(m);
    if (composerRef.current) composerRef.current.focus();
  }, []);

  const handleOpenMenu = useCallback((m: LocalMessage) => {
    setMenuMessage(m);
  }, []);

  /* ── Send text + files ──────────────────────────────────── */

  // ✅ FIX #5 + #10: single send function, no fake FormEvent, precise rollback
  const doSendMessage = useCallback(async () => {
    if (!userId || !user?.id) return;
    if (!inputContent.trim() && pendingFiles.length === 0) return;

    stopTyping();
    setIsSending(true);
    setFileError(null);

    const text = inputContent.trim();
    const filesToSend = [...pendingFiles];
    const sendViewOnce = pendingViewOnce;
    const currentReplyTo = replyTo;

    setInputContent('');
    setPendingFiles([]);
    setPendingViewOnce(false);
    setReplyTo(null);
    setEmojiPanelOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (composerRef.current) composerRef.current.style.height = 'auto';
    setComposerVisible(true);

    // Track only the temp IDs created in *this* send for precise rollback
    const tempIds: number[] = [];

    try {
      if (filesToSend.length > 0) {
        for (let i = 0; i < filesToSend.length; i++) {
          const file = filesToSend[i];
          if (!file.type.startsWith('image/')) continue;
          if (file.size > MAX_FILE_SIZE) continue;

          const reader = new FileReader();
          const dataUrlPromise = new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
          });
          reader.readAsDataURL(file);
          const mediaUrl = await dataUrlPromise;
          const mediaType = MediaType.Image;

          const includeText = i === 0 && text.length > 0;
          const markV1 = sendViewOnce && i === 0;

          let payload = includeText ? text : '';
          if (currentReplyTo && typeof currentReplyTo.id === 'number' && currentReplyTo.id > 0) {
            payload = encodeReply(currentReplyTo.id, payload);
          }
          if (markV1) payload = `[v1]${payload}`;

          const tempId = -Date.now() - i;
          tempIds.push(tempId);
          setMessages((prev) => [
            ...prev,
            {
              id: tempId,
              senderId: user.id,
              recipientId: userId,
              ciphertext: null,
              nonce: null,
              content: includeText ? text : null,
              plaintext: includeText ? text : undefined,
              mediaUrl,
              mediaType,
              isRead: false,
              sentAt: new Date().toISOString(),
              viewOnce: markV1,
              viewed: false,
              replyToId:
                currentReplyTo && typeof currentReplyTo.id === 'number'
                  ? currentReplyTo.id
                  : null,
            },
          ]);

          let ciphertext = '';
          let nonce = '';
          if (payload.length > 0) {
            const recipientPub = await getPublicKeyFor(userId);
            const enc = await encryptFor(recipientPub, payload);
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
        let payload = text;
        if (currentReplyTo && typeof currentReplyTo.id === 'number' && currentReplyTo.id > 0) {
          payload = encodeReply(currentReplyTo.id, payload);
        }

        const tempId = -Date.now();
        tempIds.push(tempId);
        setMessages((prev) => [
          ...prev,
          {
            id: tempId,
            senderId: user.id,
            recipientId: userId,
            ciphertext: null,
            nonce: null,
            content: text,
            plaintext: text,
            isRead: false,
            sentAt: new Date().toISOString(),
            viewOnce: false,
            viewed: false,
            replyToId:
              currentReplyTo && typeof currentReplyTo.id === 'number'
                ? currentReplyTo.id
                : null,
          },
        ]);

        const recipientPub = await getPublicKeyFor(userId);
        const enc = await encryptFor(recipientPub, payload);
        await signalRService.sendDirectMessage({
          recipientId: userId,
          ciphertext: enc.ciphertext,
          nonce: enc.nonce,
          mediaUrl: undefined,
          mediaType: undefined,
        });
        playSend();
      }

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } catch (err) {
      // Remove ONLY this send's temp messages — not all temp messages
      setMessages((prev) =>
        prev.filter((m) => !tempIds.includes(m.id as number)),
      );
      setFileError(extractErrorMessage(err));
    } finally {
      setIsSending(false);
    }
  }, [
    userId,
    user?.id,
    inputContent,
    pendingFiles,
    pendingViewOnce,
    replyTo,
    stopTyping,
  ]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    void doSendMessage();
  };

  const handleSendFriendRequest = async () => {
    if (!targetUser?.userHandle) return;
    try {
      await apiService.sendFriendRequest({
        targetIdentifier: targetUser.userHandle,
      });
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

  const handleDeleteForMe = useCallback(async (m: LocalMessage) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setReactions((prev) => {
      const next = { ...prev };
      delete next[String(m.id)];
      return next;
    });
    try {
      await apiService.deleteDm(m.id);
    } catch (err) {
      setMessages((prev) =>
        [...prev, m].sort((a, b) => getMessageTime(a) - getMessageTime(b)),
      );
      alert(`Delete failed: ${extractErrorMessage(err)}`);
    }
  }, []);

  const handleRequestDeleteForEveryone = useCallback((m: LocalMessage) => {
    setPendingDeleteEveryoneId(m.id);
  }, []);

  const handleConfirmDeleteForEveryone = useCallback(async () => {
    if (pendingDeleteEveryoneId == null) return;
    const targetId = pendingDeleteEveryoneId;
    setMessages((prev) => prev.filter((x) => x.id !== targetId));
    setReactions((prev) => {
      const next = { ...prev };
      delete next[String(targetId)];
      return next;
    });
    setPendingDeleteEveryoneId(null);
    try {
      await apiService.deleteDmForEveryone(targetId);
    } catch (err) {
      if (userIdRef.current && currentUserIdRef.current) {
        try {
          const history = await apiService.getDmHistory(userIdRef.current, 50);
          const sorted = [...history].sort(
            (a, b) => getMessageTime(a) - getMessageTime(b),
          );
          const { msgs } = await decodeMessages(
            sorted,
            currentUserIdRef.current,
            readV1Seen(currentUserIdRef.current),
          );
          setMessages(msgs);
        } catch {
          /* ignore */
        }
      }
      alert(`Delete for everyone failed: ${extractErrorMessage(err)}`);
    }
  }, [pendingDeleteEveryoneId, decodeMessages]);

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
    setReactions({});
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
      | { type: 'msg'; key: string; message: LocalMessage; grouped: boolean };

    const out: Item[] = [];
    let lastDate = '';
    let lastSenderId = '';
    let lastTs = 0;

    for (const m of messages) {
      const day = parseUtc(m.sentAt).toDateString();
      if (day !== lastDate) {
        out.push({
          type: 'date',
          key: `d-${day}`,
          label: formatDayDivider(m.sentAt),
        });
        lastDate = day;
        lastSenderId = '';
        lastTs = 0;
      }
      const ts = getMessageTime(m);
      const sameSender = m.senderId === lastSenderId;
      const within = ts - lastTs < 7 * 60 * 1000;
      const isGrouped = sameSender && within;
      out.push({
        type: 'msg',
        key: String(m.id),
        message: m,
        grouped: isGrouped,
      });
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
        next &&
        next.type === 'msg' &&
        next.message.senderId === item.message.senderId;
      map.set(item.key, !nextIsSameSender);
    }
    return map;
  }, [grouped]);

  const findMessageById = useCallback(
    (id: number | null | undefined): LocalMessage | null => {
      if (id == null) return null;
      return messages.find((m) => m.id === id) ?? null;
    },
    [messages],
  );

  const onSidebarTouchStart = (friend: FriendDto) => {
    if (sidebarLongPressRef.current != null) {
      window.clearTimeout(sidebarLongPressRef.current);
    }
    sidebarLongPressRef.current = window.setTimeout(() => {
      setChatMenuFriend(friend);
    }, 500);
  };
  const onSidebarTouchEnd = () => {
    if (sidebarLongPressRef.current != null) {
      window.clearTimeout(sidebarLongPressRef.current);
      sidebarLongPressRef.current = null;
    }
  };

  const togglePin = (peerId: string) => {
    const next = new Set(pinnedIds);
    if (next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    setPinnedIds(next);
    writePinned(user?.id, next);
  };

  const toggleMute = (peerId: string) => {
    const next = new Set(mutedIds);
    if (next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    setMutedIds(next);
    writeMuted(user?.id, next);
  };

  const hasActiveChat = Boolean(userId && targetUser);
  const canSend = inputContent.trim().length > 0 || pendingFiles.length > 0;

  // ✅ FIX #4: revoke object URLs for pending image previews on change/unmount
  useEffect(() => {
    const urls: string[] = [];
    for (const f of pendingFiles) {
      if (f.type.startsWith('image/')) {
        urls.push(URL.createObjectURL(f));
      }
    }
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [pendingFiles]);

  return (
    <div
      className={`flex h-full w-full ${theme.bg} overflow-hidden relative transition-colors duration-500`}
    >
      <style>{THEME_ANIMATIONS}</style>

      {/* Sidebar */}
      <div
        className={`${
          hasActiveChat ? 'hidden md:flex' : 'flex'
        } w-full md:w-[340px] md:shrink-0 border-r ${theme.subtleBorder} ${theme.sidebarBg} flex-col h-full transition-colors duration-500`}
      >
        <div className="h-[68px] px-5 flex items-center justify-between shrink-0">
          <div className="flex items-baseline gap-2">
            <h2
              className={`text-[22px] font-bold tracking-tight ${theme.textPrimary}`}
            >
              Chats
            </h2>
            <span
              className={`text-[12px] tabular-nums font-semibold ${theme.textSecondary}`}
            >
              {friends.length}
            </span>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search
              className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${theme.textSecondary}`}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations"
              className={`w-full h-11 pl-10 pr-3 rounded-2xl ${theme.subtleBg} border ${theme.subtleBorder} text-[13.5px] ${theme.textPrimary} focus:outline-none transition-colors placeholder:opacity-60`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-0.5">
          {filteredFriends.length === 0 ? (
            <div
              className={`p-8 text-center text-[13px] font-medium ${theme.textSecondary}`}
            >
              {friends.length === 0 ? 'No contacts yet.' : 'No matches found.'}
            </div>
          ) : (
            filteredFriends.map((friend) => {
              const isSelected = friend.userId === userId;
              const isOnline = presenceStore.isOnline(friend.userId);
              const unread = unreadCounts[friend.userId] ?? 0;
              const last = lastMessages[friend.userId];
              const preview: LastMessagePreview | null =
                last && user?.id ? previewText(last, user.id) : null;
              const isPinned = pinnedIds.has(friend.userId);
              const isMuted = mutedIds.has(friend.userId);

              return (
                <button
                  key={friend.friendshipId}
                  onClick={() => navigate(`/app/dm/${friend.userId}`)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setChatMenuFriend(friend);
                  }}
                  onTouchStart={() => onSidebarTouchStart(friend)}
                  onTouchEnd={onSidebarTouchEnd}
                  onTouchCancel={onSidebarTouchEnd}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all duration-150 ${
                    isSelected ? theme.sidebarActive : theme.hoverBg
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
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isPinned && (
                          <Pin
                            className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`}
                          />
                        )}
                        <p
                          className={`text-[14px] font-bold truncate tracking-tight ${theme.textPrimary}`}
                        >
                          {friend.displayName}
                        </p>
                        {isMuted && (
                          <BellOff
                            className={`w-3 h-3 shrink-0 ${theme.textSecondary}`}
                          />
                        )}
                      </div>
                      {preview && (
                        <span
                          className={`shrink-0 text-[10.5px] tabular-nums font-medium ${theme.textSecondary}`}
                        >
                          {formatRelativeShort(preview.sentAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className={`text-[12px] truncate ${
                          unread > 0
                            ? `${theme.textPrimary} font-semibold`
                            : theme.textSecondary
                        }`}
                      >
                        {preview
                          ? `${preview.isMe ? 'You: ' : ''}${preview.text}`
                          : `@${friend.handle}`}
                      </p>
                      {unread > 0 && (
                        <span
                          className={`shrink-0 min-w-[20px] h-5 px-1.5 rounded-full ${theme.accent} text-[10.5px] font-bold tabular-nums flex items-center justify-center shadow-sm`}
                        >
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

      {/* Chat pane */}
      <div
        className={`${
          hasActiveChat ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col h-full min-w-0 ${theme.bg} relative transition-colors duration-500`}
      >
        {theme.ambientStyle && (
          <div
            className={`pointer-events-none absolute inset-0 ${
              theme.ambientClass ?? ''
            }`}
            style={theme.ambientStyle}
          />
        )}

        {userId && targetUser ? (
          <>
            <div
              className={`h-[68px] px-3 sm:px-5 border-b ${theme.subtleBorder} ${theme.composerBg} backdrop-blur-xl flex items-center justify-between shrink-0 gap-2 z-20 relative`}
            >
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => navigate('/app/dm')}
                  className={`md:hidden w-9 h-9 rounded-xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg} transition-colors shrink-0`}
                  aria-label="Back"
                >
                  <ChevronLeft className="w-[20px] h-[20px]" />
                </button>

                <button
                  type="button"
                  onClick={() => setProfileModalUserId(targetUser.id)}
                  className="shrink-0 rounded-full focus:outline-none transition-transform hover:scale-105"
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
                  <h3
                    className={`text-[15.5px] font-bold truncate tracking-tight ${theme.textPrimary}`}
                  >
                    {targetUser.displayName}
                  </h3>
                  <p
                    className={`text-[11.5px] truncate mt-0.5 flex items-center gap-1.5 ${theme.textSecondary}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isTargetOnline
                          ? 'bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                          : 'opacity-40 bg-current'
                      }`}
                    />
                    <span>
                      {isTargetOnline ? 'Active now' : 'Offline'}
                      <span className="opacity-70 hidden sm:inline">
                        {' '}
                        · @{targetUser.userHandle}
                      </span>
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <button
                  onClick={() => void handleAudioCall()}
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg} transition-colors`}
                  title="Audio call"
                >
                  <Phone className="w-[18px] h-[18px]" />
                </button>
                <button
                  onClick={() => void handleVideoCall()}
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg} transition-colors`}
                  title="Video call"
                >
                  <Video className="w-[18px] h-[18px]" />
                </button>
                <button
                  onClick={() => setInfoOpen(true)}
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg} transition-colors`}
                  title="Chat info"
                >
                  <Info className="w-[18px] h-[18px]" />
                </button>
              </div>
            </div>

            {!isConfirmedFriend && (
              <div className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#D97706]/[0.08] border-b border-[#D97706]/20 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
                <div
                  className={`flex items-center gap-2 min-w-0 ${theme.textSecondary}`}
                >
                  <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0" />
                  <span className="truncate">
                    You're not friends yet — messaging is limited.
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {friendRequestStatus && (
                    <span className="text-[11.5px] font-semibold text-[#4ADE80]">
                      {friendRequestStatus}
                    </span>
                  )}
                  <button
                    onClick={() => void handleSendFriendRequest()}
                    className={`h-7 px-3 rounded-lg ${theme.accent} text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-colors`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Add friend
                  </button>
                </div>
              </div>
            )}

            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-5 relative z-10"
            >
              {hasMore && !loadingHistory && (
                <div className="text-center pb-4">
                  <button
                    onClick={() => void handleLoadEarlier()}
                    disabled={loadingMore}
                    className={`px-4 py-2 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} text-[11.5px] font-medium ${theme.textSecondary} ${theme.hoverBg} disabled:opacity-50 transition-colors shadow-sm`}
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
                    <p
                      className={`text-[14.5px] font-bold tracking-tight ${theme.textPrimary}`}
                    >
                      Couldn't load messages
                    </p>
                    <p
                      className={`text-[12.5px] mt-1 max-w-[300px] ${theme.textSecondary}`}
                    >
                      {historyError}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const current = userId;
                      navigate('/app/dm');
                      setTimeout(() => navigate(`/app/dm/${current}`), 10);
                    }}
                    className={`h-9 px-4 rounded-xl ${theme.accent} text-[12.5px] font-semibold transition-colors`}
                  >
                    Retry
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center"
                    style={{
                      background:
                        'radial-gradient(circle, rgba(128,128,128,0.10), transparent 70%)',
                    }}
                  >
                    <div
                      className={`w-14 h-14 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} flex items-center justify-center`}
                    >
                      <User className={`w-6 h-6 ${theme.textSecondary}`} />
                    </div>
                  </div>
                  <div>
                    <p
                      className={`text-[15.5px] font-bold tracking-tight ${theme.textPrimary}`}
                    >
                      No messages yet
                    </p>
                    <p className={`text-[13px] mt-1 ${theme.textSecondary}`}>
                      Say hi to {targetUser.displayName}.
                    </p>
                  </div>
                </div>
              ) : (
                grouped.map((item) => {
                  if (item.type === 'date') {
                    return (
                      <div key={item.key} className="flex justify-center my-5 select-none">
                        <span
                          className={`px-3.5 py-1 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} text-[10.5px] uppercase tracking-[0.14em] ${theme.textSecondary} font-bold shadow-sm`}
                        >
                          {item.label}
                        </span>
                      </div>
                    );
                  }
                  const m = item.message;
                  const isMe = m.senderId === user?.id;
                  const replyTarget = findMessageById(m.replyToId);
                  return (
                    <MessageRow
                      key={item.key}
                      message={m}
                      isMe={isMe}
                      senderName={isMe ? 'You' : targetUser.displayName}
                      senderAvatar={
                        isMe ? user?.avatarUrl : targetUser.avatarUrl
                      }
                      grouped={item.grouped}
                      isLastOfGroup={isLastOfGroup.get(item.key) ?? true}
                      theme={theme}
                      reactions={reactions[String(m.id)] ?? []}
                      currentUserId={user?.id}
                      replyTarget={replyTarget}
                      onDeleteForMe={handleDeleteForMe}
                      onDeleteForEveryone={handleRequestDeleteForEveryone}
                      onRequestProfile={setProfileModalUserId}
                      onOpenImage={handleOpenImage}
                      onReact={handleReact}
                      onStartReply={handleStartReply}
                      onOpenMenu={handleOpenMenu}
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
                    className="flex items-end gap-2.5 mt-3 justify-start"
                  >
                    <div className="w-8 shrink-0">
                      <Avatar
                        name={targetUser.displayName}
                        src={targetUser.avatarUrl}
                        size="sm"
                      />
                    </div>
                    <div
                      className={`inline-flex items-center gap-1.5 px-4 py-3 rounded-[20px] rounded-bl-[4px] shadow-sm ${theme.bubbleReceived}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.32s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.16s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" />
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
                  initial={
                    reduceMotion ? false : { opacity: 0, y: 8, scale: 0.9 }
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={
                    reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.9 }
                  }
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  onClick={handleJumpToLatest}
                  className={`absolute bottom-24 right-6 z-30 w-10 h-10 rounded-full ${theme.accent} shadow-xl flex items-center justify-center transition-all`}
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
              className="shrink-0 overflow-hidden relative z-20"
            >
              <div
                className={`border-t ${theme.subtleBorder} ${theme.composerBg} backdrop-blur-xl`}
              >
                <AnimatePresence>
                  {emojiPanelOpen && (
                    <EmojiPanel
                      onPickEmoji={handleEmojiPick}
                      onSendGif={handleSendGif}
                      onSendSticker={handleSendSticker}
                      onClose={() => setEmojiPanelOpen(false)}
                    />
                  )}
                </AnimatePresence>

                <div className="px-2 sm:px-4 py-2.5 sm:py-3.5">
                  {voiceRecorderOpen ? (
                    <VoiceRecorder
                      onComplete={(rec) => void handleVoiceComplete(rec)}
                      onCancel={() => setVoiceRecorderOpen(false)}
                    />
                  ) : (
                    <>
                      {/* Reply preview */}
                      <AnimatePresence>
                        {replyTo && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={{ opacity: 0, y: 8, height: 0 }}
                            transition={{ duration: 0.18 }}
                            className="pb-2 overflow-hidden"
                          >
                            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.05] border-l-[3px] border-[#D97706] shadow-sm">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <CornerUpLeft className="w-3.5 h-3.5 text-[#D97706]" />
                                  <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-[#D97706]">
                                    Reply
                                  </span>
                                </div>
                                <p className="text-[12.5px] text-[#EDE5D4] truncate font-medium">
                                  {replyTo.plaintext ??
                                    replyTo.content ??
                                    (replyTo.mediaType === MediaType.Image
                                      ? '📷 Photo'
                                      : replyTo.mediaType === MediaType.Audio
                                        ? '🎤 Voice message'
                                        : 'Attachment')}
                                </p>
                              </div>
                              <button
                                onClick={() => setReplyTo(null)}
                                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#7A6F65] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                                aria-label="Cancel reply"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Pending files */}
                      <AnimatePresence>
                        {pendingFiles.length > 0 && (
                          <motion.div
                            initial={
                              reduceMotion
                                ? false
                                : { opacity: 0, y: 6, height: 0 }
                            }
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={
                              reduceMotion
                                ? undefined
                                : { opacity: 0, y: 6, height: 0 }
                            }
                            transition={{ duration: 0.18 }}
                            className="pb-2 sm:pb-3 overflow-hidden"
                          >
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {pendingFiles.map((file, index) => {
                                const isImage = file.type.startsWith('image/');
                                const previewUrl = isImage
                                  ? URL.createObjectURL(file)
                                  : null;
                                return (
                                  <div
                                    key={`${file.name}-${index}`}
                                    className={`relative shrink-0 w-20 h-20 rounded-2xl overflow-hidden shadow-sm ${theme.subtleBg} border ${theme.subtleBorder}`}
                                  >
                                    {isImage && previewUrl ? (
                                      <img
                                        src={previewUrl}
                                        alt={file.name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex flex-col items-center justify-center px-1 text-center">
                                        <FileText
                                          className={`w-5 h-5 ${theme.accentText}`}
                                        />
                                        <span
                                          className={`text-[9px] truncate w-full mt-1 ${theme.textSecondary}`}
                                        >
                                          {file.name}
                                        </span>
                                      </div>
                                    )}
                                    {pendingViewOnce && index === 0 && (
                                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white text-[9px] font-bold">
                                        1x
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => removePendingFile(index)}
                                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/75 hover:bg-[#B91C1C] text-white flex items-center justify-center transition-colors"
                                      aria-label={`Remove ${file.name}`}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-1.5">
                              <p
                                className={`text-[11.5px] font-medium ${theme.textSecondary}`}
                              >
                                {pendingFiles.length} file
                                {pendingFiles.length === 1 ? '' : 's'} ready
                              </p>
                              {/* ✅ FIX #2: space between border-* and text-* classes */}
                              <button
                                type="button"
                                onClick={() => setPendingViewOnce((v) => !v)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold transition-all shadow-sm ${
                                  pendingViewOnce
                                    ? 'bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white'
                                    : `${theme.subtleBg} border ${theme.subtleBorder} ${theme.textSecondary}`
                                }`}
                              >
                                <Eye className="w-3 h-3" />
                                View once
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <AnimatePresence>
                        {fileError && (
                          <motion.div
                            initial={
                              reduceMotion ? false : { opacity: 0, y: 4 }
                            }
                            animate={{ opacity: 1, y: 0 }}
                            exit={reduceMotion ? undefined : { opacity: 0, y: 4 }}
                            transition={{ duration: 0.15 }}
                            className="pb-2 sm:pb-3"
                          >
                            <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#F87171] px-2">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>{fileError}</span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <form
                        onSubmit={handleSendMessage}
                        className="flex items-end gap-1.5 sm:gap-2"
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileSelect}
                          accept="image/*"
                          className="hidden"
                          multiple
                        />
                        <input
                          id="orbital-camera-input"
                          type="file"
                          onChange={(e) => void handleCameraCapture(e)}
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                        />
                        <input
                          type="file"
                          ref={documentInputRef}
                          onChange={(e) => void handleDocumentSelect(e)}
                          className="hidden"
                        />
                        <input
                          type="file"
                          ref={audioFileInputRef}
                          onChange={(e) => void handleAudioFileSelect(e)}
                          accept="audio/*"
                          className="hidden"
                        />

                        {/* Emoji button */}
                        {/* ✅ FIX #3: space between accentText and subtleBgStrong */}
                        <button
                          type="button"
                          onClick={() => setEmojiPanelOpen((v) => !v)}
                          className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                            emojiPanelOpen
                              ? `${theme.accentText} ${theme.subtleBgStrong}`
                              : `${theme.textSecondary} ${theme.hoverBg}`
                          }`}
                          title="Emoji, GIFs & stickers"
                        >
                          <Smile className="w-[20px] h-[20px]" />
                        </button>

                        {/* Attach */}
                        <button
                          type="button"
                          onClick={() => setAttachmentSheetOpen(true)}
                          className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg} transition-colors`}
                          title="Attach"
                        >
                          <Paperclip className="w-[19px] h-[19px]" />
                        </button>

                        {/* Text input */}
                        <div className="flex-1 min-w-0 relative">
                          <textarea
                            ref={composerRef}
                            value={inputContent}
                            onChange={(e) => {
                              setInputContent(e.target.value);
                              autoGrow(e.currentTarget);
                              if (!composerVisible) setComposerVisible(true);
                              if (e.target.value.trim().length > 0) onType();
                              else stopTyping();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void doSendMessage();
                              }
                            }}
                            placeholder={
                              replyTo
                                ? `Reply to ${targetUser.displayName}…`
                                : `Message ${targetUser.displayName}`
                            }
                            rows={1}
                            className={`w-full resize-none px-4 py-2.5 text-[14.5px] ${theme.textPrimary} focus:outline-none leading-[1.5] max-h-[140px] overflow-y-auto rounded-[22px] ${theme.subtleBgStrong} border ${theme.subtleBorder} transition-colors placeholder:opacity-60`}
                          />
                        </div>

                        {/* Send / Mic */}
                        <AnimatePresence mode="popLayout" initial={false}>
                          {canSend ? (
                            <motion.button
                              key="send-btn"
                              type="submit"
                              disabled={isSending}
                              initial={
                                reduceMotion
                                  ? false
                                  : { scale: 0.6, opacity: 0 }
                              }
                              animate={{ scale: 1, opacity: 1 }}
                              exit={
                                reduceMotion
                                  ? undefined
                                  : { scale: 0.6, opacity: 0 }
                              }
                              transition={{
                                type: 'spring',
                                stiffness: 420,
                                damping: 26,
                              }}
                              className={`shrink-0 w-10 h-10 rounded-full ${theme.accent} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-md`}
                              aria-label="Send"
                            >
                              {isSending ? (
                                <Loader2 className="w-[18px] h-[18px] animate-spin" />
                              ) : (
                                <Send className="w-[18px] h-[18px]" />
                              )}
                            </motion.button>
                          ) : (
                            <motion.button
                              key="mic-btn"
                              type="button"
                              onClick={() => setVoiceRecorderOpen(true)}
                              initial={
                                reduceMotion
                                  ? false
                                  : { scale: 0.6, opacity: 0 }
                              }
                              animate={{ scale: 1, opacity: 1 }}
                              exit={
                                reduceMotion
                                  ? undefined
                                  : { scale: 0.6, opacity: 0 }
                              }
                              transition={{
                                type: 'spring',
                                stiffness: 420,
                                damping: 26,
                              }}
                              className={`shrink-0 w-10 h-10 rounded-full ${theme.accent} flex items-center justify-center shadow-md`}
                              aria-label="Record voice message"
                            >
                              <Mic className="w-[19px] h-[19px]" />
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </form>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 relative z-10 select-none">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
              style={{
                background:
                  'radial-gradient(circle, rgba(128,128,128,0.12), transparent 70%)',
              }}
            >
              <div
                className={`w-16 h-16 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} flex items-center justify-center shadow-inner`}
              >
                <User className={`w-7 h-7 ${theme.textSecondary}`} />
              </div>
            </div>
            <h3
              className={`text-[18px] font-bold mb-2 tracking-tight ${theme.textPrimary}`}
            >
              Your messages
            </h3>
            <p
              className={`text-[13.5px] max-w-[320px] leading-relaxed ${theme.textSecondary}`}
            >
              Pick a conversation from the sidebar to start chatting.
            </p>
          </div>
        )}
      </div>

      <AttachmentSheet
        open={attachmentSheetOpen}
        onClose={() => setAttachmentSheetOpen(false)}
        onPhoto={() => fileInputRef.current?.click()}
        onCamera={() => {
          const el = document.getElementById('orbital-camera-input') as HTMLInputElement | null;
          el?.click();
        }}
        onDocument={() => documentInputRef.current?.click()}
        onAudioFile={() => audioFileInputRef.current?.click()}
      />

      {/* Message menu */}
      <AnimatePresence>
        {menuMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[170] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setMenuMessage(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-xs rounded-t-[22px] sm:rounded-[22px] bg-[#1C1A17] border-t sm:border border-white/[0.08] shadow-2xl overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-white/[0.06]">
                <span className="text-[11px] uppercase tracking-[0.16em] text-[#7A6F65] font-semibold">
                  Message options
                </span>
              </div>
              <button
                onClick={() => {
                  handleStartReply(menuMessage);
                  setMenuMessage(null);
                }}
                className="w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
              >
                <Reply className="w-4 h-4 text-[#A8A29E]" />
                <span>Reply</span>
              </button>
              <button
                onClick={() => {
                  const t = menuMessage.plaintext ?? menuMessage.content ?? '';
                  if (t) void navigator.clipboard.writeText(t);
                  setMenuMessage(null);
                }}
                className="w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
              >
                <Copy className="w-4 h-4 text-[#A8A29E]" />
                <span>Copy text</span>
              </button>
              <button
                onClick={() => {
                  void handleDeleteForMe(menuMessage);
                  setMenuMessage(null);
                }}
                className="w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left"
              >
                <EyeOff className="w-4 h-4 text-[#A8A29E]" />
                <span>Delete for me</span>
              </button>
              {menuMessage.senderId === user?.id &&
                typeof menuMessage.id === 'number' &&
                menuMessage.id > 0 && (
                  <button
                    onClick={() => {
                      handleRequestDeleteForEveryone(menuMessage);
                      setMenuMessage(null);
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium text-[#F87171] hover:bg-[#B91C1C]/[0.10] transition-colors text-left border-t border-white/[0.04]"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete for everyone</span>
                  </button>
                )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              className="w-full max-w-sm rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden"
            >
              <div className="p-5">
                <h3 className="text-[14.5px] font-bold text-[#EDE5D4] mb-1.5">
                  Delete for everyone?
                </h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                  This message will be removed for both you and{' '}
                  {targetUser?.displayName ?? 'the other person'}. This cannot be
                  undone.
                </p>
              </div>
              <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2">
                <button
                  onClick={() => setPendingDeleteEveryoneId(null)}
                  className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] font-medium text-[#EDE5D4] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleConfirmDeleteForEveryone()}
                  className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[12.5px] font-semibold transition-colors"
                >
                  Delete for everyone
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {chatMenuFriend && (
          <ChatContextMenu
            friend={chatMenuFriend}
            isPinned={pinnedIds.has(chatMenuFriend.userId)}
            isMuted={mutedIds.has(chatMenuFriend.userId)}
            onClose={() => setChatMenuFriend(null)}
            onPin={() => togglePin(chatMenuFriend.userId)}
            onMute={() => toggleMute(chatMenuFriend.userId)}
            onMarkRead={() => {
              setUnreadCounts((prev) => {
                const next = { ...prev };
                delete next[chatMenuFriend.userId];
                return next;
              });
              void apiService.markDmRead(chatMenuFriend.userId);
            }}
            onClearChat={() => {
              void apiService.clearConversation(chatMenuFriend.userId);
              setLastMessages((prev) => {
                const next = { ...prev };
                delete next[chatMenuFriend.userId];
                return next;
              });
              if (chatMenuFriend.userId === userId) {
                setMessages([]);
                setReactions({});
              }
            }}
            onBlock={async () => {
              try {
                await apiService.blockUser(chatMenuFriend.userId);
                setFriends((prev) =>
                  prev.filter((f) => f.userId !== chatMenuFriend.userId),
                );
                if (chatMenuFriend.userId === userId) navigate('/app/dm');
              } catch (err) {
                alert(`Block failed: ${extractErrorMessage(err)}`);
              }
            }}
            onUnfriend={async () => {
              try {
                await apiService.unfriend(chatMenuFriend.userId);
                setFriends((prev) =>
                  prev.filter((f) => f.userId !== chatMenuFriend.userId),
                );
                if (chatMenuFriend.userId === userId) navigate('/app/dm');
              } catch (err) {
                alert(`Unfriend failed: ${extractErrorMessage(err)}`);
              }
            }}
          />
        )}
      </AnimatePresence>

      {targetUser && (
        <InfoModal
          open={infoOpen}
          targetUser={targetUser}
          isFriend={isConfirmedFriend}
          currentTheme={chatThemeKey}
          onThemeChange={setChatThemeKey}
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
        {viewerOpenIndex != null && viewerOpenIndex >= 0 && (
          <ImageViewer
            images={chatImages}
            startIndex={viewerOpenIndex}
            onClose={() => setViewerOpenIndex(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewOnceViewer && (
          <ViewOnceViewerModal
            url={viewOnceViewer.url}
            senderName={viewOnceViewer.senderName}
            sentAt={viewOnceViewer.sentAt}
            onClose={handleCloseViewOnce}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default DirectMessagePane;