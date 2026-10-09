/**
 * Secure caching behaviour of public/sw.js, executed in a VM with a fake Cache API and fake network.
 * Rules under test: only same-origin GET static shell files are cached; API calls, Authorization
 * requests, cross-origin traffic (Firebase tokens, Google, the backend) and failed/opaque
 * responses are never stored.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SW_SOURCE = fs.readFileSync(path.resolve(import.meta.dirname, '../public/sw.js'), 'utf8');
const ORIGIN = 'https://app.example';

const response = (over = {}) => ({
  ok: true, status: 200, type: 'basic', redirected: false,
  headers: new Headers({ 'content-type': 'text/html' }), clone() { return this; }, ...over,
});
const request = (urlPath, over = {}) => ({
  url: urlPath.startsWith('http') ? urlPath : ORIGIN + urlPath, method: 'GET', mode: 'cors', headers: new Headers(), ...over,
});

function loadSw({ network = async () => response() } = {}) {
  const listeners = {};
  const store = new Map(); // cache name -> Map(url -> response)
  const keyOf = (x) => new URL(typeof x === 'string' ? x : x.url, ORIGIN).href;
  const caches = {
    store,
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name);
      return { put: async (k, v) => { c.set(keyOf(k), v); }, addAll: async (urls) => { urls.forEach((u) => c.set(keyOf(u), response())); } };
    },
    async match(req) {
      for (const c of store.values()) if (c.has(keyOf(req))) return c.get(keyOf(req));
      return undefined;
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
  };
  const calls = [];
  const self = { location: { origin: ORIGIN }, addEventListener: (t, fn) => { listeners[t] = fn; }, clients: { claim: async () => {} }, skipWaiting() { self.skipped = true; } };
  const sandbox = { self, caches, fetch: async (req) => { calls.push(req.url); return network(req); }, URL, Response: { error: () => ({ error: true }) }, Headers, __SW_TEST__: {} };
  vm.runInNewContext(SW_SOURCE, sandbox);

  async function dispatchFetch(req) {
    const pending = [];
    const event = { request: req, respondWith(p) { this.promise = Promise.resolve(p); }, waitUntil(p) { pending.push(p); } };
    listeners.fetch(event);
    const result = event.promise ? await event.promise : undefined;
    await Promise.all(pending);
    return { handled: Boolean(event.promise), result };
  }
  async function lifecycle(type) {
    const pending = [];
    listeners[type]({ waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  }
  return { sw: sandbox.__SW_TEST__.exports, caches, calls, self, listeners, dispatchFetch, lifecycle };
}

describe('classify()', () => {
  const { sw } = loadSw();
  const kind = (init, url) => sw.classify({ method: 'GET', mode: 'cors', hasAuthorization: false, ...init }, new URL(url, ORIGIN), ORIGIN);
  it('only static shell paths and navigations are cacheable', () => {
    expect(kind({ mode: 'navigate' }, '/mandis')).toBe('navigation');
    expect(kind({}, '/assets/index-abc123.js')).toBe('static');
    expect(kind({}, '/icons/icon-192.png')).toBe('static');
    expect(kind({}, '/manifest.webmanifest')).toBe('static');
  });
  it('API, auth, non-GET and cross-origin requests are network-only', () => {
    expect(kind({}, '/api/mandi/prices/latest')).toBe('network-only');
    expect(kind({ mode: 'navigate' }, '/api/farmers/me')).toBe('network-only');
    expect(kind({ hasAuthorization: true }, '/assets/x.js')).toBe('network-only');
    expect(kind({ method: 'POST' }, '/assets/x.js')).toBe('network-only');
    expect(kind({}, 'https://identitytoolkit.googleapis.com/v1/accounts:lookup')).toBe('network-only');
    expect(kind({}, 'https://localhost:5000/api/mandi/prices/latest')).toBe('network-only');
    expect(kind({}, '/locations/maharashtra.json')).toBe('network-only');
    expect(kind({}, '/sw.js')).toBe('network-only');
  });
});

describe('fetch handler', () => {
  let ctx;
  beforeEach(() => { ctx = loadSw(); });
  const storedUrls = () => [...ctx.caches.store.values()].flatMap((c) => [...c.keys()]);

  it('never intercepts or stores API calls, Authorization requests, writes or cross-origin traffic', async () => {
    for (const req of [
      request('/api/mandi/prices/latest'),
      request('/api/farmers/me', { headers: new Headers({ authorization: 'Bearer secret-token' }) }),
      request('/assets/app.js', { headers: new Headers({ authorization: 'Bearer secret-token' }) }),
      request('/api/assistant/chat', { method: 'POST' }),
      request('https://securetoken.googleapis.com/v1/token'),
      request('https://backend.example:5000/api/mandi/prices/latest'),
    ]) {
      const { handled } = await ctx.dispatchFetch(req);
      expect(handled, req.url).toBe(false);
    }
    expect(ctx.calls).toEqual([]);
    expect(storedUrls()).toEqual([]);
  });

  it('serves static assets cache-first after the first network fetch', async () => {
    await ctx.dispatchFetch(request('/assets/index-abc.js'));
    expect(ctx.calls).toHaveLength(1);
    await ctx.dispatchFetch(request('/assets/index-abc.js'));
    expect(ctx.calls).toHaveLength(1);
    expect(storedUrls()).toContain(`${ORIGIN}/assets/index-abc.js`);
  });

  it('does not cache failed, redirected or opaque responses', async () => {
    for (const bad of [response({ ok: false, status: 500 }), response({ redirected: true }), response({ type: 'opaque' }), response({ type: 'cors' })]) {
      const local = loadSw({ network: async () => bad });
      await local.dispatchFetch(request('/assets/x.js'));
      expect([...local.caches.store.values()].flatMap((c) => [...c.keys()])).toEqual([]);
    }
  });

  it('navigation: network first, shell cached, offline fallback to the shell then the offline page', async () => {
    const nav = request('/mandis', { mode: 'navigate' });
    await ctx.dispatchFetch(nav);
    expect(storedUrls()).toContain(`${ORIGIN}/`);

    const offline = loadSw({ network: async () => { throw new TypeError('offline'); } });
    const noCache = await offline.dispatchFetch(nav);
    expect(noCache.result).toEqual({ error: true }); // nothing cached yet -> network error response

    await offline.caches.open('fasalytics-shell-v1').then((c) => c.put('/offline.html', response()));
    const fallback = await offline.dispatchFetch(nav);
    expect(fallback.result.ok).toBe(true);
  });

  it('does not cache non-HTML navigation responses', async () => {
    const local = loadSw({ network: async () => response({ headers: new Headers({ 'content-type': 'application/json' }) }) });
    await local.dispatchFetch(request('/mandis', { mode: 'navigate' }));
    expect([...local.caches.store.values()].flatMap((c) => [...c.keys()])).toEqual([]);
  });
});

describe('lifecycle', () => {
  it('install precaches only static shell files (never API paths)', async () => {
    const ctx = loadSw();
    await ctx.lifecycle('install');
    const urls = [...ctx.caches.store.values()].flatMap((c) => [...c.keys()]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes('/api'))).toBe(false);
    expect(urls).toContain(`${ORIGIN}/offline.html`);
  });

  it('activate removes only outdated fasalytics caches', async () => {
    const ctx = loadSw();
    await ctx.caches.open('fasalytics-shell-v0');
    await ctx.caches.open('someone-elses-cache');
    await ctx.caches.open(ctx.sw.SHELL_CACHE);
    await ctx.lifecycle('activate');
    expect(await ctx.caches.keys()).toEqual(expect.arrayContaining(['someone-elses-cache', ctx.sw.SHELL_CACHE]));
    expect(await ctx.caches.keys()).not.toContain('fasalytics-shell-v0');
  });

  it('skips waiting only on an explicit message', () => {
    const ctx = loadSw();
    ctx.listeners.message({ data: 'something else' });
    expect(ctx.self.skipped).toBeUndefined();
    ctx.listeners.message({ data: 'SKIP_WAITING' });
    expect(ctx.self.skipped).toBe(true);
  });

  it('source never stores request headers, tokens or API paths', () => {
    expect(SW_SOURCE).not.toMatch(/cache\.put\([^)]*headers/i);
    expect(SW_SOURCE).not.toMatch(/PRECACHE\s*=\s*\[[^\]]*\/api/);
  });
});
