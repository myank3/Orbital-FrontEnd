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
import { apiService, API_BASE_URL, getAccessToken } from '../services/api';
import { signalRService } from '../services/signalr';
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
  type: 'offer' | 'answer' | 'candidate';
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
  isMinimized: boolean;
  incomingCall: CallSessionDto | null;
  peerId: string | null;
  callState: CallState;
  /** Seconds since the call became active (media flowing). 0 when idle. */
  duration: number;
  initiateCall: (peerId: string, callType: number) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  minimize: () => void;
  expand: () => void;
}

export const CallContext = createContext<CallContextType | undefined>(undefined);

export interface CallProviderProps {
  children: React.ReactNode;
}

const ACTIVE_CALL_STORAGE_KEY = 'orbital.activeCallSessionId';
const DISCONNECT_WATCHDOG_MS = 30000;
const API_TIMEOUT_MS = 5000;

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

/* ── Ringtone presets ────────────────────────────────────── */

const RINGBACK_PATTERN: ToneStep[] = [
  { freq: 350, durationMs: 900, gapAfterMs: 0 },
];

const INCOMING_SOFT_PATTERN: ToneStep[] = [
  { freq: 523.25, durationMs: 280, gapAfterMs: 80 },  // C5
  { freq: 659.25, durationMs: 420, gapAfterMs: 0 },   // E5
];

