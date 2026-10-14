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
  Flame,
  Timer,
  Link2,
  Sparkles,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Animated theme CSS                                         */
/* ────────────────────────────────────────────────────────── */

const THEME_ANIMATIONS = `
@keyframes theme-aurora-drift {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(-2%, 2%, 0) scale(1.05); }
}
@keyframes theme-neon-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.95; }
}
@keyframes theme-sunset-shift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
@keyframes theme-forest-breathe {
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50% { transform: scale(1.08); opacity: 0.85; }
}
@keyframes theme-ocean-wave {
  0%, 100% { transform: translateX(0%) translateY(0%); }
  50% { transform: translateX(-3%) translateY(2%); }
}
@keyframes theme-cosmic-stars {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.02); }
}
@keyframes theme-mono-scan {
  0% { background-position: 0 0; }
  100% { background-position: 0 8px; }
}
@keyframes streak-flicker {
  0%, 100% { transform: scale(1) rotate(-2deg); filter: brightness(1); }
  50% { transform: scale(1.12) rotate(2deg); filter: brightness(1.35); }
}
@media (prefers-reduced-motion: reduce) {
  [class*="theme-anim-"] { animation: none !important; }
}
`;

/* ────────────────────────────────────────────────────────── */
/* Theme system                                               */
/* ────────────────────────────────────────────────────────── */

type ChatThemeKey =
  | 'midnight'
  | 'aurora'
  | 'sunset'
  | 'forest'
  | 'ocean'
  | 'neon'
  | 'cosmic'
  | 'mono';

interface ChatTheme {
  label: string;
  swatch: string;
  bg: string;
  sidebarBg: string;
  sidebarActive: string;
  bubbleSent: string;
  bubbleSentText: string;
  bubbleReceived: string;
  bubbleReceivedText: string;
  accent: string;
  accentText: string;
  composerBg: string;
  glow: string;
  ambientStyle?: React.CSSProperties;
  ambientClass?: string;
}

