/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiService, extractErrorMessage, applyPresignedUrls } from '../services/api';
import { signalRService } from '../services/signalr';
import { useAuth } from '../context/AuthContext';
import { presenceStore } from '../services/presenceStore';
import { useGroupCall, isCallSignal, MAX_PARTICIPANTS } from '../hooks/useGroupCall';
import { Phone, PhoneOff, MicOff, Mic, Volume2, VolumeX, MessageSquare } from 'lucide-react';
import { playReceive, playSend, unlockSounds } from '../services/sounds';
import {
  GroupDto, GroupDetailDto, GroupMessageDto, MediaType, FriendDto,
} from '../types/api';
import { Avatar } from './Avatar';
import { UserProfileModal } from './UserProfileModal';
import MessageSkeleton from './MessageSkeleton';
import { MAX_FILE_SIZE, validateFileSize } from '../services/upload';
import {
  Plus, Paperclip, Send, Loader2, FileText, Download, AlertCircle, X,
  Hash, Info, LogOut, Trash2, UserMinus, ChevronLeft, ChevronDown, Search,
  Pin, PinOff, Bell, BellOff, Eraser, CheckCheck, Check, EyeOff, Reply,
  Copy, CornerUpLeft, MoreHorizontal, Smile, Keyboard, Image as ImageIcon,
  Camera, Music,
} from 'lucide-react';
import {
  useGroupTypingEmitter,
  useGroupTypingReceiver,
} from '../hooks/useTypingIndicator';
import { EmojiPanel } from './dm/ComposerToolkit';

/* ────────────────────────────────────────────────────────── */
/* Tunables                                                   */
/* ────────────────────────────────────────────────────────── */

const PAGE_SIZE = 50;
const PANEL_HEIGHT = 'h-[300px]';
const MAX_RECORD_MS = 5 * 60 * 1000;
const QUICK_REACT_EMOJIS = ['👍', '❤️', '😂'];
const SPEAKING_THRESHOLD = 0.015;
const SPEAKING_HOLD_MS = 350;

/* ────────────────────────────────────────────────────────── */
/* Codec                                                      */
/* ────────────────────────────────────────────────────────── */

const REACT_RE = /^\[react:(-?\d+):([^:\]]+)(?::(add|remove))?\]$/;
const REPLY_RE = /^\[reply:(-?\d+)\]/;
const DEL_RE = /^\[del:(-?\d+)\]$/;

interface DecodedMessage { body: string; replyToId: number | null; isReaction: false; isDelete: false; }
interface DecodedReaction { isReaction: true; messageId: number; emoji: string; action: 'add' | 'remove'; }
interface DecodedDelete { isReaction: false; isDelete: true; messageId: number; }
type Decoded = DecodedMessage | DecodedReaction | DecodedDelete;

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
  const del = text.match(DEL_RE);
  if (del) return { isDelete: true, isReaction: false, messageId: parseInt(del[1], 10) };
  let body = text;
  let replyToId: number | null = null;
  const reply = body.match(REPLY_RE);
  if (reply) { replyToId = parseInt(reply[1], 10); body = body.slice(reply[0].length); }
  return { body, replyToId, isReaction: false, isDelete: false };
}

function encodeReaction(messageId: number, emoji: string, action: 'add' | 'remove' = 'add') {
  return `[react:${messageId}:${emoji}:${action}]`;
}
function encodeReply(replyToId: number, text: string) { return `[reply:${replyToId}]${text}`; }

function mergeIncomingGroup(prev: GroupMessageDto[], local: GroupMessageDto): GroupMessageDto[] {
  if (prev.some((m) => m.id === local.id)) return prev;
  const newKey = local.mediaKey ?? '';
  const newContent = local.content ?? '';
  const tempIdx = prev.findIndex((m) => {
    if (typeof m.id !== 'number' || m.id >= 0) return false;
    if (m.senderId !== local.senderId) return false;
    if (newKey && m.mediaKey === newKey) return true;
    return (m.content ?? '') === newContent;
  });
  if (tempIdx >= 0) {
    const next = [...prev];
    const merged = { ...local };
    if (!merged.mediaUrl && prev[tempIdx].mediaUrl) merged.mediaUrl = prev[tempIdx].mediaUrl;
    next[tempIdx] = merged;
    return next;
  }
  return [...prev, local];
}

/* ────────────────────────────────────────────────────────── */
/* Speaking detector — shared AudioContext                    */
/* ────────────────────────────────────────────────────────── */

let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      sharedAudioCtx = new Ctor();
    }
    if (sharedAudioCtx.state === 'suspended') void sharedAudioCtx.resume();
    return sharedAudioCtx;
  } catch { return null; }
}

function useSpeakingDetector(stream: MediaStream | null | undefined): boolean {
  const [speaking, setSpeaking] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastSpokeRef = useRef<number>(0);
  const speakingRef = useRef(false);

  useEffect(() => {
    if (!stream) {
      speakingRef.current = false;
      setSpeaking(false);
      return;
    }
    const ctx = getAudioCtx();
    if (!ctx) return;

    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
    } catch {
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      try {
        analyser.getByteTimeDomainData(data);
      } catch {
        return;
      }
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > SPEAKING_THRESHOLD) {
        lastSpokeRef.current = now;
        if (!speakingRef.current) { speakingRef.current = true; setSpeaking(true); }
      } else if (speakingRef.current && now - lastSpokeRef.current > SPEAKING_HOLD_MS) {
        speakingRef.current = false;
        setSpeaking(false);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      try { source.disconnect(); } catch { /* noop */ }
      try { analyser.disconnect(); } catch { /* noop */ }
    };
  }, [stream]);

  return speaking;
}

/* ────────────────────────────────────────────────────────── */
/* Group avatar                                               */
/* ────────────────────────────────────────────────────────── */

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES: Array<[string, string, string]> = [
  ['#FB923C', '#EA580C', '#FEF3C7'],
  ['#34D399', '#059669', '#ECFDF5'],
  ['#60A5FA', '#4F46E5', '#E0E7FF'],
  ['#A78BFA', '#DB2777', '#FCE7F3'],
  ['#C084FC', '#7C3AED', '#EDE9FE'],
  ['#2DD4BF', '#0F766E', '#CCFBF1'],
  ['#F87171', '#B91C1C', '#FEE2E2'],
  ['#A3E635', '#65A30D', '#F7FEE7'],
  ['#FB7185', '#BE123C', '#FFE4E6'],
  ['#38BDF8', '#0284C7', '#E0F2FE'],
  ['#FBBF24', '#B45309', '#FEF3C7'],
  ['#4ADE80', '#047857', '#DCFCE7'],
];

type ShapeKind = 'orb' | 'ring' | 'tri' | 'wave';
const SHAPES: ShapeKind[] = ['orb', 'ring', 'tri', 'wave'];

