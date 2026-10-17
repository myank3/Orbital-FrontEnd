/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavLink, Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCall, type CallState } from '../context/CallContext';
import { apiService } from '../services/api';
import { Avatar } from '../components/Avatar';
import VideoCallOverlay from '../components/VideoCallOverlay';
import {
  MessageSquare,
  Users,
  UserCheck,
  Phone,
  Image as ImageIcon,
  Settings,
  LogOut,
  PhoneOff,
  Menu,
  X,
  Orbit,
  Compass,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  badge?: number | string;
  accent?: boolean;
  highlight?: boolean;
}

const SHELL_CSS = `
  @keyframes signal-shine {
    0% { transform: translateX(-200%) skewX(-20deg); }
    100% { transform: translateX(200%) skewX(-20deg); }
  }
  .signal-shine {
    animation: signal-shine 2.5s ease-in-out infinite;
    animation-delay: 1s;
  }

  @keyframes call-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.08); opacity: 0.8; }
  }
  .call-pulse {
    animation: call-pulse 1.6s ease-in-out infinite;
  }

  @keyframes drawer-in {
    from { transform: translateX(-100%); }
    to { transform: translateX(0); }
  }
  .drawer-in {
    animation: drawer-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    will-change: transform;
  }

  /* Android: disable tap highlight on all interactive chrome */
  .app-shell button,
  .app-shell a,
  .app-shell [role="button"] {
    -webkit-tap-highlight-color: transparent;
  }

  @media (prefers-reduced-motion: reduce) {
    .signal-shine,
    .call-pulse,
    .drawer-in {
      animation: none !important;
    }
  }
`;

/** Route helpers -------------------------------------------------- */

function isFullScreenRoute(pathname: string): boolean {
  // DMs (but not the list) and groups (but not the list) get a full-screen
  // chat surface on mobile. Signals is also full-screen on mobile.
  const isDmDetail = pathname.startsWith('/app/dm/') && pathname !== '/app/dm';
  const isGroupDetail =
    pathname.startsWith('/app/groups/') && pathname !== '/app/groups';
  const isSignals = pathname.startsWith('/app/signals');
  return isDmDetail || isGroupDetail || isSignals;
}

/* ────────────────────────────────────────────────────────── */
/* Draggable mini call widget — 144Hz-smooth drag             */
/* ────────────────────────────────────────────────────────── */
/*
  Why this is smooth:

  1. Position is NEVER stored in React state — dragging never triggers a
     re-render. Only `peerName` and `peerAvatar` use state, and those
     change once.
  2. Position updates go through requestAnimationFrame, so at most one
     DOM write per frame, no matter how many pointermove events fire
     (144Hz displays can fire >144 events/sec).
  3. Transform (translate3d) is used instead of left/top — GPU-composited,
     doesn't trigger layout.
  4. `will-change: transform` is set during drag so the compositor keeps
     the layer ready, and cleared on release to free memory.
  5. The initial CSS position (`right-6 bottom-...`) is used for the first
     paint — no flash, no useLayoutEffect needed. On first pointerdown we
     switch to `left:0;top:0` + transform, keeping the visual position
     identical.
*/