const CHAT_THEMES: Record<ChatThemeKey, ChatTheme> = {
  midnight: {
    label: 'Midnight',
    swatch: 'linear-gradient(135deg, #E58E1E, #1F1D1A)',
    bg: 'bg-[#0A0908]',
    sidebarBg: 'bg-[#0D0C0A]',
    sidebarActive: 'bg-white/[0.06] ring-white/[0.06]',
    bubbleSent: 'bg-gradient-to-br from-[#E58E1E] to-[#C96A05] text-[#171106]',
    bubbleSentText: 'text-[#171106]',
    bubbleReceived: 'bg-[#1F1D1A] border border-white/[0.05] text-[#F2EDE4]',
    bubbleReceivedText: 'text-[#F2EDE4]',
    accent: 'bg-[#D97706] hover:bg-[#B45309] text-[#171106]',
    accentText: 'text-[#D97706]',
    composerBg: 'bg-[#0A0908]/85',
    glow: 'shadow-[0_2px_6px_-2px_rgba(217,119,6,0.4)]',
  },
  aurora: {
    label: 'Aurora',
    swatch: 'linear-gradient(135deg, #A78BFA, #22D3EE)',
    bg: 'bg-[#070A0E]',
    sidebarBg: 'bg-[#0A0E14]',
    sidebarActive: 'bg-[#22D3EE]/[0.08] ring-[#22D3EE]/20',
    bubbleSent: 'bg-gradient-to-br from-[#A78BFA] to-[#22D3EE] text-[#0A0E14]',
    bubbleSentText: 'text-[#0A0E14]',
    bubbleReceived: 'bg-white/[0.06] border border-white/[0.08] text-[#E5E7EB]',
    bubbleReceivedText: 'text-[#E5E7EB]',
    accent: 'bg-[#22D3EE] hover:bg-[#06B6D4] text-[#0A0E14]',
    accentText: 'text-[#22D3EE]',
    composerBg: 'bg-[#070A0E]/85',
    glow: 'shadow-[0_2px_12px_-2px_rgba(34,211,238,0.4)]',
    ambientClass: 'theme-anim-aurora',
    ambientStyle: {
      background:
        'radial-gradient(60% 50% at 20% 0%, rgba(167,139,250,0.18), transparent 60%), radial-gradient(50% 60% at 100% 100%, rgba(34,211,238,0.16), transparent 60%)',
      animation: 'theme-aurora-drift 14s ease-in-out infinite',
      filter: 'blur(40px)',
    },
  },
  sunset: {
    label: 'Sunset',
    swatch: 'linear-gradient(135deg, #FB7185, #F59E0B)',
    bg: 'bg-[#100705]',
    sidebarBg: 'bg-[#150A07]',
    sidebarActive: 'bg-[#FB7185]/[0.08] ring-[#FB7185]/20',
    bubbleSent: 'bg-gradient-to-br from-[#FB7185] to-[#F59E0B] text-[#1A0A05]',
    bubbleSentText: 'text-[#1A0A05]',
    bubbleReceived: 'bg-[#251209] border border-white/[0.06] text-[#FCE7D2]',
    bubbleReceivedText: 'text-[#FCE7D2]',
    accent: 'bg-[#FB7185] hover:bg-[#E11D48] text-[#1A0A05]',
    accentText: 'text-[#FB7185]',
    composerBg: 'bg-[#100705]/85',
    glow: 'shadow-[0_2px_12px_-2px_rgba(251,113,133,0.35)]',
    ambientClass: 'theme-anim-sunset',
    ambientStyle: {
      background:
        'linear-gradient(120deg, rgba(251,113,133,0.14), rgba(245,158,11,0.10), rgba(251,113,133,0.14))',
      backgroundSize: '200% 200%',
      animation: 'theme-sunset-shift 18s ease-in-out infinite',
      filter: 'blur(50px)',
    },
  },
  forest: {
    label: 'Forest',
    swatch: 'linear-gradient(135deg, #34D399, #065F46)',
    bg: 'bg-[#04100A]',
    sidebarBg: 'bg-[#06160D]',
    sidebarActive: 'bg-[#34D399]/[0.08] ring-[#34D399]/20',
    bubbleSent: 'bg-gradient-to-br from-[#34D399] to-[#059669] text-[#03190E]',
    bubbleSentText: 'text-[#03190E]',
    bubbleReceived: 'bg-[#0E241A] border border-[#34D399]/[0.10] text-[#D1FAE5]',
    bubbleReceivedText: 'text-[#D1FAE5]',
    accent: 'bg-[#34D399] hover:bg-[#10B981] text-[#03190E]',
    accentText: 'text-[#34D399]',
    composerBg: 'bg-[#04100A]/85',
    glow: 'shadow-[0_2px_12px_-2px_rgba(52,211,153,0.35)]',
    ambientClass: 'theme-anim-forest',
    ambientStyle: {
      background:
        'radial-gradient(50% 45% at 50% 0%, rgba(52,211,153,0.16), transparent 60%), radial-gradient(40% 40% at 20% 100%, rgba(16,185,129,0.12), transparent 60%)',
      animation: 'theme-forest-breathe 10s ease-in-out infinite',
      filter: 'blur(45px)',
    },
  },
  ocean: {
    label: 'Ocean',
    swatch: 'linear-gradient(135deg, #38BDF8, #1E40AF)',
    bg: 'bg-[#050A14]',
    sidebarBg: 'bg-[#070E1A]',
    sidebarActive: 'bg-[#38BDF8]/[0.08] ring-[#38BDF8]/20',
    bubbleSent: 'bg-gradient-to-br from-[#38BDF8] to-[#1E40AF] text-[#021024]',
    bubbleSentText: 'text-[#021024]',
    bubbleReceived: 'bg-[#0D1626] border border-[#38BDF8]/[0.10] text-[#DBEAFE]',
    bubbleReceivedText: 'text-[#DBEAFE]',
    accent: 'bg-[#38BDF8] hover:bg-[#0EA5E9] text-[#021024]',
    accentText: 'text-[#38BDF8]',
    composerBg: 'bg-[#050A14]/85',
    glow: 'shadow-[0_2px_12px_-2px_rgba(56,189,248,0.4)]',
    ambientClass: 'theme-anim-ocean',
    ambientStyle: {
      background:
        'radial-gradient(70% 50% at 50% 100%, rgba(56,189,248,0.18), transparent 60%), radial-gradient(40% 40% at 20% 0%, rgba(30,64,175,0.15), transparent 60%)',
      animation: 'theme-ocean-wave 12s ease-in-out infinite',
      filter: 'blur(45px)',
    },
  },
  neon: {
    label: 'Neon',
    swatch: 'linear-gradient(135deg, #22D3EE, #A78BFA, #F472B6)',
    bg: 'bg-[#08050F]',
    sidebarBg: 'bg-[#0D0817]',
    sidebarActive: 'bg-[#A78BFA]/[0.10] ring-[#A78BFA]/30',
    bubbleSent:
      'bg-gradient-to-br from-[#22D3EE] via-[#A78BFA] to-[#F472B6] text-[#08050F]',
    bubbleSentText: 'text-[#08050F]',
    bubbleReceived:
      'bg-[#160E24] border border-[#A78BFA]/[0.18] text-[#F5F3FF] shadow-[inset_0_0_20px_rgba(167,139,250,0.06)]',
    bubbleReceivedText: 'text-[#F5F3FF]',
    accent: 'bg-[#A78BFA] hover:bg-[#8B5CF6] text-[#08050F]',
    accentText: 'text-[#A78BFA]',
    composerBg: 'bg-[#08050F]/85',
    glow: 'shadow-[0_2px_16px_-2px_rgba(167,139,250,0.5)]',
    ambientClass: 'theme-anim-neon',
    ambientStyle: {
      background:
        'radial-gradient(45% 35% at 20% 0%, rgba(34,211,238,0.22), transparent 60%), radial-gradient(45% 35% at 80% 100%, rgba(244,114,182,0.20), transparent 60%), radial-gradient(35% 35% at 50% 50%, rgba(167,139,250,0.14), transparent 60%)',
      animation: 'theme-neon-pulse 4s ease-in-out infinite',
      filter: 'blur(40px)',
    },
  },
  cosmic: {
    label: 'Cosmic',
    swatch: 'linear-gradient(135deg, #F472B6, #6366F1, #0EA5E9)',
    bg: 'bg-[#05061A]',
    sidebarBg: 'bg-[#0A0B24]',
    sidebarActive: 'bg-[#6366F1]/[0.10] ring-[#6366F1]/30',
    bubbleSent: 'bg-gradient-to-br from-[#F472B6] via-[#A78BFA] to-[#6366F1] text-white',
    bubbleSentText: 'text-white',
    bubbleReceived:
      'bg-[#12122E] border border-[#6366F1]/[0.20] text-[#E0E7FF]',
    bubbleReceivedText: 'text-[#E0E7FF]',
    accent: 'bg-[#6366F1] hover:bg-[#4F46E5] text-white',
    accentText: 'text-[#A5B4FC]',
    composerBg: 'bg-[#05061A]/85',
    glow: 'shadow-[0_2px_16px_-2px_rgba(99,102,241,0.5)]',
    ambientClass: 'theme-anim-cosmic',
    ambientStyle: {
      background:
        'radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,0.9), transparent 50%), radial-gradient(1.5px 1.5px at 60% 70%, rgba(255,255,255,0.7), transparent 50%), radial-gradient(1px 1px at 80% 20%, rgba(255,255,255,0.8), transparent 50%), radial-gradient(2px 2px at 30% 80%, rgba(244,114,182,0.9), transparent 50%), radial-gradient(1.5px 1.5px at 75% 50%, rgba(165,180,252,0.9), transparent 50%), radial-gradient(60% 50% at 50% 0%, rgba(99,102,241,0.16), transparent 60%), radial-gradient(50% 50% at 50% 100%, rgba(244,114,182,0.12), transparent 60%)',
      animation: 'theme-cosmic-stars 8s ease-in-out infinite',
    },
  },
  mono: {
    label: 'Mono',
    swatch: 'linear-gradient(135deg, #E5E7EB, #1F2937)',
    bg: 'bg-[#0A0A0B]',
    sidebarBg: 'bg-[#0F0F11]',
    sidebarActive: 'bg-white/[0.06] ring-white/[0.08]',
    bubbleSent: 'bg-gradient-to-br from-[#E5E7EB] to-[#9CA3AF] text-[#0A0A0B]',
    bubbleSentText: 'text-[#0A0A0B]',
    bubbleReceived: 'bg-[#1A1A1D] border border-white/[0.06] text-[#F3F4F6]',
    bubbleReceivedText: 'text-[#F3F4F6]',
    accent: 'bg-[#E5E7EB] hover:bg-[#D1D5DB] text-[#0A0A0B]',
    accentText: 'text-[#E5E7EB]',
    composerBg: 'bg-[#0A0A0B]/85',
    glow: 'shadow-[0_2px_8px_-2px_rgba(255,255,255,0.15)]',
    ambientClass: 'theme-anim-mono',
    ambientStyle: {
      background:
        'repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 8px)',
      animation: 'theme-mono-scan 6s linear infinite',
    },
  },
};

