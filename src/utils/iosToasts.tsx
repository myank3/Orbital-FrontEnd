/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { toast } from 'sonner';
import { PhoneOff, MessageCircle, X } from 'lucide-react';

export function showOfflineCallToast(
  peerName?: string,
  onMessageClick?: () => void,
) {
  const displayName = (peerName || 'User').trim();
  const initial = displayName.charAt(0).toUpperCase();

  toast.custom(
    (t) => (
      <div className="w-[336px] max-w-[calc(100vw-24px)] rounded-[24px] bg-[#1C1C1E]/88 backdrop-blur-3xl border border-white/[0.16] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.18)] overflow-hidden">
        <div className="p-3.5 flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-full bg-white/[0.08] border border-white/[0.12] text-white/90 flex items-center justify-center shrink-0 text-[14px] font-semibold">
            {initial}
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#2C2C2E] border border-white/[0.14] flex items-center justify-center">
              <PhoneOff className="w-2.5 h-2.5 text-[#FF453A]" />
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-white tracking-[-0.015em] truncate">
              {displayName} is offline
            </p>
            <p className="text-[11.5px] text-white/55 mt-0.5 truncate">
              Unavailable for calls right now
            </p>
          </div>

          {onMessageClick ? (
            <button
              type="button"
              onClick={() => {
                toast.dismiss(t);
                onMessageClick();
              }}
              className="h-8 px-3 rounded-full bg-[#FBBF24] hover:bg-[#FCD34D] active:scale-95 text-[#140E02] text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0 transition-all shadow-[0_4px_14px_-4px_rgba(251,191,36,0.6)]"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Message</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => toast.dismiss(t)}
              aria-label="Dismiss"
              className="w-7 h-7 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center text-white/60 hover:text-white shrink-0 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    ),
    { duration: 3600 },
  );
}