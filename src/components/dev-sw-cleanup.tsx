'use client';

import { useEffect } from 'react';

const RELOAD_FLAG = '__spillwaySwCleared__';

/**
 * Development-only: tears down any service worker left over from a production
 * build, and the caches it installed.
 *
 * next-pwa's `disable: NODE_ENV === 'development'` only stops a NEW worker being
 * generated — it does nothing about one already installed in the browser. A
 * lingering worker keeps serving the hashed production chunks it precached, and
 * because those files do not exist in a dev build, webpack ends up calling an
 * undefined module factory. That surfaces as the deeply unhelpful
 * "Cannot read properties of undefined (reading 'call')", and it survives
 * deleting .next entirely, because the stale copy lives in the browser.
 *
 * Renders nothing and is inert in production, where the PWA is wanted.
 */
export function DevServiceWorkerCleanup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (cancelled || registrations.length === 0) return;

        await Promise.all(registrations.map((r) => r.unregister()));

        // The worker is gone but its Cache Storage entries are not, and they are
        // what actually hold the stale chunks.
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }

        // One reload to pick up real dev chunks. sessionStorage guards against a
        // loop if anything re-registers a worker.
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          console.warn(
            '[dev] Removed a stale service worker and its caches (left behind by a ' +
              'production build). Reloading once to pick up fresh chunks.'
          );
          window.location.reload();
        }
      } catch (error) {
        console.error('[dev] Could not clear the stale service worker.', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
