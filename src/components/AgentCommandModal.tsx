/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Mic,
  ArrowUp,
  X,
  Check,
  AlertTriangle,
  Send,
  Volume2,
  VolumeX,
  MessageCircle,
  Users,
  Phone,
  Settings,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { useGroupCallContext } from '../context/GroupCallContext';
import {
  AgentQuickAction,
  AgentResult,
  ScheduledOrbitalMessage,
  cancelScheduledMessageById,
  clearPendingAgentState,
  dispatchOrbitalMessage,
  formatAgentError,
  getCachedListsSync,
  getScheduledMessagesForUser,
  runOrbitalAgent,
  syncAgentUserSession,
} from '../services/orbitalAgent';

const LOGO_CSS = `
  @keyframes orb-fluid-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes orb-fluid-breathe {
    0%, 100% { transform: scale(0.95); opacity: 0.92; }
    50%      { transform: scale(1.06); opacity: 1; }
  }
  .orb-ring-cw {
    transform-origin: 18px 18px;
    animation: orb-fluid-spin 14s linear infinite;
  }
  .orb-ring-cw-fast {
    transform-origin: 18px 18px;
    animation: orb-fluid-spin 2.4s linear infinite;
  }
  .orb-core-pulse {
    transform-origin: 18px 18px;
    animation: orb-fluid-breathe 3.4s ease-in-out infinite;
  }
`;

export function OrbitalLogo({
  size = 24,
  active = false,
  className = '',
}: {
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <style>{LOGO_CSS}</style>
      <defs>
        <linearGradient id="orb-ios-ring" x1="4" y1="30" x2="32" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.25" />
          <stop offset="50%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#FEF3C7" />
        </linearGradient>
        <radialGradient id="orb-ios-core" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#FDE68A" />
          <stop offset="80%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#B45309" />
        </radialGradient>
      </defs>

      <g className={active ? 'orb-ring-cw-fast' : 'orb-ring-cw'}>
        <ellipse
          cx="18"
          cy="18"
          rx="13.5"
          ry="6"
          transform="rotate(-32 18 18)"
          stroke="url(#orb-ios-ring)"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle cx="29.2" cy="10.2" r="2.2" fill="#FFFBEB" />
      </g>

      <g className="orb-core-pulse">
        <circle cx="18" cy="18" r="8" fill="#FBBF24" fillOpacity="0.2" />
        <circle cx="18" cy="18" r="5" fill="url(#orb-ios-core)" />
      </g>
    </svg>
  );
}

type CornerKey = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

const CORNER_COORDS: Record<CornerKey, { x: 'left' | 'right'; y: 'top' | 'bottom' }> = {
  'bottom-right': { x: 'right', y: 'bottom' },
  'bottom-left':  { x: 'left',  y: 'bottom' },
  'top-right':    { x: 'right', y: 'top' },
  'top-left':     { x: 'left',  y: 'top' },
};

