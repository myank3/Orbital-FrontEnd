import { useCallback, useEffect, useRef, useState } from 'react';
import * as sfu from '../services/cloudflareRealtime';
import { signalRService } from '../services/signalr';

const PREFIX = '[call:';

/** SFU topology — safe to go higher than mesh. 10 keeps UI readable. */
export const MAX_PARTICIPANTS = 10;

/** Minimum gap between publishes triggered by probe responses. */
const PROBE_RESPONSE_MIN_MS = 30_000;

type CallEvent =
  | { type: 'join'; userId: string; displayName: string; sessionId: string; muted: boolean }
  | { type: 'publish'; userId: string; displayName: string; sessionId: string; trackName: string; muted: boolean }
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

export interface UseGroupCallResult {
  inCall: boolean;
  participants: CallParticipant[];
  activeCallers: ActiveCaller[];
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
  const [activeCallers, setActiveCallers] = useState<ActiveCaller[]>([]);
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
  const activeCallersRef = useRef<Map<string, { displayName: string; lastSeen: number }>>(new Map());
  const mutedRef = useRef(false);
  const inCallRef = useRef(false);

  // Deduplication — only publish when something actually changed
  const lastPublishKeyRef = useRef<string>('');
  const lastPublishAtRef = useRef<number>(0);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);

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

  /**
   * Publish our current track+session+mute state.
   *
   * - `force = true` bypasses the dedupe (used on join, mute toggle, initial publish)
   * - `force = false` respects dedupe: same state within 30s is skipped
   *
   * This is the ONLY publish path now — no more heartbeat interval.
   */
  const sendPublish = useCallback((force = false) => {
    if (!me) return;
    const sid = sessionIdRef.current;
    const tid = localTrackRef.current?.id;
    if (!sid || !tid) return;

    const stateKey = `${sid}:${tid}:${mutedRef.current}`;
    const now = Date.now();

    if (!force) {
      if (lastPublishKeyRef.current === stateKey && now - lastPublishAtRef.current < PROBE_RESPONSE_MIN_MS) {
        return; // same state, recently published — skip
      }
      if (now - lastPublishAtRef.current < PROBE_RESPONSE_MIN_MS) {
        return; // recently published a different state — still rate-limited
      }
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
    }).catch(() => { /* silent */ });
  }, [me, send]);

  const leave = useCallback(() => {
    if (me) void send({ type: 'leave', userId: me.id }).catch(() => {});
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
    setParticipants([]);
    setInCall(false);
    setMuted(false);
  }, [me, send]);

  const join = useCallback(async () => {
    if (!groupId || !me || inCall) return;
    setError(null);

    if (activeCallersRef.current.size >= MAX_PARTICIPANTS) {
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
      track.enabled = !mutedRef.current;

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

      // One publish announces both presence AND track. We don't need a separate
      // `join` event — the publish handler updates activeCallers AND triggers
      // the pull flow for existing participants.
      sendPublish(true);

      // Delayed probe lets us discover any existing callers we didn't see
      // because they published before we connected. Rate-limited on their side.
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
    try {
      const t = localTrackRef.current;
      if (!t) return;
      const nextEnabled = !t.enabled;
      t.enabled = nextEnabled;
      const nowMuted = !nextEnabled;
      setMuted(nowMuted);
      mutedRef.current = nowMuted;

      // Publish new state (force — real change) and notify peers via `mute`
      if (inCallRef.current) sendPublish(true);
      if (me) {
        void send({ type: 'mute', userId: me.id, muted: nowMuted }).catch(() => { /* silent */ });
      }
    } catch (err) {
      console.warn('[call] toggleMute failed', err);
    }
  }, [me, send, sendPublish]);

  // No heartbeat interval — presence is kept fresh by:
  //   1. `publish` on state change (join, mute)
  //   2. `publish` responses to `probe` (rate-limited to once per 30s)
  //   3. 45s expiry sweep below removes stale entries

  // Probe existing callers on mount / group switch
  useEffect(() => {
    if (!groupId || !me) return;
    const t = window.setTimeout(() => {
      void send({ type: 'probe', userId: me.id }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [groupId, me?.id, send]);

  // Expiry sweep — drop stale callers who stopped publishing
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [uid, v] of activeCallersRef.current) {
        if (now - v.lastSeen > 90000) { // 90s (up from 45s — no heartbeat to rely on)
          activeCallersRef.current.delete(uid);
          changed = true;
        }
      }
      if (changed) refreshActiveCallers();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refreshActiveCallers]);

  // Reset when the group changes
  useEffect(() => {
    activeCallersRef.current.clear();
    setActiveCallers([]);
  }, [groupId]);

  // Real-time handlers
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
        refreshActiveCallers();
      } else if (evt.type === 'mute') {
        const p = participantsRef.current.get(evt.userId);
        if (p) {
          p.muted = evt.muted;
          setParticipants(Array.from(participantsRef.current.values()));
        }
      } else if (evt.type === 'probe' && evt.userId !== me.id && inCallRef.current) {
        // Rate-limited — only responds once per 30s per user
        sendPublish(false);
      }

      if (evt.type === 'publish' && evt.userId !== me.id && inCallRef.current) {
        pullFor(evt);
      }

      if (evt.type === 'join' && evt.userId !== me.id && inCallRef.current) {
        // Legacy join events from older clients — respond with rate-limited publish
        sendPublish(false);
      }
    });
    return () => unsub();
  }, [groupId, me, pullFor, refreshActiveCallers, sendPublish]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pcRef.current) {
        if (me) void send({ type: 'leave', userId: me.id }).catch(() => {});
        try { pcRef.current.close(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { inCall, participants, activeCallers, muted, error, join, leave, toggleMute };
}