/**
 * Authorisation of POST /api/mandi/sync with the Firebase custom claim `admin: true`.
 * No database and no Firebase: tokens are verified by a fake verifier and the live
 * account lookup is an injected stub. The real controller is replaced by a counter, so
 * "never reached" is asserted directly.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRequireAuth } from '../src/middleware/auth.js';
import { createRequireAdminClaim } from '../src/middleware/ingestionAuth.js';
import { createRateLimiter } from '../src/middleware/rateLimit.js';
import { createMandiRoutes } from '../src/routes/mandi.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { hasPrivilegedFirebaseAccess } from '../src/config/firebaseAdmin.js';

/**
 * Fake tokens: "valid:<uid>[:flag,flag...]"
 *   flags: admin (claim true) | adminstr ("true") | adminnum (1) | admintrue_nested | unverified
 */
const fakeVerify = async (token) => {
  if (token === 'expired') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' });
  const [kind, uid, flagText = ''] = token.split(':');
  if (kind !== 'valid') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
  const flags = new Set(flagText.split(',').filter(Boolean));
  return {
    uid,
    email: `${uid}@example.in`,
    email_verified: !flags.has('unverified'),
    ...(flags.has('admin') && { admin: true }),
    ...(flags.has('adminstr') && { admin: 'true' }),
    ...(flags.has('adminnum') && { admin: 1 }),
    firebase: { sign_in_provider: 'password', ...(flags.has('nested') && { admin: true }) },
  };
};

const servers = [];
after(async () => {
  for (const s of servers) await new Promise((resolve) => s.close(resolve));
});

