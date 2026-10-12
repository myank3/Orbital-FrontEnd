/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { signalRService } from '../services/signalr';

export function ConnectionBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    let graceTimer: number | null = null;

    const check = () => {
      const connected = signalRService.isConnected();
      if (connected) {
        if (graceTimer != null) {
          window.clearTimeout(graceTimer);
          graceTimer = null;
        }
        setShowBanner(false);
      } else {
        if (graceTimer == null) {
          graceTimer = window.setTimeout(() => {
            setShowBanner(true);
            graceTimer = null;
          }, 3000);
        }
      }
    };

    check();
    const id = window.setInterval(check, 1500);
    return () => {
      window.clearInterval(id);
      if (graceTimer != null) window.clearTimeout(graceTimer);
    };
  }, []);

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] pointer-events-none"
        >
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#1A1816]/95 backdrop-blur-xl border border-[#D97706]/30 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.85)] pointer-events-auto">
            <WifiOff className="w-3.5 h-3.5 text-[#D97706]" />
            <span className="text-[12px] text-[#EDE5D4] font-medium">
              Reconnecting…
            </span>
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
              className="inline-flex"
            >
              <RefreshCw className="w-3 h-3 text-[#A8A29E]" />
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ConnectionBanner;