/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiService, API_BASE_URL, getAccessToken } from '../services/api';
import { signalRService } from '../services/signalr';
import { presenceStore } from '../services/presenceStore';
import { encryptFor, getPublicKeyFor, decryptOne } from '../services/cryptoService';
import { playReceive } from '../services/sounds';
import {
  registerServiceWorker,
  showDmNotification,
} from '../services/serviceWorker';
import { useAuth } from './AuthContext';
import { Avatar } from '../components/Avatar';
import { MessageSquare, X } from 'lucide-react';
import {
  CallEndedPayload,
  CallSessionDto,
  CallSessionStatus,
  CallSignalPayload,
  CallType,
  DirectMessageDto,
  MediaType,
} from '../types/api';

export interface CallSignalMessage {
  type: 'offer' | 'answer' | 'candidate' | 'ringing';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  [key: string]: unknown;
}

export type CallState =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'connecting'
  | 'active'
  | 'ending';

export interface CallContextType {
  session: CallSessionDto | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  isSpeakerOn: boolean;
  isMinimized: boolean;
  incomingCall: CallSessionDto | null;
  peerId: string | null;
  callState: CallState;
  duration: number;
  peerRinging: boolean;
  initiateCall: (peerId: string, callType: number) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  setSpeakerOn: (on: boolean) => void;
  minimize: () => void;
  expand: () => void;
  replaceVideoTrack: (track: MediaStreamTrack) => void;

  /* ── DM notifications ─────────────────────────────── */

  unreadCounts: Record<string, number>;
  totalUnread: number;
  clearUnread: (userId: string) => void;
  requestNotificationPermission: () => Promise<void>;
  notificationPermission: NotificationPermission | 'unsupported';

  /**
   * Prefetched DM history keyed by sender id. Populated as notifications
   * arrive so `DirectMessagePane` can render instantly on click. The pane
   * is free to ignore this — it's an optional cache.
   */
  prefetchedHistory: Map<string, DirectMessageDto[]>;
  /** Read + clear the prefetch for a peer. */
  consumePrefetchedHistory: (userId: string) => DirectMessageDto[] | null;
}

export const CallContext = createContext<CallContextType | undefined>(undefined);

export interface CallProviderProps {
  children: React.ReactNode;
}

const ACTIVE_CALL_STORAGE_KEY = 'orbital.activeCallSessionId';
const DISCONNECT_WATCHDOG_MS = 30000;
const API_TIMEOUT_MS = 5000;
const SESSION_TIMEOUT_MS = 15000;
const RING_ACK_TIMEOUT_MS = 20000;

/* ─────────────────────────────────────────────────────────
   DM notification helpers
   ───────────────────────────────────────────────────────── */

const DM_UNREAD_KEY = (uid: string) => `orbital.unreadDms.${uid}`;
const NOTIF_PROMPTED_KEY = 'orbital.notifPrompted.v1';

function readDmUnread(uid: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(DM_UNREAD_KEY(uid));
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeDmUnread(uid: string, data: Record<string, number>) {
  try {
    localStorage.setItem(DM_UNREAD_KEY(uid), JSON.stringify(data));
  } catch {
    /* quota */
  }
}

function isInDmSection(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/app/dm')
  );
}

/**
 * Turn a raw DM into a single-line human preview.
 * Strips internal control payloads so `[call:audio:missed:0]` never leaks.
 */
function previewTextFor(msg: DirectMessageDto): string {
  let body = msg.plaintext ?? msg.content ?? '';

  const callMatch = body.match(
    /^\[call:(audio|video):(answered|missed|declined):\d+\]$/,
  );
  if (callMatch) {
    return callMatch[1] === 'video' ? '🎥 Video call' : '📞 Audio call';
  }

  if (/^\[react:/.test(body)) return '👍 Reacted';
  if (body.startsWith('[sticker]')) return '🎨 Sticker';
  if (body.startsWith('[v1]')) body = body.slice(4);

  const replyMatch = body.match(/^\[reply:(-?\d+)\]/);
  if (replyMatch) body = body.slice(replyMatch[0].length);

  const trimmed = body.trim();

  if (msg.mediaType === MediaType.Image) return trimmed || '📷 Photo';
  if (msg.mediaType === MediaType.Video) return '🎥 Video';
  if (msg.mediaType === MediaType.Audio) return '🎤 Voice message';
  if (msg.mediaType === MediaType.File) return trimmed || '📎 File';

  return trimmed || 'New message';
}

/**
 * In-app message toast.
 *
 * The entire card body is the "open chat" affordance — one big click
 * target, no footer buttons. A single subtle X in the top-right corner
 * dismisses without opening.
 */
function MessageToast({
  name,
  avatarUrl,
  preview,
  onOpen,
  onDismiss,
}: {
  name: string;
  avatarUrl?: string | null;
  preview: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="relative w-[320px] rounded-2xl bg-[#1A1816] border border-white/[0.08] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        className="w-full p-3.5 pr-11 flex items-start gap-3 text-left hover:bg-white/[0.03] active:bg-white/[0.06] transition-colors"
      >
        <Avatar name={name} src={avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[#D97706]">
            <MessageSquare className="w-3 h-3" />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em]">
              New message
            </span>
          </div>
          <p className="text-[13.5px] font-bold text-[#EDE5D4] truncate mt-0.5 tracking-tight">
            {name}
          </p>
          <p className="text-[12px] text-[#A8A29E] mt-0.5 leading-snug line-clamp-2">
            {preview}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-md flex items-center justify-center text-[#6B6259] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="h-[3px] bg-gradient-to-r from-[#D97706] via-[#F59E0B] to-transparent" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Ringtone — Web Audio, soft & phone-like
   ───────────────────────────────────────────────────────── */

interface ToneStep {
  freq: number;
  durationMs: number;
  gapAfterMs?: number;
}

interface RingtoneOptions {
  pattern: ToneStep[];
  silenceMs: number;
  volume?: number;
  wave?: OscillatorType;
}

function useRingtone(
  active: boolean,
  { pattern, silenceMs, volume = 0.12, wave = 'sine' }: RingtoneOptions,
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  const patternKey = useMemo(
    () =>
      pattern
        .map((s) => `${s.freq}:${s.durationMs}:${s.gapAfterMs ?? 0}`)
        .join('|'),
    [pattern],
  );

  useEffect(() => {
    if (!active) return;
    if (typeof window === 'undefined') return;

    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      ctxRef.current = new Ctx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const burstMs = pattern.reduce(
      (sum, step) => sum + step.durationMs + (step.gapAfterMs ?? 0),
      0,
    );

    const playBurst = () => {
      try {
        let t = ctx.currentTime + 0.02;
        pattern.forEach((step) => {
          const dur = step.durationMs / 1000;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = wave;
          osc.frequency.value = step.freq;

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(volume, t + 0.08);
          gain.gain.setValueAtTime(volume, t + Math.max(0.09, dur - 0.08));
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + dur);
          t += dur + (step.gapAfterMs ?? 0) / 1000;
        });
      } catch {
        /* ignore */
      }
    };

    playBurst();
    timerRef.current = window.setInterval(playBurst, burstMs + silenceMs);

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, patternKey, silenceMs, volume, wave]);

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);
}

/* ─────────────────────────────────────────────────────────
   Audio-file ringtone — loops an actual MP3/audio file.
   ───────────────────────────────────────────────────────── */

function useAudioRingtone(
  active: boolean,
  src: string,
  volume = 0.35,
  loop = true,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!active) {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
      return;
    }

    if (!audioRef.current) {
      const el = new Audio(src);
      el.loop = loop;
      el.volume = volume;
      el.preload = 'auto';
      audioRef.current = el;
    }

    const el = audioRef.current;
    el.volume = volume;

    el.play().catch(() => {
      const resume = () => {
        el.play().catch(() => {});
        document.removeEventListener('click', resume);
        document.removeEventListener('touchstart', resume);
      };
      document.addEventListener('click', resume, { once: true });
      document.addEventListener('touchstart', resume, { once: true });
    });

    return () => {
      el.pause();
      el.currentTime = 0;
    };
  }, [active, src, volume, loop]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);
}

