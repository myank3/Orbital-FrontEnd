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
import { recordCall } from '../services/callLog';
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

/* Extract a timestamp from whatever shape the DTO uses. */
function sessionStartedAt(session: CallSessionDto | null | undefined): number {
  if (!session) return Date.now();
  const s = session as unknown as {
    startedAt?: string;
    createdAt?: string;
  };
  const raw = s.startedAt ?? s.createdAt;
  if (raw) {
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function CallProviderComponent({ children }: CallProviderProps): React.JSX.Element {
  const [session, setSession] = useState<CallSessionDto | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<CallSessionDto | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSetRef = useRef<boolean>(false);
  const pendingRemoteOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const activePeerIdRef = useRef<string | null>(null);
  const callStartedAtRef = useRef<number>(0); // ─── NEW: tracks when call began

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
      // ignore
    }

    return { iceServers: fallbackServers };
  }, []);

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
    callStartedAtRef.current = 0;

    setLocalStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop());
      return null;
    });
    setRemoteStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop());
      return null;
    });

    setSession(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsMinimized(false);

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
    }
  }, []);

  const drainIceCandidateQueue = useCallback(async (pc: RTCPeerConnection) => {
    remoteDescriptionSetRef.current = true;
    while (iceCandidateQueueRef.current.length > 0) {
      const candidateInit = iceCandidateQueueRef.current.shift();
      if (candidateInit) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidateInit)); }
        catch { /* ignore */ }
      }
    }
  }, []);

  const acquireMediaStream = useCallback(async (callType: number): Promise<MediaStream> => {
    const hasVideo = callType === CallType.Video;
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: hasVideo
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        : false,
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }, []);

  const createPeerConnection = useCallback(
    async (
      targetSessionId: string,
      targetPeerId: string,
      stream: MediaStream,
    ): Promise<RTCPeerConnection> => {
      const config = await getRtcConfiguration();
      const pc = new RTCPeerConnection(config);
      peerConnectionRef.current = pc;
      remoteDescriptionSetRef.current = false;
      activePeerIdRef.current = targetPeerId;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event: RTCTrackEvent) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        } else {
          setRemoteStream(new MediaStream([event.track]));
        }
      };

      pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          const candidateData: CallSignalMessage = {
            type: 'candidate',
            candidate: event.candidate.toJSON(),
          };
          void signalRService.sendCallSignal(targetSessionId, targetPeerId, candidateData);
        }
      };

      return pc;
    },
    [getRtcConfiguration],
  );

  const initiateCall = useCallback(
    async (peerId: string, callType: number): Promise<void> => {
      if (!peerId) throw new Error('Peer ID is required to initiate a 1-on-1 direct call.');

      cleanupWebRTC();
      callStartedAtRef.current = Date.now(); // ─── NEW

      const stream = await acquireMediaStream(callType);
      setLocalStream(stream);

      const newSession = await apiService.initiateCall({ peerId, callType });
      setSession(newSession);

      const pc = await createPeerConnection(newSession.sessionId, peerId, stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const offerData: CallSignalMessage = { type: 'offer', sdp: offer.sdp };
      await signalRService.sendCallSignal(newSession.sessionId, peerId, offerData);
    },
    [cleanupWebRTC, acquireMediaStream, createPeerConnection],
  );

  const acceptCall = useCallback(async (): Promise<void> => {
    if (!incomingCall) return;

    const currentIncoming = incomingCall;
    setIncomingCall(null);
    setSession(currentIncoming);
    callStartedAtRef.current = Date.now(); // ─── NEW

    const peerId = currentIncoming.initiatorId ?? currentIncoming.peerId ?? '';
    if (!peerId) throw new Error('No initiator ID found on incoming call session.');

    const stream = await acquireMediaStream(currentIncoming.callType);
    setLocalStream(stream);

    await apiService.updateCallStatus(currentIncoming.sessionId, CallSessionStatus.Active);

    const pc = await createPeerConnection(currentIncoming.sessionId, peerId, stream);

    const offerSdp = pendingRemoteOfferRef.current;
    if (offerSdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      await drainIceCandidateQueue(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const answerData: CallSignalMessage = { type: 'answer', sdp: answer.sdp };
      await signalRService.sendCallSignal(currentIncoming.sessionId, peerId, answerData);
      pendingRemoteOfferRef.current = null;
    }
  }, [incomingCall, acquireMediaStream, createPeerConnection, drainIceCandidateQueue]);

  const rejectCall = useCallback(async (): Promise<void> => {
    if (!incomingCall) return;

    const callToReject = incomingCall;
    const peerId = callToReject.initiatorId ?? callToReject.peerId ?? '';
    setIncomingCall(null);

    // ─── recordCall: declined incoming ───
    if (peerId) {
      recordCall({
        peerId,
        peerName: 'Peer',
        peerAvatarUrl: null,
        callType: callToReject.callType,
        direction: 'incoming',
        outcome: 'declined',
        startedAt: new Date(sessionStartedAt(callToReject)).toISOString(),
        durationSeconds: 0,
      });
    }
    // ─────────────────────────────────────

    try {
      await apiService.updateCallStatus(callToReject.sessionId, CallSessionStatus.Rejected);
      if (peerId) {
        await signalRService.notifyCallEnded(callToReject.sessionId, peerId);
      }
    } catch { /* ignore */ }
  }, [incomingCall]);

  const endCall = useCallback(async (): Promise<void> => {
    const currentSession = session;
    const currentIncoming = incomingCall;
    const currentSessionId = currentSession?.sessionId ?? currentIncoming?.sessionId;
    const peerId =
      activePeerIdRef.current ??
      currentSession?.peerId ??
      currentSession?.initiatorId ??
      currentIncoming?.initiatorId ??
      undefined;

    // ─── recordCall: local hangup ───
    const toRecord = currentSession ?? currentIncoming;
    if (toRecord && peerId) {
      const startedAtMs = callStartedAtRef.current || sessionStartedAt(toRecord);
      const durationSeconds = Math.max(
        0,
        Math.round((Date.now() - startedAtMs) / 1000),
      );
      const isOutgoing = Boolean(currentSession);
      recordCall({
        peerId,
        peerName: 'Peer',
        peerAvatarUrl: null,
        callType: toRecord.callType,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        outcome: durationSeconds > 2 ? 'answered' : 'missed',
        startedAt: new Date(startedAtMs).toISOString(),
        durationSeconds,
      });
    }
    // ─────────────────────────────────

    cleanupWebRTC();

    if (currentSessionId) {
      try {
        await apiService.endCall(currentSessionId);
        if (peerId) await signalRService.notifyCallEnded(currentSessionId, peerId);
      } catch { /* ignore */ }
    }
  }, [session, incomingCall, cleanupWebRTC]);

  // Track session in sessionStorage for orphan recovery
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (session?.sessionId) {
      sessionStorage.setItem(ACTIVE_CALL_STORAGE_KEY, session.sessionId);
    } else {
      sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
    }
  }, [session]);

  // beforeunload cleanup
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeUnload = () => {
      const activeSessionId = sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
      if (!activeSessionId) return;
      const token = getAccessToken();
      if (!token) return;

      const url = `${API_BASE_URL.replace(/\/+$/, '')}/api/Call/${encodeURIComponent(
        activeSessionId,
      )}/end`;

      try {
        fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        }).catch(() => {});
      } catch { /* ignore */ }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Mount-time orphan recovery
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const staleSessionId = sessionStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
    if (!staleSessionId) return;
    sessionStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
    void apiService.endCall(staleSessionId).catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const newMuted = !isMuted;
    localStream.getAudioTracks().forEach((t) => { t.enabled = !newMuted; });
    setIsMuted(newMuted);
  }, [localStream, isMuted]);

  const toggleVideo = useCallback(() => {
    if (!localStream) return;
    const newVideoOff = !isVideoOff;
    localStream.getVideoTracks().forEach((t) => { t.enabled = !newVideoOff; });
    setIsVideoOff(newVideoOff);
  }, [localStream, isVideoOff]);

  const minimize = useCallback(() => setIsMinimized(true), []);
  const expand = useCallback(() => setIsMinimized(false), []);

  const handleSignalMessage = useCallback(
    async (payload: CallSignalPayload) => {
      let messageData: CallSignalMessage;

      if (typeof payload.signalData === 'string') {
        try { messageData = JSON.parse(payload.signalData) as CallSignalMessage; }
        catch { return; }
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

          const answerData: CallSignalMessage = { type: 'answer', sdp: answer.sdp };
          await signalRService.sendCallSignal(payload.sessionId, payload.senderId, answerData);
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
          try { await pc.addIceCandidate(new RTCIceCandidate(messageData.candidate)); }
          catch { /* ignore */ }
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
        // ─── recordCall: peer ended ───
        const toRecord = matchesSession ? session : incomingCall;
        const peerId =
          activePeerIdRef.current ??
          session?.peerId ??
          session?.initiatorId ??
          incomingCall?.initiatorId ??
          undefined;

        if (toRecord && peerId) {
          const startedAtMs = callStartedAtRef.current || sessionStartedAt(toRecord);
          const durationSeconds = Math.max(
            0,
            Math.round((Date.now() - startedAtMs) / 1000),
          );
          recordCall({
            peerId,
            peerName: 'Peer',
            peerAvatarUrl: null,
            callType: toRecord.callType,
            direction: matchesSession ? 'outgoing' : 'incoming',
            outcome: durationSeconds > 2 ? 'answered' : 'missed',
            startedAt: new Date(startedAtMs).toISOString(),
            durationSeconds,
          });
        }
        // ─────────────────────────────

        cleanupWebRTC();
        setIncomingCall(null);
      }
    });

    return () => {
      unsubIncoming();
      unsubSignal();
      unsubEnded();
    };
  }, [session, incomingCall, handleSignalMessage, cleanupWebRTC]);

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
      session, localStream, remoteStream, isMuted, isVideoOff, isMinimized, incomingCall,
      initiateCall, acceptCall, rejectCall, endCall,
      toggleMute, toggleVideo, minimize, expand,
    ],
  );

  return <CallContext.Provider value={contextValue}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextType {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used within a CallProvider');
  return context;
}

const CallProvider = CallProviderComponent;

export default CallProvider;
export { CallProvider };