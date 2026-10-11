/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
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
    toggleMute,
    toggleVideo,
    minimize,
    endCall,
  } = useCall();

  const { user } = useAuth();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [callDuration, setCallDuration] = useState<number>(0);
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [screenBusy, setScreenBusy] = useState<boolean>(false);

  /* ── peer profile lookup ─────────────────────────────── */
  const [peerProfile, setPeerProfile] = useState<UserProfileDto | null>(null);

  const peerId = useMemo(() => {
    if (!session || !user) return '';
    const s = session as unknown as {
      peerId?: string;
      peerUserId?: string;
      initiatorId?: string;
      callerId?: string;
      receiverId?: string;
      calleeId?: string;
    };
    // Prefer explicit peer fields
    if (s.peerId) return s.peerId;
    if (s.peerUserId) return s.peerUserId;
    // Otherwise pick whichever side isn't me
    const a = s.initiatorId ?? s.callerId;
    const b = s.receiverId ?? s.calleeId;
    if (a && b) return a === user.id ? b : a;
    return a ?? b ?? '';
  }, [session, user]);

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

  const peerName = useMemo(() => {
    if (peerProfile) {
      return peerProfile.displayName || peerProfile.userHandle || 'Peer';
    }
    return 'Connecting…';
  }, [peerProfile]);

  const peerAvatar = peerProfile?.avatarUrl ?? null;

  /* ── attach local stream ─────────────────────────────── */
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (localStream) {
      el.srcObject = localStream;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [localStream]);

  /* ── attach remote stream ────────────────────────────── */
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    if (remoteStream) {
      el.srcObject = remoteStream;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [remoteStream]);

  /* ── duration timer ──────────────────────────────────── */
  useEffect(() => {
    if (!session) {
      setCallDuration(0);
      return;
    }
    const id = setInterval(() => setCallDuration((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, [session]);

  const formattedTimer = useMemo(() => {
    const m = Math.floor(callDuration / 60);
    const s = callDuration % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, [callDuration]);

  /* ── screen share toggle ─────────────────────────────── */
  const handleToggleScreenShare = useCallback(async () => {
    if (!localStream) return;
    setScreenBusy(true);
    try {
      if (isScreenSharing) {
        localStream.getVideoTracks().forEach((t) => {
          if ((t as MediaStreamTrack & { _isScreen?: boolean })._isScreen) {
            t.stop();
            localStream.removeTrack(t);
          }
        });
        setIsScreenSharing(false);
      } else {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        const screenTrack = display.getVideoTracks()[0];
        if (!screenTrack) {
          setIsScreenSharing(false);
          return;
        }
        (screenTrack as MediaStreamTrack & { _isScreen?: boolean })._isScreen = true;

        localStream.getVideoTracks().forEach((t) => {
          t.stop();
          localStream.removeTrack(t);
        });
        localStream.addTrack(screenTrack);

        screenTrack.onended = () => {
          localStream.removeTrack(screenTrack);
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
  if (isMinimized) return null;

  const isVideoCall = session.callType === 1;
  const remoteVideoTracks = remoteStream?.getVideoTracks() ?? [];
  const localVideoTracks = localStream?.getVideoTracks() ?? [];
  const hasRemoteVideo = remoteVideoTracks.some(
    (t) => t.enabled && t.readyState === 'live',
  );
  const hasLocalVideo =
    !isVideoOff &&
    localVideoTracks.some((t) => t.enabled && t.readyState === 'live');
  const isConnected = Boolean(remoteStream);

  /* ────────────────────────────────────────────────────── */
  /* VIDEO CALL                                             */
  /* ────────────────────────────────────────────────────── */
  if (isVideoCall) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#0B141A] flex flex-col select-none">
        {/* Remote fullscreen video */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 w-full h-full object-cover ${
            hasRemoteVideo ? 'block' : 'hidden'
          }`}
        />

        {/* Fallback: peer avatar + name */}
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
                {isConnected ? `Connected · ${formattedTimer}` : 'Connecting…'}
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
                {isConnected ? formattedTimer : 'Connecting…'}
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

        {/* Bottom control bar */}
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
              label="Speaker"
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
            {isConnected ? formattedTimer : 'Calling…'}
          </p>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="pb-10 px-4">
        <div className="mx-auto flex items-center justify-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-2xl bg-[#131A20]/95 backdrop-blur-md border border-white/10 shadow-2xl w-fit max-w-full">
          <ControlButton
            icon={isMuted ? MicOff : Mic}
            active={isMuted}
            onClick={toggleMute}
            label={isMuted ? 'Unmute' : 'Mute'}
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
            label="Speaker"
          />
          <ControlButton
            icon={VideoIcon}
            active={false}
            onClick={() => {
              void toggleVideo();
            }}
            label="Turn on video"
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