import { useCallback, useEffect, useRef, useState } from 'react';
import * as sfu from '../services/cloudflareRealtime';
import { signalRService } from '../services/signalr';
import { activeCallRegistry } from '../services/activeCallRegistry';

const PREFIX = '[call:';

export const MAX_PARTICIPANTS = 10;
const PROBE_RESPONSE_MIN_MS = 3_000;
const STALE_CALLER_MS = 90_000;

type CallEvent =
  | { type: 'join'; userId: string; displayName: string; sessionId: string; muted: boolean }
  | { type: 'publish'; userId: string; displayName: string; sessionId: string; trackName: string; muted: boolean }
  | { type: 'screen-publish'; userId: string; displayName: string; sessionId: string; videoTrackName: string; audioTrackName?: string }
  | { type: 'screen-stop'; userId: string }
  | { type: 'screen-react'; userId: string; displayName: string; emoji: string }
  | { type: 'mute'; userId: string; muted: boolean }
  | { type: 'leave'; userId: string }
  | { type: 'probe'; userId: string };

export interface CallParticipant {
  userId: string;
  displayName: string;
  stream: MediaStream;
  muted: boolean;
}

export interface ActiveCaller {
  userId: string;
  displayName: string;
}

export interface ScreenShareState {
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  isLocal: boolean;
  closedByMe: boolean;
}

export interface ScreenReactionBurst {
  id: string;
  emoji: string;
  senderName: string;
  x: number;
}

export interface UseGroupCallResult {
  inCall: boolean;
  callGroupId: number | null;
  localStream: MediaStream | null;
  participants: CallParticipant[];
  activeCallers: ActiveCaller[];
  muted: boolean;
  error: string | null;
  canShareScreen: boolean;
  isSharingScreen: boolean;
  screenShare: ScreenShareState | null;
  screenReactions: ScreenReactionBurst[];
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  closeRemoteScreenForMe: () => void;
  reopenRemoteScreenForMe: () => void;
  sendScreenReaction: (emoji: string) => void;
}

export function isCallSignal(content: string | null | undefined): boolean {
  return !!content && content.startsWith(PREFIX) && content.endsWith(']');
}

function detectDesktopScreenShareSupport(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return false;
  if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|wv/i.test(navigator.userAgent)) return false;
  return true;
}

