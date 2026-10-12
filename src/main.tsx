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

const el = document.getElementById('root');
if (!el) {
  throw new Error('Missing #root element in index.html');
}

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);