/* ────────────────────────────────────────────────────────── */
/* Local message shape with snapchat metadata                 */
/* ────────────────────────────────────────────────────────── */

type LocalMessage = DirectMessageDto & {
  ttlSec?: number | null;
  viewOnce?: boolean;
  viewed?: boolean;
};

/* ────────────────────────────────────────────────────────── */
/* Persistence helpers — keyed by user.id so they survive      */
/* logout, session clears, and browser restarts.               */
/* ────────────────────────────────────────────────────────── */

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
  return `orbital.chatTheme.${userId ?? 'anon'}.${peerId ?? 'none'}`;
}

function ttlKey(userId: string | undefined, peerId: string | undefined) {
  return `orbital.ttl.${userId ?? 'anon'}.${peerId ?? 'none'}`;
}

function v1SeenKey(userId: string | undefined) {
  return `orbital.v1seen.${userId ?? 'anon'}`;
}

function readThemeFor(
  userId: string | undefined,
  peerId: string | undefined,
): ChatThemeKey {
  const raw = lsGet<string | null>(themeKey(userId, peerId), null);
  if (raw && raw in CHAT_THEMES) return raw as ChatThemeKey;
  return 'midnight';
}

function writeThemeFor(
  userId: string | undefined,
  peerId: string | undefined,
  key: ChatThemeKey,
) {
  lsSet(themeKey(userId, peerId), key);
}

function readTtlFor(
  userId: string | undefined,
  peerId: string | undefined,
): number | null {
  const raw = lsGet<number | null>(ttlKey(userId, peerId), null);
  return typeof raw === 'number' && raw > 0 ? raw : null;
}

function writeTtlFor(
  userId: string | undefined,
  peerId: string | undefined,
  sec: number | null,
) {
  lsSet(ttlKey(userId, peerId), sec);
}

function readV1Seen(userId: string | undefined): Set<number> {
  const arr = lsGet<number[]>(v1SeenKey(userId), []);
  return new Set(arr);
}

function markV1Seen(userId: string | undefined, messageId: number) {
  const set = readV1Seen(userId);
  set.add(messageId);
  lsSet(v1SeenKey(userId), Array.from(set));
}

/* ────────────────────────────────────────────────────────── */
/* Encoding: TTL + view-once markers in the plaintext body     */
/* ────────────────────────────────────────────────────────── */

const TTL_RE = /^\[ttl:(\d+)\]/;
const V1_RE = /^\[v1\]/;

function encodeOutgoing(text: string, ttlSec: number | null, viewOnce: boolean): string {
  let prefix = '';
  if (ttlSec) prefix += `[ttl:${ttlSec}]`;
  if (viewOnce) prefix += '[v1]';
  return prefix + text;
}

function decodeIncoming(text: string): {
  ttlSec: number | null;
  viewOnce: boolean;
  body: string;
} {
  let ttlSec: number | null = null;
  let viewOnce = false;
  let body = text;

  const ttl = body.match(TTL_RE);
  if (ttl) {
    ttlSec = parseInt(ttl[1], 10);
    body = body.slice(ttl[0].length);
  }
  const v1 = body.match(V1_RE);
  if (v1) {
    viewOnce = true;
    body = body.slice(v1[0].length);
  }
  return { ttlSec, viewOnce, body };
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

function formatTtlShort(sec: number): string {
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}m`;
  return `${sec}s`;
}

/* ────────────────────────────────────────────────────────── */
/* Streak computation                                         */
/* ────────────────────────────────────────────────────────── */

function computeStreak(
  messages: LocalMessage[],
  userA: string | undefined,
  userB: string | undefined,
): number {
  if (!userA || !userB) return 0;

  const byUser: Record<string, Set<string>> = {};
  for (const m of messages) {
    const day = parseUtc(m.sentAt).toDateString();
    if (!byUser[m.senderId]) byUser[m.senderId] = new Set();
    byUser[m.senderId].add(day);
  }
  const aDays = byUser[userA] ?? new Set<string>();
  const bDays = byUser[userB] ?? new Set<string>();
  const bothDays = new Set<string>();
  for (const d of aDays) if (bDays.has(d)) bothDays.add(d);
  if (bothDays.size === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cursor = new Date(today);
  // Allow the streak to still be "alive" if today has no messages yet
  if (!bothDays.has(cursor.toDateString())) {
    cursor.setDate(cursor.getDate() - 1);
    if (!bothDays.has(cursor.toDateString())) return 0;
  }
  let streak = 0;
  while (bothDays.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
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
  let text: string;
  if (msg.mediaType === MediaType.Image) text = '📷 Photo';
  else if (msg.mediaType === MediaType.Video) text = '🎥 Video';
  else if (msg.mediaType === MediaType.Audio) text = '🎤 Audio';
  else if (msg.mediaType === MediaType.File) text = '📎 File';
  else text = body;
  return { text, sentAt: msg.sentAt, isMe };
}

/* ────────────────────────────────────────────────────────── */
/* Link detection + previews                                  */
/* ────────────────────────────────────────────────────────── */

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

function extractUrls(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    const url = m[0];
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
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

function LinkifiedText({
  text,
  isMe,
}: {
  text: string;
  isMe: boolean;
}) {
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

  const linkColor = isMe
    ? 'text-black/70 underline decoration-black/30 hover:decoration-black/60'
    : 'text-[#7DD3FC] underline decoration-[#7DD3FC]/30 hover:decoration-[#7DD3FC]/70';

  return (
    <p className="whitespace-pre-wrap">
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
            className={`${linkColor} break-all transition-colors`}
          >
            {p.value}
          </a>
        ),
      )}
    </p>
  );
}

function LinkPreviews({ text, isMe }: { text: string; isMe: boolean }) {
  const urls = useMemo(() => extractUrls(text).slice(0, 3), [text]);
  if (urls.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {urls.map((url) => {
        const yt = getYouTubeId(url);
        if (yt) {
          return (
            <div
              key={url}
              className="rounded-[14px] overflow-hidden border border-white/[0.08] bg-black aspect-video w-full max-w-[420px]"
              onClick={(e) => e.stopPropagation()}
            >
              <iframe
                src={`https://www.youtube.com/embed/${yt}`}
                title="YouTube preview"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="w-full h-full"
              />
            </div>
          );
        }
        const vimeo = getVimeoId(url);
        if (vimeo) {
          return (
            <div
              key={url}
              className="rounded-[14px] overflow-hidden border border-white/[0.08] bg-black aspect-video w-full max-w-[420px]"
              onClick={(e) => e.stopPropagation()}
            >
              <iframe
                src={`https://player.vimeo.com/video/${vimeo}`}
                title="Vimeo preview"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="w-full h-full"
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
            className={`flex items-stretch gap-2.5 rounded-[14px] border overflow-hidden transition-colors ${
              isMe
                ? 'bg-black/[0.10] border-black/[0.15] hover:bg-black/[0.15]'
                : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.05]'
            }`}
          >
            <div
              className={`w-[68px] shrink-0 flex items-center justify-center ${
                isMe ? 'bg-black/[0.10]' : 'bg-white/[0.02]'
              }`}
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
            <div className="flex-1 min-w-0 py-2 pr-3">
              <div className="flex items-center gap-1.5">
                <Link2 className="w-3 h-3 opacity-60 shrink-0" />
                <span className="text-[11.5px] font-semibold truncate">
                  {host}
                </span>
                <ExternalLink className="w-3 h-3 opacity-40 shrink-0" />
              </div>
              <p className="text-[11.5px] opacity-70 truncate mt-0.5">{url}</p>
            </div>
          </a>
        );
      })}
    </div>
  );
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
        className="max-w-[95vw] max-h-[88vh] object-contain select-none rounded-lg"
      />
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Theme picker                                               */
/* ────────────────────────────────────────────────────────── */

