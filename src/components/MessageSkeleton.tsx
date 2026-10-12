/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';

function Bubble({
  side,
  widthPercent,
  delay,
}: {
  side: 'left' | 'right';
  widthPercent: number;
  delay: number;
}) {
  return (
    <div
      className={`flex gap-3 px-1 mt-4 ${
        side === 'right' ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      <div className="w-9 shrink-0 pt-0.5">
        <motion.div
          initial={{ opacity: 0.3 }}
          animate={{ opacity: [0.3, 0.55, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity, delay }}
          className="w-8 h-8 rounded-full bg-white/[0.06]"
        />
      </div>

      <div
        className={`flex flex-col ${side === 'right' ? 'items-end' : 'items-start'}`}
      >
        <motion.div
          initial={{ opacity: 0.3 }}
          animate={{ opacity: [0.3, 0.55, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: delay + 0.05 }}
          className={`h-3 rounded bg-white/[0.05] mb-1 ${
            side === 'right' ? 'w-20' : 'w-24'
          }`}
        />
        <motion.div
          initial={{ opacity: 0.3 }}
          animate={{ opacity: [0.3, 0.55, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: delay + 0.1 }}
          className="h-9 rounded-2xl bg-white/[0.06]"
          style={{ width: `${widthPercent}%`, maxWidth: 320, minWidth: 120 }}
        />
      </div>
    </div>
  );
}

export function MessageSkeleton() {
  const pattern: Array<{ side: 'left' | 'right'; width: number }> = [
    { side: 'left', width: 45 },
    { side: 'right', width: 55 },
    { side: 'left', width: 40 },
    { side: 'right', width: 35 },
    { side: 'left', width: 60 },
  ];

  return (
    <div className="py-3">
      {pattern.map((p, i) => (
        <Bubble key={i} side={p.side} widthPercent={p.width} delay={i * 0.08} />
      ))}
    </div>
  );
}

export default MessageSkeleton;