/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo } from 'react';
import { Loader2 } from 'lucide-react';

export interface AuthButtonProps {
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  type?: 'button' | 'submit' | 'reset';
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const BUTTON_VARIANTS = {
  primary:
    'bg-gradient-to-b from-amber-300 to-amber-500 text-[#150E03] ' +
    'shadow-[0_10px_36px_-14px_rgba(200,136,58,0.85),inset_0_1px_0_rgba(255,255,255,0.30)] ' +
    'hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-14px_rgba(200,136,58,1),inset_0_1px_0_rgba(255,255,255,0.40)] ' +
    'active:translate-y-0 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70',
  secondary:
    'bg-white/[0.04] hover:bg-white/[0.08] text-[#EDE5D4] ' +
    'border border-white/[0.10] hover:border-white/[0.18] ' +
    'active:bg-white/[0.12] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
  ghost:
    'bg-transparent hover:bg-white/[0.04] text-[#A8A29E] hover:text-[#EDE5D4] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
} as const;

const BUTTON_CSS = `
  .orbital-btn {
    transition: all 300ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform;
  }
  .orbital-btn:active:not(:disabled) {
    transform: scale3d(0.98, 0.98, 1);
  }
  .orbital-btn:disabled {
    transform: none;
    will-change: auto;
  }
  @keyframes orbital-btn-spin {
    to { transform: rotate(360deg); }
  }
  .orbital-btn-spinner {
    animation: orbital-btn-spin 700ms linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .orbital-btn { transition: none !important; }
    .orbital-btn:active:not(:disabled) { transform: none !important; }
    .orbital-btn-spinner { animation-duration: 1.4s; }
  }
`;

function AuthButton({
  children,
  loading = false,
  disabled = false,
  variant = 'primary',
  type = 'button',
  onClick,
  className = '',
}: AuthButtonProps): React.JSX.Element {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className={
        'orbital-btn h-11 w-full rounded-xl px-6 py-3.5 text-[13.5px] font-semibold tracking-[-0.01em] ' +
        'inline-flex items-center justify-center gap-2 cursor-pointer ' +
        'disabled:cursor-not-allowed disabled:opacity-50 select-none ' +
        BUTTON_VARIANTS[variant] + ' ' + className
      }
    >
      <style>{BUTTON_CSS}</style>
      {loading && <Loader2 className="orbital-btn-spinner h-4 w-4 text-current shrink-0" />}
      <span>{children}</span>
    </button>
  );
}

export default memo(AuthButton);
export { AuthButton };