/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCall } from '../context/CallContext';
import { useAuth } from '../context/AuthContext';
import { apiService } from '../services/api';
import { UserProfileDto } from '../types/api';
import { Avatar } from './Avatar';
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  ChevronDown,
  Volume2,
  VolumeX,
  MonitorUp,
  MonitorOff,
  Loader2,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Helpers                                                    */
/* ────────────────────────────────────────────────────────── */

function resolvePeerId(
  session: {
    peerId?: string;
    peerUserId?: string;
    initiatorId?: string;
    callerId?: string;
    receiverId?: string;
    calleeId?: string;
  } | null,
  myUserId: string | null,
): string {
  if (!session || !myUserId) return '';

  const candidates = [
    session.peerId,
    session.peerUserId,
    session.initiatorId,
    session.callerId,
    session.receiverId,
    session.calleeId,
  ].filter(Boolean) as string[];

  const other = candidates.find((id) => id !== myUserId);
  return other ?? '';
}

/* ────────────────────────────────────────────────────────── */
/* Constants                                                  */
/* ────────────────────────────────────────────────────────── */

const CALL_BG = '#0B141A';
/** ⚡ WhatsApp auto-hides the chrome after this much idle time on touch. */
const CONTROL_HIDE_MS = 3500;
/** ⚡ Default self-view PiP footprint. Keep in sync with the inline style. */
const PIP_W = 112;
const PIP_H = 160;

/* ────────────────────────────────────────────────────────── */
/* Overlay                                                    */
/* ────────────────────────────────────────────────────────── */

