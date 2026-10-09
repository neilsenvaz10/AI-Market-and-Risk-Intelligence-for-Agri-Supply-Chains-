/**
 * Service worker registration. Production builds only (a worker in `vite dev` would serve
 * stale modules), and only in a secure context. The worker caches the static app shell and
 * nothing else (see public/sw.js): API responses, tokens and market prices are never stored.
 */
export const SW_UPDATE_EVENT = 'fasalytics:sw-update';
export const SW_URL = '/sw.js';

export function canRegisterServiceWorker({ nav = globalThis.navigator, win = globalThis.window, isProd = import.meta.env?.PROD } = {}) {
  if (!isProd || !nav || !('serviceWorker' in nav) || !win) return false;
  const host = win.location?.hostname;
  return Boolean(win.isSecureContext) || ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

/** @returns {Promise<ServiceWorkerRegistration|null>} null when unsupported, disabled or failed. */
export async function registerServiceWorker({ nav = globalThis.navigator, win = globalThis.window, isProd = import.meta.env?.PROD, log = console } = {}) {
  if (!canRegisterServiceWorker({ nav, win, isProd })) return null;
  try {
    const registration = await nav.serviceWorker.register(SW_URL, { scope: '/' });
    registration.addEventListener?.('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        // "installed" with an existing controller = a new version is waiting to take over
        if (worker.state === 'installed' && nav.serviceWorker.controller) {
          win.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT, { detail: registration }));
        }
      });
    });
    return registration;
  } catch (err) {
    log.warn?.('[PWA] Service worker registration failed:', err?.message);
    return null;
  }
}

/** Activates a waiting worker and reloads once it has taken control. */
export function applyServiceWorkerUpdate(registration, { nav = globalThis.navigator, win = globalThis.window } = {}) {
  if (!registration?.waiting) return false;
  let reloaded = false;
  nav.serviceWorker?.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    win.location.reload();
  });
  registration.waiting.postMessage('SKIP_WAITING');
  return true;
}
