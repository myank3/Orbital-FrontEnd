/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useCall } from '../context/CallContext';
import { Mic, MicOff, PhoneOff, Maximize2 } from 'lucide-react';

function DynamicIsland(): React.JSX.Element | null {
  const { session, isMinimized, isMuted, toggleMute, endCall, expand } = useCall();
  const [duration, setDuration] = useState<number>(0);

  useEffect(() => {
    if (!session || !isMinimized) {
      setDuration(0);
      return;
    }

    const timer = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [session, isMinimized]);

  const formattedTimer = useMemo(() => {
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, [duration]);

  if (!session || !isMinimized) {
    return null;
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 select-none animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="h-10 bg-[#FFFFFF] border-[1.5px] border-[rgba(15,13,10,0.15)] rounded-full px-4 shadow-md flex items-center space-x-3.5 hover:border-[#B45309]/50 transition-colors">
        {/* Click body to expand */}
        <button
          onClick={expand}
          className="flex items-center space-x-3 cursor-pointer group"
          title="Expand Call View"
        >
          {/* 5-bar animated audio wave */}
          <div className="flex items-center space-x-0.5 h-4">
            {[0, 1, 2, 3, 4].map((index) => (
              <motion.span
                key={index}
                className="w-1 bg-[#15803D] rounded-full inline-block"
                animate={{
                  height: ['4px', '14px', '6px', '16px', '4px'],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 1.1,
                  delay: index * 0.15,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          {/* Duration Timer */}
          <span className="font-mono text-xs font-semibold text-[#0F0D0A] tracking-wider">
            {formattedTimer}
          </span>

          <Maximize2 className="w-3.5 h-3.5 text-[#57534E] group-hover:text-[#B45309] transition-colors" />
        </button>

        {/* Divider */}
        <div className="h-4 w-px bg-[rgba(15,13,10,0.15)]" />

        {/* Quick Mute & End Buttons */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            className={`p-1.5 rounded-full text-xs transition-colors cursor-pointer ${
              isMuted
                ? 'bg-[#B91C1C] text-white'
                : 'text-[#57534E] hover:text-[#0F0D0A] hover:bg-black/5'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              void endCall();
            }}
            className="p-1.5 rounded-full bg-[#B91C1C] hover:bg-[#991B1B] text-white transition-colors cursor-pointer"
            title="End Call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default DynamicIsland;
export { DynamicIsland };
