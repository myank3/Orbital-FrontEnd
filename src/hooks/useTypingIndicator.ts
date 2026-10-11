/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { signalRService } from '../services/signalr';

const TYPING_TIMEOUT_MS = 3000;   // send "false" after this much silence
const EMIT_THROTTLE_MS = 1200;    // don't re-emit "true" more often than this
const RECEIVER_TIMEOUT_MS = 4000; // auto-clear a stuck "true" after this

/* ─── DM: what I emit ──────────────────────────────────── */

export function useDmTypingEmitter(peerId: string | undefined | null) {
  const lastEmitRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);
  const isTypingRef = useRef<boolean>(false);

  const stop = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (isTypingRef.current && peerId) {
      isTypingRef.current = false;
      void signalRService.sendDirectTyping(peerId, false);
    }
  }, [peerId]);

  const onType = useCallback(() => {
    if (!peerId) return;
    const now = Date.now();
    if (now - lastEmitRef.current > EMIT_THROTTLE_MS) {
      lastEmitRef.current = now;
      isTypingRef.current = true;
      void signalRService.sendDirectTyping(peerId, true);
    }
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(stop, TYPING_TIMEOUT_MS);
  }, [peerId, stop]);

  useEffect(() => () => stop(), [stop]);

  return { onType, stop };
}

/* ─── DM: what I receive ───────────────────────────────── */

export function useDmTypingReceiver(peerId: string | undefined | null) {
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const clearRef = useRef<number | null>(null);

  useEffect(() => {
    if (!peerId) {
      setIsPeerTyping(false);
      return;
    }
    const unsub = signalRService.onDirectTyping((payload) => {
      if (payload.senderId !== peerId) return;
      if (payload.isTyping) {
        setIsPeerTyping(true);
        if (clearRef.current) window.clearTimeout(clearRef.current);
        clearRef.current = window.setTimeout(
          () => setIsPeerTyping(false),
          RECEIVER_TIMEOUT_MS,
        );
      } else {
        setIsPeerTyping(false);
        if (clearRef.current) {
          window.clearTimeout(clearRef.current);
          clearRef.current = null;
        }
      }
    });
    return () => {
      unsub();
      if (clearRef.current) {
        window.clearTimeout(clearRef.current);
        clearRef.current = null;
      }
    };
  }, [peerId]);

  return isPeerTyping;
}

/* ─── Group: what I emit ───────────────────────────────── */

export function useGroupTypingEmitter(groupId: number | undefined | null) {
  const lastEmitRef = useRef<number>(0);
  const timeoutRef = useRef<number | null>(null);
  const isTypingRef = useRef<boolean>(false);

  const stop = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (isTypingRef.current && groupId) {
      isTypingRef.current = false;
      void signalRService.sendGroupTyping(groupId, false);
    }
  }, [groupId]);

  const onType = useCallback(() => {
    if (!groupId) return;
    const now = Date.now();
    if (now - lastEmitRef.current > EMIT_THROTTLE_MS) {
      lastEmitRef.current = now;
      isTypingRef.current = true;
      void signalRService.sendGroupTyping(groupId, true);
    }
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(stop, TYPING_TIMEOUT_MS);
  }, [groupId, stop]);

  useEffect(() => () => stop(), [stop]);

  return { onType, stop };
}

/* ─── Group: what I receive ────────────────────────────── */

export function useGroupTypingReceiver(
  groupId: number | undefined | null,
  currentUserId: string | undefined | null,
) {
  const [typingUsers, setTypingUsers] = useState<
    Array<{ userId: string; handle: string }>
  >([]);
  const timeoutsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!groupId) {
      setTypingUsers([]);
      return;
    }
    const unsub = signalRService.onGroupTyping((payload) => {
      if (payload.groupId !== groupId) return;
      if (payload.userId === currentUserId) return;

      const uid = payload.userId;
      const handle = payload.handle ?? '';

      if (payload.isTyping) {
        setTypingUsers((prev) =>
          prev.some((u) => u.userId === uid) ? prev : [...prev, { userId: uid, handle }],
        );
        if (timeoutsRef.current[uid]) window.clearTimeout(timeoutsRef.current[uid]);
        timeoutsRef.current[uid] = window.setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== uid));
          delete timeoutsRef.current[uid];
        }, RECEIVER_TIMEOUT_MS);
      } else {
        setTypingUsers((prev) => prev.filter((u) => u.userId !== uid));
        if (timeoutsRef.current[uid]) {
          window.clearTimeout(timeoutsRef.current[uid]);
          delete timeoutsRef.current[uid];
        }
      }
    });
    return () => {
      unsub();
      Object.values(timeoutsRef.current).forEach((t) => window.clearTimeout(t));
      timeoutsRef.current = {};
      setTypingUsers([]);
    };
  }, [groupId, currentUserId]);

  return typingUsers;
}