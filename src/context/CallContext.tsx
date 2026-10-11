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

export interface CallContextType {
  session: CallSessionDto | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isMinimized: boolean;
  incomingCall: CallSessionDto | null;
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

/* ─────────────────────────────────────────────────────────
   Ringtone — Web Audio, pattern-based (no MP3 files)
   ───────────────────────────────────────────────────────── */

interface ToneStep {
  /** Frequency in Hz. */
  freq: number;
  /** Duration in ms. */
  durationMs: number;
  /** Optional gap after this step before the next (ms). */
  gapAfterMs?: number;
}

interface RingtoneOptions {
  /** Sequence of notes to play in one ring burst. */
  pattern: ToneStep[];
  /** Silence between bursts (ms). */
  silenceMs: number;
  /** Overall volume 0–1. */
  volume?: number;
  /** Waveform. 'sine' is softest; 'triangle' cuts through. */
  wave?: OscillatorType;
}

function useRingtone(
  active: boolean,
  { pattern, silenceMs, volume = 0.12, wave = 'sine' }: RingtoneOptions,
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  // Serialize the pattern so effect deps are stable across renders
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

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

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

          // Attack → sustain → release envelope
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(volume, t + 0.02);
          gain.gain.setValueAtTime(volume, t + dur - 0.03);
          gain.gain.linearRampToValueAtTime(0, t + dur);

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
   Ring pattern presets
   ───────────────────────────────────────────────────────── */

/** Classic US/EU ringback: 440 + 480 Hz, 1s burst, ~2s silence. */
const RINGBACK_PATTERN: ToneStep[] = [
  { freq: 440, durationMs: 500, gapAfterMs: 0 },
  { freq: 480, durationMs: 500, gapAfterMs: 0 },
];

/** Modern incoming: digital "ring-ring" burst, ~1s cycle. */
const INCOMING_PATTERN: ToneStep[] = [
  { freq: 620, durationMs: 180, gapAfterMs: 60 },
  { freq: 480, durationMs: 180, gapAfterMs: 60 },
  { freq: 620, durationMs: 180, gapAfterMs: 60 },
  { freq: 480, durationMs: 180, gapAfterMs: 0 },
];

/** Soft musical chime: C5 → E5 → G5, ~1s burst. */
const INCOMING_SOFT_PATTERN: ToneStep[] = [
  { freq: 523.25, durationMs: 220, gapAfterMs: 40 }, // C5
  { freq: 659.25, durationMs: 220, gapAfterMs: 40 }, // E5
  { freq: 783.99, durationMs: 320, gapAfterMs: 0 },  // G5
];

/** End-of-call descending tone. */
const END_PATTERN: ToneStep[] = [
  { freq: 480, durationMs: 150, gapAfterMs: 40 },
  { freq: 350, durationMs: 250, gapAfterMs: 0 },
];

/* ─────────────────────────────────────────────────────────
   Provider
   ───────────────────────────────────────────────────────── */

function CallProviderComponent({ children }: CallProviderProps): React.JSX.Element {
  const [session, setSession] = useState<CallSessionDto | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<CallSessionDto | null>(null);
  const [endToneActive, setEndToneActive] = useState<boolean>(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef<boolean>(false);
  const pendingRemoteOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const activePeerIdRef = useRef<string | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  /* ── Ringtone ────────────────────────────────────────── */

  // Caller hears ringback until the callee answers (or the call ends)
  const isOutgoingRinging =
    Boolean(session) && !remoteStream && !incomingCall && !isMinimized;

  useRingtone(isOutgoingRinging, {
    pattern: RINGBACK_PATTERN,
    silenceMs: 2000,
    volume: 0.10,
    wave: 'sine',
  });

  // Callee hears ring while there's a pending incoming call
  const isIncomingRinging = Boolean(incomingCall);

  useRingtone(isIncomingRinging, {
    pattern: INCOMING_SOFT_PATTERN,
    silenceMs: 900,
    volume: 0.16,
    wave: 'sine',
  });

  // Short descending tone when the call ends
  useRingtone(endToneActive, {
    pattern: END_PATTERN,
    silenceMs: 0,
    volume: 0.10,
    wave: 'sine',
  });

  const playEndTone = useCallback(() => {
    setEndToneActive(true);
    window.setTimeout(() => setEndToneActive(false), 600);
  }, []);

  /* ── ICE config ──────────────────────────────────────── */

  const getRtcConfiguration = useCallback(async (): Promise<RTCConfiguration> => {
    const fallbackServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    try {
      const serverConfigs: IceServerConfigDto[] = await apiService.getIceServers();
      if (serverConfigs && serverConfigs.length > 0) {
        const iceServers: RTCIceServer[] = serverConfigs.map((config) => ({
          urls: config.urls,
          username: config.username,
          credential: config.credential,
        }));
        return { iceServers };
      }
    } catch {
      /* ignore — fall through to STUN only */
    }

    return { iceServers: fallbackServers };
  }, []);

  /* ── Cleanup ─────────────────────────────────────────── */

  const cleanupWebRTC = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    iceCandidateQueueRef.current = [];
    remoteDescriptionSetRef.current = false;
    pendingRemoteOfferRef.current = null;
    activePeerIdRef.current = null;

    setLocalStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop());
      return null;
    });
    setRemoteStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop());
      return null;
    });
    remoteStreamRef.current = null;

    setSession(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsMinimized(false);

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
    }
  }, []);

  /* ── ICE queue draining ──────────────────────────────── */

  const drainIceCandidateQueue = useCallback(async (pc: RTCPeerConnection) => {
    remoteDescriptionSetRef.current = true;
    while (iceCandidateQueueRef.current.length > 0) {
      const candidateInit = iceCandidateQueueRef.current.shift();
      if (candidateInit) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch {
          /* ignore */
        }
      }
    }
  }, []);

  /* ── Media acquisition ───────────────────────────────── */

  const acquireMediaStream = useCallback(
    async (callType: number): Promise<MediaStream> => {
      const hasVideo = callType === CallType.Video;
      const constraints: MediaStreamConstraints = {
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
      };
      return navigator.mediaDevices.getUserMedia(constraints);
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

      // ── Explicit transceivers ───────────────────────────
      // Ensures audio m-line negotiates with correct direction
      // even when one side has no matching track.
      // ────────────────────────────────────────────────────
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

      // ── ontrack: accumulate into one remote stream ──────
      // Prevents a later track event from overwriting the
      // existing remote stream (a known cause of silent audio).
      pc.ontrack = (event: RTCTrackEvent) => {
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

        event.track.enabled = true;
        event.track.muted = false;
      };

      pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          const candidateData: CallSignalMessage = {
            type: 'candidate',
            candidate: event.candidate.toJSON(),
          };
          void signalRService.sendCallSignal(
            targetSessionId,
            targetPeerId,
            candidateData,
          );
        }
      };

      return pc;
    },
    [getRtcConfiguration],
  );

  /* ── Initiate (caller) ───────────────────────────────── */

  const initiateCall = useCallback(
    async (peerId: string, callType: number): Promise<void> => {
      if (!peerId) throw new Error('Peer ID is required to initiate a call.');

      cleanupWebRTC();

      const stream = await acquireMediaStream(callType);
      setLocalStream(stream);

      const newSession = await apiService.initiateCall({ peerId, callType });
      setSession(newSession);

      const pc = await createPeerConnection(
        newSession.sessionId,
        peerId,
        stream,
        callType,
      );

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const offerData: CallSignalMessage = { type: 'offer', sdp: offer.sdp };
      await signalRService.sendCallSignal(newSession.sessionId, peerId, offerData);
    },
    [cleanupWebRTC, acquireMediaStream, createPeerConnection],
  );

  /* ── Accept (callee) ─────────────────────────────────── */

  const acceptCall = useCallback(async (): Promise<void> => {
    if (!incomingCall) return;

    const currentIncoming = incomingCall;
    setIncomingCall(null);
    setSession(currentIncoming);

    const peerId = currentIncoming.initiatorId ?? currentIncoming.peerId ?? '';
    if (!peerId) throw new Error('No initiator ID found on incoming call.');

    const stream = await acquireMediaStream(currentIncoming.callType);
    setLocalStream(stream);

    await apiService.updateCallStatus(
      currentIncoming.sessionId,
      CallSessionStatus.Active,
    );

    const pc = await createPeerConnection(
      currentIncoming.sessionId,
      peerId,
      stream,
      currentIncoming.callType,
    );

    const offerSdp = pendingRemoteOfferRef.current;
    if (offerSdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      await drainIceCandidateQueue(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const answerData: CallSignalMessage = { type: 'answer', sdp: answer.sdp };
      await signalRService.sendCallSignal(
        currentIncoming.sessionId,
        peerId,
        answerData,
      );
      pendingRemoteOfferRef.current = null;
    }
  }, [incomingCall, acquireMediaStream, createPeerConnection, drainIceCandidateQueue]);

  /* ── Reject (callee) ─────────────────────────────────── */

  const rejectCall = useCallback(async (): Promise<void> => {
    if (!incomingCall) return;

    const callToReject = incomingCall;
    const peerId = callToReject.initiatorId ?? callToReject.peerId ?? '';
    setIncomingCall(null);

    try {
      await apiService.updateCallStatus(
        callToReject.sessionId,
        CallSessionStatus.Rejected,
      );
      if (peerId) {
        await signalRService.notifyCallEnded(callToReject.sessionId, peerId);
      }
    } catch {
      /* ignore */
    }
  }, [incomingCall]);

  /* ── End (either side) ───────────────────────────────── */

  const endCall = useCallback(async (): Promise<void> => {
    const currentSession = session;
    const currentIncoming = incomingCall;
    const currentSessionId =
      currentSession?.sessionId ?? currentIncoming?.sessionId;
    const peerId =
      activePeerIdRef.current ??
      currentSession?.peerId ??
      currentSession?.initiatorId ??
      currentIncoming?.initiatorId ??
      undefined;

    // Play the end tone if a call was actually in progress
    if (currentSessionId) playEndTone();

    cleanupWebRTC();

    if (currentSessionId) {
      try {
        await apiService.endCall(currentSessionId);
        if (peerId) {
          await signalRService.notifyCallEnded(currentSessionId, peerId);
        }
      } catch {
        /* ignore */
      }
    }
  }, [session, incomingCall, cleanupWebRTC, playEndTone]);

  /* ── Session storage recovery ────────────────────────── */

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
      const activeSessionId = sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
      if (!activeSessionId) return;
      const token = getAccessToken();
      if (!token) return;

      const url = `${API_BASE_URL.replace(
        /\/+$/,
        '',
      )}/api/Call/${encodeURIComponent(activeSessionId)}/end`;

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
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const staleSessionId = sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
    if (!staleSessionId) return;
    sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
    void apiService.endCall(staleSessionId).catch(() => {});
  }, []);

  /* ── Mute / video toggles ────────────────────────────── */

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const newMuted = !isMuted;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = !newMuted;
    });
    setIsMuted(newMuted);
  }, [localStream, isMuted]);

  const toggleVideo = useCallback(() => {
    if (!localStream) return;
    const newVideoOff = !isVideoOff;
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = !newVideoOff;
    });
    setIsVideoOff(newVideoOff);
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

      if (!messageData || !messageData.type) return;

      const pc = peerConnectionRef.current;

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

          const answerData: CallSignalMessage = {
            type: 'answer',
            sdp: answer.sdp,
          };
          await signalRService.sendCallSignal(
            payload.sessionId,
            payload.senderId,
            answerData,
          );
        } else {
          pendingRemoteOfferRef.current = description;
        }
      } else if (messageData.type === 'answer' && messageData.sdp) {
        if (pc) {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: messageData.sdp }),
          );
          await drainIceCandidateQueue(pc);
        }
      } else if (messageData.type === 'candidate' && messageData.candidate) {
        if (!pc || !remoteDescriptionSetRef.current || !pc.remoteDescription) {
          iceCandidateQueueRef.current.push(messageData.candidate);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(messageData.candidate));
          } catch {
            /* ignore */
          }
        }
      }
    },
    [drainIceCandidateQueue],
  );

  useEffect(() => {
    const unsubIncoming = signalRService.onIncomingCall((call: CallSessionDto) => {
      if (call.groupId) return;
      setIncomingCall(call);
    });

    const unsubSignal = signalRService.onCallSignal((payload: CallSignalPayload) => {
      void handleSignalMessage(payload);
    });

    const unsubEnded = signalRService.onCallEnded((payload: CallEndedPayload) => {
      const matchesSession = session?.sessionId === payload.sessionId;
      const matchesIncoming = incomingCall?.sessionId === payload.sessionId;

      if (matchesSession || matchesIncoming) {
        if (matchesSession) playEndTone();
        cleanupWebRTC();
        setIncomingCall(null);
      }
    });

    return () => {
      unsubIncoming();
      unsubSignal();
      unsubEnded();
    };
  }, [session, incomingCall, handleSignalMessage, cleanupWebRTC, playEndTone]);

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
    <CallContext.Provider value={contextValue}>{children}</CallContext.Provider>
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