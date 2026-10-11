/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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

  const variantStyles = {
    primary:
      'bg-[#B45309] hover:bg-[#92400E] text-[#FFFFFF] shadow-xs active:bg-[#78350F] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B45309]',
    secondary:
      'bg-[#FFFFFF] hover:bg-[#F6F4EF] text-[#0F0D0A] border-[1.5px] border-[rgba(15,13,10,0.15)] shadow-xs active:bg-[#EDEAE3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F0D0A]',
    ghost:
      'bg-transparent hover:bg-[rgba(15,13,10,0.06)] text-[#57534E] active:bg-[rgba(15,13,10,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#57534E]',
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className={`h-11 w-full rounded-lg px-4 text-sm font-medium transition-colors duration-150 inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 select-none ${variantStyles[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin text-current shrink-0" />}
      <span>{children}</span>
    </button>
  );
}

export default AuthButton;
export { AuthButton };
