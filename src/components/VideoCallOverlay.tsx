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
  Minus,
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
/* Overlay                                                    */
/* ────────────────────────────────────────────────────────── */

function VideoCallOverlay(): React.JSX.Element | null {
  const {
    session,
    localStream,
    remoteStream,
    isMuted,
    isVideoOff,
    isMinimized,
    callState,
    duration,
    peerId: contextPeerId,
    toggleMute,
    toggleVideo,
    minimize,
    expand,
    endCall,
  } = useCall();

  const { user } = useAuth();
  const myUserId = user?.userId ?? null;

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);

  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [screenBusy, setScreenBusy] = useState<boolean>(false);
  const [peerProfile, setPeerProfile] = useState<UserProfileDto | null>(null);

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

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (localStream) {
      el.srcObject = localStream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [localStream]);

  /* ── Attach remote stream to the off-screen / visible video ── */

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    if (remoteStream) {
      el.srcObject = remoteStream;
      el.muted = false;
      el.volume = isSpeakerOn ? 1 : 0.25;
      el.play().catch((err) => {
        console.warn('[Overlay] Remote video play failed:', err);
      });
    } else {
      el.srcObject = null;
    }
  }, [remoteStream, isSpeakerOn]);

  /* ── Formatted timer from shared duration ────────────── */

  const formattedTimer = useMemo(() => {
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, [duration]);

  /* ── Screen share ────────────────────────────────────── */

  const handleToggleScreenShare = useCallback(async () => {
    if (!localStream) return;
    setScreenBusy(true);
    try {
      if (isScreenSharing) {
        localStream.getVideoTracks().forEach((t) => {
          t.stop();
          localStream.removeTrack(t);
        });
        if (cameraTrackRef.current) {
          localStream.addTrack(cameraTrackRef.current);
          cameraTrackRef.current = null;
        }
        setIsScreenSharing(false);
      } else {
        const existingCam = localStream.getVideoTracks()[0] ?? null;
        if (existingCam) {
          cameraTrackRef.current = existingCam;
          existingCam.stop();
          localStream.removeTrack(existingCam);
        }

        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        const screenTrack = display.getVideoTracks()[0];
        if (!screenTrack) {
          if (cameraTrackRef.current) {
            localStream.addTrack(cameraTrackRef.current);
            cameraTrackRef.current = null;
          }
          return;
        }

        localStream.addTrack(screenTrack);
        screenTrack.onended = () => {
          localStream.removeTrack(screenTrack);
          if (cameraTrackRef.current) {
            localStream.addTrack(cameraTrackRef.current);
            cameraTrackRef.current = null;
          }
          setIsScreenSharing(false);
        };

        setIsScreenSharing(true);
      }
    } catch (err) {
      console.warn('Screen share toggle failed:', err);
      setIsScreenSharing(false);
    } finally {
      setScreenBusy(false);
    }
  }, [isScreenSharing, localStream]);

  if (!session) return null;

  /* ── Minimized ───────────────────────────────────────── */

  if (isMinimized) {
    return (
      <button
        onClick={expand}
        className="fixed bottom-4 right-4 z-[100] h-14 pl-3 pr-4 rounded-full bg-[#131A20]/95 backdrop-blur-md border border-white/10 shadow-2xl flex items-center gap-3 hover:bg-[#1A2228] transition-colors"
        title="Return to call"
      >
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
      </button>
    );
  }

  const isVideoCall = session.callType === 1;
  const remoteVideoTracks = remoteStream?.getVideoTracks() ?? [];
  const localVideoTracks = localStream?.getVideoTracks() ?? [];
  const hasRemoteVideo = remoteVideoTracks.some(
    (t) => t.enabled && t.readyState === 'live',
  );
  const hasLocalVideo =
    !isVideoOff &&
    localVideoTracks.some((t) => t.enabled && t.readyState === 'live');
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
      <div className="fixed inset-0 z-[100] bg-[#0B141A] flex flex-col select-none">
        {/*
          The remote <video> element is the ONLY audio sink.
          It plays the full remote MediaStream (audio + video).
          We never use display:none — Chrome 140 will not route
          audio through a display:none media element. We use
          opacity:0 instead when there is no video track to show.
        */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{ opacity: hasRemoteVideo ? 1 : 0 }}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
        />

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

        {/* Self-view PiP */}
        <div className="absolute top-20 right-4 sm:top-24 sm:right-6 w-28 sm:w-40 aspect-[3/4] rounded-2xl overflow-hidden bg-[#131A20] border border-white/10 shadow-2xl z-20">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover -scale-x-100 ${
              hasLocalVideo ? 'block' : 'hidden'
            }`}
          />
          {!hasLocalVideo && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2">
              {isScreenSharing ? (
                <>
                  <MonitorUp className="w-6 h-6 text-[#D97706]" />
                  <span className="text-[10px] font-mono text-[#D97706]">
                    Screen
                  </span>
                </>
              ) : (
                <Avatar
                  name={user?.displayName || 'You'}
                  src={user?.avatarUrl}
                  size="md"
                />
              )}
              {!isScreenSharing && (
                <span className="text-[10px] font-mono text-white/50">
                  Camera off
                </span>
              )}
            </div>
          )}
          {isScreenSharing && hasLocalVideo && (
            <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-[#D97706] text-[9px] font-bold text-[#0F0D0A] uppercase tracking-wider">
              Sharing
            </div>
          )}
        </div>

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              name={peerName}
              src={peerAvatar}
              size="sm"
              isOnline={isConnected}
            />
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-white truncate">
                {peerName}
              </p>
              <p className="text-[11px] text-white/60 font-mono tracking-wider">
                {statusText}
              </p>
            </div>
          </div>

          <button
            onClick={minimize}
            className="h-9 w-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors shrink-0"
            title="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="relative z-10 mt-auto pb-6 sm:pb-10 px-4">
          <div className="mx-auto flex items-center justify-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-2xl bg-[#131A20]/95 backdrop-blur-md border border-white/10 shadow-2xl w-fit max-w-full">
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
              icon={isScreenSharing ? MonitorOff : MonitorUp}
              active={isScreenSharing}
              onClick={() => void handleToggleScreenShare()}
              label={isScreenSharing ? 'Stop sharing' : 'Share screen'}
              busy={screenBusy}
            />
            <ControlButton
              icon={isSpeakerOn ? Volume2 : VolumeX}
              active={!isSpeakerOn}
              onClick={() => setIsSpeakerOn((v) => !v)}
              label={isSpeakerOn ? 'Speaker on' : 'Speaker off'}
            />
            <button
              onClick={() => void endCall()}
              className="h-12 w-12 rounded-full bg-[#E63B3B] hover:bg-[#C72D2D] text-white flex items-center justify-center transition-colors shadow-lg ml-1"
              title="End call"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────── */
  /* AUDIO CALL                                             */
  /* ────────────────────────────────────────────────────── */

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-b from-[#0B141A] via-[#0F1A21] to-[#0B141A] flex flex-col select-none">
      {/*
        Chrome 140 will not route WebRTC audio through a media
        element with `display: none` or when it's removed from the
        render tree. So we render the remote <video> element
        off-screen but still laid out — 1×1 px, fully transparent,
        positioned off-canvas. It carries the audio track and
        nothing else, since audio calls have no video track.
      */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        style={{
          position: 'fixed',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
          left: -9999,
          top: -9999,
        }}
      />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4">
        <div className="text-xs font-mono uppercase tracking-[0.22em] text-white/50">
          Audio Call
        </div>
        <button
          onClick={minimize}
          className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 text-white flex items-center justify-center transition-colors"
          title="Minimize"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* Center */}
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

      {/* Controls */}
      <div className="pb-10 px-4">
        <div className="mx-auto flex items-center justify-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-2xl bg-[#131A20]/95 backdrop-blur-md border border-white/10 shadow-2xl w-fit max-w-full">
          <ControlButton
            icon={isMuted ? MicOff : Mic}
            active={isMuted}
            onClick={toggleMute}
            label={isMuted ? 'Unmute' : 'Mute'}
          />
          <ControlButton
            icon={isSpeakerOn ? Volume2 : VolumeX}
            active={!isSpeakerOn}
            onClick={() => setIsSpeakerOn((v) => !v)}
            label={isSpeakerOn ? 'Speaker on' : 'Speaker off'}
          />
          <button
            onClick={() => void endCall()}
            className="h-12 w-12 rounded-full bg-[#E63B3B] hover:bg-[#C72D2D] text-white flex items-center justify-center transition-colors shadow-lg ml-1"
            title="End call"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
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
  active: boolean;
  onClick: () => void;
  label: string;
  busy?: boolean;
}

function ControlButton({
  icon: Icon,
  active,
  onClick,
  label,
  busy = false,
}: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
        active
          ? 'bg-[#D97706] text-[#0F0D0A]'
          : 'bg-white/10 hover:bg-white/20 text-white'
      }`}
    >
      {busy ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <Icon className="w-5 h-5" />
      )}
    </button>
  );
}

export default VideoCallOverlay;