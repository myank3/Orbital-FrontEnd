/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import { NavLink, Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
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
  icon: React.ComponentType<{ className?: string }>;
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
  }

  /* 🟢 Smooth loading bar animation */
  @keyframes loading-bar {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .loading-bar {
    animation: loading-bar 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }
`;

function AppShell(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { incomingCall, acceptCall, rejectCall } = useCall();

  const isActiveChat = 
    (location.pathname.startsWith('/app/dm/') && location.pathname !== '/app/dm') ||
    (location.pathname.startsWith('/app/groups/') && location.pathname !== '/app/groups');

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [railHovered, setRailHovered] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileUserMenuOpen, setMobileUserMenuOpen] = useState(false);
  
  // 🟢 Fake loading state
  const [isNavigating, setIsNavigating] = useState(false);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [callerName, setCallerName] = useState<string | null>(null);

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

  // 🟢 Clear loading state on route change
  useEffect(() => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    setIsNavigating(false);
  }, [location.pathname]);

  // 🟢 The 1-second fake delay logic
  const handleNavigate = (to: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (location.pathname === to) return; // Don't delay if already on page
    
    setIsNavigating(true);
    // 1000ms delay before actual navigation
    loadingTimer.current = setTimeout(() => {
      navigate(to);
      setMobileMenuOpen(false);
      setUserMenuOpen(false);
      setMobileUserMenuOpen(false);
    }, 1000);
  };

  const handleSignOut = async () => {
    try {
      await logout();
      navigate('/login');
    } catch {
      navigate('/login');
    }
  };

  useEffect(() => {
    if (mobileMenuOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen && !mobileUserMenuOpen) return;
    const onDocClick = () => {
      setUserMenuOpen(false);
      setMobileUserMenuOpen(false);
    };
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [userMenuOpen, mobileUserMenuOpen]);

  const primaryNav: NavItem[] = [
    { to: '/app/dm', label: 'Messages', icon: MessageSquare },
    { to: '/app/groups', label: 'Groups', icon: Users },
    { to: '/app/friends', label: 'Friends', icon: UserCheck },
  ];

  const activityNav: NavItem[] = [
    { to: '/app/calls', label: 'Calls', icon: Phone },
    { to: '/app/notifications', label: 'Media', icon: ImageIcon },
    { to: '/app/signals', label: 'Signals', icon: Compass, highlight: true },
  ];

  const railWidth = railHovered ? 224 : 68;
  const incomingDisplayName = callerName ?? 'Someone';

  return (
    <div className="flex h-screen bg-[#0B0A08] text-[#EDE5D4] overflow-hidden selection:bg-[#D97706]/30 selection:text-[#EDE5D4]">
      <style>{SHELL_CSS}</style>

      {/* 🟢 FAKE LOADING BAR (Sits at the very top of the viewport) */}
      {isNavigating && (
        <div className="fixed top-0 left-0 right-0 h-[2px] bg-[#D97706]/20 z-[100] overflow-hidden pointer-events-none">
          <div className="loading-bar w-full h-full bg-gradient-to-r from-transparent via-[#D97706] to-transparent shadow-[0_0_10px_rgba(217,119,6,0.8)]" />
        </div>
      )}

      {/* ─── MOBILE DRAWER ─────────────────────────────────── */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="drawer-in fixed inset-y-0 left-0 z-40 w-[280px] bg-[#0F0D0A]/95 backdrop-blur-3xl border-r border-white/[0.08] shadow-[20px_0_60px_rgba(0,0,0,0.8)] flex flex-col md:hidden">
            <div className="h-16 px-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
              <Link
                to="/app/orbit"
                onClick={(e) => handleNavigate('/app/orbit', e)}
                className="flex items-baseline gap-2"
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
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-md text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-5 overflow-y-auto custom-scrollbar">
              <MobileSection label="Messages">
                {primaryNav.map((item) => (
                  <MobileItem
                    key={item.to}
                    item={item}
                    onNavigate={() => handleNavigate(item.to)}
                  />
                ))}
              </MobileSection>

              <MobileSection label="Activity" className="mt-6">
                {activityNav.map((item) => (
                  <MobileItem
                    key={item.to}
                    item={item}
                    onNavigate={() => handleNavigate(item.to)}
                  />
                ))}
              </MobileSection>
            </nav>
          </aside>
        </>
      )}

      {/* ─── DESKTOP RAIL ─── */}
      {!isActiveChat && (
        <div
          className="hidden md:block relative shrink-0 w-[68px]"
          onMouseEnter={() => setRailHovered(true)}
          onMouseLeave={() => setRailHovered(false)}
        >
          <aside
            style={{ width: railWidth, transition: 'width 250ms cubic-bezier(0.16, 1, 0.3, 1)' }}
            className="absolute inset-y-0 left-0 flex flex-col overflow-hidden z-30
                       bg-[#0F0D0A]/60 backdrop-blur-[40px]
                       border-r border-white/[0.08]
                       shadow-[10px_0_50px_-15px_rgba(0,0,0,0.9),inset_-1px_0_0_rgba(255,255,255,0.02)]"
          >
            {/* Logo */}
            <div className="h-16 flex items-center px-4 shrink-0 border-b border-white/[0.06]">
              <Link
                to="/app/orbit"
                onClick={(e) => handleNavigate('/app/orbit', e)}
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

            {/* Primary + activity nav (Compact) */}
            <nav className="flex-1 py-4 px-2 overflow-y-auto overflow-x-hidden custom-scrollbar">
              <div className="space-y-0.5"> 
                {primaryNav.map((item) => (
                  <RailItem
                    key={item.to}
                    item={item}
                    expanded={railHovered}
                    onNavigate={(e) => handleNavigate(item.to, e)}
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
                    onNavigate={(e) => handleNavigate(item.to, e)}
                  />
                ))}
              </div>
            </nav>

            {/* Bottom: User Profile & Menu */}
            <div className="py-3 px-2 border-t border-white/[0.06]">
              <div className="relative mt-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setUserMenuOpen((v) => !v);
                  }}
                  className={`w-full flex items-center gap-3 rounded-xl transition-all duration-300 px-2 py-2 ${
                    userMenuOpen ? 'bg-white/[0.08] ring-1 ring-white/[0.1]' : 'hover:bg-white/[0.04]'
                  }`}
                  title={user?.displayName || 'Profile'}
                >
                  <span className="w-[52px] shrink-0 flex items-center justify-center">
                    <Avatar
                      name={user?.displayName || 'User'}
                      src={user?.avatarUrl}
                      size="sm"
                      isOnline={true}
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

                {/* Desktop Dropdown Menu */}
                {userMenuOpen && (
                  <div
                    className="absolute bottom-full mb-3 left-0 right-0 min-w-[220px] rounded-2xl bg-[#131110]/95 backdrop-blur-3xl border border-white/[0.1] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden z-50 origin-bottom-left transition-all duration-200 opacity-100 translate-y-0 scale-100"
                    onClick={(e) => e.stopPropagation()}
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
                        onClick={(e) => handleNavigate('/app/settings', e)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                      >
                        <Settings className="w-4 h-4" />
                        <span>Settings</span>
                      </Link>
                      
                      <Link
                        to="/app/orbit"
                        onClick={(e) => handleNavigate('/app/orbit', e)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                      >
                        <Orbit className="w-4 h-4" />
                        <span>Your Orbit</span>
                      </Link>
                    </div>

                    <div className="p-1.5 border-t border-white/[0.06]">
                      <button
                        onClick={() => void handleSignOut()}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.1] transition-colors"
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
      )}

      {/* ─── MAIN COLUMN ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 relative">
        {/* Mobile Header */}
        {!isActiveChat && (
          <header className="md:hidden h-14 bg-[#0F0D0A]/80 backdrop-blur-3xl border-b border-white/[0.06] px-4 flex items-center justify-between shrink-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-1.5 rounded-md text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
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
                  className="h-9 px-4 rounded-xl bg-white/[0.05] hover:bg-[#B91C1C]/15 border border-white/[0.08] hover:border-[#B91C1C]/40 text-[#EDE5D4] hover:text-[#F87171] text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Decline</span>
                </button>
                <button
                  onClick={() => void acceptCall()}
                  className="h-9 px-4 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#0F0D0A] text-[13px] font-semibold transition-colors shadow-[0_6px_20px_-8px_rgba(34,197,94,0.7)] inline-flex items-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Accept</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className={`flex-1 overflow-y-auto bg-[#0B0A08] relative custom-scrollbar ${!isActiveChat ? 'pb-16 md:pb-0' : ''}`}>
          <Outlet />
        </main>

        {/* ─── MOBILE BOTTOM BAR ─── */}
        {!isActiveChat && (
          <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#0F0D0A]/90 backdrop-blur-3xl border-t border-white/[0.06] z-40 flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom)]">
            {primaryNav.slice(0, 3).map((item) => (
               <button
                 key={item.to}
                 onClick={(e) => handleNavigate(item.to, e)}
                 className={`flex flex-col items-center justify-center w-14 h-full gap-1 ${
                   location.pathname.startsWith(item.to) ? 'text-[#D97706]' : 'text-[#A8A29E] hover:text-[#EDE5D4]'
                 }`}
               >
                 <item.icon size={20} />
                 <span className="text-[9px] font-medium">{item.label}</span>
               </button>
            ))}

            {/* Mobile Avatar Button */}
            <div className="relative flex items-center justify-center w-14 h-full">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMobileUserMenuOpen((v) => !v);
                }}
                className={`flex items-center justify-center p-1 rounded-full transition-all ${
                  mobileUserMenuOpen ? 'bg-white/[0.1] ring-1 ring-white/[0.2]' : ''
                }`}
              >
                <Avatar
                  name={user?.displayName || 'User'}
                  src={user?.avatarUrl}
                  size="sm"
                  isOnline={true}
                />
              </button>

              {/* Mobile Dropdown Menu */}
              {mobileUserMenuOpen && (
                <div
                  className="absolute bottom-[calc(100%+10px)] right-0 w-[220px] rounded-2xl bg-[#131110]/95 backdrop-blur-3xl border border-white/[0.1] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden z-50 origin-bottom-right"
                  onClick={() => setMobileUserMenuOpen(false)}
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
                    <button
                      onClick={(e) => handleNavigate('/app/settings', e)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      <span>Settings</span>
                    </button>
                    
                    <button
                      onClick={(e) => handleNavigate('/app/orbit', e)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors"
                    >
                      <Orbit className="w-4 h-4" />
                      <span>Your Orbit</span>
                    </button>
                  </div>

                  <div className="p-1.5 border-t border-white/[0.06]">
                    <button
                      onClick={() => void handleSignOut()}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.1] transition-colors"
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
  onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  onNavigate: (e: React.MouseEvent) => void;
}) {
  const Icon = item.icon;
  const accent = item.accent;
  const highlight = item.highlight;

  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
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
            <div className={`absolute inset-0 rounded-xl ring-1 ring-inset z-0 ${
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

          {/* Badge */}
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
  const highlight = item.highlight;
  
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-3 h-11 rounded-xl text-[13.5px] font-medium transition-all duration-300 ${
          isActive
            ? 'bg-gradient-to-r from-[#D97706]/15 to-transparent text-[#EDE5D4] ring-1 ring-[#D97706]/20'
            : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.04]'
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
              isActive ? 'text-[#D97706] drop-shadow-[0_0_8px_rgba(217,119,6,0.5)]' : 'text-[#A8A29E]'
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