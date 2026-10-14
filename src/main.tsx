import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

if (typeof window !== 'undefined') {
  const isTouchDevice =
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window;

  if (isTouchDevice) {
    const shouldSkip = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      return !!el.closest('input, textarea, [contenteditable="true"]');
    };

    document.addEventListener(
      'contextmenu',
      (e: Event) => {
        if (shouldSkip(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true },
    );

    document.addEventListener(
      'selectstart',
      (e: Event) => {
        if (shouldSkip(e.target)) return;
        e.preventDefault();
      },
      { capture: true },
    );
  }
}

/* ────────────────────────────────────────────────────────── */
/* Service worker registration + auto-update                  */
/*                                                            */
/* Registers /sw.js. When a new SW version activates (because */
/* you bumped SW_VERSION in public/sw.js), we reload the page */
/* once so the user picks up the new JS bundle automatically. */
/*                                                            */
/* A session flag prevents an infinite reload loop if the SW  */
/* keeps reporting "activated" on every check.                */
/* ────────────────────────────────────────────────────────── */

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // If a new SW is already waiting, activate it right away
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // Listen for future updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              const KEY = 'orbital.sw.reloaded';
              if (!sessionStorage.getItem(KEY)) {
                sessionStorage.setItem(KEY, '1');
                window.location.reload();
              }
            }
          });
        });

        // Periodically check for SW updates every 30 minutes while tab is open
        setInterval(
          () => {
            registration.update().catch(() => {
              /* ignore */
            });
          },
          30 * 60 * 1000,
        );
      })
      .catch((err) => {
        console.warn('[SW] registration failed', err);
      });

    // Reload once when a fresh SW takes over an already-open tab

  });
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