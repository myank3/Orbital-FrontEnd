/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { AuthButton } from './AuthButton';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
  className = '',
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={`bg-[#F6F4EF] border-[1.5px] border-[rgba(15,13,10,0.15)] rounded-xl p-8 sm:p-10 text-center flex flex-col items-center justify-center ${className}`}
    >
      {/* Icon Container */}
      <div className="w-12 h-12 rounded-lg bg-[#EDEAE3] border border-[rgba(15,13,10,0.10)] flex items-center justify-center text-[#57534E] mb-4">
        <Icon className="w-6 h-6" />
      </div>

      {/* Typography */}
      <h3 className="font-serif text-xl sm:text-2xl text-[#0F0D0A] font-normal tracking-tight mb-2">
        {title}
      </h3>
      <p className="text-sm text-[#57534E] font-sans max-w-sm mx-auto leading-relaxed mb-6">
        {body}
      </p>

      {/* Optional Action Button */}
      {actionLabel && onAction && (
        <div className="w-full max-w-xs">
          <AuthButton variant="secondary" onClick={onAction}>
            {actionLabel}
          </AuthButton>
        </div>
      )}
    </div>
  );
}

export default EmptyState;
export { EmptyState };
