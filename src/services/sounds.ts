/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

export function unlockSounds(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

export function setSoundsMuted(v: boolean): void {
  muted = v;
}

export function isSoundsMuted(): boolean {
  return muted;
}

interface ToneOptions {
  freq: number;
  durationMs?: number;
  volume?: number;
  type?: OscillatorType;
  delayMs?: number;
}

function playTone({
  freq,
  durationMs = 120,
  volume = 0.08,
  type = 'sine',
  delayMs = 0,
}: ToneOptions): void {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});

  const start = c.currentTime + delayMs / 1000;
  const dur = durationMs / 1000;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + dur);
}

/** Soft two-note ping for received messages. */
export function playReceive(): void {
  playTone({ freq: 880, durationMs: 90, volume: 0.06 });
  playTone({ freq: 1174, durationMs: 140, volume: 0.05, delayMs: 80 });
}

/** Single quiet click when you send a message. */
export function playSend(): void {
  playTone({ freq: 660, durationMs: 60, volume: 0.035 });
}

/** Gentle notification tone. */
export function playNotify(): void {
  playTone({ freq: 740, durationMs: 180, volume: 0.06 });
}

/** Rising two-note for success. */
export function playSuccess(): void {
  playTone({ freq: 660, durationMs: 100, volume: 0.06 });
  playTone({ freq: 990, durationMs: 160, volume: 0.05, delayMs: 90 });
}

/** Descending two-note for errors. */
export function playError(): void {
  playTone({ freq: 440, durationMs: 120, volume: 0.06, type: 'triangle' });
  playTone({ freq: 330, durationMs: 180, volume: 0.05, type: 'triangle', delayMs: 100 });
}