const END_PATTERN: ToneStep[] = [
  { freq: 440, durationMs: 300, gapAfterMs: 0 },      // A4
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

/**
 * Browsers block autoplay of audio until the user interacts.
 * This plays a tiny silent tone once on the first gesture,
 * unlocking the AudioContext for the rest of the session.
 */
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
        // Play a 1-sample silent buffer
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
  const myUserId = user?.userId ?? null;

  const [session, setSession] = useState<CallSessionDto | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<CallSessionDto | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [endToneActive, setEndToneActive] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef<boolean>(false);
  const pendingRemoteOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const activePeerIdRef = useRef<string | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const fallbackAudioRefs = useRef<HTMLAudioElement[]>([]);
  const fallbackAudioByTrackId = useRef<Map<string, HTMLAudioElement>>(new Map());
  const watchdogRef = useRef<number | null>(null);
  const callStateRef = useRef<CallState>('idle');

  /**
   * Both sides compute duration from this shared reference point,
   * set the moment `pc.connectionState === 'connected'`. The two
   * sides will be within a few hundred ms of each other — visually
   * indistinguishable on a MM:SS display.
   */
  const callStartedAtRef = useRef<number | null>(null);

  // Install audio unlock on mount
  useEffect(() => installAudioUnlock(), []);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  /* ── Ringtone ────────────────────────────────────────── */

  const isOutgoingRinging = callState === 'outgoing' && !isMinimized;
  const isIncomingRinging = callState === 'incoming';

  useRingtone(isOutgoingRinging, {
    pattern: RINGBACK_PATTERN,
    silenceMs: 2100,
    volume: 0.08,
    wave: 'sine',
  });

  useRingtone(isIncomingRinging, {
    pattern: INCOMING_SOFT_PATTERN,
    silenceMs: 2000,
    volume: 0.12,
    wave: 'sine',
  });

  useRingtone(endToneActive, {
    pattern: END_PATTERN,
    silenceMs: 0,
    volume: 0.10,
    wave: 'sine',
  });

  const playEndTone = useCallback(() => {
    setEndToneActive(true);
    window.setTimeout(() => setEndToneActive(false), 500);
  }, []);

  /* ── Duration ticker ─────────────────────────────────── */

  useEffect(() => {
    if (callState !== 'active' || callStartedAtRef.current == null) {
      setDuration(0);
      return;
    }
    const tick = () => {
      const start = callStartedAtRef.current;
      if (start == null) return;
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

  /* ── Fallback audio (Chrome 140 workaround) ──────────── */

  const attachFallbackAudio = useCallback((track: MediaStreamTrack) => {
    if (fallbackAudioByTrackId.current.has(track.id)) return;
    try {
      const el = new Audio();
      el.srcObject = new MediaStream([track]);
      el.autoplay = true;
      el.volume = 1;
      el.muted = false;
      // @ts-expect-error — not in all TS DOM libs
      el.playsInline = true;
      el.setAttribute('data-call-audio', 'true');
      el.style.display = 'none';
      document.body.appendChild(el);

      const tryPlay = () => {
        el.play()
          .then(() => {
            console.log('[Call] Fallback audio playing', {
              trackId: track.id,
              readyState: track.readyState,
              enabled: track.enabled,
              muted: track.muted,
              volume: el.volume,
              paused: el.paused,
            });
          })
          .catch((err) => {
            console.warn('[Call] Fallback audio autoplay blocked:', err);
            const resume = () => {
              el.play().catch(() => {});
              window.removeEventListener('click', resume);
              window.removeEventListener('keydown', resume);
              window.removeEventListener('touchstart', resume);
            };
            window.addEventListener('click', resume, { once: true });
            window.addEventListener('keydown', resume, { once: true });
            window.addEventListener('touchstart', resume, { once: true });
          });
      };

      // If the track is already live, play immediately.
      // If not, wait for it to unmute before trying again.
      tryPlay();

      const onUnmute = () => {
        if (!el.paused && el.volume > 0) return;
        tryPlay();
      };
      track.addEventListener('unmute', onUnmute);

      fallbackAudioRefs.current.push(el);
      fallbackAudioByTrackId.current.set(track.id, el);
    } catch (err) {
      console.warn('[Call] Could not create fallback audio element:', err);
    }
  }, []);

  const detachAllFallbackAudio = useCallback(() => {
    fallbackAudioRefs.current.forEach((el) => {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {
        /* ignore */
      }
    });
    fallbackAudioRefs.current = [];
    fallbackAudioByTrackId.current.clear();
  }, []);

  /* ── Watchdog ────────────────────────────────────────── */

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current != null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      console.warn('[Call] Watchdog fired — forcing teardown');
      try {
        peerConnectionRef.current?.close();
      } catch {
        /* ignore */
      }
    }, DISCONNECT_WATCHDOG_MS);
  }, [clearWatchdog]);

  /* ── ICE config ──────────────────────────────────────── */

  const getRtcConfiguration = useCallback(async (): Promise<RTCConfiguration> => {
    const publicTurn: RTCIceServer = {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    };

    const fallbackServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      publicTurn,
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
            (u) => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')),
          );
        });

        if (!hasTurn) mapped.push(publicTurn);
        return { iceServers: mapped };
      }
    } catch {
      /* fall through */
    }

    return { iceServers: fallbackServers };
  }, []);

  /* ── Teardown ────────────────────────────────────────── */

  const teardown = useCallback(
    (opts: { playTone?: boolean } = {}) => {
      clearWatchdog();

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
        try { t.stop(); } catch { /* ignore */ }
      });
      localStreamRef.current = null;

      remoteStreamRef.current?.getTracks().forEach((t) => {
        try { t.stop(); } catch { /* ignore */ }
      });
      remoteStreamRef.current = null;

      remoteDescriptionSetRef.current = false;
      pendingRemoteOfferRef.current = null;
      activePeerIdRef.current = null;
      callStartedAtRef.current = null;

      detachAllFallbackAudio();

      setLocalStream(null);
      setRemoteStream(null);
      setSession(null);
      setIncomingCall(null);
      setPeerId(null);
      setIsMuted(false);
      setIsVideoOff(false);
      setIsMinimized(false);
      setCallState('idle');
      setDuration(0);

      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
      }

      if (opts.playTone) playEndTone();
    },
    [clearWatchdog, detachAllFallbackAudio, playEndTone],
  );

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

      // Ensure every track is enabled — some browsers mute them
      // when the tab was backgrounded during permission prompt.
      stream.getTracks().forEach((t) => {
        t.enabled = true;
      });

      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      console.log('[Call] Local media acquired', {
        audio: audioTracks.map((t) => ({
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
      callType: number,
    ): Promise<RTCPeerConnection> => {
      const config = await getRtcConfiguration();
      const pc = new RTCPeerConnection(config);
      peerConnectionRef.current = pc;
      remoteDescriptionSetRef.current = false;
      activePeerIdRef.current = targetPeerId;

      // ── Explicit transceivers (audio FIRST) ─────────────
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        pc.addTransceiver(audioTrack, {
          direction: 'sendrecv',
          streams: [stream],
        });
      } else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        pc.addTransceiver(videoTrack, {
          direction: 'sendrecv',
          streams: [stream],
        });
      } else if (callType === CallType.Video) {
        pc.addTransceiver('video', { direction: 'recvonly' });
      }

      // ── ontrack — accumulate + fallback audio ───────────
      pc.ontrack = (event: RTCTrackEvent) => {
        event.track.enabled = true;

        console.log('[Call] Remote track received', {
          kind: event.track.kind,
          id: event.track.id,
          enabled: event.track.enabled,
          muted: event.track.muted,
          readyState: event.track.readyState,
        });

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
          event.streams[0].getTracks().forEach((t) => {
            if (!target!.getTracks().some((x) => x.id === t.id)) {
              target!.addTrack(t);
            }
          });
        }

        if (event.track.kind === 'audio') {
          attachFallbackAudio(event.track);
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
          setCallState((prev) =>
            prev === 'connecting' || prev === 'outgoing' ? 'active' : prev,
          );
        } else if (s === 'failed' || s === 'closed') {
          console.warn('[Call] Peer connection:', s);
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
    [getRtcConfiguration, attachFallbackAudio, teardown, clearWatchdog],
  );

  /* ── Initiate (caller) ───────────────────────────────── */

  const initiateCall = useCallback(
    async (targetPeerId: string, callType: number): Promise<void> => {
      if (!targetPeerId) {
        throw new Error('Peer ID is required to initiate a call.');
      }

      teardown();
      setCallState('outgoing');
      setPeerId(targetPeerId);
      activePeerIdRef.current = targetPeerId;

      const stream = await acquireMediaStream(callType);
      setLocalStream(stream);

      const newSession = await withTimeout(
        apiService.initiateCall({ peerId: targetPeerId, callType }),
        API_TIMEOUT_MS,
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

      await signalRService.sendCallSignal(newSession.sessionId, targetPeerId, {
        type: 'offer',
        sdp: offer.sdp,
      });
    },
    [teardown, acquireMediaStream, createPeerConnection],
  );

  /* ── Accept (callee) ─────────────────────────────────── */

  const acceptCall = useCallback(async (): Promise<void> => {
    const incoming = incomingCall;
    if (!incoming) return;

    const resolvedPeer = resolvePeerId(null, incoming);
    if (!resolvedPeer) {
      console.error('[Call] Cannot resolve peer ID from incoming call');
      teardown();
      return;
    }

    clearWatchdog();
    iceCandidateQueueRef.current = [];
    remoteDescriptionSetRef.current = false;
    activePeerIdRef.current = resolvedPeer;

    setCallState('connecting');
    setPeerId(resolvedPeer);

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
        API_TIMEOUT_MS,
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
      console.warn('[Call] No pending offer at accept time');
    }
  }, [
    incomingCall,
    resolvePeerId,
    teardown,
    acquireMediaStream,
    createPeerConnection,
    drainIceCandidateQueue,
    clearWatchdog,
  ]);

  /* ── Reject ──────────────────────────────────────────── */

  const rejectCall = useCallback(async (): Promise<void> => {
    const incoming = incomingCall;
    if (!incoming) return;

    const resolvedPeer = resolvePeerId(null, incoming);
    teardown();

    try {
      await withTimeout(
        apiService.updateCallStatus(
          incoming.sessionId,
          CallSessionStatus.Rejected,
        ),
        API_TIMEOUT_MS,
        'reject',
      );
      if (resolvedPeer) {
        await withTimeout(
          signalRService.notifyCallEnded(incoming.sessionId, resolvedPeer),
          API_TIMEOUT_MS,
          'notifyCallEnded',
        );
      }
    } catch (err) {
      console.warn('[Call] Reject cleanup error (ignored):', err);
    }
  }, [incomingCall, resolvePeerId, teardown]);

  /* ── End ─────────────────────────────────────────────── */

  const endCall = useCallback(async (): Promise<void> => {
    const currentSession = session;
    const currentIncoming = incomingCall;
    const currentSessionId =
      currentSession?.sessionId ?? currentIncoming?.sessionId;
    const resolvedPeer =
      activePeerIdRef.current ?? resolvePeerId(currentSession, currentIncoming);

    const hadActiveCall = callStateRef.current !== 'idle';
    setCallState('ending');

    teardown({ playTone: hadActiveCall });

    if (currentSessionId) {
      try {
        await withTimeout(
          apiService.endCall(currentSessionId),
          API_TIMEOUT_MS,
          'endCall',
        );
      } catch (err) {
        console.warn('[Call] endCall API error (ignored):', err);
      }
      if (resolvedPeer) {
        try {
          await withTimeout(
            signalRService.notifyCallEnded(currentSessionId, resolvedPeer),
            API_TIMEOUT_MS,
            'notifyCallEnded',
          );
        } catch (err) {
          console.warn('[Call] notifyCallEnded error (ignored):', err);
        }
      }
    }
  }, [session, incomingCall, resolvePeerId, teardown]);

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

      const pc = peerConnectionRef.current;
      const replyToPeer = activePeerIdRef.current ?? payload.senderId;

      if (messageData.type === 'offer' && messageData.sdp) {
        const description: RTCSessionDescriptionInit = {
          type: 'offer',
          sdp: messageData.sdp,
        };
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(description));
          await drainIceCandidateQueue(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await signalRService.sendCallSignal(
            payload.sessionId,
            replyToPeer,
            { type: 'answer', sdp: answer.sdp },
          );
        } else {
          pendingRemoteOfferRef.current = description;
        }
      } else if (messageData.type === 'answer' && messageData.sdp) {
        if (pc) {
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
    [drainIceCandidateQueue],
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
        const matchesSession = session?.sessionId === payload.sessionId;
        const matchesIncoming = incomingCall?.sessionId === payload.sessionId;
        if (matchesSession || matchesIncoming) {
          teardown({ playTone: matchesSession });
        }
      },
    );

    return () => {
      unsubIncoming();
      unsubSignal();
      unsubEnded();
    };
  }, [
    session,
    incomingCall,
    resolvePeerId,
    myUserId,
    teardown,
    handleSignalMessage,
  ]);

  /* ── Watchdog arm/disarm ─────────────────────────────── */

  useEffect(() => {
    if (callState === 'active') {
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
      isMinimized,
      incomingCall,
      peerId,
      callState,
      duration,
      initiateCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMute,
      toggleVideo,
      minimize,
      expand,
    }),
    [
      session,
      localStream,
      remoteStream,
      isMuted,
      isVideoOff,
      isMinimized,
      incomingCall,
      peerId,
      callState,
      duration,
      initiateCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMute,
      toggleVideo,
      minimize,
      expand,
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