function VideoCallOverlay(): React.JSX.Element | null {
  const {
    session,
    localStream,
    remoteStream,
    isMuted,
    isVideoOff,
    isScreenSharing,
    isSpeakerOn,
    isMinimized,
    callState,
    duration,
    peerId: contextPeerId,
    toggleMute,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    setSpeakerOn,
    minimize,
    expand,
    endCall,
  } = useCall();

  const { user } = useAuth();
  const myUserId = user?.id ?? null;

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipRef = useRef<HTMLDivElement | null>(null);

  const [screenBusy, setScreenBusy] = useState<boolean>(false);
  const [peerProfile, setPeerProfile] = useState<UserProfileDto | null>(null);
  // ⚡ Render trigger — flips once the local <video> has decoded a frame.
  //    Never read; the visibility logic is presence-based (see below).
  const [, setLocalVideoReady] = useState<boolean>(false);

  // ⚡ WhatsApp-style chrome that fades after idle (touch only).
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const hideTimerRef = useRef<number | null>(null);

  const isTouch = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }, []);

  // ⚡ Draggable self-view. `null` = hasn't been placed yet (first paint).
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null);
  const pipDragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);

  // ⚡ Draggable minimized pill (Zoom-style snapping).
  const minimizedRef = useRef<HTMLDivElement | null>(null);
  const [minimizedPos, setMinimizedPos] = useState<{ x: number; y: number } | null>(null);
  const minimizedDragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);

  /* ── Peer ID ─────────────────────────────────────────── */

  const peerId = useMemo(() => {
    if (contextPeerId) return contextPeerId;
    return resolvePeerId(session, myUserId);
  }, [contextPeerId, session, myUserId]);

  /* ── Peer profile ────────────────────────────────────── */

  useEffect(() => {
    if (!peerId) {
      setPeerProfile(null);
      return;
    }
    let active = true;
    apiService
      .getUserProfile(peerId)
      .then((p) => {
        if (active) setPeerProfile(p);
      })
      .catch(() => {
        if (active) setPeerProfile(null);
      });
    return () => {
      active = false;
    };
  }, [peerId]);

  const peerName = useMemo(
    () =>
      peerProfile
        ? peerProfile.displayName || peerProfile.userHandle || 'Peer'
        : 'Connecting…',
    [peerProfile],
  );

  const peerAvatar = peerProfile?.avatarUrl ?? null;

  /* ── Attach local stream ─────────────────────────────── */
  // ⚡ FIX: the deps now include `session` and `isMinimized`.
  //
  //    Previously, deps were `[localStream]` only. That broke the
  //    *initiator's* self-view because CallContext.initiateCall does:
  //
  //       setLocalStream(stream);                    // render A
  //       const s = await initiateCall(...);         // await → render A
  //       setSession(s);                             // render B
  //
  //    Render A:  session=null → overlay returns early → <video> not
  //               in the DOM → localVideoRef.current === null → the
  //               effect runs, finds el=null, and returns without
  //               attaching anything.
  //    Render B:  session set → overlay renders, <video> mounts, ref
  //               is populated — but `localStream` hasn't changed
  //               since Render A, so the effect never re-runs.
  //    Result:    a <video> with no srcObject → black PiP.
  //
  //    Adding `session` re-fires the effect the moment the element
  //    finally mounts. Adding `isMinimized` does the same for
  //    minimize→expand (the <video> unmounts/remounts on those
  //    transitions too).
  //
  //    The acceptor never hit this because acceptCall sets
  //    localStream and session in the same render — that's why only
  //    the caller's self-view was black.

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;

    el.srcObject = null;
    if (!localStream) return;

    el.srcObject = localStream;
    el.muted = true;
    el.volume = 0;

    let cancelled = false;
    const tryPlay = (attempts = 0) => {
      if (cancelled) return;
      el.play().catch(() => {
        if (attempts < 5) {
          window.setTimeout(() => tryPlay(attempts + 1), 120);
        }
      });
    };
    tryPlay();

    const onReady = () => tryPlay();
    el.addEventListener('loadedmetadata', onReady);
    el.addEventListener('canplay', onReady);

    return () => {
      cancelled = true;
      el.removeEventListener('loadedmetadata', onReady);
      el.removeEventListener('canplay', onReady);
    };
  }, [localStream, session, isMinimized]);

  /* ── Attach remote video stream (MUTED) ──────────────── */
  // Audio playback is handled by the persistent <audio> sink inside
  // CallContext. The overlay's video element only carries the video
  // track — audio is muted here to prevent double-play.

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;

    el.srcObject = null;

    if (remoteStream) {
      const videoOnly = new MediaStream(remoteStream.getVideoTracks());
      if (videoOnly.getVideoTracks().length > 0) {
        el.srcObject = videoOnly;
        el.muted = true;
        el.volume = 0;
        el.play().catch((err) => {
          console.warn('[Overlay] Remote video play failed:', err);
        });
      }
    }
  }, [remoteStream]);

  /* ── Formatted timer from shared duration ────────────── */

  const formattedTimer = useMemo(() => {
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, [duration]);

  /* ── Screen share — delegated to CallContext ─────────── */

  const handleToggleScreenShare = useCallback(async () => {
    setScreenBusy(true);
    try {
      if (isScreenSharing) {
        stopScreenShare();
      } else {
        await startScreenShare();
      }
    } finally {
      setScreenBusy(false);
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  /* ── Auto-hide chrome (WhatsApp behaviour, touch only) ─ */

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (!isTouch) return;
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, CONTROL_HIDE_MS);
  }, [isTouch]);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [
    bumpControls,
    callState,
    isMuted,
    isVideoOff,
    isSpeakerOn,
    isScreenSharing,
  ]);

  /* ── Draggable self-view ─────────────────────────────── */

  const onPipPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = pipRef.current;
      if (!el) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      pipDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: rect.left,
        baseY: rect.top,
        moved: false,
      };
    },
    [],
  );

  const onPipPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = pipDragRef.current;
      const el = pipRef.current;
      if (!d || !el) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true;
      const maxX = window.innerWidth - el.offsetWidth - 8;
      const maxY = window.innerHeight - el.offsetHeight - 8;
      const nx = Math.max(8, Math.min(maxX, d.baseX + dx));
      const ny = Math.max(8, Math.min(maxY, d.baseY + dy));
      setPipPos({ x: nx, y: ny });
    },
    [],
  );

  const onPipPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = pipRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      pipDragRef.current = null;
    },
    [],
  );

  // First paint — drop the PiP just below the top bar, top-right corner.
  useEffect(() => {
    if (pipPos !== null) return;
    if (typeof window === 'undefined') return;
    setPipPos({
      x: Math.max(16, window.innerWidth - PIP_W - 16),
      y: 96,
    });
  }, [pipPos]);

  // Re-clamp on resize / orientation change.
  useEffect(() => {
    if (pipPos === null) return;
    const onResize = () => {
      const el = pipRef.current;
      if (!el) return;
      const maxX = window.innerWidth - el.offsetWidth - 8;
      const maxY = window.innerHeight - el.offsetHeight - 8;
      setPipPos((p) =>
        p ? { x: Math.min(p.x, maxX), y: Math.min(p.y, maxY) } : p,
      );
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [pipPos]);

  /* ── Draggable Minimized Pill ────────────────────────── */

  const onMinimizedPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = minimizedRef.current;
      if (!el) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      minimizedDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: rect.left,
        baseY: rect.top,
        moved: false,
      };
      if (!minimizedPos) {
        setMinimizedPos({ x: rect.left, y: rect.top });
      }
    },
    [minimizedPos],
  );

  const onMinimizedPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = minimizedDragRef.current;
      const el = minimizedRef.current;
      if (!d || !el) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true;
      const maxX = window.innerWidth - el.offsetWidth - 8;
      const maxY = window.innerHeight - el.offsetHeight - 8;
      const nx = Math.max(8, Math.min(maxX, d.baseX + dx));
      const ny = Math.max(8, Math.min(maxY, d.baseY + dy));
      setMinimizedPos({ x: nx, y: ny });
    },
    [],
  );

  const onMinimizedPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = minimizedRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      const d = minimizedDragRef.current;
      if (d && d.moved && el) {
        // Zoom-style edge snapping (snap left or right)
        const maxX = window.innerWidth - el.offsetWidth - 8;
        const currentX = minimizedPos?.x ?? 0;
        const snapX = currentX < window.innerWidth / 2 ? 8 : maxX;
        setMinimizedPos((prev) => (prev ? { ...prev, x: snapX } : null));
      }
      // Clear after click event fires
      setTimeout(() => {
        minimizedDragRef.current = null;
      }, 0);
    },
    [minimizedPos],
  );

  // First paint — bottom right by default
  useEffect(() => {
    if (minimizedPos !== null) return;
    if (typeof window === 'undefined') return;
    setMinimizedPos({
      x: Math.max(16, window.innerWidth - 220 - 16),
      y: Math.max(16, window.innerHeight - 80 - 16),
    });
  }, [minimizedPos]);

  if (!session) return null;

  /* ── Minimized (Zoom-style floating pill) ────────────── */

  if (isMinimized) {
    return (
      <div
        ref={minimizedRef}
        onPointerDown={onMinimizedPointerDown}
        onPointerMove={onMinimizedPointerMove}
        onPointerUp={onMinimizedPointerUp}
        onPointerCancel={onMinimizedPointerUp}
        onClick={() => {
          // Only expand if it wasn't a drag
          if (!minimizedDragRef.current?.moved) {
            expand();
          }
        }}
        style={{
          position: 'fixed',
          left: minimizedPos?.x ?? (typeof window !== 'undefined' ? window.innerWidth - 220 : 0),
          top: minimizedPos?.y ?? (typeof window !== 'undefined' ? window.innerHeight - 80 : 0),
          touchAction: 'none',
        }}
        className="z-[100] h-14 pl-3 pr-4 rounded-full bg-[#131A20]/95 backdrop-blur-md border border-white/10 shadow-2xl flex items-center gap-3 hover:bg-[#1A2228] transition-colors cursor-grab active:cursor-grabbing select-none"
        title="Return to call"
      >
        {/* pointer-events-none on children prevents native img drag issues on PC */}
        <div className="pointer-events-none flex items-center gap-3">
          <Avatar name={peerName} src={peerAvatar} size="sm" isOnline />
          <div className="text-left">
            <div className="text-[12px] font-medium text-white truncate max-w-[120px]">
              {peerName}
            </div>
            <div className="text-[10px] text-white/60 font-mono tracking-wider">
              {callState === 'active' ? formattedTimer : 'Connecting…'}
            </div>
          </div>
          <Volume2 className="w-4 h-4 text-white/60" />
        </div>
      </div>
    );
  }

  const isVideoCall = session.callType === 1;
  const remoteVideoTracks = remoteStream?.getVideoTracks() ?? [];
  const localVideoTracks = localStream?.getVideoTracks() ?? [];

  // ⚡ `t.readyState` / `t.enabled` are not reactive — they change without
  //    React noticing. Decide on *presence*; the <video onLoadedMetadata>
  //    handler below flips a state bit to re-render once pixels flow.
  const hasRemoteVideo = remoteVideoTracks.length > 0;
  const hasLocalVideo = !isVideoOff && localVideoTracks.length > 0;
  const isConnected = callState === 'active';

  const statusText = isConnected
    ? formattedTimer
    : callState === 'outgoing'
      ? 'Ringing…'
      : 'Connecting…';

  /* ────────────────────────────────────────────────────── */
  /* VIDEO CALL                                             */
  /* ────────────────────────────────────────────────────── */

  if (isVideoCall) {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col select-none overflow-hidden"
        style={{ background: CALL_BG }}
        onClick={bumpControls}
      >
        {/* Remote video — full bleed */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 w-full h-full object-cover ${
            hasRemoteVideo ? 'block' : 'hidden'
          }`}
        />

        {/* Avatar fallback when the peer has no video yet */}
        {!hasRemoteVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-center px-8">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-[#D97706]/20 blur-2xl scale-110" />
              <Avatar
                name={peerName}
                src={peerAvatar}
                size="xl"
                isOnline={isConnected}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xl sm:text-2xl font-semibold text-white">
                {peerName}
              </p>
              <p className="text-sm text-white/60 font-mono tracking-wider">
                {isConnected ? `Connected · ${formattedTimer}` : statusText}
              </p>
            </div>
          </div>
        )}

        {/* Top chrome — gradient, name, timer, minimize */}
        <div
          className={`absolute top-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-6 pt-4 pb-10 transition-opacity duration-300 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.32) 55%, transparent 100%)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              name={peerName}
              src={peerAvatar}
              size="sm"
              isOnline={isConnected}
            />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-white truncate drop-shadow">
                {peerName}
              </p>
              <p className="text-[11px] text-white/75 font-mono tracking-wider">
                {statusText}
              </p>
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              minimize();
            }}
            className="h-10 w-10 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors shrink-0"
            title="Minimize"
            aria-label="Minimize"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        {/* Draggable self-view PiP */}
        {pipPos && (
          <div
            ref={pipRef}
            onPointerDown={onPipPointerDown}
            onPointerMove={onPipPointerMove}
            onPointerUp={onPipPointerUp}
            onPointerCancel={onPipPointerUp}
            style={{
              position: 'fixed',
              left: pipPos.x,
              top: pipPos.y,
              width: PIP_W,
              height: PIP_H,
              touchAction: 'none',
            }}
            className="z-40 rounded-2xl overflow-hidden bg-[#131A20] border border-white/15 shadow-2xl cursor-grab active:cursor-grabbing"
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setLocalVideoReady(true)}
              onCanPlay={() => setLocalVideoReady(true)}
              className={`w-full h-full object-cover -scale-x-100 ${
                hasLocalVideo ? 'block' : 'hidden'
              }`}
            />

            {!hasLocalVideo && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-[#131A20]">
                {isScreenSharing ? (
                  <>
                    <MonitorUp className="w-5 h-5 text-[#D97706]" />
                    <span className="text-[9px] font-mono text-[#D97706] tracking-wider">
                      Screen
                    </span>
                  </>
                ) : (
                  <>
                    <Avatar
                      name={user?.displayName || 'You'}
                      src={user?.avatarUrl}
                      size="sm"
                    />
                    <span className="text-[9px] font-mono text-white/50 tracking-wider">
                      Camera off
                    </span>
                  </>
                )}
              </div>
            )}

            {hasLocalVideo && (
              <span className="absolute bottom-1 left-1.5 text-[9px] font-mono text-white/80 drop-shadow">
                You
              </span>
            )}

            {isScreenSharing && hasLocalVideo && (
              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#D97706] text-[8px] font-bold text-[#0F0D0A] uppercase tracking-wider">
                Sharing
              </div>
            )}
          </div>
        )}

        {/* Bottom chrome — controls */}
        <div
          className={`absolute bottom-0 inset-x-0 z-30 pb-6 sm:pb-10 pt-14 px-4 transition-opacity duration-300 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            background:
              'linear-gradient(0deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.32) 55%, transparent 100%)',
          }}
        >
          <div className="mx-auto flex items-center justify-center gap-3 sm:gap-4 max-w-full">
            <ControlButton
              icon={isMuted ? MicOff : Mic}
              active={isMuted}
              onClick={toggleMute}
              label={isMuted ? 'Unmute' : 'Mute'}
            />
            <ControlButton
              icon={isVideoOff ? VideoOff : VideoIcon}
              active={isVideoOff}
              onClick={toggleVideo}
              label={isVideoOff ? 'Camera on' : 'Camera off'}
            />
            <ControlButton
              icon={PhoneOff}
              danger
              size="lg"
              onClick={() => void endCall()}
              label="End call"
            />
            <ControlButton
              icon={isSpeakerOn ? Volume2 : VolumeX}
              active={!isSpeakerOn}
              onClick={() => setSpeakerOn(!isSpeakerOn)}
              label={isSpeakerOn ? 'Speaker on' : 'Speaker off'}
            />
            <ControlButton
              icon={isScreenSharing ? MonitorOff : MonitorUp}
              active={isScreenSharing}
              onClick={() => void handleToggleScreenShare()}
              label={isScreenSharing ? 'Stop sharing' : 'Share screen'}
              busy={screenBusy}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────── */
  /* AUDIO CALL                                             */
  /* ────────────────────────────────────────────────────── */

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col select-none overflow-hidden"
      style={{
        background: `linear-gradient(180deg, #0B141A 0%, #0F1A21 50%, #0B141A 100%)`,
      }}
      onClick={bumpControls}
    >
      {/* Top chrome */}
      <div
        className={`absolute top-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-6 pt-4 pb-6 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/50">
          Audio Call
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            minimize();
          }}
          className="h-10 w-10 rounded-full bg-white/5 hover:bg-white/10 text-white flex items-center justify-center transition-colors"
          title="Minimize"
          aria-label="Minimize"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>

      {/* Center — big avatar */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8 text-center">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-[#D97706]/20 blur-2xl scale-110" />
          <Avatar
            name={peerName}
            src={peerAvatar}
            size="xl"
            isOnline={isConnected}
          />
        </div>

        <div className="space-y-3">
          <p className="text-2xl sm:text-3xl font-semibold text-white">
            {peerName}
          </p>
          <p className="text-sm text-white/60 font-mono tracking-wider">
            {statusText}
          </p>
        </div>
      </div>

      {/* Bottom chrome — controls */}
      <div
        className={`absolute bottom-0 inset-x-0 z-30 pb-10 pt-14 px-4 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          background:
            'linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.22) 55%, transparent 100%)',
        }}
      >
        <div className="mx-auto flex items-center justify-center gap-3 sm:gap-5 max-w-full">
          <ControlButton
            icon={isMuted ? MicOff : Mic}
            active={isMuted}
            onClick={toggleMute}
            label={isMuted ? 'Unmute' : 'Mute'}
          />
          <ControlButton
            icon={PhoneOff}
            danger
            size="lg"
            onClick={() => void endCall()}
            label="End call"
          />
          <ControlButton
            icon={isSpeakerOn ? Volume2 : VolumeX}
            active={!isSpeakerOn}
            onClick={() => setSpeakerOn(!isSpeakerOn)}
            label={isSpeakerOn ? 'Speaker on' : 'Speaker off'}
          />
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Control button                                             */
/* ────────────────────────────────────────────────────────── */

