/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Programmatic ringtone using Web Audio API.
 * No audio files required.
 */

import { useEffect, useRef } from 'react';

type Options = {
  /** Oscillator frequency in Hz. */
  frequency?: number;
  /** Volume 0–1. */
  volume?: number;
  /** Length of each ring pulse in ms. */
  pulseMs?: number;
  /** Gap between pulses in ms. */
  gapMs?: number;
};

export function useRingtone(
  active: boolean,
  {
    frequency = 440,
    volume = 0.15,
    pulseMs = 1000,
    gapMs = 2000,
  }: Options = {},
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof window === 'undefined') return;

    // Lazy-create the AudioContext on first use (avoids autoplay warnings)
    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctxRef.current = new Ctx();
    }
    const ctx = ctxRef.current;

    // Browsers block audio until user interacts — resume on next gesture
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const pulse = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = frequency;

      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(volume, ctx.currentTime + pulseMs / 1000 - 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + pulseMs / 1000);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + pulseMs / 1000);
    };

    // Play immediately, then on interval
    pulse();
    timerRef.current = window.setInterval(pulse, pulseMs + gapMs);

    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, frequency, volume, pulseMs, gapMs]);

  // Close the context on unmount
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);
}