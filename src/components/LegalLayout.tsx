/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Legal page shell. Shared by /terms and /privacy.
 *
 * ⚡ No framer-motion. CSS-only, zero runtime. Sticky TOC via
 *    CSS position: sticky — no JS scroll listeners.
 */

import React, { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';

const SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';

const LEGAL_CSS = `
  /* ────────────── prose typography ────────────── */
  .legal-prose h2 {
    font-family: ${SERIF};
    font-size: 22px;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: #EDE5D4;
    margin-top: 2.75rem;
    margin-bottom: 0.875rem;
    scroll-margin-top: 6rem;
  }
  .legal-prose h2:first-child { margin-top: 0; }

  .legal-prose h3 {
    font-size: 14.5px;
    font-weight: 600;
    color: #EDE5D4;
    margin-top: 1.75rem;
    margin-bottom: 0.5rem;
    letter-spacing: -0.005em;
  }

  .legal-prose p {
    font-size: 14.5px;
    line-height: 1.75;
    color: #C9C1B3;
    margin-bottom: 1rem;
  }

  .legal-prose ul,
  .legal-prose ol {
    font-size: 14.5px;
    line-height: 1.75;
    color: #C9C1B3;
    margin-bottom: 1rem;
    padding-left: 1.375rem;
  }
  .legal-prose ul { list-style: disc; }
  .legal-prose ol { list-style: decimal; }
  .legal-prose li { margin-bottom: 0.375rem; }
  .legal-prose li::marker { color: #7A6F65; }

  .legal-prose a {
    color: #D97706;
    text-decoration: underline;
    text-decoration-color: rgba(217, 119, 6, 0.35);
    text-underline-offset: 2px;
    transition: text-decoration-color 120ms linear, color 120ms linear;
  }
  .legal-prose a:hover {
    color: #F59E0B;
    text-decoration-color: #F59E0B;
  }

  .legal-prose strong { color: #EDE5D4; font-weight: 600; }

  .legal-prose code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88em;
    background: rgba(255, 255, 255, 0.055);
    padding: 1.5px 5px;
    border-radius: 4px;
    color: #F59E0B;
  }

  .legal-prose table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.25rem 0;
    font-size: 13px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    overflow: hidden;
  }
  .legal-prose th,
  .legal-prose td {
    padding: 9px 12px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    color: #C9C1B3;
    line-height: 1.5;
    vertical-align: top;
  }
  .legal-prose tr:last-child td { border-bottom: none; }
  .legal-prose th {
    font-weight: 600;
    color: #EDE5D4;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: rgba(255, 255, 255, 0.025);
  }

  /* ────────────── TOC active indicator ────────────── */
  .legal-toc-link {
    display: block;
    padding-left: 12px;
    margin-left: -1px;
    border-left: 1px solid transparent;
    color: #A8A29E;
    font-size: 12.5px;
    line-height: 1.4;
    transition: color 120ms linear, border-color 120ms linear;
  }
  .legal-toc-link:hover {
    color: #D97706;
    border-left-color: #D97706;
  }
`;

export interface LegalSection {
  id: string;
  title: string;
}

export interface LegalLayoutProps {
  title: string;
  subtitle: string;
  lastUpdated: string;
  sections: LegalSection[];
  children: ReactNode;
}

export function LegalLayout({
  title,
  subtitle,
  lastUpdated,
  sections,
  children,
}: LegalLayoutProps): React.JSX.Element {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[#0F0D0A] text-[#EDE5D4]">
      <style>{LEGAL_CSS}</style>

      {/* ─── Header ──────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-[#0F0D0A]/85 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link
            to="/register"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors"
          >
            <ArrowLeft size={13} />
            Back
          </Link>

          <Link to="/" className="inline-flex items-baseline gap-1.5 select-none">
            <span
              className="text-[19px] leading-none text-[#EDE5D4]"
              style={{ fontFamily: SERIF }}
            >
              Orbital
            </span>
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-3px] shadow-[0_0_10px_rgba(217,119,6,0.7)]"
            />
          </Link>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────────── */}
      <div className="border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.20em] text-[#7A6F65] font-mono mb-3">
            <FileText className="w-3 h-3" />
            Legal
          </div>
          <h1
            className="text-[32px] sm:text-[42px] leading-[1.1] tracking-tight text-[#EDE5D4]"
            style={{ fontFamily: SERIF }}
          >
            {title}
          </h1>
          <p className="mt-3 text-[14px] text-[#A8A29E] max-w-xl leading-relaxed">
            {subtitle}
          </p>
          <p className="mt-5 text-[11px] text-[#5A524A] font-mono uppercase tracking-[0.16em]">
            Last updated · {lastUpdated}
          </p>
        </div>
      </div>

      {/* ─── Body ────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-14">
          {/* TOC */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            {/* mobile: collapsible */}
            <details className="lg:hidden rounded-xl border border-white/[0.08] bg-[#14120F] overflow-hidden">
              <summary className="px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-[#A8A29E] font-mono cursor-pointer hover:text-[#EDE5D4] transition-colors">
                Contents
              </summary>
              <ul className="px-4 pb-4 pt-1 space-y-2">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-[12.5px] text-[#A8A29E] hover:text-[#D97706] transition-colors"
                    >
                      <span className="text-[#5A524A] font-mono mr-1.5">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>

            {/* desktop: sticky sidebar */}
            <nav className="hidden lg:block">
              <p className="text-[10px] uppercase tracking-[0.20em] text-[#5A524A] font-mono mb-3">
                Contents
              </p>
              <ul className="space-y-2.5 border-l border-white/[0.06]">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="legal-toc-link">
                      <span className="text-[#5A524A] font-mono mr-1.5">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Prose */}
          <article className="min-w-0 legal-prose">
            {children}

            <div className="mt-14 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-[12px] text-[#5A524A]">
                Questions?{' '}
                <a href="mailto:prolium7@outlook.com">Contact support</a>
              </p>
              <Link
                to="/register"
                className="text-[12.5px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors"
              >
                Back to sign up
              </Link>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

export default LegalLayout;