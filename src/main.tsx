import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

/* ──────────────────────────────────────────────────────────
   Mobile: block the native Android long-press context menu.
   Runs before React mounts so it catches every touch from
   the very first frame. Desktop and form fields are exempt.
   ────────────────────────────────────────────────────────── */

if (typeof window !== 'undefined') {
  const isTouchDevice =
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window;

  if (isTouchDevice) {
    // Cancel the `contextmenu` event on everything except inputs.
    document.addEventListener(
      'contextmenu',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true },
    );

    // Android WebView also emits a non-standard `longpress` event
    // before the system menu appears. Block that too.
    document.addEventListener(
      'longpress',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
      } as EventListener,
      { capture: true },
    );

    // Also block selection on drag-select of non-input elements.
    // This covers the "text becomes highlighted blue" case.
    document.addEventListener(
      'selectstart',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('input, textarea, [contenteditable="true"]')) return;
        e.preventDefault();
      },
      { capture: true },
    );
  }
}

const el = document.getElementById('root');
if (!el) {
  throw new Error('Missing #root element in index.html');
}

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);