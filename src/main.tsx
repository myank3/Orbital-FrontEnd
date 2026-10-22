import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initAuthToken } from './services/api';

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

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

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

        setInterval(
          () => {
            registration.update().catch(() => {});
          },
          30 * 60 * 1000,
        );
      })
      .catch((err) => {
        console.warn('[SW] registration failed', err);
      });
  });
}

async function startApp() {
  // Load native token before rendering to prevent premature logouts
  await initAuthToken();

  const el = document.getElementById('root');
  if (!el) {
    throw new Error('Missing #root element in index.html');
  }

  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void startApp();