interface ControlButtonProps {
  icon: React.ElementType;
  active?: boolean;
  /** ⚡ `danger` renders the red end-call styling (was a separate <button>). */
  danger?: boolean;
  /** ⚡ `lg` is the centered end-call size — matches WhatsApp. */
  size?: 'md' | 'lg';
  onClick: () => void;
  label: string;
  busy?: boolean;
}

function ControlButton({
  icon: Icon,
  active = false,
  danger = false,
  size = 'md',
  onClick,
  label,
  busy = false,
}: ControlButtonProps) {
  const sizeCls =
    size === 'lg' ? 'h-14 w-14 sm:h-16 sm:w-16' : 'h-12 w-12';
  const iconCls = size === 'lg' ? 'w-6 h-6 sm:w-7 sm:h-7' : 'w-5 h-5';

  const tone = danger
    ? 'bg-[#E63B3B] hover:bg-[#C72D2D] text-white shadow-[0_8px_24px_-8px_rgba(230,59,59,0.8)]'
    : active
      ? 'bg-white text-[#0B141A]'
      : 'bg-white/12 hover:bg-white/20 text-white backdrop-blur-md';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={busy}
      title={label}
      aria-label={label}
      className={`${sizeCls} rounded-full flex items-center justify-center transition-all duration-150 disabled:opacity-50 active:scale-95 ${tone}`}
    >
      {busy ? (
        <Loader2 className={`${iconCls} animate-spin`} />
      ) : (
        <Icon className={iconCls} />
      )}
    </button>
  );
}

export default VideoCallOverlay;