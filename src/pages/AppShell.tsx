/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
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
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

function AppShell(): React.JSX.Element {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { incomingCall, acceptCall, rejectCall } = useCall();
  const reduceMotion = useReducedMotion();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [railHovered, setRailHovered] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

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

  // Close user popover on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocClick = () => setUserMenuOpen(false);
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [userMenuOpen]);

  /* ─── Nav grouping ───────────────────────────────────── */
  const primaryNav: NavItem[] = [
    { to: '/app/dm', label: 'Messages', icon: MessageSquare },
    { to: '/app/groups', label: 'Groups', icon: Users },
    { to: '/app/friends', label: 'Friends', icon: UserCheck },
  ];

  const activityNav: NavItem[] = [
    { to: '/app/calls', label: 'Calls', icon: Phone },
    { to: '/app/notifications', label: 'Media', icon: ImageIcon },
  ];

  const bottomItems: NavItem[] = [
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ];

  const desktopRailWidth = railHovered ? 220 : 68;

  return (
    <div className="flex h-screen bg-[#0B0A08] text-[#EDE5D4] overflow-hidden">
      {/* ─── MOBILE DRAWER ────────────────────────────────────── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 left-0 z-40 w-[280px] bg-[#0F0D0A] border-r border-white/[0.06] flex flex-col md:hidden"
            >
              {/* Drawer header */}
              <div className="h-16 px-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
                <Link
                  to="/app/dm"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-baseline gap-2"
                >
                  <span
                    className="text-[20px] leading-none text-[#EDE5D4] tracking-tight"
                    style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
                  >
                    Orbital
                  </span>
                  <span
                    aria-hidden
                    className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-2px] shadow-[0_0_10px_rgba(217,119,6,0.55)]"
                  />
                </Link>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-md text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Nav */}
              <nav className="flex-1 px-3 py-4 overflow-y-auto">
                <MobileSection label="Messages">
                  {primaryNav.map((item) => (
                    <MobileItem key={item.to} item={item} onNavigate={() => setMobileMenuOpen(false)} />
                  ))}
                </MobileSection>

                <MobileSection label="Activity" className="mt-6">
                  {activityNav.map((item) => (
                    <MobileItem key={item.to} item={item} onNavigate={() => setMobileMenuOpen(false)} />
                  ))}
                </MobileSection>

                <MobileSection label="Account" className="mt-6">
                  {bottomItems.map((item) => (
                    <MobileItem key={item.to} item={item} onNavigate={() => setMobileMenuOpen(false)} />
                  ))}
                </MobileSection>
              </nav>

              {/* Sign out */}
              <div className="p-3 border-t border-white/[0.06]">
                <button
                  onClick={() => void handleSignOut()}
                  className="w-full flex items-center gap-3 px-3 h-11 rounded-xl text-[13.5px] text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.08] transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign out</span>
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ─── DESKTOP RAIL ─────────────────────────────────────── */}
      <motion.aside
        onMouseEnter={() => setRailHovered(true)}
        onMouseLeave={() => setRailHovered(false)}
        animate={{ width: desktopRailWidth }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        className="hidden md:flex flex-col shrink-0 bg-[#0F0D0A] border-r border-white/[0.06] overflow-hidden z-20"
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 shrink-0 border-b border-white/[0.05]">
          <Link
            to="/app/dm"
            className="flex items-baseline gap-2 select-none whitespace-nowrap"
          >
            <span
              className="text-[20px] leading-none text-[#EDE5D4] tracking-tight"
              style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
            >
              Orbital
            </span>
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-2px] shadow-[0_0_10px_rgba(217,119,6,0.55)]"
            />
          </Link>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto overflow-x-hidden">
          <div className="space-y-0.5">
            {primaryNav.map((item) => (
              <RailItem
                key={item.to}
                item={item}
                expanded={railHovered}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            ))}
          </div>

          {/* Divider + Activity */}
          <div className="my-3 mx-3 h-px bg-white/[0.05]" />

          <div className="space-y-0.5">
            {activityNav.map((item) => (
              <RailItem
                key={item.to}
                item={item}
                expanded={railHovered}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            ))}
          </div>
        </nav>

        {/* Bottom: settings + user */}
        <div className="py-3 px-2 border-t border-white/[0.05]">
          <div className="space-y-0.5">
            {bottomItems.map((item) => (
              <RailItem
                key={item.to}
                item={item}
                expanded={railHovered}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            ))}
          </div>

          {/* User pill */}
          <div className="relative mt-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUserMenuOpen((v) => !v);
              }}
              className={`w-full flex items-center gap-3 rounded-xl transition-colors px-2 py-2 ${
                userMenuOpen ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
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
                  <p className="text-[12.5px] font-medium text-[#EDE5D4] truncate leading-tight">
                    {user?.displayName || 'Active User'}
                  </p>
                  <p className="text-[10.5px] text-[#6B6259] truncate mt-0.5">
                    @{user?.userHandle || 'guest'}
                  </p>
                </div>
              )}
            </button>

            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: 6, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                  className="absolute bottom-full mb-2 left-0 right-0 min-w-[200px] rounded-xl bg-[#131110] border border-white/[0.08] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] overflow-hidden z-50"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-3 py-3 border-b border-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={user?.displayName || 'User'}
                        src={user?.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-[#EDE5D4] truncate">
                          {user?.displayName || 'Active User'}
                        </p>
                        <p className="text-[11px] text-[#6B6259] truncate mt-0.5">
                          @{user?.userHandle || 'guest'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleSignOut()}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] text-[#A8A29E] hover:text-[#F87171] hover:bg-[#B91C1C]/[0.08] transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign out</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.aside>

      {/* ─── MAIN COLUMN ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        {/* Mobile top header */}
        <header className="md:hidden h-14 bg-[#0F0D0A] border-b border-white/[0.06] px-4 flex items-center justify-between shrink-0">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 rounded-md text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span
            className="text-[17px] tracking-tight text-[#EDE5D4]"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            Orbital
          </span>
          <div className="w-8" />
        </header>

        {/* Incoming call banner */}
        <AnimatePresence>
          {incomingCall && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="shrink-0 z-30 px-4 sm:px-6 py-3 bg-[#0F0D0A] border-b border-[#22C55E]/25"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <motion.div
                    animate={reduceMotion ? undefined : { scale: [1, 1.08, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="w-9 h-9 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 text-[#22C55E] flex items-center justify-center shrink-0"
                  >
                    <Phone className="w-4 h-4" />
                  </motion.div>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-[#22C55E] font-medium">
                      Incoming call
                    </p>
                    <p className="text-[13.5px] text-[#EDE5D4] truncate">
                      {incomingCall.initiatorId ?? 'Someone'} is calling
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => void rejectCall()}
                    className="h-9 px-4 rounded-lg bg-white/[0.05] hover:bg-[#B91C1C]/15 border border-white/[0.08] hover:border-[#B91C1C]/40 text-[#EDE5D4] hover:text-[#F87171] text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Decline</span>
                  </button>
                  <button
                    onClick={() => void acceptCall()}
                    className="h-9 px-4 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#0F0D0A] text-[13px] font-semibold transition-colors shadow-[0_6px_20px_-8px_rgba(34,197,94,0.7)] inline-flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Accept</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-[#0B0A08] relative">
          <Outlet />
        </main>
      </div>

      {/* Full-screen call overlay */}
      <VideoCallOverlay />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/* Desktop rail item                                          */
/* ────────────────────────────────────────────────────────── */

function RailItem({
  item,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `relative group flex items-center h-10 rounded-xl transition-colors overflow-hidden ${
          isActive
            ? 'text-[#EDE5D4]'
            : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.04]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Active background */}
          {isActive && (
            <motion.span
              layoutId="rail-active-bg"
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
              className="absolute inset-0 rounded-xl bg-[#D97706]/[0.10] ring-1 ring-inset ring-[#D97706]/20"
            />
          )}

          {/* Active left bar */}
          {isActive && (
            <motion.span
              layoutId="rail-active-bar"
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
              className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded-r bg-[#D97706] shadow-[0_0_10px_rgba(217,119,6,0.7)]"
            />
          )}

          {/* Icon slot — fixed so labels slide in without shifting the icon */}
          <span className="w-[68px] shrink-0 flex items-center justify-center relative z-10">
            <Icon
              className={`w-[18px] h-[18px] transition-colors ${
                isActive ? 'text-[#D97706]' : 'text-[#A8A29E] group-hover:text-[#EDE5D4]'
              }`}
            />
          </span>

          {/* Label */}
          <span
            className={`relative z-10 text-[13.5px] font-medium truncate whitespace-nowrap transition-opacity duration-150 ${
              expanded ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {item.label}
          </span>

          {/* Badge */}
          {typeof item.badge === 'number' && item.badge > 0 && (
            <span className="relative z-10 ml-auto mr-2 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D97706] text-[#0F0D0A] text-[10.5px] font-semibold flex items-center justify-center">
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
      <p className="px-3 mb-1.5 text-[10.5px] uppercase tracking-[0.20em] text-[#6B6259] font-medium">
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
        `relative flex items-center gap-3 px-3 h-11 rounded-xl text-[13.5px] transition-colors ${
          isActive
            ? 'bg-[#D97706]/[0.10] text-[#EDE5D4]'
            : 'text-[#A8A29E] hover:text-[#EDE5D4] hover:bg-white/[0.04]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded-r bg-[#D97706]" />
          )}
          <Icon
            className={`w-[18px] h-[18px] shrink-0 ${
              isActive ? 'text-[#D97706]' : 'text-[#A8A29E]'
            }`}
          />
          <span className="truncate">{item.label}</span>
          {typeof item.badge === 'number' && item.badge > 0 && (
            <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[#D97706] text-[#0F0D0A] text-[10.5px] font-semibold flex items-center justify-center">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default AppShell;