export function useGroupCall(
  groupId: number | undefined,
  me: { id: string; displayName: string } | undefined,
  groupName?: string,
): UseGroupCallResult {
  const [inCall, setInCall] = useState(false);
  const [callGroupId, setCallGroupId] = useState<number | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [activeCallers, setActiveCallers] = useState<ActiveCaller[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screenShare, setScreenShare] = useState<ScreenShareState | null>(null);
  const [screenReactions, setScreenReactions] = useState<ScreenReactionBurst[]>([]);

  const canShareScreen = detectDesktopScreenShareSupport();

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localTrackRef = useRef<MediaStreamTrack | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoTrackIdRef = useRef<string | null>(null);
  const screenAudioTrackIdRef = useRef<string | null>(null);
  const remoteScreenStreamRef = useRef<MediaStream | null>(null);
  const remoteScreenTransceiversRef = useRef<RTCRtpTransceiver[]>([]);
  const activeRemoteScreenEvtRef = useRef<Extract<CallEvent, { type: 'screen-publish' }> | null>(null);
  const closedByMeUserIdRef = useRef<string | null>(null);

  const screenShareRef = useRef<ScreenShareState | null>(null);
  useEffect(() => { screenShareRef.current = screenShare; }, [screenShare]);

  const pulledKeysRef = useRef<Set<string>>(new Set());
  const participantsRef = useRef<Map<string, CallParticipant>>(new Map());
  const pendingPullsRef = useRef<Array<{ userId: string; displayName: string; kind: 'audio' | 'screen-video' | 'screen-audio' }>>([]);
  const pullChainRef = useRef<Promise<void>>(Promise.resolve());
  const activeCallersRef = useRef<Map<string, { displayName: string; lastSeen: number }>>(new Map());
  const mutedRef = useRef(false);
  const inCallRef = useRef(false);

  const lastPublishKeyRef = useRef<string>('');
  const lastPublishAtRef = useRef<number>(0);
  const joiningRef = useRef(false);
  const prevGroupIdRef = useRef<number | undefined>(groupId);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);

  const pushReactionBurst = useCallback((emoji: string, senderName: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const x = 15 + Math.round(Math.random() * 70);
    setScreenReactions((prev) => [...prev.slice(-18), { id, emoji, senderName, x }]);
    window.setTimeout(() => {
      setScreenReactions((prev) => prev.filter((item) => item.id !== id));
    }, 2600);
  }, []);

  const refreshActiveCallers = useCallback(() => {
    const list = Array.from(activeCallersRef.current.entries())
      .filter(([uid]) => uid !== me?.id)
      .map(([userId, v]) => ({ userId, displayName: v.displayName }));
    setActiveCallers(list);
  }, [me?.id]);

  const send = useCallback(
    async (evt: CallEvent) => {
      if (!groupId) return;
      try {
        await signalRService.sendGroupMessage({
          groupId,
          content: `${PREFIX}${JSON.stringify(evt)}]`,
          mediaUrl: undefined,
          mediaType: undefined,
        });
      } catch (err) {
        console.warn('[call] signal send failed', err);
      }
    },
    [groupId],
  );

  const sendScreenReaction = useCallback((emoji: string) => {
    if (!me || !inCallRef.current || !screenShareRef.current) return;
    pushReactionBurst(emoji, me.displayName || 'You');
    void send({
      type: 'screen-react',
      userId: me.id,
      displayName: me.displayName || 'User',
      emoji,
    }).catch(() => {});
  }, [me, send, pushReactionBurst]);

  const sendPublish = useCallback((force = false) => {
    if (!me) return;
    const sid = sessionIdRef.current;
    const tid = localTrackRef.current?.id;
    if (!sid || !tid) return;

    const stateKey = `${sid}:${tid}:${mutedRef.current}`;
    const now = Date.now();

    if (!force) {
      if (lastPublishKeyRef.current === stateKey && now - lastPublishAtRef.current < PROBE_RESPONSE_MIN_MS) return;
      if (now - lastPublishAtRef.current < PROBE_RESPONSE_MIN_MS) return;
    }

    lastPublishKeyRef.current = stateKey;
    lastPublishAtRef.current = now;

    void send({
      type: 'publish',
      userId: me.id,
      displayName: me.displayName,
      sessionId: sid,
      trackName: tid,
      muted: mutedRef.current,
    }).catch(() => {});
  }, [me, send]);

  const sendScreenPublish = useCallback(() => {
    if (!me) return;
    const sid = sessionIdRef.current;
    const vTid = screenVideoTrackIdRef.current;
    if (!sid || !vTid) return;
    void send({
      type: 'screen-publish',
      userId: me.id,
      displayName: me.displayName,
      sessionId: sid,
      videoTrackName: vTid,
      audioTrackName: screenAudioTrackIdRef.current ?? undefined,
    }).catch(() => {});
  }, [me, send]);

  const cleanupRemoteScreenMedia = useCallback(() => {
    try {
      remoteScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch { /* noop */ }
    remoteScreenStreamRef.current = null;
    for (const tx of remoteScreenTransceiversRef.current) {
      try {
        tx.direction = 'inactive';
        tx.receiver?.track?.stop();
      } catch { /* noop */ }
    }
    remoteScreenTransceiversRef.current = [];
  }, []);

  const closeRemoteScreenForMe = useCallback(() => {
    const cur = screenShareRef.current;
    if (!cur || cur.isLocal) return;
    closedByMeUserIdRef.current = cur.userId;
    const evt = activeRemoteScreenEvtRef.current;
    if (evt) {
      pulledKeysRef.current.delete(`${evt.sessionId}:${evt.videoTrackName}`);
      if (evt.audioTrackName) pulledKeysRef.current.delete(`${evt.sessionId}:${evt.audioTrackName}`);
    }
    cleanupRemoteScreenMedia();
    setScreenShare({
      userId: cur.userId,
      displayName: cur.displayName,
      stream: null,
      isLocal: false,
      closedByMe: true,
    });
  }, [cleanupRemoteScreenMedia]);

  const stopScreenShare = useCallback(() => {
    const hadLocal = Boolean(screenStreamRef.current);
    try { screenStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    screenStreamRef.current = null;
    screenVideoTrackIdRef.current = null;
    screenAudioTrackIdRef.current = null;
    if (hadLocal && me) {
      void send({ type: 'screen-stop', userId: me.id }).catch(() => {});
    }
    setScreenShare((prev) => (prev?.isLocal ? null : prev));
  }, [me, send]);

  const startScreenShare = useCallback(async () => {
    if (!canShareScreen || !me || !inCallRef.current) return;
    if (screenShareRef.current && !screenShareRef.current.isLocal && !screenShareRef.current.closedByMe) {
      setError(`${screenShareRef.current.displayName} is already sharing their screen.`);
      return;
    }
    const pc = pcRef.current;
    const sid = sessionIdRef.current;
    if (!pc || !sid) return;

    if (screenStreamRef.current) {
      stopScreenShare();
    }

    try {
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920, max: 2560 },
            height: { ideal: 1080, max: 1440 },
            frameRate: { ideal: 60, max: 60 },
          },
          audio: true,
        });
      } catch (firstErr) {
        if (firstErr instanceof Error && firstErr.name === 'NotAllowedError') throw firstErr;
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
      }

      const videoTrack = displayStream.getVideoTracks()[0];
      if (!videoTrack) {
        displayStream.getTracks().forEach((t) => t.stop());
        return;
      }

      try {
        videoTrack.contentHint = 'detail';
      } catch { /* unsupported browser */ }

      const audioTrack = displayStream.getAudioTracks()[0] ?? null;

      videoTrack.onended = () => {
        stopScreenShare();
      };

      cleanupRemoteScreenMedia();
      closedByMeUserIdRef.current = null;
      activeRemoteScreenEvtRef.current = null;

      await (pullChainRef.current = pullChainRef.current.then(async () => {
        const currentPc = pcRef.current;
        const currentSid = sessionIdRef.current;
        if (!currentPc || !currentSid) return;

        const vTx = currentPc.addTransceiver(videoTrack, { direction: 'sendonly' });
        await currentPc.setLocalDescription(await currentPc.createOffer());
        const vPub = await sfu.publishTrack(
          currentSid,
          vTx.mid!,
          videoTrack.id,
          currentPc.localDescription!.sdp,
        );
        if (vPub?.sessionDescription) {
          await currentPc.setRemoteDescription(vPub.sessionDescription);
        }

        try {
          const params = vTx.sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 4_000_000;
          params.encodings[0].maxFramerate = 60;
          params.degradationPreference = 'maintain-resolution';
          await vTx.sender.setParameters(params);
        } catch (bitrateErr) {
          console.warn('[call] HD bitrate hint skipped', bitrateErr);
        }

        if (audioTrack) {
          try {
            const aTx = currentPc.addTransceiver(audioTrack, { direction: 'sendonly' });
            await currentPc.setLocalDescription(await currentPc.createOffer());
            const aPub = await sfu.publishTrack(
              currentSid,
              aTx.mid!,
              audioTrack.id,
              currentPc.localDescription!.sdp,
            );
            if (aPub?.sessionDescription) {
              await currentPc.setRemoteDescription(aPub.sessionDescription);
            }
          } catch (audioErr) {
            console.warn('[call] screen audio publish skipped', audioErr);
          }
        }
      }));

      screenStreamRef.current = displayStream;
      screenVideoTrackIdRef.current = videoTrack.id;
      screenAudioTrackIdRef.current = audioTrack?.id ?? null;

      setScreenShare({
        userId: me.id,
        displayName: me.displayName || 'You',
        stream: displayStream,
        isLocal: true,
        closedByMe: false,
      });

      sendScreenPublish();
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        return;
      }
      console.warn('[call] startScreenShare failed', err);
      setError('Could not start screen sharing.');
    }
  }, [canShareScreen, me, sendScreenPublish, stopScreenShare, cleanupRemoteScreenMedia]);

  const leave = useCallback(() => {
    if (me) {
      if (screenStreamRef.current) {
        void send({ type: 'screen-stop', userId: me.id }).catch(() => {});
      }
      void send({ type: 'leave', userId: me.id }).catch(() => {});
    }
    try { screenStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    screenStreamRef.current = null;
    screenVideoTrackIdRef.current = null;
    screenAudioTrackIdRef.current = null;
    cleanupRemoteScreenMedia();
    activeRemoteScreenEvtRef.current = null;
    closedByMeUserIdRef.current = null;

    try { pcRef.current?.close(); } catch { /* noop */ }
    pcRef.current = null;
    sessionIdRef.current = null;
    try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    localStreamRef.current = null;
    localTrackRef.current = null;
    pulledKeysRef.current.clear();
    pendingPullsRef.current = [];
    participantsRef.current.clear();
    lastPublishKeyRef.current = '';
    lastPublishAtRef.current = 0;

    inCallRef.current = false;
    setParticipants([]);
    setScreenShare(null);
    setScreenReactions([]);
    setInCall(false);
    setCallGroupId(null);
    setLocalStream(null);
    setMuted(false);
    setError(null);
  }, [me, send, cleanupRemoteScreenMedia]);

  const join = useCallback(async () => {
    if (!groupId || !me || inCall) return;
    if (joiningRef.current || pcRef.current) {
      console.warn('[call] join already in progress');
      return;
    }
    joiningRef.current = true;
    setError(null);

    if (activeCallersRef.current.size >= MAX_PARTICIPANTS) {
      setError(`This call is full (${MAX_PARTICIPANTS} participants max).`);
      joiningRef.current = false;
      return;
    }

    void send({
      type: 'join',
      userId: me.id,
      displayName: me.displayName,
      sessionId: '',
      muted: mutedRef.current,
    }).catch(() => {});

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      const track = stream.getAudioTracks()[0];
      localTrackRef.current = track;
      track.enabled = !mutedRef.current;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
        bundlePolicy: 'max-bundle',
      });
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const meta = pendingPullsRef.current.shift();
        if (!meta) return;

        if (meta.kind === 'screen-video' || meta.kind === 'screen-audio') {
          if (closedByMeUserIdRef.current === meta.userId) {
            try { e.track.stop(); } catch { /* noop */ }
            return;
          }
          if (e.transceiver) {
            remoteScreenTransceiversRef.current.push(e.transceiver);
          }
          let scr = remoteScreenStreamRef.current;
          if (!scr) {
            scr = new MediaStream();
            remoteScreenStreamRef.current = scr;
          }
          scr.addTrack(e.track);
          setScreenShare({
            userId: meta.userId,
            displayName: meta.displayName || 'User',
            stream: scr,
            isLocal: false,
            closedByMe: false,
          });
          return;
        }

        const mediaStream = new MediaStream([e.track]);
        const existing = participantsRef.current.get(meta.userId);
        participantsRef.current.set(meta.userId, {
          userId: meta.userId,
          displayName: meta.displayName,
          stream: mediaStream,
          muted: existing?.muted ?? false,
        });
        setParticipants(Array.from(participantsRef.current.values()));
      };

      const tx = pc.addTransceiver(track, { direction: 'sendonly' });

      await pc.setLocalDescription(await pc.createOffer());
      const created = await sfu.createSession(pc.localDescription!.sdp);
      sessionIdRef.current = created.sessionId;
      await pc.setRemoteDescription(created.sessionDescription);

      await new Promise<void>((resolve, reject) => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') return resolve();
        const timer = window.setTimeout(() => reject(new Error('ICE connect timeout')), 10000);
        const checkState = () => {
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            window.clearTimeout(timer);
            pc.removeEventListener('iceconnectionstatechange', checkState);
            resolve();
          }
        };
        pc.addEventListener('iceconnectionstatechange', checkState);
      });

      await pc.setLocalDescription(await pc.createOffer());
      const pub = await sfu.publishTrack(
        created.sessionId,
        tx.mid!,
        track.id,
        pc.localDescription!.sdp,
      );

      if (pub?.sessionDescription) {
        await pc.setRemoteDescription(pub.sessionDescription);
      }

      inCallRef.current = true;
      setInCall(true);
      setCallGroupId(groupId);

      sendPublish(true);

      window.setTimeout(() => {
        if (inCallRef.current) {
          void send({ type: 'probe', userId: me.id }).catch(() => {});
        }
      }, 500);
    } catch (err) {
      console.error('[call] join failed', err);
      const msg = err instanceof Error ? err.message : 'Could not join call';
      if (/permission|denied/i.test(msg)) {
        setError('Microphone permission denied. Enable it in browser settings.');
      } else if (/timeout/i.test(msg)) {
        setError('Connection timeout — check your network and try again.');
      } else {
        setError(msg);
      }
      leave();
      throw err;
    } finally {
      joiningRef.current = false;
    }
  }, [groupId, me, inCall, send, sendPublish, leave]);

  const pullFor = useCallback(
    (evt: Extract<CallEvent, { type: 'publish' }>) => {
      if (!me || evt.userId === me.id) return;
      const key = `${evt.sessionId}:${evt.trackName}`;
      if (pulledKeysRef.current.has(key)) return;
      if (!pcRef.current || !sessionIdRef.current) return;
      pulledKeysRef.current.add(key);

      if (!participantsRef.current.has(evt.userId)) {
        participantsRef.current.set(evt.userId, {
          userId: evt.userId,
          displayName: evt.displayName,
          stream: new MediaStream(),
          muted: evt.muted,
        });
        setParticipants(Array.from(participantsRef.current.values()));
      }

      pullChainRef.current = pullChainRef.current.then(async () => {
        const pc = pcRef.current;
        const mySid = sessionIdRef.current;
        if (!pc || !mySid) return;

        const meta = { userId: evt.userId, displayName: evt.displayName, kind: 'audio' as const };
        pendingPullsRef.current.push(meta);

        try {
          const r = await sfu.pullTrack(mySid, evt.sessionId, evt.trackName);
          if (r.requiresImmediateRenegotiation && r.sessionDescription) {
            await pc.setRemoteDescription(r.sessionDescription);
            await pc.setLocalDescription(await pc.createAnswer());
            await sfu.sendAnswer(mySid, pc.localDescription!.sdp);
          }
        } catch (err) {
          console.warn('[call] pull failed', err);
          pulledKeysRef.current.delete(key);
          const idx = pendingPullsRef.current.indexOf(meta);
          if (idx >= 0) pendingPullsRef.current.splice(idx, 1);
        }
      });
    },
    [me],
  );

  const pullScreenFor = useCallback(
    (evt: Extract<CallEvent, { type: 'screen-publish' }>, forceReopen = false) => {
      if (!me || evt.userId === me.id) return;
      if (screenShareRef.current && screenShareRef.current.userId !== evt.userId) return;

      activeRemoteScreenEvtRef.current = evt;

      if (!forceReopen && closedByMeUserIdRef.current === evt.userId) {
        setScreenShare({
          userId: evt.userId,
          displayName: evt.displayName || 'User',
          stream: null,
          isLocal: false,
          closedByMe: true,
        });
        return;
      }

      const vKey = `${evt.sessionId}:${evt.videoTrackName}`;
      if (pulledKeysRef.current.has(vKey)) return;
      if (!pcRef.current || !sessionIdRef.current) return;
      pulledKeysRef.current.add(vKey);

      cleanupRemoteScreenMedia();
      remoteScreenStreamRef.current = new MediaStream();

      pullChainRef.current = pullChainRef.current.then(async () => {
        const pc = pcRef.current;
        const mySid = sessionIdRef.current;
        if (!pc || !mySid) return;

        const vMeta = { userId: evt.userId, displayName: evt.displayName || 'User', kind: 'screen-video' as const };
        pendingPullsRef.current.push(vMeta);

        try {
          const r = await sfu.pullTrack(mySid, evt.sessionId, evt.videoTrackName);
          if (r.requiresImmediateRenegotiation && r.sessionDescription) {
            await pc.setRemoteDescription(r.sessionDescription);
            await pc.setLocalDescription(await pc.createAnswer());
            await sfu.sendAnswer(mySid, pc.localDescription!.sdp);
          }

          if (evt.audioTrackName) {
            const aKey = `${evt.sessionId}:${evt.audioTrackName}`;
            if (!pulledKeysRef.current.has(aKey)) {
              pulledKeysRef.current.add(aKey);
              const aMeta = { userId: evt.userId, displayName: evt.displayName || 'User', kind: 'screen-audio' as const };
              pendingPullsRef.current.push(aMeta);
              try {
                const ar = await sfu.pullTrack(mySid, evt.sessionId, evt.audioTrackName);
                if (ar.requiresImmediateRenegotiation && ar.sessionDescription) {
                  await pc.setRemoteDescription(ar.sessionDescription);
                  await pc.setLocalDescription(await pc.createAnswer());
                  await sfu.sendAnswer(mySid, pc.localDescription!.sdp);
                }
              } catch {
                pulledKeysRef.current.delete(aKey);
                const aIdx = pendingPullsRef.current.indexOf(aMeta);
                if (aIdx >= 0) pendingPullsRef.current.splice(aIdx, 1);
              }
            }
          }
        } catch (err) {
          console.warn('[call] screen pull failed', err);
          pulledKeysRef.current.delete(vKey);
          const idx = pendingPullsRef.current.indexOf(vMeta);
          if (idx >= 0) pendingPullsRef.current.splice(idx, 1);
        }
      });
    },
    [me, cleanupRemoteScreenMedia],
  );

  const reopenRemoteScreenForMe = useCallback(() => {
    const evt = activeRemoteScreenEvtRef.current;
    closedByMeUserIdRef.current = null;
    if (evt) {
      pullScreenFor(evt, true);
    }
  }, [pullScreenFor]);

  const toggleMute = useCallback(() => {
    try {
      const t = localTrackRef.current;
      if (!t) return;
      const nextEnabled = !t.enabled;
      t.enabled = nextEnabled;
      const nowMuted = !nextEnabled;
      setMuted(nowMuted);
      mutedRef.current = nowMuted;

      if (inCallRef.current) sendPublish(true);
      if (me) {
        void send({ type: 'mute', userId: me.id, muted: nowMuted }).catch(() => {});
      }
    } catch (err) {
      console.warn('[call] toggleMute failed', err);
    }
  }, [me, send, sendPublish]);

  useEffect(() => {
    if (prevGroupIdRef.current === groupId) return;
    const prev = prevGroupIdRef.current;
    prevGroupIdRef.current = groupId;

    if (inCallRef.current && prev != null && me) {
      void signalRService.sendGroupMessage({
        groupId: prev,
        content: `${PREFIX}${JSON.stringify({ type: 'leave', userId: me.id })}]`,
        mediaUrl: undefined,
        mediaType: undefined,
      }).catch(() => {});
    }

    try { screenStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    screenStreamRef.current = null;
    screenVideoTrackIdRef.current = null;
    screenAudioTrackIdRef.current = null;
    cleanupRemoteScreenMedia();
    activeRemoteScreenEvtRef.current = null;
    closedByMeUserIdRef.current = null;

    try { pcRef.current?.close(); } catch { /* noop */ }
    pcRef.current = null;
    sessionIdRef.current = null;
    try { localStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    localStreamRef.current = null;
    localTrackRef.current = null;
    pulledKeysRef.current.clear();
    pendingPullsRef.current = [];
    participantsRef.current.clear();
    activeCallersRef.current.clear();
    lastPublishKeyRef.current = '';
    lastPublishAtRef.current = 0;

    inCallRef.current = false;
    joiningRef.current = false;
    setInCall(false);
    setCallGroupId(null);
    setLocalStream(null);
    setParticipants([]);
    setActiveCallers([]);
    setScreenShare(null);
    setScreenReactions([]);
    setMuted(false);
    setError(null);
  }, [groupId, me, cleanupRemoteScreenMedia]);

  useEffect(() => {
    if (inCall && callGroupId != null) {
      activeCallRegistry.register({
        kind: 'group',
        leave: () => { leave(); },
        label: groupName ?? `group ${callGroupId}`,
      });
    } else {
      activeCallRegistry.unregister('group');
    }
  }, [inCall, callGroupId, groupName, leave]);

  useEffect(() => {
    return () => {
      activeCallRegistry.unregister('group');
      joiningRef.current = false;
      try { screenStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      if (pcRef.current) {
        const leaveGroupId = prevGroupIdRef.current ?? groupId;
        if (me && leaveGroupId != null) {
          void signalRService.sendGroupMessage({
            groupId: leaveGroupId,
            content: `${PREFIX}${JSON.stringify({ type: 'leave', userId: me.id })}]`,
            mediaUrl: undefined,
            mediaType: undefined,
          }).catch(() => {});
        }
        try { pcRef.current.close(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!groupId || !me) return;
    const t = window.setTimeout(() => {
      void send({ type: 'probe', userId: me.id }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [groupId, me?.id, send]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [uid, v] of activeCallersRef.current) {
        if (now - v.lastSeen > STALE_CALLER_MS) {
          activeCallersRef.current.delete(uid);
          changed = true;
        }
      }
      if (changed) refreshActiveCallers();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refreshActiveCallers]);

  useEffect(() => {
    if (!groupId || !me) return;
    const unsub = signalRService.onReceiveGroupMessage((msg) => {
      if (msg.groupId !== groupId) return;
      if (!isCallSignal(msg.content)) return;

      let evt: CallEvent;
      try {
        evt = JSON.parse(msg.content!.slice(PREFIX.length, -1));
      } catch {
        return;
      }

      if ((evt.type === 'publish' || evt.type === 'join') && evt.userId !== me.id) {
        activeCallersRef.current.set(evt.userId, {
          displayName: evt.displayName,
          lastSeen: Date.now(),
        });
        refreshActiveCallers();
      } else if (evt.type === 'leave') {
        activeCallersRef.current.delete(evt.userId);
        participantsRef.current.delete(evt.userId);
        setParticipants(Array.from(participantsRef.current.values()));
        if (screenShareRef.current?.userId === evt.userId) {
          cleanupRemoteScreenMedia();
          activeRemoteScreenEvtRef.current = null;
          closedByMeUserIdRef.current = null;
          setScreenShare(null);
        }
        refreshActiveCallers();
      } else if (evt.type === 'mute') {
        const p = participantsRef.current.get(evt.userId);
        if (p) {
          p.muted = evt.muted;
          setParticipants(Array.from(participantsRef.current.values()));
        }
      } else if (evt.type === 'screen-stop') {
        if (screenShareRef.current?.userId === evt.userId) {
          cleanupRemoteScreenMedia();
          activeRemoteScreenEvtRef.current = null;
          closedByMeUserIdRef.current = null;
          setScreenShare(null);
        }
      } else if (evt.type === 'screen-react' && evt.userId !== me.id && inCallRef.current) {
        pushReactionBurst(evt.emoji, evt.displayName || 'User');
      } else if (evt.type === 'probe' && evt.userId !== me.id && inCallRef.current) {
        sendPublish(true);
        if (screenStreamRef.current) sendScreenPublish();
      }

      if (evt.type === 'publish' && evt.userId !== me.id && inCallRef.current) {
        pullFor(evt);
      }

      if (evt.type === 'screen-publish' && evt.userId !== me.id && inCallRef.current) {
        pullScreenFor(evt);
      }

      if (evt.type === 'join' && evt.userId !== me.id && inCallRef.current) {
        sendPublish(true);
        if (screenStreamRef.current) sendScreenPublish();
      }
    });
    return () => unsub();
  }, [groupId, me, pullFor, pullScreenFor, refreshActiveCallers, sendPublish, sendScreenPublish, cleanupRemoteScreenMedia, pushReactionBurst]);

  return {
    inCall,
    callGroupId,
    localStream,
    participants,
    activeCallers,
    muted,
    error,
    canShareScreen,
    isSharingScreen: Boolean(screenShare?.isLocal),
    screenShare,
    screenReactions,
    join,
    leave,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    closeRemoteScreenForMe,
    reopenRemoteScreenForMe,
    sendScreenReaction,
  };
}