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

/* ── Ringtone presets ────────────────────────────────────── */

const RINGBACK_PATTERN: ToneStep[] = [
  { freq: 350, durationMs: 900, gapAfterMs: 0 },
];

const INCOMING_SOFT_PATTERN: ToneStep[] = [
  { freq: 523.25, durationMs: 280, gapAfterMs: 80 },
  { freq: 659.25, durationMs: 420, gapAfterMs: 0 },
];

const END_PATTERN: ToneStep[] = [
  { freq: 440, durationMs: 300, gapAfterMs: 0 },
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
  const watchdogRef = useRef<number | null>(null);
  const callStateRef = useRef<CallState>('idle');
  const sessionRef = useRef<CallSessionDto | null>(null);
  const incomingCallRef = useRef<CallSessionDto | null>(null);
  const callStartedAtRef = useRef<number | null>(null);

  /**
   * Dedicated HTMLAudioElement for remote audio playback.
   * Attached directly in `pc.ontrack` to avoid the React render
   * race that was dropping the audio track on the receiving side.
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

  // Create persistent audio element with dedicated MediaStream container
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
    el.srcObject = new MediaStream();

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
    volume: 0.1,
    wave: 'sine',
  });

  const playEndTone = useCallback(() => {
    setEndToneActive(true);
    window.setTimeout(() => setEndToneActive(false), 500);
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

  /* ── Watchdog ────────────────────────────────────────── */

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current != null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  /* NOTE: teardown is declared after this callback in source order,
     but armWatchdog only *references* it inside a setTimeout callback,
     so the TDZ doesn't bite at runtime. We declare armWatchdog via
     useCallback with teardown in deps (see below). */

  const teardownRef = useRef<((opts?: { playTone?: boolean }) => void) | null>(
    null,
  );

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      console.warn('[Call] Watchdog fired — forcing teardown');
      teardownRef.current?.({ playTone: true });
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
          console.log('[Call] ICE config: backend TURN + Metered TURN (policy: relay)');
          return {
            iceServers: [...mapped, ...METERED_ICE_SERVERS],
            iceTransportPolicy: 'relay',
          };
        }
      }
    } catch {
      /* fall through */
    }

    console.log('[Call] ICE config: STUN + Metered TURN (policy: relay)', {
      turnServers: METERED_ICE_SERVERS.length,
    });

    return {
      iceServers: [...stunOnly, ...METERED_ICE_SERVERS],
      iceTransportPolicy: 'relay',
    };
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

      if (
        audioSinkRef.current &&
        audioSinkRef.current.srcObject instanceof MediaStream
      ) {
        audioSinkRef.current.srcObject.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* ignore */
          }
        });
        audioSinkRef.current.srcObject = new MediaStream();
        try {
          audioSinkRef.current.pause();
        } catch {
          /* ignore */
        }
      }

      remoteDescriptionSetRef.current = false;
      pendingRemoteOfferRef.current = null;
      activePeerIdRef.current = null;
      callStartedAtRef.current = null;
      iceCandidateQueueRef.current = [];

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
    [clearWatchdog, playEndTone],
  );

  // Keep teardownRef in sync so armWatchdog can call the latest version
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

      // Add local media tracks to the connection
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

        // Diagnostics only — no ICE restart hacks.
        event.track.addEventListener('unmute', () =>
          console.log('[Call] remote track UNMUTED', event.track.kind),
        );
        event.track.addEventListener('mute', () =>
          console.log('[Call] remote track muted', event.track.kind),
        );

        /* ── Audio playback sink ── */
        if (event.track.kind === 'audio') {
          const sink = audioSinkRef.current;
          if (sink && sink.srcObject instanceof MediaStream) {
            const currentAudioStream = sink.srcObject;
            if (
              !currentAudioStream.getTracks().some((t) => t.id === event.track.id)
            ) {
              currentAudioStream.addTrack(event.track);
            }

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

        /* ── Video remote stream ── */
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
    [getRtcConfiguration, teardown, clearWatchdog],
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

      // Prime audio playback early
      audioSinkRef.current?.play().catch(() => {});

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
    const incoming = incomingCallRef.current;
    if (!incoming) return;

    // Synchronously prime audio sink inside the click handler to claim the
    // user gesture (unlocks autoplay for the remote audio element).
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
      // The offer hasn't arrived yet. handleSignalMessage will pick it up
      // when it does and drive the answer from there.
      console.warn('[Call] No pending offer at accept time — awaiting offer signal');
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
  }, [resolvePeerId, teardown]);

  /* ── End ─────────────────────────────────────────────── */

  const endCall = useCallback(async (): Promise<void> => {
    const currentSession = sessionRef.current;
    const currentIncoming = incomingCallRef.current;
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
  }, [resolvePeerId, teardown]);

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
        // Glare guard: only accept an offer when we're in the stable state.
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
        // Only accept an answer when we actually sent an offer.
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
        const matchesSession =
          sessionRef.current?.sessionId === payload.sessionId;
        const matchesIncoming =
          incomingCallRef.current?.sessionId === payload.sessionId;
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
    // Subscriptions must be installed exactly once for the provider lifetime.
    // All live values are read from refs to avoid stale-closure bugs.
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