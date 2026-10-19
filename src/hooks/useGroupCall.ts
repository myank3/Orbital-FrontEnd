import { useCallback, useEffect, useRef, useState } from 'react';
import * as sfu from '../services/cloudflareRealtime';
import { signalRService } from '../services/signalr';

const PREFIX = '[call:';
export const MAX_PARTICIPANTS = 5;

type CallEvent =
  | { type: 'join'; userId: string; displayName: string; sessionId: string; muted: boolean }
  | { type: 'publish'; userId: string; displayName: string; sessionId: string; trackName: string; muted: boolean }
  | { type: 'mute'; userId: string; muted: boolean }
  | { type: 'leave'; userId: string };

export interface CallParticipant {
  userId: string;
  displayName: string;
  stream: MediaStream;
  muted: boolean;
}

export interface UseGroupCallResult {
  inCall: boolean;
  participants: CallParticipant[];
  muted: boolean;
  error: string | null;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
}

export function isCallSignal(content: string | null | undefined): boolean {
  return !!content && content.startsWith(PREFIX) && content.endsWith(']');
}

export function useGroupCall(
  groupId: number | undefined,
  me: { id: string; displayName: string } | undefined,
): UseGroupCallResult {
  const [inCall, setInCall] = useState(false);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localTrackRef = useRef<MediaStreamTrack | null>(null);
  const pulledKeysRef = useRef<Set<string>>(new Set());
  const participantsRef = useRef<Map<string, CallParticipant>>(new Map());
  const pendingPullsRef = useRef<Array<{ userId: string; displayName: string }>>([]);
  const pullChainRef = useRef<Promise<void>>(Promise.resolve());

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

  const leave = useCallback(() => {
    if (me) void send({ type: 'leave', userId: me.id });
    try { pcRef.current?.close(); } catch { /* noop */ }
    pcRef.current = null;
    sessionIdRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localTrackRef.current = null;
    pulledKeysRef.current.clear();
    pendingPullsRef.current = [];
    participantsRef.current.clear();
    setParticipants([]);
    setInCall(false);
    setMuted(false);
  }, [me, send]);

  const join = useCallback(async () => {
    if (!groupId || !me || inCall) return;
    setError(null);

    // Capacity check — we'd be the (size + 1)th person
    if (participantsRef.current.size + 1 > MAX_PARTICIPANTS) {
      setError(`This call is full (${MAX_PARTICIPANTS} participants max).`);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      localTrackRef.current = track;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
        bundlePolicy: 'max-bundle',
      });
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const meta = pendingPullsRef.current.shift();
        if (!meta) return;
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
      await sfu.publishTrack(created.sessionId, tx.mid!, track.id, pc.localDescription!.sdp);

      setInCall(true);

      await send({
        type: 'join',
        userId: me.id,
        displayName: me.displayName,
        sessionId: created.sessionId,
        muted: false,
      });
      await send({
        type: 'publish',
        userId: me.id,
        displayName: me.displayName,
        sessionId: created.sessionId,
        trackName: track.id,
        muted: false,
      });
    } catch (err) {
      console.error('[call] join failed', err);
      setError(err instanceof Error ? err.message : 'Could not join call');
      leave();
    }
  }, [groupId, me, inCall, send, leave]);

  const pullFor = useCallback(
    (evt: Extract<CallEvent, { type: 'publish' }>) => {
      if (!me || evt.userId === me.id) return;
      const key = `${evt.sessionId}:${evt.trackName}`;
      if (pulledKeysRef.current.has(key)) return;
      if (!pcRef.current || !sessionIdRef.current) return;
      pulledKeysRef.current.add(key);

      // Show them in the list immediately, before the track arrives
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

        pendingPullsRef.current.push({ userId: evt.userId, displayName: evt.displayName });

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
          pendingPullsRef.current.pop();
        }
      });
    },
    [me],
  );

  const toggleMute = useCallback(() => {
    const t = localTrackRef.current;
    if (!t) return;
    t.enabled = !t.enabled;
    const nowMuted = !t.enabled;
    setMuted(nowMuted);
    if (me) void send({ type: 'mute', userId: me.id, muted: nowMuted });
  }, [me, send]);

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

      if (evt.type === 'join' && evt.userId !== me.id && inCall) {
        // Someone joined — re-announce our publish so they can pull us
        const sid = sessionIdRef.current;
        const tid = localTrackRef.current?.id;
        if (sid && tid) {
          void send({
            type: 'publish',
            userId: me.id,
            displayName: me.displayName,
            sessionId: sid,
            trackName: tid,
            muted,
          });
        }
      } else if (evt.type === 'publish' && evt.userId !== me.id && inCall) {
        pullFor(evt);
      } else if (evt.type === 'mute') {
        const p = participantsRef.current.get(evt.userId);
        if (p) {
          p.muted = evt.muted;
          setParticipants(Array.from(participantsRef.current.values()));
        }
      } else if (evt.type === 'leave') {
        participantsRef.current.delete(evt.userId);
        setParticipants(Array.from(participantsRef.current.values()));
      }
    });
    return () => unsub();
  }, [groupId, me, inCall, send, pullFor, muted]);

  useEffect(() => {
    return () => {
      if (pcRef.current) leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { inCall, participants, muted, error, join, leave, toggleMute };
}