/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public navbar — dark glass + ambient, animated. Tailwind only.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={reduceMotion ? false : { y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`sticky top-0 z-50 ${
        scrolled
          ? 'backdrop-blur-xl bg-[#0F0D0A]/70 border-b border-white/[0.08] shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6)]'
          : 'bg-transparent border-b border-transparent'
      } transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300`}
    >
      {/* Ambient blobs */}
      {!reduceMotion && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-[8%] w-[420px] h-[420px] rounded-full animate-pulse"
            style={{
              background:
                'radial-gradient(circle, rgba(217,119,6,0.28) 0%, rgba(217,119,6,0) 70%)',
              filter: 'blur(60px)',
              animationDuration: '8s',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 right-[12%] w-[320px] h-[320px] rounded-full animate-pulse"
            style={{
              background:
                'radial-gradient(circle, rgba(139,111,71,0.22) 0%, rgba(139,111,71,0) 70%)',
              filter: 'blur(50px)',
              animationDuration: '10s',
            }}
          />
        </>
      )}

      {/* Top-edge glass highlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,0.14) 20%, rgba(255,255,255,0.14) 80%, transparent)',
        }}
      />

      <nav className="relative max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Wordmark */}
        <Link
          to="/"
          className="group inline-flex items-baseline gap-2 select-none shrink-0"
        >
          <span
            className="text-[22px] leading-none text-[#EDE5D4] tracking-tight transition-colors group-hover:text-[#D97706]"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            Orbital
          </span>
          <motion.span
            aria-hidden
            initial={reduceMotion ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 20 }}
            className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-2px] shadow-[0_0_12px_rgba(217,119,6,0.7)]"
          />
        </Link>

        {/* Center links */}
        <div className="hidden md:flex items-center gap-1">
          <NavLink to="#features" label="Features" />
          <NavLink to="#calling" label="Calling" />
          <NavLink to="#docs" label="Docs" />
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/login"
            className="hidden sm:inline-flex h-9 px-4 rounded-xl text-sm text-[#A8A29E] hover:text-[#EDE5D4] transition-colors items-center"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="group relative h-9 px-4 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-sm font-medium inline-flex items-center transition-all duration-200 active:scale-[0.97] shadow-[0_6px_24px_-8px_rgba(217,119,6,0.7)] hover:shadow-[0_10px_32px_-8px_rgba(217,119,6,0.85)]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0))',
              }}
            />
            <span className="relative">Sign up</span>
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <a
      href={to}
      className="group relative h-9 px-3.5 rounded-xl text-sm text-[#A8A29E] hover:text-[#EDE5D4] transition-colors inline-flex items-center"
    >
      <span className="relative z-10">{label}</span>
      <span
        aria-hidden
        className="absolute left-3.5 right-3.5 bottom-2 h-px bg-[#D97706] scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300"
      />
    </a>
  );
}

export default Navbar;
