/* Fasalytics service worker.
 *
 * SAFETY RULES (also enforced by test/sw-policy.test.js):
 *   - only same-origin GET requests are ever cached;
 *   - /api/*, anything with an Authorization header, and every cross-origin request
 *     (Firebase, Google, the backend on another port) go straight to the network and are
 *     NEVER stored -- so Firebase tokens, farmer data and market prices are never cached
 *     and an old price can never be shown as a live one;
 *   - cached content is limited to the app shell (static HTML/JS/CSS/icons).
 * Bump VERSION to invalidate old caches.
 */
const VERSION = 'v1';
const SHELL_CACHE = `fasalytics-shell-${VERSION}`;
const ASSET_CACHE = `fasalytics-assets-${VERSION}`;
const PRECACHE = ['/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
const STATIC_PREFIXES = ['/assets/', '/icons/', '/images/'];

/** 'network-only' | 'navigation' | 'static'. Pure function: no I/O. */
function classify({ method, mode, hasAuthorization }, url, origin) {
  if (method !== 'GET') return 'network-only';
  if (url.origin !== origin) return 'network-only';
  if (hasAuthorization) return 'network-only';
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') return 'network-only';
  if (url.pathname === '/sw.js') return 'network-only';
  if (mode === 'navigate') return 'navigation';
  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) || PRECACHE.includes(url.pathname)) return 'static';
  return 'network-only';
}

if (typeof globalThis.__SW_TEST__ !== 'undefined') {
  globalThis.__SW_TEST__.exports = { classify, SHELL_CACHE, ASSET_CACHE, PRECACHE };
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('fasalytics-') && !keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const cacheable = (response) => response && response.ok && response.type === 'basic' && !response.redirected;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const kind = classify(
    { method: request.method, mode: request.mode, hasAuthorization: request.headers.has('authorization') },
    url,
    self.location.origin,
  );
  if (kind === 'network-only') return; // let the browser handle it; nothing is stored

  if (kind === 'navigation') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (cacheable(response) && (response.headers.get('content-type') || '').includes('text/html')) {
          const copy = response.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy)));
        }
        return response;
      } catch {
        return (await caches.match('/')) || (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // static: cache-first (hashed build assets never change; icons are versioned by VERSION)
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (cacheable(response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  })());
});
