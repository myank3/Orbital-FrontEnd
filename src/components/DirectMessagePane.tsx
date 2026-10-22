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
import { toast, Toaster } from 'sonner';
import { apiService, extractErrorMessage, applyPresignedUrls } from '../services/api';
import { signalRService } from '../services/signalr';
import { presenceStore } from '../services/presenceStore';
import { useAuth } from '../context/AuthContext'; 
import { useCall, type CallState } from '../context/CallContext';


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
import { formatFileSize, MAX_FILE_SIZE, MAX_TRANSCODE_INPUT } from '../services/upload';
import { compressVideo } from '../services/videoCompress';
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
  Keyboard,
  Mic,
  Reply,
  Copy,
  CornerUpLeft,
  Image as ImageIcon,
  Camera,
  Music,
  Maximize,
} from 'lucide-react';
import {
  EmojiPanel,
  VoiceRecorder,
  type VoiceRecording,
} from './dm/ComposerToolkit';

/* ────────────────────────────────────────────────────────── */
/* WhatsApp-style call timer pill                             */
/* ────────────────────────────────────────────────────────── */

function CallTimerPill({ callState, duration }: { callState: CallState; duration: number }) {
  if (callState !== 'connecting') return null;
  const m = Math.floor(duration / 60).toString().padStart(2, '0');
  const s = Math.floor(duration % 60).toString().padStart(2, '0');
  return (
    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#22C55E] text-white shadow-[0_8px_24px_-6px_rgba(34,197,94,0.6)]">
      <Phone className="w-3.5 h-3.5" />
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
  const Icon = type === 'video' ? Video : Phone;
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
/* Tunables                                                   */
/* ────────────────────────────────────────────────────────── */

const INITIAL_HISTORY = 200;
const HISTORY_STEP = 200;
const POLL_LIMIT = 60;
const POLL_INTERVAL_MS = 5000;
const PANEL_HEIGHT = 'h-[300px]';

/* ────────────────────────────────────────────────────────── */
/* Themes                                                     */
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
const CALL_RE = /^\[call:(audio|video):(answered|missed|declined):(\d+)\]$/;

export interface ReactionEntry {
  emoji: string;
  userId: string;
}

export interface CallLogInfo {
  kind: 'audio' | 'video';
  result: 'answered' | 'missed' | 'declined';
  duration: number;
}

export interface DecodedMessage {
  viewOnce: boolean;
  sticker: boolean;
  body: string;
  replyToId: number | null;
  isReaction: false;
  call?: CallLogInfo | null;
}

export interface DecodedReaction {
  isReaction: true;
  messageId: number;
  emoji: string;
  action: 'add' | 'remove';
}

export type Decoded = DecodedMessage | DecodedReaction;

export function decodeIncoming(text: string): Decoded {
  const callMatch = text.match(CALL_RE);
  if (callMatch) {
    return {
      viewOnce: false,
      sticker: false,
      body: '',
      replyToId: null,
      isReaction: false,
      call: {
        kind: callMatch[1] as 'audio' | 'video',
        result: callMatch[2] as 'answered' | 'missed' | 'declined',
        duration: parseInt(callMatch[3], 10) || 0,
      },
    };
  }

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

  return { viewOnce, sticker, body, replyToId, isReaction: false, call: null };
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

export function encodeSticker(url: string): string {
  return `[sticker]${url}`;
}

export function encodeCallLog(
  kind: 'audio' | 'video',
  result: 'answered' | 'missed' | 'declined',
  durationSec: number,
): string {
  return `[call:${kind}:${result}:${Math.max(0, Math.floor(durationSec))}]`;
}

/* ────────────────────────────────────────────────────────── */
/* Types & persistence                                        */
/* ────────────────────────────────────────────────────────── */

type LocalMessage = DirectMessageDto & {
  viewOnce?: boolean;
  viewed?: boolean;
  sticker?: boolean;
  replyToId?: number | null;
  call?: CallLogInfo | null;
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

/** In-chat loading state shared between Composer and the message area. */
type SendingMediaState = {
  kind: 'video' | 'image' | 'voice';
  phase: 'compressing' | 'uploading' | 'sending';
  progress: number;
  targetName: string;
} | null;

const NO_MEDIA = null as unknown as DirectMessageDto['mediaUrl'];
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

function themeKey(u?: string, p?: string) { return `orbital.chatTheme.v3.${u ?? 'anon'}.${p ?? 'none'}`; }
function v1SeenKey(u?: string) { return `orbital.v1seen.${u ?? 'anon'}`; }
function pinnedKey(u?: string) { return `orbital.pinned.${u ?? 'anon'}`; }
function mutedKey(u?: string) { return `orbital.muted.${u ?? 'anon'}`; }
function reactionsKey(u?: string, p?: string) { return `orbital.reactions.${u ?? 'anon'}.${p ?? 'none'}`; }
function hiddenDmsKey(u?: string) { return `orbital.hiddenDms.${u ?? 'anon'}`; }

function readThemeFor(u?: string, p?: string): ChatThemeKey {
  const raw = lsGet<string | null>(themeKey(u, p), null);
  if (raw && raw in CHAT_THEMES) return raw as ChatThemeKey;
  return 'obsidian';
}
function writeThemeFor(u: string | undefined, p: string | undefined, k: ChatThemeKey) { lsSet(themeKey(u, p), k); }
function readV1Seen(u?: string): Set<number> { return new Set(lsGet<number[]>(v1SeenKey(u), [])); }
function markV1Seen(u: string | undefined, id: number) {
  const s = readV1Seen(u); s.add(id); lsSet(v1SeenKey(u), Array.from(s));
}
function readPinned(u?: string): Set<string> { return new Set(lsGet<string[]>(pinnedKey(u), [])); }
function writePinned(u: string | undefined, s: Set<string>) { lsSet(pinnedKey(u), Array.from(s)); }
function readMuted(u?: string): Set<string> { return new Set(lsGet<string[]>(mutedKey(u), [])); }
function writeMuted(u: string | undefined, s: Set<string>) { lsSet(mutedKey(u), Array.from(s)); }
function readReactions(u?: string, p?: string): Record<string, ReactionEntry[]> {
  return lsGet<Record<string, ReactionEntry[]>>(reactionsKey(u, p), {});
}
function writeReactions(u: string | undefined, p: string | undefined, d: Record<string, ReactionEntry[]>) {
  lsSet(reactionsKey(u, p), d);
}
function readHiddenDms(u?: string): Set<string> { return new Set(lsGet<string[]>(hiddenDmsKey(u), [])); }
function writeHiddenDms(u: string | undefined, s: Set<string>) { lsSet(hiddenDmsKey(u), Array.from(s)); }

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

/**
 * Merge a server-echoed message into the local list.
 *
 * Phase 3: temp messages carry both `mediaKey` (from presign) and `mediaUrl`
 * (a local `blob:` URL for optimistic render). The server echo carries
 * `mediaKey` but no `mediaUrl`. Match on `mediaKey` first (authoritative),
 * and preserve the temp's local `blob:` URL if the echo lacks one.
 */
function mergeIncoming(prev: LocalMessage[], local: LocalMessage): LocalMessage[] {
  if (prev.some((m) => m.id === local.id)) return prev;
  const newText = local.plaintext ?? local.content ?? '';
  const newMedia = local.mediaUrl ?? '';
  const newKey = local.mediaKey ?? '';
  const tempIdx = prev.findIndex((m) => {
    if (typeof m.id !== 'number' || m.id >= 0) return false;
    if (m.senderId !== local.senderId) return false;
    // Match on mediaKey first (Phase 3 path).
    if (newKey && m.mediaKey === newKey) return true;
    // Fall back to legacy text + mediaUrl match (base64 / external URL / text).
    return (m.plaintext ?? m.content ?? '') === newText && (m.mediaUrl ?? '') === newMedia;
  });
  if (tempIdx >= 0) {
    const next = [...prev];
    const merged = { ...local };
    if (!merged.mediaUrl && prev[tempIdx].mediaUrl) {
      merged.mediaUrl = prev[tempIdx].mediaUrl;
    }
    next[tempIdx] = merged;
    return next;
  }
  return [...prev, local];
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
function getMessageTime(m: DirectMessageDto): number { return parseUtc(m.sentAt).getTime(); }
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

async function prepareImage(file: File): Promise<{ file?: File; error?: string }> {
  if (!file.type.startsWith('image/')) return { error: `${file.name}: only images can be sent.` };
  let out = file;
  try { out = await compressImage(file); } catch { out = file; }
  if (out.size > MAX_FILE_SIZE) {
    return {
      error: `${file.name}: still ${formatFileSize(out.size)} after compression — max is ${formatFileSize(MAX_FILE_SIZE)}.`,
    };
  }
  return { file: out };
}

function messageSnippet(m: LocalMessage): string {
  if (m.call) {
    return m.call.kind === 'video' ? '🎥 Call' : '📞 Call';
  }
  const t = m.plaintext ?? m.content;
  if (t) return t;
  if (m.mediaType === MediaType.Image) return m.sticker ? '🎨 Sticker' : m.viewOnce ? '👁 View once' : '📷 Photo';
  if (m.mediaType === MediaType.Audio) return '🎤 Voice message';
  if (m.mediaType === MediaType.Video) return '🎥 Video';
  if (m.mediaType === MediaType.File) return '📎 File';
  return 'Attachment';
}

interface LastMessagePreview { text: string; sentAt: string; isMe: boolean; }

function previewText(msg: DirectMessageDto, myId: string): LastMessagePreview {
  const isMe = msg.senderId === myId;
  const body = msg.plaintext ?? msg.content ?? '';
  const d = decodeIncoming(body);

  if (!d.isReaction && d.call) {
    return { text: '', sentAt: msg.sentAt, isMe };
  }

  const viewOnce = Boolean((msg as LocalMessage).viewOnce) || (!d.isReaction && d.viewOnce);
  let text: string;
  if (d.isReaction) text = '👍 Reacted';
  else if (msg.mediaType === MediaType.Image) text = d.sticker ? '🎨 Sticker' : viewOnce ? '👁 View once' : '📷 Photo';
  else if (msg.mediaType === MediaType.Video) text = '🎥 Video';
  else if (msg.mediaType === MediaType.Audio) text = '🎤 Voice message';
  else if (msg.mediaType === MediaType.File) text = '📎 File';
  else text = d.body;
  return { text, sentAt: msg.sentAt, isMe };
}

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
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [animate, setAnimate] = useState(true);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastTouchRef = useRef(0);
  const lastClickTimeRef = useRef(0);
  const lastTapTimeRef = useRef(0);

  const pinchRef = useRef({ initialDist: 0, initialScale: 1 });
  const panRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
  });
  const tapRef = useRef({ startTime: 0, startX: 0, startY: 0, moved: false });

  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  // Reset zoom whenever the visible image changes
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setAnimate(true);
  }, [index]);

  // Keyboard navigation — only at 1×
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (scale > 1) {
          setAnimate(true);
          setScale(1);
          setPosition({ x: 0, y: 0 });
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowLeft' && hasPrev && scale === 1) {
        setIndex((i) => i - 1);
      } else if (e.key === 'ArrowRight' && hasNext && scale === 1) {
        setIndex((i) => i + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hasPrev, hasNext, scale]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const resetZoom = useCallback(() => {
    setAnimate(true);
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const toggleZoomAt = useCallback((clientX: number, clientY: number) => {
    if (scale > 1) {
      resetZoom();
      return;
    }
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const ns = 2.5;
    setAnimate(true);
    setScale(ns);
    setPosition({ x: dx * (1 - ns), y: dy * (1 - ns) });
  }, [scale, resetZoom]);

  const clampPosition = useCallback((x: number, y: number, s: number) => {
    const img = imgRef.current;
    if (!img || s <= 1) return { x: 0, y: 0 };
    const maxX = (img.offsetWidth * (s - 1)) / 2;
    const maxY = (img.offsetHeight * (s - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  /* ── Touch handlers ─────────────────────────────────── */

  const onTouchStart = (e: React.TouchEvent) => {
    lastTouchRef.current = Date.now();
    setAnimate(false);

    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      pinchRef.current = {
        initialDist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
        initialScale: scale,
      };
      tapRef.current.moved = true;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      tapRef.current = {
        startTime: Date.now(),
        startX: t.clientX,
        startY: t.clientY,
        moved: false,
      };
      panRef.current = {
        active: scale > 1,
        startX: t.clientX,
        startY: t.clientY,
        startPosX: position.x,
        startPosY: position.y,
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    lastTouchRef.current = Date.now();

    if (e.touches.length === 2 && pinchRef.current.initialDist > 0) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const raw = (dist / pinchRef.current.initialDist) * pinchRef.current.initialScale;
      const ns = Math.max(1, Math.min(4, raw));
      setScale(ns);
      if (ns === 1) {
        setPosition({ x: 0, y: 0 });
      } else {
        setPosition((p) => clampPosition(p.x, p.y, ns));
      }
      tapRef.current.moved = true;
    } else if (e.touches.length === 1 && panRef.current.active) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - panRef.current.startX;
      const dy = t.clientY - panRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) tapRef.current.moved = true;
      const next = clampPosition(
        panRef.current.startPosX + dx,
        panRef.current.startPosY + dy,
        scale,
      );
      setPosition(next);
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (
        Math.abs(t.clientX - tapRef.current.startX) > 10 ||
        Math.abs(t.clientY - tapRef.current.startY) > 10
      ) {
        tapRef.current.moved = true;
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    lastTouchRef.current = Date.now();
    const duration = Date.now() - tapRef.current.startTime;
    const wasTap = !tapRef.current.moved && duration < 250;

    if (wasTap && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        // Double tap → toggle zoom
        toggleZoomAt(t.clientX, t.clientY);
        lastTapTimeRef.current = 0;
      } else {
        lastTapTimeRef.current = now;
        const scaleAtTap = scale;
        window.setTimeout(() => {
          if (lastTapTimeRef.current === now) {
            lastTapTimeRef.current = 0;
            if (scaleAtTap === 1) onClose();
          }
        }, 300);
      }
    }

    if (e.touches.length === 0) {
      setAnimate(true);
      pinchRef.current.initialDist = 0;
      panRef.current.active = false;
      if (scale <= 1) {
        resetZoom();
      } else {
        setPosition((p) => clampPosition(p.x, p.y, scale));
      }
    }
  };

  /* ── Desktop handlers ────────────────────────────────── */

  const onDoubleClick = (e: React.MouseEvent) => {
    if (Date.now() - lastTouchRef.current < 500) return;
    e.stopPropagation();
    toggleZoomAt(e.clientX, e.clientY);
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    // Suppress synthetic click that browsers emit right after touch
    if (Date.now() - lastTouchRef.current < 500) return;

    const target = e.target as HTMLElement;

    if (target.tagName === 'IMG') {
      if (scale > 1) return; // tap on zoomed image does nothing
      const now = Date.now();
      if (now - lastClickTimeRef.current < 300) {
        // Second click → onDoubleClick will handle it
        lastClickTimeRef.current = 0;
        return;
      }
      lastClickTimeRef.current = now;
      window.setTimeout(() => {
        if (lastClickTimeRef.current === now) {
          lastClickTimeRef.current = 0;
          if (scale === 1) onClose();
        }
      }, 300);
      return;
    }

    // Backdrop or header whitespace click → close at 1×
    if (scale === 1) {
      lastClickTimeRef.current = 0;
      onClose();
    }
  };

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black flex items-center justify-center select-none overflow-hidden"
      onClick={handleContainerClick}
    >
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3.5 bg-gradient-to-b from-black/90 to-transparent z-10"
        onClick={(e) => e.stopPropagation()}
      >
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
  <Eye className="w-[18px] h-[18px]" />
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

      {hasPrev && scale === 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => Math.max(0, i - 1)); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/[0.1] hover:bg-white/[0.18] text-white flex items-center justify-center z-10"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {hasNext && scale === 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => Math.min(images.length - 1, i + 1)); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/[0.1] hover:bg-white/[0.18] text-white flex items-center justify-center z-10"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      <div
        className="w-full h-full flex items-center justify-center"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{ touchAction: 'none' }}
      >
        <img
          ref={imgRef}
          key={index}
          src={current.url}
          alt=""
          onDoubleClick={onDoubleClick}
          draggable={false}
          className="max-w-[95vw] max-h-[88vh] object-contain select-none rounded-xl"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: animate ? 'transform 200ms ease-out' : 'none',
            willChange: 'transform',
          }}
        />
      </div>
    </div>
  );
}
function ViewOnceViewerModal({
  url, senderName, sentAt, onClose,
}: { url: string; senderName: string; sentAt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); onClose();
      }
    };
    const onVis = () => { if (document.hidden) onClose(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[210] bg-black flex flex-col items-center justify-center select-none"
      style={{ WebkitTouchCallout: 'none' } as React.CSSProperties}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3.5 bg-gradient-to-b from-black/90 to-transparent z-10">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white text-[10px] font-bold tracking-wide">
            <Eye className="w-3 h-3" /> VIEW ONCE
          </span>
          <p className="text-[12px] text-white/60 tabular-nums mt-1.5">
            {senderName} · {formatTime(sentAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>

      <img
        src={url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[80vh] object-contain select-none rounded-xl pointer-events-none"
        draggable={false}
      />
      <p className="absolute bottom-8 text-[12.5px] font-medium text-white/60 pointer-events-none">
        Tap anywhere to close · Disappears once dismissed
      </p>
    </div>
  );
}

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

function messageTypeLabel(m: LocalMessage): string {
  if (m.call) return m.call.kind === 'video' ? 'Video call' : 'Audio call';
  if (m.sticker) return 'Sticker';
  if (m.mediaType === MediaType.Image) return m.viewOnce ? 'View-once photo' : 'Photo';
  if (m.mediaType === MediaType.Audio) return 'Voice message';
  if (m.mediaType === MediaType.Video) return 'Video';
  if (m.mediaType === MediaType.File) return 'File';
  return 'Text';
}

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
  const text = message.plaintext ?? message.content ?? '';
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
}: {
  message: LocalMessage;
  isMe: boolean;
  targetName: string;
  onClose: () => void;
}) {
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
  const status = !isMe ? 'Received' : isTemp ? 'Sending…' : message.isRead ? 'Read' : 'Sent';

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
                {k === 'Status' && status === 'Read' && <CheckCheck className="w-4 h-4 text-[#4ADE80]" />}
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
  const senderLabel = replyTo.senderId === currentUserId ? 'You' : 'Reply';
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

function ChatContextMenu({
  friend, isPinned, isMuted, onClose, onPin, onMute, onMarkRead, onDeleteFromHere, onBlock, onUnfriend,
}: {
  friend: FriendDto; isPinned: boolean; isMuted: boolean;
  onClose: () => void; onPin: () => void; onMute: () => void; onMarkRead: () => void;
  onDeleteFromHere: () => void; onBlock: () => void; onUnfriend: () => void;
}) {
  const actions = [
    { key: 'pin', label: isPinned ? 'Unpin chat' : 'Pin chat', icon: isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />, onClick: onPin, danger: false },
    // { key: 'mute', label: isMuted ? 'Unmute notifications' : 'Mute notifications', icon: isMuted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />, onClick: onMute, danger: false },
    { key: 'read', label: 'Mark as read', icon: <CheckCheck className="w-4 h-4" />, onClick: onMarkRead, danger: false },
    { key: 'deleteFromHere', label: 'Delete from here', icon: <Trash2 className="w-4 h-4" />, onClick: onDeleteFromHere, danger: false },
    { key: 'block', label: `Block @${friend.handle}`, icon: <ShieldOff className="w-4 h-4" />, onClick: onBlock, danger: true },
    { key: 'unfriend', label: `Unfriend @${friend.handle}`, icon: <UserMinus className="w-4 h-4" />, onClick: onUnfriend, danger: true },
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
          <Avatar name={friend.displayName} src={friend.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#EDE5D4] truncate tracking-tight">{friend.displayName}</p>
            <p className="text-[11.5px] text-[#7A6F65] truncate mt-0.5">@{friend.handle}</p>
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
/* Custom video player — Telegram/iMessage style              */
/* ────────────────────────────────────────────────────────── */

function VideoBubble({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setProgress(v.currentTime);
    const onMeta = () => { if (isFinite(v.duration) && v.duration > 0) setDuration(v.duration); };
    const onEnd = () => { setPlaying(false); setShowControls(true); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('ended', onEnd);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('ended', onEnd);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === videoRef.current);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play().catch(() => {}); }
    else { v.pause(); }
  }, []);

  const revealControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (playing) {
      hideTimerRef.current = window.setTimeout(() => setShowControls(false), 2400);
    }
  }, [playing]);

  useEffect(() => {
    if (!playing) {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      setShowControls(true);
      return;
    }
    revealControls();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [playing, revealControls]);

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * duration;
    setProgress(pct * duration);
    revealControls();
  };

  const onFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      const p = v.requestFullscreen?.();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // @ts-expect-error non-standard
          v.webkitEnterFullscreen?.();
        });
      }
    }
  };

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  const showBigPlay = !playing && progress < 0.05;

  return (
    <div
      ref={containerRef}
      className={`relative bg-black ${
        isFullscreen
          ? 'rounded-none border-0 overflow-visible max-w-none w-full h-full'
          : 'rounded-[20px] overflow-hidden border border-white/[0.04] max-w-full'
      }`}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onTouchStart={revealControls}
    >
      <video
        ref={videoRef}
        src={url}
        preload="metadata"
        playsInline
        className={`block w-auto max-w-full ${
          isFullscreen ? 'max-h-none h-full w-full' : 'max-h-[380px]'
        }`}
        onClick={togglePlay}
      />

      {showBigPlay && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          className="absolute inset-0 flex items-center justify-center bg-black/15"
          aria-label="Play video"
        >
          <span className="w-14 h-14 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-white border border-white/15 shadow-lg">
            <span className="w-0 h-0 border-y-[10px] border-y-transparent border-l-[15px] border-l-white ml-1" />
          </span>
        </button>
      )}

          <div
        className={`absolute top-2 right-2 flex items-center gap-1.5 transition-opacity duration-150 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={onFullscreen}
          className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/80 transition-colors"
          aria-label="Fullscreen"
        >
          <Maximize className="w-3.5 h-3.5" />
        </button>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/85 via-black/40 to-transparent transition-opacity duration-150 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="shrink-0 w-7 h-7 rounded-full text-white flex items-center justify-center hover:bg-white/10"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <span className="flex gap-[3px]">
                <span className="w-[3px] h-3.5 rounded-sm bg-current" />
                <span className="w-[3px] h-3.5 rounded-sm bg-current" />
              </span>
            ) : (
              <span className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-white ml-0.5" />
            )}
          </button>

          <span className="text-[10.5px] font-medium text-white/90 tabular-nums shrink-0">
            {formatDuration(progress)} / {duration > 0 ? formatDuration(duration) : '--:--'}
          </span>

          <div
            onClick={onSeek}
            className="flex-1 h-1 rounded-full bg-white/25 cursor-pointer relative"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
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
    const hasMedia = Boolean(message.mediaUrl) || (isViewOnce && Boolean(message.viewed));
    const displayText = message.plaintext ?? message.content ?? '';
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

    if (message.call) return null;

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

                {message.mediaType === MediaType.Image && isViewOnce && isMe && (
                  <div className={`inline-flex items-center gap-3 px-4 py-3.5 rounded-[22px] text-[13px] ${theme.subtleBg} border ${theme.subtleBorder}`}>
                    <span className="w-9 h-9 rounded-full bg-gradient-to-br from-[#7C3AED] to-[#A855F7] flex items-center justify-center shrink-0">
                      <Eye className="w-4 h-4 text-white" />
                    </span>
                    <span className="text-left">
                      <span className={`block font-semibold text-[13px] ${theme.textPrimary}`}>View-once photo sent</span>
                      <span className={`block opacity-75 text-[11px] ${theme.textSecondary}`}>Only visible to recipient</span>
                    </span>
                  </div>
                )}

                {message.mediaType === MediaType.Image && isViewOnce && !isMe && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (!message.viewed) onOpenImage(message, senderName); }}
                    disabled={message.viewed}
                    className={`inline-flex items-center gap-3 px-4 py-3.5 rounded-[22px] text-[13px] ${
                      message.viewed
                        ? `${theme.subtleBg} border ${theme.subtleBorder} opacity-60 cursor-default`
                        : 'bg-gradient-to-br from-[#7C3AED]/[0.18] to-[#A855F7]/[0.18] border border-[#A855F7]/40'
                    }`}
                  >
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      message.viewed ? theme.subtleBgStrong : 'bg-gradient-to-br from-[#7C3AED] to-[#A855F7] text-white'
                    }`}>
                      {message.viewed ? <EyeOff className="w-4 h-4 opacity-60" /> : <Eye className="w-4 h-4" />}
                    </span>
                    <span className="text-left">
                      <span className={`block font-semibold text-[13px] ${theme.textPrimary}`}>
                        {message.viewed ? 'Opened' : 'View once'}
                      </span>
                      {!message.viewed && (
                        <span className={`block opacity-80 text-[11px] font-medium ${theme.textSecondary}`}>Tap to reveal</span>
                      )}
                    </span>
                  </button>
                )}

                {message.mediaType === MediaType.Video && message.mediaUrl && (
                  <VideoBubble url={message.mediaUrl} />
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
                ) : message.isRead ? (
                  <CheckCheck className="w-3.5 h-3.5 text-[#4ADE80]" />
                ) : (
                  <Check className={`w-3.5 h-3.5 ${theme.textSecondary}`} />
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
    prev.message.isRead === next.message.isRead &&
    prev.message.viewed === next.message.viewed &&
    prev.message.content === next.message.content &&
    prev.message.plaintext === next.message.plaintext &&
    prev.message.mediaUrl === next.message.mediaUrl &&
    prev.message.call === next.message.call &&
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

interface FriendRowProps {
  friend: FriendDto;
  selected: boolean;
  online: boolean;
  unread: number;
  last: DirectMessageDto | undefined;
  myId: string | undefined;
  pinned: boolean;
  muted: boolean;
  theme: ChatTheme;
  onSelect: (userId: string) => void;
  onMenu: (friend: FriendDto) => void;
}

const FriendRow = React.memo(function FriendRow({
  friend, selected, online, unread, last, myId, pinned, muted, theme, onSelect, onMenu,
}: FriendRowProps) {
  const timer = useRef<number | null>(null);
  const preview = last && myId ? previewText(last, myId) : null;

  const start = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onMenu(friend), 500);
  };
  const end = () => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
  };

  return (
    <button
      onClick={() => onSelect(friend.userId)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(friend); }}
      onTouchStart={start}
      onTouchEnd={end}
      onTouchMove={end}
      onTouchCancel={end}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left ${
        selected ? theme.sidebarActive : theme.hoverBg
      }`}
    >
      <Avatar name={friend.displayName} src={friend.avatarUrl} size="md" isOnline={online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {pinned && <Pin className={`w-3.5 h-3.5 shrink-0 ${theme.accentText}`} />}
            <p className={`text-[14px] font-bold truncate tracking-tight ${theme.textPrimary}`}>{friend.displayName}</p>
            {muted && <BellOff className={`w-3 h-3 shrink-0 ${theme.textSecondary}`} />}
          </div>
          {preview && preview.text && (
            <span className={`shrink-0 text-[10.5px] tabular-nums font-medium ${theme.textSecondary}`}>
              {formatRelativeShort(preview.sentAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={`text-[12px] truncate ${unread > 0 ? `${theme.textPrimary} font-semibold` : theme.textSecondary}`}>
            {preview && preview.text
              ? `${preview.isMe ? 'You: ' : ''}${preview.text}`
              : `@${friend.handle}`}
          </p>
          {unread > 0 && (
            <span className={`shrink-0 min-w-[20px] h-5 px-1.5 rounded-full ${theme.accent} text-[10.5px] font-bold tabular-nums flex items-center justify-center`}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

/* ────────────────────────────────────────────────────────── */
/* InfoModal                                                  */
/* ────────────────────────────────────────────────────────── */

type InfoAction = 'unfriend' | 'clear' | null;

function InfoModal({
  open, targetUser, isFriend, currentTheme, onThemeChange, onClose, onUnfriend, onClear,
}: {
  open: boolean; targetUser: UserProfileDto; isFriend: boolean;
  currentTheme: ChatThemeKey; onThemeChange: (k: ChatThemeKey) => void;
  onClose: () => void; onUnfriend: () => Promise<void>; onClear: () => Promise<void>;
}) {
  const [confirmAction, setConfirmAction] = useState<InfoAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => { setConfirmAction(null); setError(null); setBusy(false); };
  const handleClose = () => { if (busy) return; reset(); onClose(); };

  const runAction = async (action: InfoAction) => {
    if (!action) return;
    setBusy(true); setError(null);
    try {
      if (action === 'unfriend') await onUnfriend();
      if (action === 'clear') await onClear();
      reset(); onClose();
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
              <Avatar
                name={targetUser.displayName}
                src={targetUser.avatarUrl}
                size="xl"
                isOnline={presenceStore.isOnline(targetUser.id)}
              />
            </div>
          </div>
          <p className="mt-4 text-[16px] font-bold text-[#EDE5D4] tracking-tight">{targetUser.displayName}</p>
          <p className="text-[12px] text-[#7A6F65] mt-0.5">@{targetUser.userHandle}</p>
        </div>

        {!confirmAction ? (
          <div className="overflow-y-auto flex-1">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-3.5 h-3.5 text-[#7A6F65]" />
                <span className="text-[11px] uppercase tracking-[0.16em] text-[#7A6F65] font-semibold">Chat theme</span>
              </div>
              <ThemeGrid current={currentTheme} onSelect={onThemeChange} />
            </div>
            <div className="divide-y divide-white/[0.04]">
              {isFriend && (
                <button onClick={() => setConfirmAction('unfriend')} className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] font-medium text-[#EDE5D4] hover:bg-white/[0.04] text-left">
                  <UserMinus className="w-4 h-4 text-[#A8A29E] shrink-0" />
                  <span>Unfriend</span>
                </button>
              )}
              <button onClick={() => setConfirmAction('clear')} className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] font-medium text-[#EDE5D4] hover:bg-white/[0.04] text-left">
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
            <h3 className="text-[14.5px] font-bold text-[#EDE5D4] mb-1.5">{confirmCopy[confirmAction].title}</h3>
            <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">{confirmCopy[confirmAction].body}</p>
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
            <button onClick={handleClose} className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] font-medium text-[#EDE5D4]">
              Close
            </button>
          ) : (
            <>
              <button onClick={() => { setConfirmAction(null); setError(null); }} disabled={busy} className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] font-medium text-[#EDE5D4]">
                Back
              </button>
              <button onClick={() => void runAction(confirmAction)} disabled={busy} className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{busy ? 'Working…' : confirmCopy[confirmAction].cta}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* SendingPill — compact, non-blocking send progress pill     */
/* ────────────────────────────────────────────────────────── */

function SendingPill({
  sending,
  theme,
}: {
  sending: NonNullable<SendingMediaState>;
  theme: ChatTheme;
}) {
  const label =
    sending.phase === 'compressing'
      ? `Compressing ${sending.kind}… ${sending.progress}%`
      : sending.phase === 'uploading'
      ? `Sending ${sending.kind}…`
      : 'Sending…';

  return (
    <div
      className={`pointer-events-none inline-flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-full ${theme.composerBg} border ${theme.subtleBorder} shadow-[0_8px_24px_-6px_rgba(0,0,0,0.5)] backdrop-blur-md`}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex w-4 h-4 shrink-0">
        <span className={`absolute inline-flex h-full w-full rounded-full ${theme.accent} opacity-40 animate-ping`} />
        <span className={`relative inline-flex w-4 h-4 rounded-full ${theme.accent} items-center justify-center`}>
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        </span>
      </span>

      <span className={`text-[12px] font-semibold ${theme.textPrimary} whitespace-nowrap`}>
        {label}
      </span>

      <span className={`text-[11px] ${theme.textSecondary} whitespace-nowrap`}>
        to <span className={`font-semibold ${theme.textPrimary}`}>{sending.targetName}</span>
      </span>

      <span className={`w-[60px] h-1 rounded-full ${theme.subtleBgStrong} overflow-hidden shrink-0`}>
        {sending.phase === 'compressing' ? (
          <span
            className={`block h-full ${theme.accent} transition-[width] duration-200`}
            style={{ width: `${sending.progress}%` }}
          />
        ) : (
          <span className={`block h-full w-1/3 ${theme.accent} rounded-full animate-pulse`} />
        )}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* MediaPreview                                               */
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
  const send = () => onSend(caption, viewOnce);

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
          <img
            src={urls[i]}
            alt=""
            draggable={false}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
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
              className={`relative shrink-0 w-12 h-12 rounded-lg overflow-hidden ${
                idx === i ? 'ring-2 ring-white' : 'opacity-60'
              }`}
            >
              {urls[idx] && <img src={urls[idx]} alt="" className="w-full h-full object-cover" draggable={false} />}
            </button>
          ))}
        </div>
      )}

      {viewOnce && (
        <div className="shrink-0 px-4 pb-1.5 flex items-center gap-1.5 text-[11.5px] text-[#C084FC] font-medium">
          <Eye className="w-3.5 h-3.5" />
          <span>{targetName} can open this once, then it disappears.</span>
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
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
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
            viewOnce
              ? 'bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white'
              : 'bg-white/[0.08] text-white/70'
          }`}
          aria-pressed={viewOnce}
          title="View once"
        >
          <Eye className="w-4 h-4" />1×
        </button>

        <button
          type="button"
          onClick={send}
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
/* Attachment panel — 3 + 2 layout                            */
/* ────────────────────────────────────────────────────────── */

type AttachItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  onClick: () => void;
};

function AttachPanel({
  theme, onPhoto, onCamera, onVideo, onDocument, onAudio,
}: {
  theme: ChatTheme;
  onPhoto: () => void;
  onCamera: () => void;
  onVideo: () => void;
  onDocument: () => void;
  onAudio: () => void;
}) {
  const items: AttachItem[] = [
    { key: 'photo', label: 'Gallery', icon: <ImageIcon className="w-6 h-6" />, color: 'from-[#7C3AED] to-[#A855F7]', onClick: onPhoto },
    { key: 'camera', label: 'Camera', icon: <Camera className="w-6 h-6" />, color: 'from-[#EF4444] to-[#F97316]', onClick: onCamera },
    { key: 'video', label: 'Video', icon: <Video className="w-6 h-6" />, color: 'from-[#EC4899] to-[#F43F5E]', onClick: onVideo },
    { key: 'doc', label: 'Document', icon: <FileText className="w-6 h-6" />, color: 'from-[#2563EB] to-[#3B82F6]', onClick: onDocument },
    { key: 'audio', label: 'Audio', icon: <Music className="w-6 h-6" />, color: 'from-[#F59E0B] to-[#F97316]', onClick: onAudio },
  ];

  const renderItem = (it: AttachItem) => (
    <button
      key={it.key}
      type="button"
      onClick={it.onClick}
      className="flex flex-col items-center gap-2 py-2 px-2 rounded-2xl hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors"
    >
      <span className={`w-14 h-14 rounded-full bg-gradient-to-br ${it.color} text-white flex items-center justify-center shadow-[0_4px_14px_-4px_rgba(0,0,0,0.5)]`}>
        {it.icon}
      </span>
      <span className={`text-[11.5px] font-medium ${theme.textSecondary}`}>{it.label}</span>
    </button>
  );

  return (
    <div className={`${PANEL_HEIGHT} border-t ${theme.subtleBorder} overflow-y-auto flex flex-col justify-center`}>
      <div className="flex flex-col gap-4 px-4 py-5">
        <div className="flex justify-center gap-4 sm:gap-6">
          {items.slice(0, 3).map(renderItem)}
        </div>
        <div className="flex justify-center gap-4 sm:gap-6">
          {items.slice(3).map(renderItem)}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Composer                                                   */
/* ────────────────────────────────────────────────────────── */

type PanelKind = 'none' | 'emoji' | 'attach';

interface ComposerProps {
  userId: string;
  targetName: string;
  theme: ChatTheme;
  replyTo: LocalMessage | null;
  onCancelReply: () => void;
  onSend: (payload: SendPayload) => Promise<void>;
  onSendMedia: (file: File | Blob, type: number) => Promise<void>;
  onSendGif: (url: string) => void;
  onSendSticker: (url: string) => void;
  /** Report in-chat loading state while a media send is in flight. */
  onSendingStateChange: (state: SendingMediaState) => void;
}

const Composer = React.memo(function Composer({
  userId, targetName, theme, replyTo, onCancelReply, onSend, onSendMedia, onSendGif, onSendSticker,
  onSendingStateChange,
}: ComposerProps) {
  const { onType, stop: stopTyping } = useDmTypingEmitter(userId);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<PanelKind>('none');
  const [previewFiles, setPreviewFiles] = useState<File[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [compressProgress, setCompressProgress] = useState<number | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const togglePanel = (kind: Exclude<PanelKind, 'none'>) => {
    if (panel === kind) {
      setPanel('none');
      textareaRef.current?.focus();
    } else {
      textareaRef.current?.blur();
      setPanel(kind);
    }
  };

  const addImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const picked = Array.from(input.files ?? []);
    if (picked.length === 0) return;
    setFileError(null);
    const results = await Promise.all(picked.map(prepareImage));
    const accepted = results.filter((r) => r.file).map((r) => r.file as File);
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) setFileError(firstError);
    if (accepted.length > 0) {
      setPreviewFiles((prev) => [...prev, ...accepted]);
      setPanel('none');
    }
    input.value = '';
  };

  const sendRawFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: number,
  ) => {
    const input = e.target;
    let file = input.files?.[0];
    if (!file) return;
    setFileError(null);

    // Auto-detect from MIME so a video picked via Document still
    // renders as a <video> player instead of a download link.
    let resolvedType = type;
    if (file.type.startsWith('video/')) resolvedType = MediaType.Video;
    else if (file.type.startsWith('image/')) resolvedType = MediaType.Image;
    else if (file.type.startsWith('audio/')) resolvedType = MediaType.Audio;

    // ── Video: re-encode if over the size cap ────────────────
    if (resolvedType === MediaType.Video && file.size > MAX_FILE_SIZE) {
      if (file.size > MAX_TRANSCODE_INPUT) {
        setFileError(
          `${file.name}: ${formatFileSize(file.size)} is too large to compress in-browser (limit ${formatFileSize(MAX_TRANSCODE_INPUT)}).`,
        );
        input.value = '';
        return;
      }
      setCompressProgress(0);
      onSendingStateChange({ kind: 'video', phase: 'compressing', progress: 0, targetName });
      try {
        file = await compressVideo(file, {
          maxBytes: MAX_FILE_SIZE,
          maxWidth: 1280,
          onProgress: (pct) => {
            setCompressProgress(pct);
            onSendingStateChange({ kind: 'video', phase: 'compressing', progress: pct, targetName });
          },
        });
      } finally {
        setCompressProgress(null);
      }
      if (file.size > MAX_FILE_SIZE) {
        onSendingStateChange(null);
        setFileError(
          `Couldn't shrink ${file.name} below ${formatFileSize(MAX_FILE_SIZE)} — try a shorter clip.`,
        );
        input.value = '';
        return;
      }
    }

    // ── Generic size check (post-compression) ────────────────
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`${file.name}: ${formatFileSize(file.size)} — max is ${formatFileSize(MAX_FILE_SIZE)}.`);
      input.value = '';
      return;
    }

    setPanel('none');

    const kind: 'video' | 'image' | 'voice' =
      resolvedType === MediaType.Video ? 'video'
      : resolvedType === MediaType.Audio ? 'voice'
      : 'image';

    // Images don't need the full-screen sending overlay — their optimistic
    // bubble already appears in the chat with a spinner. Only videos and
    // voice messages benefit from the dedicated "Sending…" screen.
    const showOverlay = kind !== 'image';

    if (showOverlay) {
      onSendingStateChange({ kind, phase: 'uploading', progress: 0, targetName });
    }

    try {
      await onSendMedia(file, resolvedType);
    } catch (err) {
      setFileError(extractErrorMessage(err));
    } finally {
      if (showOverlay) onSendingStateChange(null);
      input.value = '';
    }
  };

  const handleVoiceComplete = async (rec: VoiceRecording) => {
    setVoiceOpen(false);
    onSendingStateChange({ kind: 'voice', phase: 'uploading', progress: 0, targetName });
    try {
      // Strip ;codecs=... so the MIME matches the backend allowlist
      // and the R2 PUT signature.
      const raw = rec.blob.type || 'audio/webm';
      const baseType = raw.split(';')[0].trim() || 'audio/webm';
      const ext = baseType.includes('mp4') ? 'm4a'
                : baseType.includes('ogg') ? 'ogg'
                : 'webm';
      const file = new File(
        [rec.blob],
        `voice-${Date.now()}.${ext}`,
        { type: baseType },
      );
      await onSendMedia(file, MediaType.Audio);
    } catch (err) {
      setFileError(extractErrorMessage(err));
    } finally {
      onSendingStateChange(null);
    }
  };

  const sendText = async () => {
    const t = text.trim();
    if (!t) return;
    stopTyping();
    setText('');
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      await onSend({ text: t, files: [], viewOnce: false });
    } catch (err) {
      setText((cur) => cur || t);
      setFileError(extractErrorMessage(err));
    }
  };

  const sendPreview = async (caption: string, viewOnce: boolean) => {
    const files = previewFiles;
    if (files.length === 0) return;
    const trimmed = caption.trim();

    // Snapshot the files, then close the modal IMMEDIATELY so the user
    // sees the optimistic bubble in the chat while the upload runs.
    // If the upload fails, the error surfaces in the composer instead
    // of trapping the user inside the preview modal.
    setPreviewFiles([]);
    setText('');
    setFileError(null);
    stopTyping();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      await onSend({ text: trimmed, files, viewOnce });
    } catch (err) {
      setFileError(extractErrorMessage(err));
    }
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
              {compressProgress !== null && (
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#F59E0B] px-1">
                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                  <span>Compressing video… {compressProgress}%</span>
                </div>
              )}

              <div className="flex items-end gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => togglePanel('emoji')}
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                    panel === 'emoji' ? `${theme.accentText} ${theme.subtleBgStrong}` : `${theme.textSecondary} ${theme.hoverBg}`
                  }`}
                  title="Emoji, GIFs & stickers"
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
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendText();
                      }
                    }}
                    placeholder={replyTo ? `Reply to ${targetName}…` : `Message ${targetName}`}
                    rows={1}
                    className={`flex-1 min-w-0 resize-none bg-transparent px-1 py-2 text-[14.5px] ${theme.textPrimary} focus:outline-none leading-[1.5] max-h-[140px] overflow-y-auto placeholder:opacity-60`}
                  />
                </div>

                {canSend ? (
                  <button
                    key="send-btn"
                    type="button"
                    onClick={() => void sendText()}
                    className={`shrink-0 w-10 h-10 rounded-full ${theme.accent} flex items-center justify-center`}
                    aria-label="Send"
                  >
                    <Send className="w-[18px] h-[18px]" />
                  </button>
                ) : (
                  <button
                    key="mic-btn"
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
              onPickEmoji={(emoji: string) => {
                setText((prev) => prev + emoji);
                onType();
              }}
              onSendGif={onSendGif}
              onSendSticker={onSendSticker}
              onClose={() => setPanel('none')}
            />
          </div>
        )}
        {panel === 'attach' && !voiceOpen && (
          <AttachPanel
            theme={theme}
            onPhoto={() => galleryRef.current?.click()}
            onCamera={() => cameraRef.current?.click()}
            onVideo={() => videoRef.current?.click()}
            onDocument={() => documentRef.current?.click()}
            onAudio={() => audioRef.current?.click()}
          />
        )}
      </div>

      <input type="file" ref={galleryRef} onChange={(e) => void addImages(e)} accept="image/*" className="hidden" multiple />
      <input type="file" ref={cameraRef} onChange={(e) => void addImages(e)} accept="image/*" capture="environment" className="hidden" />
      <input type="file" ref={documentRef} onChange={(e) => void sendRawFile(e, MediaType.File)} className="hidden" />
      <input type="file" ref={audioRef} onChange={(e) => void sendRawFile(e, MediaType.Audio)} accept="audio/*" className="hidden" />
      <input type="file" ref={videoRef} onChange={(e) => void sendRawFile(e, MediaType.Video)} accept="video/*" className="hidden" />

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
/* Main pane                                                  */
/* ────────────────────────────────────────────────────────── */

export function DirectMessagePane(): React.JSX.Element {
  const { userId } = useParams<{ userId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const callCtx = useCall() as unknown as {
    initiateCall: (peerId: string, type: CallType) => Promise<void>;
    callState: CallState;
    duration: number;
    peerId: string | null;
  };
  const initiateCall = callCtx.initiateCall;
  const {
    callState: activeCallState,
    duration: activeCallDuration,
    peerId: activeCallPeerId,
  } = callCtx;
    const inCallWithThisPeer =
    activeCallState !== 'idle' && activeCallPeerId === userId;

  const isPeerTyping = useDmTypingReceiver(userId);

  const [friends, setFriends] = useState<FriendDto[]>([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [targetUser, setTargetUser] = useState<UserProfileDto | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(INITIAL_HISTORY);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [friendRequestStatus, setFriendRequestStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [lastMessages, setLastMessages] = useState<Record<string, DirectMessageDto>>({});

  const [reactions, setReactions] = useState<Record<string, ReactionEntry[]>>(
    () => readReactions(user?.id, userId),
  );

  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<LocalMessage | null>(null);
  const [infoMessage, setInfoMessage] = useState<LocalMessage | null>(null);
  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<string | number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [viewerOpenIndex, setViewerOpenIndex] = useState<number | null>(null);
  const [viewOnceViewer, setViewOnceViewer] = useState<{
    url: string; senderName: string; sentAt: string; messageId: number;
  } | null>(null);
  const [chatMenuFriend, setChatMenuFriend] = useState<FriendDto | null>(null);

  // ── In-chat sending state (drives the loading screen) ──
  const [sendingMedia, setSendingMedia] = useState<SendingMediaState>(null);

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => readPinned(user?.id));
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => readMuted(user?.id));
  const [hiddenDmIds, setHiddenDmIds] = useState<Set<string>>(() => readHiddenDms(user?.id));

  useEffect(() => {
    setPinnedIds(readPinned(user?.id));
    setMutedIds(readMuted(user?.id));
    setHiddenDmIds(readHiddenDms(user?.id));
  }, [user?.id]);

  useEffect(() => {
    writeHiddenDms(user?.id, hiddenDmIds);
  }, [user?.id, hiddenDmIds]);

  const unhideDm = useCallback((peerId: string) => {
    setHiddenDmIds((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
  }, []);

  const hideDm = useCallback((peerId: string) => {
    setHiddenDmIds((prev) => {
      if (prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.add(peerId);
      return next;
    });
  }, []);

  const [chatThemeKey, setChatThemeKey] = useState<ChatThemeKey>(() => readThemeFor(user?.id, userId));

  useEffect(() => {
    setChatThemeKey(readThemeFor(user?.id, userId));
    setReactions(readReactions(user?.id, userId));
  }, [userId, user?.id]);

  useEffect(() => { writeThemeFor(user?.id, userId, chatThemeKey); }, [user?.id, userId, chatThemeKey]);
  useEffect(() => { writeReactions(user?.id, userId, reactions); }, [user?.id, userId, reactions]);

  const theme = CHAT_THEMES[chatThemeKey];

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  const UNREAD_KEY = `orbital.unreadDms.${user?.id ?? 'anon'}`;
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(
    () => lsGet(UNREAD_KEY, {} as Record<string, number>),
  );
  useEffect(() => { lsSet(UNREAD_KEY, unreadCounts); }, [unreadCounts, UNREAD_KEY]);

  const [, setPresenceTick] = useState(0);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const userIdRef = useRef(userId);
  const currentUserIdRef = useRef(user?.id);
  const reactionsRef = useRef(reactions);
  const replyToRef = useRef(replyTo);
  const processedIdsRef = useRef<Set<DirectMessageDto['id']>>(new Set());
  const stickRef = useRef(true);
  const anchorRef = useRef<number | null>(null);

  reactionsRef.current = reactions;
  replyToRef.current = replyTo;
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { currentUserIdRef.current = user?.id; }, [user?.id]);

  useEffect(() => {
    if (!userId) return;
    void getPublicKeyFor(userId).catch(() => {});
  }, [userId]);

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

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const loadFriends = useCallback(async () => {
    try {
      const friendList = await apiService.getFriends();

      if (!user?.id) {
        setFriends(friendList);
        setFriendsLoaded(true);  
        return;
      }

      const previews = await Promise.all(
        friendList.map(async (f) => {
          try {
            const res = await apiService.getDmHistory(f.userId, 1);
            const history = applyPresignedUrls(res.messages, res.presignedUrls);
            if (history.length === 0) return null;
            const decrypted = await decryptBatch(history, user.id);
            return { userId: f.userId, msg: decrypted[0] };
          } catch {
            return null;
          }
        }),
      );

      const lastMap: Record<string, DirectMessageDto> = {};
      for (const p of previews) {
        if (p) lastMap[p.userId] = p.msg;
      }

      setFriends(friendList);
      setLastMessages(lastMap);
      setFriendsLoaded(true);  
    } catch (err) {
      console.error('Failed to load friends list:', err);
    }
  }, [user?.id]);

  useEffect(() => { void loadFriends(); }, [loadFriends]);

  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => unsub();
  }, []);

  const isConfirmedFriend = useMemo(() => {
    if (!userId) return false;
    return friends.some((f) => f.userId === userId);
  }, [userId, friends]);

  const isTargetOnline = presenceStore.isOnline(userId);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = friends.filter((f) => !hiddenDmIds.has(f.userId));
    const list = q
      ? base.filter(
          (f) => f.displayName.toLowerCase().includes(q) || (f.handle ?? '').toLowerCase().includes(q),
        )
      : base;

    list.sort((a, b) => {
      const aP = pinnedIds.has(a.userId) ? 1 : 0;
      const bP = pinnedIds.has(b.userId) ? 1 : 0;
      if (aP !== bP) return bP - aP;

      const ma = lastMessages[a.userId];
      const mb = lastMessages[b.userId];
      const ta = ma ? getMessageTime(ma) : 0;
      const tb = mb ? getMessageTime(mb) : 0;
      if (tb !== ta) return tb - ta;

      return a.friendshipId - b.friendshipId;
    });

    return list;
  }, [friends, searchQuery, lastMessages, pinnedIds, hiddenDmIds]);

  const chatImages = useMemo(
    () =>
      messages
        .filter((m) => m.mediaType === MediaType.Image && m.mediaUrl && !m.viewOnce && !m.sticker)
        .map((m) => ({
          url: m.mediaUrl as string,
          senderName: m.senderId === user?.id ? 'You' : targetUser?.displayName ?? 'Them',
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
          senderName: m.senderId === currentUserIdRef.current ? 'You' : targetUser?.displayName ?? 'Them',
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
      const id = viewOnceViewer.messageId;
      markV1Seen(currentUserIdRef.current, id);
      setMessages((prev) =>
        prev.map((x) => (x.id === id ? { ...x, viewed: true, mediaUrl: NO_MEDIA } : x)),
      );
    }
    setViewOnceViewer(null);
  }, [viewOnceViewer]);

  const jumpToMessage = useCallback((id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setHighlightedMessageId(id);
    window.setTimeout(() => setHighlightedMessageId((cur) => (cur === id ? null : cur)), 1300);
    if (navigator.vibrate) navigator.vibrate(8);
  }, []);

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
              id: userId, userHandle: 'user', fullHandle: `${userId}@orbit`,
              displayName: 'Contact', createdAt: '',
            });
          }
        }
      }
    };
    void loadTarget();
    return () => { active = false; };
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
    setMessages([]);
    setReplyTo(null);
    setHistoryLimit(INITIAL_HISTORY);
    setCanLoadMore(false);
    setShowJumpToLatest(false);
    setSendingMedia(null);
    processedIdsRef.current = new Set();
    stickRef.current = true;
    anchorRef.current = null;
  }, [userId]);

  const decodeMessages = useCallback(
    async (raw: DirectMessageDto[], currentUserId: string, seenSet: Set<number>) => {
      const decrypted = await decryptBatch(raw, currentUserId);
      const msgs: LocalMessage[] = [];
      const events: ReactionEvent[] = [];

      for (const d of decrypted) {
        const text = d.plaintext ?? d.content ?? '';
        const decoded = decodeIncoming(text);
        if (decoded.isReaction) {
          events.push({
            messageId: decoded.messageId,
            emoji: decoded.emoji,
            action: decoded.action,
            userId: d.senderId,
          });
          continue;
        }
        const viewed = decoded.viewOnce && typeof d.id === 'number' && seenSet.has(d.id);
        msgs.push({
          ...d,
          plaintext: decoded.body,
          content: decoded.body,
          mediaUrl: viewed ? NO_MEDIA : d.mediaUrl,
          viewOnce: decoded.viewOnce,
          sticker: decoded.sticker,
          viewed,
          replyToId: decoded.replyToId,
          call: decoded.call ?? null,
        });
      }
      return { msgs, events };
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
        const res = await apiService.getDmHistory(userId, historyLimit);
        const history = applyPresignedUrls(res.messages, res.presignedUrls);
        if (!active) return;
        const sorted = [...history].sort((a, b) => getMessageTime(a) - getMessageTime(b));
        const seen = readV1Seen(user.id);
        const { msgs, events } = await decodeMessages(sorted, user.id, seen);
        if (!active) return;
        processedIdsRef.current = new Set(sorted.map((h) => h.id));
        setMessages((prev) => {
          const temps = prev.filter((m) => typeof m.id === 'number' && m.id < 0);
          return temps.length ? [...msgs, ...temps] : msgs;
        });
        setReactions((prev) => applyReactionEvents(prev, events));
        setCanLoadMore(history.length >= historyLimit);
        if (msgs.length > 0) {
          const latest = msgs[msgs.length - 1];
          setLastMessages((prev) => ({ ...prev, [userId]: latest }));
        }
        void apiService.markDmRead(userId);
      } catch (err) {
        if (!active) return;
        anchorRef.current = null;
        setHistoryError(extractErrorMessage(err, 'Could not load messages. Tap retry.'));
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    void fetchHistory();
    return () => { active = false; };
  }, [userId, user?.id, historyLimit, reloadTick, decodeMessages]);

  useEffect(() => {
    if (!userId || !user?.id) return;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await apiService.getDmHistory(userId, POLL_LIMIT);
        const history = applyPresignedUrls(res.messages, res.presignedUrls);
        if (cancelled) return;

        const processed = processedIdsRef.current;
        const fresh = history.filter((h) => !processed.has(h.id));
        const readMap = new Map(history.map((h) => [h.id, h.isRead]));
        const histIds = new Set(history.map((h) => h.id));
        const windowFull = history.length >= POLL_LIMIT;
        const minId = windowFull
          ? history.reduce((acc, h) => Math.min(acc, Number(h.id)), Number.POSITIVE_INFINITY)
          : Number.NEGATIVE_INFINITY;

        let decodedMsgs: LocalMessage[] = [];
        let events: ReactionEvent[] = [];
        if (fresh.length > 0) {
          const sortedFresh = [...fresh].sort((a, b) => getMessageTime(a) - getMessageTime(b));
          const res = await decodeMessages(sortedFresh, user.id, readV1Seen(user.id));
          if (cancelled) return;
          decodedMsgs = res.msgs;
          events = res.events;
          for (const h of fresh) processed.add(h.id);
        }

        startTransition(() => {
          setMessages((prev) => {
            let changed = false;
            let next: LocalMessage[] = [];
            for (const m of prev) {
              const isTempMsg = typeof m.id === 'number' && m.id < 0;
              if (isTempMsg) { next.push(m); continue; }
              if (!histIds.has(m.id) && Number(m.id) >= minId) { changed = true; continue; }
              const r = readMap.get(m.id);
              if (r !== undefined && r !== m.isRead) {
                changed = true;
                next.push({ ...m, isRead: r });
              } else {
                next.push(m);
              }
            }
            if (decodedMsgs.length > 0) {
              for (const d of decodedMsgs) {
                const merged = mergeIncoming(next, d);
                if (merged !== next) { next = merged; changed = true; }
              }
              next = [...next].sort((a, b) => getMessageTime(a) - getMessageTime(b));
            }
            return changed ? next : prev;
          });
          if (events.length > 0) setReactions((prev) => applyReactionEvents(prev, events));
        });
      } catch { /* silent */ } finally { inFlight = false; }
    };

    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    const onVis = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [userId, user?.id, decodeMessages]);

  useEffect(() => {
    const unsub = signalRService.onReceiveDirectMessage(
      async (msg: DirectMessageDto) => {
        const decrypted = await decryptOne(msg, user?.id ?? '');
        const text = decrypted.plaintext ?? decrypted.content ?? '';
        const decoded = decodeIncoming(text);

        const isCurrentChat =
          (msg.senderId === userIdRef.current && msg.recipientId === user?.id) ||
          (msg.senderId === user?.id && msg.recipientId === userIdRef.current);
        if (isCurrentChat) processedIdsRef.current.add(msg.id);

        if (decoded.isReaction) {
          const ev: ReactionEvent = {
            messageId: decoded.messageId,
            emoji: decoded.emoji,
            action: decoded.action,
            userId: decrypted.senderId,
          };
          startTransition(() => { setReactions((prev) => applyReactionEvents(prev, [ev])); });
          return;
        }

        const local: LocalMessage = {
          ...decrypted,
          plaintext: decoded.body,
          content: decoded.body,
          viewOnce: decoded.viewOnce,
          sticker: decoded.sticker,
          viewed: false,
          replyToId: decoded.replyToId,
          call: decoded.call ?? null,
        };

        // Phase 3: incoming media arrives with mediaKey but no mediaUrl.
        // Presign it here unless it's our own echo (temp already has a blob: URL).
        const isOwnEcho = msg.senderId === user?.id;
        if (local.mediaKey && !local.mediaUrl && !isOwnEcho) {
          try {
            const urls = await apiService.presignDownload([local.mediaKey]);
            if (urls[local.mediaKey]) {
              local.mediaUrl = urls[local.mediaKey];
            }
          } catch {
            /* silent — image will render as soon as next poll presigns it */
          }
        }

        const otherId = msg.senderId === user?.id ? msg.recipientId : msg.senderId;
        if (otherId) {
          unhideDm(otherId);
          setLastMessages((prev) => {
            const existing = prev[otherId];
            if (existing && getMessageTime(existing) >= getMessageTime(local)) return prev;
            return { ...prev, [otherId]: local };
          });
        }

        if (isCurrentChat) {
          startTransition(() => { setMessages((prev) => mergeIncoming(prev, local)); });
          if (msg.senderId === userIdRef.current) {
            if (!local.call) playReceive();
            void apiService.markDmRead(userIdRef.current!);
          }
        } else if (msg.recipientId === user?.id && msg.senderId !== user?.id) {
          if (!local.call) playReceive();
          setUnreadCounts((prev) => ({ ...prev, [msg.senderId]: (prev[msg.senderId] ?? 0) + 1 }));
        }
      },
    );
    return () => { unsub(); };
  }, [user?.id, unhideDm]);

  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (anchorRef.current != null) {
      el.scrollTop += el.scrollHeight - anchorRef.current;
      anchorRef.current = null;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isPeerTyping]);

  const handleMediaLoad = useCallback(() => {
    if (stickRef.current) scrollToBottom();
  }, [scrollToBottom]);

  const handleLoadEarlier = () => {
    const el = messagesContainerRef.current;
    if (el) anchorRef.current = el.scrollHeight;
    stickRef.current = false;
    setHistoryLimit((l) => l + HISTORY_STEP);
  };

  /* ── Sending ─────────────────────────────────────────────── */

  /**
   * Upload a file to R2 (presign → PUT), then send the message via SignalR
   * with only the `mediaKey`. The blob: URL provides optimistic render.
   *
   * For external URLs (GIFs, stickers from Tenor/Giphy), use `sendExternalUrl`.
   */
  const sendMediaFile = useCallback(
    async (
      file: File | Blob,
      mediaType: number,
      extraText = '',
    ): Promise<void> => {
      if (!userId || !user?.id) return;
      stickRef.current = true;

      const contentType = file.type || 'application/octet-stream';
      const fileName =
        file instanceof File
          ? file.name
          : `upload-${Date.now()}.${contentType.split('/')[1] ?? 'bin'}`;

      // 1. Presign + PUT to R2
      const presign = await apiService.presignUpload(
        fileName,
        contentType,
        file.size,
        'dm',
      );
      await apiService.uploadToR2(presign.uploadUrl, file, contentType);

      // 2. Optimistic local render via blob URL
      const blobUrl = URL.createObjectURL(file);
      const tempId = -Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: tempId, senderId: user.id, recipientId: userId,
          ciphertext: null, nonce: null,
          content: extraText || null, plaintext: extraText || undefined,
          mediaUrl: blobUrl,
          mediaKey: presign.mediaKey,
          mediaType,
          isRead: false, sentAt: new Date().toISOString(),
          viewOnce: false, sticker: false, viewed: false, replyToId: null,
        },
      ]);

      // 3. Encrypt the caption/payload
      try {
        let ciphertext = '';
        let nonce = '';
        if (extraText) {
          const pub = await getPublicKeyFor(userId);
          const enc = await encryptFor(pub, extraText);
          ciphertext = enc.ciphertext;
          nonce = enc.nonce;
        }

        // 4. Send
        await signalRService.sendDirectMessage({
          recipientId: userId,
          ciphertext,
          nonce,
          mediaUrl: undefined,
          mediaKey: presign.mediaKey,
          mediaType,
        });
        playSend();
        unhideDm(userId);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        URL.revokeObjectURL(blobUrl);
        throw err;
      }
    },
    [userId, user?.id, unhideDm],
  );

  /**
   * External URL path — GIFs and stickers from third-party services (Tenor,
   * Giphy). Those are already URLs on someone else's CDN; we just pass them
   * through as `mediaUrl`, no R2 involvement.
   */
  const sendExternalUrl = useCallback(
    async (
      url: string,
      mediaType: number,
      extraText = '',
      sticker = false,
    ): Promise<void> => {
      if (!userId || !user?.id) return;
      stickRef.current = true;
      const tempId = -Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: tempId, senderId: user.id, recipientId: userId,
          ciphertext: null, nonce: null,
          content: extraText || null, plaintext: extraText || undefined,
          mediaUrl: url, mediaType, isRead: false, sentAt: new Date().toISOString(),
          viewOnce: false, sticker, viewed: false, replyToId: null,
        },
      ]);
      try {
        let ciphertext = '';
        let nonce = '';
        let payload = extraText;
        if (sticker) payload = `[sticker]${payload}`;
        if (payload) {
          const pub = await getPublicKeyFor(userId);
          const enc = await encryptFor(pub, payload);
          ciphertext = enc.ciphertext;
          nonce = enc.nonce;
        }
        await signalRService.sendDirectMessage({
          recipientId: userId, ciphertext, nonce, mediaUrl: url, mediaType,
        });
        playSend();
        unhideDm(userId);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        throw err;
      }
    },
    [userId, user?.id, unhideDm],
  );

  const handleSendMedia = useCallback(
    (file: File | Blob, type: number) => sendMediaFile(file, type),
    [sendMediaFile],
  );
  const handleSendGif = useCallback(
    (url: string) => { void sendExternalUrl(url, MediaType.Image).catch(() => {}); },
    [sendExternalUrl],
  );
  const handleSendSticker = useCallback(
    (url: string) => { void sendExternalUrl(url, MediaType.Image, '', true).catch(() => {}); },
    [sendExternalUrl],
  );

  const handleComposerSend = useCallback(
    async ({ text, files, viewOnce }: SendPayload): Promise<void> => {
      if (!userId || !user?.id) return;
      const current = replyToRef.current;
      const replyId =
        current && typeof current.id === 'number' && current.id > 0 ? current.id : null;
      setReplyTo(null);
      stickRef.current = true;

      const tempIds: number[] = [];
      const blobUrls: string[] = [];
      try {
        const recipientPub = await getPublicKeyFor(userId);

        if (files.length > 0) {
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const caption = i === 0 ? text : '';

            // Presign + PUT
            const contentType = file.type || 'application/octet-stream';
            const presign = await apiService.presignUpload(
              file.name, contentType, file.size, 'dm',
            );
            await apiService.uploadToR2(presign.uploadUrl, file, contentType);

            const blobUrl = URL.createObjectURL(file);
            blobUrls.push(blobUrl);

            let payload = caption;
            if (i === 0 && replyId != null) payload = encodeReply(replyId, payload);
            if (viewOnce) payload = `[v1]${payload}`;

            const tempId = -Date.now() - i;
            tempIds.push(tempId);
            setMessages((prev) => [
              ...prev,
              {
                id: tempId, senderId: user.id, recipientId: userId,
                ciphertext: null, nonce: null,
                content: caption || null,
                plaintext: caption || undefined,
                mediaUrl: blobUrl,
                mediaKey: presign.mediaKey,
                mediaType: MediaType.Image, isRead: false,
                sentAt: new Date().toISOString(),
                viewOnce, viewed: false,
                replyToId: i === 0 ? replyId : null,
              },
            ]);

            let ciphertext = '';
            let nonce = '';
            if (payload.length > 0) {
              const enc = await encryptFor(recipientPub, payload);
              ciphertext = enc.ciphertext;
              nonce = enc.nonce;
            }
            await signalRService.sendDirectMessage({
              recipientId: userId,
              ciphertext,
              nonce,
              mediaUrl: undefined,
              mediaKey: presign.mediaKey,
              mediaType: MediaType.Image,
            });
            playSend();
          }
          unhideDm(userId);
        } else if (text.length > 0) {
          const payload = replyId != null ? encodeReply(replyId, text) : text;

          const tempId = -Date.now();
          tempIds.push(tempId);
          setMessages((prev) => [
            ...prev,
            {
              id: tempId, senderId: user.id, recipientId: userId,
              ciphertext: null, nonce: null,
              content: text, plaintext: text, isRead: false,
              sentAt: new Date().toISOString(),
              viewOnce: false, viewed: false,
              replyToId: replyId,
            },
          ]);

          const enc = await encryptFor(recipientPub, payload);
          await signalRService.sendDirectMessage({
            recipientId: userId, ciphertext: enc.ciphertext, nonce: enc.nonce,
            mediaUrl: undefined, mediaType: undefined,
          });
          playSend();
          unhideDm(userId);
        }
      } catch (err) {
        setMessages((prev) => prev.filter((m) => !tempIds.includes(m.id as number)));
        for (const url of blobUrls) {
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
        throw err;
      }
    },
    [userId, user?.id, unhideDm],
  );

  const handleReact = useCallback(
    async (messageId: number, emoji: string) => {
      if (!userId || !user?.id) return;
      const existing = reactionsRef.current[String(messageId)] ?? [];
      const mine = existing.find((r) => r.userId === user.id && r.emoji === emoji);
      const action: 'add' | 'remove' = mine ? 'remove' : 'add';

      setReactions((prev) => applyReactionEvents(prev, [{ messageId, emoji, action, userId: user.id }]));

      try {
        const payload = encodeReaction(messageId, emoji, action);
        const pub = await getPublicKeyFor(userId);
        const enc = await encryptFor(pub, payload);
        await signalRService.sendDirectMessage({
          recipientId: userId, ciphertext: enc.ciphertext, nonce: enc.nonce,
          mediaUrl: undefined, mediaType: undefined,
        });
      } catch (err) { console.warn('Reaction send failed:', err); }
    },
    [userId, user?.id],
  );

  const handleStartReply = useCallback((m: LocalMessage) => {
    if (typeof m.id === 'number' && m.id < 0) return;
    if (m.call) return;
    setReplyTo(m);
  }, []);

  const handleCancelReply = useCallback(() => setReplyTo(null), []);
  const handleOpenMenu = useCallback((m: LocalMessage) => { setMenuMessage(m); }, []);

  /* ── Misc actions ────────────────────────────────────────── */

  const handleSendFriendRequest = async () => {
    if (!targetUser?.userHandle) return;
    try {
      await apiService.sendFriendRequest({ targetIdentifier: targetUser.userHandle });
      setFriendRequestStatus('Request sent');
      setTimeout(() => setFriendRequestStatus(null), 3000);
    } catch (err) { setFriendRequestStatus(extractErrorMessage(err)); }
  };

  const handleAudioCall = async () => {
    if (!userId) return;
    if (!isTargetOnline) {
      toast.custom(
        (t) => (
          <OfflineCallToast
            name={targetUser?.displayName ?? 'This user'}
            avatarUrl={targetUser?.avatarUrl}
            type="audio"
            onDismiss={() => toast.dismiss(t)}
          />
        ),
        { duration: 5000 },
      );
      return;
    }
    try { await initiateCall(userId, CallType.Audio); }
    catch (err) { alert(`Call failed: ${extractErrorMessage(err)}`); }
  };

  const handleVideoCall = async () => {
    if (!userId) return;
    if (!isTargetOnline) {
      toast.custom(
        (t) => (
          <OfflineCallToast
            name={targetUser?.displayName ?? 'This user'}
            avatarUrl={targetUser?.avatarUrl}
            type="video"
            onDismiss={() => toast.dismiss(t)}
          />
        ),
        { duration: 5000 },
      );
      return;
    }
    try { await initiateCall(userId, CallType.Video); }
    catch (err) { alert(`Call failed: ${extractErrorMessage(err)}`); }
  };

  const handleDeleteForMe = useCallback(async (m: LocalMessage) => {
    startTransition(() => {
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      setReactions((prev) => {
        const next = { ...prev };
        delete next[String(m.id)];
        return next;
      });
    });
    try { await apiService.deleteDm(m.id); }
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
      setReactions((prev) => {
        const next = { ...prev };
        delete next[String(targetId)];
        return next;
      });
    });
    setPendingDeleteEveryoneId(null);
    try { await apiService.deleteDmForEveryone(targetId); }
    catch (err) {
      if (userIdRef.current && currentUserIdRef.current) {
        try {
          const res = await apiService.getDmHistory(userIdRef.current, historyLimit);
          const history = applyPresignedUrls(res.messages, res.presignedUrls);
          const sorted = [...history].sort((a, b) => getMessageTime(a) - getMessageTime(b));
          const { msgs } = await decodeMessages(sorted, currentUserIdRef.current, readV1Seen(currentUserIdRef.current));
          processedIdsRef.current = new Set(sorted.map((h) => h.id));
          setMessages(msgs);
        } catch { /* ignore */ }
      }
      alert(`Delete for everyone failed: ${extractErrorMessage(err)}`);
    }
  }, [pendingDeleteEveryoneId, decodeMessages, historyLimit]);

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
    setLastMessages((prev) => { const next = { ...prev }; delete next[userId]; return next; });
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

  /* ── Derived list data ───────────────────────────────────── */

  const items = useMemo(() => {
    type Item =
      | { type: 'date'; key: string; label: string }
      | { type: 'msg'; key: string; message: LocalMessage; grouped: boolean; last: boolean };

    const out: Item[] = [];
    let lastDate = '';
    let lastSenderId = '';
    let lastTs = 0;

    for (const m of messages) {
      if (m.call) continue;

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
      it.last = !(
        next &&
        next.type === 'msg' &&
        next.message.senderId === it.message.senderId
      );
    }
    return out;
  }, [messages]);

  const messagesById = useMemo(() => {
    const map = new Map<DirectMessageDto['id'], LocalMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  /* ── Sidebar helpers ─────────────────────────────────────── */

  const handleSelectFriend = useCallback((id: string) => { navigate(`/app/dm/${id}`); }, [navigate]);
  const handleFriendMenu = useCallback((f: FriendDto) => { setChatMenuFriend(f); }, []);

  const togglePin = (peerId: string) => {
    const next = new Set(pinnedIds);
    if (next.has(peerId)) next.delete(peerId); else next.add(peerId);
    setPinnedIds(next);
    writePinned(user?.id, next);
  };
  const toggleMute = (peerId: string) => {
    const next = new Set(mutedIds);
    if (next.has(peerId)) next.delete(peerId); else next.add(peerId);
    setMutedIds(next);
    writeMuted(user?.id, next);
  };

  const hasActiveChat = Boolean(userId && targetUser);

  return (
    <div className={`flex h-full w-full ${theme.bg} overflow-hidden relative`}>
      {/* Sidebar */}
      <div className={`${hasActiveChat ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] md:shrink-0 border-r ${theme.subtleBorder} ${theme.sidebarBg} flex-col h-full`}>
        <div className="h-[68px] px-5 flex items-center justify-between shrink-0">
          <div className="flex items-baseline gap-2">
            <h2 className={`text-[22px] font-bold tracking-tight ${theme.textPrimary}`}>Chats</h2>
            <span className={`text-[12px] tabular-nums font-semibold ${theme.textSecondary}`}>{filteredFriends.length}</span>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${theme.textSecondary}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations"
              className={`w-full h-11 pl-10 pr-3 rounded-2xl ${theme.subtleBg} border ${theme.subtleBorder} text-[13.5px] ${theme.textPrimary} focus:outline-none placeholder:opacity-60`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-0.5">
          {filteredFriends.length === 0 ? (
            <div className={`p-8 text-center text-[13px] font-medium ${theme.textSecondary}`}>
              {friends.length === 0
                ? 'No contacts yet.'
                : searchQuery
                ? 'No matches found.'
                : 'No conversations. Start one from Friends.'}
            </div>
          ) : (
            filteredFriends.map((friend) => (
              <FriendRow
                key={friend.friendshipId}
                friend={friend}
                selected={friend.userId === userId}
                online={presenceStore.isOnline(friend.userId)}
                unread={unreadCounts[friend.userId] ?? 0}
                last={lastMessages[friend.userId]}
                myId={user?.id}
                pinned={pinnedIds.has(friend.userId)}
                muted={mutedIds.has(friend.userId)}
                theme={theme}
                onSelect={handleSelectFriend}
                onMenu={handleFriendMenu}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat pane */}
      <div className={`${hasActiveChat ? 'flex' : 'hidden md:flex'} flex-1 flex-col h-full min-w-0 ${theme.bg} relative`}>
        {theme.ambientStyle && (
          <div className="pointer-events-none absolute inset-0" style={theme.ambientStyle} />
        )}

        {userId && targetUser ? (
          <>
            <div className={`h-[68px] px-3 sm:px-5 border-b ${theme.subtleBorder} ${theme.composerBg} flex items-center justify-between shrink-0 gap-2 z-20 relative`}>
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => navigate('/app/dm')}
                  className={`md:hidden w-9 h-9 rounded-xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg} shrink-0`}
                >
                  <ChevronLeft className="w-[20px] h-[20px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setProfileModalUserId(targetUser.id)}
                  className="shrink-0 rounded-full"
                >
                  <Avatar name={targetUser.displayName} src={targetUser.avatarUrl} size="md" isOnline={isTargetOnline} />
                </button>
                <div className="min-w-0">
                  <h3 className={`text-[15.5px] font-bold truncate tracking-tight ${theme.textPrimary}`}>{targetUser.displayName}</h3>
                  <p className={`text-[11.5px] truncate mt-0.5 flex items-center gap-1.5 ${theme.textSecondary}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      isTargetOnline ? 'bg-[#22C55E]' : 'opacity-40 bg-current'
                    }`} />
                    <span>
                      {isTargetOnline ? 'Active now' : 'Offline'}
                      <span className="opacity-70 hidden sm:inline"> · @{targetUser.userHandle}</span>
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                                <button
                  onClick={() => void handleAudioCall()}
                  title={inCallWithThisPeer ? 'Already in call' : 'Audio call'}
                  disabled={inCallWithThisPeer}
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center ${theme.textSecondary} ${
                    inCallWithThisPeer ? 'opacity-40 cursor-not-allowed' : theme.hoverBg
                  }`}
                >
                  <Phone className="w-[18px] h-[18px]" />
                </button>
                 
                <button
                  onClick={() => void handleVideoCall()}
                  title={inCallWithThisPeer ? 'Already in call' : 'Video call'}
                  disabled={inCallWithThisPeer}
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center ${theme.textSecondary} ${
                    inCallWithThisPeer ? 'opacity-40 cursor-not-allowed' : theme.hoverBg
                  }`}
                >
                  <Video className="w-[18px] h-[18px]" />
                </button>
                <button onClick={() => setInfoOpen(true)} className={`w-10 h-10 rounded-2xl flex items-center justify-center ${theme.textSecondary} ${theme.hoverBg}`}>
                  <Info className="w-[18px] h-[18px]" />
                </button>
              </div>
            </div>

            {activeCallState === 'connecting' && activeCallPeerId === userId && (
              <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 z-30">
                <CallTimerPill callState={activeCallState} duration={activeCallDuration} />
              </div>
            )}

            {friendsLoaded && !isConfirmedFriend && (
              <div className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#D97706]/[0.08] border-b border-[#D97706]/20 flex flex-wrap items-center justify-between gap-3 text-[12.5px] relative z-10">
                <div className={`flex items-center gap-2 min-w-0 ${theme.textSecondary}`}>
                  <AlertCircle className="w-4 h-4 text-[#D97706] shrink-0" />
                  <span className="truncate">You're not friends yet — messaging is limited.</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {friendRequestStatus && <span className="text-[11.5px] font-semibold text-[#4ADE80]">{friendRequestStatus}</span>}
                  <button
                    onClick={() => void handleSendFriendRequest()}
                    className={`h-7 px-3 rounded-lg ${theme.accent} text-[11.5px] font-semibold inline-flex items-center gap-1.5`}
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Add friend
                  </button>
                </div>
              </div>
            )}

            {/* Floating sending pill — non-blocking, leaves the chat usable */}
            {sendingMedia && (
              <div className="absolute top-[76px] left-1/2 -translate-x-1/2 z-30 pointer-events-none max-w-[92%]">
                <SendingPill sending={sendingMedia} theme={theme} />
              </div>
            )}

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
                  >Retry</button>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <div className={`w-14 h-14 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} flex items-center justify-center`}>
                    <User className={`w-6 h-6 ${theme.textSecondary}`} />
                  </div>
                  <div>
                    <p className={`text-[15.5px] font-bold tracking-tight ${theme.textPrimary}`}>No messages yet</p>
                    <p className={`text-[13px] mt-1 ${theme.textSecondary}`}>Say hi to {targetUser.displayName}.</p>
                  </div>
                </div>
              ) : (
                <>
                  {canLoadMore && (
                    <div className="flex justify-center mb-2">
                      <button
                        onClick={handleLoadEarlier}
                        disabled={loadingHistory}
                        className={`h-8 px-4 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} ${theme.textSecondary} text-[11.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60`}
                      >
                        {loadingHistory && <Loader2 className="w-3 h-3 animate-spin" />}
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
                        senderName={isMe ? 'You' : targetUser.displayName}
                        senderAvatar={isMe ? user?.avatarUrl : targetUser.avatarUrl}
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
                        onMediaLoad={handleMediaLoad}
                      />
                    );
                  })}
                </>
              )}

              {isPeerTyping && (
                <div className="flex items-end gap-2.5 mt-3 justify-start">
                  <div className="w-8 shrink-0">
                    <Avatar name={targetUser.displayName} src={targetUser.avatarUrl} size="sm" />
                  </div>
                  <div className={`inline-flex items-center gap-1.5 px-4 py-3 rounded-[20px] rounded-bl-[4px] ${theme.bubbleReceived}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.32s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.16s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" />
                  </div>
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
              key={userId}
              userId={userId}
              targetName={targetUser.displayName}
              theme={theme}
              replyTo={replyTo}
              onCancelReply={handleCancelReply}
              onSend={handleComposerSend}
              onSendMedia={handleSendMedia}
              onSendGif={handleSendGif}
              onSendSticker={handleSendSticker}
              onSendingStateChange={setSendingMedia}
            />
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 relative z-10 select-none">
            <div className={`w-16 h-16 rounded-full ${theme.subtleBg} border ${theme.subtleBorder} flex items-center justify-center mb-6`}>
              <User className={`w-7 h-7 ${theme.textSecondary}`} />
            </div>
            <h3 className={`text-[18px] font-bold mb-2 tracking-tight ${theme.textPrimary}`}>Your messages</h3>
            <p className={`text-[13.5px] max-w-[320px] leading-relaxed ${theme.textSecondary}`}>
              Pick a conversation from the sidebar to start chatting.
            </p>
          </div>
        )}
      </div>

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
            const t = menuMessage.plaintext ?? menuMessage.content ?? '';
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
          targetName={targetUser?.displayName ?? 'Contact'}
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
                This message will be removed for both you and {targetUser?.displayName ?? 'the other person'}. This cannot be undone.
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

      {chatMenuFriend && (
        <ChatContextMenu
          friend={chatMenuFriend}
          isPinned={pinnedIds.has(chatMenuFriend.userId)}
          isMuted={mutedIds.has(chatMenuFriend.userId)}
          onClose={() => setChatMenuFriend(null)}
          onPin={() => togglePin(chatMenuFriend.userId)}
          onMute={() => toggleMute(chatMenuFriend.userId)}
          onMarkRead={() => {
            setUnreadCounts((prev) => { const next = { ...prev }; delete next[chatMenuFriend.userId]; return next; });
            void apiService.markDmRead(chatMenuFriend.userId);
          }}
          onDeleteFromHere={() => {
            const peerId = chatMenuFriend.userId;
            void apiService.clearConversation(peerId).catch(() => {});
            hideDm(peerId);
            setLastMessages((prev) => { const next = { ...prev }; delete next[peerId]; return next; });
            setUnreadCounts((prev) => { const next = { ...prev }; delete next[peerId]; return next; });
            if (peerId === userId) {
              setMessages([]);
              setReactions({});
              navigate('/app/dm');
            }
          }}
          onBlock={async () => {
            try {
              await apiService.blockUser(chatMenuFriend.userId);
              setFriends((prev) => prev.filter((f) => f.userId !== chatMenuFriend.userId));
              if (chatMenuFriend.userId === userId) navigate('/app/dm');
            } catch (err) { alert(`Block failed: ${extractErrorMessage(err)}`); }
          }}
          onUnfriend={async () => {
            try {
              await apiService.unfriend(chatMenuFriend.userId);
              setFriends((prev) => prev.filter((f) => f.userId !== chatMenuFriend.userId));
              if (chatMenuFriend.userId === userId) navigate('/app/dm');
            } catch (err) { alert(`Unfriend failed: ${extractErrorMessage(err)}`); }
          }}
        />
      )}

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

      <UserProfileModal userId={profileModalUserId} onClose={() => setProfileModalUserId(null)} />

      {viewerOpenIndex != null && viewerOpenIndex >= 0 && (
        <ImageViewer images={chatImages} startIndex={viewerOpenIndex} onClose={() => setViewerOpenIndex(null)} />
      )}

      {viewOnceViewer && (
        <ViewOnceViewerModal
          url={viewOnceViewer.url}
          senderName={viewOnceViewer.senderName}
          sentAt={viewOnceViewer.sentAt}
          onClose={handleCloseViewOnce}
        />
      )}
    </div>
  );
}

export default DirectMessagePane;