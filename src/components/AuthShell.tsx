/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ShieldCheck, Zap, Sparkles } from 'lucide-react';

export interface AuthShellProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  hideBack?: boolean;
}

const SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';

const SHELL_CSS = `
  @keyframes orbital-shell-fade-up {
    from { opacity: 0; transform: translate3d(0, 15px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  .orbital-shell-item { 
    animation: orbital-shell-fade-up 400ms cubic-bezier(0.16, 1, 0.3, 1) backwards; 
    backface-visibility: hidden; 
  }

  @keyframes orbital-blob-drift {
    0%   { transform: translate3d(0, 0, 0) scale(1); opacity: 0.8; }
    33%  { transform: translate3d(30px, -50px, 0) scale(1.1); opacity: 1; }
    66%  { transform: translate3d(-20px, 20px, 0) scale(0.9); opacity: 0.6; }
    100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.8; }
  }
  .orbital-blob { 
    animation: orbital-blob-drift 18s ease-in-out infinite; 
    will-change: transform, opacity; 
  }
  
  @keyframes orbital-dot-pulse {
    0%, 100% { box-shadow: 0 0 12px rgba(200,136,58,0.6); transform: scale(1); }
    50% { box-shadow: 0 0 20px rgba(200,136,58,1); transform: scale(1.1); }
  }
  .orbital-dot { animation: orbital-dot-pulse 3s ease-in-out infinite; }

  /* iOS auto-zoom fix */
  @media (max-width: 1024px) {
    input, textarea, select { font-size: 16px !important; }
  }

  /* Mobile performance pass */
  @media (hover: none) and (pointer: coarse) {
    .orbital-auth-card {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      background: rgba(19, 17, 16, 0.95) !important;
    }
    .orbital-blob {
      animation: none !important;
    }
    .orbital-shell-item {
      animation-duration: 300ms;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .orbital-shell-item, .orbital-blob, .orbital-dot { animation: none !important; }
  }
`;

const BENEFITS = [
  { icon: <ShieldCheck className="w-4 h-4" />, title: 'End-to-end encrypted', body: 'Messages and calls stay private to you.' },
  { icon: <Zap className="w-4 h-4" />, title: 'Real-time everything', body: 'Group chats and HD calls, instantly.' },
  { icon: <Sparkles className="w-4 h-4" />, title: 'No ads. Ever.', body: 'We don’t sell your data. That’s the promise.' },
];

function AuthShell({ children, title, subtitle, hideBack = false }: AuthShellProps): React.JSX.Element {
  return (
    <div className="min-h-[100dvh] bg-[#04060A] text-[#EDE5D4] relative overflow-y-auto flex items-start lg:items-center justify-center p-4 lg:p-6 py-8 lg:py-6 font-sans selection:bg-amber-400/30">
      <style>{SHELL_CSS}</style>

      {/* Background Ambient Glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[800px] h-[800px]">
          <div className="orbital-blob w-full h-full rounded-full" style={{ background: 'radial-gradient(circle, rgba(200,136,58,0.12) 0%, rgba(200,136,58,0) 70%)', filter: 'blur(100px)' }} />
        </div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px]">
          <div className="orbital-blob w-full h-full rounded-full" style={{ background: 'radial-gradient(circle, rgba(139,111,71,0.08) 0%, rgba(139,111,71,0) 70%)', filter: 'blur(100px)', animationDelay: '2s' }} />
        </div>
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 mix-blend-screen" />

      {/* Main Split Card */}
      <div className="orbital-auth-card relative w-full max-w-[1100px] z-10 grid lg:grid-cols-[1fr_1.1fr] rounded-[2.5rem] bg-[#131110]/70 backdrop-blur-3xl border border-white/[0.08] shadow-[0_30px_100px_-20px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.05)] overflow-hidden my-auto">
        
        {/* ─── LEFT PANEL (Brand/Features) ─── */}
        <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-[#1A1714]/90 to-[#0F0D0A]/95 border-r border-white/[0.04] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
          
          <div className="relative z-10">
            <Link to="/" className="inline-flex items-baseline gap-2 select-none group mb-6">
              <span className="text-[32px] leading-none text-[#EDE5D4] tracking-tight transition-colors duration-100 group-hover:text-[#D97706] drop-shadow-[0_0_15px_rgba(237,229,212,0.15)]" style={{ fontFamily: SERIF }}>
                Orbital
              </span>
              <span aria-hidden className="orbital-dot w-2 h-2 rounded-full bg-[#C8883A] inline-block translate-y-[-5px]" />
            </Link>
            <p className="text-[14px] text-[#A8A29E] max-w-[280px] leading-relaxed">
              Private conversations, on your terms.
            </p>
          </div>

          <div className="relative z-10 space-y-6 my-8">
            {BENEFITS.map((b, i) => (
              <div key={b.title} className="flex items-start gap-3.5">
                <span className="w-8 h-8 rounded-lg bg-[#D97706]/10 ring-1 ring-inset ring-[#D97706]/20 text-[#D97706] grid place-items-center shrink-0">
                  {b.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] text-[#EDE5D4] font-medium">{b.title}</div>
                  <div className="text-[12.5px] text-[#78716C] mt-1 leading-relaxed">{b.body}</div>
                </div>
              </div>
            ))}
          </div>

          <p className="relative z-10 text-[11.5px] text-[#6B6259]">
            © {new Date().getFullYear()} Orbital · Private &amp; Direct
          </p>
        </div>

        {/* ─── RIGHT PANEL (Form) ─── */}
        <div className="relative p-8 sm:p-12 lg:p-14 flex flex-col justify-center">
          
          {/* Mobile Logo & Back */}
          <div className="absolute top-6 left-6 right-6 flex items-center justify-between lg:justify-end z-10">
            <Link to="/" className="lg:hidden inline-flex items-baseline gap-1.5 select-none">
              <span className="text-[24px] leading-none text-[#EDE5D4] tracking-tight" style={{ fontFamily: SERIF }}>Orbital</span>
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-[#C8883A] inline-block translate-y-[-3px]" />
            </Link>
            {!hideBack && (
              <Link to="/" className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors" title="Back to home">
                <ChevronLeft size={16} />
              </Link>
            )}
          </div>

          <div className="mb-8 mt-6 lg:mt-0">
            <h1 className="text-[26px] sm:text-[28px] leading-[1.2] tracking-[-0.01em] text-[#EDE5D4] font-medium">
              {title}
            </h1>
            {subtitle && <p className="mt-2 text-[14px] text-[#A8A29E] leading-[1.6]">{subtitle}</p>}
          </div>

          {children}
          
        </div>
      </div>
    </div>
  );
}

export default memo(AuthShell);
export { AuthShell };