async function start({ lookupUser, rateMax = 100, timeoutMs = 200 } = {}) {
  const state = { controllerCalls: 0, lookups: 0, logs: [] };
  const log = { warn: (line) => state.logs.push(line) };
  const app = express();
  app.use(express.json());
  app.use('/api/mandi', createMandiRoutes({
    requireAuth: createRequireAuth(fakeVerify),
    authorizeIngestion: createRequireAdminClaim({
      lookupUser: lookupUser ? async (uid) => { state.lookups += 1; return lookupUser(uid); } : undefined,
      log,
      timeoutMs,
    }),
    syncRateLimiter: createRateLimiter({ windowMs: 60_000, max: rateMax }),
    controller: {
      getMandis() {}, getMandiDetails() {}, getLatestPrices() {}, getPriceHistory() {}, getCommodities() {},
      getCommodityReports() {}, getSyncStatus() {}, getDataQualityReport() {},
      triggerSync: (req, res) => { state.controllerCalls += 1; res.json({ status: 'success', uid: req.auth.uid }); },
    },
  }));
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (token) => {
    const res = await fetch(`${base}/api/mandi/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ provider: 'DATA_GOV_IN', days: 1 }),
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  return { call, state };
}

const adminUser = { customClaims: { admin: true }, disabled: false };

test('401: no token, malformed token, invalid token and expired token never reach the authoriser', async () => {
  const { call, state } = await start({ lookupUser: async () => adminUser });
  for (const token of [undefined, 'garbage', 'expired']) {
    const r = await call(token);
    assert.equal(r.status, 401, `token=${token}`);
  }
  assert.equal(state.lookups, 0);
  assert.equal(state.controllerCalls, 0);
});

test('403: authenticated accounts without a strict boolean admin claim are refused before any lookup', async () => {
  const { call, state } = await start({ lookupUser: async () => adminUser });
  for (const flags of ['', 'adminstr', 'adminnum', 'nested']) {
    const r = await call(`valid:farmer1${flags ? `:${flags}` : ''}`);
    assert.equal(r.status, 403, `flags="${flags}"`);
    assert.equal(r.body.code, 'INGESTION_FORBIDDEN');
  }
  assert.equal(state.lookups, 0, 'no Firebase lookup is spent on accounts without the claim');
  assert.equal(state.controllerCalls, 0);
});

test('403: an admin claim with an unverified email is refused', async () => {
  const { call, state } = await start({ lookupUser: async () => adminUser });
  const r = await call('valid:ops1:admin,unverified');
  assert.equal(r.status, 403);
  assert.equal(state.controllerCalls, 0);
});

test('403: revocation is immediate — a still-valid token whose claim was revoked is refused', async () => {
  const { call, state } = await start({ lookupUser: async () => ({ customClaims: { role: 'farmer' }, disabled: false }) });
  const r = await call('valid:ops2:admin');
  assert.equal(r.status, 403);
  assert.equal(state.lookups, 1);
  assert.equal(state.controllerCalls, 0);
  assert.ok(state.logs.some((l) => l.includes('claim-revoked')));
});

test('403: disabled and deleted accounts are refused', async () => {
  const disabled = await start({ lookupUser: async () => ({ customClaims: { admin: true }, disabled: true }) });
  assert.equal((await disabled.call('valid:ops3:admin')).status, 403);
  const gone = await start({ lookupUser: async () => { throw Object.assign(new Error('x'), { code: 'auth/user-not-found' }); } });
  assert.equal((await gone.call('valid:ops4:admin')).status, 403);
  assert.equal(disabled.state.controllerCalls + gone.state.controllerCalls, 0);
});

test('503 (fails closed): the live check cannot be made — missing credentials, outage or timeout', async () => {
  for (const make of [
    async () => { throw Object.assign(new Error('no credentials'), { code: 'auth/admin-credentials-missing' }); },
    async () => { throw Object.assign(new Error('not configured'), { code: 'auth/not-configured' }); },
    async () => { throw new Error('socket hang up with secret detail'); },
    () => new Promise(() => {}), // never resolves -> timeout
  ]) {
    const { call, state } = await start({ lookupUser: make, timeoutMs: 50 });
    const r = await call('valid:ops5:admin');
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'ADMIN_VERIFICATION_UNAVAILABLE');
    assert.ok(!JSON.stringify(r.body).includes('secret detail'));
    assert.equal(state.controllerCalls, 0, 'ingestion must not run when admin status is unverified');
  }
});

test('authorised: a confirmed administrator reaches the controller, and the decision is audited', async () => {
  const { call, state } = await start({ lookupUser: async () => ({ customClaims: { admin: true, region: 'MH' }, disabled: false }) });
  const r = await call('valid:ops6:admin');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'success', uid: 'ops6' });
  assert.equal(state.controllerCalls, 1);
  const line = state.logs.find((l) => l.includes('authorised'));
  assert.match(line, /uid=ops6/);
});

test('audit log lines contain the uid and a reason but never tokens or e-mail addresses', async () => {
  const { call, state } = await start({ lookupUser: async () => adminUser });
  await call('valid:ops7:admin');
  await call('valid:farmer7');
  assert.ok(state.logs.length >= 2);
  for (const line of state.logs) {
    assert.ok(!/valid:|Bearer|@example\.in/.test(line), line);
  }
});

test('rate limiting runs before authentication: floods are cut off with 429 even for admins', async () => {
  const { call, state } = await start({ lookupUser: async () => adminUser, rateMax: 3 });
  const statuses = [];
  for (let i = 0; i < 5; i += 1) statuses.push((await call(i % 2 ? 'valid:ops8:admin' : undefined)).status);
  assert.deepEqual(statuses, [401, 200, 401, 429, 429]);
  const limited = await call('valid:ops8:admin');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(state.controllerCalls, 1);
});

test('default wiring fails closed: without Admin SDK credentials an admin token gets 503, never 200', async (t) => {
  if (hasPrivilegedFirebaseAccess()) {
    t.skip('this environment has Firebase Admin credentials or the Auth Emulator configured');
    return;
  }
  const app = express();
  app.use(express.json());
  let reached = 0;
  app.use('/api/mandi', createMandiRoutes({
    requireAuth: createRequireAuth(fakeVerify),
    controller: { getMandis() {}, getMandiDetails() {}, getLatestPrices() {}, getPriceHistory() {}, getCommodities() {},
      getSyncStatus() {}, getDataQualityReport() {}, triggerSync: (req, res) => { reached += 1; res.json({}); } },
  }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push(server);
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/mandi/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid:ops9:admin' },
    body: '{}',
  });
  assert.equal(res.status, 503);
  assert.equal(reached, 0);
});
