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
import { toast } from 'sonner';
import { apiService, API_BASE_URL, getAccessToken } from '../services/api';
import { signalRService } from '../services/signalr';
import { presenceStore } from '../services/presenceStore';
import { encryptFor, getPublicKeyFor } from '../services/cryptoService';
import { useAuth } from './AuthContext';
import {
  CallEndedPayload,
  CallSessionDto,
  CallSessionStatus,
  CallSignalPayload,
  CallType,
  IceServerConfigDto,
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
  /**
   * True once the callee's device has acknowledged the incoming call.
   * Caller-side only. Turn "Calling…" into "Ringing…" on this.
   */
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
}

export const CallContext = createContext<CallContextType | undefined>(undefined);

export interface CallProviderProps {
  children: React.ReactNode;
}

const ACTIVE_CALL_STORAGE_KEY = 'orbital.activeCallSessionId';
const DISCONNECT_WATCHDOG_MS = 30000;
/** Cheap reads (ICE servers, GETs). */
const API_TIMEOUT_MS = 5000;
/** Session-creating / session-mutating calls. */
const SESSION_TIMEOUT_MS = 15000;
/** How long to wait for the callee's device to ACK before giving up. */
const RING_ACK_TIMEOUT_MS = 20000;

/* ─────────────────────────────────────────────────────────
   Metered TURN servers — static credentials
   Workspace: orbitalhq
   ───────────────────────────────────────────────────────── */

const METERED_USERNAME = '314b509605be09e502e550bd';
const METERED_CREDENTIAL = 'x53QpqdPM1wUJnAa';

const METERED_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:global.relay.metered.ca:80',
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
  {
    urls: 'turn:global.relay.metered.ca:80?transport=tcp',
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
  {
    urls: 'turns:global.relay.metered.ca:443?transport=tcp',
    username: METERED_USERNAME,
    credential: METERED_CREDENTIAL,
  },
];

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
   Same interface as useRingtone but plays a real asset.
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
      // Autoplay may be blocked until user gesture — installAudioUnlock()
      // usually covers this, but retry on the next interaction just in case.
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
/*
 * Modern Instagram-inspired tonal palette.
 *
 * The incoming pattern is a five-note rising-then-falling arpeggio
 * (A5 → C#6 → E6 → D6 → B5) that has the same bright, melodic,
 * bell-like character as Instagram's call chime. The ringback is
 * a two-note figure for the caller while the peer is ringing; the
 * end tone is a short descending two-note "blip".
 */

// Ringback — what the *caller* hears while waiting for the peer.
// A clean two-note figure. Not intrusive over long rings.
const RINGBACK_PATTERN: ToneStep[] = [
  { freq: 587.33, durationMs: 320, gapAfterMs: 90 },  // D5
  { freq: 880.00, durationMs: 520, gapAfterMs: 0 },   // A5
];

// Incoming — the main ringtone. Bright, melodic, modern.
// Five notes rising then resolving down, played as a chime.
// NOTE: kept for reference; incoming call now uses a real MP3.
const INCOMING_SOFT_PATTERN: ToneStep[] = [
  { freq: 880.00, durationMs: 180, gapAfterMs: 50 },   // A5
  { freq: 1108.73, durationMs: 180, gapAfterMs: 50 },  // C#6
  { freq: 1318.51, durationMs: 300, gapAfterMs: 110 }, // E6
  { freq: 1174.66, durationMs: 200, gapAfterMs: 60 },  // D6
  { freq: 987.77, durationMs: 420, gapAfterMs: 0 },    // B5
];