function MiniCallWidget({
  peerId,
  duration,
  onEndCall,
}: {
  peerId: string;
  duration: number;
  onEndCall: () => void;
}) {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const [peerName, setPeerName] = useState<string>('Calling…');
  const [peerAvatar, setPeerAvatar] = useState<string | null>(null);

  // Drag state — all refs, no React state to avoid re-renders at 144Hz.
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const hasPositionedRef = useRef(false);

  // Resolve the peer's display name / avatar.
  useEffect(() => {
    let cancelled = false;
    apiService
      .getUserProfile(peerId)
      .then((profile) => {
        if (cancelled) return;
        setPeerName(profile?.displayName || profile?.userHandle || 'Calling…');
        setPeerAvatar(profile?.avatarUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setPeerName('Calling…');
      });
    return () => {
      cancelled = true;
    };
  }, [peerId]);

  const flush = () => {
    const el = widgetRef.current;
    const p = pendingRef.current;
    if (!el || !p) return;
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    pendingRef.current = null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Let the hangup button handle its own clicks.
    if ((e.target as HTMLElement).closest('button')) return;
    const el = widgetRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();

    // First drag: switch from CSS right/bottom positioning to explicit
    // left/top + transform so drag math is stable regardless of the
    // container's layout. The element's visual position is preserved.
    if (!hasPositionedRef.current) {
      hasPositionedRef.current = true;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = '0';
      el.style.top = '0';
    }
    el.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    el.style.transition = 'none';
    el.style.willChange = 'transform';
    el.style.cursor = 'grabbing';

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };

    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture unsupported — ignore */
    }
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;

    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && dx * dx + dy * dy > 16) ds.moved = true;

    let x = ds.origX + dx;
    let y = ds.origY + dy;
    x = Math.max(8, Math.min(window.innerWidth - ds.width - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - ds.height - 8, y));

    // Coalesce to one DOM write per animation frame. At 144Hz the browser
    // fires ~144 pointermove events per second; we only touch the DOM once
    // per rAF tick (~144 writes/sec, but the writes land on the compositor
    // thread so they don't block layout/paint).
    pendingRef.current = { x, y };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flush();
      });
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    dragStateRef.current = null;

    // Flush any pending frame so the final position is exact.
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    flush();

    const el = widgetRef.current;
    if (!el) return;

    try {
      el.releasePointerCapture(ds.pointerId);
    } catch {
      /* ignore */
    }
    el.style.cursor = 'grab';
    el.style.willChange = 'auto';

    // If this was a tap (no meaningful movement), leave the pill where it is.
    if (!ds.moved) return;

    // Snap to the nearest corner with a smooth transition.
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const isMobile = window.innerWidth < 768;
    const sideMargin = 24;
    const bottomMargin = isMobile ? 96 : 24;
    const snapX = cx > window.innerWidth / 2
      ? window.innerWidth - rect.width - sideMargin
      : sideMargin;
    const snapY = cy > window.innerHeight / 2
      ? window.innerHeight - rect.height - bottomMargin
      : sideMargin;

    el.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
    el.style.transform = `translate3d(${snapX}px, ${snapY}px, 0)`;
  };

  const mm = Math.floor(duration / 60).toString().padStart(2, '0');
  const ss = Math.floor(duration % 60).toString().padStart(2, '0');

  return (
    <div
      ref={widgetRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      className="fixed z-[60] touch-none select-none cursor-grab right-6 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6"
      aria-label="Ongoing call"
    >
      <div className="flex items-center gap-3 pl-2 pr-2 py-2 rounded-2xl bg-[#0F0D0A]/95 backdrop-blur-2xl border border-[#22C55E]/40 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.95)] min-w-[240px] max-w-[280px]">
        <Avatar name={peerName} src={peerAvatar} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-[#EDE5D4] truncate">
            {peerName}
          </p>
          <p className="text-[11px] tabular-nums text-[#22C55E] font-medium">
            {mm}:{ss}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEndCall();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 w-9 h-9 rounded-full bg-[#B91C1C] hover:bg-[#991B1B] text-white flex items-center justify-center touch-manipulation"
          aria-label="End call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Main shell ---------------------------------------------------- */

function AppShell(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // useCall() exposes the current call. We defensively read the extra
  // fields (callState / duration / peerId / endCall) so the mini widget
  // works even if the context's exact shape drifts.
  const callApi = useCall();
  const { incomingCall, acceptCall, rejectCall } = callApi;
  const callMeta = callApi as unknown as {
    callState?: CallState;
    duration?: number;
    peerId?: string | null;
    endCall?: () => void | Promise<void>;
    hangup?: () => void | Promise<void>;
    cancel?: () => void | Promise<void>;
  };
  const callState: CallState = callMeta.callState ?? 'idle';
  const callDuration: number = callMeta.duration ?? 0;
  const callPeerId: string | null = callMeta.peerId ?? null;
  const endCall =
    callMeta.endCall ?? callMeta.hangup ?? callMeta.cancel ?? rejectCall;

  const fullScreen = isFullScreenRoute(location.pathname);
  // The shell chrome (mobile header, bottom bar, drawer) is hidden on full-
  // screen routes, but the desktop rail stays mounted always.
  const hideMobileChrome = fullScreen;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [railHovered, setRailHovered] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false);

  const [callerName, setCallerName] = useState<string | null>(null);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileUserMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Resolve caller display name.
  useEffect(() => {
    const id = incomingCall?.initiatorId;
    if (!id) {
      setCallerName(null);
      return;
    }
    let cancelled = false;
    apiService
      .getUserProfile(id)
      .then((profile) => {
        if (cancelled) return;
        setCallerName(profile?.displayName || profile?.userHandle || null);
      })
      .catch(() => {
        if (!cancelled) setCallerName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [incomingCall?.initiatorId]);

  const handleSignOut = async () => {
    try {
      await logout();
      navigate('/login');
    } catch {
      navigate('/login');
    }
  };

  // Lock body scroll only while the mobile drawer is open (mobile only).
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileMenuOpen]);

  // Note: intentionally no global "click outside" listener here. It used to
  // swallow the first tap on menu items on Android Chrome (the mousedown that
  // closed the menu also cancelled the link's click). Each menu item closes
  // its own menu on click instead.

  const primaryNav: NavItem[] = useMemo(
    () => [
      { to: '/app/dm', label: 'Messages', icon: MessageSquare },
      { to: '/app/groups', label: 'Groups', icon: Users },
      { to: '/app/friends', label: 'Friends', icon: UserCheck },
    ],
    [],
  );

  const activityNav: NavItem[] = useMemo(
    () => [
      { to: '/app/calls', label: 'Calls', icon: Phone },
      { to: '/app/notifications', label: 'Media', icon: ImageIcon },
      { to: '/app/orbit', label: 'Your Orbit', icon: Orbit },
    ],
    [],
  );

  const railWidth = railHovered ? 224 : 68;
  const incomingDisplayName = callerName ?? 'Someone';

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // The mini widget is shown whenever a call is live (callState === 'connecting'
  // is the "media connected" state in CallContext). It sits below
  // VideoCallOverlay's z-index so the full-screen overlay takes precedence when
  // it's visible; when the overlay hides (minimized), the mini pill appears.
  const showMiniCall = callState === 'connecting' && !!callPeerId;

  return (
    <div className="app-shell flex h-screen bg-[#0B0A08] text-[#EDE5D4] overflow-hidden selection:bg-[#D97706]/30 selection:text-[#EDE5D4]">
      <style>{SHELL_CSS}</style>

      {/* ─── MOBILE DRAWER ─────────────────────────────────── */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
            onClick={closeMobileMenu}
            aria-hidden
          />
          <aside
            className="drawer-in fixed inset-y-0 left-0 z-40 w-[280px] bg-[#0F0D0A]/95 md:backdrop-blur-3xl backdrop-blur-xl border-r border-white/[0.08] shadow-[20px_0_60px_rgba(0,0,0,0.8)] flex flex-col md:hidden overscroll-contain"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
            role="dialog"
            aria-modal="true"
            aria-label="Main menu"
          >
            <div className="h-16 px-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
              <Link
                to="/app/orbit"
                onClick={closeMobileMenu}
                className="flex items-baseline gap-2 touch-manipulation"
              >
                <span
                  className="text-[22px] leading-none text-[#EDE5D4] tracking-tight drop-shadow-[0_0_15px_rgba(237,229,212,0.2)]"
                  style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
                >
                  Orbital
                </span>
                <span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-2px] shadow-[0_0_12px_rgba(217,119,6,0.8)]"
                />
              </Link>
              <button
                onClick={closeMobileMenu}
                className="p-2 -mr-1 rounded-md text-[#A8A29E] active:bg-white/[0.08] hover:bg-white/[0.06] transition-colors touch-manipulation"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-5 overflow-y-auto overscroll-contain custom-scrollbar">
              <MobileSection label="Messages">
                {primaryNav.map((item) => (
                  <MobileItem
                    key={item.to}
                    item={item}
                    onNavigate={closeMobileMenu}
                  />
                ))}
              </MobileSection>

              <MobileSection label="Activity" className="mt-6">
                {activityNav.map((item) => (
                  <MobileItem
                    key={item.to}
                    item={item}
                    onNavigate={closeMobileMenu}
                  />
                ))}
              </MobileSection>
            </nav>
          </aside>
        </>
      )}

      {/* ─── DESKTOP RAIL (always mounted on desktop) ─── */}
      <div
        className="hidden md:block relative shrink-0 w-[68px]"
        onMouseEnter={() => setRailHovered(true)}
        onMouseLeave={() => setRailHovered(false)}
      >
        <aside
          style={{
            width: railWidth,
            transition: 'width 250ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="absolute inset-y-0 left-0 flex flex-col overflow-hidden z-30
                     bg-[#0F0D0A]/60 backdrop-blur-[40px]
                     border-r border-white/[0.08]
                     shadow-[10px_0_50px_-15px_rgba(0,0,0,0.9),inset_-1px_0_0_rgba(255,255,255,0.02)]"
        >
          {/* Logo */}
          <div className="h-16 flex items-center px-4 shrink-0 border-b border-white/[0.06]">
            <Link
              to="/app/orbit"
              className="flex items-baseline gap-2 select-none whitespace-nowrap group"
            >
              <span
                className="text-[22px] leading-none text-[#EDE5D4] tracking-tight drop-shadow-[0_0_15px_rgba(237,229,212,0.15)] group-hover:drop-shadow-[0_0_20px_rgba(237,229,212,0.3)] transition-all duration-500"
                style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
              >
                Orbital
              </span>
              <span
                aria-hidden
                className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-2px] shadow-[0_0_12px_rgba(217,119,6,0.8)] group-hover:scale-125 transition-transform duration-500"
              />
            </Link>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-4 px-2 overflow-y-auto overflow-x-hidden custom-scrollbar">
            <div className="space-y-0.5">
              {primaryNav.map((item) => (
                <RailItem
                  key={item.to}
                  item={item}
                  expanded={railHovered}
                />
              ))}
            </div>

            <div className="my-3 mx-2 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

            <div className="space-y-0.5">
              {activityNav.map((item) => (
                <RailItem
                  key={item.to}
                  item={item}
                  expanded={railHovered}
                />
              ))}
            </div>
          </nav>

          {/* Profile / user menu */}
          <div className="py-3 px-2 border-t border-white/[0.06]">
            <div className="relative mt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setUserMenuOpen((v) => !v);
                }}
                className={`w-full flex items-center gap-3 rounded-xl transition-all duration-300 px-2 py-2 ${
                  userMenuOpen
                    ? 'bg-white/[0.08] ring-1 ring-white/[0.1]'
                    : 'hover:bg-white/[0.04]'
                }`}
                title={user?.displayName || 'Profile'}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <span className="w-[52px] shrink-0 flex items-center justify-center">
                  <Avatar
                    name={user?.displayName || 'User'}
                    src={user?.avatarUrl}
                    size="sm"
                    isOnline
                  />
                </span>
                {railHovered && (
                  <div className="min-w-0 flex-1 text-left whitespace-nowrap">
                    <p className="text-[13px] font-medium text-[#EDE5D4] truncate leading-tight">
                      {user?.displayName || 'Active User'}
                    </p>
                    <p className="text-[11px] text-[#6B6259] truncate mt-0.5">
                      @{user?.userHandle || 'guest'}
                    </p>
                  </div>
                )}
              </button>

              {userMenuOpen && (
                <div
                  className="absolute bottom-full mb-3 left-0 right-0 min-w-[220px] rounded-2xl bg-[#131110]/95 backdrop-blur-3xl border border-white/[0.1] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden z-50 origin-bottom-left"
                  onClick={(e) => e.stopPropagation()}
                  role="menu"
                >
                  <div className="px-4 py-4 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent">
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={user?.displayName || 'User'}
                        src={user?.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[#EDE5D4] truncate">
                          {user?.displayName || 'Active User'}
                        </p>
                        <p className="text-[11px] text-[#6B6259] truncate mt-0.5">
                          @{user?.userHandle || 'guest'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-1.5">
                    <Link
                      to="/app/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                      role="menuitem"
                    >
                      <Settings className="w-4 h-4" />
                      <span>Settings</span>
                    </Link>
                    <Link
                      to="/app/signals"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                      role="menuitem"
                    >
                      <Compass className="w-4 h-4" />
                      <span>Signals</span>
                    </Link>
                  </div>

                  <div className="p-1.5 border-t border-white/[0.06]">
                    <button
                      onClick={() => void handleSignOut()}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.1] transition-colors"
                      role="menuitem"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ─── MAIN COLUMN ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 relative">
        {/* Mobile header — hidden on full-screen routes (DM, group, signals) */}
        {!hideMobileChrome && (
          <header
            className="md:hidden h-14 bg-[#0F0D0A]/80 backdrop-blur-xl border-b border-white/[0.06] px-4 flex items-center justify-between shrink-0"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)', height: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}
          >
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -ml-1 rounded-md text-[#A8A29E] active:bg-white/[0.08] hover:bg-white/[0.06] transition-colors touch-manipulation"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span
              className="text-[18px] tracking-tight text-[#EDE5D4]"
              style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
            >
              Orbital
            </span>
            <div className="w-8" />
          </header>
        )}

        {/* Incoming call banner — always visible, even on full-screen routes */}
        {incomingCall && (
          <div className="shrink-0 z-30 px-4 sm:px-6 py-3 bg-[#0F0D0A] border-b border-[#22C55E]/30 shadow-[0_10px_30px_-10px_rgba(34,197,94,0.15)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="call-pulse w-10 h-10 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 text-[#22C55E] flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                  <Phone className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-[#22C55E] font-semibold">
                    Incoming call
                  </p>
                  <p className="text-[14px] text-[#EDE5D4] truncate font-medium">
                    {incomingDisplayName} is calling
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => void rejectCall()}
                  className="h-9 px-4 rounded-xl bg-white/[0.05] hover:bg-[#B91C1C]/15 border border-white/[0.08] hover:border-[#B91C1C]/40 text-[#EDE5D4] hover:text-[#F87171] text-[13px] font-medium transition-colors inline-flex items-center gap-1.5 touch-manipulation"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Decline</span>
                </button>
                <button
                  onClick={() => void acceptCall()}
                  className="h-9 px-4 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#0F0D0A] text-[13px] font-semibold transition-colors shadow-[0_6px_20px_-8px_rgba(34,197,94,0.7)] inline-flex items-center gap-1.5 touch-manipulation"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Accept</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main content — full-bleed on full-screen routes */}
        <main
          className={`flex-1 overflow-y-auto bg-[#0B0A08] relative custom-scrollbar overscroll-contain ${
            !hideMobileChrome ? 'pb-16 md:pb-0' : ''
          }`}
        >
          <Outlet />
        </main>

        {/* Mobile bottom bar — hidden on full-screen routes */}
        {!hideMobileChrome && (
          <nav
            className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0F0D0A]/90 backdrop-blur-xl border-t border-white/[0.06] z-40 flex items-center justify-around px-2"
            style={{
              height: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            {primaryNav.slice(0, 3).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center w-14 h-16 gap-1 touch-manipulation ${
                    isActive
                      ? 'text-[#D97706]'
                      : 'text-[#A8A29E] hover:text-[#EDE5D4]'
                  }`
                }
              >
                <item.icon size={20} />
                <span className="text-[9px] font-medium">{item.label}</span>
              </NavLink>
            ))}

            {/* Mobile avatar / user menu */}
            <div className="relative flex items-center justify-center w-14 h-16">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMobileUserMenuOpen((v) => !v);
                }}
                className={`flex items-center justify-center p-1 rounded-full transition-all touch-manipulation ${
                  mobileUserMenuOpen
                    ? 'bg-white/[0.1] ring-1 ring-white/[0.2]'
                    : ''
                }`}
                aria-haspopup="menu"
                aria-expanded={mobileUserMenuOpen}
                aria-label="Open profile menu"
              >
                <Avatar
                  name={user?.displayName || 'User'}
                  src={user?.avatarUrl}
                  size="sm"
                  isOnline
                />
              </button>

              {mobileUserMenuOpen && (
                <div
                  className="absolute bottom-[calc(100%+10px)] right-0 w-[220px] rounded-2xl bg-[#131110]/95 backdrop-blur-xl border border-white/[0.1] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden z-50 origin-bottom-right"
                  onClick={() => setMobileUserMenuOpen(false)}
                  role="menu"
                >
                  <div className="px-4 py-4 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent">
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={user?.displayName || 'User'}
                        src={user?.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[#EDE5D4] truncate">
                          {user?.displayName || 'Active User'}
                        </p>
                        <p className="text-[11px] text-[#6B6259] truncate mt-0.5">
                          @{user?.userHandle || 'guest'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-1.5">
                    <Link
                      to="/app/signals"
                      onClick={() => setMobileUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors touch-manipulation"
                      role="menuitem"
                    >
                      <Compass className="w-4 h-4" />
                      <span>Signals</span>
                    </Link>
                    <Link
                      to="/app/settings"
                      onClick={() => setMobileUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors touch-manipulation"
                      role="menuitem"
                    >
                      <Settings className="w-4 h-4" />
                      <span>Settings</span>
                    </Link>
                  </div>

                  <div className="p-1.5 border-t border-white/[0.06]">
                    <button
                      onClick={() => void handleSignOut()}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.1] transition-colors touch-manipulation"
                      role="menuitem"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </nav>
        )}
      </div>

      {/* Draggable mini call widget — appears while a call is live.
          Sits below VideoCallOverlay (z-[60]) so the full-screen overlay
          takes precedence when visible; when the overlay hides, this pill
          becomes the persistent call indicator that can be dragged around
          and snaps to the nearest corner on release. Position is mutated
          imperatively via rAF so dragging never triggers a React re-render
          (144Hz-smooth). */}
      {showMiniCall && callPeerId && (
        <MiniCallWidget
          peerId={callPeerId}
          duration={callDuration}
          onEndCall={() => void endCall()}
        />
      )}

      <VideoCallOverlay />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Rail item                                                  */
/* ────────────────────────────────────────────────────────── */

function RailItem({
  item,
  expanded,
}: {
  item: NavItem;
  expanded: boolean;
}) {
  const Icon = item.icon;
  const accent = item.accent;
  const highlight = item.highlight;

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `relative group flex items-center h-11 rounded-xl transition-colors overflow-hidden ${
          isActive ? 'text-[#EDE5D4]' : 'text-[#A8A29E] hover:text-[#EDE5D4]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {highlight && !isActive && (
            <div className="signal-shine absolute inset-0 z-0 w-1/2 bg-gradient-to-r from-transparent via-white/[0.15] to-transparent pointer-events-none" />
          )}

          {!isActive && (
            <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-white/[0.04] z-0" />
          )}

          {isActive && (
            <div
              className={`absolute inset-0 rounded-xl ring-1 ring-inset z-0 ${
                accent
                  ? 'bg-gradient-to-r from-[#D97706]/20 to-transparent ring-[#D97706]/40'
                  : 'bg-gradient-to-r from-[#D97706]/15 to-transparent ring-[#D97706]/20'
              }`}
            />
          )}

          {isActive && (
            <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-[#D97706] shadow-[0_0_15px_rgba(217,119,6,1)] z-10" />
          )}

          <span className="w-[68px] shrink-0 flex items-center justify-center relative z-10">
            <span className="inline-flex transition-transform group-hover:scale-110 group-active:scale-90">
              <Icon
                className={`w-[19px] h-[19px] transition-all duration-300 ${
                  isActive
                    ? 'text-[#D97706] drop-shadow-[0_0_10px_rgba(217,119,6,0.6)]'
                    : accent
                    ? 'text-[#D97706]/80 group-hover:text-[#D97706]'
                    : 'text-[#A8A29E] group-hover:text-[#EDE5D4]'
                }`}
              />
            </span>
          </span>

          <span
            className={`relative z-10 text-[14px] font-medium truncate whitespace-nowrap transition-opacity duration-300 ${
              expanded ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {item.label}
          </span>

          {typeof item.badge === 'number' && item.badge > 0 && (
            <span className="relative z-10 ml-auto mr-2 min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#D97706] text-[#0F0D0A] text-[11px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(217,119,6,0.5)]">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Mobile drawer helpers                                      */
/* ────────────────────────────────────────────────────────── */

function MobileSection({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="px-3 mb-1.5 text-[10.5px] uppercase tracking-[0.20em] text-[#6B6259] font-semibold">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function MobileItem({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate: () => void;
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-3 h-11 rounded-xl text-[13.5px] font-medium transition-all duration-300 touch-manipulation ${
          isActive
            ? 'bg-gradient-to-r from-[#D97706]/15 to-transparent text-[#EDE5D4] ring-1 ring-[#D97706]/20'
            : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.04] active:bg-white/[0.06]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded-r-full bg-[#D97706] shadow-[0_0_10px_rgba(217,119,6,0.8)]" />
          )}
          <Icon
            className={`w-[18px] h-[18px] shrink-0 transition-colors ${
              isActive
                ? 'text-[#D97706] drop-shadow-[0_0_8px_rgba(217,119,6,0.5)]'
                : 'text-[#A8A29E]'
            }`}
          />
          <span className="truncate">{item.label}</span>
          {typeof item.badge === 'number' && item.badge > 0 && (
            <span className="ml-auto min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#D97706] text-[#0F0D0A] text-[11px] font-bold flex items-center justify-center">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default AppShell;