function initialsOf(name: string): string {
  const clean = name.trim().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '#';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface GroupAvatarProps {
  name: string;
  groupId: number | string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  rounded?: 'full' | 'lg';
}

function GroupAvatar({ name, groupId, src, size = 'md', rounded = 'lg' }: GroupAvatarProps) {
  if (src) return <Avatar name={name} src={src} size={size === 'xl' ? 'lg' : size} />;

  const seed = hash32(`${groupId}:${name}`);
  const rand = mulberry32(seed);
  const [c1, c2, c3] = PALETTES[seed % PALETTES.length];
  const shape = SHAPES[(seed >>> 3) % SHAPES.length];
  const initials = initialsOf(name);

  const px = size === 'sm' ? 32 : size === 'md' ? 36 : size === 'lg' ? 56 : 72;
  const radius = rounded === 'full' ? px / 2 : Math.max(8, px * 0.3);
  const viewRadius = radius * (100 / px);
  const fontSize = initials.length >= 2 ? px * 0.36 : px * 0.44;

  const rot = Math.floor(rand() * 360);
  const offX = (rand() - 0.5) * 0.22;
  const offY = (rand() - 0.5) * 0.22;
  const uid = `ga-${seed.toString(36)}`;

  const sizeClass =
    size === 'sm' ? 'w-8 h-8' :
    size === 'md' ? 'w-9 h-9' :
    size === 'lg' ? 'w-14 h-14' :
    'w-[72px] h-[72px]';

  return (
    <span className={`inline-block shrink-0 select-none ${sizeClass}`} aria-hidden>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`${uid}-base`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
          <radialGradient id={`${uid}-halo`} cx="0.3" cy="0.15" r="0.85">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-orb1`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={c3} stopOpacity="0.85" />
            <stop offset="100%" stopColor={c3} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-orb2`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${uid}-clip`}>
            <rect x="0" y="0" width="100" height="100" rx={viewRadius} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${uid}-clip)`}>
          <rect x="0" y="0" width="100" height="100" fill={`url(#${uid}-base)`} />
          <circle cx={50 + offX * 80} cy={50 + offY * 80} r={38 + rand() * 18} fill={`url(#${uid}-orb1)`} />
          <circle cx={50 - offX * 70} cy={50 - offY * 55} r={24 + rand() * 14} fill={`url(#${uid}-orb2)`} />

          {shape === 'orb' && (<circle cx="50" cy="50" r="36" fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1.5" />)}
          {shape === 'ring' && (<circle cx={50 + offX * 20} cy={50 + offY * 20} r="34" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="2" />)}
          {shape === 'tri' && (<g transform={`rotate(${rot} 50 50)`}><polygon points="50,16 84,78 16,78" fill="#ffffff" fillOpacity="0.09" /></g>)}
          {shape === 'wave' && (
            <g transform={`rotate(${rot} 50 50)`}>
              <path d="M 8 60 Q 25 42 50 52 T 92 42" fill="none" stroke="#ffffff" strokeOpacity="0.15" strokeWidth="2" />
              <path d="M 8 70 Q 25 52 50 62 T 92 52" fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="2" />
            </g>
          )}

          <rect x="0" y="0" width="100" height="100" fill={`url(#${uid}-halo)`} />
          <rect x="0.5" y="0.5" width="99" height="99" rx={Math.max(0, viewRadius - 0.5)} fill="none"
            stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1" />
        </g>

        <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
          fontSize={fontSize * (100 / px)} fontWeight={800} fill="#ffffff"
          style={{
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            letterSpacing: initials.length > 1 ? '-0.03em' : '0',
            paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.22)', strokeWidth: 0.8,
          }}>
          {initials}
        </text>
      </svg>
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

function getMessageTime(m: GroupMessageDto): number { return parseUtc(m.sentAt).getTime(); }

function autoGrow(el: HTMLTextAreaElement, max = 140) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

function messageSnippet(m: GroupMessageDto): string {
  if (m.content) return m.content;
  if (m.mediaType === MediaType.Image) return '📷 Photo';
  if (m.mediaType === MediaType.Audio) return '🎤 Voice message';
  if (m.mediaType === MediaType.Video) return '🎥 Video';
  if (m.mediaType === MediaType.File) return '📎 File';
  return 'Attachment';
}

function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function safePlayReceive() { try { playReceive(); } catch (err) { console.warn('[sounds] receive failed', err); } }
function safePlaySend() { try { playSend(); } catch (err) { console.warn('[sounds] send failed', err); } }

/* ────────────────────────────────────────────────────────── */
/* Local persistence                                          */
/* ────────────────────────────────────────────────────────── */

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

function pinnedKey(u?: string) { return `orbital.groupPinned.${u ?? 'anon'}`; }
function mutedKey(u?: string) { return `orbital.groupMuted.${u ?? 'anon'}`; }
function reactionsKey(u?: string, g?: number) { return `orbital.groupReactions.${u ?? 'anon'}.${g ?? 'none'}`; }
function hiddenKey(u?: string, g?: number) { return `orbital.groupHidden.${u ?? 'anon'}.${g ?? 'none'}`; }
function localMuteKey(u?: string) { return `orbital.callMutedUsers.${u ?? 'anon'}`; }

function readPinned(u?: string): Set<string> { return new Set(lsGet<string[]>(pinnedKey(u), [])); }
function writePinned(u: string | undefined, s: Set<string>) { lsSet(pinnedKey(u), Array.from(s)); }
function readMuted(u?: string): Set<string> { return new Set(lsGet<string[]>(mutedKey(u), [])); }
function writeMuted(u: string | undefined, s: Set<string>) { lsSet(mutedKey(u), Array.from(s)); }
function readHidden(u?: string, g?: number): Set<number> { return new Set(lsGet<number[]>(hiddenKey(u, g), [])); }
function writeHidden(u: string | undefined, g: number | undefined, s: Set<number>) { lsSet(hiddenKey(u, g), Array.from(s)); }
function readLocalMute(u?: string): Set<string> { return new Set(lsGet<string[]>(localMuteKey(u), [])); }
function writeLocalMute(u: string | undefined, s: Set<string>) { lsSet(localMuteKey(u), Array.from(s)); }

interface ReactionEntry { emoji: string; userId: string; }
function readReactions(u?: string, g?: number): Record<string, ReactionEntry[]> {
  return lsGet<Record<string, ReactionEntry[]>>(reactionsKey(u, g), {});
}
function writeReactions(u: string | undefined, g: number | undefined, d: Record<string, ReactionEntry[]>) {
  lsSet(reactionsKey(u, g), d);
}

function applyReactionEvents(
  prev: Record<string, ReactionEntry[]>,
  events: Array<{ messageId: number; emoji: string; action: 'add' | 'remove'; userId: string }>,
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

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];
const EMPTY_REACTIONS: ReactionEntry[] = [];

/* ────────────────────────────────────────────────────────── */
/* Audio bubble                                               */
/* ────────────────────────────────────────────────────────── */

const WAVE_BARS = Array.from({ length: 24 }).map((_, i) =>
  Math.max(4, Math.min(24, 18 + Math.sin(i * 0.7) * 10 + (i % 3) * 4)),
);

function VoiceBubble({ url, isMe }: { url: string; isMe: boolean }) {
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
    try { if (playing) { a.pause(); setPlaying(false); } else { void a.play(); setPlaying(true); } }
    catch (err) { console.warn('[voice] playback failed', err); }
  };
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <div className="inline-flex items-center gap-3 min-w-[220px] max-w-[280px] select-none">
      <button type="button" onClick={toggle}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
          isMe ? 'bg-black/[0.18] text-[#0F0D0A]' : 'bg-white/[0.08] text-[#EDE5D4]'
        }`}>
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
            <span key={i} className="w-[2.5px] rounded-full"
              style={{ height: `${h}px`, background: 'currentColor', opacity: (i / 24) * 100 <= pct ? 1 : 0.3 }} />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10.5px] font-medium tabular-nums opacity-80">{playing || progress > 0 ? formatDuration(progress) : '0:00'}</span>
          <span className="text-[10.5px] font-medium tabular-nums opacity-80">{duration > 0 ? formatDuration(duration) : '–:––'}</span>
        </div>
      </div>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Inline voice recorder                                      */
/* ────────────────────────────────────────────────────────── */

const BAR_COUNT = 40;

function InlineVoiceRecorder({ onCancel, onSend, busy }: {
  onCancel: () => void;
  onSend: (blob: Blob, durationMs: number) => Promise<void>;
  busy: boolean;
}) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(2));
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    stoppedRef.current = false;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Recording not supported in this browser.');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];
        const mimeType = typeof MediaRecorder !== 'undefined'
          ? candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
          : '';
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.start(250);
        startRef.current = Date.now();

        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.6;
          src.connect(analyser);
          analyserRef.current = analyser;
          const data = new Uint8Array(analyser.frequencyBinCount);
          const draw = () => {
            const a = analyserRef.current;
            if (!a) return;
            a.getByteFrequencyData(data);
            const step = Math.floor(data.length / BAR_COUNT);
            const next: number[] = new Array(BAR_COUNT);
            for (let i = 0; i < BAR_COUNT; i++) {
              let sum = 0;
              for (let j = 0; j < step; j++) sum += data[i * step + j];
              const avg = sum / step;
              next[i] = Math.max(2, Math.min(34, Math.round(avg / 7)));
            }
            setLevels(next);
            rafRef.current = requestAnimationFrame(draw);
          };
          rafRef.current = requestAnimationFrame(draw);
        }
        tickRef.current = window.setInterval(() => {
          const ms = Date.now() - startRef.current;
          setElapsedMs(ms);
          if (ms >= MAX_RECORD_MS) stopAndSend();
        }, 100);
      } catch (err) {
        const msg =
          err instanceof Error && err.name === 'NotAllowedError' ? 'Microphone permission denied. Enable it in your browser settings.'
          : err instanceof Error && err.name === 'NotFoundError' ? 'No microphone found.'
          : extractErrorMessage(err, 'Could not start recording.');
        setError(msg);
      }
    };
    void start();
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (tickRef.current != null) window.clearInterval(tickRef.current);
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* noop */ } }
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== 'closed') void ctx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAndSend = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    if (tickRef.current != null) { window.clearInterval(tickRef.current); tickRef.current = null; }
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    const durationMs = Date.now() - startRef.current;
    await new Promise<void>((resolve) => {
      const onStop = () => { resolve(); rec.removeEventListener('stop', onStop); };
      rec.addEventListener('stop', onStop);
      try { rec.stop(); } catch { resolve(); }
    });
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') void ctx.close();
    const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
    if (durationMs < 700 || blob.size < 512) { setError('Recording too short — hold the mic a bit longer.'); stoppedRef.current = false; return; }
    if (blob.size > MAX_FILE_SIZE) { setError(`Recording is ${(blob.size / 1024 / 1024).toFixed(1)}MB — max is 25MB.`); stoppedRef.current = false; return; }
    setSending(true);
    try { await onSend(blob, durationMs); }
    catch (err) { setError(extractErrorMessage(err, 'Could not send voice message.')); setSending(false); stoppedRef.current = false; }
  }, [onSend]);

  const cancel = useCallback(() => {
    stoppedRef.current = true;
    if (tickRef.current != null) { window.clearInterval(tickRef.current); tickRef.current = null; }
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* noop */ } }
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') void ctx.close();
    onCancel();
  }, [onCancel]);

  const disabled = busy || sending;
  const remaining = Math.max(0, MAX_RECORD_MS - elapsedMs);

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <button type="button" onClick={cancel} disabled={disabled}
        className="shrink-0 w-10 h-10 rounded-full bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-50 text-[#EDE5D4] flex items-center justify-center">
        <X className="w-[18px] h-[18px]" />
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-3 h-[44px] px-3 rounded-[22px] bg-[#1A1816] border border-[#EF4444]/40">
        <span className="relative shrink-0 flex w-3 h-3">
          <span className="absolute inset-0 rounded-full bg-[#EF4444] opacity-40 animate-ping" />
          <span className="relative inline-flex w-3 h-3 rounded-full bg-[#EF4444]" />
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-[2px] h-7">
          {levels.map((h, i) => {
            const age = (BAR_COUNT - 1 - i) / BAR_COUNT;
            const opacity = 0.55 + (1 - age) * 0.45;
            return <span key={i} className="flex-1 rounded-full bg-[#EF4444]" style={{ height: `${h}px`, opacity, transition: 'height 80ms linear' }} />;
          })}
        </div>
        <span className="shrink-0 tabular-nums text-[12.5px] font-semibold text-[#EDE5D4] min-w-[42px] text-right">
          {formatDuration(elapsedMs / 1000)}
        </span>
      </div>
      <button type="button" onClick={() => void stopAndSend()} disabled={disabled || elapsedMs < 700}
        className="shrink-0 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] disabled:opacity-40 text-[#0F0D0A] flex items-center justify-center">
        {sending || busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Send className="w-[18px] h-[18px]" />}
      </button>
      {error && (
        <div className="absolute left-0 right-0 top-full mt-2 px-3 py-1.5 rounded-lg bg-[#B91C1C]/[0.12] border border-[#B91C1C]/30 text-[11.5px] text-[#F87171] flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
          <button type="button" onClick={cancel} className="ml-auto shrink-0 underline">Dismiss</button>
        </div>
      )}
      {!error && remaining < 30_000 && (
        <div className="absolute left-0 right-0 top-full mt-2 px-3 py-1 text-[11px] text-[#F59E0B] text-center">
          Auto-sends in {Math.ceil(remaining / 1000)}s
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Message row                                                */
/* ────────────────────────────────────────────────────────── */

interface GroupMessageItemProps {
  message: GroupMessageDto;
  isMe: boolean;
  grouped: boolean;
  isLastOfGroup: boolean;
  highlighted: boolean;
  reactions: ReactionEntry[];
  currentUserId: string | undefined;
  replyTarget: GroupMessageDto | null;
  onRequestProfile: (userId: string) => void;
  onOpenMenu: (m: GroupMessageDto) => void;
  onStartReply: (m: GroupMessageDto) => void;
  onReact: (messageId: number, emoji: string) => void;
  onJumpToReply: (id: number) => void;
}

const GroupMessageItem = React.memo(function GroupMessageItem({
  message, isMe, grouped, isLastOfGroup, highlighted, reactions, currentUserId, replyTarget,
  onRequestProfile, onOpenMenu, onStartReply, onReact, onJumpToReply,
}: GroupMessageItemProps): React.JSX.Element {
  const hasMedia = Boolean(message.mediaUrl);
  const isVoice = message.mediaType === MediaType.Audio && !!message.mediaUrl;
  const canAct = typeof message.id === 'number' && message.id > 0;

  const innerRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef(0);
  const longPressRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipingRef = useRef(false);

  const applySwipe = (x: number) => {
    swipeRef.current = x;
    const el = innerRef.current;
    if (el) { el.style.transform = x > 0 ? `translateX(${x}px)` : ''; el.style.transition = x === 0 ? 'transform 120ms ease-out' : 'none'; }
    if (iconRef.current) iconRef.current.style.opacity = String(Math.min(1, x / 60));
  };

  const clearLongPress = () => { if (longPressRef.current) { window.clearTimeout(longPressRef.current); longPressRef.current = null; } };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    swipingRef.current = false;
    longPressRef.current = window.setTimeout(() => {
      if (!swipingRef.current) { onOpenMenu(message); if (navigator.vibrate) navigator.vibrate(10); }
    }, 420);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    if (Math.abs(dy) > 15 && !swipingRef.current) { clearLongPress(); return; }
    if (!swipingRef.current && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { swipingRef.current = true; clearLongPress(); }
    if (swipingRef.current) applySwipe(Math.max(0, Math.min(80, dx)));
  };
  const onTouchEnd = () => {
    clearLongPress();
    if (swipingRef.current && swipeRef.current > 55) { onStartReply(message); if (navigator.vibrate) navigator.vibrate(15); }
    if (swipeRef.current !== 0) applySwipe(0);
    swipingRef.current = false;
    touchStartRef.current = null;
  };

  const tailClass = isLastOfGroup ? (isMe ? 'rounded-br-md' : 'rounded-bl-md') : '';

  const groupedReactions = useMemo(() => {
    const map = new Map<string, ReactionEntry[]>();
    for (const r of reactions) { const arr = map.get(r.emoji) ?? []; arr.push(r); map.set(r.emoji, arr); }
    return Array.from(map.entries());
  }, [reactions]);

  const myReactions = useMemo(
    () => new Set(reactions.filter((r) => r.userId === currentUserId).map((r) => r.emoji)),
    [reactions, currentUserId],
  );

  return (
    <div className={`group/row relative flex gap-3 px-1 ${grouped ? 'mt-0.5' : 'mt-5'} ${isMe ? 'flex-row-reverse' : 'flex-row'} ${highlighted ? 'ring-2 ring-[#D97706]/60 rounded-2xl' : ''}`}>
      <div ref={iconRef} className={`absolute inset-y-0 flex items-center pointer-events-none ${isMe ? 'right-0' : 'left-0'}`} style={{ opacity: 0 }}>
        <div className="w-9 h-9 rounded-full bg-[#D97706]/[0.18] border border-[#D97706]/50 flex items-center justify-center">
          <Reply className="w-4 h-4 text-[#F59E0B]" />
        </div>
      </div>

      <div className="w-9 shrink-0 pt-0.5">
        {!grouped ? (
          <button type="button" onClick={() => { if (isMe) return; onRequestProfile(message.senderId); }}
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50"
            aria-label={`View ${message.senderDisplayName}'s profile`}>
            <Avatar name={message.senderDisplayName || 'User'} src={message.senderAvatarUrl} size="sm" />
          </button>
        ) : (<span className="block w-8 h-8" aria-hidden />)}
      </div>

      <div ref={innerRef} className={`relative flex flex-col min-w-0 max-w-[85%] sm:max-w-[75%] md:max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
        onContextMenu={(e) => { e.preventDefault(); onOpenMenu(message); }}>
        {!grouped && (
          <div className="flex items-baseline gap-2 mb-0.5 px-1">
            <span className="text-[12.5px] font-semibold text-[#EDE5D4] tracking-tight">{isMe ? 'You' : message.senderDisplayName}</span>
            <span className="text-[10.5px] text-[#6B6259] tabular-nums">{formatTime(message.sentAt)}</span>
          </div>
        )}

        {canAct && (
          <div className={`hidden sm:flex absolute -top-3 ${isMe ? 'right-0' : 'left-0'} items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity z-10`}>
            <div className="flex items-center gap-0.5 rounded-full bg-[#1C1A17] border border-white/[0.08] shadow-[0_4px_14px_-2px_rgba(0,0,0,0.6)] px-1 py-0.5">
              {QUICK_REACT_EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => onReact(message.id as number, e)} title={`React ${e}`}
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[15px] leading-none transition-colors ${myReactions.has(e) ? 'bg-[#D97706]/[0.18]' : 'hover:bg-white/[0.08]'}`}>
                  {e}
                </button>
              ))}
              <span className="w-px h-4 bg-white/[0.08] mx-0.5" aria-hidden />
              <button type="button" onClick={() => onStartReply(message)} title="Reply"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#A8A29E] hover:bg-white/[0.08] transition-colors">
                <Reply className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => onOpenMenu(message)} title="More"
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#A8A29E] hover:bg-white/[0.08] transition-colors">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div id={`msg-${message.id}`}
          className={`inline-block max-w-full px-3 py-1.5 text-[13.5px] leading-[1.55] break-words rounded-2xl ${tailClass} ${
            isMe ? 'bg-[#D97706] text-[#0F0D0A] font-medium' : 'bg-[#1A1816] text-[#EDE5D4] border border-white/[0.04]'
          }`}>
          {replyTarget && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); if (typeof replyTarget.id === 'number' && replyTarget.id > 0) onJumpToReply(replyTarget.id); }}
              className={`w-full text-left mb-2 rounded-lg border-l-[3px] pl-2 pr-2 py-1 text-[11.5px] transition-opacity hover:opacity-80 ${
                isMe ? 'bg-black/[0.15] border-black/40 text-[#0F0D0A]/80' : 'bg-white/[0.05] border-[#D97706] text-[#EDE5D4]/80'
              }`}>
              <p className="font-semibold truncate">{replyTarget.senderDisplayName || 'User'}</p>
              <p className="truncate opacity-85">{messageSnippet(replyTarget)}</p>
            </button>
          )}

          {isVoice && <VoiceBubble url={message.mediaUrl as string} isMe={isMe} />}

          {hasMedia && !isVoice && (
            <div className="mb-2 -mx-1">
              {message.mediaType === MediaType.Image && (<img src={message.mediaUrl ?? undefined} alt="Attachment" className="rounded-xl max-h-72 w-auto object-cover" />)}
              {message.mediaType === MediaType.Video && (<video src={message.mediaUrl ?? undefined} controls className="rounded-xl max-h-72 w-full bg-black" />)}
              {message.mediaType === MediaType.File && (
                <a href={message.mediaUrl ?? undefined} target="_blank" rel="noreferrer" download
                  className={`inline-flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[12px] ${
                    isMe ? 'bg-black/10 border-black/15 text-[#0F0D0A]' : 'bg-white/[0.04] border-white/[0.08] text-[#EDE5D4]'
                  }`}>
                  <FileText className="w-4 h-4 shrink-0" />
                  <span className="truncate max-w-[180px]">Download attachment</span>
                  <Download className="w-3.5 h-3.5 shrink-0 ml-1" />
                </a>
              )}
            </div>
          )}

          {message.content && (<p className={`whitespace-pre-wrap ${hasMedia ? 'mt-1.5' : ''}`}>{message.content}</p>)}
        </div>

        {groupedReactions.length > 0 && (
          <div className={`flex items-center gap-1.5 mt-1.5 px-1 flex-wrap ${isMe ? 'justify-end' : 'justify-start'}`}>
            {groupedReactions.map(([emoji, entries]) => {
              const mine = entries.some((e) => e.userId === currentUserId);
              return (
                <button key={emoji} onClick={() => { if (canAct) onReact(message.id as number, emoji); }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium border transition-colors ${
                    mine ? 'bg-[#D97706]/[0.18] border-[#D97706]/50 text-[#F59E0B]' : 'bg-white/[0.06] border-white/[0.10] text-[#EDE5D4] hover:bg-white/[0.1]'
                  }`}>
                  <span className="text-[13px] leading-none">{emoji}</span>
                  {entries.length > 1 && (<span className="tabular-nums text-[11px] opacity-90 font-semibold">{entries.length}</span>)}
                </button>
              );
            })}
          </div>
        )}

        {isMe && isLastOfGroup && (
          <div className="flex items-center gap-1 mt-1 px-1 select-none">
            <span className="text-[10px] text-[#6B6259] tabular-nums">{formatTime(message.sentAt)}</span>
            <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.mediaUrl === next.message.mediaUrl &&
  prev.message.mediaType === next.message.mediaType &&
  prev.message.sentAt === next.message.sentAt &&
  prev.message.senderDisplayName === next.message.senderDisplayName &&
  prev.message.senderAvatarUrl === next.message.senderAvatarUrl &&
  prev.grouped === next.grouped &&
  prev.isLastOfGroup === next.isLastOfGroup &&
  prev.highlighted === next.highlighted &&
  prev.reactions === next.reactions &&
  prev.replyTarget === next.replyTarget &&
  prev.isMe === next.isMe
);

/* ────────────────────────────────────────────────────────── */
/* Message menu                                               */
/* ────────────────────────────────────────────────────────── */

function MessageMenu({
  message, isMe, reactions, currentUserId,
  onClose, onReact, onReply, onCopy, onDeleteForMe, onDeleteForEveryone,
}: {
  message: GroupMessageDto;
  isMe: boolean;
  reactions: ReactionEntry[];
  currentUserId: string | undefined;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
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
    <div className="fixed inset-0 z-[170] bg-black/65 flex items-center justify-center p-4" onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[340px] flex flex-col gap-2.5 max-h-full overflow-y-auto">
        {canAct && (
          <div className={`${side} flex items-center gap-0.5 px-2 py-1.5 rounded-full bg-[#1C1A17] border border-white/[0.1] shadow-2xl`}>
            {QUICK_REACTIONS.map((e) => (
              <button key={e} onClick={run(() => onReact(e))}
                className={`w-10 h-10 rounded-full flex items-center justify-center text-[22px] hover:bg-white/[0.1] active:bg-white/[0.16] transition-colors ${mine.has(e) ? 'bg-white/[0.14]' : ''}`}>
                {e}
              </button>
            ))}
          </div>
        )}
        <div className={`${side} max-w-[85%] rounded-[20px] px-4 py-2 text-[14px] leading-[1.45] shadow-lg ${
          isMe ? 'bg-[#D97706] text-[#0F0D0A]' : 'bg-[#1A1816] text-[#EDE5D4] border border-white/[0.06]'
        }`}>
          <p className="line-clamp-4 whitespace-pre-wrap break-words">{messageSnippet(message)}</p>
        </div>
        <div className={`${side} w-[250px] rounded-2xl bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden`}>
          {canAct && (<button onClick={run(onReply)} className={itemCls}><Reply className="w-4 h-4 text-[#A8A29E]" /><span>Reply</span></button>)}
          {text && (<button onClick={run(onCopy)} className={itemCls}><Copy className="w-4 h-4 text-[#A8A29E]" /><span>Copy text</span></button>)}
          {canAct && (<button onClick={run(onDeleteForMe)} className={`${itemCls} border-t border-white/[0.05]`}><EyeOff className="w-4 h-4 text-[#A8A29E]" /><span>Delete for me</span></button>)}
          {canAct && isMe && (
            <button onClick={run(onDeleteForEveryone)} className="w-full flex items-center gap-3 px-4 py-3 text-[13.5px] font-medium text-left text-[#F87171] hover:bg-[#B91C1C]/[0.12] active:bg-[#B91C1C]/[0.2]">
              <Trash2 className="w-4 h-4" /><span>Delete for everyone</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Sidebar context menu                                       */
/* ────────────────────────────────────────────────────────── */

function GroupContextMenu({
  group, isPinned, isMuted, onClose, onPin, onMute, onMarkRead, onClearChat, onLeave, onDelete,
}: {
  group: GroupDto; isPinned: boolean; isMuted: boolean; onClose: () => void;
  onPin: () => void; onMute: () => void; onMarkRead: () => void; onClearChat: () => void; onLeave: () => void; onDelete: () => void;
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
    <div className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-xs rounded-t-[22px] sm:rounded-[22px] bg-[#1C1A17] border-t sm:border border-white/[0.08] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
          <GroupAvatar name={group.name} groupId={group.id} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#EDE5D4] truncate tracking-tight">{group.name}</p>
            <p className="text-[11.5px] text-[#7A6F65] truncate mt-0.5">{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[#7A6F65] hover:bg-white/[0.05]"><X className="w-4 h-4" /></button>
        </div>
        <div className="py-1.5 max-h-[60vh] overflow-y-auto">
          {actions.map((a) => (
            <button key={a.key} onClick={() => { a.onClick(); onClose(); }}
              className={`w-full flex items-center gap-3 px-5 py-3 text-[13px] font-medium text-left transition-colors ${
                a.danger ? 'text-[#F87171] hover:bg-[#B91C1C]/[0.10]' : 'text-[#EDE5D4] hover:bg-white/[0.04]'
              }`}>
              <span className="shrink-0 opacity-80">{a.icon}</span><span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  open, group, currentUserId, onClose, onLeave, onDelete, onRemoveMember, onAddMember, onViewProfile,
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
    apiService.getFriends().then((data) => { if (active) setFriends(data); })
      .catch(() => { if (active) setFriends([]); })
      .finally(() => { if (active) setLoadingFriends(false); });
    return () => { active = false; };
  }, [isAddingMember, friends.length]);

  const reset = () => {
    setConfirmAction(null); setPendingRemoveId(null); setIsAddingMember(false);
    setFriendQuery(''); setError(null); setBusy(false);
  };
  const handleClose = () => { if (busy) return; reset(); onClose(); };

  const runAddMember = async (userId: string) => {
    if (!userId) { setError('Could not resolve that friend to a user ID.'); return; }
    setBusy(true); setError(null);
    try { await onAddMember(userId); setIsAddingMember(false); setFriendQuery(''); }
    catch (err) { setError(extractErrorMessage(err, 'Failed to add member.')); }
    finally { setBusy(false); }
  };
  const runLeave = async () => { setBusy(true); setError(null); try { await onLeave(); reset(); onClose(); } catch (err) { setError(extractErrorMessage(err, 'Failed to leave group.')); setBusy(false); } };
  const runDelete = async () => { setBusy(true); setError(null); try { await onDelete(); reset(); onClose(); } catch (err) { setError(extractErrorMessage(err, 'Failed to delete group.')); setBusy(false); } };
  const runRemoveMember = async (userId: string) => {
    setBusy(true); setError(null);
    try { await onRemoveMember(userId); setPendingRemoveId(null); }
    catch (err) { setError(extractErrorMessage(err, 'Failed to remove member.')); }
    finally { setBusy(false); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={handleClose}>
          <motion.div initial={{ scale: 0.96, opacity: 0, y: 6 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <GroupAvatar name={group.name} groupId={group.id} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-[#EDE5D4] tracking-tight truncate">{group.name}</p>
                  <p className="text-[12px] text-[#6B6259] truncate mt-0.5">{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</p>
                </div>
              </div>
              {group.description && (<p className="text-[12.5px] text-[#A8A29E] leading-relaxed mt-3">{group.description}</p>)}
            </div>

            {!confirmAction && !pendingRemoveId ? (
              <>
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#6B6259] font-medium">Members ({group.members?.length ?? 0})</p>
                  {isCreator && (
                    <button onClick={() => { setIsAddingMember((prev) => !prev); setError(null); }}
                      className="text-[12px] text-[#D97706] hover:text-[#F59E0B] font-medium inline-flex items-center gap-1 transition-colors">
                      <Plus className="w-3.5 h-3.5" /><span>Add Member</span>
                    </button>
                  )}
                </div>

                {isAddingMember && (
                  <div className="border-b border-white/[0.06] bg-black/20">
                    <div className="p-3 flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0F0D0A] border border-white/[0.08] focus-within:border-[#D97706]/50 transition-colors">
                        <Search className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
                        <input type="text" autoFocus value={friendQuery} onChange={(e) => setFriendQuery(e.target.value)}
                          placeholder="Search friends by @handle or name..."
                          className="flex-1 bg-transparent text-[12.5px] text-[#EDE5D4] placeholder-[#6B6259] outline-none" />
                      </div>
                      <button type="button" onClick={() => { setIsAddingMember(false); setFriendQuery(''); setError(null); }}
                        className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-[#EDE5D4] transition-colors">Cancel</button>
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-white/[0.04] border-t border-white/[0.04]">
                      {loadingFriends ? (
                        <div className="px-5 py-4 text-center text-[12px] text-[#6B6259] flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97706]" />Loading friends…
                        </div>
                      ) : friends.length === 0 ? (
                        <div className="px-5 py-4 text-center text-[12px] text-[#6B6259]">You have no friends yet.</div>
                      ) : (
                        (() => {
                          const memberIds = new Set((group.members ?? []).map((m) => m.id));
                          const q = friendQuery.trim().replace(/^@/, '').toLowerCase();
                          const candidates = friends.filter((f) => {
                            if (memberIds.has(f.userId)) return false;
                            if (!q) return true;
                            return f.handle.toLowerCase().includes(q) || f.displayName.toLowerCase().includes(q);
                          });
                          if (candidates.length === 0) {
                            return (<div className="px-5 py-4 text-center text-[12px] text-[#6B6259]">{friendQuery.trim() ? 'No matching friends.' : 'All your friends are already in this group.'}</div>);
                          }
                          return candidates.map((f) => (
                            <button key={f.friendshipId} type="button" disabled={busy} onClick={() => void runAddMember(f.userId)}
                              className="w-full px-5 py-2.5 flex items-center gap-3 hover:bg-white/[0.04] disabled:opacity-50 transition-colors text-left">
                              <Avatar name={f.displayName} src={f.avatarUrl} size="sm" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] text-[#EDE5D4] truncate">{f.displayName}</p>
                                <p className="text-[11px] text-[#6B6259] truncate mt-0.5">@{f.handle}</p>
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
                        <button type="button" onClick={() => onViewProfile(m.id)}
                          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50 shrink-0"
                          aria-label={`View ${m.displayName}'s profile`}>
                          <Avatar name={m.displayName} src={m.avatarUrl} size="sm" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-[#EDE5D4] truncate">
                            {m.displayName}{isMe && <span className="text-[11px] text-[#6B6259] ml-1.5">(you)</span>}
                          </p>
                          <p className="text-[11px] text-[#6B6259] truncate mt-0.5">@{m.userHandle}</p>
                        </div>
                        {isCreator && !isMe && (
                          <button onClick={() => setPendingRemoveId(m.id)}
                            className="shrink-0 p-1.5 rounded-md text-[#A8A29E] hover:text-[#B91C1C] hover:bg-[#B91C1C]/[0.10] transition-colors" title="Remove member">
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                  <button onClick={() => setConfirmAction('leave')} className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#EDE5D4] hover:bg-white/[0.04] transition-colors text-left">
                    <LogOut className="w-4 h-4 text-[#A8A29E] shrink-0" /><span>Leave group</span>
                  </button>
                  {isCreator && (
                    <button onClick={() => setConfirmAction('delete')} className="w-full flex items-center gap-3 px-5 py-3.5 text-[13px] text-[#F87171] hover:bg-[#B91C1C]/[0.08] transition-colors text-left">
                      <Trash2 className="w-4 h-4 shrink-0" /><span>Delete group (creator only)</span>
                    </button>
                  )}
                </div>

                {error && (<div className="px-5 py-3 border-t border-white/[0.06]"><p className="text-[12px] text-[#F87171] flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" /><span>{error}</span></p></div>)}

                <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end">
                  <button onClick={handleClose} className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors">Close</button>
                </div>
              </>
            ) : confirmAction ? (
              <div className="p-5">
                <h3 className="text-[14px] font-semibold text-[#EDE5D4] mb-1.5">{confirmAction === 'leave' ? 'Leave group?' : 'Delete group?'}</h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                  {confirmAction === 'leave'
                    ? `You'll be removed from ${group.name}. ${isCreator && group.memberCount > 1 ? 'Ownership will transfer to another member.' : 'If you are the last member, the group will be deleted.'}`
                    : `${group.name} and all its messages will be permanently deleted for everyone. This cannot be undone.`}
                </p>
                {error && (<p className="mt-3 text-[12px] text-[#F87171] flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" /><span>{error}</span></p>)}
              </div>
            ) : (
              <div className="p-5">
                <h3 className="text-[14px] font-semibold text-[#EDE5D4] mb-1.5">Remove member?</h3>
                <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">They will be removed from {group.name} and will not see future messages.</p>
                {error && (<p className="mt-3 text-[12px] text-[#F87171] flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" /><span>{error}</span></p>)}
              </div>
            )}

            {(confirmAction || pendingRemoveId) && (
              <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
                <button onClick={() => { setConfirmAction(null); setPendingRemoveId(null); setError(null); }} disabled={busy}
                  className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-[12.5px] text-[#EDE5D4] transition-colors">Cancel</button>
                <button onClick={() => { if (confirmAction === 'leave') void runLeave(); else if (confirmAction === 'delete') void runDelete(); else if (pendingRemoveId) void runRemoveMember(pendingRemoveId); }} disabled={busy}
                  className="h-9 px-4 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{busy ? 'Working…' : confirmAction === 'leave' ? 'Leave' : confirmAction === 'delete' ? 'Delete' : 'Remove'}</span>
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
/* Attach panel                                               */
/* ────────────────────────────────────────────────────────── */

function GroupAttachPanel({ onPhoto, onCamera, onDocument, onAudio }: {
  onPhoto: () => void; onCamera: () => void; onDocument: () => void; onAudio: () => void;
}) {
  const items = [
    { key: 'photo', label: 'Gallery', icon: <ImageIcon className="w-6 h-6" />, color: 'from-[#7C3AED] to-[#A855F7]', onClick: onPhoto },
    { key: 'camera', label: 'Camera', icon: <Camera className="w-6 h-6" />, color: 'from-[#EF4444] to-[#F97316]', onClick: onCamera },
    { key: 'doc', label: 'Document', icon: <FileText className="w-6 h-6" />, color: 'from-[#2563EB] to-[#3B82F6]', onClick: onDocument },
    { key: 'audio', label: 'Audio', icon: <Music className="w-6 h-6" />, color: 'from-[#F59E0B] to-[#F97316]', onClick: onAudio },
  ];
  return (
    <div className={`${PANEL_HEIGHT} border-t border-white/[0.06] overflow-y-auto p-5`}>
      <div className="grid grid-cols-4 gap-y-5 gap-x-2">
        {items.map((it) => (
          <button key={it.key} type="button" onClick={it.onClick} className="flex flex-col items-center gap-2 rounded-2xl py-1 hover:bg-white/[0.03] transition-colors">
            <span className={`w-14 h-14 rounded-full bg-gradient-to-br ${it.color} text-white flex items-center justify-center shadow-[0_4px_14px_-4px_rgba(0,0,0,0.5)]`}>{it.icon}</span>
            <span className="text-[11.5px] font-medium text-[#A8A29E]">{it.label}</span>
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

interface GroupComposerProps {
  groupId: number;
  targetName: string;
  replyTo: GroupMessageDto | null;
  onCancelReply: () => void;
  onSendText: (text: string, replyId: number | null) => Promise<void>;
  onSendFile: (file: File) => Promise<void>;
  onSendVoice: (blob: Blob, durationMs: number) => Promise<void>;
}

const GroupComposer = React.memo(function GroupComposer({
  groupId, targetName, replyTo, onCancelReply, onSendText, onSendFile, onSendVoice,
}: GroupComposerProps) {
  const { onType, stop: stopTyping } = useGroupTypingEmitter(groupId);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<PanelKind>('none');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (replyTo) { setPanel('none'); textareaRef.current?.focus(); }
  }, [replyTo]);

  const togglePanel = (kind: Exclude<PanelKind, 'none'>) => {
    if (panel === kind) { setPanel('none'); textareaRef.current?.focus(); }
    else { textareaRef.current?.blur(); setPanel(kind); }
  };

  const submitText = async () => {
    const t = text.trim();
    if (!t) return;
    stopTyping();
    const replyId = replyTo && typeof replyTo.id === 'number' && replyTo.id > 0 ? replyTo.id : null;
    setText(''); setFileError(null); setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try { await onSendText(t, replyId); onCancelReply(); }
    catch (err) { setText((cur) => cur || t); setFileError(extractErrorMessage(err)); }
    finally { setIsSending(false); }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setFileError(null);
    const validation = validateFileSize(file);
    if (!validation.valid) { setFileError('File size exceeds the 25 MB limit.'); input.value = ''; return; }
    setPanel('none'); setIsSending(true);
    try { await onSendFile(file); }
    catch (err) { setFileError(extractErrorMessage(err)); }
    finally { setIsSending(false); input.value = ''; }
  };

  const canSend = text.trim().length > 0;

  return (
    <div className="shrink-0 relative z-20">
      <div className="border-t border-white/[0.05] bg-[#0F0D0A]">
        <div className="px-2 sm:px-4 py-2.5">
          {voiceOpen ? (
            <div className="relative">
              <InlineVoiceRecorder busy={isSending} onCancel={() => setVoiceOpen(false)}
                onSend={async (blob, durationMs) => {
                  setIsSending(true);
                  try { await onSendVoice(blob, durationMs); setVoiceOpen(false); }
                  finally { setIsSending(false); }
                }} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {replyTo && (
                <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-white/[0.06] border-l-[3px] border-[#D97706]">
                  <CornerUpLeft className="w-3 h-3 text-[#D97706] shrink-0" />
                  <p className="flex-1 min-w-0 text-[12px] truncate font-medium text-[#EDE5D4]">
                    Replying to {replyTo.senderDisplayName || 'User'} · {messageSnippet(replyTo)}
                  </p>
                  <button type="button" onClick={onCancelReply}
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[#A8A29E] hover:bg-white/[0.06]" aria-label="Cancel reply">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              {fileError && (
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#F87171] px-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{fileError}</span>
                  <button type="button" onClick={() => setFileError(null)} className="ml-auto shrink-0 text-[#A8A29E] hover:text-white" aria-label="Dismiss">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-1.5 sm:gap-2">
                <button type="button" onClick={() => togglePanel('emoji')}
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    panel === 'emoji' ? 'text-[#D97706] bg-white/[0.08]' : 'text-[#A8A29E] hover:bg-white/[0.05]'
                  }`} title="Emoji, GIFs & stickers">
                  {panel === 'emoji' ? <Keyboard className="w-[20px] h-[20px]" /> : <Smile className="w-[20px] h-[20px]" />}
                </button>
                <button type="button" onClick={() => togglePanel('attach')}
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    panel === 'attach' ? 'text-[#D97706] bg-white/[0.08]' : 'text-[#A8A29E] hover:bg-white/[0.05]'
                  }`} title="Attach">
                  <Paperclip className="w-[19px] h-[19px]" />
                </button>
                <div className="flex-1 min-w-0 flex items-end rounded-[22px] bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 min-h-[44px] focus-within:border-[#D97706]/40 transition-colors">
                  <textarea ref={textareaRef} value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      autoGrow(e.currentTarget);
                      if (e.target.value.trim().length > 0) onType(); else stopTyping();
                    }}
                    onFocus={() => setPanel('none')}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitText(); } }}
                    placeholder={replyTo ? `Reply to ${replyTo.senderDisplayName || 'User'}…` : `Message ${targetName}`}
                    rows={1} disabled={isSending}
                    className="flex-1 min-w-0 resize-none bg-transparent px-1 py-2 text-[14.5px] text-[#EDE5D4] focus:outline-none leading-[1.5] max-h-[140px] overflow-y-auto placeholder-[#6B6259] disabled:opacity-60" />
                </div>
                {canSend ? (
                  <button key="send-btn" type="button" onClick={() => void submitText()} disabled={isSending}
                    className="shrink-0 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 text-[#0F0D0A] flex items-center justify-center transition-colors" aria-label="Send">
                    {isSending ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Send className="w-[18px] h-[18px]" />}
                  </button>
                ) : (
                  <button key="mic-btn" type="button" onClick={() => { setPanel('none'); setVoiceOpen(true); }}
                    className="shrink-0 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] flex items-center justify-center transition-colors" aria-label="Record voice message">
                    <Mic className="w-[19px] h-[19px]" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {panel === 'emoji' && !voiceOpen && (
          <div className={`relative ${PANEL_HEIGHT} border-t border-white/[0.06] overflow-hidden`}>
            <EmojiPanel onPickEmoji={(emoji: string) => { setText((prev) => prev + emoji); onType(); }}
              onSendGif={() => {}} onSendSticker={() => {}} onClose={() => setPanel('none')} />
          </div>
        )}
        {panel === 'attach' && !voiceOpen && (
          <GroupAttachPanel
            onPhoto={() => galleryRef.current?.click()}
            onCamera={() => cameraRef.current?.click()}
            onDocument={() => documentRef.current?.click()}
            onAudio={() => audioRef.current?.click()} />
        )}
      </div>
      <input type="file" ref={galleryRef} onChange={(e) => void handleFilePick(e)} accept="image/*" className="hidden" />
      <input type="file" ref={cameraRef} onChange={(e) => void handleFilePick(e)} accept="image/*" capture="environment" className="hidden" />
      <input type="file" ref={documentRef} onChange={(e) => void handleFilePick(e)} className="hidden" />
      <input type="file" ref={audioRef} onChange={(e) => void handleFilePick(e)} accept="audio/*" className="hidden" />
    </div>
  );
});

/* ────────────────────────────────────────────────────────── */
/* Floating call pill                                         */
/* ────────────────────────────────────────────────────────── */

interface CallPillParticipant {
  userId: string;
  displayName: string;
  muted: boolean;
  avatarUrl?: string | null;
}

interface CallPillProps {
  inCall: boolean;
  activeCallers: Array<{ userId: string; displayName: string }>;
  participants: ReadonlyArray<CallPillParticipant>;
  muted: boolean;
  myName: string;
  myAvatarUrl?: string | null;
  maxParticipants: number;
  bannerText: { title: string; sub: string } | null;
  onToggleMute: () => void;
  onLeave: () => void;
  onJoin: () => void;
  onOpenStage: () => void;
}

function CallPill({
  inCall, activeCallers, participants, muted, myName, myAvatarUrl, maxParticipants, bannerText,
  onToggleMute, onLeave, onJoin, onOpenStage,
}: CallPillProps) {
  if (!inCall && activeCallers.length === 0) return null;

  const visibleParticipants = participants.slice(0, 3);
  const overflow = Math.max(0, participants.length - visibleParticipants.length);
  const ringing = !inCall && activeCallers.length > 0;

  const handleBodyClick = () => {
    if (inCall) onOpenStage();
    else onJoin();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleBodyClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBodyClick(); } }}
      aria-label={inCall ? 'Open voice room' : 'Join call'}
      className={`group absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 h-[58px] pl-2 pr-1.5 rounded-full bg-[#1C1A17]/95 backdrop-blur-xl border shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] hover:bg-[#242220]/95 transition-all cursor-pointer select-none max-w-[calc(100%-24px)] ${
        ringing ? 'border-[#22C55E]/40 ring-2 ring-[#22C55E]/20' : 'border-white/[0.08] hover:border-white/[0.14]'
      }`}
    >
      {inCall ? (
        <>
          <div className="flex -space-x-2 shrink-0">
            <div className="relative shrink-0">
              <div className="rounded-full ring-2 ring-[#1C1A17]">
                <Avatar name={myName || 'You'} src={myAvatarUrl ?? undefined} size="md" />
              </div>
              {muted && (
                <div className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-[#B91C1C] ring-2 ring-[#1C1A17] flex items-center justify-center">
                  <MicOff className="w-2.5 h-2.5 text-white" />
                </div>
              )}
            </div>
            {visibleParticipants.map((p) => (
              <div key={p.userId} className="relative shrink-0">
                <div className="rounded-full ring-2 ring-[#1C1A17]">
                  <Avatar name={p.displayName} src={p.avatarUrl ?? undefined} size="md" />
                </div>
                {p.muted && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-[#B91C1C] ring-2 ring-[#1C1A17] flex items-center justify-center">
                    <MicOff className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
            ))}
            {overflow > 0 && (
              <div className="w-[36px] h-[36px] rounded-full bg-[#131110] ring-2 ring-[#1C1A17] flex items-center justify-center text-[11px] font-bold text-[#A8A29E]">
                +{overflow}
              </div>
            )}
          </div>

          <div className="flex flex-col items-start min-w-0 pr-1">
            <div className="flex items-center gap-1.5">
              <span className="relative flex w-1.5 h-1.5 shrink-0">
                <span className="absolute inset-0 rounded-full bg-[#22C55E] opacity-60 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
              </span>
              <span className="text-[12.5px] font-semibold text-[#EDE5D4] leading-tight truncate">Voice Call</span>
            </div>
            <span className="text-[10.5px] text-[#A8A29E] leading-tight tabular-nums">
              {participants.length + 1} / {maxParticipants} · tap to open
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                muted ? 'bg-[#B91C1C]/25 text-[#F87171] hover:bg-[#B91C1C]/35' : 'bg-white/[0.06] text-[#EDE5D4] hover:bg-white/[0.12]'
              }`}
              title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onLeave(); }}
              className="w-9 h-9 rounded-full bg-[#B91C1C] hover:bg-[#991B1B] text-white flex items-center justify-center transition-colors"
              title="Leave call" aria-label="Leave call">
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="relative shrink-0 w-[42px] h-[42px] rounded-full bg-[#22C55E]/20 flex items-center justify-center ring-1 ring-[#22C55E]/40">
            <span className="absolute inset-0 rounded-full bg-[#22C55E] opacity-25 animate-ping" />
            <Phone className="relative w-5 h-5 text-[#22C55E]" />
          </div>

          <div className="flex flex-col items-start min-w-0 pr-1">
            <span className="text-[12.5px] font-semibold text-[#EDE5D4] leading-tight truncate max-w-[200px]">
              {bannerText?.title ?? `${activeCallers[0]?.displayName ?? 'Someone'} is in a call`}
            </span>
            <span className="text-[10.5px] text-[#22C55E] font-medium leading-tight">
              {activeCallers.length} in call · tap to join
            </span>
          </div>

          <button type="button"
            onClick={(e) => { e.stopPropagation(); onJoin(); }}
            className="h-9 px-4 rounded-full bg-[#22C55E] hover:bg-[#16A34A] text-white text-[12px] font-semibold shrink-0 inline-flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5" /> Join
          </button>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Voice Stage                                                */
/* ────────────────────────────────────────────────────────── */

interface StageParticipant {
  userId: string;
  displayName: string;
  muted: boolean;
  avatarUrl?: string | null;
  stream?: MediaStream | null;
}

interface VoiceStageProps {
  open: boolean;
  onClose: () => void;
  groupId: number;
  groupName: string;
  inCall: boolean;
  participants: ReadonlyArray<StageParticipant>;
  muted: boolean;
  locallyMuted: Set<string>;
  currentUser: { id: string; displayName: string | null | undefined; avatarUrl?: string | null } | undefined;
  messages: GroupMessageDto[];
  onToggleMute: () => void;
  onToggleLocalMute: (userId: string) => void;
  onLeave: () => void;
  onSendMessage: (text: string, replyId: number | null) => Promise<void>;
}

function StageTileAvatar({ name, src, size = 96, accent = false }: {
  name: string; src?: string | null; size?: number; accent?: boolean;
}) {
  if (src) {
    return (
      <div style={{ width: size, height: size }} className="rounded-full overflow-hidden ring-4 ring-[#0F0D0A] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]">
        <img src={src} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={`rounded-full flex items-center justify-center text-white font-bold ring-4 ring-[#0F0D0A] ${
        accent
          ? 'bg-gradient-to-br from-[#D97706] to-[#B45309] shadow-[0_8px_24px_-8px_rgba(217,119,6,0.7)]'
          : 'bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] shadow-[0_8px_24px_-8px_rgba(79,70,229,0.7)]'
      }`}
    >
      {initialsOf(name)}
    </div>
  );
}

interface StageTileProps {
  tile: {
    key: string;
    userId: string;
    isSelf: boolean;
    displayName: string;
    muted: boolean;
    avatarUrl?: string | null;
    stream?: MediaStream | null;
  };
  index: number;
  tileCount: number;
  currentUserDisplayName: string;
  locallyMuted: boolean;
  onToggleLocalMute: (userId: string) => void;
}

function StageTile({
  tile, index, tileCount, currentUserDisplayName, locallyMuted, onToggleLocalMute,
}: StageTileProps) {
  const speaking = useSpeakingDetector(tile.isSelf ? null : tile.stream);
  const isLocallyMuted = !tile.isSelf && locallyMuted;
  const avatarSize = tileCount === 1 ? 112 : tileCount === 2 ? 96 : 88;
  const showSpeaking = speaking && !tile.muted && !isLocallyMuted;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05, type: 'spring', stiffness: 260, damping: 24 }}
      className={`group relative rounded-3xl overflow-hidden aspect-[4/3] transition-shadow ${
        tile.isSelf
          ? 'bg-gradient-to-br from-[#1A1410] via-[#131110] to-[#0F0D0A] border border-[#D97706]/25'
          : 'bg-gradient-to-br from-[#141220] via-[#131110] to-[#0F0D0A] border border-white/[0.06]'
      } ${showSpeaking ? 'ring-2 ring-[#22C55E]/60' : ''}`}
    >
      <div
        className="absolute inset-0 transition-opacity duration-200"
        style={{
          opacity: showSpeaking ? 0.6 : 0.4,
          background: tile.isSelf
            ? 'radial-gradient(circle at 50% 20%, rgba(217,119,6,0.18), transparent 60%)'
            : showSpeaking
              ? 'radial-gradient(circle at 50% 20%, rgba(34,197,94,0.25), transparent 60%)'
              : 'radial-gradient(circle at 50% 20%, rgba(124,58,237,0.15), transparent 60%)',
        }}
      />

      {!tile.isSelf && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleLocalMute(tile.userId); }}
          className={`absolute top-2 right-2 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
            isLocallyMuted
              ? 'bg-[#B91C1C]/85 text-white ring-1 ring-[#B91C1C] shadow-[0_4px_12px_-2px_rgba(185,28,28,0.6)]'
              : 'bg-black/50 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 hover:bg-black/70'
          }`}
          aria-label={isLocallyMuted ? `Unmute ${tile.displayName} for you` : `Mute ${tile.displayName} for you`}
          title={isLocallyMuted ? `Unmute ${tile.displayName}` : `Mute ${tile.displayName} for you`}
        >
          {isLocallyMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      )}

      <div className={`relative h-full flex flex-col items-center justify-center gap-3 p-4 transition-opacity ${isLocallyMuted ? 'opacity-55' : ''}`}>
        <div className="relative">
          <div className={`absolute -inset-3 rounded-full blur-2xl transition-opacity duration-200 ${
            showSpeaking ? 'opacity-90 bg-[#22C55E]/50' : 'opacity-60 ' + (tile.isSelf ? 'bg-[#D97706]/40' : 'bg-[#7C3AED]/40')
          }`} />

          {showSpeaking && (
            <motion.div
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{ opacity: 0, scale: 1.25 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
              className="absolute inset-0 rounded-full border-2 border-[#22C55E]"
            />
          )}

          <div className="relative">
            <StageTileAvatar
              name={tile.isSelf ? currentUserDisplayName : tile.displayName}
              src={tile.avatarUrl}
              size={avatarSize}
              accent={tile.isSelf}
            />
            {tile.muted && (
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#B91C1C] ring-4 ring-[#0F0D0A] flex items-center justify-center shadow-lg">
                <MicOff className="w-3.5 h-3.5 text-white" />
              </div>
            )}
            {isLocallyMuted && !tile.muted && (
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#B91C1C]/90 ring-4 ring-[#0F0D0A] flex items-center justify-center shadow-lg">
                <VolumeX className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5 max-w-full">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-[#EDE5D4] truncate">
              {tile.isSelf ? 'You' : tile.displayName}
            </span>
            {tile.isSelf && (
              <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-[#D97706]/20 text-[#F59E0B] font-bold uppercase tracking-wider">you</span>
            )}
          </div>
          <span className={`text-[10.5px] ${
            showSpeaking ? 'text-[#22C55E] font-semibold' :
            isLocallyMuted ? 'text-[#F87171]' :
            'text-[#6B6259]'
          }`}>
            {isLocallyMuted ? 'Muted for you' : tile.muted ? 'Muted' : showSpeaking ? 'Speaking' : 'Listening'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function VoiceStage({
  open, onClose, groupId, groupName, inCall, participants, muted, locallyMuted,
  currentUser, messages, onToggleMute, onToggleLocalMute, onLeave, onSendMessage,
}: VoiceStageProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [toast, setToast] = useState<{ id: number; sender: string; text: string; sentAt: string } | null>(null);
  const lastSeenIdRef = useRef<number>(-1);

  useEffect(() => {
    if (!open || !inCall) { setElapsed(0); startRef.current = null; return; }
    if (startRef.current == null) startRef.current = Date.now();
    const id = window.setInterval(() => {
      if (startRef.current != null) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, inCall]);

  useEffect(() => {
    if (!open) { setChatOpen(false); setToast(null); lastSeenIdRef.current = -1; }
  }, [open]);

  useEffect(() => {
    if (!chatOpen) return;
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatOpen, messages.length]);

  useEffect(() => { if (chatOpen) window.setTimeout(() => inputRef.current?.focus(), 150); }, [chatOpen]);

  useEffect(() => {
    if (!open || !inCall || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const lastId = typeof last.id === 'number' ? last.id : -1;
    if (lastSeenIdRef.current === -1) { lastSeenIdRef.current = lastId; return; }
    if (lastId > lastSeenIdRef.current) {
      lastSeenIdRef.current = lastId;
      if (last.senderId !== currentUser?.id && !chatOpen) {
        setToast({ id: lastId, sender: last.senderDisplayName || 'User', text: messageSnippet(last), sentAt: last.sentAt });
      }
    }
  }, [messages, open, inCall, chatOpen, currentUser?.id]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (chatOpen) setChatOpen(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, chatOpen, onClose]);

  const handleSend = async () => {
    const t = draft.trim();
    if (!t || sending) return;
    setSending(true);
    try { await onSendMessage(t, null); setDraft(''); }
    catch (err) { console.warn('[stage] send failed', err); }
    finally { setSending(false); }
  };

  const tiles = useMemo(() => {
    const list: Array<{
      key: string;
      userId: string;
      isSelf: boolean;
      displayName: string;
      muted: boolean;
      avatarUrl?: string | null;
      stream?: MediaStream | null;
    }> = [];
    if (currentUser) {
      list.push({
        key: 'self',
        userId: currentUser.id,
        isSelf: true,
        displayName: currentUser.displayName ?? 'You',
        muted,
        avatarUrl: currentUser.avatarUrl ?? null,
        stream: null,
      });
    }
    for (const p of participants) {
      list.push({
        key: p.userId,
        userId: p.userId,
        isSelf: false,
        displayName: p.displayName,
        muted: p.muted,
        avatarUrl: p.avatarUrl ?? null,
        stream: p.stream ?? null,
      });
    }
    return list;
  }, [currentUser, participants, muted]);

  const gridClass =
    tiles.length === 1 ? 'grid-cols-1 max-w-md mx-auto' :
    tiles.length === 2 ? 'grid-cols-1 sm:grid-cols-2 max-w-3xl mx-auto' :
    tiles.length <= 4 ? 'grid-cols-2 max-w-4xl mx-auto' :
    'grid-cols-2 sm:grid-cols-3 max-w-5xl mx-auto';

  const recentMessages = useMemo(() => messages.slice(-60), [messages]);

  return (
    <AnimatePresence>
      {open && inCall && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] bg-[#0B0A08] flex flex-col"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full bg-[#D97706]/[0.06] blur-3xl" />
            <div className="absolute -bottom-40 right-1/4 w-[600px] h-[600px] rounded-full bg-[#7C3AED]/[0.06] blur-3xl" />
          </div>

          <header className="relative shrink-0 h-16 px-3 sm:px-5 border-b border-white/[0.06] flex items-center gap-3 bg-[#0B0A08]/80 backdrop-blur-xl">
            <button type="button" onClick={onClose}
              className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
              aria-label="Minimize voice room" title="Minimize">
              <ChevronLeft className="w-[18px] h-[18px]" />
            </button>
            <GroupAvatar name={groupName} groupId={groupId} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-[14.5px] sm:text-[15px] font-semibold text-[#EDE5D4] truncate tracking-tight">{groupName}</h2>
                <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#22C55E]/15 text-[9.5px] font-bold uppercase tracking-wider text-[#22C55E]">
                  <span className="w-1 h-1 rounded-full bg-[#22C55E] animate-pulse" />Live
                </span>
              </div>
              <p className="text-[11px] text-[#6B6259] tabular-nums mt-0.5 flex items-center gap-1.5">
                <span className="text-[#A8A29E] font-medium">{formatDuration(elapsed)}</span>
                <span className="opacity-50">·</span>
                <span>{tiles.length} {tiles.length === 1 ? 'person' : 'people'}</span>
              </p>
            </div>
            <button type="button" onClick={() => setChatOpen((v) => !v)}
              className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                chatOpen ? 'bg-[#D97706] text-[#0F0D0A]' : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06]'
              }`}
              aria-label="Toggle chat" title="Chat">
              <MessageSquare className="w-[18px] h-[18px]" />
            </button>
          </header>

          <div className="relative flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6">
              <div className={`grid gap-3 sm:gap-4 ${gridClass}`}>
                {tiles.map((tile, idx) => (
                  <StageTile
                    key={tile.key}
                    tile={tile}
                    index={idx}
                    tileCount={tiles.length}
                    currentUserDisplayName={currentUser?.displayName ?? 'You'}
                    locallyMuted={!tile.isSelf && locallyMuted.has(tile.userId)}
                    onToggleLocalMute={onToggleLocalMute}
                  />
                ))}
              </div>
            </div>

            <AnimatePresence>
              {chatOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 340, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                  className="shrink-0 border-t border-white/[0.08] bg-[#0B0A08]/95 backdrop-blur-xl overflow-hidden"
                >
                  <div className="h-[340px] flex flex-col">
                    <div className="shrink-0 px-4 py-2 flex items-center justify-between border-b border-white/[0.05]">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-[#D97706]" />
                        <span className="text-[11px] uppercase tracking-[0.14em] text-[#6B6259] font-semibold">Group Chat</span>
                      </div>
                      <button type="button" onClick={() => setChatOpen(false)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B6259] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                        aria-label="Close chat">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
                      {recentMessages.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-center py-6">
                          <p className="text-[12.5px] text-[#6B6259]">No messages yet. Say hi 👋</p>
                        </div>
                      ) : (
                        recentMessages.map((m) => {
                          const isMine = currentUser && m.senderId === currentUser.id;
                          return (
                            <div key={String(m.id)} className={`flex items-start gap-2.5 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                              <div className="shrink-0 pt-0.5">
                                <Avatar name={m.senderDisplayName} src={m.senderAvatarUrl} size="sm" />
                              </div>
                              <div className={`flex flex-col max-w-[75%] ${isMine ? 'items-end' : 'items-start'}`}>
                                <div className="flex items-baseline gap-1.5 mb-0.5 px-0.5">
                                  <span className="text-[11px] font-semibold text-[#A8A29E]">{isMine ? 'You' : m.senderDisplayName}</span>
                                  <span className="text-[9.5px] text-[#6B6259] tabular-nums">{formatTime(m.sentAt)}</span>
                                </div>
                                <div className={`px-3 py-1.5 rounded-2xl text-[13px] leading-[1.4] break-words ${
                                  isMine ? 'bg-[#D97706] text-[#0F0D0A] font-medium' : 'bg-[#1A1816] text-[#EDE5D4] border border-white/[0.04]'
                                }`}>
                                  {m.content ? m.content : (<span className="italic opacity-70">{messageSnippet(m)}</span>)}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="shrink-0 border-t border-white/[0.06] px-3 py-2.5 flex items-center gap-2">
                      <input ref={inputRef} type="text" value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                        placeholder="Message…" disabled={sending}
                        className="flex-1 h-9 px-3 rounded-full bg-white/[0.06] border border-white/[0.08] text-[13px] text-[#EDE5D4] placeholder-[#6B6259] focus:outline-none focus:border-[#D97706]/50 transition-colors disabled:opacity-50" />
                      <button type="button" onClick={() => void handleSend()} disabled={!draft.trim() || sending}
                        className="shrink-0 w-9 h-9 rounded-full bg-[#D97706] hover:bg-[#B45309] disabled:opacity-40 text-[#0F0D0A] flex items-center justify-center transition-colors">
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="shrink-0 py-5 flex justify-center relative">
              <div className="flex items-center gap-2 px-2 py-2 rounded-full bg-[#1C1A17]/95 backdrop-blur-xl border border-white/[0.1] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.9)]">
                <button type="button" onClick={onToggleMute}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                    muted ? 'bg-[#B91C1C]/25 text-[#F87171] hover:bg-[#B91C1C]/35 ring-1 ring-[#B91C1C]/40'
                          : 'bg-white/[0.06] text-[#EDE5D4] hover:bg-white/[0.12]'
                  }`}
                  title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}>
                  {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <button type="button" onClick={onLeave}
                  className="h-12 px-5 rounded-full bg-[#B91C1C] hover:bg-[#991B1B] text-white flex items-center justify-center gap-2 text-[13px] font-semibold transition-colors">
                  <PhoneOff className="w-4 h-4" /> Leave
                </button>
                <button type="button" onClick={() => setChatOpen((v) => !v)}
                  className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                    chatOpen ? 'bg-[#D97706] text-[#0F0D0A]' : 'bg-white/[0.06] text-[#EDE5D4] hover:bg-white/[0.12]'
                  }`}
                  title={chatOpen ? 'Hide chat' : 'Show chat'} aria-label={chatOpen ? 'Hide chat' : 'Show chat'}>
                  <MessageSquare className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {toast && !chatOpen && (
              <motion.button
                key={toast.id}
                type="button"
                initial={{ y: -20, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -20, opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                onClick={() => { setToast(null); setChatOpen(true); }}
                className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-3 py-2 pr-4 rounded-full bg-[#1C1A17]/95 backdrop-blur-xl border border-[#D97706]/30 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] hover:bg-[#242220]/95 hover:border-[#D97706]/50 transition-colors max-w-[calc(100%-24px)]"
                aria-label={`New message from ${toast.sender}. Tap to open chat.`}
              >
                <Avatar name={toast.sender} size="sm" />
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-[10.5px] font-semibold text-[#D97706] leading-tight">{toast.sender}</span>
                  <span className="text-[12.5px] text-[#EDE5D4] leading-tight truncate max-w-[260px]">{toast.text}</span>
                </div>
              </motion.button>
            )}
          </AnimatePresence>
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

  const call = useGroupCall(
    activeGroupId,
    user ? { id: user.id, displayName: user.displayName ?? '' } : undefined,
  );

  // Fresh self-profile so we always have the latest avatarUrl (context may be stale)
  const [myFreshProfile, setMyFreshProfile] = useState<{ avatarUrl?: string | null } | null>(null);
  useEffect(() => {
    if (!user?.id) { setMyFreshProfile(null); return; }
    let cancelled = false;
    void apiService.getMyProfile()
      .then((p) => { if (!cancelled) setMyFreshProfile({ avatarUrl: p.avatarUrl ?? null }); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  const [callExpanded, setCallExpanded] = useState(false);
  useEffect(() => {
    if (!call.inCall) setCallExpanded(false);
  }, [call.inCall]);

  const disconnectRef = useRef<HTMLAudioElement | null>(null);
  const prevInCallRef = useRef(call.inCall);
  useEffect(() => {
    if (prevInCallRef.current && !call.inCall) {
      const el = disconnectRef.current;
      if (el) {
        try { el.currentTime = 0; void el.play().catch(() => { /* autoplay blocked */ }); } catch { /* noop */ }
      }
    }
    prevInCallRef.current = call.inCall;
  }, [call.inCall]);

  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [activeGroup, setActiveGroup] = useState<GroupDetailDto | null>(null);
  const [messages, setMessages] = useState<GroupMessageDto[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>('');
  const [newGroupDescription, setNewGroupDescription] = useState<string>('');
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [infoOpen, setInfoOpen] = useState(false);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [chatMenuGroup, setChatMenuGroup] = useState<GroupDto | null>(null);
  const [menuMessage, setMenuMessage] = useState<GroupMessageDto | null>(null);
  const [replyTo, setReplyTo] = useState<GroupMessageDto | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);

  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<number | null>(null);

  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => readPinned(user?.id));
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => readMuted(user?.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => readHidden(user?.id, activeGroupId));
  const [reactions, setReactions] = useState<Record<string, ReactionEntry[]>>(() => readReactions(user?.id, activeGroupId));

  const [locallyMuted, setLocallyMuted] = useState<Set<string>>(() => readLocalMute(user?.id));
  useEffect(() => { setLocallyMuted(readLocalMute(user?.id)); }, [user?.id]);
  useEffect(() => { writeLocalMute(user?.id, locallyMuted); }, [locallyMuted, user?.id]);

  const toggleLocalMute = useCallback((targetUserId: string) => {
    if (!targetUserId || targetUserId === user?.id) return;
    setLocallyMuted((prev) => {
      const next = new Set(prev);
      if (next.has(targetUserId)) next.delete(targetUserId);
      else next.add(targetUserId);
      return next;
    });
  }, [user?.id]);

  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  useEffect(() => {
    for (const [userId, el] of audioElsRef.current) {
      el.muted = locallyMuted.has(userId);
    }
  }, [locallyMuted]);

  useEffect(() => {
    setPinnedIds(readPinned(user?.id));
    setMutedIds(readMuted(user?.id));
  }, [user?.id]);

  useEffect(() => {
    setReactions(readReactions(user?.id, activeGroupId));
    setHiddenIds(readHidden(user?.id, activeGroupId));
  }, [activeGroupId, user?.id]);

  useEffect(() => { writeReactions(user?.id, activeGroupId, reactions); }, [user?.id, activeGroupId, reactions]);
  useEffect(() => { writeHidden(user?.id, activeGroupId, hiddenIds); }, [user?.id, activeGroupId, hiddenIds]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const processedIdsRef = useRef<Set<GroupMessageDto['id']>>(new Set());
  const stickRef = useRef(true);
  const anchorRef = useRef<number | null>(null);

  const typingUsers = useGroupTypingReceiver(activeGroupId, user?.id);

  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    const unsub = presenceStore.subscribe(() => setPresenceTick((v) => v + 1));
    return () => unsub();
  }, []);

  useEffect(() => {
    setMessages([]); setReplyTo(null); setHasMore(true); setHistoryError(null);
    setShowJumpToLatest(false); setUnreadWhileScrolled(0);
    processedIdsRef.current = new Set(); stickRef.current = true; anchorRef.current = null;
  }, [activeGroupId]);

  useEffect(() => {
    const unlock = () => {
      try { unlockSounds(); } catch { /* silent */ }
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
    try { const data = await apiService.getMyGroups(); setGroups(data); }
    catch (err) { console.error('Failed to load groups:', err); }
  }, []);

  useEffect(() => { void fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    if (!activeGroupId || isNaN(activeGroupId)) { setActiveGroup(null); setMessages([]); return; }
    let active = true;
    const loadGroup = async () => {
      setLoadingHistory(true); setHistoryError(null);
      try {
        const detail = await apiService.getGroupDetail(activeGroupId);
        if (active) setActiveGroup(detail);
        await signalRService.joinGroupChannel(activeGroupId);
        const res = await apiService.getGroupMessages(activeGroupId, PAGE_SIZE);
        const msgs = applyPresignedUrls(res.messages, res.presignedUrls);
        if (!active) return;
        const sorted = [...msgs].sort((a, b) => getMessageTime(a) - getMessageTime(b));

        const reactionEvents: Array<{ messageId: number; emoji: string; action: 'add' | 'remove'; userId: string }> = [];
        const deleteEvents: number[] = [];
        const visible: GroupMessageDto[] = [];
        for (const m of sorted) {
          if (isCallSignal(m.content)) continue;
          const d = decodeIncoming(m.content ?? '');
          if (d.isReaction) { reactionEvents.push({ messageId: d.messageId, emoji: d.emoji, action: d.action, userId: m.senderId }); continue; }
          if (d.isDelete) { deleteEvents.push(d.messageId); continue; }
          visible.push({ ...m, content: d.body, replyToId: d.replyToId } as GroupMessageDto & { replyToId?: number | null });
        }
        const deletedSet = new Set(deleteEvents);
        const filtered = visible.filter((m) => !deletedSet.has(Number(m.id)));

        processedIdsRef.current = new Set(sorted.map((m) => m.id));
        setMessages(filtered);
        if (reactionEvents.length > 0) setReactions((prev) => applyReactionEvents(prev, reactionEvents));
        setHasMore(msgs.length >= PAGE_SIZE);
      } catch (err) {
        if (active) setHistoryError(extractErrorMessage(err, 'Could not load messages.'));
      } finally {
        if (active) setLoadingHistory(false);
      }
    };
    void loadGroup();
    return () => { active = false; };
  }, [activeGroupId, reloadTick]);

  const handleLoadEarlier = async () => {
    if (!activeGroupId || loadingMore || !hasMore || messages.length === 0) return;
    const el = messagesContainerRef.current;
    if (el) anchorRef.current = el.scrollHeight;
    stickRef.current = false;
    const oldestId = messages[0].id;
    setLoadingMore(true);
    try {
      const res = await apiService.getGroupMessages(activeGroupId, PAGE_SIZE, oldestId);
      const earlier = applyPresignedUrls(res.messages, res.presignedUrls);
      if (earlier.length > 0) {
        const sortedEarlier = [...earlier].sort((a, b) => getMessageTime(a) - getMessageTime(b));
        const reactionEvents: Array<{ messageId: number; emoji: string; action: 'add' | 'remove'; userId: string }> = [];
        const deleteEvents: number[] = [];
        const visible: GroupMessageDto[] = [];
        for (const m of sortedEarlier) {
          if (isCallSignal(m.content)) continue;
          const d = decodeIncoming(m.content ?? '');
          if (d.isReaction) { reactionEvents.push({ messageId: d.messageId, emoji: d.emoji, action: d.action, userId: m.senderId }); continue; }
          if (d.isDelete) { deleteEvents.push(d.messageId); continue; }
          visible.push({ ...m, content: d.body, replyToId: d.replyToId } as GroupMessageDto & { replyToId?: number | null });
        }
        const deletedSet = new Set(deleteEvents);
        const filtered = visible.filter((m) => !deletedSet.has(Number(m.id)));

        setMessages((prev) => [...filtered, ...prev]);
        if (reactionEvents.length > 0) setReactions((prev) => applyReactionEvents(prev, reactionEvents));
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

  useEffect(() => {
    const unsub = signalRService.onReceiveGroupMessage(async (msg: GroupMessageDto) => {
      if (isCallSignal(msg.content)) return;
      const d = decodeIncoming(msg.content ?? '');

      if (d.isReaction) {
        setReactions((prev) => applyReactionEvents(prev, [{ messageId: d.messageId, emoji: d.emoji, action: d.action, userId: msg.senderId }]));
        return;
      }
      if (d.isDelete) {
        const targetId = d.messageId;
        setMessages((prev) => prev.filter((m) => Number(m.id) !== targetId));
        setReactions((prev) => { const next = { ...prev }; delete next[String(targetId)]; return next; });
        return;
      }

      if (activeGroupId && msg.groupId === activeGroupId) {
        if (processedIdsRef.current.has(msg.id)) return;
        processedIdsRef.current.add(msg.id);

        const isOwnEcho = msg.senderId === user?.id;
        let mediaUrl = msg.mediaUrl;
        if (msg.mediaKey && !mediaUrl && !isOwnEcho) {
          try {
            const urls = await apiService.presignDownload([msg.mediaKey]);
            if (urls[msg.mediaKey]) mediaUrl = urls[msg.mediaKey];
          } catch { /* silent */ }
        }

        const decorated = { ...msg, content: d.body, mediaUrl, replyToId: d.replyToId } as GroupMessageDto & { replyToId?: number | null };
        setMessages((prev) => mergeIncomingGroup(prev, decorated));
        if (msg.senderId !== user?.id) {
          safePlayReceive();
          if (!stickRef.current) setUnreadWhileScrolled((c) => c + 1);
        }
      }
    });
    return () => { unsub(); };
  }, [activeGroupId, user?.id]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const conn = await signalRService.start();
        if (cancelled) return;
        const handler = (groupId: number, messageId: number) => {
          if (groupId !== activeGroupId) return;
          const targetStr = String(messageId);
          setMessages((prev) => prev.filter((m) => String(m.id) !== targetStr));
          setReactions((prev) => { const next = { ...prev }; delete next[targetStr]; return next; });
        };
        conn.on('GroupMessageDeleted', handler);
        unsub = () => { try { conn.off('GroupMessageDeleted', handler); } catch { /* noop */ } };
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; unsub?.(); };
  }, [activeGroupId]);

  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (anchorRef.current != null) { el.scrollTop += el.scrollHeight - anchorRef.current; anchorRef.current = null; }
    else if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, typingUsers.length]);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
    if (nearBottom) setUnreadWhileScrolled(0);
  };

  const handleJumpToLatest = () => {
    stickRef.current = true; scrollToBottom(); setShowJumpToLatest(false); setUnreadWhileScrolled(0);
  };

  const jumpToMessage = useCallback((id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightedMessageId(id);
    window.setTimeout(() => setHighlightedMessageId((cur) => (cur === id ? null : cur)), 1300);
    if (navigator.vibrate) navigator.vibrate(8);
  }, []);

  const handleSendText = useCallback(async (text: string, replyId: number | null) => {
    if (!activeGroupId) return;
    stickRef.current = true;
    const payload = replyId != null ? encodeReply(replyId, text) : text;
    await signalRService.sendGroupMessage({ groupId: activeGroupId, content: payload, mediaUrl: undefined, mediaType: undefined });
    safePlaySend();
  }, [activeGroupId]);

  const handleSendFile = useCallback(async (file: File) => {
    if (!activeGroupId || !user?.id) return;
    stickRef.current = true;
    const validation = validateFileSize(file);
    const contentType = file.type || 'application/octet-stream';
    const presign = await apiService.presignUpload(file.name, contentType, file.size, 'group', activeGroupId);
    await apiService.uploadToR2(presign.uploadUrl, file, contentType);
    const blobUrl = URL.createObjectURL(file);
    const tempId = -Date.now();
    setMessages((prev) => [...prev, {
      id: tempId as unknown as number, groupId: activeGroupId, senderId: user.id,
      senderDisplayName: user.displayName ?? '', senderAvatarUrl: user.avatarUrl ?? undefined,
      content: '', mediaUrl: blobUrl, mediaKey: presign.mediaKey, mediaType: validation.mediaType,
      sentAt: new Date().toISOString(),
    }]);
    try {
      await signalRService.sendGroupMessage({ groupId: activeGroupId, content: '', mediaUrl: undefined, mediaKey: presign.mediaKey, mediaType: validation.mediaType });
      safePlaySend();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== (tempId as unknown as number)));
      URL.revokeObjectURL(blobUrl);
      throw err;
    }
  }, [activeGroupId, user?.id, user?.displayName, user?.avatarUrl]);

  const handleSendVoice = useCallback(async (blob: Blob, _durationMs: number) => {
    if (!activeGroupId || !user?.id) return;
    stickRef.current = true;
    const raw = blob.type || 'audio/webm';
    const baseType = raw.split(';')[0].trim() || 'audio/webm';
    const ext = baseType.includes('mp4') ? 'm4a' : baseType.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: baseType });
    const contentType = baseType;
    const presign = await apiService.presignUpload(file.name, contentType, file.size, 'group', activeGroupId);
    await apiService.uploadToR2(presign.uploadUrl, file, contentType);
    const blobUrl = URL.createObjectURL(file);
    const tempId = -Date.now();
    setMessages((prev) => [...prev, {
      id: tempId as unknown as number, groupId: activeGroupId, senderId: user.id,
      senderDisplayName: user.displayName ?? '', senderAvatarUrl: user.avatarUrl ?? undefined,
      content: '', mediaUrl: blobUrl, mediaKey: presign.mediaKey, mediaType: MediaType.Audio,
      sentAt: new Date().toISOString(),
    }]);
    try {
      await signalRService.sendGroupMessage({ groupId: activeGroupId, content: '', mediaUrl: undefined, mediaKey: presign.mediaKey, mediaType: MediaType.Audio });
      safePlaySend();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== (tempId as unknown as number)));
      URL.revokeObjectURL(blobUrl);
      throw err;
    }
  }, [activeGroupId, user?.id, user?.displayName, user?.avatarUrl]);

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragCounterRef.current += 1;
    setIsDraggingFile(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDraggingFile(false); }
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && activeGroupId) void handleSendFile(file).catch(() => { /* handled by Composer */ });
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) { setCreateError('Channel name is required.'); return; }
    setCreateLoading(true); setCreateError(null);
    try {
      const created = await apiService.createGroup({ name: newGroupName.trim(), description: newGroupDescription.trim() || undefined });
      await fetchGroups();
      setCreateModalOpen(false); setNewGroupName(''); setNewGroupDescription('');
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

  const handleReact = useCallback((messageId: number, emoji: string) => {
    if (!user?.id) return;
    const mine = (reactions[String(messageId)] ?? []).some((r) => r.userId === user.id && r.emoji === emoji);
    const action: 'add' | 'remove' = mine ? 'remove' : 'add';
    setReactions((prev) => applyReactionEvents(prev, [{ messageId, emoji, action, userId: user.id }]));
    if (!activeGroupId) return;
    void signalRService.sendGroupMessage({
      groupId: activeGroupId, content: encodeReaction(messageId, emoji, action), mediaUrl: undefined, mediaType: undefined,
    }).catch((err) => console.warn('Reaction send failed:', err));
  }, [activeGroupId, reactions, user?.id]);

  const handleStartReply = useCallback((m: GroupMessageDto) => {
    if (typeof m.id === 'number' && m.id < 0) return;
    setReplyTo(m);
  }, []);

  const handleCancelReply = useCallback(() => setReplyTo(null), []);
  const handleOpenMenu = useCallback((m: GroupMessageDto) => { setMenuMessage(m); }, []);

  const handleDeleteForMe = useCallback((m: GroupMessageDto) => {
    if (typeof m.id !== 'number' || m.id <= 0) return;
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    setReactions((prev) => { const next = { ...prev }; delete next[String(m.id)]; return next; });
    setHiddenIds((prev) => { const next = new Set(prev); next.add(m.id as number); return next; });
  }, []);

  const handleRequestDeleteForEveryone = useCallback((m: GroupMessageDto) => {
    if (typeof m.id !== 'number' || m.id <= 0) return;
    setPendingDeleteEveryoneId(m.id as number);
  }, []);

  const handleConfirmDeleteForEveryone = useCallback(async () => {
    if (pendingDeleteEveryoneId == null || !activeGroupId) return;
    const targetId = pendingDeleteEveryoneId;
    setPendingDeleteEveryoneId(null);
    const targetStr = String(targetId);
    const removed = messages.find((m) => String(m.id) === targetStr);
    setMessages((prev) => prev.filter((m) => String(m.id) !== targetStr));
    setReactions((prev) => { const next = { ...prev }; delete next[targetStr]; return next; });
    try {
      await apiService.deleteGroupMessageForEveryone(targetId);
    } catch (err) {
      if (removed) setMessages((prev) => [...prev, removed].sort((a, b) => getMessageTime(a) - getMessageTime(b)));
      alert(`Delete for everyone failed: ${extractErrorMessage(err)}`);
    }
  }, [pendingDeleteEveryoneId, activeGroupId, messages]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => typeof m.id !== 'number' || !hiddenIds.has(m.id as number)),
    [messages, hiddenIds],
  );

  const grouped = useMemo(() => {
    type Item = { type: 'date'; key: string; label: string } | { type: 'msg'; key: string; message: GroupMessageDto; grouped: boolean; last: boolean };
    const out: Item[] = [];
    let lastDate = ''; let lastSenderId = ''; let lastTs = 0;
    for (const m of visibleMessages) {
      const day = parseUtc(m.sentAt).toDateString();
      if (day !== lastDate) {
        out.push({ type: 'date', key: `d-${day}`, label: formatDayDivider(m.sentAt) });
        lastDate = day; lastSenderId = ''; lastTs = 0;
      }
      const ts = getMessageTime(m);
      const isGrouped = m.senderId === lastSenderId && ts - lastTs < 7 * 60 * 1000;
      out.push({ type: 'msg', key: String(m.id), message: m, grouped: isGrouped, last: true });
      lastSenderId = m.senderId ?? ''; lastTs = ts;
    }
    for (let i = 0; i < out.length; i++) {
      const it = out[i];
      if (it.type !== 'msg') continue;
      const next = out[i + 1];
      it.last = !(next && next.type === 'msg' && next.message.senderId === it.message.senderId);
    }
    return out;
  }, [visibleMessages]);

  const messagesById = useMemo(() => {
    const map = new Map<GroupMessageDto['id'], GroupMessageDto>();
    for (const m of visibleMessages) map.set(m.id, m);
    return map;
  }, [visibleMessages]);

  const onlineMembers = useMemo(() => {
    if (!activeGroup) return 0;
    return (activeGroup.members ?? []).filter((m) => presenceStore.isOnline(m.id)).length;
  }, [activeGroup]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = [...groups];
    const list = q ? base.filter((g) => g.name.toLowerCase().includes(q)) : base;
    list.sort((a, b) => {
      const aP = pinnedIds.has(String(a.id)) ? 1 : 0;
      const bP = pinnedIds.has(String(b.id)) ? 1 : 0;
      if (aP !== bP) return bP - aP;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [groups, searchQuery, pinnedIds]);

  const hasActiveGroup = Boolean(activeGroupId && activeGroup);

  // Enrich participants with avatar URLs, preferring sources known to work
  const enrichedParticipants = useMemo(() => {
    const fromMessages = new Map<string, string>();
    for (const msg of messages) {
      if (msg.senderId && msg.senderAvatarUrl) {
        fromMessages.set(msg.senderId, msg.senderAvatarUrl);
      }
    }
    const fromMembers = new Map<string, string>();
    for (const m of activeGroup?.members ?? []) {
      if (m.avatarUrl) fromMembers.set(m.id, m.avatarUrl);
    }

    return call.participants.map((p) => {
      const isSelf = Boolean(user?.id && p.userId === user.id);
      const selfAvatar = isSelf
        ? (myFreshProfile?.avatarUrl ?? user?.avatarUrl ?? null)
        : null;
      const otherAvatar =
        fromMessages.get(p.userId) ??
        fromMembers.get(p.userId) ??
        null;
      return {
        userId: p.userId,
        displayName: p.displayName,
        muted: p.muted,
        avatarUrl: selfAvatar ?? otherAvatar,
        stream: p.stream,
      };
    });
  }, [call.participants, messages, activeGroup, user?.id, user?.avatarUrl, myFreshProfile?.avatarUrl]);

  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0].handle || 'Someone'} is typing…`;
    if (typingUsers.length === 2) return `${typingUsers[0].handle}, ${typingUsers[1].handle} are typing…`;
    return `${typingUsers.length} people are typing…`;
  }, [typingUsers]);

  const togglePin = (id: string) => {
    const next = new Set(pinnedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPinnedIds(next); writePinned(user?.id, next);
  };
  const toggleMute = (id: string) => {
    const next = new Set(mutedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setMutedIds(next); writeMuted(user?.id, next);
  };

  const activeCallBanner = useMemo(() => {
    if (call.activeCallers.length === 0) return null;
    const names = call.activeCallers.map((a) => a.displayName);
    if (names.length === 1) return { title: `${names[0]} is in a call`, sub: 'Tap to join' };
    if (names.length === 2) return { title: `${names[0]} and ${names[1]} are in a call`, sub: 'Tap to join' };
    return { title: `${names[0]} + ${names.length - 1} others are in a call`, sub: 'Tap to join' };
  }, [call.activeCallers]);

  return (
    <div className="flex h-full w-full bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* LEFT: Groups list */}
      <div className={`${hasActiveGroup ? 'hidden md:flex' : 'flex'} w-full md:w-[320px] md:shrink-0 border-r border-white/[0.05] bg-[#0F0D0A] flex-col h-full`}>
        <div className="h-16 px-4 flex items-center justify-between shrink-0 border-b border-white/[0.05]">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[18px] font-semibold text-[#EDE5D4] tracking-tight">Groups</h2>
            <span className="text-[11.5px] text-[#6B6259] tabular-nums font-mono">{groups.length}</span>
          </div>
          <button onClick={() => setCreateModalOpen(true)}
            className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] transition-colors"
            title="Create group">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B6259] pointer-events-none" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search groups"
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12.5px] text-[#EDE5D4] focus:outline-none focus:border-[#D97706]/40 transition-colors placeholder-[#6B6259]" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {filteredGroups.length === 0 ? (
            <div className="p-8 text-center text-[12.5px] text-[#6B6259]">
              {groups.length === 0 ? 'No groups yet. Click + to create one.' : 'No matches found.'}
            </div>
          ) : (
            filteredGroups.map((group) => {
              const isSelected = group.id === activeGroupId;
              const pinned = pinnedIds.has(String(group.id));
              const muted = mutedIds.has(String(group.id));
              return (
                <button key={group.id} onClick={() => navigate(`/app/groups/${group.id}`)}
                  onContextMenu={(e) => { e.preventDefault(); setChatMenuGroup(group); }}
                  className={`group w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-all duration-150 ${
                    isSelected ? 'bg-[#D97706]/[0.12] ring-1 ring-inset ring-[#D97706]/25' : 'hover:bg-white/[0.04]'
                  }`}>
                  <GroupAvatar name={group.name} groupId={group.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {pinned && <Pin className="w-3 h-3 text-[#D97706] shrink-0" />}
                      <p className={`text-[13.5px] ${isSelected ? 'font-semibold' : 'font-medium'} text-[#EDE5D4] truncate`}>{group.name}</p>
                      {muted && <BellOff className="w-3 h-3 text-[#6B6259] shrink-0" />}
                    </div>
                    <p className="text-[11px] text-[#6B6259] truncate mt-0.5">{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT: Channel view */}
      <div className={`${hasActiveGroup ? 'flex' : 'hidden md:flex'} flex-1 flex-col h-full min-w-0 bg-[#0B0A08] relative`}>
        {activeGroupId && activeGroup ? (
          <>
            <div className="h-16 px-3 sm:px-5 border-b border-white/[0.05] flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button onClick={() => navigate('/app/groups')}
                  className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors shrink-0"
                  aria-label="Back to groups">
                  <ChevronLeft className="w-[18px] h-[18px]" />
                </button>
                <button type="button" onClick={() => setInfoOpen(true)}
                  className="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50">
                  <GroupAvatar name={activeGroup.name} groupId={activeGroup.id} />
                </button>
                <div className="min-w-0">
                  <h3 className="text-[14px] sm:text-[14.5px] font-semibold text-[#EDE5D4] truncate tracking-tight">{activeGroup.name}</h3>
                  <p className="text-[11px] sm:text-[11.5px] text-[#6B6259] truncate mt-0.5 flex items-center gap-1.5">
                    {onlineMembers > 0 && (
                      <>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                          {onlineMembers} online
                        </span>
                        <span className="opacity-50">·</span>
                      </>
                    )}
                    <span>{activeGroup.memberCount} {activeGroup.memberCount === 1 ? 'member' : 'members'}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {call.inCall ? (
                  <button onClick={() => setCallExpanded(true)}
                    className="relative w-9 h-9 rounded-xl flex items-center justify-center bg-[#22C55E]/15 text-[#22C55E] ring-1 ring-inset ring-[#22C55E]/40 hover:bg-[#22C55E]/25 transition-colors shrink-0"
                    title="Open voice room" aria-label="Open voice room">
                    <Phone className="w-[17px] h-[17px]" />
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#22C55E] text-[9px] font-bold text-white flex items-center justify-center ring-2 ring-[#0B0A08]">
                      {call.participants.length + 1}
                    </span>
                  </button>
                ) : call.activeCallers.length > 0 ? (
                  <button onClick={() => void call.join()}
                    className="relative w-9 h-9 rounded-xl flex items-center justify-center text-[#22C55E] bg-[#22C55E]/10 hover:bg-[#22C55E]/20 transition-colors shrink-0 ring-1 ring-inset ring-[#22C55E]/30"
                    title="Join call" aria-label="Join call">
                    <Phone className="w-[17px] h-[17px]" />
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#22C55E] text-[9px] font-bold text-white flex items-center justify-center ring-2 ring-[#0B0A08]">
                      {call.activeCallers.length + 1}
                    </span>
                  </button>
                ) : (
                  <button onClick={() => void call.join()}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors shrink-0"
                    title="Start call" aria-label="Start call">
                    <Phone className="w-[17px] h-[17px]" />
                  </button>
                )}
                <button onClick={() => setInfoOpen(true)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors shrink-0"
                  title="Group info" aria-label="Group info">
                  <Info className="w-[17px] h-[17px]" />
                </button>
              </div>
            </div>

            <div className="flex-1 relative min-h-0">
              <div ref={messagesContainerRef} onScroll={handleMessagesScroll}
                onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
                className="absolute inset-0 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4" style={{ overscrollBehavior: 'contain' }}>
                {loadingHistory ? (
                  <MessageSkeleton />
                ) : historyError && visibleMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                    <div className="w-14 h-14 rounded-2xl bg-[#B91C1C]/[0.10] border border-[#B91C1C]/30 flex items-center justify-center">
                      <AlertCircle className="w-6 h-6 text-[#F87171]" />
                    </div>
                    <div>
                      <p className="text-[14.5px] font-bold tracking-tight text-[#EDE5D4]">Couldn't load messages</p>
                      <p className="text-[12.5px] mt-1 max-w-[300px] text-[#6B6259]">{historyError}</p>
                    </div>
                    <button onClick={() => setReloadTick((t) => t + 1)}
                      className="h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-[12.5px] font-semibold transition-colors">
                      Retry
                    </button>
                  </div>
                ) : visibleMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                    <GroupAvatar name={activeGroup.name} groupId={activeGroup.id} size="lg" />
                    <div>
                      <p className="text-[14.5px] text-[#EDE5D4] font-semibold tracking-tight">No messages yet</p>
                      <p className="text-[12.5px] text-[#6B6259] mt-1">Start the conversation in {activeGroup.name}.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {hasMore && (
                      <div className="flex justify-center mb-3">
                        <button onClick={() => void handleLoadEarlier()} disabled={loadingMore}
                          className="px-3 py-1.5 rounded-full bg-white/[0.035] border border-white/[0.06] text-[11.5px] text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5">
                          {loadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
                          Load earlier messages
                        </button>
                      </div>
                    )}
                    {grouped.map((item) => {
                      if (item.type === 'date') {
                        return (
                          <div key={item.key} className="sticky top-0 z-10 flex justify-center py-2 select-none pointer-events-none">
                            <span className="px-3.5 py-1 rounded-full bg-[#0B0A08]/90 backdrop-blur-sm border border-white/[0.06] text-[10.5px] uppercase tracking-[0.14em] text-[#6B6259] font-bold shadow-[0_4px_12px_-2px_rgba(0,0,0,0.4)]">
                              {item.label}
                            </span>
                          </div>
                        );
                      }
                      const m = item.message;
                      const replyId = (m as GroupMessageDto & { replyToId?: number | null }).replyToId ?? null;
                      const replyTarget = replyId != null ? messagesById.get(replyId) ?? null : null;
                      return (
                        <GroupMessageItem key={item.key} message={m}
                          isMe={m.senderId === user?.id} grouped={item.grouped} isLastOfGroup={item.last}
                          highlighted={highlightedMessageId === m.id}
                          reactions={reactions[String(m.id)] ?? EMPTY_REACTIONS}
                          currentUserId={user?.id} replyTarget={replyTarget}
                          onRequestProfile={setProfileModalUserId} onOpenMenu={handleOpenMenu}
                          onStartReply={handleStartReply} onReact={handleReact} onJumpToReply={jumpToMessage} />
                      );
                    })}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>

              {isDraggingFile && (
                <div className="absolute inset-2 z-30 bg-[#D97706]/[0.08] border-2 border-dashed border-[#D97706]/60 rounded-2xl flex flex-col items-center justify-center pointer-events-none backdrop-blur-sm">
                  <div className="w-14 h-14 rounded-full bg-[#D97706]/20 flex items-center justify-center mb-2">
                    <ImageIcon className="w-6 h-6 text-[#D97706]" />
                  </div>
                  <p className="text-[14px] font-semibold text-[#D97706]">Drop to send</p>
                  <p className="text-[11.5px] text-[#D97706]/70 mt-1">Release to send to {activeGroup.name}</p>
                </div>
              )}

              <CallPill
                inCall={call.inCall}
                activeCallers={call.activeCallers}
                participants={enrichedParticipants}
                muted={call.muted}
                myName={user?.displayName ?? 'You'}
                myAvatarUrl={myFreshProfile?.avatarUrl ?? user?.avatarUrl ?? null}
                maxParticipants={MAX_PARTICIPANTS}
                bannerText={activeCallBanner}
                onToggleMute={call.toggleMute}
                onLeave={call.leave}
                onJoin={() => {
                  void call.join().then(() => setCallExpanded(true)).catch(() => { /* hook handles error */ });
                }}
                onOpenStage={() => setCallExpanded(true)}
              />
            </div>

            {showJumpToLatest && (
              <button onClick={handleJumpToLatest}
                className="absolute bottom-24 right-6 z-30 w-10 h-10 rounded-full bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] shadow-xl flex items-center justify-center transition-colors"
                aria-label="Jump to latest">
                <ChevronDown className="w-5 h-5" />
                {unreadWhileScrolled > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#22C55E] text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-[#0B0A08]">
                    {unreadWhileScrolled > 99 ? '99+' : unreadWhileScrolled}
                  </span>
                )}
              </button>
            )}

            {typingUsers.length > 0 && (
              <div className="px-4 sm:px-6 pb-2 flex items-center gap-2">
                <div className="flex -space-x-2">
                  {typingUsers.slice(0, 3).map((u) => (
                    <div key={u.userId} className="rounded-full ring-2 ring-[#0B0A08]">
                      <Avatar name={u.handle || 'User'} size="sm" />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-[#1A1816] border border-white/[0.04]">
                  <span className="w-1 h-1 rounded-full bg-[#6B6259] animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1 h-1 rounded-full bg-[#6B6259] animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1 h-1 rounded-full bg-[#6B6259] animate-bounce" />
                </div>
                <span className="text-[11px] text-[#6B6259]">{typingLabel}</span>
              </div>
            )}

            {call.error && !call.inCall && (
              <div className="px-3 sm:px-5 py-2 border-t border-white/[0.05] bg-[#131110]">
                <div className="flex items-center gap-2 text-[11.5px] text-[#F87171]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{call.error}</span>
                  <button type="button" onClick={() => void call.join()}
                    className="ml-auto shrink-0 text-[11px] font-semibold underline hover:no-underline">
                    Retry
                  </button>
                </div>
              </div>
            )}

            <GroupComposer key={activeGroupId} groupId={activeGroupId} targetName={activeGroup.name}
              replyTo={replyTo} onCancelReply={handleCancelReply}
              onSendText={handleSendText} onSendFile={handleSendFile} onSendVoice={handleSendVoice} />

            {call.inCall && enrichedParticipants.map((p) => (
              <audio
                key={`${p.userId}:${p.stream.id}`}
                autoPlay
                playsInline
                ref={(el) => {
                  if (el) {
                    el.srcObject = p.stream;
                    el.muted = locallyMuted.has(p.userId);
                    audioElsRef.current.set(p.userId, el);
                  } else {
                    audioElsRef.current.delete(p.userId);
                  }
                }}
              />
            ))}
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 p-6">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Hash className="w-7 h-7 text-[#6B6259]" />
            </div>
            <div>
              <p className="text-[15px] text-[#EDE5D4] font-semibold tracking-tight">Select a group</p>
              <p className="text-[12.5px] text-[#6B6259] mt-1">Choose a channel from the left sidebar or create a new one.</p>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {activeGroup && (
        <GroupInfoModal open={infoOpen} group={activeGroup} currentUserId={user?.id}
          onClose={() => setInfoOpen(false)} onLeave={handleLeaveGroup} onDelete={handleDeleteGroup}
          onRemoveMember={handleRemoveMember} onAddMember={handleAddMember} onViewProfile={setProfileModalUserId} />
      )}

      {menuMessage && (
        <MessageMenu message={menuMessage} isMe={menuMessage.senderId === user?.id}
          reactions={reactions[String(menuMessage.id)] ?? EMPTY_REACTIONS}
          currentUserId={user?.id} onClose={() => setMenuMessage(null)}
          onReact={(emoji) => handleReact(menuMessage.id as number, emoji)}
          onReply={() => handleStartReply(menuMessage)}
          onCopy={() => { const t = menuMessage.content ?? ''; if (t) void navigator.clipboard.writeText(t); }}
          onDeleteForMe={() => handleDeleteForMe(menuMessage)}
          onDeleteForEveryone={() => handleRequestDeleteForEveryone(menuMessage)} />
      )}

      {pendingDeleteEveryoneId != null && (
        <div className="fixed inset-0 z-[190] bg-black/65 flex items-center justify-center p-4" onClick={() => setPendingDeleteEveryoneId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-[22px] bg-[#1C1A17] border border-white/[0.08] shadow-2xl overflow-hidden">
            <div className="p-5">
              <h3 className="text-[14.5px] font-bold text-[#EDE5D4] mb-1.5">Delete for everyone?</h3>
              <p className="text-[12.5px] text-[#A8A29E] leading-relaxed">
                This message will be removed for every member of {activeGroup?.name ?? 'the group'}. This cannot be undone.
              </p>
            </div>
            <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-end gap-2">
              <button onClick={() => setPendingDeleteEveryoneId(null)}
                className="h-9 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] font-medium text-[#EDE5D4] transition-colors">Cancel</button>
              <button onClick={() => void handleConfirmDeleteForEveryone()}
                className="h-9 px-4 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[12.5px] font-semibold transition-colors">Delete for everyone</button>
            </div>
          </div>
        </div>
      )}

      {chatMenuGroup && (
        <GroupContextMenu group={chatMenuGroup}
          isPinned={pinnedIds.has(String(chatMenuGroup.id))} isMuted={mutedIds.has(String(chatMenuGroup.id))}
          onClose={() => setChatMenuGroup(null)} onPin={() => togglePin(String(chatMenuGroup.id))}
          onMute={() => toggleMute(String(chatMenuGroup.id))}
          onMarkRead={() => { /* not tracked server-side for groups */ }}
          onClearChat={() => { if (chatMenuGroup.id === activeGroupId) { setMessages([]); setHiddenIds(new Set()); } }}
          onLeave={async () => { try { await apiService.leaveGroup(chatMenuGroup.id); await fetchGroups(); } catch (err) { alert(`Leave failed: ${extractErrorMessage(err)}`); } }}
          onDelete={async () => { try { await apiService.deleteGroup(chatMenuGroup.id); await fetchGroups(); } catch (err) { alert(`Delete failed: ${extractErrorMessage(err)}`); } }} />
      )}

      <UserProfileModal userId={profileModalUserId} onClose={() => setProfileModalUserId(null)} />

      {activeGroupId && (
        <VoiceStage
          open={callExpanded && call.inCall}
          onClose={() => setCallExpanded(false)}
          groupId={activeGroupId}
          groupName={activeGroup?.name ?? 'Voice'}
          inCall={call.inCall}
          participants={enrichedParticipants}
          muted={call.muted}
          locallyMuted={locallyMuted}
          currentUser={user ? {
            id: user.id,
            displayName: user.displayName,
            avatarUrl: myFreshProfile?.avatarUrl ?? user.avatarUrl ?? null,
          } : undefined}
          messages={visibleMessages}
          onToggleMute={call.toggleMute}
          onToggleLocalMute={toggleLocalMute}
          onLeave={call.leave}
          onSendMessage={handleSendText}
        />
      )}

      <AnimatePresence>
        {createModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreateModalOpen(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#1A1816] border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
              <h2 className="text-[16px] font-semibold text-[#EDE5D4] mb-1">Create Channel</h2>
              <p className="text-[12px] text-[#6B6259] mb-4">Start a group to chat with multiple teammates or friends.</p>
              {createError && (
                <div className="mb-4 p-2.5 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-[12px] text-[#F87171] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /><span>{createError}</span>
                </div>
              )}
              <form onSubmit={handleCreateGroup} className="space-y-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#A8A29E] font-medium mb-1.5">Channel Name</label>
                  <input type="text" required value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g. general-discussion"
                    className="w-full px-3 py-2 rounded-lg bg-[#0F0D0A] border border-white/[0.08] text-[#EDE5D4] text-[13px] outline-none focus:border-[#D97706]/60 transition-colors" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#A8A29E] font-medium mb-1.5">Description (optional)</label>
                  <input type="text" value={newGroupDescription} onChange={(e) => setNewGroupDescription(e.target.value)}
                    placeholder="What is this channel about?"
                    className="w-full px-3 py-2 rounded-lg bg-[#0F0D0A] border border-white/[0.08] text-[#EDE5D4] text-[13px] outline-none focus:border-[#D97706]/60 transition-colors" />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setCreateModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[12.5px] text-[#EDE5D4] transition-colors">Cancel</button>
                  <button type="submit" disabled={createLoading || !newGroupName.trim()}
                    className="px-4 py-2 rounded-lg bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 text-[#0F0D0A] font-semibold text-[12.5px] transition-colors flex items-center gap-1.5">
                    {createLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Create</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio ref={disconnectRef} src="/sounds/disconnect.mp3" preload="none" />
    </div>
  );
}