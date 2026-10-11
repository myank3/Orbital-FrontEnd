/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  isOnline?: boolean;
  className?: string;
}

export function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  const first = parts[0][0] ?? '';
  const second = parts[parts.length - 1][0] ?? '';
  return `${first}${second}`.toUpperCase();
}

// Read the same env var api.ts uses — but do NOT import from api.ts.
// Importing from there creates a module cycle that crashes Vite.
const API_ORIGIN: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://orbital.runasp.net';

/** Turn "/avatars/abc.png" into "https://orbital.runasp.net/avatars/abc.png". */
function resolveAvatarUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('data:') ||
    raw.startsWith('blob:')
  ) {
    return raw;
  }
  const base = API_ORIGIN.replace(/\/+$/, '');
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

const sizeConfig: Record<
  AvatarSize,
  {
    container: string;
    text: string;
    badge: string;
    badgePosition: string;
  }
> = {
  sm: {
    container: 'w-8 h-8 rounded-full',
    text: 'text-xs',
    badge: 'w-2 h-2',
    badgePosition: '-bottom-0.5 -right-0.5 ring-[1.5px]',
  },
  md: {
    container: 'w-10 h-10 rounded-full',
    text: 'text-sm',
    badge: 'w-2.5 h-2.5',
    badgePosition: 'bottom-0 right-0 ring-2',
  },
  lg: {
    container: 'w-12 h-12 rounded-full',
    text: 'text-base',
    badge: 'w-3 h-3',
    badgePosition: 'bottom-0.5 right-0.5 ring-2',
  },
  xl: {
    container: 'w-16 h-16 rounded-full',
    text: 'text-xl',
    badge: 'w-3.5 h-3.5',
    badgePosition: 'bottom-1 right-1 ring-2',
  },
};

function Avatar({
  name,
  src,
  size = 'md',
  isOnline,
  className = '',
}: AvatarProps): React.JSX.Element {
  const [imageError, setImageError] = useState(false);
  const initials = getInitials(name);
  const cfg = sizeConfig[size] ?? sizeConfig.md;

  const resolvedSrc = resolveAvatarUrl(src);
  const showImage = Boolean(resolvedSrc) && !imageError;

  // Reset the error flag whenever the src changes. Without this, a
  // single 404 poisons the component forever — new uploads won't show.
  useEffect(() => {
    setImageError(false);
  }, [resolvedSrc]);

  return (
    <div className={`relative inline-flex shrink-0 select-none ${className}`}>
      <div
        className={`${cfg.container} overflow-hidden flex items-center justify-center border-[1.5px] border-[rgba(15,13,10,0.15)] bg-[#EDEAE3] text-[#0F0D0A] font-mono font-medium`}
      >
        {showImage ? (
          <img
            src={resolvedSrc}
            alt={name}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className={cfg.text}>{initials}</span>
        )}
      </div>

      {typeof isOnline === 'boolean' && (
        <span
          className={`absolute rounded-full ring-[#FFFFFF] ${cfg.badge} ${cfg.badgePosition} ${
            isOnline ? 'bg-[#15803D]' : 'bg-[#A8A29E]'
          }`}
          aria-label={isOnline ? 'Online' : 'Offline'}
          title={isOnline ? 'Online' : 'Offline'}
        />
      )}
    </div>
  );
}

export default Avatar;
export { Avatar };