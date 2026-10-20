import { useCallback, useEffect, useRef, useState } from 'react';
import * as sfu from '../services/cloudflareRealtime';
import { signalRService } from '../services/signalr';
import { activeCallRegistry } from '../services/activeCallRegistry';

const PREFIX = '[call:';

/** SFU topology — safe to go higher than mesh. 10 keeps UI readable. */
export const MAX_PARTICIPANTS = 10;

/**
 * Minimum gap between publishes triggered by probe responses.
 * Was 30s — lowered to 3s so a fresh joiner can hear existing
 * participants who published moments ago (they'd otherwise be skipped
 * by the rate-limit and never re-published).
 *
 * NOTE: `probe` and `join` responses now bypass this entirely
 * (force = true) — see sendPublish / probe / join handlers below.
 * This constant only applies to dedupe for other background publishes.
 */
const PROBE_RESPONSE_MIN_MS = 3_000;

/** SFU session disconnected if we don't hear anything for this long. */
const STALE_CALLER_MS = 90_000;

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
  /**
   * Which group the active call belongs to. `null` when not in a call.
   * NOTE: this can differ from the groupId you passed in — after a
   * group switch the teardown effect may not have fired yet in the
   * same tick. Consumers should treat `callGroupId === groupId` as
   * "in THIS group's call" and `callGroupId != null && callGroupId !== groupId`
   * as "in another group's call".
   */
  callGroupId: number | null;
  /** Mic stream. Null when not in a call. */
  localStream: MediaStream | null;
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
  groupName?: string,
): UseGroupCallResult {
  const [inCall, setInCall] = useState(false);
  const [callGroupId, setCallGroupId] = useState<number | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
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

  const lastPublishKeyRef = useRef<string>('');
  const lastPublishAtRef = useRef<number>(0);

  /**
   * Tracks the group we last saw. Used by the groupId-change teardown
   * effect (#1) to know whether to send a leave to the previous group.
   * Initialised to `groupId` so the very first render is a no-op.
   */
  const prevGroupIdRef = useRef<number | undefined>(groupId);

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
   * - `force = false` respects dedupe: same state within PROBE_RESPONSE_MIN_MS is skipped
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
        return;
      }
      if (now - lastPublishAtRef.current < PROBE_RESPONSE_MIN_MS) {
        return;
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
    }).catch(() => {});
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

    // FIX #3: flip the ref synchronously *before* setInCall so any
    // in-flight publish handlers see the correct state immediately.
    inCallRef.current = false;
    setParticipants([]);
    setInCall(false);
    setCallGroupId(null);
    setLocalStream(null);
    setMuted(false);
  }, [me, send]);

  const join = useCallback(async () => {
    if (!groupId || !me || inCall) return;
    // Guard against concurrent join() invocations (double-click, etc.)
    if (pcRef.current) {
      console.warn('[call] join already in progress');
      return;
    }
    setError(null);

    if (activeCallersRef.current.size >= MAX_PARTICIPANTS) {
      setError(`This call is full (${MAX_PARTICIPANTS} participants max).`);
      return;
    }

    // ── FIX #3: announce presence immediately ────────────────────────
    // getUserMedia + SFU handshake can take several seconds. Sending
    // `join` first means others see us in the pill within ~100ms,
    // instead of staring at "1 in call" until our media is live.
    // sessionId/track aren't ready yet — peers treat `join` as a
    // presence-only event, so an empty sessionId is harmless.
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

      // ── FIX #2: apply the SFU's answer to our publish offer ──────
      // Previously this return value was discarded, leaving the
      // RTCPeerConnection stuck in `have-local-offer`. Any later
      // pull would then trigger an implicit rollback, which drops
      // the publish entirely on some browser/SFU combinations.
      if (pub?.sessionDescription) {
        await pc.setRemoteDescription(pub.sessionDescription);
      } else if (pc.signalingState === 'have-local-offer') {
        console.warn(
          '[call] publishTrack returned no answer — signaling state is', pc.signalingState,
        );
      }

      // FIX #3: set the ref synchronously so any publish arriving in
      // the next few ms is not dropped by the inCallRef guard in the
      // receive handler below.
      inCallRef.current = true;
      setInCall(true);
      setCallGroupId(groupId);

      // Publish announces our track so existing peers can pull it.
      sendPublish(true);

      // Probe for existing participants we didn't see yet.
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

        // Hold a reference to our queue entry so a failure removes the
        // RIGHT one, not whatever happens to be last.
        const meta = { userId: evt.userId, displayName: evt.displayName };
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
    }, [me],
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

      if (inCallRef.current) sendPublish(true);
      if (me) {
        void send({ type: 'mute', userId: me.id, muted: nowMuted }).catch(() => { /* silent */ });
      }
    } catch (err) {
      console.warn('[call] toggleMute failed', err);
    }
  }, [me, send, sendPublish]);

  // ── FIX #1: tear down the SFU session when the group changes. ──────
  //
  // The previous implementation only cleared the roster *display*,
  // leaving pcRef/sessionIdRef/localTrackRef pointing at the previous
  // group's SFU session. Then `inCall` stayed true and `join()` in the
  // new group returned early (`if (inCall) return`), so the user was
  // "in a call" in group B while the audio was still A's call.
  // This effect closes the loop: leave A (send leave to A's channel),
  // tear down everything, and reset state so B starts clean.
  useEffect(() => {
    if (prevGroupIdRef.current === groupId) return;
    const prev = prevGroupIdRef.current;
    prevGroupIdRef.current = groupId;

    // Send leave to the OLD group. `send()` closes over the current
    // (new) groupId so we can't reuse it — go direct.
    if (inCallRef.current && prev != null && me) {
      void signalRService.sendGroupMessage({
        groupId: prev,
        content: `${PREFIX}${JSON.stringify({ type: 'leave', userId: me.id })}]`,
        mediaUrl: undefined,
        mediaType: undefined,
      }).catch(() => {});
    }

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
    setInCall(false);
    setCallGroupId(null);
    setLocalStream(null);
    setParticipants([]);
    setActiveCallers([]);
    setMuted(false);
    setError(null);
  }, [groupId, me]);

  // ── Registry publish (feeds CallContext blocking). ─────────────────
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

  // Cleanup on unmount — clears the registry AND closes the SFU
  // session so navigation away doesn't leave a phantom call.
  useEffect(() => {
    return () => {
      activeCallRegistry.unregister('group');
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
        if (now - v.lastSeen > STALE_CALLER_MS) {
          activeCallersRef.current.delete(uid);
          changed = true;
        }
      }
      if (changed) refreshActiveCallers();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refreshActiveCallers]);

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
        // ── FIX #1: FORCE the publish. A fresh joiner may have missed
        // our earlier publish because they weren't `inCall` yet when
        // it arrived. If we respect the rate limit here, they'll
        // never hear us and never pull our track. A probe is a
        // one-shot per-peer request — no spam risk.
        sendPublish(true);
      }

      if (evt.type === 'publish' && evt.userId !== me.id && inCallRef.current) {
        pullFor(evt);
      }

      if (evt.type === 'join' && evt.userId !== me.id && inCallRef.current) {
        // ── FIX #1b: Someone joined — re-publish so they can pull
        // our track. Force it so the rate limiter can't block a fresh
        // joiner from hearing us. If they aren't inCall yet, their own
        // probe (500ms later) will still recover the situation.
        sendPublish(true);
      }
    });
    return () => unsub();
  }, [groupId, me, pullFor, refreshActiveCallers, sendPublish]);

  return {
    inCall,
    callGroupId,
    localStream,
    participants,
    activeCallers,
    muted,
    error,
    join,
    leave,
    toggleMute,
  };
}