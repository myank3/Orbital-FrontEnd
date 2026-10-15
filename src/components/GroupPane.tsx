/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiService, extractErrorMessage } from '../services/api';
import { signalRService } from '../services/signalr';
import { presenceStore } from '../services/presenceStore';
import { useAuth } from '../context/AuthContext';
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
import { MAX_FILE_SIZE, formatFileSize } from '../services/upload';
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
  UserMinus,
  CheckCheck,
  Check,
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  EyeOff,
  Info,
  Eraser,
  Flag,
  ZoomIn,
  MoreHorizontal,
  Palette,
  Link2,
  ExternalLink,
  Pin,
  PinOff,
  Bell,
  BellOff,
  Reply,
  Copy,
  CornerUpLeft,
  Image as ImageIcon,
  Camera,
  Music,
  Smile,
  Keyboard,
  Mic,
  Plus,
  Hash,
  LogOut,
} from 'lucide-react';
import { playReceive, playSend, unlockSounds } from '../services/sounds';
import {
  useGroupTypingEmitter,
  useGroupTypingReceiver,
} from '../hooks/useTypingIndicator';
import {
  EmojiPanel,
  VoiceRecorder,
  type VoiceRecording,
} from './dm/ComposerToolkit';

/* ────────────────────────────────────────────────────────── */
/* Tunables                                                   */
/* ────────────────────────────────────────────────────────── */

const PAGE_SIZE = 50;
const PANEL_HEIGHT = 'h-[300px]';

/* ────────────────────────────────────────────────────────── */
/* Themes (mirrors DirectMessagePane)                         */
/* ────────────────────────────────────────────────────────── */

type ChatThemeKey =
  | 'obsidian' | 'paper' | 'terminal' | 'rose'
  | 'cobalt' | 'mint' | 'crimson' | 'void';

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
}

const CHAT_THEMES: Record<ChatThemeKey, ChatTheme> = {
  obsidian: {
    label: 'Obsidian',
    swatch: 'linear-gradient(135deg, #2A2A2A, #050505)',
    isLight: false,
    bg: 'bg-[#080808]',
    sidebarBg: 'bg-[#0E0E0E]',
    sidebarActive: 'bg-white/[0.08] ring-1 ring-inset ring-white/[0.08]',
    composerBg: 'bg-[#0E0E0E]',
    bubbleSent: 'bg-[#2E2E2E] text-white',
    bubbleReceived: 'bg-[#181818] text-[#EDEDED] border border-white/[0.04]',
    accent: 'bg-white hover:bg-[#E5E5E5] text-black',
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
    composerBg: 'bg-[#F7F4EE]',
    bubbleSent: 'bg-[#B8894A] text-white',
    bubbleReceived: 'bg-white text-[#1F1B16] border border-black/[0.05]',
    accent: 'bg-[#B8894A] hover:bg-[#9F7439] text-white',
    accentText: 'text-[#B8894A]',
    glow: 'shadow-none',
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
    composerBg: 'bg-[#07100A]',
    bubbleSent: 'bg-[#14361F] text-[#A7F3D0] border border-[#22C55E]/40',
    bubbleReceived: 'bg-[#0D2214] text-[#86EFAC] border border-[#22C55E]/[0.18]',
    accent: 'bg-[#22C55E] hover:bg-[#16A34A] text-[#07100A]',
    accentText: 'text-[#22C55E]',
    glow: 'shadow-none',
    textPrimary: 'text-[#86EFAC]',
    textSecondary: 'text-[#4D8060]',
    subtleBg: 'bg-white/[0.02]',
    subtleBgStrong: 'bg-white/[0.06]',
    subtleBorder: 'border-[#22C55E]/[0.12]',
    hoverBg: 'hover:bg-[#22C55E]/[0.08]',
    ambientStyle: {
      background:
        'repeating-linear-gradient(0deg, rgba(34,197,94,0.04) 0px, rgba(34,197,94,0.04) 1px, transparent 1px, transparent 6px)',
    },
  },
  rose: {
    label: 'Rose',
    swatch: 'linear-gradient(135deg, #FB7185, #F9A8D4)',
    isLight: true,
    bg: 'bg-[#FFF0F4]',
    sidebarBg: 'bg-[#FFE2EC]',
    sidebarActive: 'bg-[#FB7185]/[0.12] ring-1 ring-inset ring-[#FB7185]/30',
    composerBg: 'bg-[#FFF0F4]',
    bubbleSent: 'bg-gradient-to-br from-[#FB7185] to-[#F43F5E] text-white',
    bubbleReceived: 'bg-white text-[#4A1B2C] border border-[#FB7185]/[0.12]',
    accent: 'bg-[#FB7185] hover:bg-[#E11D48] text-white',
    accentText: 'text-[#FB7185]',
    glow: 'shadow-none',
    textPrimary: 'text-[#4A1B2C]',
    textSecondary: 'text-[#9A7280]',
    subtleBg: 'bg-black/[0.03]',
    subtleBgStrong: 'bg-black/[0.06]',
    subtleBorder: 'border-black/[0.07]',
    hoverBg: 'hover:bg-black/[0.05]',
    ambientStyle: {
      background:
        'radial-gradient(60% 50% at 80% 0%, rgba(251,113,133,0.10), transparent 60%), radial-gradient(50% 50% at 0% 100%, rgba(244,114,182,0.08), transparent 60%)',
    },
  },
  cobalt: {
    label: 'Cobalt',
    swatch: 'linear-gradient(135deg, #3B82F6, #0A1628)',
    isLight: false,
    bg: 'bg-[#0A1628]',
    sidebarBg: 'bg-[#0D1E36]',
    sidebarActive: 'bg-[#3B82F6]/[0.15] ring-1 ring-inset ring-[#3B82F6]/35',
    composerBg: 'bg-[#0A1628]',
    bubbleSent: 'bg-gradient-to-br from-[#2563EB] to-[#3B82F6] text-white',
    bubbleReceived: 'bg-[#132238] text-[#DBEAFE] border border-[#3B82F6]/[0.15]',
    accent: 'bg-[#3B82F6] hover:bg-[#2563EB] text-white',
    accentText: 'text-[#60A5FA]',
    glow: 'shadow-none',
    textPrimary: 'text-[#DBEAFE]',
    textSecondary: 'text-[#6E8EB8]',
    subtleBg: 'bg-white/[0.04]',
    subtleBgStrong: 'bg-white/[0.07]',
    subtleBorder: 'border-white/[0.08]',
    hoverBg: 'hover:bg-white/[0.05]',
    ambientStyle: {
      background:
        'radial-gradient(55% 45% at 20% 0%, rgba(59,130,246,0.12), transparent 60%), radial-gradient(50% 50% at 100% 100%, rgba(37,99,235,0.10), transparent 60%)',
    },
  },
  mint: {
    label: 'Mint',
    swatch: 'linear-gradient(135deg, #34D399, #F0FDF4)',
    isLight: true,
    bg: 'bg-[#EFFDF4]',
    sidebarBg: 'bg-[#DAFBE5]',
    sidebarActive: 'bg-[#34D399]/[0.15] ring-1 ring-inset ring-[#34D399]/35',
    composerBg: 'bg-[#EFFDF4]',
    bubbleSent: 'bg-gradient-to-br from-[#10B981] to-[#34D399] text-white',
    bubbleReceived: 'bg-white text-[#052E16] border border-[#34D399]/[0.18]',
    accent: 'bg-[#10B981] hover:bg-[#059669] text-white',
    accentText: 'text-[#059669]',
    glow: 'shadow-none',
    textPrimary: 'text-[#052E16]',
    textSecondary: 'text-[#487358]',
    subtleBg: 'bg-black/[0.03]',
    subtleBgStrong: 'bg-black/[0.06]',
    subtleBorder: 'border-black/[0.07]',
    hoverBg: 'hover:bg-black/[0.05]',
    ambientStyle: {
      background:
        'radial-gradient(55% 50% at 0% 0%, rgba(52,211,153,0.10), transparent 60%), radial-gradient(50% 50% at 100% 100%, rgba(16,185,129,0.08), transparent 60%)',
    },
  },
  crimson: {
    label: 'Crimson',
    swatch: 'linear-gradient(135deg, #DC2626, #150404)',
    isLight: false,
    bg: 'bg-[#150404]',
    sidebarBg: 'bg-[#200707]',
    sidebarActive: 'bg-[#DC2626]/[0.15] ring-1 ring-inset ring-[#DC2626]/35',
    composerBg: 'bg-[#150404]',
    bubbleSent: 'bg-gradient-to-br from-[#DC2626] to-[#991B1B] text-white',
    bubbleReceived: 'bg-[#280909] text-[#FEE2E2] border border-[#DC2626]/[0.16]',
    accent: 'bg-[#DC2626] hover:bg-[#B91C1C] text-white',
    accentText: 'text-[#F87171]',
    glow: 'shadow-none',
    textPrimary: 'text-[#FEE2E2]',
    textSecondary: 'text-[#966161]',
    subtleBg: 'bg-white/[0.03]',
    subtleBgStrong: 'bg-white/[0.07]',
    subtleBorder: 'border-white/[0.08]',
    hoverBg: 'hover:bg-white/[0.05]',
    ambientStyle: {
      background:
        'radial-gradient(60% 50% at 50% 100%, rgba(220,38,38,0.12), transparent 60%), radial-gradient(40% 40% at 20% 0%, rgba(153,27,27,0.10), transparent 60%)',
    },
  },
  void: {
    label: 'Void',
    swatch: 'linear-gradient(135deg, #A855F7, #05010F)',
    isLight: false,
    bg: 'bg-[#05010F]',
    sidebarBg: 'bg-[#0E061B]',
    sidebarActive: 'bg-[#A855F7]/[0.15] ring-1 ring-inset ring-[#A855F7]/35',
    composerBg: 'bg-[#05010F]',
    bubbleSent: 'bg-gradient-to-br from-[#7C3AED] via-[#A855F7] to-[#C084FC] text-white',
    bubbleReceived: 'bg-[#120822] text-[#F3E8FF] border border-[#A855F7]/[0.20]',
    accent: 'bg-[#A855F7] hover:bg-[#9333EA] text-white',
    accentText: 'text-[#C084FC]',
    glow: 'shadow-none',
    textPrimary: 'text-[#F3E8FF]',
    textSecondary: 'text-[#7D5F9F]',
    subtleBg: 'bg-white/[0.04]',
    subtleBgStrong: 'bg-white/[0.07]',
    subtleBorder: 'border-white/[0.08]',
    hoverBg: 'hover:bg-white/[0.05]',
    ambientStyle: {
      background:
        'radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,0.7), transparent 50%), radial-gradient(1.5px 1.5px at 60% 70%, rgba(192,132,252,0.8), transparent 50%), radial-gradient(1px 1px at 80% 20%, rgba(255,255,255,0.6), transparent 50%), radial-gradient(2px 2px at 30% 80%, rgba(168,85,247,0.8), transparent 50%), radial-gradient(1.5px 1.5px at 75% 50%, rgba(192,132,252,0.7), transparent 50%), radial-gradient(60% 50% at 50% 0%, rgba(124,58,237,0.14), transparent 60%), radial-gradient(50% 50% at 50% 100%, rgba(168,85,247,0.10), transparent 60%)',
    },
  },
};

/* ────────────────────────────────────────────────────────── */
/* Codec                                                      */
/* ────────────────────────────────────────────────────────── */

const REACT_RE = /^\[react:(-?\d+):([^:\]]+)(?::(add|remove))?\]$/;
const REPLY_RE = /^\[reply:(-?\d+)\]/;
const V1_RE = /^\[v1\]/;
const STICKER_RE = /^\[sticker\]/;

export interface ReactionEntry {
  emoji: string;
  userId: string;
}

interface DecodedMessage {
  viewOnce: boolean;
  sticker: boolean;
  body: string;
  replyToId: number | null;
  isReaction: false;
}
interface DecodedReaction {
  isReaction: true;
  messageId: number;
  emoji: string;
  action: 'add' | 'remove';
}
type Decoded = DecodedMessage | DecodedReaction;

