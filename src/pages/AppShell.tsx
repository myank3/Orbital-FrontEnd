/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavLink, Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { apiService } from '../services/api';
import { Avatar } from '../components/Avatar';
import VideoCallOverlay from '../components/VideoCallOverlay';
import { Menu, X, Phone, PhoneOff, LogOut, SlidersHorizontal } from 'lucide-react';

/* ────────────────────────────────────────────────────────── */
/* Custom icon set — 1.8 stroke, cohesive                    */
/* ────────────────────────────────────────────────────────── */

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function SvgBase({
  size = 20,
  children,
  strokeWidth = 1.8,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const IconMessages = (p: IconProps) => (
  <SvgBase {...p}>
    <path d="M20.5 11.6c0 4.6-3.8 8.3-8.5 8.3-1.3 0-2.6-.3-3.7-.8L3.5 20.5l1.4-4.4a8.1 8.1 0 0 1-1.4-4.5c0-4.6 3.8-8.3 8.5-8.3s8.5 3.7 8.5 8.3Z" />
    <path d="M8.7 11.6h.01M12 11.6h.01M15.3 11.6h.01" />
  </SvgBase>
);

const IconGroups = (p: IconProps) => (
  <SvgBase {...p}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M2.8 19.5c.4-3.2 3-5.6 6.2-5.6s5.8 2.4 6.2 5.6" />
    <circle cx="17.2" cy="8.5" r="2.4" />
    <path d="M15.7 14.1c.5-.1 1-.15 1.5-.15 2.3 0 4.2 1.7 4.5 3.9" />
  </SvgBase>
);

const IconFriends = (p: IconProps) => (
  <SvgBase {...p}>
    <circle cx="9.5" cy="8" r="3.5" />
    <path d="M3 19.8c.3-3.3 3.1-5.9 6.5-5.9 1.3 0 2.6.4 3.6 1.1" />
    <path d="m15.2 17.6 1.9 1.9 4-4" />
  </SvgBase>
);

const IconCalls = (p: IconProps) => (
  <SvgBase {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />
  </SvgBase>
);

const IconMedia = (p: IconProps) => (
  <SvgBase {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="8.5" cy="8.5" r="1.4" />
    <path d="m3 16 4.5-4 4 4 2.5-2.5L21 18" />
  </SvgBase>
);

const IconSignals = (p: IconProps) => (
  <SvgBase {...p}>
    <path d="M8.5 15.5a5 5 0 0 1 0-7" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M5.6 18.4a9 9 0 0 1 0-12.8" />
    <path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </SvgBase>
);

const IconOrbit = (p: IconProps) => (
  <SvgBase {...p}>
    <ellipse cx="12" cy="12" rx="8" ry="3" transform="rotate(45 12 12)" />
    <ellipse cx="12" cy="12" rx="8" ry="3" transform="rotate(-45 12 12)" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </SvgBase>
);

const IconSettings = (p: IconProps) => (
  <SlidersHorizontal {...(p as any)} size={p.size ?? 18} strokeWidth={1.8} />
);

/* ────────────────────────────────────────────────────────── */
/* Nav types                                                  */
/* ────────────────────────────────────────────────────────── */

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  badge?: number | string;
  accent?: boolean;
  highlight?: boolean;
}

const DRAWER_W = 280;

const TAB_ROUTES = [
  '/app/dm',
  '/app/groups',
  '/app/friends',
  '/app/calls',
] as const;

function getTabIndex(pathname: string): number {
  return (TAB_ROUTES as readonly string[]).indexOf(pathname);
}

const SHELL_CSS = `
  @keyframes signal-shine {
    0%   { transform: translate3d(-200%, 0, 0) skewX(-20deg); }
    100% { transform: translate3d(200%, 0, 0) skewX(-20deg); }
  }
  .signal-shine {
    animation: signal-shine 2.5s ease-in-out infinite;
    animation-delay: 1s;
    backface-visibility: hidden;
  }

  @keyframes call-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1.08); opacity: 0.8; }
  }
  .call-pulse {
    animation: call-pulse 1.6s ease-in-out infinite;
    backface-visibility: hidden;
  }

  @keyframes menu-pop {
    from { opacity: 0; transform: translate3d(0, 6px, 0) scale(0.98); }
    to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }
  .menu-pop {
    animation: menu-pop 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: bottom left;
    backface-visibility: hidden;
  }
  .menu-pop-right {
    animation: menu-pop 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: bottom right;
    backface-visibility: hidden;
  }

  @keyframes tab-in-right {
    from { opacity: 0; transform: translate3d(60px, 0, 0); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes tab-in-left {
    from { opacity: 0; transform: translate3d(-60px, 0, 0); }
    to   { opacity: 1; transform: none; }
  }
  .tab-next { animation: tab-in-right 280ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  .tab-prev { animation: tab-in-left  280ms cubic-bezier(0.16, 1, 0.3, 1) both; }

  @keyframes route-forward {
    from { opacity: 0; transform: translate3d(18px, 0, 0); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes route-back {
    from { opacity: 0; transform: translate3d(-18px, 0, 0); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes route-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .route-forward { animation: route-forward 260ms cubic-bezier(0.16,1,0.3,1) both; }
  .route-back    { animation: route-back    260ms cubic-bezier(0.16,1,0.3,1) both; }
  .route-fade    { animation: route-fade    200ms ease-out both; }

  /* ── App shell: pure flat warm-black. No grain, no banding, no lines. ── */
  .app-shell {
    position: relative;
    isolation: isolate;
    background-color: #0B0A09;
  }

  .app-shell button,
  .app-shell a,
  .app-shell [role="button"] {
    -webkit-tap-highlight-color: transparent;
  }

  .shell-rail   { contain: paint; }
  .shell-main   { contain: paint; }
  .shell-drawer { contain: paint; }

  .drawer-panel {
    backface-visibility: hidden;
    touch-action: pan-y;
  }

  .tab-swipe-surface {
    touch-action: pan-y;
  }

  @media (prefers-reduced-motion: reduce) {
    .signal-shine, .call-pulse, .menu-pop, .menu-pop-right,
    .tab-next, .tab-prev, .route-forward, .route-back, .route-fade {
      animation: none !important;
    }
    .drawer-panel { transition: none !important; }
  }
`;

function isFullScreenRoute(pathname: string): boolean {
  const isDmDetail = pathname.startsWith('/app/dm/') && pathname !== '/app/dm';
  const isGroupDetail =
    pathname.startsWith('/app/groups/') && pathname !== '/app/groups';
  const isSignals = pathname.startsWith('/app/signals');
  return isDmDetail || isGroupDetail || isSignals;
}

/* ────────────────────────────────────────────────────────── */
/* AppShell                                                   */
/* ────────────────────────────────────────────────────────── */

function AppShell(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { incomingCall, acceptCall, rejectCall } = useCall();

  const fullScreen = isFullScreenRoute(location.pathname);
  const hideMobileChrome = fullScreen;

  const shellRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railHovered, setRailHovered] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false);
  const [callerName, setCallerName] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const drawerOpenRef = useRef(false);
  const openDrawerRef = useRef<() => void>(() => {});
  const closeDrawerRef = useRef<() => void>(() => {});
  drawerOpenRef.current = drawerOpen;

  const openDrawer = () => {
    const d = drawerRef.current;
    if (d) {
      d.style.transition = 'transform 280ms cubic-bezier(0.16,1,0.3,1)';
      d.style.transform = 'translate3d(0,0,0)';
    }
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    const d = drawerRef.current;
    if (d) {
      d.style.transition = 'transform 280ms cubic-bezier(0.16,1,0.3,1)';
      d.style.transform = `translate3d(-${DRAWER_W}px,0,0)`;
    }
    setDrawerOpen(false);
  };

  openDrawerRef.current = openDrawer;
  closeDrawerRef.current = closeDrawer;

  /* ── Keyboard detection: focus tracking + visualViewport ── */
  useEffect(() => {
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    const onFocusIn = (e: FocusEvent) => {
      if (isEditable(e.target as Element)) {
        setKeyboardOpen(true);
      }
    };

    const onFocusOut = () => {
      window.setTimeout(() => {
        if (!isEditable(document.activeElement)) {
          setKeyboardOpen(false);
        }
      }, 100);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    const vv = window.visualViewport;
    const checkVV = () => {
      if (!vv) return;
      const gap = window.innerHeight - vv.height;
      if (gap > 150) {
        setKeyboardOpen(true);
      } else if (!isEditable(document.activeElement)) {
        setKeyboardOpen(false);
      }
    };

    if (vv) {
      vv.addEventListener('resize', checkVV);
      vv.addEventListener('scroll', checkVV);
    }
    window.addEventListener('resize', checkVV);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (vv) {
        vv.removeEventListener('resize', checkVV);
        vv.removeEventListener('scroll', checkVV);
      }
      window.removeEventListener('resize', checkVV);
    };
  }, []);

  useEffect(() => {
    closeDrawerRef.current();
    setMobileUserMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

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
        if (!cancelled)
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

  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    let active = false;
    let startX = 0;
    let startY = 0;
    let axis: '' | 'x' | 'y' = '';
    let currentX = -DRAWER_W;

    const applyX = (x: number) => {
      const clamped = Math.max(-DRAWER_W, Math.min(0, x));
      const d = drawerRef.current;
      if (d) d.style.transform = `translate3d(${clamped}px,0,0)`;
      currentX = clamped;
    };

    const onStart = (e: TouchEvent) => {
      if (drawerOpenRef.current) return;
      if (window.innerWidth >= 768) return;
      const t = e.touches[0];
      if (t.clientX > 28) return;
      active = true;
      axis = '';
      startX = t.clientX;
      startY = t.clientY;
      currentX = -DRAWER_W;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!axis) {
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (axis === 'x') {
            const d = drawerRef.current;
            if (d) d.style.transition = 'none';
          }
        }
      }
      if (axis !== 'x') return;

      e.preventDefault();
      applyX(-DRAWER_W + Math.max(0, dx));
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      if (axis !== 'x') return;
      const d = drawerRef.current;
      if (d) d.style.transition = 'transform 280ms cubic-bezier(0.16,1,0.3,1)';
      if (currentX > -DRAWER_W * 0.45) {
        openDrawerRef.current();
      } else {
        if (d) d.style.transform = `translate3d(-${DRAWER_W}px,0,0)`;
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const drawerDrag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    axis: '' as '' | 'x' | 'y',
    currentX: 0,
  });

  const onDrawerTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    const t = e.touches[0];
    drawerDrag.current = {
      active: true,
      startX: t.clientX,
      startY: t.clientY,
      axis: '',
      currentX: 0,
    };
    const d = drawerRef.current;
    if (d) d.style.transition = 'none';
  };

  const onDrawerTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const s = drawerDrag.current;
    if (!s.active) return;
    const t = e.touches[0];
    const dx = t.clientX - s.startX;
    const dy = t.clientY - s.startY;

    if (!s.axis) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
    }
    if (s.axis !== 'x') return;

    const clamped = Math.max(-DRAWER_W, Math.min(0, dx));
    s.currentX = clamped;
    const d = drawerRef.current;
    if (d) d.style.transform = `translate3d(${clamped}px,0,0)`;
  };

  const onDrawerTouchEnd = () => {
    const s = drawerDrag.current;
    if (!s.active) return;
    s.active = false;
    if (s.axis !== 'x') return;
    const d = drawerRef.current;
    if (d) d.style.transition = 'transform 280ms cubic-bezier(0.16,1,0.3,1)';
    if (s.currentX < -DRAWER_W * 0.4) {
      closeDrawer();
    } else {
      openDrawer();
    }
  };

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (getTabIndex(location.pathname) < 0) return;
    if (keyboardOpen) return;

    let active = false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let axis: '' | 'x' | 'y' = '';
    let dx = 0;

    const onStart = (e: TouchEvent) => {
      if (window.innerWidth >= 768) return;
      if (drawerOpenRef.current) return;
      const t = e.touches[0];
      if (t.clientX < 30) return;
      active = true;
      axis = '';
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
      dx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0];
      const ddx = t.clientX - startX;
      const ddy = t.clientY - startY;

      if (!axis) {
        if (Math.abs(ddx) > 8 || Math.abs(ddy) > 8) {
          axis = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
          if (axis === 'x') {
            const m = mainRef.current;
            if (m) {
              m.style.transition = 'none';
              m.style.animation = 'none';
            }
          }
        }
      }
      if (axis !== 'x') return;

      dx = ddx;
      e.preventDefault();

      const idx = getTabIndex(location.pathname);
      const atEdge =
        (idx === 0 && ddx > 0) ||
        (idx === TAB_ROUTES.length - 1 && ddx < 0);

      const m = mainRef.current;
      if (!m) return;
      const factor = atEdge ? 0.28 : 0.55;
      m.style.transform = `translate3d(${ddx * factor}px,0,0)`;
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      if (axis !== 'x') return;

      const elapsed = Math.max(1, Date.now() - startT);
      const vel = Math.abs(dx) / elapsed;
      const dist = Math.abs(dx);

      const idx = getTabIndex(location.pathname);
      const canNext = idx >= 0 && idx < TAB_ROUTES.length - 1 && dx < 0;
      const canPrev = idx > 0 && dx > 0;
      const passed = dist > 60 || (dist > 30 && vel > 0.45);

      const m = mainRef.current;

      if (passed && canNext) {
        if (m) {
          m.style.transition = 'transform 180ms cubic-bezier(0.4,0,1,1), opacity 180ms';
          m.style.transform = 'translate3d(-60px,0,0)';
          m.style.opacity = '0';
        }
        navigate(TAB_ROUTES[idx + 1]);
      } else if (passed && canPrev) {
        if (m) {
          m.style.transition = 'transform 180ms cubic-bezier(0.4,0,1,1), opacity 180ms';
          m.style.transform = 'translate3d(60px,0,0)';
          m.style.opacity = '0';
        }
        navigate(TAB_ROUTES[idx - 1]);
      } else if (m) {
        m.style.transition = 'transform 240ms cubic-bezier(0.16,1,0.3,1)';
        m.style.transform = 'translate3d(0,0,0)';
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [location.pathname, navigate, keyboardOpen]);

  const primaryNav: NavItem[] = useMemo(
    () => [
      { to: '/app/dm', label: 'Messages', icon: IconMessages },
      { to: '/app/groups', label: 'Groups', icon: IconGroups },
      { to: '/app/friends', label: 'Friends', icon: IconFriends },
    ],
    [],
  );

  const activityNav: NavItem[] = useMemo(
    () => [
      { to: '/app/calls', label: 'Calls', icon: IconCalls },
      { to: '/app/notifications', label: 'Media', icon: IconMedia },
      { to: '/app/signals', label: 'Satellite', icon: IconSignals },
    ],
    [],
  );

  const allNav = useMemo(() => [...primaryNav], [primaryNav]);

  const railWidth = railHovered ? 224 : 68;
  const incomingDisplayName = callerName ?? 'Someone';

  const navRef = useRef<{
    path: string;
    anim: 'tab-next' | 'tab-prev' | 'route-forward' | 'route-back' | 'route-fade';
  }>({ path: location.pathname, anim: 'route-fade' });

  if (navRef.current.path !== location.pathname) {
    const prevIdx = getTabIndex(navRef.current.path);
    const currIdx = getTabIndex(location.pathname);
    let anim:
      | 'tab-next'
      | 'tab-prev'
      | 'route-forward'
      | 'route-back'
      | 'route-fade' = 'route-fade';

    if (prevIdx >= 0 && currIdx >= 0 && prevIdx !== currIdx) {
      anim = currIdx > prevIdx ? 'tab-next' : 'tab-prev';
    } else {
      const pd = navRef.current.path.split('/').filter(Boolean).length;
      const nd = location.pathname.split('/').filter(Boolean).length;
      if (nd > pd) anim = 'route-forward';
      else if (nd < pd) anim = 'route-back';
      else anim = 'route-fade';
    }
    navRef.current = { path: location.pathname, anim };
  }
  const routeAnim = navRef.current.anim;

  const bottomNavRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useLayoutEffect(() => {
    const ind = indicatorRef.current;
    const wrap = bottomNavRef.current;
    if (!ind || !wrap) return;
    const active = allNav.find(
      (i) =>
        location.pathname === i.to ||
        location.pathname.startsWith(i.to + '/'),
    );
    if (!active) {
      ind.style.opacity = '0';
      return;
    }
    const tab = tabRefs.current[active.to];
    if (!tab) {
      ind.style.opacity = '0';
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    if (!wr.width || !tr.width) {
      ind.style.opacity = '0';
      return;
    }
    ind.style.opacity = '1';
    ind.style.width = `${tr.width}px`;
    ind.style.transform = `translate3d(${tr.left - wr.left}px, 0, 0)`;
  }, [location.pathname, allNav, hideMobileChrome]);

  return (
    <div
      ref={shellRef}
      className="app-shell flex h-screen text-[#EDE5D4] overflow-hidden selection:bg-[#D97706]/30 selection:text-[#EDE5D4]"
      style={{ overscrollBehaviorX: 'none' }}
    >
      <style>{SHELL_CSS}</style>

      <div
        className={`fixed inset-0 z-30 md:hidden ${
          drawerOpen ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        onClick={closeDrawer}
        aria-hidden
      />

      {/* ─── MOBILE DRAWER ─── */}
      <aside
        ref={drawerRef}
        className="drawer-panel shell-drawer fixed inset-y-0 left-0 z-40 w-[280px]
                   bg-[#0B0A09] border-r border-white/[0.06]
                   shadow-[6px_0_24px_-8px_rgba(0,0,0,0.6)]
                   flex flex-col md:hidden overscroll-contain"
        style={{
          transform: `translate3d(-${DRAWER_W}px,0,0)`,
          transition: 'transform 280ms cubic-bezier(0.16,1,0.3,1)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        onTouchStart={onDrawerTouchStart}
        onTouchMove={onDrawerTouchMove}
        onTouchEnd={onDrawerTouchEnd}
        onTouchCancel={onDrawerTouchEnd}
      >
        <div className="pt-2 pb-1 flex justify-center">
          <span className="h-1 w-9 rounded-full bg-white/[0.18]" aria-hidden />
        </div>

        <div className="h-14 px-4 flex items-center justify-between shrink-0">
          <Link
            to="/app/orbit"
            onClick={closeDrawer}
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
            onClick={closeDrawer}
            className="p-2 -mr-1 rounded-md text-[#A8A29E] active:bg-white/[0.08] hover:bg-white/[0.06] transition-colors touch-manipulation"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" strokeWidth={1.8} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 overflow-y-auto overscroll-contain custom-scrollbar">
          <MobileSection label="Messages">
            {primaryNav.map((item) => (
              <MobileItem key={item.to} item={item} onNavigate={closeDrawer} />
            ))}
          </MobileSection>

          <MobileSection label="Activity" className="mt-6">
            {activityNav.map((item) => (
              <MobileItem key={item.to} item={item} onNavigate={closeDrawer} />
            ))}
          </MobileSection>
        </nav>
      </aside>

      {/* ─── DESKTOP RAIL ─── */}
      <div
        className="hidden md:block relative shrink-0 w-[68px]"
        onMouseEnter={() => setRailHovered(true)}
        onMouseLeave={() => setRailHovered(false)}
      >
        <aside
          style={{
            width: railWidth,
            transition: 'width 260ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="shell-rail absolute inset-y-0 left-0 flex flex-col overflow-hidden z-30
                     bg-[#0B0A09] border-r border-white/[0.06]
                     shadow-[10px_0_50px_-15px_rgba(0,0,0,0.9)]"
        >
          <div className="h-16 flex items-center px-4 shrink-0">
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

          <nav className="flex-1 py-4 px-2 overflow-y-auto overflow-x-hidden custom-scrollbar">
            <div className="space-y-0.5">
              {primaryNav.map((item) => (
                <RailItem key={item.to} item={item} expanded={railHovered} />
              ))}
            </div>

            <div className="my-3 mx-2 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

            <div className="space-y-0.5">
              {activityNav.map((item) => (
                <RailItem key={item.to} item={item} expanded={railHovered} />
              ))}
            </div>
          </nav>

          <div className="py-3 px-2">
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
                  className="menu-pop absolute bottom-full mb-3 left-0 right-0 min-w-[220px] rounded-2xl bg-[#131110] border border-white/[0.1] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden z-50"
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
                      <IconSettings size={16} />
                      <span>Settings</span>
                    </Link>
                    <Link
                      to="/app/orbit"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                      role="menuitem"
                    >
                      <IconOrbit size={16} />
                      <span>Your Orbit</span>
                    </Link>
                  </div>

                  <div className="p-1.5 border-t border-white/[0.06]">
                    <button
                      onClick={() => void handleSignOut()}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.1] transition-colors"
                      role="menuitem"
                    >
                      <LogOut className="w-4 h-4" strokeWidth={1.8} />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ─── MAIN COLUMN ─── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 relative">
        {/* Mobile header — NO border, NO blur, transparent so it merges with shell */}
        {!hideMobileChrome && (
          <header
            className="md:hidden bg-transparent px-4 flex items-center justify-between shrink-0"
            style={{
              paddingTop: 'env(safe-area-inset-top, 0px)',
              height: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
            }}
          >
            <button
              onClick={openDrawer}
              className="p-2 -ml-1 rounded-md text-[#A8A29E] active:bg-white/[0.08] hover:bg-white/[0.06] transition-colors touch-manipulation"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" strokeWidth={1.8} />
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

        {incomingCall && (
          <div className="shrink-0 z-30 px-4 sm:px-6 py-3 bg-[#0B0A09] border-b border-[#22C55E]/30 shadow-[0_10px_30px_-10px_rgba(34,197,94,0.15)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="call-pulse w-10 h-10 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 text-[#22C55E] flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                  <Phone className="w-4 h-4" strokeWidth={1.8} />
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
                  <PhoneOff className="w-3.5 h-3.5" strokeWidth={1.8} />
                  <span className="hidden sm:inline">Decline</span>
                </button>
                <button
                  onClick={() => void acceptCall()}
                  className="h-9 px-4 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#0F0D0A] text-[13px] font-semibold transition-colors shadow-[0_6px_20px_-8px_rgba(34,197,94,0.7)] inline-flex items-center gap-1.5 touch-manipulation"
                >
                  <Phone className="w-3.5 h-3.5" strokeWidth={2} />
                  <span>Accept</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <main
          ref={mainRef}
          key={location.pathname}
          className={`tab-swipe-surface shell-main flex-1 overflow-y-auto bg-transparent relative custom-scrollbar overscroll-contain ${routeAnim} ${
            !hideMobileChrome ? (keyboardOpen ? 'pb-0' : 'pb-16') : ''
          } md:pb-0`}
        >
          <Outlet />
        </main>

        {!hideMobileChrome && (
          <nav
            className={`md:hidden fixed bottom-0 left-0 right-0 bg-[#0B0A09] z-40 transition-transform duration-200 ease-out ${
              keyboardOpen ? 'translate-y-full' : 'translate-y-0'
            }`}
            style={{
              height: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div className="flex items-center h-16 w-full">
              <div
                ref={bottomNavRef}
                className="relative flex items-center justify-around flex-1 h-full"
              >
                <span
                  ref={indicatorRef}
                  aria-hidden
                  className="pointer-events-none absolute top-2 left-0 h-12 rounded-2xl bg-[#D97706]/12 ring-1 ring-inset ring-[#D97706]/22 opacity-0"
                  style={{
                    transition:
                      'transform 340ms cubic-bezier(0.16,1,0.3,1), width 340ms cubic-bezier(0.16,1,0.3,1), opacity 180ms ease-out',
                    willChange: 'transform',
                  }}
                />

                {allNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    ref={(el) => {
                      tabRefs.current[item.to] = el;
                    }}
                    className={({ isActive }) =>
                      `relative z-10 flex flex-col items-center justify-center flex-1 h-16 gap-1 touch-manipulation transition-colors ${
                        isActive
                          ? 'text-[#D97706]'
                          : 'text-[#A8A29E] hover:text-[#EDE5D4]'
                      }`
                    }
                  >
                    <item.icon size={20} />
                    <span className="text-[10px] font-medium whitespace-nowrap">{item.label}</span>
                  </NavLink>
                ))}
              </div>

              <div className="relative flex items-center justify-center w-14 h-16 shrink-0 bg-[#0B0A09] z-20">
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
                    className="menu-pop-right absolute bottom-[calc(100%+10px)] right-0 w-[220px] rounded-2xl bg-[#131110] border border-white/[0.1] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden z-50"
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
                        to="/app/orbit"
                        onClick={() => setMobileUserMenuOpen(false)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors touch-manipulation"
                        role="menuitem"
                      >
                        <IconOrbit size={16} />
                        <span>Your Orbit</span>
                      </Link>
                      <Link
                        to="/app/settings"
                        onClick={() => setMobileUserMenuOpen(false)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors touch-manipulation"
                        role="menuitem"
                      >
                        <IconSettings size={16} />
                        <span>Settings</span>
                      </Link>
                    </div>

                    <div className="p-1.5 border-t border-white/[0.06]">
                      <button
                        onClick={() => void handleSignOut()}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.1] transition-colors touch-manipulation"
                        role="menuitem"
                      >
                        <LogOut className="w-4 h-4" strokeWidth={1.8} />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </nav>
        )}
      </div>

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
            <>
              <span
                className={`absolute inset-0 rounded-xl ring-1 ring-inset z-0 ${
                  accent
                    ? 'bg-gradient-to-r from-[#D97706]/22 to-transparent ring-[#D97706]/40'
                    : 'bg-gradient-to-r from-[#D97706]/16 via-[#D97706]/5 to-transparent ring-[#D97706]/22'
                }`}
              />
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full bg-[#D97706] shadow-[0_0_12px_rgba(217,119,6,0.9)] z-10" />
            </>
          )}

          <span className="w-[68px] shrink-0 flex items-center justify-center relative z-10">
            <span className="inline-flex transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110 group-active:scale-90">
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
            className={`relative z-10 text-[14px] font-medium truncate whitespace-nowrap transition-all duration-300 ${
              expanded
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 -translate-x-1'
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
/* Drawer helpers                                             */
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