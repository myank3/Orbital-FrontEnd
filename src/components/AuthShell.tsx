/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auth shell — Instagram-style centered layout.
 * Dark glass card on an ambient background.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Lock } from 'lucide-react';

export interface AuthShellProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  hideBack?: boolean;
}

const SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';
const SPRING = { type: 'spring' as const, stiffness: 220, damping: 28 };

function AuthShell({
  children,
  title,
  subtitle,
  hideBack = false,
}: AuthShellProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();

  const stagger = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { ...SPRING, delay },
        };

  return (
    <div className="min-h-screen bg-[#0F0D0A] text-[#EDE5D4] relative overflow-hidden flex flex-col">
      {/* ─── Ambient background (behind everything) ─────────── */}
      {!reduceMotion && (
        <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
          <motion.div
            className="absolute top-[-15%] left-[-10%] w-[700px] h-[700px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(217,119,6,0.20) 0%, rgba(217,119,6,0.04) 45%, rgba(217,119,6,0) 72%)',
              filter: 'blur(80px)',
            }}
            animate={{
              x: [0, 80, -40, 0],
              y: [0, -50, 60, 0],
              scale: [1, 1.06, 0.96, 1],
            }}
            transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(139,111,71,0.18) 0%, rgba(139,111,71,0.03) 45%, rgba(139,111,71,0) 72%)',
              filter: 'blur(80px)',
            }}
            animate={{
              x: [0, -60, 30, 0],
              y: [0, 40, -30, 0],
              scale: [1, 0.95, 1.05, 1],
            }}
            transition={{ duration: 36, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          />
          <motion.div
            className="absolute top-[35%] left-[40%] w-[420px] h-[420px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(120,80,60,0.14) 0%, rgba(120,80,60,0) 70%)',
              filter: 'blur(70px)',
            }}
            animate={{
              x: [0, 30, -20, 0],
              y: [0, -25, 25, 0],
              opacity: [0.5, 0.9, 0.6, 0.5],
            }}
            transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
          />
        </div>
      )}

      {/* ─── Paper grain overlay ────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* ─── Back button (top-left, floating) ───────────────── */}
      {!hideBack && (
        <motion.div
          {...stagger(0.05)}
          className="absolute top-6 left-6 sm:top-8 sm:left-8 z-10"
        >
          <Link
            to="/"
            className="group inline-flex items-center gap-1.5 text-[12px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors"
          >
            <ArrowLeft
              size={14}
              className="transition-transform duration-200 group-hover:-translate-x-0.5"
            />
            Back
          </Link>
        </motion.div>
      )}

      {/* ─── Centered column ────────────────────────────────── */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-5 sm:px-6 py-14">
        <div className="w-full max-w-[380px]">
          {/* Wordmark */}
          <motion.div {...stagger(0.1)} className="flex justify-center mb-8">
            <Link
              to="/"
              className="inline-flex items-baseline gap-2 select-none group"
            >
              <span
                className="text-[38px] leading-none text-[#EDE5D4] tracking-tight transition-colors group-hover:text-[#D97706]"
                style={{ fontFamily: SERIF }}
              >
                Orbital
              </span>
              <motion.span
                aria-hidden
                initial={reduceMotion ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ ...SPRING, delay: 0.35 }}
                className="w-2 h-2 rounded-full bg-[#D97706] inline-block translate-y-[-6px] shadow-[0_0_14px_rgba(217,119,6,0.8)]"
              />
            </Link>
          </motion.div>

          {/* Card */}
          <motion.div
            {...stagger(0.2)}
            className="rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] p-7 sm:p-8"
          >
            {/* Top-edge glass highlight */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
              }}
            />

            {/* Title */}
            <div className="mb-6">
              <h1 className="text-[20px] sm:text-[22px] leading-[1.2] tracking-[-0.01em] text-[#EDE5D4] font-medium text-center">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-2 text-[13px] text-[#A8A29E] leading-[1.6] text-center">
                  {subtitle}
                </p>
              )}
            </div>

            {/* Form */}
            {children}
          </motion.div>

          {/* Trust line below card */}
          <motion.div
            {...stagger(0.35)}
            className="mt-6 flex justify-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] backdrop-blur-md border border-white/[0.06]">
              <Lock className="w-3 h-3 text-[#D97706]" />
              <span className="text-[10.5px] uppercase tracking-[0.20em] text-[#6B6259]">
                End-to-end encrypted
              </span>
            </div>
          </motion.div>

          {/* Footer */}
          <motion.div
            {...stagger(0.45)}
            className="mt-10 text-center text-[11px] text-[#6B6259]"
          >
            © {new Date().getFullYear()} Orbital
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default AuthShell;
export { AuthShell };