// End tone — short descending two-note "blip" when a call ends.
// NOTE: kept for reference; end call now uses a real MP3.
const END_PATTERN: ToneStep[] = [
  { freq: 659.25, durationMs: 140, gapAfterMs: 50 },   // E5
  { freq: 493.88, durationMs: 260, gapAfterMs: 0 },    // B4
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

function CallProviderComponent({ children }: CallProviderProps): React.JSX.Element {
  const { user } = useAuth();

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

  // Call-logging flags — only the caller logs a call to chat.
  const callInitiatedByMeRef = useRef<boolean>(false);
  const callAnsweredRef = useRef<boolean>(false);

  // Ring-ACK watchdog — caller-side only.
  const ringAckTimerRef = useRef<number | null>(null);

  /**
   * Dedicated HTMLAudioElement for remote audio playback.
   *
   * IMPORTANT: We do NOT pre-assign an empty MediaStream to `srcObject`.
   * Assigning an empty MediaStream and later calling `addTrack()` is
   * known to silently drop playback in Chromium (the element reports
   * playing:true, muted:false, but outputs silence). Instead we build a
   * fresh MediaStream that already contains the remote track and assign
   * it once — this is the reliable path on both desktop and mobile.
   */
  const audioSinkRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => installAudioUnlock(), []);

  // Sync state to refs to prevent stale closures in SignalR callbacks
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  // Create persistent audio element. srcObject starts null on purpose.
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

  /* ── Ringtone ────────────────────────────────────────── */

  const isOutgoingRinging = callState === 'outgoing' && !isMinimized;
  const isIncomingRinging = callState === 'incoming';

  // Ringback — caller waits, hears the outgoing MP3.
useAudioRingtone(isOutgoingRinging, '/sounds/outgoing.mp3', 0.25);

  // Incoming — looping MP3 ringtone from /public/sounds/ringtone.mp3
  useAudioRingtone(isIncomingRinging, '/sounds/ringtone.mp3', 0.35);

  // End tone — disconnect MP3, plays once.
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

  /* ── ICE config ──────────────────────────────────────── */

  const getRtcConfiguration = useCallback(async (): Promise<RTCConfiguration> => {
    const stunOnly: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    try {
      const serverConfigs: IceServerConfigDto[] = await withTimeout(
        apiService.getIceServers(),
        3000,
        'getIceServers',
      );
      if (serverConfigs && serverConfigs.length > 0) {
        const mapped: RTCIceServer[] = serverConfigs.map((c) => ({
          urls: c.urls,
          username: c.username,
          credential: c.credential,
        }));
        const hasTurn = mapped.some((s) => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return urls.some(
            (u) =>
              typeof u === 'string' &&
              (u.startsWith('turn:') || u.startsWith('turns:')),
          );
        });
        if (hasTurn) {
          console.log('[Call] ICE config: backend TURN + Metered TURN (policy: all)');
          return {
            iceServers: [...mapped, ...METERED_ICE_SERVERS],
            iceTransportPolicy: 'all',
          };
        }
      }
    } catch {
      /* fall through */
    }

    console.log('[Call] ICE config: STUN + Metered TURN (policy: all)', {
      turnServers: METERED_ICE_SERVERS.length,
    });

    return {
      iceServers: [...stunOnly, ...METERED_ICE_SERVERS],
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

      // Reset call-logging flags only on teardown — endCall reads them
      // *before* calling teardown.
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
              // already wired up
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

  /**
   * Persist a call event as a DM so it shows up in the chat thread
   * like WhatsApp. Only the caller invokes this — the callee relies on
   * the caller to log it, avoiding duplicate entries per call.
   */
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

      if (audioSinkRef.current) {
        audioSinkRef.current.play().catch(() => {});
      }

      teardown();
      setCallState('outgoing');
      setPeerId(targetPeerId);
      activePeerIdRef.current = targetPeerId;

      // Mark the *caller* role here — used later by endCall to decide
      // whether to write the call-log entry.
      callInitiatedByMeRef.current = true;
      callAnsweredRef.current = false;

      // Arm the ring-ACK timer. Cleared when the callee sends
      // { type: 'ringing' } back, or when the connection goes active.
      clearRingAckTimer();
      ringAckTimerRef.current = window.setTimeout(() => {
        console.warn('[Call] Ring-ACK timed out — peer never received the call.');
        toast.warning('Call couldn’t reach them.');
        void endCallRef.current?.();
      }, RING_ACK_TIMEOUT_MS);

      // ── Everything below can throw. If it does, we MUST tear down,
      //    otherwise the user is stuck in 'outgoing' with no way out
      //    except a page reload.
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
        // Best-effort: close the server session if we created one.
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

    // We're the callee — never log the call ourselves.
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

    // Snapshot call-log data BEFORE teardown clears the refs.
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

    // Log to chat — caller-side only.
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

      // Ringing ACK from the callee's device — the *caller* consumes this.
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

        // ACK the ring so the caller can switch "Calling…" → "Ringing…".
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

        // Snapshot for the call-log entry — only the caller logs.
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
    ],
  );

  return (
    <CallContext.Provider value={contextValue}>
      {children}
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