/* ── Ringtone presets ────────────────────────────────────── */

const RINGBACK_PATTERN: ToneStep[] = [
  { freq: 587.33, durationMs: 320, gapAfterMs: 90 },
  { freq: 880.0, durationMs: 520, gapAfterMs: 0 },
];

const INCOMING_SOFT_PATTERN: ToneStep[] = [
  { freq: 880.0, durationMs: 180, gapAfterMs: 50 },
  { freq: 1108.73, durationMs: 180, gapAfterMs: 50 },
  { freq: 1318.51, durationMs: 300, gapAfterMs: 110 },
  { freq: 1174.66, durationMs: 200, gapAfterMs: 60 },
  { freq: 987.77, durationMs: 420, gapAfterMs: 0 },
];

const END_PATTERN: ToneStep[] = [
  { freq: 659.25, durationMs: 140, gapAfterMs: 50 },
  { freq: 493.88, durationMs: 260, gapAfterMs: 0 },
];

/* ── Timeout helper ──────────────────────────────────────── */

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer != null) window.clearTimeout(timer);
  }
}

/* ─────────────────────────────────────────────────────────
   Audio unlock — silent play on first user gesture
   ───────────────────────────────────────────────────────── */

function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};

  let unlocked = false;

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;

    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        ctx.close().catch(() => {});
      }
    } catch {
      /* ignore */
    }

    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('keydown', unlock);
  };

  document.addEventListener('click', unlock, { once: false });
  document.addEventListener('touchstart', unlock, { once: false });
  document.addEventListener('keydown', unlock, { once: false });

  return () => {
    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('keydown', unlock);
  };
}

/* ─────────────────────────────────────────────────────────
   Provider
   ───────────────────────────────────────────────────────── */

/**
 * The single in-app notification currently visible.
 *
 * Rendered via a portal directly into document.body — bypassing Sonner
 * entirely — so it can only ever appear ONCE, regardless of how many
 * `<Toaster>` components are mounted elsewhere in the app.
 */
interface ActiveNotification {
  senderId: string;
  senderName: string;
  avatarUrl: string | null;
  preview: string;
}

