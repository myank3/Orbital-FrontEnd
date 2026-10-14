/**
 * Orbital service worker.
 *
 * Bump SW_VERSION on every deploy that changes cached content.
 * The new version triggers:
 *   1. Chrome detects sw.js changed
 *   2. New SW installs
 *   3. Activate deletes every cache except the current one
 *   4. Old caches are gone, new ones are used
 *
 * If you forget to bump this, clients will keep running old JS.
 */

const SW_VERSION = 'v2';
const CACHE_NAME = `orbital-${SW_VERSION}`;

/* ────────────────────────────────────────────────────────── */
/* Install — take over immediately                            */
/* ────────────────────────────────────────────────────────── */

self.addEventListener('install', () => {
  self.skipWaiting();
});

/* ────────────────────────────────────────────────────────── */
/* Activate — delete old caches, claim all clients            */
/* ────────────────────────────────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Wipe any cache that doesn't match the current version
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );

      // Take over all open tabs immediately
      await self.clients.claim();
    })(),
  );
});

/* ────────────────────────────────────────────────────────── */
/* Fetch — network-first, cache fallback                      */
/* ────────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ignore cross-origin requests (fonts, external APIs, etc.)
  if (url.origin !== self.location.origin) return;

  // ── Rule 1: never cache HTML ─────────────────────────────
  // The HTML file references content-hashed JS/CSS bundles.
  // Caching it would leave clients pinned to old bundle names.
  const isDocument =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname === '/index.html';

  if (isDocument) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    );
    return;
  }

  // ── Rule 2: everything else is network-first, cached on success ──
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful, same-origin responses
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone))
            .catch(() => {
              /* quota or put failure — ignore */
            });
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});