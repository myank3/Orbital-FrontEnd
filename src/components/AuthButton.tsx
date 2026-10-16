/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthButton — 144 Hz pass.
 * Motion is color + a 90ms scale3d press; both are compositor-friendly.
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
    'bg-[#B45309] hover:bg-[#92400E] text-white active:bg-[#78350F] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B45309]',
  secondary:
    'bg-white hover:bg-[#F6F4EF] text-[#0F0D0A] ' +
    'border-[1.5px] border-[rgba(15,13,10,0.15)] ' +
    'active:bg-[#EDEAE3] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F0D0A]',
  ghost:
    'bg-transparent hover:bg-[rgba(15,13,10,0.06)] text-[#57534E] ' +
    'active:bg-[rgba(15,13,10,0.10)] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#57534E]',
} as const;

const BUTTON_CSS = `
  .orbital-btn {
    transition:
      transform 90ms cubic-bezier(0.2, 0, 0, 1),
      background-color 120ms linear,
      border-color 120ms linear,
      color 120ms linear,
      opacity 110ms linear;
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
        'orbital-btn h-11 w-full rounded-lg px-4 text-sm font-medium ' +
        'inline-flex items-center justify-center gap-2 cursor-pointer ' +
        'disabled:cursor-not-allowed disabled:opacity-50 select-none ' +
        BUTTON_VARIANTS[variant] + ' ' + className
      }
    >
      <style>{BUTTON_CSS}</style>
      {loading && (
        <Loader2 className="orbital-btn-spinner h-4 w-4 text-current shrink-0" />
      )}
      <span>{children}</span>
    </button>
  );
}

export default memo(AuthButton);
export { AuthButton };