function CallProviderComponent({
  children,
}: CallProviderProps): React.JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();

  const myUserId = user?.id ?? null;

  const [session, setSession] = useState<CallSessionDto | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<CallSessionDto | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [endToneActive, setEndToneActive] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [peerRinging, setPeerRinging] = useState<boolean>(false);

  /* ── DM notification state ───────────────────────────── */

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(
    () => (myUserId ? readDmUnread(myUserId) : {}),
  );

  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof Notification !== 'undefined'
      ? Notification.permission
      : 'unsupported',
  );

  /**
   * Prefetch cache. Populated as soon as a notification is queued so the
   * DM pane can render instantly on click. Keyed by sender id.
   * `useCall()` consumers (i.e. DirectMessagePane) can call
   * `consumePrefetchedHistory(senderId)` to skip the initial fetch+decrypt.
   */
  const prefetchedHistoryRef = useRef<Map<string, DirectMessageDto[]>>(
    new Map(),
  );
  const [prefetchedHistory, setPrefetchedHistory] = useState<
    Map<string, DirectMessageDto[]>
  >(() => new Map());

  /**
   * The single in-app notification. Only one can exist at a time — a new
   * message replaces the current notification rather than stacking.
   * Rendered via createPortal below, so it is fully independent of any
   * `<Toaster>` instances elsewhere in the app. Fixes the duplicate-toast
   * problem when the app mounts multiple Toasters.
   */
  const [activeNotification, setActiveNotification] =
    useState<ActiveNotification | null>(null);
  const notifTimerRef = useRef<number | null>(null);

  const notificationPermissionRef = useRef(notificationPermission);
  notificationPermissionRef.current = notificationPermission;

  const lastSoundAtRef = useRef<Record<string, number>>({});

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef<boolean>(false);
  const pendingRemoteOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const activePeerIdRef = useRef<string | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const sessionRef = useRef<CallSessionDto | null>(null);
  const incomingCallRef = useRef<CallSessionDto | null>(null);
  const callStartedAtRef = useRef<number | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const callInitiatedByMeRef = useRef<boolean>(false);
  const callAnsweredRef = useRef<boolean>(false);

  const ringAckTimerRef = useRef<number | null>(null);

  const audioSinkRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => installAudioUnlock(), []);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (audioSinkRef.current) return;

    const el = document.createElement('audio');
    el.autoplay = true;
    el.muted = false;
    el.volume = 1;
    el.setAttribute('playsinline', '');
    el.setAttribute('data-call-audio-sink', 'true');
    el.style.display = 'none';
    el.srcObject = null;

    document.body.appendChild(el);
    audioSinkRef.current = el;

    return () => {
      try {
        el.pause();
        el.srcObject = null;
      } catch {
        /* ignore */
      }
      el.remove();
      audioSinkRef.current = null;
    };
  }, []);

  /* ── Service worker + click-through navigation ───────── */
  //
  // Registers the SW once so `registration.showNotification()` works on
  // Android Chrome and installed iOS PWAs (both of which reject the plain
  // `new Notification()` constructor). Also listens for the SW's
  // "NAVIGATE" message, which is posted when the user clicks a system
  // notification — this navigates the SPA without a full page reload.
  useEffect(() => {
    void registerServiceWorker();

    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'NAVIGATE' &&
        typeof event.data.url === 'string'
      ) {
        navigate(event.data.url);
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [navigate]);

  /* ── DM unread persistence + hydrate ─────────────────── */

  useEffect(() => {
    if (!myUserId) {
      setUnreadCounts({});
      return;
    }
    setUnreadCounts(readDmUnread(myUserId));
  }, [myUserId]);

  useEffect(() => {
    if (!myUserId) return;
    writeDmUnread(myUserId, unreadCounts);
  }, [myUserId, unreadCounts]);

  const clearUnread = useCallback((peer: string) => {
    setUnreadCounts((prev) => {
      if (!prev[peer]) return prev;
      const next = { ...prev };
      delete next[peer];
      return next;
    });
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    if (
      Notification.permission === 'granted' ||
      Notification.permission === 'denied'
    ) {
      setNotificationPermission(Notification.permission);
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotificationPermission(result);
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Read + clear the prefetched history for a peer.
   * Called by DirectMessagePane (optional). Returns null if nothing cached.
   */
  const consumePrefetchedHistory = useCallback(
    (peer: string): DirectMessageDto[] | null => {
      const cached = prefetchedHistoryRef.current.get(peer);
      if (!cached) return null;
      prefetchedHistoryRef.current.delete(peer);
      // Mirror into state so consumers can react to invalidation.
      setPrefetchedHistory(new Map(prefetchedHistoryRef.current));
      return cached;
    },
    [],
  );

  /* ── Dismiss helpers for the portal notification ─────── */

  const dismissActiveNotification = useCallback(() => {
    if (notifTimerRef.current != null) {
      window.clearTimeout(notifTimerRef.current);
      notifTimerRef.current = null;
    }
    setActiveNotification(null);
  }, []);

  // Clean up the pending notification timer on unmount.
  useEffect(() => {
    return () => {
      if (notifTimerRef.current != null) {
        window.clearTimeout(notifTimerRef.current);
        notifTimerRef.current = null;
      }
    };
  }, []);

  /* ── Global DM listener (notifications + prefetch) ───── */
  useEffect(() => {
    if (!myUserId) return;

    const unsub = signalRService.onReceiveDirectMessage(
      async (msg: DirectMessageDto) => {
        if (msg.recipientId !== myUserId) return;
        if (!msg.senderId || msg.senderId === myUserId) return;

        const senderId = msg.senderId;
        const paneMounted = isInDmSection();
        const tabHidden =
          typeof document !== 'undefined' && document.hidden;

        // ── Unread ────────────────────────────────────────
        if (!paneMounted) {
          setUnreadCounts(() => {
            const fresh = readDmUnread(myUserId);
            fresh[senderId] = (fresh[senderId] ?? 0) + 1;
            return fresh;
          });
        }

        // ── Sound ─────────────────────────────────────────
        if (!paneMounted) {
          const now = Date.now();
          const last = lastSoundAtRef.current[senderId] ?? 0;
          if (now - last > 1500) {
            try {
              playReceive();
            } catch {
              /* ignore */
            }
            lastSoundAtRef.current[senderId] = now;
          }
        }

        // ── Ultra-fast prefetch ───────────────────────────
        // Fire-and-forget: fetch full history for this peer so the DM pane
        // has data ready the instant the user taps the notification. We
        // stash the raw DTOs (un-decrypted — the pane handles that) in a
        // module-level cache. Multiple messages from the same sender within
        // a short window coalesce into one fetch.
        if (!paneMounted && !prefetchedHistoryRef.current.has(senderId)) {
          void apiService
            .getDmHistory(senderId, 200)
            .then((history) => {
              prefetchedHistoryRef.current.set(senderId, history);
              // Public mirror — cheap since consumers only read on mount.
              setPrefetchedHistory(new Map(prefetchedHistoryRef.current));
            })
            .catch(() => {
              /* silent */
            });
        }

        // ── Resolve display data ──────────────────────────
        let senderName = 'Someone';
        let avatarUrl: string | null = null;
        let preview = 'New message';
        try {
          const profile = await apiService.getUserProfile(senderId);
          senderName =
            profile?.displayName || profile?.userHandle || senderName;
          avatarUrl = profile?.avatarUrl ?? null;
        } catch {
          /* ignore */
        }
        try {
          const decrypted = await decryptOne(msg, myUserId);
          preview = previewTextFor(decrypted);
        } catch {
          /* ignore */
        }

        // ── Browser notification (tab is hidden) ──────────
        // Routed through the service worker (via `showDmNotification`),
        // which is the ONLY path that works on Android Chrome and
        // installed iOS PWAs. Falls back to `new Notification()` on
        // desktop browsers that don't have a SW yet.
        if (
          tabHidden &&
          notificationPermissionRef.current === 'granted' &&
          typeof Notification !== 'undefined'
        ) {
          await showDmNotification({
            senderId,
            senderName,
            preview,
            avatarUrl,
          });
          return;
        }

        // ── In-app notification ───────────────────────────
        // Rendered via createPortal (below). Only one can be visible at
        // a time — a new message replaces the previous notification.
        // Bypassing Sonner entirely eliminates the duplicate-toast issue
        // that occurs when more than one <Toaster> is mounted.
        if (!tabHidden && !paneMounted) {
          if (notifTimerRef.current != null) {
            window.clearTimeout(notifTimerRef.current);
            notifTimerRef.current = null;
          }
          setActiveNotification({
            senderId,
            senderName,
            avatarUrl,
            preview,
          });
          notifTimerRef.current = window.setTimeout(() => {
            setActiveNotification(null);
            notifTimerRef.current = null;
          }, 6000);
        }
      },
    );

    return unsub;
  }, [myUserId, navigate]);

  /* ── Auto-request Notification permission (once ever) ── */

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    try {
      if (localStorage.getItem(NOTIF_PROMPTED_KEY) === '1') return;
    } catch {
      /* ignore */
    }

    const ask = () => {
      try {
        localStorage.setItem(NOTIF_PROMPTED_KEY, '1');
      } catch {
        /* ignore */
      }
      void requestNotificationPermission();
      document.removeEventListener('click', ask);
      document.removeEventListener('touchstart', ask);
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('click', ask, { once: true });
      document.addEventListener('touchstart', ask, { once: true });
    }, 3000);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', ask);
      document.removeEventListener('touchstart', ask);
    };
  }, [requestNotificationPermission]);

  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((s, n) => s + n, 0),
    [unreadCounts],
  );

  /* ── Ringtone ────────────────────────────────────────── */

  const isOutgoingRinging = callState === 'outgoing' && !isMinimized;
  const isIncomingRinging = callState === 'incoming';

  useAudioRingtone(isOutgoingRinging, '/sounds/outgoing.mp3', 0.25);
  useAudioRingtone(isIncomingRinging, '/sounds/ringtone.mp3', 0.35);
  useAudioRingtone(endToneActive, '/sounds/disconnect.mp3', 0.3, false);

  const playEndTone = useCallback(() => {
    setEndToneActive(true);
    window.setTimeout(() => setEndToneActive(false), 1500);
  }, []);

  /* ── Duration ticker ─────────────────────────────────── */

  useEffect(() => {
    if (callState !== 'active') {
      setDuration(0);
      return;
    }
    const tick = () => {
      const start = callStartedAtRef.current;
      if (start == null) {
        setDuration(0);
        return;
      }
      setDuration(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [callState]);

  /* ── Peer ID resolver ────────────────────────────────── */

  const resolvePeerId = useCallback(
    (
      s?: CallSessionDto | null,
      incoming?: CallSessionDto | null,
    ): string | null => {
      const stored = activePeerIdRef.current;
      if (stored && stored !== myUserId) return stored;

      const candidates: Array<string | undefined> = [
        s?.peerId,
        s?.initiatorId,
        incoming?.initiatorId,
        incoming?.peerId,
      ];

      for (const id of candidates) {
        if (id && id !== myUserId) return id;
      }
      return null;
    },
    [myUserId],
  );

  /* ── Watchdogs ───────────────────────────────────────── */

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current != null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const clearRingAckTimer = useCallback(() => {
    if (ringAckTimerRef.current != null) {
      window.clearTimeout(ringAckTimerRef.current);
      ringAckTimerRef.current = null;
    }
  }, []);

  const teardownRef = useRef<((opts?: { playTone?: boolean }) => void) | null>(
    null,
  );

  const endCallRef = useRef<(() => Promise<void>) | null>(null);

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      console.warn('[Call] Watchdog fired — forcing endCall');
      toast.warning('Call ended — the other side didn’t answer.');
      void endCallRef.current?.();
    }, DISCONNECT_WATCHDOG_MS);
  }, [clearWatchdog]);

  /* ── ICE config (STUN only, no TURN) ─────────────────── */
  //
  // No relay servers are configured. All calls rely on direct
  // peer-to-peer connectivity via STUN hole-punching. This works on
  // most home / mixed networks, but will fail when either peer sits
  // behind a symmetric NAT (mobile carriers, CGNAT) or a UDP-blocking
  // firewall. When that happens `pc.iceConnectionState` becomes
  // `'failed'` and the existing handler tears the call down.

  const getRtcConfiguration = useCallback(async (): Promise<RTCConfiguration> => {
    console.log('[Call] ICE config: STUN only (TURN removed)');
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      iceTransportPolicy: 'all',
    };
  }, []);

  /* ── Teardown ────────────────────────────────────────── */

  const teardown = useCallback(
    (opts: { playTone?: boolean } = {}) => {
      clearWatchdog();
      clearRingAckTimer();

      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.onicecandidate = null;
          peerConnectionRef.current.ontrack = null;
          peerConnectionRef.current.onconnectionstatechange = null;
          peerConnectionRef.current.oniceconnectionstatechange = null;
          peerConnectionRef.current.close();
        } catch {
          /* ignore */
        }
        peerConnectionRef.current = null;
      }

      localStreamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      localStreamRef.current = null;

      remoteStreamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      remoteStreamRef.current = null;

      screenStreamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      screenStreamRef.current = null;

      if (audioSinkRef.current) {
        const sink = audioSinkRef.current;
        const current = sink.srcObject;
        if (current instanceof MediaStream) {
          current.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              /* ignore */
            }
          });
        }
        try {
          sink.pause();
        } catch {
          /* ignore */
        }
        sink.srcObject = null;
      }

      remoteDescriptionSetRef.current = false;
      pendingRemoteOfferRef.current = null;
      activePeerIdRef.current = null;
      callStartedAtRef.current = null;
      iceCandidateQueueRef.current = [];

      callInitiatedByMeRef.current = false;
      callAnsweredRef.current = false;

      setLocalStream(null);
      setRemoteStream(null);
      setSession(null);
      setIncomingCall(null);
      setPeerId(null);
      setIsMuted(false);
      setIsVideoOff(false);
      setIsScreenSharing(false);
      setIsSpeakerOn(true);
      setIsMinimized(false);
      setCallState('idle');
      setDuration(0);
      setPeerRinging(false);

      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
      }

      if (opts.playTone) playEndTone();
    },
    [clearWatchdog, clearRingAckTimer, playEndTone],
  );

  useEffect(() => {
    teardownRef.current = teardown;
  }, [teardown]);

  /* ── ICE queue ───────────────────────────────────────── */

  const drainIceCandidateQueue = useCallback(async (pc: RTCPeerConnection) => {
    remoteDescriptionSetRef.current = true;
    while (iceCandidateQueueRef.current.length > 0) {
      const candidateInit = iceCandidateQueueRef.current.shift();
      if (!candidateInit) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch {
        /* ignore */
      }
    }
  }, []);

  /* ── Media ───────────────────────────────────────────── */

  const acquireMediaStream = useCallback(
    async (callType: number): Promise<MediaStream> => {
      const hasVideo = callType === CallType.Video;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: hasVideo
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user',
            }
          : false,
      });

      stream.getTracks().forEach((t) => {
        t.enabled = true;
      });

      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();

      console.log('[Call] Local media acquired', {
        audio: audioTracks.map((t) => ({
          label: t.label,
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
        })),
        video: videoTracks.map((t) => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
        })),
      });

      if (audioTracks.length === 0) {
        throw new Error('Microphone not available. Check permissions.');
      }
      if (hasVideo && videoTracks.length === 0) {
        throw new Error('Camera not available. Check permissions.');
      }

      localStreamRef.current = stream;
      return stream;
    },
    [],
  );

  /* ── Peer connection ─────────────────────────────────── */

  const createPeerConnection = useCallback(
    async (
      targetSessionId: string,
      targetPeerId: string,
      stream: MediaStream,
      _callType: number,
    ): Promise<RTCPeerConnection> => {
      const config = await getRtcConfiguration();
      const pc = new RTCPeerConnection(config);
      peerConnectionRef.current = pc;
      remoteDescriptionSetRef.current = false;
      activePeerIdRef.current = targetPeerId;

      if (typeof window !== 'undefined') {
        (window as unknown as { __pc?: RTCPeerConnection }).__pc = pc;
      }

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event: RTCTrackEvent) => {
        event.track.enabled = true;

        console.log('[Call] Remote track received', {
          kind: event.track.kind,
          id: event.track.id,
          enabled: event.track.enabled,
          muted: event.track.muted,
          readyState: event.track.readyState,
        });

        event.track.addEventListener('unmute', () =>
          console.log('[Call] remote track UNMUTED', event.track.kind),
        );
        event.track.addEventListener('mute', () =>
          console.log('[Call] remote track muted', event.track.kind),
        );

        if (event.track.kind === 'audio') {
          const sink = audioSinkRef.current;
          if (sink) {
            const existing = sink.srcObject;

            if (
              existing instanceof MediaStream &&
              existing.getTracks().some((t) => t.id === event.track.id)
            ) {
              /* already wired up */
            } else {
              const fresh = new MediaStream();
              fresh.addTrack(event.track);

              if (existing instanceof MediaStream) {
                existing.getAudioTracks().forEach((t) => {
                  if (!fresh.getTracks().some((x) => x.id === t.id)) {
                    fresh.addTrack(t);
                  }
                });
              }

              try {
                sink.pause();
              } catch {
                /* ignore */
              }
              sink.srcObject = null;
              sink.srcObject = fresh;
            }

            sink.muted = !isSpeakerOn;
            sink.volume = isSpeakerOn ? 1 : 0;

            sink.play().catch((err) => {
              console.warn('[Call] Autoplay blocked, awaiting interaction:', err);
              const resume = () => {
                sink.play().catch(() => {});
                document.removeEventListener('click', resume);
                document.removeEventListener('touchstart', resume);
              };
              document.addEventListener('click', resume, { once: true });
              document.addEventListener('touchstart', resume, { once: true });
            });
          }
        }

        if (event.track.kind === 'video') {
          let target = remoteStreamRef.current;
          if (!target) {
            target = new MediaStream();
            remoteStreamRef.current = target;
            setRemoteStream(target);
          }
          if (!target.getTracks().some((t) => t.id === event.track.id)) {
            target.addTrack(event.track);
          }
          if (event.streams?.[0]) {
            event.streams[0].getVideoTracks().forEach((t) => {
              if (!target!.getTracks().some((x) => x.id === t.id)) {
                target!.addTrack(t);
              }
            });
          }
        }

        setCallState((prev) =>
          prev === 'connecting' || prev === 'outgoing' ? 'active' : prev,
        );
      };

      pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          void signalRService.sendCallSignal(targetSessionId, targetPeerId, {
            type: 'candidate',
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        console.log('[Call] PC state:', s);

        if (s === 'connected') {
          if (callStartedAtRef.current == null) {
            callStartedAtRef.current = Date.now();
          }
          clearWatchdog();
          clearRingAckTimer();
          setPeerRinging(false);
          callAnsweredRef.current = true;
          setCallState((prev) =>
            prev === 'connecting' || prev === 'outgoing' ? 'active' : prev,
          );
        } else if (s === 'failed' || s === 'closed') {
          console.warn('[Call] Peer connection:', s);
          if (callStateRef.current !== 'idle') {
            toast.error('Call connection lost.');
          }
          teardown({ playTone: true });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        console.log('[Call] ICE state:', s);
        if (s === 'failed') {
          teardown({ playTone: true });
        }
      };

      return pc;
    },
    [getRtcConfiguration, teardown, clearWatchdog, clearRingAckTimer, isSpeakerOn],
  );

  /* ── Call-to-chat logging ────────────────────────────── */

  const logCallToChat = useCallback(
    async (
      peer: string,
      callType: number,
      answered: boolean,
      durationSec: number,
    ) => {
      if (!user?.id) return;
      try {
        const kind = callType === CallType.Video ? 'video' : 'audio';
        const result = answered ? 'answered' : 'missed';
        const payload = `[call:${kind}:${result}:${Math.max(
          0,
          Math.floor(durationSec),
        )}]`;
        const pub = await getPublicKeyFor(peer);
        const enc = await encryptFor(pub, payload);
        await signalRService.sendDirectMessage({
          recipientId: peer,
          ciphertext: enc.ciphertext,
          nonce: enc.nonce,
          mediaUrl: undefined,
          mediaType: undefined,
        });
      } catch (err) {
        console.warn('[Call] Failed to log call event to chat:', err);
      }
    },
    [user?.id],
  );

  /* ── Initiate (caller) ───────────────────────────────── */

  const initiateCall = useCallback(
    async (targetPeerId: string, callType: number): Promise<void> => {
      if (!targetPeerId) {
        throw new Error('Peer ID is required to initiate a call.');
      }
      if (callStateRef.current !== 'idle') {
        throw new Error('A call is already in progress.');
      }

      if (audioSinkRef.current) {
        audioSinkRef.current.play().catch(() => {});
      }

      teardown();
      setCallState('outgoing');
      setPeerId(targetPeerId);
      activePeerIdRef.current = targetPeerId;

      callInitiatedByMeRef.current = true;
      callAnsweredRef.current = false;

      clearRingAckTimer();
      ringAckTimerRef.current = window.setTimeout(() => {
        console.warn('[Call] Ring-ACK timed out — peer never received the call.');
        toast.warning('Call couldn’t reach them.');
        void endCallRef.current?.();
      }, RING_ACK_TIMEOUT_MS);

      try {
        const stream = await acquireMediaStream(callType);
        setLocalStream(stream);

        const newSession = await withTimeout(
          apiService.initiateCall({ peerId: targetPeerId, callType }),
          SESSION_TIMEOUT_MS,
          'initiateCall',
        );
        setSession(newSession);

        const pc = await createPeerConnection(
          newSession.sessionId,
          targetPeerId,
          stream,
          callType,
        );

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await signalRService.sendCallSignal(
          newSession.sessionId,
          targetPeerId,
          { type: 'offer', sdp: offer.sdp },
        );
      } catch (err) {
        console.warn('[Call] initiateCall failed:', err);
        const s = sessionRef.current;
        if (s?.sessionId) {
          void apiService.endCall(s.sessionId).catch(() => {});
        }
        teardown();
        throw err;
      }
    },
    [teardown, acquireMediaStream, createPeerConnection, clearRingAckTimer],
  );

  /* ── Accept (callee) ─────────────────────────────────── */

  const acceptCall = useCallback(async (): Promise<void> => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;

    if (audioSinkRef.current) {
      audioSinkRef.current.play().catch(() => {});
    }

    const resolvedPeer = resolvePeerId(null, incoming);
    if (!resolvedPeer) {
      console.error('[Call] Cannot resolve peer ID from incoming call');
      teardown();
      return;
    }

    clearWatchdog();
    remoteDescriptionSetRef.current = false;
    activePeerIdRef.current = resolvedPeer;

    setCallState('connecting');
    setPeerId(resolvedPeer);

    callInitiatedByMeRef.current = false;
    callAnsweredRef.current = true;

    try {
      const stream = await acquireMediaStream(incoming.callType);
      setLocalStream(stream);
      setSession(incoming);
      setIncomingCall(null);

      try {
        await withTimeout(
          apiService.updateCallStatus(
            incoming.sessionId,
            CallSessionStatus.Active,
          ),
          SESSION_TIMEOUT_MS,
          'updateCallStatus',
        );
      } catch (err) {
        console.warn('[Call] Failed to update call status:', err);
      }

      const pc = await createPeerConnection(
        incoming.sessionId,
        resolvedPeer,
        stream,
        incoming.callType,
      );

      const offerSdp = pendingRemoteOfferRef.current;
      if (offerSdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
        await drainIceCandidateQueue(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await signalRService.sendCallSignal(incoming.sessionId, resolvedPeer, {
          type: 'answer',
          sdp: answer.sdp,
        });
        pendingRemoteOfferRef.current = null;
      } else {
        console.warn(
          '[Call] No pending offer at accept time — awaiting offer signal',
        );
      }
    } catch (err) {
      console.warn('[Call] acceptCall failed:', err);
      void apiService
        .updateCallStatus(incoming.sessionId, CallSessionStatus.Rejected)
        .catch(() => {});
      void signalRService
        .notifyCallEnded(incoming.sessionId, resolvedPeer)
        .catch(() => {});
      teardown();
      toast.error('Couldn’t join the call.');
    }
  }, [
    resolvePeerId,
    teardown,
    acquireMediaStream,
    createPeerConnection,
    drainIceCandidateQueue,
    clearWatchdog,
  ]);

  /* ── Reject ──────────────────────────────────────────── */

  const rejectCall = useCallback(async (): Promise<void> => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;

    const resolvedPeer = resolvePeerId(null, incoming);
    teardown();

    try {
      await withTimeout(
        apiService.updateCallStatus(
          incoming.sessionId,
          CallSessionStatus.Rejected,
        ),
        SESSION_TIMEOUT_MS,
        'reject',
      );
      if (resolvedPeer) {
        await withTimeout(
          signalRService.notifyCallEnded(incoming.sessionId, resolvedPeer),
          SESSION_TIMEOUT_MS,
          'notifyCallEnded',
        );
      }
    } catch (err) {
      console.warn('[Call] Reject cleanup error (ignored):', err);
    }
  }, [resolvePeerId, teardown]);

  /* ── End ─────────────────────────────────────────────── */

  const endCall = useCallback(async (): Promise<void> => {
    const currentSession = sessionRef.current;
    const currentIncoming = incomingCallRef.current;
    const currentSessionId =
      currentSession?.sessionId ?? currentIncoming?.sessionId;
    const resolvedPeer =
      activePeerIdRef.current ?? resolvePeerId(currentSession, currentIncoming);

    const wasCaller = callInitiatedByMeRef.current;
    const wasAnswered = callAnsweredRef.current;
    const startedAt = callStartedAtRef.current;
    const durationSec = startedAt
      ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      : 0;
    const callType =
      currentSession?.callType ?? currentIncoming?.callType ?? 0;

    const hadActiveCall = callStateRef.current !== 'idle';
    setCallState('ending');

    teardown({ playTone: hadActiveCall });

    if (wasCaller && resolvedPeer) {
      void logCallToChat(resolvedPeer, callType, wasAnswered, durationSec);
    }

    if (currentSessionId) {
      try {
        await withTimeout(
          apiService.endCall(currentSessionId),
          SESSION_TIMEOUT_MS,
          'endCall',
        );
      } catch (err) {
        console.warn('[Call] endCall API error (ignored):', err);
      }
      if (resolvedPeer) {
        try {
          await withTimeout(
            signalRService.notifyCallEnded(currentSessionId, resolvedPeer),
            SESSION_TIMEOUT_MS,
            'notifyCallEnded',
          );
        } catch (err) {
          console.warn('[Call] notifyCallEnded error (ignored):', err);
        }
      }
    }
  }, [resolvePeerId, teardown, logCallToChat]);

  useEffect(() => {
    endCallRef.current = endCall;
  }, [endCall]);

  /* ── Session storage ─────────────────────────────────── */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (session?.sessionId) {
      sessionStorage.setItem(ACTIVE_CALL_STORAGE_KEY, session.sessionId);
    } else {
      sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
    }
  }, [session]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBeforeUnload = () => {
      const activeId = sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
      if (!activeId) return;
      const token = getAccessToken();
      if (!token) return;
      const url = `${API_BASE_URL.replace(
        /\/+$/,
        '',
      )}/api/Call/${encodeURIComponent(activeId)}/end`;
      try {
        fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () =>
      window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stale = sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
    if (!stale) return;
    sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
    void apiService.endCall(stale).catch(() => {});
  }, []);

  /* ── Toggles ─────────────────────────────────────────── */

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const next = !isMuted;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setIsMuted(next);
  }, [localStream, isMuted]);

  const toggleVideo = useCallback(() => {
    if (!localStream) return;
    const next = !isVideoOff;
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    setIsVideoOff(next);
  }, [localStream, isVideoOff]);

  /* ── Screen share ────────────────────────────────────── */

  const stopScreenShare = useCallback(() => {
    const pc = peerConnectionRef.current;
    const sender = pc?.getSenders().find((s) => s.track?.kind === 'video');
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];

    if (sender && cameraTrack) {
      void sender.replaceTrack(cameraTrack).catch((err) => {
        console.warn('[Call] Failed to restore camera track:', err);
      });
    }

    screenStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    screenStreamRef.current = null;
    setIsScreenSharing(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc) {
      console.warn('[Call] No active peer connection for screen share');
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error('Screen sharing isn’t supported on this device.');
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const displayTrack = displayStream.getVideoTracks()[0];
      if (!displayTrack) {
        displayStream.getTracks().forEach((t) => t.stop());
        return;
      }

      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');

      if (sender) {
        await sender.replaceTrack(displayTrack);
      } else {
        pc.addTrack(displayTrack, displayStream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sessionId = sessionRef.current?.sessionId;
        const peer = activePeerIdRef.current;
        if (sessionId && peer) {
          await signalRService.sendCallSignal(sessionId, peer, {
            type: 'offer',
            sdp: offer.sdp,
          });
        }
      }

      screenStreamRef.current = displayStream;
      setIsScreenSharing(true);

      displayTrack.addEventListener('ended', () => {
        stopScreenShare();
      });
    } catch (err) {
      console.warn('[Call] Screen share cancelled or failed:', err);
      toast.error('Screen sharing couldn’t start.');
    }
  }, [stopScreenShare]);

  /* ── Camera flip ─────────────────────────────────────── */

  const replaceVideoTrack = useCallback((track: MediaStreamTrack) => {
    const pc = peerConnectionRef.current;
    if (!pc) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    void sender.replaceTrack(track).catch((err) => {
      console.warn('[Call] replaceVideoTrack failed:', err);
    });
  }, []);

  /* ── Speaker toggle ──────────────────────────────────── */

  const setSpeakerOn = useCallback((on: boolean) => {
    setIsSpeakerOn(on);
    const sink = audioSinkRef.current;
    if (sink) {
      sink.muted = !on;
      sink.volume = on ? 1 : 0;
    }
  }, []);

  const minimize = useCallback(() => setIsMinimized(true), []);
  const expand = useCallback(() => setIsMinimized(false), []);

  /* ── Signaling ───────────────────────────────────────── */

  const handleSignalMessage = useCallback(
    async (payload: CallSignalPayload) => {
      let messageData: CallSignalMessage;
      if (typeof payload.signalData === 'string') {
        try {
          messageData = JSON.parse(payload.signalData) as CallSignalMessage;
        } catch {
          return;
        }
      } else {
        messageData = payload.signalData as unknown as CallSignalMessage;
      }
      if (!messageData?.type) return;

      if (messageData.type === 'ringing') {
        clearRingAckTimer();
        setPeerRinging(true);
        return;
      }

      const pc = peerConnectionRef.current;
      const replyToPeer = activePeerIdRef.current ?? payload.senderId;

      if (messageData.type === 'offer' && messageData.sdp) {
        if (pc && pc.signalingState !== 'stable') {
          console.warn(
            '[Call] glare — dropping offer in signaling state:',
            pc.signalingState,
          );
          return;
        }

        const description: RTCSessionDescriptionInit = {
          type: 'offer',
          sdp: messageData.sdp,
        };

        if (pc) {
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription(description),
            );
            await drainIceCandidateQueue(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await signalRService.sendCallSignal(
              payload.sessionId,
              replyToPeer,
              { type: 'answer', sdp: answer.sdp },
            );
          } catch (err) {
            console.error('[Call] Failed to process offer:', err);
          }
        } else {
          pendingRemoteOfferRef.current = description;
        }
      } else if (messageData.type === 'answer' && messageData.sdp) {
        if (!pc || pc.signalingState !== 'have-local-offer') {
          console.warn(
            '[Call] ignoring answer — signaling state:',
            pc?.signalingState,
          );
          return;
        }
        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: 'answer',
              sdp: messageData.sdp,
            }),
          );
          await drainIceCandidateQueue(pc);
          setCallState((prev) =>
            prev === 'outgoing' ? 'connecting' : prev,
          );
        } catch (err) {
          console.error('[Call] Failed to process answer:', err);
        }
      } else if (messageData.type === 'candidate' && messageData.candidate) {
        if (!pc || !remoteDescriptionSetRef.current || !pc.remoteDescription) {
          iceCandidateQueueRef.current.push(messageData.candidate);
        } else {
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate(messageData.candidate),
            );
          } catch {
            /* ignore */
          }
        }
      }
    },
    [drainIceCandidateQueue, clearRingAckTimer],
  );

  /* ── SignalR subscriptions ───────────────────────────── */

  useEffect(() => {
    const unsubIncoming = signalRService.onIncomingCall(
      (call: CallSessionDto) => {
        if (call.groupId) return;

        const peer = resolvePeerId(null, call);
        if (!peer || peer === myUserId) {
          console.warn('[Call] Ignoring self/invalid incoming call');
          return;
        }

        if (callStateRef.current !== 'idle') {
          signalRService
            .notifyCallEnded(call.sessionId, peer)
            .catch(() => {});
          return;
        }

        void signalRService
          .sendCallSignal(call.sessionId, peer, { type: 'ringing' })
          .catch(() => {});

        setIncomingCall(call);
        setCallState('incoming');
      },
    );

    const unsubSignal = signalRService.onCallSignal(
      (payload: CallSignalPayload) => {
        void handleSignalMessage(payload);
      },
    );

    const unsubEnded = signalRService.onCallEnded(
      (payload: CallEndedPayload) => {
        const matchesSession =
          sessionRef.current?.sessionId === payload.sessionId;
        const matchesIncoming =
          incomingCallRef.current?.sessionId === payload.sessionId;
        if (!matchesSession && !matchesIncoming) return;

        const wasCaller = callInitiatedByMeRef.current;
        const wasAnswered = callAnsweredRef.current;
        const startedAt = callStartedAtRef.current;
        const peer =
          activePeerIdRef.current ??
          resolvePeerId(sessionRef.current, incomingCallRef.current);
        const callType =
          sessionRef.current?.callType ??
          incomingCallRef.current?.callType ??
          0;
        const durationSec = startedAt
          ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
          : 0;

        teardown({ playTone: matchesSession });

        if (wasCaller && peer) {
          void logCallToChat(peer, callType, wasAnswered, durationSec);
        }
      },
    );

    return () => {
      unsubIncoming();
      unsubSignal();
      unsubEnded();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Watchdog arm/disarm ─────────────────────────────── */

  useEffect(() => {
    if (callState === 'connecting' || callState === 'outgoing') {
      armWatchdog();
    } else {
      clearWatchdog();
    }
    return clearWatchdog;
  }, [callState, armWatchdog, clearWatchdog]);

  /* ── Context value ───────────────────────────────────── */

  const contextValue = useMemo<CallContextType>(
    () => ({
      session,
      localStream,
      remoteStream,
      isMuted,
      isVideoOff,
      isScreenSharing,
      isSpeakerOn,
      isMinimized,
      incomingCall,
      peerId,
      callState,
      duration,
      peerRinging,
      initiateCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMute,
      toggleVideo,
      startScreenShare,
      stopScreenShare,
      setSpeakerOn,
      minimize,
      expand,
      replaceVideoTrack,

      unreadCounts,
      totalUnread,
      clearUnread,
      requestNotificationPermission,
      notificationPermission,

      prefetchedHistory,
      consumePrefetchedHistory,
    }),
    [
      session,
      localStream,
      remoteStream,
      isMuted,
      isVideoOff,
      isScreenSharing,
      isSpeakerOn,
      isMinimized,
      incomingCall,
      peerId,
      callState,
      duration,
      peerRinging,
      initiateCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMute,
      toggleVideo,
      startScreenShare,
      stopScreenShare,
      setSpeakerOn,
      minimize,
      expand,
      replaceVideoTrack,

      unreadCounts,
      totalUnread,
      clearUnread,
      requestNotificationPermission,
      notificationPermission,

      prefetchedHistory,
      consumePrefetchedHistory,
    ],
  );

  return (
    <CallContext.Provider value={contextValue}>
      {children}

      {/*
        In-app DM notification — rendered via portal directly into
        document.body. It is a singleton (only one `activeNotification`
        can exist at a time), so it cannot duplicate even if multiple
        <Toaster> components are mounted elsewhere in the app.

        Positioned below the mobile header on small screens (via
        env(safe-area-inset-top)) and at the top-right corner on desktop.
      */}
      {activeNotification && typeof document !== 'undefined' &&
        createPortal(
          <>
            <style>{`
              @keyframes orbital-dm-toast-in {
                from { transform: translateX(120%); opacity: 0; }
                to   { transform: translateX(0);    opacity: 1; }
              }
              @media (prefers-reduced-motion: reduce) {
                .orbital-dm-toast { animation: none !important; }
              }
            `}</style>
            <div
              className="orbital-dm-toast fixed right-4 z-[9999] pointer-events-auto"
              style={{
                top: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)',
                animation:
                  'orbital-dm-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
              }}
              role="status"
              aria-live="polite"
            >
              <MessageToast
                name={activeNotification.senderName}
                avatarUrl={activeNotification.avatarUrl}
                preview={activeNotification.preview}
                onOpen={() => {
                  const target = activeNotification.senderId;
                  dismissActiveNotification();
                  navigate(`/app/dm/${target}`);
                }}
                onDismiss={dismissActiveNotification}
              />
            </div>
          </>,
          document.body,
        )}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextType {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used within a CallProvider');
  return context;
}

const CallProvider = CallProviderComponent;

export default CallProvider;
export { CallProvider };