function ThemePicker({
  current,
  onSelect,
  onClose,
}: {
  current: ChatThemeKey;
  onSelect: (k: ChatThemeKey) => void;
  onClose: () => void;
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
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -4 }}
      transition={{ duration: 0.14 }}
      className="absolute z-40 top-full right-0 mt-1.5 w-[230px] rounded-2xl bg-[#1F1D1A] border border-white/[0.08] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.9)] overflow-hidden backdrop-blur-md p-1.5"
    >
      <div className="px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-[#7A6F65] font-medium flex items-center gap-1.5">
        <Sparkles className="w-3 h-3" />
        Live theme
      </div>
      {(Object.keys(CHAT_THEMES) as ChatThemeKey[]).map((k) => {
        const t = CHAT_THEMES[k];
        const active = k === current;
        return (
          <button
            key={k}
            onClick={() => {
              onSelect(k);
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors ${
              active
                ? 'bg-white/[0.06] ring-1 ring-inset ring-white/[0.08]'
                : 'hover:bg-white/[0.04]'
            }`}
          >
            <span
              className="w-6 h-6 rounded-full border border-white/[0.10] shrink-0"
              style={{ background: t.swatch }}
            />
            <span className="text-[13px] text-[#EDE5D4] font-medium">
              {t.label}
            </span>
            {active && <Check className="w-3.5 h-3.5 text-[#4ADE80] ml-auto" />}
          </button>
        );
      })}
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* TTL picker                                                 */
/* ────────────────────────────────────────────────────────── */

const TTL_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Off', value: null },
  { label: '5 seconds', value: 5 },
  { label: '30 seconds', value: 30 },
  { label: '5 minutes', value: 300 },
  { label: '1 hour', value: 3600 },
];

function TtlPicker({
  current,
  onSelect,
  onClose,
}: {
  current: number | null;
  onSelect: (v: number | null) => void;
  onClose: () => void;
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
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -4 }}
      transition={{ duration: 0.14 }}
      className="absolute z-40 top-full right-0 mt-1.5 w-[200px] rounded-2xl bg-[#1F1D1A] border border-white/[0.08] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.9)] overflow-hidden backdrop-blur-md p-1.5"
    >
      <div className="px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-[#7A6F65] font-medium flex items-center gap-1.5">
        <Timer className="w-3 h-3" />
        Disappearing
      </div>
      {TTL_OPTIONS.map((o) => {
        const active = o.value === current;
        return (
          <button
            key={String(o.value)}
            onClick={() => {
              onSelect(o.value);
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors ${
              active
                ? 'bg-white/[0.06] ring-1 ring-inset ring-white/[0.08]'
                : 'hover:bg-white/[0.04]'
            }`}
          >
            <span className="text-[13px] text-[#EDE5D4] font-medium">
              {o.label}
            </span>
            {active && <Check className="w-3.5 h-3.5 text-[#4ADE80] ml-auto" />}
          </button>
        );
      })}
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* TTL countdown                                              */
/* ────────────────────────────────────────────────────────── */

function TtlBadge({ expiresAt }: { expiresAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return (
    <span className="inline-flex items-center gap-1 text-[10px] tabular-nums opacity-70">
      <Timer className="w-3 h-3" />
      {remaining}s
    </span>
  );
}

/* ────────────────────────────────────────────────────────── */
/* View-once media block                                      */
/* ────────────────────────────────────────────────────────── */

function ViewOnceBlock({
  url,
  alreadyOpened,
  onOpen,
  isMe,
}: {
  url: string;
  alreadyOpened: boolean;
  onOpen: () => void;
  isMe: boolean;
}) {
  if (alreadyOpened) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-4 py-3 rounded-[14px] border text-[12.5px] ${
          isMe
            ? 'bg-black/[0.10] border-black/[0.15]'
            : 'bg-white/[0.03] border-white/[0.08]'
        }`}
      >
        <EyeOff className="w-4 h-4 opacity-70" />
        <span className="opacity-80">Opened</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={`group/vo relative inline-flex items-center gap-2.5 px-4 py-3 rounded-[14px] border text-[12.5px] transition-colors ${
        isMe
          ? 'bg-black/[0.10] border-black/[0.15] hover:bg-black/[0.15]'
          : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]'
      }`}
    >
      <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F472B6] to-[#A78BFA] flex items-center justify-center shrink-0">
        <Eye className="w-4 h-4 text-white" />
      </span>
      <span className="text-left">
        <span className="block font-semibold">View once</span>
        <span className="block opacity-70 text-[11px]">Tap to reveal</span>
      </span>
      {/* Hidden preview thumbnail, loaded only on open */}
      <span data-url={url} className="hidden" />
    </button>
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
  onDeleteForMe: (m: LocalMessage) => void;
  onDeleteForEveryone: (m: LocalMessage) => void;
  onRequestProfile: (userId: string) => void;
  onOpenImage: (m: LocalMessage, senderName: string) => void;
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
    const isTemp = typeof message.id === 'number' && message.id < 0;
    const isImage = message.mediaType === MediaType.Image;
    const isViewOnce = Boolean(message.viewOnce);

    // Standalone image: image + no text → no bubble wrapper at all
    const standaloneImage =
      hasMedia && isImage && !displayText && !isViewOnce;

    const expiresAt =
      message.ttlSec && !isTemp
        ? getMessageTime(message) + message.ttlSec * 1000
        : null;

    const tail = isLastOfGroup
      ? isMe
        ? 'rounded-br-[6px]'
        : 'rounded-bl-[6px]'
      : '';

    const hasUrls = extractUrls(displayText).length > 0;

    return (
      <div
        className={`group/row relative flex w-full ${
          grouped ? 'mt-[2px]' : 'mt-3.5'
        } ${isMe ? 'justify-end' : 'justify-start'} ${
          isTemp ? 'opacity-80' : ''
        }`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        {!isMe && (
          <div className="w-8 shrink-0 pt-0.5 mr-2.5">
            {!grouped ? (
              <button
                type="button"
                onClick={() => onRequestProfile(message.senderId)}
                className={`rounded-full focus:outline-none focus-visible:ring-2 ${theme.accentText} transition-transform hover:scale-[1.05]`}
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
          className={`flex flex-col min-w-0 max-w-[80%] sm:max-w-[70%] md:max-w-[62%] ${
            isMe ? 'items-end' : 'items-start'
          }`}
        >
          {!grouped && !isMe && (
            <div className="flex items-baseline gap-2 mb-1 px-1.5">
              <span className="text-[12px] font-semibold text-[#A8A29E] tracking-tight">
                {senderName}
              </span>
              <span className="text-[10.5px] text-[#5A524A] tabular-nums">
                {formatTime(message.sentAt)}
              </span>
              {message.ttlSec && (
                <span className="text-[10px] text-[#D97706] inline-flex items-center gap-0.5">
                  <Timer className="w-2.5 h-2.5" />
                  {formatTtlShort(message.ttlSec)}
                </span>
              )}
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

            {/* Standalone image — NO bubble wrapper */}
            {standaloneImage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenImage(message, senderName);
                }}
                className="relative group/img cursor-zoom-in overflow-hidden rounded-[20px] max-w-full transition-transform hover:scale-[1.005]"
                aria-label="View full image"
              >
                <img
                  src={message.mediaUrl ?? undefined}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="rounded-[20px] max-h-[360px] w-auto object-cover"
                  style={{
                    boxShadow:
                      '0 4px 20px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
                  }}
                />
                <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 backdrop-blur text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                  <ZoomIn className="w-3.5 h-3.5" />
                </span>
              </button>
            )}

            {/* Everything else: normal bubble */}
            {!standaloneImage && (
              <div
                className={`inline-block max-w-full text-[14.5px] leading-[1.4] break-words rounded-[19px] ${tail} ${
                  isMe ? theme.bubbleSent : theme.bubbleReceived
                } ${theme.glow} ${
                  displayText || hasUrls ? 'px-3.5 py-[7px]' : 'p-2'
                }`}
              >
                {hasMedia && (
                  <div className={displayText ? 'mb-2' : ''}>
                    {isImage && isViewOnce && (
                      <ViewOnceBlock
                        url={message.mediaUrl ?? ''}
                        alreadyOpened={Boolean(message.viewed)}
                        onOpen={() => onOpenImage(message, senderName)}
                        isMe={isMe}
                      />
                    )}
                    {isImage && !isViewOnce && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenImage(message, senderName);
                        }}
                        className="relative group/img cursor-zoom-in overflow-hidden rounded-[12px] block"
                        aria-label="View full image"
                      >
                        <img
                          src={message.mediaUrl ?? undefined}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="rounded-[12px] max-h-72 w-auto object-cover"
                        />
                        <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 backdrop-blur text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                          <ZoomIn className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    )}
                    {message.mediaType === MediaType.Video && (
                      <video
                        src={message.mediaUrl ?? undefined}
                        controls
                        preload="metadata"
                        className="rounded-[12px] max-h-72 w-full bg-black"
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
                        className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-[12px] text-[12.5px] ${
                          isMe ? 'bg-black/[0.14]' : 'bg-white/[0.04]'
                        }`}
                      >
                        <FileText className="w-4 h-4 shrink-0 opacity-70" />
                        <span className="truncate max-w-[180px]">
                          Attached file
                        </span>
                        <Download className="w-3.5 h-3.5 shrink-0 ml-1 opacity-70" />
                      </a>
                    )}
                  </div>
                )}

                {displayText && (
                  <div>
                    <LinkifiedText text={displayText} isMe={isMe} />
                    <LinkPreviews text={displayText} isMe={isMe} />
                  </div>
                )}
              </div>
            )}

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
                  } min-w-[190px] rounded-2xl bg-[#1F1D1A] border border-white/[0.08] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.9)] overflow-hidden backdrop-blur-md`}
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

          {/* Meta row: read receipt + TTL countdown */}
          <div className="flex items-center gap-2 mt-1 px-1.5">
            {isMe && isLastOfGroup && (
              <div
                className="flex items-center"
                aria-label={message.isRead ? 'Read' : 'Sent'}
              >
                {isTemp ? (
                  <Loader2 className="w-3 h-3 text-[#5A524A] animate-spin" />
                ) : message.isRead ? (
                  <CheckCheck className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-[#5A524A]" />
                )}
              </div>
            )}
            {expiresAt && <TtlBadge expiresAt={expiresAt} />}
          </div>
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
      prev.theme === next.theme
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
  streak: number;
  onClose: () => void;
  onUnfriend: () => Promise<void>;
  onClear: () => Promise<void>;
}

function InfoModal({
  open,
  targetUser,
  isFriend,
  streak,
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
              {streak > 0 && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D97706]/[0.10] border border-[#D97706]/25 text-[12px] font-semibold text-[#F59E0B]">
                  <Flame
                    className="w-3.5 h-3.5"
                    style={{ animation: 'streak-flicker 2s ease-in-out infinite' }}
                  />
                  {streak}-day streak
                </div>
              )}
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

  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<
    string | number | null
  >(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(
    null,
  );

  const [viewerOpenIndex, setViewerOpenIndex] = useState<number | null>(null);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [ttlPickerOpen, setTtlPickerOpen] = useState(false);

  // Per-chat theme + ttl, persisted by user.id + peerId
  const [chatThemeKey, setChatThemeKey] = useState<ChatThemeKey>(() =>
    readThemeFor(user?.id, userId),
  );
  const [ttlSec, setTtlSec] = useState<number | null>(() =>
    readTtlFor(user?.id, userId),
  );
  const [v1Seen, setV1Seen] = useState<Set<number>>(() => readV1Seen(user?.id));

  useEffect(() => {
    setChatThemeKey(readThemeFor(user?.id, userId));
    setTtlSec(readTtlFor(user?.id, userId));
  }, [userId, user?.id]);

  useEffect(() => {
    writeThemeFor(user?.id, userId, chatThemeKey);
  }, [user?.id, userId, chatThemeKey]);

  useEffect(() => {
    writeTtlFor(user?.id, userId, ttlSec);
  }, [user?.id, userId, ttlSec]);

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Prefetch peer's public key
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
          senderName:
            m.senderId === user?.id ? 'You' : targetUser?.displayName ?? 'Them',
          sentAt: m.sentAt,
          viewOnce: Boolean(m.viewOnce),
          id: m.id,
        })),
    [messages, user?.id, targetUser?.displayName],
  );

  const handleOpenImage = useCallback(
    (m: LocalMessage, _senderName: string) => {
      const idx = chatImages.findIndex((img) => img.url === m.mediaUrl);
      if (idx >= 0) setViewerOpenIndex(idx);

      // View-once: mark seen and remove from local view
      if (m.viewOnce && typeof m.id === 'number' && m.id > 0) {
        markV1Seen(currentUserIdRef.current, m.id);
        setV1Seen(new Set(readV1Seen(currentUserIdRef.current)));
      }
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

  // Helper: decode incoming messages with ttl + v1 metadata
  const decodeMessages = useCallback(
    async (
      raw: DirectMessageDto[],
      currentUserId: string,
      seenSet: Set<number>,
    ): Promise<LocalMessage[]> => {
      const decrypted = await decryptBatch(raw, currentUserId);
      return decrypted.map((d) => {
        const text = d.plaintext ?? d.content ?? '';
        const { ttlSec: t, viewOnce: v, body } = decodeIncoming(text);
        const viewed = v && typeof d.id === 'number' && seenSet.has(d.id);
        return {
          ...d,
          plaintext: body,
          content: body,
          ttlSec: t,
          viewOnce: v,
          viewed,
        };
      });
    },
    [],
  );

  // Initial history load
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
        const decrypted = await decodeMessages(sorted, user.id, seen);
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
  }, [userId, user?.id, decodeMessages]);

  // Background polling
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
        const decrypted = await decodeMessages(sorted, user.id, seen);
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
              ttlSec: d.ttlSec ?? existing.ttlSec,
              viewOnce: d.viewOnce ?? existing.viewOnce,
              viewed: d.viewed ?? existing.viewed,
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
      } catch {
        /* silent */
      } finally {
        inFlight = false;
      }
    };

    const interval = window.setInterval(poll, 8000);
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
        const decrypted = await decodeMessages(sortedEarlier, user.id, seen);
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

  // Real-time incoming
  useEffect(() => {
    const unsub = signalRService.onReceiveDirectMessage(
      async (msg: DirectMessageDto) => {
        const decrypted = await decryptOne(msg, user?.id ?? '');
        const text = decrypted.plaintext ?? decrypted.content ?? '';
        const { ttlSec: t, viewOnce: v, body } = decodeIncoming(text);
        const local: LocalMessage = {
          ...decrypted,
          plaintext: body,
          content: body,
          ttlSec: t,
          viewOnce: v,
          viewed: false,
        };

        const otherId =
          msg.senderId === user?.id ? msg.recipientId : msg.senderId;
        if (otherId) {
          setLastMessages((prev) => {
            const existing = prev[otherId];
            if (
              existing &&
              getMessageTime(existing) >= getMessageTime(local)
            ) {
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
            const newText = body;
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !user?.id) return;
    if (!inputContent.trim() && pendingFiles.length === 0) return;

    stopTyping();
    setIsSending(true);
    setFileError(null);

    const text = inputContent.trim();
    const filesToSend = [...pendingFiles];
    const sendViewOnce = pendingViewOnce;
    const sendTtl = ttlSec;

    // Clear composer immediately
    setInputContent('');
    setPendingFiles([]);
    setPendingViewOnce(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (composerRef.current) composerRef.current.style.height = 'auto';
    setComposerVisible(true);

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
          // Only mark view-once on the first image to keep semantics clear
          const markV1 = sendViewOnce && i === 0;
          const outgoingPlain = encodeOutgoing(
            includeText ? text : '',
            sendTtl,
            markV1,
          );

          const tempId = -Date.now() - i;
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
              ttlSec: sendTtl,
              viewOnce: markV1,
              viewed: false,
            },
          ]);

          let ciphertext = '';
          let nonce = '';
          if (outgoingPlain.length > 0) {
            const recipientPub = await getPublicKeyFor(userId);
            const enc = await encryptFor(recipientPub, outgoingPlain);
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
        const outgoingPlain = encodeOutgoing(text, sendTtl, false);
        const tempId = -Date.now();
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
            ttlSec: sendTtl,
            viewOnce: false,
            viewed: false,
          },
        ]);

        const recipientPub = await getPublicKeyFor(userId);
        const enc = await encryptFor(recipientPub, outgoingPlain);
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
      setMessages((prev) => prev.filter((m) => m.id > 0));
      setFileError(extractErrorMessage(err));
    } finally {
      setIsSending(false);
    }
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
          const decrypted = await decodeMessages(
            sorted,
            currentUserIdRef.current,
            readV1Seen(currentUserIdRef.current),
          );
          setMessages(decrypted);
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

  // Tick for TTL — only runs if there are TTL messages present
  const [ttlTick, setTtlTick] = useState(0);
  const hasTtl = useMemo(
    () => messages.some((m) => m.ttlSec && typeof m.id === 'number' && m.id > 0),
    [messages],
  );
  useEffect(() => {
    if (!hasTtl) return;
    const id = setInterval(() => setTtlTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasTtl]);

  // Filter out expired TTL messages + already-viewed view-once images
  const visibleMessages = useMemo(() => {
    const now = Date.now();
    return messages.filter((m) => {
      // Expired TTL → hide
      if (m.ttlSec && typeof m.id === 'number' && m.id > 0) {
        const expireAt = getMessageTime(m) + m.ttlSec * 1000;
        if (expireAt < now) return false;
      }
      // View-once that has already been opened by *me* (receiver) → keep rendered but as "opened" stub.
      return true;
    });
  }, [messages, ttlTick]);

  const grouped = useMemo(() => {
    type Item =
      | { type: 'date'; key: string; label: string }
      | { type: 'msg'; key: string; message: LocalMessage; grouped: boolean };

    const out: Item[] = [];
    let lastDate = '';
    let lastSenderId = '';
    let lastTs = 0;

    for (const m of visibleMessages) {
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
  }, [visibleMessages]);

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

  const streak = useMemo(
    () => computeStreak(messages, user?.id, userId),
    [messages, user?.id, userId],
  );

  const hasActiveChat = Boolean(userId && targetUser);

  return (
    <div
      className={`flex h-full w-full ${theme.bg} text-[#EDE5D4] overflow-hidden relative transition-colors duration-500`}
    >
      {/* Injected keyframes for animated themes */}
      <style>{THEME_ANIMATIONS}</style>

      {/* LEFT sidebar */}
      <div
        className={`${
          hasActiveChat ? 'hidden md:flex' : 'flex'
        } w-full md:w-[320px] md:shrink-0 border-r border-white/[0.05] ${theme.sidebarBg} flex-col h-full transition-colors duration-500`}
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
              className="w-full h-10 pl-10 pr-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-[13px] text-[#EDE5D4] placeholder:text-[#5A524A] focus:outline-none focus:border-white/[0.12] focus:bg-white/[0.05] transition-colors"
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
                    isSelected ? theme.sidebarActive : 'hover:bg-white/[0.03]'
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
                          className={`shrink-0 text-[10.5px] tabular-nums ${theme.accentText}`}
                        >
                          {formatRelativeShort(preview.sentAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className={`text-[11.5px] truncate ${
                          unread > 0
                            ? 'text-[#EDE5D4] font-medium'
                            : 'text-[#7A6F65]'
                        }`}
                      >
                        {preview
                          ? `${preview.isMe ? 'You: ' : ''}${preview.text}`
                          : `@${friend.handle}`}
                      </p>
                      {unread > 0 && (
                        <span
                          className={`shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full ${theme.accent} text-[10px] font-bold tabular-nums flex items-center justify-center`}
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

      {/* RIGHT chat */}
      <div
        className={`${
          hasActiveChat ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col h-full min-w-0 ${theme.bg} relative transition-colors duration-500`}
      >
        {/* Animated ambient background */}
        {theme.ambientStyle && (
          <div
            className={`pointer-events-none absolute inset-0 ${theme.ambientClass ?? ''}`}
            style={theme.ambientStyle}
          />
        )}

        {userId && targetUser ? (
          <>
            <div
              className={`h-[68px] px-3 sm:px-5 border-b border-white/[0.05] ${theme.composerBg} backdrop-blur-xl flex items-center justify-between shrink-0 gap-2 z-20 relative`}
            >
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => navigate('/app/dm')}
                  className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors shrink-0"
                  aria-label="Back"
                >
                  <ChevronLeft className="w-[18px] h-[18px]" />
                </button>

                <button
                  type="button"
                  onClick={() => setProfileModalUserId(targetUser.id)}
                  className="shrink-0 rounded-full focus:outline-none transition-transform hover:scale-[1.03]"
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
                  <h3 className="text-[14.5px] font-semibold text-[#EDE5D4] truncate tracking-tight flex items-center gap-2">
                    {targetUser.displayName}
                    {streak > 0 && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#D97706]/[0.14] border border-[#D97706]/30 text-[10.5px] font-bold text-[#F59E0B]"
                        title={`${streak}-day streak`}
                      >
                        <Flame
                          className="w-3 h-3"
                          style={{
                            animation:
                              'streak-flicker 2s ease-in-out infinite',
                          }}
                        />
                        {streak}
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-[#7A6F65] truncate mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isTargetOnline
                          ? 'bg-[#22C55E] shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                          : 'bg-[#5A524A]'
                      }`}
                    />
                    <span>
                      {isTargetOnline ? 'Active now' : 'Offline'}
                      <span className="text-[#5A524A] hidden sm:inline">
                        {' '}
                        · @{targetUser.userHandle}
                      </span>
                    </span>
                    {ttlSec && (
                      <span className="inline-flex items-center gap-0.5 text-[#D97706] ml-1">
                        <Timer className="w-3 h-3" />
                        {formatTtlShort(ttlSec)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 relative">
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
                <div className="relative">
                  <button
                    onClick={() => setTtlPickerOpen((v) => !v)}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/[0.05] transition-colors ${
                      ttlSec ? 'text-[#D97706]' : 'text-[#A8A29E]'
                    }`}
                    title="Disappearing messages"
                  >
                    <Timer className="w-[17px] h-[17px]" />
                  </button>
                  <AnimatePresence>
                    {ttlPickerOpen && (
                      <TtlPicker
                        current={ttlSec}
                        onSelect={setTtlSec}
                        onClose={() => setTtlPickerOpen(false)}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setThemePickerOpen((v) => !v)}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/[0.05] transition-colors ${theme.accentText}`}
                    title="Chat theme"
                  >
                    <Palette className="w-[17px] h-[17px]" />
                  </button>
                  <AnimatePresence>
                    {themePickerOpen && (
                      <ThemePicker
                        current={chatThemeKey}
                        onSelect={setChatThemeKey}
                        onClose={() => setThemePickerOpen(false)}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <button
                  onClick={() => setInfoOpen(true)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  title="Info"
                >
                  <Info className="w-[17px] h-[17px]" />
                </button>
              </div>
            </div>

            {!isConfirmedFriend && (
              <div className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#D97706]/[0.06] border-b border-[#D97706]/20 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
                <div className="flex items-center gap-2 text-[#A8A29E] min-w-0">
                  <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0" />
                  <span className="truncate">
                    You're not friends yet — messaging is limited.
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {friendRequestStatus && (
                    <span className="text-[11.5px] text-[#4ADE80]">
                      {friendRequestStatus}
                    </span>
                  )}
                  <button
                    onClick={() => void handleSendFriendRequest()}
                    className={`h-7 px-3 rounded-lg ${theme.accent} text-[11.5px] font-semibold inline-flex items-center gap-1.5 transition-colors`}
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
              className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-5 relative z-10"
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
                    className={`h-9 px-4 rounded-xl ${theme.accent} text-[12.5px] font-semibold transition-colors`}
                  >
                    Retry
                  </button>
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center"
                    style={{
                      background:
                        'radial-gradient(circle, rgba(255,255,255,0.05), transparent 70%)',
                    }}
                  >
                    <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                      <User className="w-6 h-6 text-[#7A6F65]" />
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
                      senderAvatar={
                        isMe ? user?.avatarUrl : targetUser.avatarUrl
                      }
                      grouped={item.grouped}
                      isLastOfGroup={isLastOfGroup.get(item.key) ?? true}
                      theme={theme}
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
                      className={`inline-flex items-center gap-1.5 px-4 py-3 rounded-[19px] rounded-bl-[6px] ${theme.bubbleReceived}`}
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
                  className={`absolute bottom-24 right-6 z-30 w-10 h-10 rounded-full ${theme.accent} shadow-lg flex items-center justify-center transition-colors`}
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
                className={`border-t border-white/[0.05] ${theme.composerBg} backdrop-blur-xl px-2 sm:px-4 py-2.5 sm:py-3.5`}
              >
                {/* Pending files */}
                <AnimatePresence>
                  {pendingFiles.length > 0 && (
                    <motion.div
                      initial={
                        reduceMotion ? false : { opacity: 0, y: 6, height: 0 }
                      }
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={
                        reduceMotion ? undefined : { opacity: 0, y: 6, height: 0 }
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
                              className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-white/[0.035] border border-white/[0.06]"
                            >
                              {isImage && previewUrl ? (
                                <img
                                  src={previewUrl}
                                  alt={file.name}
                                  className="w-full h-full object-cover"
                                  onLoad={() =>
                                    URL.revokeObjectURL(previewUrl)
                                  }
                                />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center px-1 text-center">
                                  <FileText
                                    className={`w-5 h-5 ${theme.accentText}`}
                                  />
                                  <span className="text-[9px] text-[#7A6F65] truncate w-full mt-1">
                                    {file.name}
                                  </span>
                                </div>
                              )}
                              {pendingViewOnce && index === 0 && (
                                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-[#F472B6] to-[#A78BFA] text-white text-[9px] font-bold">
                                  1x
                                </span>
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
                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <p className="text-[11px] text-[#7A6F65]">
                          {pendingFiles.length} file
                          {pendingFiles.length === 1 ? '' : 's'} ready to send
                        </p>
                        <button
                          type="button"
                          onClick={() => setPendingViewOnce((v) => !v)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold transition-colors ${
                            pendingViewOnce
                              ? 'bg-gradient-to-r from-[#F472B6] to-[#A78BFA] text-white'
                              : 'bg-white/[0.04] border border-white/[0.06] text-[#A8A29E] hover:text-[#EDE5D4]'
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

                <form
                  onSubmit={handleSendMessage}
                  className="flex items-end gap-2"
                >
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
                        if (e.target.value.trim().length > 0) onType();
                        else stopTyping();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSendMessage(
                            e as unknown as React.FormEvent,
                          );
                        }
                      }}
                      placeholder={`Message ${targetUser.displayName}`}
                      rows={1}
                      className="w-full resize-none px-4 py-2.5 text-[14.5px] text-[#EDE5D4] placeholder:text-[#5A524A] focus:outline-none leading-[1.5] max-h-[140px] overflow-y-auto rounded-[22px] bg-white/[0.045] border border-white/[0.06] focus:bg-white/[0.06] transition-colors"
                    />
                  </div>

                  <AnimatePresence mode="popLayout" initial={false}>
                    {(inputContent.trim().length > 0 ||
                      pendingFiles.length > 0) && (
                      <motion.button
                        key="send-btn"
                        type="submit"
                        disabled={isSending}
                        initial={
                          reduceMotion ? false : { scale: 0.6, opacity: 0 }
                        }
                        animate={{ scale: 1, opacity: 1 }}
                        exit={
                          reduceMotion ? undefined : { scale: 0.6, opacity: 0 }
                        }
                        transition={{
                          type: 'spring',
                          stiffness: 420,
                          damping: 26,
                        }}
                        className={`shrink-0 w-10 h-10 rounded-full ${theme.accent} disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center ${theme.glow}`}
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
          <div className="h-full flex flex-col items-center justify-center text-center px-8 relative z-10">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.06), transparent 70%)',
              }}
            >
              <div className="w-16 h-16 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <User className="w-7 h-7 text-[#7A6F65]" />
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

      {/* Delete for everyone confirm */}
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
                  {targetUser?.displayName ?? 'the other person'}. Cannot be
                  undone.
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
          streak={streak}
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