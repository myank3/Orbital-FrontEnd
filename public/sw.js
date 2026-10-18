/**
 * Orbital service worker.
 *
 * Bump SW_VERSION on every deploy that changes cached content OR adds new
 * event handlers. The new version triggers:
 *   1. Chrome detects sw.js changed
 *   2. New SW installs
 *   3. Activate deletes every cache except the current one
 *   4. Old caches are gone, new ones are used
 *
 * If you forget to bump this, clients will keep running old JS — and in
 * particular, the new `notificationclick` handler below will never fire.
 */

const SW_VERSION = 'v4'; // ← bumped from v3 (notificationclick added)
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
      fetch(event.request).catch(async () => {
        // SPA fallback — serve the app shell so the client router
        // can resolve the route. Never return undefined from a
        // respondWith() promise: the browser throws
        // "Failed to convert value to 'Response'".
        const cached = await caches.match('/index.html');
        if (cached) return cached;

        return new Response('Offline', {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain' },
        });
      }),
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
      .catch(async () => {
        const cached = await caches.match(event.request);
        // Always return a Response — never undefined.
        return (
          cached ??
          new Response('', {
            status: 504,
            statusText: 'Gateway Timeout',
          })
        );
      }),
  );
});

/* ────────────────────────────────────────────────────────── */
/* Notification click — focus tab + SPA-navigate              */
/* ────────────────────────────────────────────────────────── */
//
// Fires when the user taps a browser notification shown by
// `registration.showNotification(...)` from `serviceWorker.ts`.
//
// The notification is created with `data: { url: '/app/dm/<id>' }`.
// We try to focus an existing Orbital tab and post a NAVIGATE
// message so the SPA router can jump to that route without a full
// page reload. If no tab is open, we open a new window at the URL.

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const urlToOpen = typeof data.url === 'string' ? data.url : '/app';

  event.waitUntil(
    (async () => {
      // 1) Look for an existing window client on the same origin.
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            // Focus the tab and ask the SPA to navigate.
            await client.focus();
            client.postMessage({ type: 'NAVIGATE', url: urlToOpen });
            return;
          }
        } catch {
          /* malformed client URL — try next */
        }
      }

      // 2) No existing tab — open a new one at the target route.
      if (self.clients.openWindow) {
        await self.clients.openWindow(urlToOpen);
      }
    })(),
  );
});