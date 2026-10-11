/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Attaches a remote MediaStream to a hidden <audio> element.
 * Solves:
 *   1. Chrome 140 bug where audio from a MediaStream on <video> is silent
 *   2. Muted-by-default <video> elements
 *   3. Autoplay blocks by resuming on first user gesture
 */

import { useEffect, useRef } from 'react';

export function useRemoteAudio(stream: MediaStream | null) {
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Create the element once
    if (!audioElRef.current) {
      const el = new Audio();
      el.autoplay = true;
      el.volume = 1;
      // @ts-expect-error — playsInline isn't in all TS DOM libs for audio
      el.playsInline = true;
      // Keep it in the DOM so autoplay policies apply consistently
      el.style.display = 'none';
      document.body.appendChild(el);
      audioElRef.current = el;
    }

    const el = audioElRef.current;
    if (!el) return;

    if (!stream) {
      el.srcObject = null;
      return;
    }

    // Only attach audio tracks — the <video> element handles video
    const audioOnly = new MediaStream(stream.getAudioTracks());
    if (audioOnly.getAudioTracks().length === 0) return;

    el.srcObject = audioOnly;
    el.muted = false;
    el.volume = 1;

    const tryPlay = () => {
      el.play().catch((err) => {
        console.warn('[Call] Remote audio autoplay blocked, waiting for gesture:', err);

        const resume = () => {
          el.play().catch(() => {});
          window.removeEventListener('click', resume);
          window.removeEventListener('keydown', resume);
          window.removeEventListener('touchstart', resume);
        };
        window.addEventListener('click', resume, { once: true });
        window.addEventListener('keydown', resume, { once: true });
        window.addEventListener('touchstart', resume, { once: true });
      });
    };

    tryPlay();

    return () => {
      // Detach tracks from this element when the stream changes
      el.srcObject = null;
    };
  }, [stream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const el = audioElRef.current;
      if (!el) return;
      el.pause();
      el.srcObject = null;
      el.remove();
      audioElRef.current = null;
    };
  }, []);
}