export function FloatingOrbitalOrb({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const storageKey = `orbital.orbCorner.${user?.id ?? 'anon'}`;

  const [corner, setCorner] = useState<CornerKey>(() => {
    try {
      const saved = localStorage.getItem(storageKey) as CornerKey | null;
      if (saved && saved in CORNER_COORDS) return saved;
    } catch { /* ignore */ }
    return 'bottom-right';
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey) as CornerKey | null;
      if (saved && saved in CORNER_COORDS) setCorner(saved);
    } catch { /* ignore */ }
  }, [storageKey]);

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const getCornerStyle = (): React.CSSProperties => {
    if (dragPos) {
      return {
        left: `${dragPos.x}px`,
        top: `${dragPos.y}px`,
        transition: 'none',
      };
    }
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const padX = isMobile ? 16 : 24;
    // Lift ~0.5cm (~20px) on PC only; keep Android/mobile bottom offset at 80px
    // Lift ~1cm (~40px) from base 24px on PC only; keep Android/mobile at 80px
    // Lift ~1cm (~40px) from base 24px on PC only; keep Android/mobile at 80px
    const padBottom = isMobile ? 80 : 64;
    const padTop = isMobile ? 56 : 24;
    const c = CORNER_COORDS[corner];

    return {
      ...(c.x === 'left' ? { left: `${padX}px` } : { right: `${padX}px` }),
      ...(c.y === 'top' ? { top: `${padTop}px` } : { bottom: `${padBottom}px` }),
      transition: 'all 340ms cubic-bezier(0.32, 0.72, 0, 1)',
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerStartRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (!start.moved && dx < 6 && dy < 6) return;
    start.moved = true;

    const size = 50;
    const clampedX = Math.max(12, Math.min(window.innerWidth - size - 12, e.clientX - size / 2));
    const clampedY = Math.max(12, Math.min(window.innerHeight - size - 12, e.clientY - size / 2));
    setDragPos({ x: clampedX, y: clampedY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;

    if (!start.moved) {
      setDragPos(null);
      onOpen();
      return;
    }

    const isLeft = e.clientX < window.innerWidth / 2;
    const isTop = e.clientY < window.innerHeight / 2;
    const snapped: CornerKey = isTop
      ? (isLeft ? 'top-left' : 'top-right')
      : (isLeft ? 'bottom-left' : 'bottom-right');

    setCorner(snapped);
    setDragPos(null);
    try {
      localStorage.setItem(storageKey, snapped);
    } catch { /* ignore */ }
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={getCornerStyle()}
      aria-label="Open Orbital"
      className="fixed z-40 w-[50px] h-[50px] rounded-full bg-white/[0.08] hover:bg-white/[0.13] backdrop-blur-3xl border border-white/[0.18] shadow-[0_16px_40px_-8px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.28)] flex items-center justify-center touch-none select-none cursor-grab active:cursor-grabbing active:scale-95"
    >
      <OrbitalLogo size={28} />
    </button>
  );
}

function showAgentErrorToast(title: string, detail: string) {
  toast.custom(
    (t) => (
      <div className="w-[320px] max-w-[calc(100vw-24px)] rounded-[22px] bg-[#1C1C1E]/85 backdrop-blur-3xl border border-white/[0.14] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] overflow-hidden">
        <div className="p-3.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#FF453A]/15 text-[#FF453A] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-white tracking-[-0.01em]">{title}</p>
            <p className="text-[12px] text-white/65 mt-0.5 leading-snug">{detail}</p>
          </div>
          <button
            type="button"
            onClick={() => toast.dismiss(t)}
            className="w-6 h-6 rounded-full bg-white/[0.08] flex items-center justify-center text-white/60 hover:text-white shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    ),
    { duration: 3500 },
  );
}

function showAgentSuccessToast(title: string, detail: string) {
  toast.custom(
    (t) => (
      <div className="w-[320px] max-w-[calc(100vw-24px)] rounded-[22px] bg-[#1C1C1E]/85 backdrop-blur-3xl border border-white/[0.14] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] overflow-hidden">
        <div className="p-3.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#32D74B]/15 text-[#32D74B] flex items-center justify-center shrink-0">
            <Check className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-white tracking-[-0.01em]">{title}</p>
            <p className="text-[12px] text-white/65 mt-0.5 leading-snug truncate">{detail}</p>
          </div>
          <button
            type="button"
            onClick={() => toast.dismiss(t)}
            className="w-6 h-6 rounded-full bg-white/[0.08] flex items-center justify-center text-white/60 hover:text-white shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    ),
    { duration: 2800 },
  );
}

function pickClearVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const preferred = [
    'Microsoft Neerja Online (Natural)',
    'Microsoft Neerja',
    'Google English (India)',
    'Microsoft Sonia Online (Natural)',
    'Google UK English Female',
    'Veena',
    'Rishi',
  ];
  for (const name of preferred) {
    const match = voices.find((v) => v.name.includes(name));
    if (match) return match;
  }
  return (
    voices.find((v) => v.lang === 'en-IN' && v.name.toLowerCase().includes('natural')) ??
    voices.find((v) => v.lang === 'en-IN') ??
    voices.find((v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('natural')) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  );
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time: string;
  quickActions?: AgentQuickAction[];
}

interface AgentCommandModalProps {
  open: boolean;
  onClose: () => void;
  autoListen?: boolean;
}

const IOS27_CSS = `
  @keyframes ios27-sheet-in {
    from { opacity: 0; transform: translate3d(0, 22px, 0) scale(0.96); }
    to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  .ios27-sheet {
    animation: ios27-sheet-in 280ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }
  @keyframes ios27-bubble-in {
    from { opacity: 0; transform: translate3d(0, 8px, 0) scale(0.97); }
    to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  .ios27-bubble {
    animation: ios27-bubble-in 220ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }
  @keyframes ios27-wave {
    0%, 100% { transform: scaleY(0.3); opacity: 0.7; }
    50%      { transform: scaleY(1); opacity: 1; }
  }
  .ios27-wave-bar {
    transform-origin: center;
    animation: ios27-wave 0.7s ease-in-out infinite;
  }
  @keyframes ios27-thinking {
    0%, 80%, 100% { transform: scale(0.75); opacity: 0.35; }
    40%           { transform: scale(1); opacity: 1; }
  }
  .ios27-dot {
    animation: ios27-thinking 1.1s ease-in-out infinite;
  }
  .ios27-no-scrollbar::-webkit-scrollbar { display: none; }
  .ios27-no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;

function nowTimeStr() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function AgentCommandModal({
  open,
  onClose,
}: AgentCommandModalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const { joinForGroup } = useGroupCallContext();

  const [input, setInput] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [draftText, setDraftText] = useState('');
  const [activeDraft, setActiveDraft] = useState<AgentResult['voiceDraft'] | null>(null);
  const [pendingContext, setPendingContext] = useState<string | null>(null);
  const [scheduledList, setScheduledList] = useState<ScheduledOrbitalMessage[]>([]);
  const [, setTick] = useState(0);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutedVoice, setMutedVoice] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const recognitionRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isOpenRef = useRef(open);
  isOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, turns, liveTranscript, busy, activeDraft]);

  useEffect(() => {
    if (!open || !user?.id) return;
    const refresh = () => setScheduledList(getScheduledMessagesForUser(user.id));
    refresh();
    window.addEventListener('orbital:scheduled-updated', refresh);
    const interval = window.setInterval(() => {
      refresh();
      setTick((t) => t + 1);
    }, 1000);
    return () => {
      window.removeEventListener('orbital:scheduled-updated', refresh);
      window.clearInterval(interval);
    };
  }, [open, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
  }, []);

  useEffect(() => {
    syncAgentUserSession(user?.id);
    setTurns([]);
    setActiveDraft(null);
    setPendingContext(null);
    setInput('');
    setLiveTranscript('');
    setDraftText('');
  }, [user?.id]);

  useEffect(() => {
    if (!open || !Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener('backButton', () => {
      onClose();
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, [open, onClose]);

  const speak = (text: string, onFinished?: () => void) => {
    if (mutedVoice || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onFinished?.();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/[*#_`•]/g, '').trim();
      const utter = new SpeechSynthesisUtterance(clean);
      const voices = window.speechSynthesis.getVoices();
      const best = pickClearVoice(voices);
      if (best) utter.voice = best;
      utter.lang = 'en-IN';
      utter.rate = 0.98;
      utter.pitch = 1.0;
      utter.volume = 1;
      if (onFinished) {
        utter.onend = () => onFinished();
        utter.onerror = () => onFinished();
      }
      window.speechSynthesis.speak(utter);
    } catch {
      onFinished?.();
    }
  };

  const startListening = () => {
    if (!isOpenRef.current) return;
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      setTimeout(() => inputRef.current?.focus(), 30);
      return;
    }

    try {
      recognitionRef.current?.stop();
    } catch { /* noop */ }

    const rec = new SpeechRec();
    rec.lang = 'en-IN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    try {
      const SpeechGrammarListCtor =
        (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
      if (SpeechGrammarListCtor && user?.id) {
        const cached = getCachedListsSync(user.id);
        if (cached) {
          const names = [
            ...cached.friends.map((f) => f.displayName),
            ...cached.friends.map((f) => f.displayName.split(' ')[0]),
            ...cached.groups.map((g) => g.name),
          ].filter(Boolean);
          if (names.length > 0) {
            const grammar = `#JSGF V1.0; grammar contacts; public <contact> = ${names.join(' | ')} ;`;
            const list = new SpeechGrammarListCtor();
            list.addFromString(grammar, 1);
            rec.grammars = list;
          }
        }
      }
    } catch { /* optional */ }

    let finalTranscript = '';
    let latestTranscript = '';

    rec.onstart = () => {
      setListening(true);
      setLiveTranscript('');
    };

    rec.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += piece;
        } else {
          interim += piece;
        }
      }
      latestTranscript = (finalTranscript || interim).trim();
      setLiveTranscript(latestTranscript);
    };

    rec.onerror = (e: any) => {
      setListening(false);
      if (e?.error === 'not-allowed') {
        showAgentErrorToast('Microphone Off', 'Allow mic access in settings or type below.');
      }
    };

    rec.onend = () => {
      setListening(false);
      const spoken = (finalTranscript || latestTranscript).trim();
      if (spoken && isOpenRef.current) {
        setLiveTranscript('');
        void submitCommand(spoken, true);
      }
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const submitCommand = async (commandText: string, viaVoice = false) => {
    const trimmed = commandText.trim();
    if (!trimmed || !user?.id || busy) return;

    try {
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
    } catch { /* noop */ }
    setListening(false);
    setLiveTranscript('');
    setInput('');

    setTurns((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        text: trimmed,
        time: nowTimeStr(),
      },
    ]);

    setBusy(true);
    try {
      const res = await runOrbitalAgent(trimmed, {
        currentUserId: user.id,
        userName: ((user.displayName || user.userHandle || user.fullHandle || '').replace(/^@/, '').split('@')[0].trim() || 'there'),
        activePath: location.pathname,
        viaVoice,
        navigate: (path) => {
          onClose();
          navigate(path);
        },
        initiateDmCall: async (peerId, type) => {
          onClose();
          await initiateCall(peerId, type);
        },
        joinGroupCall: async (groupId, groupName) => {
          onClose();
          await joinForGroup(groupId, groupName);
        },
      });

      setPendingContext(res.pendingContext ?? null);
      setScheduledList(getScheduledMessagesForUser(user.id));

      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          text: res.reply,
          time: nowTimeStr(),
          quickActions: res.quickActions,
        },
      ]);

      if (res.voiceDraft) {
        setActiveDraft(res.voiceDraft);
        setDraftText(res.voiceDraft.message);
      }

      if (viaVoice && res.reply && !res.voiceDraft) {
        const shouldReopenMic = res.actionTaken === false;
        speak(res.reply, () => {
          if (shouldReopenMic && isOpenRef.current) {
            startListening();
          }
        });
      }
    } catch (err) {
      const msg = formatAgentError(err);
      showAgentErrorToast('Orbital', msg);
      setTurns((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', text: msg, time: nowTimeStr() },
      ]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !user?.id) {
      try {
        window.speechSynthesis?.cancel();
        recognitionRef.current?.stop();
      } catch { /* noop */ }
      setListening(false);
      setLiveTranscript('');
      return;
    }

    startListening();

    const userLabel = ((user.displayName || user.userHandle || user.fullHandle || '').replace(/^@/, '').split('@')[0].trim() || 'there');
    const greetKey = `orbital.ai.greeted.${user.id}`;
    try {
      if (!sessionStorage.getItem(greetKey)) {
        sessionStorage.setItem(greetKey, '1');
        speak(`Hi ${userLabel}`);
      }
    } catch { /* ignore */ }
  }, [open, user?.id]);

  const handleSendVoiceDraft = async () => {
    if (!activeDraft || !user?.id || busy || !draftText.trim()) return;
    const payload = { ...activeDraft, message: draftText.trim() };
    setBusy(true);
    try {
      await dispatchOrbitalMessage(payload, user.id);
      showAgentSuccessToast(
        payload.kind === 'dm' ? `Sent to ${payload.targetName}` : `Sent to #${payload.targetName}`,
        payload.message,
      );
      setActiveDraft(null);
      setDraftText('');
      setTurns((prev) => [
        ...prev,
        {
          id: `s-${Date.now()}`,
          role: 'assistant',
          text: `Sent to ${payload.kind === 'dm' ? payload.targetName : `#${payload.targetName}`}: "${payload.message}"`,
          time: nowTimeStr(),
        },
      ]);
    } catch (err) {
      showAgentErrorToast('Could Not Send', formatAgentError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleChipAction = (qa: AgentQuickAction) => {
    if (qa.prompt) {
      void submitCommand(qa.prompt, false);
      return;
    }
    if (qa.prefill) {
      setInput(qa.prefill);
      setTimeout(() => inputRef.current?.focus(), 30);
      return;
    }
    if (qa.path) {
      onClose();
      navigate(qa.path);
    }
  };

  if (!open || !user) return null;

  const dockItems = [
    { label: 'Messages', icon: <MessageCircle className="w-3.5 h-3.5 text-[#FBBF24]" />, path: '/app/dm' },
    { label: 'Groups', icon: <Users className="w-3.5 h-3.5 text-[#32D74B]" />, path: '/app/groups' },
    { label: 'Call', icon: <Phone className="w-3.5 h-3.5 text-[#64D2FF]" />, prefill: 'call ' },
    { label: 'Settings', icon: <Settings className="w-3.5 h-3.5 text-white/75" />, path: '/app/settings' },
  ];

  const nextScheduled = scheduledList[0];
  const secsRemaining = nextScheduled
    ? Math.max(0, Math.ceil((nextScheduled.runAt - Date.now()) / 1000))
    : 0;

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-xl flex items-end sm:items-center justify-center p-2.5 sm:p-5"
      onClick={onClose}
    >
      <style>{IOS27_CSS}</style>

      {/* iOS 27 Liquid Glass Sheet */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="ios27-sheet relative w-full max-w-[430px] max-h-[84vh] flex flex-col rounded-[34px] bg-[#1C1C1E]/82 backdrop-blur-3xl border border-white/[0.15] shadow-[0_32px_90px_-16px_rgba(0,0,0,0.88),inset_0_1px_0_rgba(255,255,255,0.2)] overflow-hidden"
      >
        {/* Mobile Grabber Pill */}
        <div className="pt-2.5 pb-1 flex justify-center sm:hidden shrink-0">
          <div className="w-9 h-1 rounded-full bg-white/25" />
        </div>

        {/* Clean Apple-Style Header */}
        <div className="px-4 pt-2 sm:pt-3.5 pb-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                listening
                  ? 'bg-[#FBBF24]/20 shadow-[0_0_24px_rgba(251,191,36,0.45)]'
                  : 'bg-white/[0.08]'
              }`}
            >
              <OrbitalLogo size={24} active={listening || busy} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-white tracking-[-0.015em] truncate">
                  Orbital
                </h2>
                {listening && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FBBF24]/15 text-[#FDE68A] text-[10.5px] font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24] animate-pulse" />
                    Listening
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-white/50 truncate">
                Messages, calls & quick actions
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearPendingAgentState();
                  setPendingContext(null);
                  setTurns([]);
                }}
                className="h-8 px-3 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[11.5px] font-medium text-white/75 hover:text-white transition-colors"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                window.speechSynthesis?.cancel();
                setMutedVoice((v) => !v);
              }}
              aria-label={mutedVoice ? 'Unmute voice' : 'Mute voice'}
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.14] flex items-center justify-center text-white/75 hover:text-white transition-colors"
            >
              {mutedVoice ? <VolumeX className="w-3.5 h-3.5 text-[#FF453A]" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.14] flex items-center justify-center text-white/75 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Frosted Pill Navigation Strip */}
        <div className="ios27-no-scrollbar px-4 pb-3 flex items-center gap-1.5 overflow-x-auto shrink-0">
          {dockItems.map((act) => (
            <button
              key={act.label}
              type="button"
              onClick={() => {
                if (act.path) {
                  onClose();
                  navigate(act.path);
                } else if (act.prefill) {
                  setInput(act.prefill);
                  setTimeout(() => inputRef.current?.focus(), 25);
                }
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.08] text-[12px] font-medium text-white/90 transition-all active:scale-95"
            >
              {act.icon}
              <span>{act.label}</span>
            </button>
          ))}
        </div>

        {/* Dynamic Island Scheduled Message Capsule */}
        {nextScheduled && (
          <div className="mx-4 mb-2.5 px-3.5 py-2 rounded-full bg-black/55 border border-white/[0.12] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0 text-[12px]">
              <Clock className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />
              <span className="text-white/90 truncate">
                Sending <span className="font-semibold text-white">“{nextScheduled.message}”</span> to{' '}
                <span className="font-semibold text-white">
                  {nextScheduled.kind === 'group' ? `#${nextScheduled.targetName}` : nextScheduled.targetName}
                </span>{' '}
                · <span className="tabular-nums text-[#FBBF24] font-semibold">{secsRemaining}s</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                cancelScheduledMessageById(user.id, nextScheduled.id);
                setScheduledList(getScheduledMessagesForUser(user.id));
              }}
              className="shrink-0 text-[11.5px] text-white/55 hover:text-[#FF453A] font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* iMessage-Style Conversation Stream */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-[190px] max-h-[350px] overflow-y-auto px-4 py-2 space-y-3 border-t border-white/[0.07]"
        >
          {turns.length === 0 && !liveTranscript && (
            <div className="py-7 text-center space-y-3">
              <p className="text-[13px] text-white/55 max-w-[270px] mx-auto leading-relaxed">
                Send or schedule a message, start a call, or open any chat.
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {[
                  { label: 'Who is online?', prompt: 'Who is online?' },
                  { label: 'Make a call', prompt: 'make a call' },
                  { label: 'Schedule message', prompt: 'schedule a message' },
                ].map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => void submitCommand(s.prompt, false)}
                    className="px-3 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[12px] text-white/90 font-medium transition-all active:scale-95"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`ios27-bubble flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[82%] px-4 py-2.5 text-[13.5px] leading-[1.45] tracking-[-0.01em] whitespace-pre-wrap ${
                  turn.role === 'user'
                    ? 'rounded-[22px] rounded-br-[6px] bg-gradient-to-b from-[#FBBF24] to-[#F59E0B] text-[#140E02] font-medium shadow-[0_8px_22px_-8px_rgba(245,158,11,0.5)]'
                    : 'rounded-[22px] rounded-bl-[6px] bg-white/[0.09] text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                }`}
              >
                {turn.text}
              </div>

              <span className="mt-1 px-1.5 text-[10.5px] text-white/35 tabular-nums">
                {turn.time}
              </span>

              {turn.role === 'assistant' && turn.quickActions && turn.quickActions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 max-w-[90%]">
                  {turn.quickActions.map((qa, idx) => (
                    <button
                      key={`${qa.label}-${idx}`}
                      type="button"
                      onClick={() => handleChipAction(qa)}
                      className="px-3 py-1.5 rounded-full bg-white/[0.09] hover:bg-white/[0.16] text-[12px] font-medium text-[#FDE68A] transition-all active:scale-95"
                    >
                      {qa.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {listening && (
            <div className="flex flex-col items-end">
              <div className="max-w-[82%] px-4 py-2.5 rounded-[22px] rounded-br-[6px] bg-white/[0.11] border border-white/[0.15] text-[13.5px] text-white flex items-center gap-2.5">
                <div className="flex items-center gap-[3px] h-3.5 shrink-0">
                  {[0, 1, 2, 3].map((idx) => (
                    <span
                      key={idx}
                      className="ios27-wave-bar w-[2.5px] h-3.5 rounded-full bg-[#FBBF24]"
                      style={{ animationDelay: `${idx * 0.14}s` }}
                    />
                  ))}
                </div>
                <span className="break-words text-white/90">
                  {liveTranscript || 'Listening…'}
                </span>
              </div>
            </div>
          )}

          {busy && (
            <div className="flex items-start">
              <div className="px-4 py-3 rounded-[22px] rounded-bl-[6px] bg-white/[0.08] inline-flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="ios27-dot w-1.5 h-1.5 rounded-full bg-white/80"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-1 shrink-0" />
        </div>

        {/* Inline Voice Draft Card */}
        {activeDraft && (
          <div className="mx-4 mb-2.5 p-3 rounded-[22px] bg-white/[0.08] border border-white/[0.14] space-y-2 shrink-0">
            <div className="flex items-center justify-between text-[11.5px] text-white/75 font-medium px-1">
              <span>
                To {activeDraft.kind === 'dm' ? activeDraft.targetName : `#${activeDraft.targetName}`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setActiveDraft(null);
                  setDraftText('');
                }}
                className="text-white/45 hover:text-white"
              >
                Cancel
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSendVoiceDraft();
                  }
                }}
                className="flex-1 min-w-0 h-9 px-3.5 rounded-full bg-black/40 border border-white/[0.12] text-[13px] text-white outline-none focus:border-[#FBBF24]"
              />
              <button
                type="button"
                onClick={() => void handleSendVoiceDraft()}
                disabled={busy || !draftText.trim()}
                className="h-9 px-3.5 rounded-full bg-[#FBBF24] hover:bg-[#FCD34D] text-[#140E02] text-[12.5px] font-semibold inline-flex items-center gap-1 shrink-0 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>
          </div>
        )}

        {/* Active Step Pill */}
        {pendingContext && (
          <div className="mx-4 mb-2 px-3.5 py-1.5 rounded-full bg-white/[0.07] border border-white/[0.1] flex items-center justify-between text-[11.5px] text-[#FDE68A] shrink-0">
            <span className="truncate">{pendingContext}</span>
            <button
              type="button"
              onClick={() => {
                clearPendingAgentState();
                setPendingContext(null);
              }}
              className="text-white/50 hover:text-white ml-2 shrink-0"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Liquid Glass Capsule Dock */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCommand(input, false);
          }}
          className="px-3.5 pb-3.5 pt-2 shrink-0"
        >
          <div className="h-11 px-1.5 rounded-full bg-white/[0.08] border border-white/[0.14] focus-within:border-white/[0.3] focus-within:bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] flex items-center gap-1.5 transition-all">
            <button
              type="button"
              onClick={listening ? () => recognitionRef.current?.stop() : startListening}
              aria-label={listening ? 'Stop listening' : 'Speak'}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                listening
                  ? 'bg-[#FBBF24] text-[#140E02] shadow-[0_0_18px_rgba(251,191,36,0.6)] scale-105'
                  : 'bg-white/[0.08] hover:bg-white/[0.16] text-white/85'
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>

            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingContext ? 'Type your reply…' : 'Ask Orbital…'}
              className="flex-1 min-w-0 h-9 px-2 bg-transparent text-[13.5px] text-white placeholder-white/40 outline-none"
            />

            <button
              type="submit"
              disabled={!input.trim() || busy}
              aria-label="Send"
              className="w-8 h-8 rounded-full bg-[#FBBF24] hover:bg-[#FCD34D] disabled:bg-white/[0.08] disabled:text-white/25 text-[#140E02] flex items-center justify-center shrink-0 transition-all active:scale-95"
            >
              <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
