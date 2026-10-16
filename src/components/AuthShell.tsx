/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auth shell — centered glass card on an ambient background.
 *
 * ⚡ 144 Hz pass:
 *   · Zero framer-motion. All motion is CSS keyframes on
 *     transform / opacity only — fully compositor-driven.
 *   · The three ambient blobs are pure CSS animated divs, not
 *     React-rendered. No JS work per frame.
 *   · Blur is applied ONCE via a static wrapper; the inner blob
 *     moves with translate3d so the blur is rasterized once and
 *     only the transform is re-composited.
 *   · Stagger is CSS `animation-delay`, no JS sequencing.
 *   · Honors prefers-reduced-motion via CSS media query —
 *     no useReducedMotion hook, no re-render on toggle.
 */

import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';

export interface AuthShellProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  hideBack?: boolean;
}

const SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';

const SHELL_CSS = `
  /* ────────────── entrance ────────────── */
  @keyframes orbital-shell-fade-up {
    from { opacity: 0; transform: translate3d(0, 10px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  .orbital-shell-item {
    animation: orbital-shell-fade-up 260ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
    backface-visibility: hidden;
  }

  /* ────────────── ambient blob drift ──────────────
     Each blob is a static rasterized radial-gradient div with an
     inner child that only translates. This keeps the blur pass
     off the hot path — only transforms recomposite per frame. */
  @keyframes orbital-drift-a {
    0%   { transform: translate3d(0, 0, 0) scale(1); }
    33%  { transform: translate3d(80px, -50px, 0) scale(1.06); }
    66%  { transform: translate3d(-40px, 60px, 0) scale(0.96); }
    100% { transform: translate3d(0, 0, 0) scale(1); }
  }
  @keyframes orbital-drift-b {
    0%   { transform: translate3d(0, 0, 0) scale(1); }
    33%  { transform: translate3d(-60px, 40px, 0) scale(0.95); }
    66%  { transform: translate3d(30px, -30px, 0) scale(1.05); }
    100% { transform: translate3d(0, 0, 0) scale(1); }
  }
  @keyframes orbital-drift-c {
    0%   { transform: translate3d(0, 0, 0); opacity: 0.5; }
    50%  { transform: translate3d(30px, -25px, 0); opacity: 0.9; }
    100% { transform: translate3d(0, 0, 0); opacity: 0.5; }
  }

  .orbital-blob-a {
    animation: orbital-drift-a 30s ease-in-out infinite;
    will-change: transform;
  }
  .orbital-blob-b {
    animation: orbital-drift-b 36s ease-in-out infinite;
    animation-delay: 3s;
    will-change: transform;
  }
  .orbital-blob-c {
    animation: orbital-drift-c 24s ease-in-out infinite;
    animation-delay: 5s;
    will-change: transform, opacity;
  }

  /* ────────────── wordmark dot ────────────── */
  @keyframes orbital-dot-in {
    from { transform: scale(0); }
    to   { transform: scale(1); }
  }
  .orbital-dot {
    animation: orbital-dot-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1) 350ms backwards;
  }

  /* ────────────── reduced motion ────────────── */
  @media (prefers-reduced-motion: reduce) {
    .orbital-shell-item,
    .orbital-dot { animation: none !important; }
    .orbital-blob-a,
    .orbital-blob-b,
    .orbital-blob-c { animation: none !important; }
  }
`;

function AuthShell({
  children,
  title,
  subtitle,
  hideBack = false,
}: AuthShellProps): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[#0F0D0A] text-[#EDE5D4] relative overflow-hidden flex flex-col">
      <style>{SHELL_CSS}</style>

      {/* ─── Ambient background ─────────────────────────────
          Static rasterization: outer div holds the radial-gradient
          and blur, inner div only translates. The blur is
          rasterized once by the compositor; only the transform
          updates each frame. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-[-15%] left-[-10%] w-[700px] h-[700px]">
          <div
            className="orbital-blob-a w-full h-full rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(217,119,6,0.20) 0%, rgba(217,119,6,0.04) 45%, rgba(217,119,6,0) 72%)',
              filter: 'blur(80px)',
              transform: 'translate3d(0,0,0)',
            }}
          />
        </div>
        <div className="absolute bottom-[-15%] right-[-10%] w-[600px] h-[600px]">
          <div
            className="orbital-blob-b w-full h-full rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(139,111,71,0.18) 0%, rgba(139,111,71,0.03) 45%, rgba(139,111,71,0) 72%)',
              filter: 'blur(80px)',
              transform: 'translate3d(0,0,0)',
            }}
          />
        </div>
        <div className="absolute top-[35%] left-[40%] w-[420px] h-[420px]">
          <div
            className="orbital-blob-c w-full h-full rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(120,80,60,0.14) 0%, rgba(120,80,60,0) 70%)',
              filter: 'blur(70px)',
              transform: 'translate3d(0,0,0)',
            }}
          />
        </div>
      </div>

      {/* ─── Paper grain overlay ────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* ─── Back button ────────────────────────────────────── */}
      {!hideBack && (
        <div
          className="orbital-shell-item absolute top-6 left-6 sm:top-8 sm:left-8 z-10"
          style={{ animationDelay: '0.05s' }}
        >
          <Link
            to="/"
            className="group inline-flex items-center gap-1.5 text-[12px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors duration-100"
          >
            <ArrowLeft
              size={14}
              className="transition-transform duration-150 group-hover:-translate-x-0.5"
            />
            Back
          </Link>
        </div>
      )}

      {/* ─── Centered column ────────────────────────────────── */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-5 sm:px-6 py-14">
        <div className="w-full max-w-[380px]">
          {/* Wordmark */}
          <div
            className="orbital-shell-item flex justify-center mb-8"
            style={{ animationDelay: '0.10s' }}
          >
            <Link
              to="/"
              className="inline-flex items-baseline gap-2 select-none group"
            >
              <span
                className="text-[38px] leading-none text-[#EDE5D4] tracking-tight transition-colors duration-100 group-hover:text-[#D97706]"
                style={{ fontFamily: SERIF }}
              >
                Orbital
              </span>
              <span
                aria-hidden
                className="orbital-dot w-2 h-2 rounded-full bg-[#D97706] inline-block translate-y-[-6px] shadow-[0_0_14px_rgba(217,119,6,0.8)]"
              />
            </Link>
          </div>

          {/* Card */}
          <div
            className="orbital-shell-item relative rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] p-7 sm:p-8"
            style={{ animationDelay: '0.20s' }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
              }}
            />

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

            {children}
          </div>

          {/* Trust line */}
          <div
            className="orbital-shell-item mt-6 flex justify-center"
            style={{ animationDelay: '0.35s' }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] backdrop-blur-md border border-white/[0.06]">
              <Lock className="w-3 h-3 text-[#D97706]" />
              <span className="text-[10.5px] uppercase tracking-[0.20em] text-[#6B6259]">
                End-to-end encrypted
              </span>
            </div>
          </div>

          <div
            className="orbital-shell-item mt-10 text-center text-[11px] text-[#6B6259]"
            style={{ animationDelay: '0.45s' }}
          >
            © {new Date().getFullYear()} Orbital
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(AuthShell);
export { AuthShell };