function decodeIncoming(text: string): Decoded {
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
  let sticker = false;
  let replyToId: number | null = null;
  const v1 = body.match(V1_RE);
  if (v1) { viewOnce = true; body = body.slice(v1[0].length); }
  const st = body.match(STICKER_RE);
  if (st) { sticker = true; body = body.slice(st[0].length); }
  const reply = body.match(REPLY_RE);
  if (reply) { replyToId = parseInt(reply[1], 10); body = body.slice(reply[0].length); }
  return { viewOnce, sticker, body, replyToId, isReaction: false };
}

function encodeReaction(messageId: number, emoji: string, action: 'add' | 'remove' = 'add') {
  return `[react:${messageId}:${emoji}:${action}]`;
}
function encodeReply(replyToId: number, text: string) {
  return `[reply:${replyToId}]${text}`;
}

/* ────────────────────────────────────────────────────────── */
/* Types & persistence                                        */
/* ────────────────────────────────────────────────────────── */

type LocalMessage = GroupMessageDto & {
  viewOnce?: boolean;
  viewed?: boolean;
  sticker?: boolean;
  replyToId?: number | null;
  pending?: boolean;
};

interface ReactionEvent {
  messageId: number;
  emoji: string;
  action: 'add' | 'remove';
  userId: string;
}

interface SendPayload {
  text: string;
  files: File[];
  viewOnce: boolean;
}

const NO_MEDIA = null as unknown as GroupMessageDto['mediaUrl'];
const EMPTY_REACTIONS: ReactionEntry[] = [];

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

function themeKey(u?: string, g?: number) { return `orbital.groupTheme.v3.${u ?? 'anon'}.${g ?? 'none'}`; }
function pinnedKey(u?: string) { return `orbital.groupPinned.${u ?? 'anon'}`; }
function mutedKey(u?: string) { return `orbital.groupMuted.${u ?? 'anon'}`; }
function reactionsKey(u?: string, g?: number) { return `orbital.groupReactions.${u ?? 'anon'}.${g ?? 'none'}`; }

function readThemeFor(u?: string, g?: number): ChatThemeKey {
  const raw = lsGet<string | null>(themeKey(u, g), null);
  if (raw && raw in CHAT_THEMES) return raw as ChatThemeKey;
  return 'obsidian';
}
function writeThemeFor(u: string | undefined, g: number | undefined, k: ChatThemeKey) { lsSet(themeKey(u, g), k); }
function readPinned(u?: string): Set<string> { return new Set(lsGet<string[]>(pinnedKey(u), [])); }
function writePinned(u: string | undefined, s: Set<string>) { lsSet(pinnedKey(u), Array.from(s)); }
function readMuted(u?: string): Set<string> { return new Set(lsGet<string[]>(mutedKey(u), [])); }
function writeMuted(u: string | undefined, s: Set<string>) { lsSet(mutedKey(u), Array.from(s)); }
function readReactions(u?: string, g?: number): Record<string, ReactionEntry[]> {
  return lsGet<Record<string, ReactionEntry[]>>(reactionsKey(u, g), {});
}
function writeReactions(u: string | undefined, g: number | undefined, d: Record<string, ReactionEntry[]>) {
  lsSet(reactionsKey(u, g), d);
}

function applyReactionEvents(
  prev: Record<string, ReactionEntry[]>,
  events: ReactionEvent[],
): Record<string, ReactionEntry[]> {
  if (events.length === 0) return prev;
  const next = { ...prev };
  for (const ev of events) {
    const key = String(ev.messageId);
    const arr = [...(next[key] ?? [])];
    if (ev.action === 'remove') {
      const idx = arr.findIndex((r) => r.userId === ev.userId && r.emoji === ev.emoji);
      if (idx >= 0) arr.splice(idx, 1);
      next[key] = arr;
    } else {
      const filtered = arr.filter((r) => r.userId !== ev.userId);
      filtered.push({ emoji: ev.emoji, userId: ev.userId });
      next[key] = filtered;
    }
  }
  return next;
}

/* ────────────────────────────────────────────────────────── */
/* Random avatar helper                                       */
/* ────────────────────────────────────────────────────────── */

