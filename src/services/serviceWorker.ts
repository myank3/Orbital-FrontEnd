/**
 * Service-worker registration + browser-notification helper.
 *
 * Why we use ServiceWorkerRegistration.showNotification() instead of
 * `new Notification()`:
 *
 *   • Android Chrome throws `TypeError: Illegal constructor` when you
 *     call `new Notification()` — the SW path is the ONLY way to show
 *     notifications on Android.
 *   • iOS Safari (16.4+) only supports notifications for PWAs added to
 *     the home screen, and again only via the SW path.
 *   • SW notifications get a proper `notificationclick` event, so we can
 *     focus the tab and SPA-navigate to the right chat without a reload.
 *   • `tag` collapses notifications from the same sender (WhatsApp-style).
 *   • `data` payload is delivered intact to `notificationclick`, letting
 *     us route to `/app/dm/<senderId>`.
 *
 * The service worker (`public/sw.js`) must define a `notificationclick`
 * handler that reads `event.notification.data.url`. See `sw.js`.
 */

/**
 * Register `/sw.js` once. Idempotent — safe to call on every mount.
 */
export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[SW] registration failed:', err);
  }
}

/**
 * Resolve the active ServiceWorkerRegistration with a timeout so callers
 * never hang if the SW hasn't finished installing yet (e.g. on the very
 * first page load after a deploy).
 */
export async function getServiceWorkerRegistration(
  timeoutMs = 3000,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  try {
    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(
        () => reject(new Error('SW ready timeout')),
        timeoutMs,
      ),
    );
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } catch {
    return null;
  }
}

export interface ShowDmNotificationOptions {
  senderId: string;
  senderName: string;
  preview: string;
  avatarUrl?: string | null;
}

/**
 * Show a DM browser notification.
 *
 * Preferred path: `registration.showNotification()` — works on Android
 * Chrome and installed iOS PWAs; click is handled by the SW.
 *
 * Fallback: `new Notification()` — desktop browsers where the SW isn't
 * registered yet; click is handled here.
 */
export async function showDmNotification(
  opts: ShowDmNotificationOptions,
): Promise<void> {
  const { senderId, senderName, preview, avatarUrl } = opts;
  const url = `/app/dm/${senderId}`;

  // ── Preferred: ServiceWorker.showNotification() ──────────
  try {
    const reg = await getServiceWorkerRegistration();
    if (reg) {
      await reg.showNotification(senderName, {
        body: preview,
        icon: avatarUrl ?? '/favicon-192.png',
        badge: '/favicon-192.png',
        tag: `dm-${senderId}`, // replaces prior notifications from same sender
        data: { url, senderId }, // consumed by SW notificationclick
        // @ts-expect-error vibrate is non-standard but works on Android
        vibrate: [180, 80, 180],
        requireInteraction: false,
      });
      return;
    }
  } catch (err) {
    console.warn('[Notification] SW showNotification failed:', err);
  }

  // ── Fallback: window Notification (desktop-only) ─────────
  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      const n = new Notification(senderName, {
        body: preview,
        icon: avatarUrl ?? undefined,
        tag: `dm-${senderId}`,
      });
      n.onclick = () => {
        try {
          window.focus();
          if (window.location.pathname !== url) {
            window.location.href = url;
          }
        } finally {
          n.close();
        }
      };
    }
  } catch (err) {
    console.warn('[Notification] window Notification failed:', err);
  }
}