const AVATAR_GRADIENTS: Array<[string, string]> = [
  ['#F97316', '#DC2626'],
  ['#F59E0B', '#B45309'],
  ['#22C55E', '#0F766E'],
  ['#10B981', '#0EA5E9'],
  ['#3B82F6', '#6366F1'],
  ['#8B5CF6', '#EC4899'],
  ['#A855F7', '#6D28D9'],
  ['#EC4899', '#BE185D'],
  ['#14B8A6', '#0D9488'],
  ['#6366F1', '#0EA5E9'],
  ['#EF4444', '#B91C1C'],
  ['#84CC16', '#65A30D'],
];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickGradient(seed: string): [string, string] {
  const h = hashString(seed);
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

function initialsOf(name: string): string {
  const clean = name.trim().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '#';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Random, stable per-group avatar. Falls back to a colored initials tile
 * if the group has no explicit avatar URL.
 */
function GroupAvatar({
  name,
  groupId,
  src,
  size = 'md',
  ring = true,
}: {
  name: string;
  groupId: number | string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  ring?: boolean;
}) {
  if (src) {
    return <Avatar name={name} src={src} size={size} />;
  }

  const [from, to] = pickGradient(`${groupId}:${name}`);
  const initials = initialsOf(name);

  const dim =
    size === 'sm' ? 'w-8 h-8 text-[12px]' :
    size === 'lg' ? 'w-14 h-14 text-[19px]' :
    'w-10 h-10 text-[14px]';

  return (
    <span
      className={`${dim} rounded-full inline-flex items-center justify-center font-bold text-white select-none shrink-0 ${ring ? 'ring-1 ring-inset ring-white/[0.08]' : ''}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Helpers                                                    */
/* ────────────────────────────────────────────────────────── */

function parseUtc(s: string): Date {
  if (!s) return new Date();
  if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) return new Date(s);
  return new Date(s + 'Z');
}
function formatDayDivider(s: string): string {
  try {
    const d = parseUtc(s);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}
function formatTime(s: string): string {
  try { return parseUtc(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function formatRelativeShort(s: string): string {
  try {
    const then = parseUtc(s).getTime();
    const diff = Math.max(0, Date.now() - then);
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return parseUtc(s).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}
function getMessageTime(m: GroupMessageDto): number { return parseUtc(m.sentAt).getTime(); }
function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function autoGrow(el: HTMLTextAreaElement, max = 140) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}

function messageSnippet(m: LocalMessage): string {
  const t = m.content;
  if (t) return t;
  if (m.mediaType === MediaType.Image) return m.sticker ? '🎨 Sticker' : m.viewOnce ? '👁 View once' : '📷 Photo';
  if (m.mediaType === MediaType.Audio) return '🎤 Voice message';
  if (m.mediaType === MediaType.Video) return '🎥 Video';
  if (m.mediaType === MediaType.File) return '📎 File';
  return 'Attachment';
}

function messageTypeLabel(m: LocalMessage): string {
  if (m.sticker) return 'Sticker';
  if (m.mediaType === MediaType.Image) return m.viewOnce ? 'View-once photo' : 'Photo';
  if (m.mediaType === MediaType.Audio) return 'Voice message';
  if (m.mediaType === MediaType.Video) return 'Video';
  if (m.mediaType === MediaType.File) return 'File';
  return 'Text';
}

function previewText(msg: GroupMessageDto): { text: string; sentAt: string; sender: string } {
  const body = msg.content ?? '';
  const d = decodeIncoming(body);
  const viewOnce = Boolean((msg as LocalMessage).viewOnce) || (!d.isReaction && d.viewOnce);
  let text: string;
  if (d.isReaction) text = '👍 Reacted';
  else if (msg.mediaType === MediaType.Image) text = d.sticker ? '🎨 Sticker' : viewOnce ? '👁 View once' : '📷 Photo';
  else if (msg.mediaType === MediaType.Video) text = '🎥 Video';
  else if (msg.mediaType === MediaType.Audio) text = '🎤 Voice message';
  else if (msg.mediaType === MediaType.File) text = '📎 File';
  else text = d.body;
  return { text, sentAt: msg.sentAt, sender: msg.senderDisplayName ?? 'Someone' };
}

/* Links */

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

function extractUrls(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
  }
  return out;
}
function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
function getHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

/* ────────────────────────────────────────────────────────── */
/* Small presentational components                            */
/* ────────────────────────────────────────────────────────── */

function LinkifiedText({ text, isMe }: { text: string; isMe: boolean }) {
  const parts = useMemo(() => {
    if (!text) return [] as Array<{ type: 'text' | 'link'; value: string }>;
    const out: Array<{ type: 'text' | 'link'; value: string }> = [];
    let lastIdx = 0;
    URL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_REGEX.exec(text)) !== null) {
      if (m.index > lastIdx) out.push({ type: 'text', value: text.slice(lastIdx, m.index) });
      out.push({ type: 'link', value: m[0] });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) out.push({ type: 'text', value: text.slice(lastIdx) });
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
            className={`underline underline-offset-2 break-all font-medium ${isMe ? 'opacity-90' : ''}`}
          >
            {p.value}
          </a>
        ),
      )}
    </p>
  );
}

const LinkPreviews = React.memo(function LinkPreviews({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {urls.slice(0, 2).map((url) => {
        const yt = getYouTubeId(url);
        if (yt) {
          return (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="relative block rounded-[12px] overflow-hidden bg-black aspect-video w-[220px] max-w-full"
            >
              <img
                src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-11 h-11 rounded-full bg-black/65 flex items-center justify-center">
                  <span className="w-0 h-0 border-y-[8px] border-y-transparent border-l-[13px] border-l-white ml-1" />
                </span>
              </span>
            </a>
          );
        }
        const host = getHostname(url);
        return (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 rounded-[12px] border border-black/[0.06] bg-black/[0.05] max-w-[280px] px-2 py-1.5"
          >
            <img
              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
              alt=""
              width={16}
              height={16}
              loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="rounded shrink-0"
            />
            <div className="min-w-0 flex-1 flex items-center gap-1">
              <Link2 className="w-3 h-3 opacity-50 shrink-0" />
              <span className="text-[11px] font-semibold truncate">{host}</span>
            </div>
            <ExternalLink className="w-3 h-3 opacity-40 shrink-0" />
          </a>
        );
      })}
    </div>
  );
});

function ImageViewer({
  images, startIndex, onClose,
}: {
  images: Array<{ url: string; senderName: string; sentAt: string }>;
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
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
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black flex items-center justify-center select-none"
      onClick={onClose}
    >
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3.5 bg-gradient-to-b from-black/90 to-transparent z-10">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-white truncate tracking-tight">{current.senderName}</p>
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
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10"
          >
            <Download className="w-[18px] h-[18px]" />
          </a>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => Math.max(0, i - 1)); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/[0.1] hover:bg-white/[0.18] text-white flex items-center justify-center z-10"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => Math.min(images.length - 1, i + 1)); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/[0.1] hover:bg-white/[0.18] text-white flex items-center justify-center z-10"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      <img
        key={index}
        src={current.url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[88vh] object-contain select-none rounded-xl"
      />
    </div>
  );
}

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

/** WhatsApp-style message menu: reactions on top, message preview, actions below. */
function MessageMenu({
  message, isMe, theme, reactions, currentUserId,
  onClose, onReact, onReply, onCopy, onInfo, onDeleteForMe, onDeleteForEveryone,
}: {
  message: LocalMessage;
  isMe: boolean;
  theme: ChatTheme;
  reactions: ReactionEntry[];
  currentUserId: string | undefined;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onInfo: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canAct = typeof message.id === 'number' && message.id > 0;
  const text = message.content ?? '';
  const mine = new Set(reactions.filter((r) => r.userId === currentUserId).map((r) => r.emoji));
  const side = isMe ? 'self-end' : 'self-start';
  const itemCls = 'w-full flex items-center gap-3 px-4 py-3 text-[13.5px] font-medium text-left text-[#EDE5D4] hover:bg-white/[0.06] active:bg-white/[0.1]';
  const run = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <div
      className="fixed inset-0 z-[170] bg-black/65 flex items-center justify-center p-4"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[340px] flex flex-col gap-2.5 max-h-full overflow-y-auto"
      >
        {canAct && (
          <div className={`${side} flex items-center gap-0.5 px-2 py-1.5 rounded-full bg-[#1C1A17] border border-white/[0.1] shadow-2xl`}>
            {QUICK_REACTIONS.map((e) => (
              <button
                key={e}
                onClick={run(() => onReact(e))}
                className={`w-10 h-10 rounded-full flex items-center justify-center text-[22px] hover:bg-white/[0.1] active:bg-white/[0.16] ${
                  mine.has(e) ? 'bg-white/[0.14]' : ''
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <div
          className={`${side} max-w-[85%] rounded-[20px] px-4 py-2 text-[14px] leading-[1.45] shadow-lg ${
            isMe ? theme.bubbleSent : theme.bubbleReceived
          }`}
        >
          <p className="line-clamp-4 whitespace-pre-wrap break-words">{messageSnippet(message)}</p>
        </div>

        <div className={`${side} w-[250px] rounded-2xl bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden`}>
          {canAct && (
            <button onClick={run(onReply)} className={itemCls}>
              <Reply className="w-4 h-4 text-[#A8A29E]" /><span>Reply</span>
            </button>
          )}
          {text && (
            <button onClick={run(onCopy)} className={itemCls}>
              <Copy className="w-4 h-4 text-[#A8A29E]" /><span>Copy text</span>
            </button>
          )}
          {canAct && (
            <button onClick={run(onInfo)} className={itemCls}>
              <Info className="w-4 h-4 text-[#A8A29E]" /><span>Info</span>
            </button>
          )}
          {canAct && (
            <button onClick={run(onDeleteForMe)} className={`${itemCls} border-t border-white/[0.05]`}>
              <EyeOff className="w-4 h-4 text-[#A8A29E]" /><span>Delete for me</span>
            </button>
          )}
          {canAct && isMe && (
            <button
              onClick={run(onDeleteForEveryone)}
              className="w-full flex items-center gap-3 px-4 py-3 text-[13.5px] font-medium text-left text-[#F87171] hover:bg-[#B91C1C]/[0.12] active:bg-[#B91C1C]/[0.2]"
            >
              <Trash2 className="w-4 h-4" /><span>Delete for everyone</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageInfoModal({
  message, isMe, targetName, onClose,
}: { message: LocalMessage; isMe: boolean; targetName: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sentAt = (() => {
    try {
      return parseUtc(message.sentAt).toLocaleString([], {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  })();
  const isTemp = typeof message.id === 'number' && message.id < 0;
  const status = !isMe ? 'Received' : isTemp ? 'Sending…' : 'Sent';

  const rows: Array<[string, string]> = [
    [isMe ? 'Sent to' : 'From', targetName],
    ['Time', sentAt],
    ['Status', status],
    ['Type', messageTypeLabel(message)],
  ];

  return (
    <div className="fixed inset-0 z-[175] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-[14.5px] font-bold text-[#EDE5D4]">Message info</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7A6F65] hover:bg-white/[0.05]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-3 divide-y divide-white/[0.05]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
              <span className="text-[#7A6F65]">{k}</span>
              <span className="text-[#EDE5D4] font-medium flex items-center gap-1.5 text-right">
                {v}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReactionChips({
  reactions, currentUserId, isMe, onToggle,
}: {
  reactions: ReactionEntry[];
  currentUserId: string | undefined;
  isMe: boolean;
  onToggle: (e: string) => void;
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
    <div className={`flex items-center gap-1.5 mt-1.5 px-1 flex-wrap ${isMe ? 'justify-end' : 'justify-start'}`}>
      {grouped.map(([emoji, entries]) => {
        const mine = entries.some((e) => e.userId === currentUserId);
        return (
          <button
            key={emoji}
            onClick={() => onToggle(emoji)}
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-medium border ${
              mine
                ? 'bg-[#D97706]/[0.18] border-[#D97706]/50 text-[#F59E0B]'
                : 'bg-white/[0.08] border-white/[0.12] text-[#EDE5D4]'
            }`}
          >
            <span className="text-[14px] leading-none">{emoji}</span>
            {entries.length > 1 && (
              <span className="tabular-nums text-[11px] opacity-90 font-semibold">{entries.length}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ReplyPreviewBubble({
  replyTo, isMe, currentUserId, onJump,
}: {
  replyTo: LocalMessage;
  isMe: boolean;
  currentUserId: string | undefined;
  onJump: (id: number) => void;
}) {
  const body = messageSnippet(replyTo);
  const senderLabel = replyTo.senderId === currentUserId ? 'You' : replyTo.senderDisplayName ?? 'Reply';
  const display = body.length > 80 ? body.slice(0, 80) + '…' : body;
  const canJump = typeof replyTo.id === 'number' && replyTo.id > 0;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (canJump) onJump(replyTo.id as number);
      }}
      className={`w-full text-left mb-2 rounded-xl border-l-[3px] pl-2.5 pr-2 py-1.5 text-[12px] select-none ${
        isMe
          ? 'bg-black/[0.18] border-white/60 text-white/90'
          : 'bg-white/[0.08] border-[#D97706] text-[#EDE5D4]/90'
      } ${canJump ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <CornerUpLeft className="w-3 h-3 opacity-70 shrink-0" />
        <span className="font-bold tracking-tight opacity-95">{senderLabel}</span>
      </div>
      <p className="line-clamp-2 opacity-85 leading-snug">{display}</p>
    </button>
  );
}

function GroupContextMenu({
  group, isPinned, isMuted, onClose, onPin, onMute, onMarkRead, onClearChat, onLeave, onDelete,
}: {
  group: GroupDto;
  isPinned: boolean;
  isMuted: boolean;
  onClose: () => void;
  onPin: () => void;
  onMute: () => void;
  onMarkRead: () => void;
  onClearChat: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const actions = [
    { key: 'pin', label: isPinned ? 'Unpin group' : 'Pin group', icon: isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />, onClick: onPin, danger: false },
    { key: 'mute', label: isMuted ? 'Unmute notifications' : 'Mute notifications', icon: isMuted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />, onClick: onMute, danger: false },
    { key: 'read', label: 'Mark as read', icon: <CheckCheck className="w-4 h-4" />, onClick: onMarkRead, danger: false },
    { key: 'clear', label: 'Clear chat', icon: <Eraser className="w-4 h-4" />, onClick: onClearChat, danger: false },
    { key: 'leave', label: 'Leave group', icon: <LogOut className="w-4 h-4" />, onClick: onLeave, danger: true },
    { key: 'delete', label: 'Delete group', icon: <Trash2 className="w-4 h-4" />, onClick: onDelete, danger: true },
  ];

  return (
    <div
      className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xs rounded-t-[22px] sm:rounded-[22px] bg-[#1C1A17] border-t sm:border border-white/[0.08] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
          <GroupAvatar name={group.name} groupId={group.id} src={(group as any).avatarUrl} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#EDE5D4] truncate tracking-tight">{group.name}</p>
            <p className="text-[11.5px] text-[#7A6F65] truncate mt-0.5">
              {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[#7A6F65] hover:bg-white/[0.05]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="py-1.5 max-h-[60vh] overflow-y-auto">
          {actions.map((a) => (
            <button
              key={a.key}
              onClick={() => { a.onClick(); onClose(); }}
              className={`w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium text-left ${
                a.danger ? 'text-[#F87171] hover:bg-[#B91C1C]/[0.10]' : 'text-[#EDE5D4] hover:bg-white/[0.04]'
              }`}
            >
              <span className="shrink-0 opacity-80">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeGrid({ current, onSelect }: { current: ChatThemeKey; onSelect: (k: ChatThemeKey) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {(Object.keys(CHAT_THEMES) as ChatThemeKey[]).map((k) => {
        const t = CHAT_THEMES[k];
        const active = k === current;
        return (
          <button
            key={k}
            onClick={() => onSelect(k)}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-xl ${
              active ? 'bg-white/[0.08] ring-1 ring-inset ring-white/[0.14]' : 'hover:bg-white/[0.04]'
            }`}
          >
            <span
              className={`w-8 h-8 rounded-full border-2 ${
                active ? 'border-[#4ADE80]' : 'border-white/[0.12]'
              }`}
              style={{ background: t.swatch }}
            />
            <span className={`text-[10.5px] font-medium truncate max-w-full ${active ? 'text-[#EDE5D4] font-semibold' : 'text-[#A8A29E]'}`}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const WAVE_BARS = Array.from({ length: 24 }).map((_, i) =>
  Math.max(4, Math.min(24, 18 + Math.sin(i * 0.7) * 10 + (i % 3) * 4)),
);

function VoiceBubble({ url, isMe, theme }: { url: string; isMe: boolean; theme: ChatTheme }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.currentTime);
    const onMeta = () => { if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration); };
    const onEnd = () => { setPlaying(false); setProgress(0); };
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
    if (playing) { a.pause(); setPlaying(false); }
    else { void a.play(); setPlaying(true); }
  };
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <div
      className={`inline-flex items-center gap-3 px-3.5 py-2.5 rounded-[22px] select-none ${
        isMe ? theme.bubbleSent : theme.bubbleReceived
      } min-w-[220px] max-w-[280px]`}
    >
      <button
        type="button"
        onClick={toggle}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
          isMe ? 'bg-black/[0.18]' : 'bg-white/[0.08]'
        }`}
      >
        {playing ? (
          <span className="flex gap-1">
            <span className="w-[3px] h-3.5 rounded-sm bg-current" />
            <span className="w-[3px] h-3.5 rounded-sm bg-current" />
          </span>
        ) : (
          <span className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] ml-0.5" style={{ borderLeftColor: 'currentColor' }} />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-0.5 h-6">
          {WAVE_BARS.map((h, i) => (
            <span
              key={i}
              className="w-[2.5px] rounded-full"
              style={{
                height: `${h}px`,
                background: 'currentColor',
                opacity: (i / 24) * 100 <= pct ? 1 : 0.3,
              }}
            />
          ))}
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

function StickerBubble({ url }: { url: string }) {
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="w-[120px] h-[120px] object-contain select-none"
    />
  );
}

/* ────────────────────────────────────────────────────────── */
/* MessageRow                                                 */
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
  highlighted: boolean;
  onRequestProfile: (userId: string) => void;
  onOpenImage: (m: LocalMessage, senderName: string) => void;
  onReact: (messageId: number, emoji: string) => void;
  onStartReply: (m: LocalMessage) => void;
  onOpenMenu: (m: LocalMessage) => void;
  onJumpToReply: (id: number) => void;
  onMediaLoad: () => void;
}

const MessageRow = React.memo(
  function MessageRow({
    message, isMe, senderName, senderAvatar, grouped, isLastOfGroup, theme,
    reactions, currentUserId, replyTarget, highlighted,
    onRequestProfile, onOpenImage, onReact, onStartReply, onOpenMenu, onJumpToReply, onMediaLoad,
  }: MessageRowProps) {
    const innerRef = useRef<HTMLDivElement | null>(null);
    const iconRef = useRef<HTMLDivElement | null>(null);
    const swipeRef = useRef(0);
    const longPressRef = useRef<number | null>(null);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const swipingRef = useRef(false);

    const applySwipe = (x: number) => {
      swipeRef.current = x;
      const el = innerRef.current;
      if (el) {
        el.style.transform = x > 0 ? `translateX(${x}px)` : '';
        el.style.transition = x === 0 ? 'transform 120ms ease-out' : 'none';
      }
      if (iconRef.current) iconRef.current.style.opacity = String(Math.min(1, x / 60));
    };

    const clearLongPress = () => {
      if (longPressRef.current) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
    };

    const onTouchStart = (e: React.TouchEvent) => {
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY };
      swipingRef.current = false;
      longPressRef.current = window.setTimeout(() => {
        if (!swipingRef.current) {
          onOpenMenu(message);
          if (navigator.vibrate) navigator.vibrate(10);
        }
      }, 420);
    };
    const onTouchMove = (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      if (Math.abs(dy) > 15 && !swipingRef.current) { clearLongPress(); return; }
      if (!swipingRef.current && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        swipingRef.current = true;
        clearLongPress();
      }
      if (swipingRef.current) applySwipe(Math.max(0, Math.min(80, dx)));
    };
    const onTouchEnd = () => {
      clearLongPress();
      if (swipingRef.current && swipeRef.current > 55) {
        onStartReply(message);
        if (navigator.vibrate) navigator.vibrate(15);
      }
      if (swipeRef.current !== 0) applySwipe(0);
      swipingRef.current = false;
      touchStartRef.current = null;
    };

    const isViewOnce = Boolean(message.viewOnce);
    const hasMedia = Boolean(message.mediaUrl);
    const displayText = message.content ?? '';
    const isTemp = typeof message.id === 'number' && message.id < 0;
    const isSticker = Boolean(message.sticker);
    const hasText = Boolean(displayText);
    const urls = useMemo(() => extractUrls(displayText), [displayText]);

    const isEmojiOnly = useMemo(() => {
      if (!hasText) return false;
      const stripped = displayText.replace(/\s/g, '');
      if (stripped.length === 0 || stripped.length > 12) return false;
      const chars = Array.from(stripped);
      const count = chars.filter((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        return c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf);
      }).length;
      return count > 0 && count * 1.5 >= chars.length;
    }, [displayText, hasText]);

    const isVoice = message.mediaType === MediaType.Audio;
    const tailClass = isLastOfGroup ? (isMe ? 'rounded-br-[4px]' : 'rounded-bl-[4px]') : '';
    const canAct = typeof message.id === 'number' && message.id > 0;

    return (
      <div
        className={`group/row relative flex w-full ${
          grouped ? 'mt-[3px]' : 'mt-3.5'
        } ${isMe ? 'justify-end' : 'justify-start'} ${isTemp ? 'opacity-80' : ''}`}
      >
        <div
          ref={iconRef}
          className="absolute inset-y-0 left-0 flex items-center pointer-events-none"
          style={{ opacity: 0 }}
        >
          <div className="w-9 h-9 rounded-full bg-[#D97706]/[0.18] border border-[#D97706]/50 flex items-center justify-center">
            <Reply className="w-4 h-4 text-[#F59E0B]" />
          </div>
        </div>

        <div
          ref={innerRef}
          className={`relative flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onContextMenu={(e) => { e.preventDefault(); onOpenMenu(message); }}
        >
          {!isMe && (
            <div className="w-8 shrink-0 pt-0.5 mr-2.5">
              {!grouped ? (
                <button
                  type="button"
                  onClick={() => onRequestProfile(message.senderId)}
                  className="rounded-full focus:outline-none"
                >
                  <Avatar name={senderName} src={senderAvatar} size="sm" />
                </button>
              ) : (
                <span className="block w-8 h-8" aria-hidden />
              )}
            </div>
          )}

          <div
            id={`msg-${message.id}`}
            className={`relative flex flex-col min-w-0 max-w-[85%] sm:max-w-[74%] md:max-w-[65%] ${
              isMe ? 'items-end' : 'items-start'
            } rounded-2xl ${highlighted ? 'ring-2 ring-[#D97706]/60' : ''}`}
          >
            {canAct && (
              <div
                className={`hidden sm:flex absolute top-1 ${
                  isMe ? 'right-full mr-1.5' : 'left-full ml-1.5'
                } items-center gap-0.5 opacity-0 group-hover/row:opacity-100`}
              >
                <button
                  type="button"
                  onClick={() => onStartReply(message)}
                  title="Reply"
                  className={`w-7 h-7 rounded-full flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg}`}
                >
                  <Reply className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenMenu(message)}
                  title="More"
                  className={`w-7 h-7 rounded-full flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg}`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
            )}

            {!grouped && !isMe && (
              <div className="flex items-baseline gap-2 mb-1 px-1.5">
                <span className={`text-[12px] font-semibold tracking-tight ${theme.textSecondary}`}>{senderName}</span>
                <span className={`text-[10.5px] tabular-nums opacity-75 ${theme.textSecondary}`}>{formatTime(message.sentAt)}</span>
              </div>
            )}

            {hasMedia && isSticker && message.mediaType === MediaType.Image && (
              <StickerBubble url={message.mediaUrl ?? ''} />
            )}

            {hasMedia && !isSticker && !isVoice && (
              <div className="relative group/media max-w-full">
                {message.mediaType === MediaType.Image && !isViewOnce && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenImage(message, senderName); }}
                    className="relative cursor-zoom-in overflow-hidden rounded-[20px] block border border-white/[0.04]"
                  >
                    <img
                      src={message.mediaUrl ?? undefined}
                      alt=""
                      decoding="async"
                      onLoad={onMediaLoad}
                      className="rounded-[20px] max-h-[380px] w-auto object-cover"
                    />
                    <span className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/media:opacity-100 pointer-events-none">
                      <ZoomIn className="w-3.5 h-3.5" />
                    </span>
                  </button>
                )}

                {message.mediaType === MediaType.Video && (
                  <video
                    src={message.mediaUrl ?? undefined}
                    controls
                    preload="metadata"
                    className="rounded-[20px] max-h-[380px] w-full bg-black border border-white/[0.04]"
                  />
                )}

                {message.mediaType === MediaType.File && (
                  <a
                    href={message.mediaUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className={`inline-flex items-center gap-3 px-4 py-3 rounded-[18px] text-[13px] border ${theme.subtleBg} ${theme.subtleBorder} ${theme.hoverBg} ${theme.textPrimary}`}
                  >
                    <FileText className="w-4 h-4 shrink-0 opacity-80" />
                    <span className="truncate max-w-[200px] font-medium">Attached file</span>
                    <Download className="w-4 h-4 shrink-0 opacity-70" />
                  </a>
                )}
              </div>
            )}

            {isVoice && message.mediaUrl && <VoiceBubble url={message.mediaUrl} isMe={isMe} theme={theme} />}

            {hasText && (
              <div className={`relative inline-flex items-end gap-1.5 max-w-full ${hasMedia ? 'mt-1.5' : 'mt-0'}`}>
                {isEmojiOnly ? (
                  <div className="px-1 py-0.5 text-[44px] leading-[1.15] break-words max-w-full">{displayText}</div>
                ) : (
                  <div
                    className={`inline-block max-w-full text-[14.5px] leading-[1.5] break-words rounded-[20px] ${tailClass} px-4 py-2 ${
                      isMe ? theme.bubbleSent : theme.bubbleReceived
                    }`}
                  >
                    {replyTarget && (
                      <ReplyPreviewBubble
                        replyTo={replyTarget}
                        isMe={isMe}
                        currentUserId={currentUserId}
                        onJump={onJumpToReply}
                      />
                    )}
                    <LinkifiedText text={displayText} isMe={isMe} />
                  </div>
                )}
              </div>
            )}

            {reactions.length > 0 && (
              <ReactionChips
                reactions={reactions}
                currentUserId={currentUserId}
                isMe={isMe}
                onToggle={(emoji) => { if (canAct) onReact(message.id as number, emoji); }}
              />
            )}

            {urls.length > 0 && <LinkPreviews urls={urls} />}

            {isMe && isLastOfGroup && (
              <div className="flex items-center gap-1 mt-1 px-1.5 select-none">
                <span className={`text-[10px] tabular-nums opacity-60 ${theme.textSecondary}`}>{formatTime(message.sentAt)}</span>
                {isTemp ? (
                  <Loader2 className={`w-3 h-3 animate-spin ${theme.textSecondary}`} />
                ) : (
                  <CheckCheck className="w-3.5 h-3.5 text-[#4ADE80]" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.mediaUrl === next.message.mediaUrl &&
    prev.grouped === next.grouped &&
    prev.isLastOfGroup === next.isLastOfGroup &&
    prev.highlighted === next.highlighted &&
    prev.reactions === next.reactions &&
    prev.replyTarget === next.replyTarget &&
    prev.theme === next.theme &&
    prev.isMe === next.isMe &&
    prev.senderName === next.senderName &&
    prev.senderAvatar === next.senderAvatar,
);

/* ────────────────────────────────────────────────────────── */
/* Sidebar row                                                */
/* ────────────────────────────────────────────────────────── */

interface GroupRowProps {
  group: GroupDto;
  selected: boolean;
  last: GroupMessageDto | undefined;
  pinned: boolean;
  muted: boolean;
  theme: ChatTheme;
  onSelect: (id: number) => void;
  onMenu: (group: GroupDto) => void;
}

const GroupRow = React.memo(function GroupRow({
  group, selected, last, pinned, muted, theme, onSelect, onMenu,
}: GroupRowProps) {
  const timer = useRef<number | null>(null);
  const preview = last ? previewText(last) : null;

  const start = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onMenu(group), 500);
  };
  const end = () => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
  };

  return (
    <button
      onClick={() => onSelect(group.id)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(group); }}
      onTouchStart={start}
      onTouchEnd={end}
      onTouchMove={end}
      onTouchCancel={end}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left ${
        selected ? theme.sidebarActive : theme.hoverBg
      }`}
    >
      <GroupAvatar name={group.name} groupId={group.id} src={(group as any).avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {pinned && <Pin className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />}
            <p className={`text-[14px] font-bold truncate tracking-tight ${theme.textPrimary}`}>{group.name}</p>
            {muted && <BellOff className={`w-3 h-3 shrink-0 ${theme.textSecondary}`} />}
          </div>
          {preview && (
            <span className={`shrink-0 text-[10.5px] tabular-nums font-medium ${theme.textSecondary}`}>
              {formatRelativeShort(preview.sentAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={`text-[12px] truncate ${theme.textSecondary}`}>
            {preview ? `${preview.sender.split(' ')[0]}: ${preview.text}` : `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>
    </button>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Info modal                                                 */
/* ────────────────────────────────────────────────────────── */

type InfoAction = 'leave' | 'delete' | null;

function GroupInfoModal({
  open, group, currentUserId, currentTheme, onThemeChange,
  onClose, onLeave, onDelete, onRemoveMember, onAddMember, onViewProfile,
}: {
  open: boolean;
  group: GroupDetailDto;
  currentUserId: string | undefined;
  currentTheme: ChatThemeKey;
  onThemeChange: (k: ChatThemeKey) => void;
  onClose: () => void;
  onLeave: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onAddMember: (userId: string) => Promise<void>;
  onViewProfile: (userId: string) => void;
}) {
  const [confirmAction, setConfirmAction] = useState<InfoAction>(null);
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
      .then((data) => { if (active) setFriends(data); })
      .catch(() => { if (active) setFriends([]); })
      .finally(() => { if (active) setLoadingFriends(false); });
    return () => { active = false; };
  }, [isAddingMember, friends.length]);

  if (!open) return null;

  const reset = () => {
    setConfirmAction(null);
    setPendingRemoveId(null);
    setIsAddingMember(false);
    setFriendQuery('');
    setError(null);
    setBusy(false);
  };

  const handleClose = () => { if (busy) return; reset(); onClose(); };

  const runAddMember = async (userId: string) => {
    if (!userId) { setError('Could not resolve that friend.'); return; }
    setBusy(true); setError(null);
    try {
      await onAddMember(userId);
      setIsAddingMember(false);
      setFriendQuery('');
    } catch (err) { setError(extractErrorMessage(err, 'Failed to add member.')); }
    finally { setBusy(false); }
  };
  const runLeave = async () => {
    setBusy(true); setError(null);
    try { await onLeave(); reset(); onClose(); }
    catch (err) { setError(extractErrorMessage(err, 'Failed to leave group.')); setBusy(false); }
  };
  const runDelete = async () => {
    setBusy(true); setError(null);
    try { await onDelete(); reset(); onClose(); }
    catch (err) { setError(extractErrorMessage(err, 'Failed to delete group.')); setBusy(false); }
  };
  const runRemoveMember = async (userId: string) => {
    setBusy(true); setError(null);
    try { await onRemoveMember(userId); setPendingRemoveId(null); }
    catch (err) { setError(extractErrorMessage(err, 'Failed to remove member.')); }
    finally { setBusy(false); }
  };

  const confirmCopy: Record<NonNullable<InfoAction>, { title: string; body: string; cta: string }> = {
    leave: {
      title: 'Leave group?',
      body: `You'll be removed from ${group.name}. ${
        isCreator && group.memberCount > 1
          ? 'Ownership will transfer to another member.'
          : 'If you are the last member, the group will be deleted.'
      }`,
      cta: 'Leave',
    },
    delete: {
      title: 'Delete group?',
      body: `${group.name} and all its messages will be permanently deleted for everyone. This cannot be undone.`,
      cta: 'Delete',
    },
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 flex flex-col items-center text-center border-b border-white/[0.06] shrink-0">
          <div className="p-[3px] rounded-full bg-gradient-to-tr from-[#D97706]/50 via-[#D97706]/20 to-transparent">
            <div className="p-[3px] rounded-full bg-[#1C1A17]">
              <GroupAvatar name={group.name} groupId={group.id} src={(group as any).avatarUrl} size="lg" ring={false} />
            </div>
          </div>
          <p className="mt-4 text-[16px] font-bold text-[#EDE5D4] tracking-tight">{group.name}</p>
          <p className="text-[12px] text-[#7A6F65] mt-0.5">
            {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
          </p>
          {group.description && (
            <p className="text-[12.5px] text-[#A8A29E] mt-2 leading-relaxed max-w-xs">{group.description}</p>
          )}
        </div>

        {!confirmAction && !pendingRemoveId ? (
          <div className="overflow-y-auto flex-1">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-3.5 h-3.5 text-[#7A6F65]" />
                <span className="text-[11px] uppercase tracking-[0.16em] text-[#7A6F65] font-semibold">Chat theme</span>
              </div>
              <ThemeGrid current={currentTheme} onSelect={onThemeChange} />
            </div>

            <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#7A6F65] font-semibold">
                Members ({group.members?.length ?? 0})
              </p>
              {isCreator && (
                <button
                  onClick={() => { setIsAddingMember((v) => !v); setError(null); }}
                  className="text-[12px] text-[#D97706] hover:text-[#F59E0B] font-medium inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add member</span>
                </button>
              )}
            </div>

            {isAddingMember && (
              <div className="border-b border-white/[0.06] bg-black/20">
                <div className="p-3 flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0F0D0A] border border-white/[0.08]">
                    <Search className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
                    <input
                      type="text"
                      autoFocus
                      value={friendQuery}
                      onChange={(e) => setFriendQuery(e.target.value)}
                      placeholder="Search friends…"
                      className="flex-1 bg-transparent text-[12.5px] text-[#EDE5D4] placeholder-[#6B6259] outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setIsAddingMember(false); setFriendQuery(''); setError(null); }}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-[#EDE5D4]"
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
                  ) : (() => {
                    const memberIds = new Set((group.members ?? []).map((m) => m.id));
                    const q = friendQuery.trim().replace(/^@/, '').toLowerCase();
                    const candidates = friends.filter((f) => {
                      if (memberIds.has(f.userId)) return false;
                      if (!q) return true;
                      return f.handle.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q);
                    });
                    if (candidates.length === 0) {
                      return (
                        <div className="px-5 py-4 text-center text-[12px] text-[#6B6259]">
                          {friendQuery.trim() ? 'No matching friends.' : 'All your friends are already in this group.'}
                        </div>
                      );
                    }
                    return candidates.map((f) => (
                      <button
                        key={f.friendshipId}
                        type="button"
                        disabled={busy}
                        onClick={() => void runAddMember(f.userId)}
                        className="w-full px-5 py-2.5 flex items-center gap-3 hover:bg-white/[0.04] disabled:opacity-50 text-left"
                      >
                        <Avatar name={f.displayName} src={f.avatarUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-[#EDE5D4] truncate">{f.displayName}</p>
                          <p className="text-[11px] text-[#6B6259] truncate mt-0.5">@{f.handle}</p>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-[#D97706] shrink-0" />
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}

            <div className="divide-y divide-white/[0.04]">
              {(group.members ?? []).map((m) => {
                const isMe = m.id === currentUserId;
                return (
                  <div key={m.id} className="px-5 py-2.5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onViewProfile(m.id)}
                      className="rounded-full focus:outline-none shrink-0"
                    >
                      <Avatar name={m.displayName} src={m.avatarUrl} size="sm" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#EDE5D4] truncate">
                        {m.displayName}
                        {isMe && <span className="text-[11px] text-[#6B6259] ml-1.5">(you)</span>}
                      </p>
                      <p className="text-[11px] text-[#6B6259] truncate mt-0.5">@{m.userHandle}</p>
                    </div>
                    {isCreator && !isMe && (
                      <button
                        onClick={() => setPendingRemoveId(m.id)}
                        className="shrink-0 p-1.5 rounded-md text-[#A8A29E] hover:text-[#B91C1C] hover:bg-[#B91C1C]/[0.10]"
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
                className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#EDE5D4] hover:bg-white/[0.04] text-left"
              >
                <LogOut className="w-4 h-4 text-[#A8A29E] shrink-0" />
                <span>Leave group</span>
              </button>
              {isCreator && (
                <button
                  onClick={() => setConfirmAction('delete')}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#F87171] hover:bg-[#B91C1C]/[0.08] text-left"
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
          </div>
        ) : confirmAction ? (
          <div className="p-5">
            <h3 className="text-[14.5px] font-bold text-[#EDE5D4] mb-1.5">{confirmCopy[confirmAction].title}</h3>
            <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">{confirmCopy[confirmAction].body}</p>
            {error && (
              <p className="mt-3 text-[12px] text-[#F87171] flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>
        ) : (
          <div className="p-5">
            <h3 className="text-[14.5px] font-bold text-[#EDE5D4] mb-1.5">Remove member?</h3>
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

        <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2 shrink-0">
          {!confirmAction && !pendingRemoveId ? (
            <button onClick={handleClose} className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] font-medium text-[#EDE5D4]">
              Close
            </button>
          ) : (
            <>
              <button
                onClick={() => { setConfirmAction(null); setPendingRemoveId(null); setError(null); }}
                disabled={busy}
                className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] font-medium text-[#EDE5D4]"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (confirmAction === 'leave') void runLeave();
                  else if (confirmAction === 'delete') void runDelete();
                  else if (pendingRemoveId) void runRemoveMember(pendingRemoveId);
                }}
                disabled={busy}
                className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {busy ? 'Working…' : confirmAction ? confirmCopy[confirmAction].cta : 'Remove'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Media preview (kept from GroupPane)                        */
/* ────────────────────────────────────────────────────────── */

function MediaPreview({
  files, initialCaption, targetName, onClose, onRemove, onAddMore, onSend,
}: {
  files: File[];
  initialCaption: string;
  targetName: string;
  onClose: () => void;
  onRemove: (index: number) => void;
  onAddMore: () => void;
  onSend: (caption: string, viewOnce: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [caption, setCaption] = useState(initialCaption);
  const [viewOnce, setViewOnce] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => { u.forEach((x) => URL.revokeObjectURL(x)); };
  }, [files]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const i = Math.max(0, Math.min(index, files.length - 1));

  return (
    <div className="fixed inset-0 z-[220] bg-[#0B0B0B] flex flex-col select-none">
      <div className="h-14 px-2 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white/85 hover:bg-white/10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="text-[14px] font-semibold text-white truncate">
          {files.length > 1 ? `${i + 1} of ${files.length}` : 'Send photo'}
        </p>
        <button
          type="button"
          onClick={() => onRemove(i)}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white/85 hover:bg-white/10"
          aria-label="Remove photo"
        >
          <Trash2 className="w-[18px] h-[18px]" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-2 relative">
        {urls[i] ? (
          <img src={urls[i]} alt="" draggable={false} className="max-w-full max-h-full object-contain rounded-lg" />
        ) : (
          <Loader2 className="w-6 h-6 text-white/50 animate-spin" />
        )}
        {files.length > 1 && i > 0 && (
          <button
            type="button"
            onClick={() => setIndex(i - 1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {files.length > 1 && i < files.length - 1 && (
          <button
            type="button"
            onClick={() => setIndex(i + 1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {files.length > 1 && (
        <div className="shrink-0 px-3 py-2 flex items-center gap-2 overflow-x-auto">
          {files.map((f, idx) => (
            <button
              key={`${f.name}-${idx}`}
              type="button"
              onClick={() => setIndex(idx)}
              className={`relative shrink-0 w-12 h-12 rounded-lg overflow-hidden ${idx === i ? 'ring-2 ring-white' : 'opacity-60'}`}
            >
              {urls[idx] && <img src={urls[idx]} alt="" className="w-full h-full object-cover" draggable={false} />}
            </button>
          ))}
        </div>
      )}

      <div className="shrink-0 px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] flex items-end gap-2 bg-[#0B0B0B]">
        <button
          type="button"
          onClick={onAddMore}
          className="shrink-0 w-11 h-11 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white/85 flex items-center justify-center"
          aria-label="Add more photos"
        >
          <ImageIcon className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 flex items-end rounded-[22px] bg-white/[0.08] px-3.5 py-1.5 min-h-[44px]">
          <textarea
            value={caption}
            onChange={(e) => { setCaption(e.target.value); autoGrow(e.currentTarget, 110); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(caption, viewOnce); }
            }}
            placeholder="Add a caption…"
            rows={1}
            className="flex-1 min-w-0 resize-none bg-transparent py-2 text-[14.5px] text-white focus:outline-none leading-[1.5] max-h-[110px] placeholder:text-white/40"
          />
        </div>

        <button
          type="button"
          onClick={() => setViewOnce((v) => !v)}
          className={`shrink-0 h-11 px-3 rounded-full inline-flex items-center gap-1 text-[11px] font-bold ${
            viewOnce ? 'bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white' : 'bg-white/[0.08] text-white/70'
          }`}
          aria-pressed={viewOnce}
          title="View once"
        >
          <EyeOff className="w-4 h-4" />1×
        </button>

        <button
          type="button"
          onClick={() => onSend(caption, viewOnce)}
          className="shrink-0 w-11 h-11 rounded-full bg-[#3B82F6] hover:bg-[#2563EB] text-white flex items-center justify-center"
          aria-label="Send"
        >
          <Send className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Attach panel                                               */
/* ────────────────────────────────────────────────────────── */

function AttachPanel({
  theme, onPhoto, onCamera, onDocument, onAudio,
}: {
  theme: ChatTheme;
  onPhoto: () => void;
  onCamera: () => void;
  onDocument: () => void;
  onAudio: () => void;
}) {
  const items = [
    { key: 'photo', label: 'Gallery', icon: <ImageIcon className="w-6 h-6" />, color: 'from-[#7C3AED] to-[#A855F7]', onClick: onPhoto },
    { key: 'camera', label: 'Camera', icon: <Camera className="w-6 h-6" />, color: 'from-[#EF4444] to-[#F97316]', onClick: onCamera },
    { key: 'doc', label: 'Document', icon: <FileText className="w-6 h-6" />, color: 'from-[#2563EB] to-[#3B82F6]', onClick: onDocument },
    { key: 'audio', label: 'Audio', icon: <Music className="w-6 h-6" />, color: 'from-[#F59E0B] to-[#F97316]', onClick: onAudio },
  ];
  return (
    <div className={`${PANEL_HEIGHT} border-t ${theme.subtleBorder} overflow-y-auto p-5`}>
      <div className="grid grid-cols-4 gap-y-5 gap-x-2">
        {items.map((it) => (
          <button key={it.key} type="button" onClick={it.onClick} className="flex flex-col items-center gap-2">
            <span className={`w-14 h-14 rounded-full bg-gradient-to-br ${it.color} text-white flex items-center justify-center`}>
              {it.icon}
            </span>
            <span className={`text-[11.5px] font-medium ${theme.textSecondary}`}>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Composer                                                   */
/* ────────────────────────────────────────────────────────── */

type PanelKind = 'none' | 'emoji' | 'attach';

interface ComposerProps {
  groupId: number;
  targetName: string;
  theme: ChatTheme;
  replyTo: LocalMessage | null;
  onCancelReply: () => void;
  onSend: (payload: SendPayload) => Promise<void>;
  onSendMedia: (url: string, type: number) => Promise<void>;
}

const Composer = React.memo(function Composer({
  groupId, targetName, theme, replyTo, onCancelReply, onSend, onSendMedia,
}: ComposerProps) {
  const { onType, stop: stopTyping } = useGroupTypingEmitter(groupId);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<PanelKind>('none');
  const [previewFiles, setPreviewFiles] = useState<File[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (replyTo) textareaRef.current?.focus(); }, [replyTo]);

  const togglePanel = (kind: Exclude<PanelKind, 'none'>) => {
    if (panel === kind) { setPanel('none'); textareaRef.current?.focus(); }
    else { textareaRef.current?.blur(); setPanel(kind); }
  };

  const addImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const picked = Array.from(input.files ?? []);
    if (picked.length === 0) return;
    setFileError(null);
    const accepted = picked.filter((f) => {
      if (f.size > MAX_FILE_SIZE) {
        setFileError(`${f.name}: ${formatFileSize(f.size)} — max is ${formatFileSize(MAX_FILE_SIZE)}.`);
        return false;
      }
      return true;
    });
    if (accepted.length > 0) {
      setPreviewFiles((prev) => [...prev, ...accepted]);
      setPanel('none');
    }
    input.value = '';
  };

  const sendRawFile = async (e: React.ChangeEvent<HTMLInputElement>, type: number) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`${file.name}: ${formatFileSize(file.size)} — max is ${formatFileSize(MAX_FILE_SIZE)}.`);
      input.value = '';
      return;
    }
    setPanel('none');
    try { await onSendMedia(await readAsDataUrl(file), type); }
    catch (err) { setFileError(extractErrorMessage(err)); }
    finally { input.value = ''; }
  };

  const handleVoiceComplete = async (rec: VoiceRecording) => {
    setVoiceOpen(false);
    try { await onSendMedia(await readAsDataUrl(rec.blob), MediaType.Audio); }
    catch (err) { setFileError(extractErrorMessage(err)); }
  };

  const sendText = async () => {
    const t = text.trim();
    if (!t) return;
    stopTyping();
    setText('');
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try { await onSend({ text: t, files: [], viewOnce: false }); }
    catch (err) { setText((cur) => cur || t); setFileError(extractErrorMessage(err)); }
  };

  const sendPreview = async (caption: string, viewOnce: boolean) => {
    const files = previewFiles;
    if (files.length === 0) return;
    setPreviewFiles([]);
    setText('');
    setFileError(null);
    stopTyping();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try { await onSend({ text: caption.trim(), files, viewOnce }); }
    catch (err) { setFileError(extractErrorMessage(err)); }
  };

  const canSend = text.trim().length > 0;

  return (
    <div className="shrink-0 relative z-20">
      <div className={`border-t ${theme.subtleBorder} ${theme.composerBg}`}>
        <div className="px-2 sm:px-4 py-2.5">
          {voiceOpen ? (
            <VoiceRecorder
              onComplete={(rec) => void handleVoiceComplete(rec)}
              onCancel={() => setVoiceOpen(false)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {replyTo && (
                <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-white/[0.06] border-l-[3px] border-[#D97706]">
                  <CornerUpLeft className="w-3 h-3 text-[#D97706] shrink-0" />
                  <p className={`flex-1 min-w-0 text-[12px] truncate font-medium ${theme.textPrimary}`}>
                    {messageSnippet(replyTo)}
                  </p>
                  <button
                    type="button"
                    onClick={onCancelReply}
                    className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg}`}
                    aria-label="Cancel reply"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {fileError && (
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#F87171] px-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{fileError}</span>
                </div>
              )}

              <div className="flex items-end gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => togglePanel('emoji')}
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                    panel === 'emoji' ? `${theme.accentText} ${theme.subtleBgStrong}` : `${theme.textSecondary} ${theme.hoverBg}`
                  }`}
                  title="Emoji"
                >
                  {panel === 'emoji' ? <Keyboard className="w-[20px] h-[20px]" /> : <Smile className="w-[20px] h-[20px]" />}
                </button>

                <button
                  type="button"
                  onClick={() => togglePanel('attach')}
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                    panel === 'attach' ? `${theme.accentText} ${theme.subtleBgStrong}` : `${theme.textSecondary} ${theme.hoverBg}`
                  }`}
                  title="Attach"
                >
                  <Paperclip className="w-[19px] h-[19px]" />
                </button>

                <div className={`flex-1 min-w-0 flex items-end rounded-[22px] ${theme.subtleBgStrong} border ${theme.subtleBorder} px-3 py-1.5 min-h-[44px]`}>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      autoGrow(e.currentTarget);
                      if (e.target.value.trim().length > 0) onType();
                      else stopTyping();
                    }}
                    onFocus={() => setPanel('none')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); }
                    }}
                    placeholder={replyTo ? `Reply in ${targetName}…` : `Message ${targetName}`}
                    rows={1}
                    className={`flex-1 min-w-0 resize-none bg-transparent px-1 py-2 text-[14.5px] ${theme.textPrimary} focus:outline-none leading-[1.5] max-h-[140px] overflow-y-auto placeholder:opacity-60`}
                  />
                </div>

                {canSend ? (
                  <button
                    type="button"
                    onClick={() => void sendText()}
                    className={`shrink-0 w-10 h-10 rounded-full ${theme.accent} flex items-center justify-center`}
                    aria-label="Send"
                  >
                    <Send className="w-[18px] h-[18px]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVoiceOpen(true)}
                    className={`shrink-0 w-10 h-10 rounded-full ${theme.accent} flex items-center justify-center`}
                    aria-label="Record voice message"
                  >
                    <Mic className="w-[19px] h-[19px]" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {panel === 'emoji' && !voiceOpen && (
          <div className={`relative ${PANEL_HEIGHT} border-t ${theme.subtleBorder} overflow-hidden`}>
            <EmojiPanel
              onPickEmoji={(emoji: string) => { setText((prev) => prev + emoji); onType(); }}
              onSendGif={() => {}}
              onSendSticker={() => {}}
              onClose={() => setPanel('none')}
            />
          </div>
        )}
        {panel === 'attach' && !voiceOpen && (
          <AttachPanel
            theme={theme}
            onPhoto={() => galleryRef.current?.click()}
            onCamera={() => cameraRef.current?.click()}
            onDocument={() => documentRef.current?.click()}
            onAudio={() => audioRef.current?.click()}
          />
        )}
      </div>

      <input type="file" ref={galleryRef} onChange={addImages} accept="image/*" className="hidden" multiple />
      <input type="file" ref={cameraRef} onChange={addImages} accept="image/*" capture="environment" className="hidden" />
      <input type="file" ref={documentRef} onChange={(e) => void sendRawFile(e, MediaType.File)} className="hidden" />
      <input type="file" ref={audioRef} onChange={(e) => void sendRawFile(e, MediaType.Audio)} accept="audio/*" className="hidden" />

      {previewFiles.length > 0 && (
        <MediaPreview
          files={previewFiles}
          initialCaption={text}
          targetName={targetName}
          onClose={() => setPreviewFiles([])}
          onRemove={(idx) => setPreviewFiles((prev) => prev.filter((_, i) => i !== idx))}
          onAddMore={() => galleryRef.current?.click()}
          onSend={(caption, viewOnce) => void sendPreview(caption, viewOnce)}
        />
      )}
    </div>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Create-group modal                                         */
/* ────────────────────────────────────────────────────────── */

function CreateGroupModal({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setName(''); setDescription(''); setError(null); setBusy(false); }
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Channel name is required.'); return; }
    setBusy(true); setError(null);
    try { await onCreate(name.trim(), description.trim()); onClose(); }
    catch (err) { setError(extractErrorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[14.5px] font-bold text-[#EDE5D4]">Create channel</h3>
          <p className="text-[12px] text-[#7A6F65] mt-0.5">Start a group to chat with friends.</p>
        </div>
        <form onSubmit={submit}>
          <div className="p-5 space-y-4">
            {error && (
              <div className="p-2.5 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-[12px] text-[#F87171] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#A8A29E] font-medium mb-1.5">
                Channel name
              </label>
              <input
                type="text"
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. general-discussion"
                className="w-full px-3 py-2 rounded-lg bg-[#0F0D0A] border border-white/[0.08] text-[#EDE5D4] text-[13px] outline-none focus:border-[#D97706]/60"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#A8A29E] font-medium mb-1.5">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this channel about?"
                className="w-full px-3 py-2 rounded-lg bg-[#0F0D0A] border border-white/[0.08] text-[#EDE5D4] text-[13px] outline-none focus:border-[#D97706]/60"
              />
            </div>
          </div>
          <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] font-medium text-[#EDE5D4]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 text-[#0F0D0A] font-semibold text-[12.5px] inline-flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Create</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Main pane                                                  */
/* ────────────────────────────────────────────────────────── */

export default function GroupPane(): React.JSX.Element {
  const { groupId: groupIdParam } = useParams<{ groupId?: string }>();
  const activeGroupId = groupIdParam ? parseInt(groupIdParam, 10) : undefined;
  const navigate = useNavigate();
  const { user } = useAuth();

  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [activeGroup, setActiveGroup] = useState<GroupDetailDto | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [lastMessages, setLastMessages] = useState<Record<number, GroupMessageDto>>({});
  const [searchQuery, setSearchQuery] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [chatMenuGroup, setChatMenuGroup] = useState<GroupDto | null>(null);

  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<LocalMessage | null>(null);
  const [infoMessage, setInfoMessage] = useState<LocalMessage | null>(null);
  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<string | number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [viewerOpenIndex, setViewerOpenIndex] = useState<number | null>(null);

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => readPinned(user?.id));
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => readMuted(user?.id));

  useEffect(() => {
    setPinnedIds(readPinned(user?.id));
    setMutedIds(readMuted(user?.id));
  }, [user?.id]);

  const [chatThemeKey, setChatThemeKey] = useState<ChatThemeKey>(() => readThemeFor(user?.id, activeGroupId));
  const [reactions, setReactions] = useState<Record<string, ReactionEntry[]>>(
    () => readReactions(user?.id, activeGroupId),
  );

  useEffect(() => {
    setChatThemeKey(readThemeFor(user?.id, activeGroupId));
    setReactions(readReactions(user?.id, activeGroupId));
  }, [activeGroupId, user?.id]);

  useEffect(() => { writeThemeFor(user?.id, activeGroupId, chatThemeKey); }, [user?.id, activeGroupId, chatThemeKey]);
  useEffect(() => { writeReactions(user?.id, activeGroupId, reactions); }, [user?.id, activeGroupId, reactions]);

  const theme = CHAT_THEMES[chatThemeKey];

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const activeGroupIdRef = useRef(activeGroupId);
  const currentUserIdRef = useRef(user?.id);
  const reactionsRef = useRef(reactions);
  const replyToRef = useRef(replyTo);
  const processedIdsRef = useRef<Set<GroupMessageDto['id']>>(new Set());
  const stickRef = useRef(true);
  const anchorRef = useRef<number | null>(null);

  reactionsRef.current = reactions;
  replyToRef.current = replyTo;
  useEffect(() => { activeGroupIdRef.current = activeGroupId; }, [activeGroupId]);
  useEffect(() => { currentUserIdRef.current = user?.id; }, [user?.id]);

  /* ── Unlock sounds ───────────────────────────────────────── */

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

  /* ── Presence (so avatars can show online) ───────────────── */

  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => unsub();
  }, []);

  /* ── Data loading ────────────────────────────────────────── */

  const fetchGroups = useCallback(async () => {
    try {
      const data = await apiService.getMyGroups();
      setGroups(data);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  }, []);

  useEffect(() => { void fetchGroups(); }, [fetchGroups]);

  // Reset per-group state
  useEffect(() => {
    setMessages([]);
    setReplyTo(null);
    setHasMore(true);
    setHistoryError(null);
    setShowJumpToLatest(false);
    processedIdsRef.current = new Set();
    stickRef.current = true;
    anchorRef.current = null;
  }, [activeGroupId]);

  // Load group detail + history
  useEffect(() => {
    if (!activeGroupId || isNaN(activeGroupId)) {
      setActiveGroup(null);
      setMessages([]);
      return;
    }
    let active = true;

    const loadGroup = async () => {
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const detail = await apiService.getGroupDetail(activeGroupId);
        if (active) setActiveGroup(detail);

        await signalRService.joinGroupChannel(activeGroupId);

        const msgs = await apiService.getGroupMessages(activeGroupId, PAGE_SIZE);
        if (!active) return;
        const sorted = [...msgs].sort((a, b) => getMessageTime(a) - getMessageTime(b));
        processedIdsRef.current = new Set(sorted.map((m) => m.id));
        const decorated: LocalMessage[] = sorted.map((m) => {
          const d = decodeIncoming(m.content ?? '');
          return {
            ...m,
            content: d.isReaction ? '' : d.body,
            viewOnce: !d.isReaction && d.viewOnce,
            sticker: !d.isReaction && d.sticker,
            replyToId: d.isReaction ? null : d.replyToId,
            viewed: false,
          };
        });
        setMessages(decorated);
        setHasMore(msgs.length >= PAGE_SIZE);
        if (decorated.length > 0) {
          const latest = decorated[decorated.length - 1];
          setLastMessages((prev) => ({ ...prev, [activeGroupId]: latest }));
        }
      } catch (err) {
        if (active) setHistoryError(extractErrorMessage(err, 'Could not load messages.'));
      } finally {
        if (active) setLoadingHistory(false);
      }
    };

    void loadGroup();
    return () => { active = false; };
  }, [activeGroupId, reloadTick]);

  // Seed last messages for the sidebar
  useEffect(() => {
    if (groups.length === 0 || !user?.id) return;
    let active = true;
    const seed = async () => {
      const results = await Promise.all(
        groups.map(async (g) => {
          try {
            const msgs = await apiService.getGroupMessages(g.id, 1);
            if (msgs.length === 0) return null;
            return { id: g.id, msg: msgs[0] };
          } catch { return null; }
        }),
      );
      if (!active) return;
      setLastMessages((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (!r) continue;
          const existing = next[r.id];
          if (!existing || getMessageTime(r.msg) > getMessageTime(existing)) next[r.id] = r.msg;
        }
        return next;
      });
    };
    void seed();
    return () => { active = false; };
  }, [groups, user?.id]);

  /* ── Real-time ───────────────────────────────────────────── */

  useEffect(() => {
    const unsub = signalRService.onReceiveGroupMessage((msg: GroupMessageDto) => {
      const d = decodeIncoming(msg.content ?? '');

      if (d.isReaction) {
        const ev: ReactionEvent = {
          messageId: d.messageId,
          emoji: d.emoji,
          action: d.action,
          userId: msg.senderId,
        };
        startTransition(() => { setReactions((prev) => applyReactionEvents(prev, [ev])); });
        return;
      }

      const local: LocalMessage = {
        ...msg,
        content: d.body,
        viewOnce: d.viewOnce,
        sticker: d.sticker,
        replyToId: d.replyToId,
        viewed: false,
      };

      // Update sidebar preview
      setLastMessages((prev) => {
        const existing = prev[msg.groupId];
        if (existing && getMessageTime(existing) >= getMessageTime(local)) return prev;
        return { ...prev, [msg.groupId]: local };
      });

      if (msg.groupId !== activeGroupIdRef.current) return;

      processedIdsRef.current.add(msg.id);
      startTransition(() => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, local];
        });
      });
      if (msg.senderId !== user?.id) playReceive();
      stickRef.current = true;
    });
    return () => { unsub(); };
  }, [user?.id]);

  /* ── Scroll management ───────────────────────────────────── */

  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (anchorRef.current != null) {
      el.scrollTop += el.scrollHeight - anchorRef.current;
      anchorRef.current = null;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleLoadEarlier = async () => {
    if (!activeGroupId || loadingMore || !hasMore || messages.length === 0) return;
    const el = messagesContainerRef.current;
    if (el) anchorRef.current = el.scrollHeight;
    stickRef.current = false;
    setLoadingMore(true);
    const oldestId = messages[0].id;
    try {
      const earlier = await apiService.getGroupMessages(activeGroupId, PAGE_SIZE, oldestId);
      if (earlier.length > 0) {
        const sorted = [...earlier].sort((a, b) => getMessageTime(a) - getMessageTime(b));
        const decorated: LocalMessage[] = sorted.map((m) => {
          const d = decodeIncoming(m.content ?? '');
          return {
            ...m,
            content: d.isReaction ? '' : d.body,
            viewOnce: !d.isReaction && d.viewOnce,
            sticker: !d.isReaction && d.sticker,
            replyToId: d.isReaction ? null : d.replyToId,
            viewed: false,
          };
        });
        setMessages((prev) => [...decorated, ...prev]);
        setHasMore(earlier.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Error loading earlier group messages:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  };

  const handleJumpToLatest = () => {
    stickRef.current = true;
    scrollToBottom();
    setShowJumpToLatest(false);
  };

  const jumpToMessage = useCallback((id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setHighlightedMessageId(id);
    window.setTimeout(() => setHighlightedMessageId((cur) => (cur === id ? null : cur)), 1300);
    if (navigator.vibrate) navigator.vibrate(8);
  }, []);

  /* ── Sending ─────────────────────────────────────────────── */

  const handleSendMedia = useCallback(async (url: string, type: number) => {
    if (!activeGroupId) return;
    stickRef.current = true;
    const tempId = -Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        groupId: activeGroupId,
        senderId: user?.id ?? '',
        senderDisplayName: user?.displayName ?? 'You',
        senderAvatarUrl: user?.avatarUrl ?? null,
        content: '',
        mediaUrl: url,
        mediaType: type,
        sentAt: new Date().toISOString(),
        pending: true,
        viewOnce: false,
        viewed: false,
        replyToId: null,
      } as LocalMessage,
    ]);
    try {
      await signalRService.sendGroupMessage({
        groupId: activeGroupId,
        content: '',
        mediaUrl: url,
        mediaType: type,
      });
      playSend();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      throw err;
    }
  }, [activeGroupId, user?.id, user?.displayName, user?.avatarUrl]);

  const handleComposerSend = useCallback(async ({ text, files, viewOnce }: SendPayload) => {
    if (!activeGroupId || !user?.id) return;
    const current = replyToRef.current;
    const replyId = current && typeof current.id === 'number' && current.id > 0 ? current.id : null;
    setReplyTo(null);
    stickRef.current = true;

    const tempIds: number[] = [];
    try {
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const mediaUrl = await readAsDataUrl(file);
          const caption = i === 0 ? text : '';
          let payload = caption;
          if (i === 0 && replyId != null) payload = encodeReply(replyId, payload);
          if (viewOnce) payload = `[v1]${payload}`;

          const tempId = -Date.now() - i;
          tempIds.push(tempId);
          setMessages((prev) => [
            ...prev,
            {
              id: tempId,
              groupId: activeGroupId,
              senderId: user.id,
              senderDisplayName: user.displayName ?? 'You',
              senderAvatarUrl: user.avatarUrl ?? null,
              content: caption,
              mediaUrl,
              mediaType: MediaType.Image,
              sentAt: new Date().toISOString(),
              pending: true,
              viewOnce,
              viewed: false,
              replyToId: i === 0 ? replyId : null,
            } as LocalMessage,
          ]);

          await signalRService.sendGroupMessage({
            groupId: activeGroupId,
            content: payload,
            mediaUrl,
            mediaType: MediaType.Image,
          });
          playSend();
        }
      } else if (text.length > 0) {
        const payload = replyId != null ? encodeReply(replyId, text) : text;
        const tempId = -Date.now();
        tempIds.push(tempId);
        setMessages((prev) => [
          ...prev,
          {
            id: tempId,
            groupId: activeGroupId,
            senderId: user.id,
            senderDisplayName: user.displayName ?? 'You',
            senderAvatarUrl: user.avatarUrl ?? null,
            content: text,
            mediaUrl: undefined,
            mediaType: undefined,
            sentAt: new Date().toISOString(),
            pending: true,
            viewOnce: false,
            viewed: false,
            replyToId: replyId,
          } as LocalMessage,
        ]);

        await signalRService.sendGroupMessage({
          groupId: activeGroupId,
          content: payload,
          mediaUrl: undefined,
          mediaType: undefined,
        });
        playSend();
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !tempIds.includes(m.id as number)));
      throw err;
    }
  }, [activeGroupId, user?.id, user?.displayName, user?.avatarUrl]);

  /* ── Reactions / replies / deletion ──────────────────────── */

  const handleReact = useCallback(async (messageId: number, emoji: string) => {
    if (!activeGroupId || !user?.id) return;
    const existing = reactionsRef.current[String(messageId)] ?? [];
    const mine = existing.find((r) => r.userId === user.id && r.emoji === emoji);
    const action: 'add' | 'remove' = mine ? 'remove' : 'add';

    setReactions((prev) => applyReactionEvents(prev, [{ messageId, emoji, action, userId: user.id }]));

    try {
      await signalRService.sendGroupMessage({
        groupId: activeGroupId,
        content: encodeReaction(messageId, emoji, action),
        mediaUrl: undefined,
        mediaType: undefined,
      });
    } catch (err) { console.warn('Reaction send failed:', err); }
  }, [activeGroupId, user?.id]);

  const handleStartReply = useCallback((m: LocalMessage) => {
    if (typeof m.id === 'number' && m.id < 0) return;
    setReplyTo(m);
  }, []);
  const handleCancelReply = useCallback(() => setReplyTo(null), []);
  const handleOpenMenu = useCallback((m: LocalMessage) => { setMenuMessage(m); }, []);

  const handleDeleteForMe = useCallback(async (m: LocalMessage) => {
    startTransition(() => {
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      setReactions((prev) => {
        const next = { ...prev };
        delete next[String(m.id)];
        return next;
      });
    });
    try { await apiService.deleteGroupMessage?.(m.id); }
    catch (err) {
      setMessages((prev) => [...prev, m].sort((a, b) => getMessageTime(a) - getMessageTime(b)));
      alert(`Delete failed: ${extractErrorMessage(err)}`);
    }
  }, []);

  const handleRequestDeleteForEveryone = useCallback((m: LocalMessage) => { setPendingDeleteEveryoneId(m.id); }, []);

  const handleConfirmDeleteForEveryone = useCallback(async () => {
    if (pendingDeleteEveryoneId == null) return;
    const targetId = pendingDeleteEveryoneId;
    startTransition(() => {
      setMessages((prev) => prev.filter((x) => x.id !== targetId));
    });
    setPendingDeleteEveryoneId(null);
    try { await apiService.deleteGroupMessageForEveryone?.(targetId); }
    catch (err) { alert(`Delete for everyone failed: ${extractErrorMessage(err)}`); }
  }, [pendingDeleteEveryoneId]);

  const handleOpenImage = useCallback((m: LocalMessage, _senderName: string) => {
    const idx = chatImages.findIndex((img) => img.url === m.mediaUrl);
    if (idx >= 0) setViewerOpenIndex(idx);
  }, [chatImages]);

  /* ── Group actions ───────────────────────────────────────── */

  const handleCreateGroup = async (name: string, description: string) => {
    const created = await apiService.createGroup({ name, description: description || undefined });
    await fetchGroups();
    navigate(`/app/groups/${created.id}`);
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

  /* ── Derived data ────────────────────────────────────────── */

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = [...groups];
    const list = q ? base.filter((g) => g.name.toLowerCase().includes(q)) : base;
    list.sort((a, b) => {
      const aP = pinnedIds.has(String(a.id)) ? 1 : 0;
      const bP = pinnedIds.has(String(b.id)) ? 1 : 0;
      if (aP !== bP) return bP - aP;
      const ma = lastMessages[a.id];
      const mb = lastMessages[b.id];
      const ta = ma ? getMessageTime(ma) : 0;
      const tb = mb ? getMessageTime(mb) : 0;
      return tb - ta;
    });
    return list;
  }, [groups, searchQuery, lastMessages, pinnedIds]);

  const chatImages = useMemo(
    () =>
      messages
        .filter((m) => m.mediaType === MediaType.Image && m.mediaUrl && !m.viewOnce && !m.sticker)
        .map((m) => ({
          url: m.mediaUrl as string,
          senderName: m.senderId === user?.id ? 'You' : m.senderDisplayName ?? 'Them',
          sentAt: m.sentAt,
        })),
    [messages, user?.id],
  );

  const items = useMemo(() => {
    type Item =
      | { type: 'date'; key: string; label: string }
      | { type: 'msg'; key: string; message: LocalMessage; grouped: boolean; last: boolean };

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
      const isGrouped = m.senderId === lastSenderId && ts - lastTs < 7 * 60 * 1000;
      out.push({ type: 'msg', key: String(m.id), message: m, grouped: isGrouped, last: true });
      lastSenderId = m.senderId ?? '';
      lastTs = ts;
    }
    for (let i = 0; i < out.length; i++) {
      const it = out[i];
      if (it.type !== 'msg') continue;
      const next = out[i + 1];
      it.last = !(next && next.type === 'msg' && next.message.senderId === it.message.senderId);
    }
    return out;
  }, [messages]);

  const messagesById = useMemo(() => {
    const map = new Map<GroupMessageDto['id'], LocalMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const typingUsers = useGroupTypingReceiver(activeGroupId, user?.id);
  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0].handle || 'Someone'} is typing…`;
    if (typingUsers.length === 2) return `${typingUsers[0].handle}, ${typingUsers[1].handle} are typing…`;
    return `${typingUsers.length} people are typing…`;
  }, [typingUsers]);

  const hasActiveGroup = Boolean(activeGroupId && activeGroup);

  /* ── Sidebar helpers ─────────────────────────────────────── */

  const handleSelectGroup = useCallback((id: number) => { navigate(`/app/groups/${id}`); }, [navigate]);
  const handleGroupMenu = useCallback((g: GroupDto) => { setChatMenuGroup(g); }, []);

  const togglePin = (id: string) => {
    const next = new Set(pinnedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPinnedIds(next);
    writePinned(user?.id, next);
  };
  const toggleMute = (id: string) => {
    const next = new Set(mutedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setMutedIds(next);
    writeMuted(user?.id, next);
  };

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className={`flex h-full w-full ${theme.bg} overflow-hidden relative`}>
      {/* Sidebar */}
      <div className={`${hasActiveGroup ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] md:shrink-0 border-r ${theme.subtleBorder} ${theme.sidebarBg} flex-col h-full`}>
        <div className="h-[68px] px-5 flex items-center justify-between shrink-0">
          <div className="flex items-baseline gap-2">
            <h2 className={`text-[22px] font-bold tracking-tight ${theme.textPrimary}`}>Groups</h2>
            <span className={`text-[12px] tabular-nums font-semibold ${theme.textSecondary}`}>{groups.length}</span>
          </div>
          <button
            onClick={() => setCreateModalOpen(true)}
            className={`w-9 h-9 rounded-xl ${theme.subtleBg} border ${theme.subtleBorder} ${theme.textSecondary} ${theme.hoverBg} flex items-center justify-center`}
            title="Create group"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${theme.textSecondary}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search groups"
              className={`w-full h-11 pl-10 pr-3 rounded-2xl ${theme.subtleBg} border ${theme.subtleBorder} text-[13.5px] ${theme.textPrimary} focus:outline-none placeholder:opacity-60`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-0.5">
          {filteredGroups.length === 0 ? (
            <div className={`p-8 text-center text-[13px] font-medium ${theme.textSecondary}`}>
              {groups.length === 0 ? 'No groups yet — tap + to create one.' : 'No matches found.'}
            </div>
          ) : (
            filteredGroups.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                selected={group.id === activeGroupId}
                last={lastMessages[group.id]}
                pinned={pinnedIds.has(String(group.id))}
                muted={mutedIds.has(String(group.id))}
                theme={theme}
                onSelect={handleSelectGroup}
                onMenu={handleGroupMenu}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat pane */}
      <div className={`${hasActiveGroup ? 'flex' : 'hidden md:flex'} flex-1 flex-col h-full min-w-0 ${theme.bg} relative`}>
        {theme.ambientStyle && (
          <div className="pointer-events-none absolute inset-0" style={theme.ambientStyle} />
        )}

        {activeGroupId && activeGroup ? (
          <>
            <div className={`h-[68px] px-3 sm:px-5 border-b ${theme.subtleBorder} ${theme.composerBg} flex items-center justify-between shrink-0 gap-2 z-20 relative`}>
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => navigate('/app/groups')}
                  className={`md:hidden w-9 h-9 rounded-xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg} shrink-0`}
                >
                  <ChevronLeft className="w-[20px] h-[20px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  className="shrink-0 rounded-full"
                >
                  <GroupAvatar name={activeGroup.name} groupId={activeGroup.id} src={(activeGroup as any).avatarUrl} />
                </button>
                <div className="min-w-0">
                  <h3 className={`text-[15.5px] font-bold truncate tracking-tight ${theme.textPrimary}`}>{activeGroup.name}</h3>
                  <p className={`text-[11.5px] truncate mt-0.5 ${theme.textSecondary}`}>
                    {activeGroup.memberCount} member{activeGroup.memberCount === 1 ? '' : 's'}
                    {activeGroup.description ? ` · ${activeGroup.description}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <button onClick={() => setInfoOpen(true)} className={`w-10 h-10 rounded-2xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg}`}>
                  <Info className="w-[18px] h-[18px]" />
                </button>
              </div>
            </div>

            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-5 relative z-10"
              style={{ overscrollBehavior: 'contain' }}
            >
              {loadingHistory && messages.length === 0 ? (
                <MessageSkeleton />
              ) : historyError && messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div className="w-14 h-14 rounded-2xl bg-[#B91C1C]/[0.10] border border-[#B91C1C]/30 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-[#F87171]" />
                  </div>
                  <div>
                    <p className={`text-[14.5px] font-bold tracking-tight ${theme.textPrimary}`}>Couldn't load messages</p>
                    <p className={`text-[12.5px] mt-1 max-w-[300px] ${theme.textSecondary}`}>{historyError}</p>
                  </div>
                  <button
                    onClick={() => setReloadTick((t) => t + 1)}
                    className={`h-9 px-4 rounded-xl ${theme.accent} text-[12.5px] font-semibold`}
                  >
                    Retry
                  </button>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div className={`w-14 h-14 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} flex items-center justify-center`}>
                    <Hash className={`w-6 h-6 ${theme.textSecondary}`} />
                  </div>
                  <div>
                    <p className={`text-[15.5px] font-bold tracking-tight ${theme.textPrimary}`}>No messages yet</p>
                    <p className={`text-[13px] mt-1 ${theme.textSecondary}`}>Start the conversation in {activeGroup.name}.</p>
                  </div>
                </div>
              ) : (
                <>
                  {hasMore && (
                    <div className="flex justify-center mb-2">
                      <button
                        onClick={() => void handleLoadEarlier()}
                        disabled={loadingMore}
                        className={`h-8 px-4 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} ${theme.textSecondary} text-[11.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60`}
                      >
                        {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
                        Load earlier messages
                      </button>
                    </div>
                  )}
                  {items.map((item) => {
                    if (item.type === 'date') {
                      return (
                        <div key={item.key} className="flex justify-center my-5 select-none">
                          <span className={`px-3.5 py-1 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} text-[10.5px] uppercase tracking-[0.14em] ${theme.textSecondary} font-bold`}>
                            {item.label}
                          </span>
                        </div>
                      );
                    }
                    const m = item.message;
                    const isMe = m.senderId === user?.id;
                    const replyTarget = m.replyToId != null ? messagesById.get(m.replyToId) ?? null : null;
                    return (
                      <MessageRow
                        key={item.key}
                        message={m}
                        isMe={isMe}
                        senderName={isMe ? 'You' : m.senderDisplayName ?? 'User'}
                        senderAvatar={isMe ? user?.avatarUrl : m.senderAvatarUrl}
                        grouped={item.grouped}
                        isLastOfGroup={item.last}
                        theme={theme}
                        reactions={reactions[String(m.id)] ?? EMPTY_REACTIONS}
                        currentUserId={user?.id}
                        replyTarget={replyTarget}
                        highlighted={highlightedMessageId === m.id}
                        onRequestProfile={setProfileModalUserId}
                        onOpenImage={handleOpenImage}
                        onReact={handleReact}
                        onStartReply={handleStartReply}
                        onOpenMenu={handleOpenMenu}
                        onJumpToReply={jumpToMessage}
                        onMediaLoad={() => { if (stickRef.current) scrollToBottom(); }}
                      />
                    );
                  })}
                </>
              )}

              {typingLabel && (
                <div className="flex items-center gap-2 mt-3 px-2 select-none">
                  <span className={`text-[11.5px] italic ${theme.textSecondary}`}>{typingLabel}</span>
                </div>
              )}
            </div>

            {showJumpToLatest && (
              <button
                onClick={handleJumpToLatest}
                className={`absolute bottom-24 right-6 z-30 w-10 h-10 rounded-full ${theme.accent} shadow-xl flex items-center justify-center`}
                aria-label="Jump to latest"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            )}

            <Composer
              key={activeGroupId}
              groupId={activeGroupId}
              targetName={activeGroup.name}
              theme={theme}
              replyTo={replyTo}
              onCancelReply={handleCancelReply}
              onSend={handleComposerSend}
              onSendMedia={handleSendMedia}
            />
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 relative z-10 select-none">
            <div className={`w-16 h-16 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} flex items-center justify-center mb-6`}>
              <Hash className={`w-7 h-7 ${theme.textSecondary}`} />
            </div>
            <h3 className={`text-[18px] font-bold mb-2 tracking-tight ${theme.textPrimary}`}>Your groups</h3>
            <p className={`text-[13.5px] max-w-[320px] leading-relaxed ${theme.textSecondary}`}>
              Pick a channel from the sidebar or create a new one.
            </p>
          </div>
        )}
      </div>

      {/* Modals */}
      {menuMessage && (
        <MessageMenu
          message={menuMessage}
          isMe={menuMessage.senderId === user?.id}
          theme={theme}
          reactions={reactions[String(menuMessage.id)] ?? EMPTY_REACTIONS}
          currentUserId={user?.id}
          onClose={() => setMenuMessage(null)}
          onReact={(emoji) => { void handleReact(menuMessage.id as number, emoji); }}
          onReply={() => handleStartReply(menuMessage)}
          onCopy={() => {
            const t = menuMessage.content ?? '';
            if (t) void navigator.clipboard.writeText(t);
          }}
          onInfo={() => setInfoMessage(menuMessage)}
          onDeleteForMe={() => { void handleDeleteForMe(menuMessage); }}
          onDeleteForEveryone={() => handleRequestDeleteForEveryone(menuMessage)}
        />
      )}

      {infoMessage && (
        <MessageInfoModal
          message={infoMessage}
          isMe={infoMessage.senderId === user?.id}
          targetName={activeGroup?.name ?? 'Group'}
          onClose={() => setInfoMessage(null)}
        />
      )}

      {pendingDeleteEveryoneId != null && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPendingDeleteEveryoneId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden"
          >
            <div className="p-5">
              <h3 className="text-[14.5px] font-bold text-[#EDE5D4] mb-1.5">Delete for everyone?</h3>
              <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                This message will be removed for every member of {activeGroup?.name ?? 'the group'}. This cannot be undone.
              </p>
            </div>
            <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2">
              <button onClick={() => setPendingDeleteEveryoneId(null)} className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] font-medium text-[#EDE5D4]">
                Cancel
              </button>
              <button onClick={() => void handleConfirmDeleteForEveryone()} className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[12.5px] font-semibold">
                Delete for everyone
              </button>
            </div>
          </div>
        </div>
      )}

      {chatMenuGroup && (
        <GroupContextMenu
          group={chatMenuGroup}
          isPinned={pinnedIds.has(String(chatMenuGroup.id))}
          isMuted={mutedIds.has(String(chatMenuGroup.id))}
          onClose={() => setChatMenuGroup(null)}
          onPin={() => togglePin(String(chatMenuGroup.id))}
          onMute={() => toggleMute(String(chatMenuGroup.id))}
          onMarkRead={() => { /* groups don't track unread server-side here */ }}
          onClearChat={async () => {
            try { await apiService.clearGroupConversation?.(chatMenuGroup.id); }
            catch { /* ignore */ }
            setLastMessages((prev) => { const next = { ...prev }; delete next[chatMenuGroup.id]; return next; });
            if (chatMenuGroup.id === activeGroupId) { setMessages([]); setReactions({}); }
          }}
          onLeave={async () => {
            try { await apiService.leaveGroup(chatMenuGroup.id); await fetchGroups(); }
            catch (err) { alert(`Leave failed: ${extractErrorMessage(err)}`); }
          }}
          onDelete={async () => {
            try { await apiService.deleteGroup(chatMenuGroup.id); await fetchGroups(); }
            catch (err) { alert(`Delete failed: ${extractErrorMessage(err)}`); }
          }}
        />
      )}

      {activeGroup && (
        <GroupInfoModal
          open={infoOpen}
          group={activeGroup}
          currentUserId={user?.id}
          currentTheme={chatThemeKey}
          onThemeChange={setChatThemeKey}
          onClose={() => setInfoOpen(false)}
          onLeave={handleLeaveGroup}
          onDelete={handleDeleteGroup}
          onRemoveMember={handleRemoveMember}
          onAddMember={handleAddMember}
          onViewProfile={setProfileModalUserId}
        />
      )}

      <CreateGroupModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateGroup}
      />

      <UserProfileModal userId={profileModalUserId} onClose={() => setProfileModalUserId(null)} />

      {viewerOpenIndex != null && viewerOpenIndex >= 0 && (
        <ImageViewer images={chatImages} startIndex={viewerOpenIndex} onClose={() => setViewerOpenIndex(null)} />
      )}
    </div>
  );
}