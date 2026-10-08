/**
 * Mandi API tests against the isolated database (synthetic MOCK_PROVIDER data,
 * always flagged is_sample_data). Token verification uses a fake verifier.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../helpers/db.js';
import { pool } from '../../src/db.js';
import { config } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';
import { createRequireAuth } from '../../src/middleware/auth.js';
import { createRateLimiter } from '../../src/middleware/rateLimit.js';
import { createRequireAdminClaim } from '../../src/middleware/ingestionAuth.js';
import { hasPrivilegedFirebaseAccess } from '../../src/config/firebaseAdmin.js';
import { createMandiController } from '../../src/controllers/mandi.controller.js';
import { MandiPipeline } from '../../src/pipeline/index.js';
import { MandiService } from '../../src/services/mandi.service.js';

assertIsolatedDatabase();

// Fake tokens: "valid:<uid>[:admin]" — `admin` adds the custom claim admin === true to the decoded token.
const fakeVerify = async (token) => {
  if (token === 'expired') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' });
  const [kind, uid, flag] = token.split(':');
  if (kind !== 'valid') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
  return { uid, email: `${uid}@example.in`, email_verified: true, ...(flag === 'admin' && { admin: true }), firebase: { sign_in_provider: 'password' } };
};
// Live account lookup stub: accounts named "ops-*" are administrators; "revoked-*" had the claim removed.
const lookupUser = async (uid) => ({ customClaims: uid.startsWith('ops-') ? { admin: true } : {}, disabled: false });
const quietLog = { warn() {} };
const requireAuth = createRequireAuth(fakeVerify);
const welcomeEmail = { queueWelcomeEmail() {} };
const pipeline = new MandiPipeline({ pool, mandiConfig: { ...config.mandi, allowSampleData: true } });
const servers = [];

async function start(mandiRoutesOptions = {}) {
  const app = createApp({ requireAuth, welcomeEmail, mandiRoutesOptions });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, path, { token, body } = {}) => {
    const init = { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(base + path, init);
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  request.base = base;
  return request;
}

let call;
let latestSampleDate;
before(async () => {
  const seeded = await pipeline.runPipeline({ provider: 'MOCK', days: 5, triggeredBy: 'test' });
  assert.equal(seeded.status, 'SUCCESS', seeded.error_details);
  latestSampleDate = (await pool.query(`SELECT MAX(price_date)::text AS d FROM mandi_prices WHERE source = 'MOCK_PROVIDER'`)).rows[0].d;
  call = await start();
});
after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  await pool.end();
});

test('GET /api/mandi/mandis lists mandis with pagination fields', async () => {
  const r = await call('GET', '/api/mandi/mandis?limit=2');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 2);
  assert.ok(r.body.total >= 2);
});

test('GET /api/mandi/mandis/:id validates the id and 404s unknown ids', async () => {
  assert.equal((await call('GET', '/api/mandi/mandis/abc')).status, 400);
  assert.equal((await call('GET', '/api/mandi/mandis/999999')).status, 404);
  const first = (await call('GET', '/api/mandi/mandis?limit=1')).body.data[0];
  const detail = await call('GET', `/api/mandi/mandis/${first.id}`);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.body.data.current_prices));
  assert.ok(detail.body.data.current_prices.every((p) => p.source && p.price_date && 'is_sample_data' in p));
});

test('GET /prices/latest returns reporting date, source attribution, sample flag and freshness meta', async () => {
  const r = await call('GET', '/api/mandi/prices/latest?commodity=ONION');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length > 0);
  for (const row of r.body.data) {
    assert.equal(row.commodity_code, 'ONION');
    assert.equal(row.is_sample_data, true);
    assert.equal(row.source, 'MOCK_PROVIDER');
    assert.match(row.source_label, /Synthetic sample data/);
    assert.equal(row.price_unit, 'INR/quintal');
    // Reporting dates are calendar days: no timezone shift into the previous day.
    assert.match(row.price_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(row.fetched_at);
    assert.ok(['up', 'down', 'stable'].includes(row.trend_direction));
  }
  assert.equal(r.body.meta.genuine_rows, 0);
  assert.equal(r.body.meta.latest_genuine_reporting_date, null, 'no genuine data -> no genuine freshness claim');
  assert.ok(r.body.meta.sample_rows > 0);
  assert.equal((await call('GET', '/api/mandi/prices/latest?commodity=ONION&includeSample=false')).body.data.length, 0);
});

test('GET /prices/history returns the MOST RECENT rows, oldest-first by default', async () => {
  const asc = await call('GET', '/api/mandi/prices/history?commodity=ONION&limit=3');
  assert.equal(asc.status, 200);
  const dates = asc.body.data.map((r) => r.price_date.slice(0, 10));
  assert.deepEqual([...dates].sort(), dates, 'ascending');
  assert.equal(dates.at(-1), latestSampleDate, 'limit keeps the newest rows (audit defect A2)');
  const desc = await call('GET', '/api/mandi/prices/history?commodity=ONION&limit=3&order=desc');
  assert.equal(desc.body.data[0].price_date.slice(0, 10), latestSampleDate);
  const page2 = await call('GET', '/api/mandi/prices/history?commodity=ONION&limit=3&offset=3&order=desc');
  assert.ok(page2.body.data.every((r) => r.price_date.slice(0, 10) <= latestSampleDate));
  assert.equal(page2.body.offset, 3);
});

test('invalid inputs return 400 instead of 500 (audit defects A3/A4)', async () => {
  for (const path of [
    '/api/mandi/prices/history?startDate=not-a-date',
    '/api/mandi/prices/history?limit=-5',
    '/api/mandi/prices/history?startDate=2026-02-31',
    '/api/mandi/prices/latest?limit=abc',
    '/api/mandi/prices/latest?source=SCRAPER',
  ]) {
    const r = await call('GET', path);
    assert.equal(r.status, 400, path);
    assert.equal(r.body.code, 'VALIDATION_ERROR');
  }
});

test('GET /commodities, /sync/status and /quality/report expose honest counts', async () => {
  assert.equal((await call('GET', '/api/mandi/commodities')).status, 200);
  const status = await call('GET', '/api/mandi/sync/status');
  assert.equal(status.status, 200);
  assert.equal(Number(status.body.data.stats.genuine_price_records), 0);
  assert.ok(Number(status.body.data.stats.sample_price_records) > 0);
  assert.equal(status.body.data.scheduler.enabled, false);
  assert.ok(status.body.data.sources.some((s) => s.source === 'CEDA' && s.configured === false));
  const report = await call('GET', '/api/mandi/quality/report');
  assert.equal(report.status, 200);
  assert.equal(Number(report.body.data.summary.genuine_records), 0);
  assert.ok(Array.isArray(report.body.data.quality_flags));
  assert.equal(report.body.data.storage_safety.max_batch_limit, 10000);
});

test('GET / advertises the Phase 3 mandi and Phase 4 forecast endpoints', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.equal(r.body.phase, 'Phase 4 - Price Forecasting');
  assert.equal(r.body.endpoints.mandi.qualityReport, '/api/mandi/quality/report');
  assert.equal(r.body.endpoints.mandi.sync, '/api/mandi/sync');
  // Phase 4 adds the read-only forecast endpoint alongside the Phase 3 routes.
  assert.equal(r.body.endpoints.forecast.byCommodityAndMandi, '/api/forecast/:commodity/:mandi');
});

test('GET /api/health and /api/health/database operate normally (restored)', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  const db = await call('GET', '/api/health/database');
  assert.equal(db.status, 200);
  assert.equal(db.body.connected, true);
});

test('POST /sync: 401 anonymous, 401 invalid token, 403 for an authenticated farmer', async () => {
  const anon = await call('POST', '/api/mandi/sync', { body: { provider: 'MOCK' } });
  assert.equal(anon.status, 401);
  const garbage = await call('POST', '/api/mandi/sync', { token: 'garbage', body: { provider: 'MOCK' } });
  assert.equal(garbage.status, 401);
  const farmer = await call('POST', '/api/mandi/sync', { token: 'valid:farmer-1', body: { provider: 'MOCK' } });
  assert.equal(farmer.status, 403);
  assert.equal(farmer.body.code, 'INGESTION_FORBIDDEN');
});

test('POST /sync default wiring: an admin-claim token is refused (503) when Admin SDK credentials are missing', async (t) => {
  if (hasPrivilegedFirebaseAccess()) {
    t.skip('Firebase Admin credentials or the Auth Emulator are configured in this environment');
    return;
  }
  const r = await call('POST', '/api/mandi/sync', { token: 'valid:ops-1:admin', body: { provider: 'MOCK', days: 1 } });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'ADMIN_VERIFICATION_UNAVAILABLE');
});

test('POST /sync with the real admin-claim middleware: farmer 403, revoked 403, administrator 200 and audited', async () => {
  const api = await start({ authorizeIngestion: createRequireAdminClaim({ lookupUser, log: quietLog }) });
  const body = { provider: 'MOCK', days: 1 };
  assert.equal((await api('POST', '/api/mandi/sync', { token: 'valid:farmer-2', body })).status, 403);
  assert.equal((await api('POST', '/api/mandi/sync', { token: 'valid:revoked-1:admin', body })).status, 403, 'token still carries the claim but the account no longer does');
  const ok = await api('POST', '/api/mandi/sync', { token: 'valid:ops-1:admin', body });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const log = (await pool.query(`SELECT triggered_by FROM pipeline_sync_logs WHERE id = $1`, [ok.body.data.run_id])).rows[0];
  assert.equal(log.triggered_by, 'user:ops-1', 'the run is attributed to the administrator');
});

test('POST /sync is rate limited before authentication (429 with Retry-After)', async () => {
  const limited = await start({ syncRateLimiter: createRateLimiter({ windowMs: 60_000, max: 2 }) });
  await limited('POST', '/api/mandi/sync', { body: {} });
  await limited('POST', '/api/mandi/sync', { body: {} });
  const third = await limited('POST', '/api/mandi/sync', { body: {} });
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) > 0);
});

test('POST /sync for an authorised operator: validates input and reports real outcomes', async () => {
  const admin = await start({ authorizeIngestion: createRequireAdminClaim({ lookupUser, log: quietLog }) });
  const invalid = await admin('POST', '/api/mandi/sync', { token: 'valid:ops-2:admin', body: { provider: 'MOCK', days: 99 } });
  assert.equal(invalid.status, 400);
  const unknownField = await admin('POST', '/api/mandi/sync', { token: 'valid:ops-2:admin', body: { provider: 'MOCK', apiKey: 'x' } });
  assert.equal(unknownField.status, 400);
  const notConfigured = await admin('POST', '/api/mandi/sync', { token: 'valid:ops-2:admin', body: { provider: 'DATA_GOV_IN', days: 1 } });
  assert.equal(notConfigured.status, 503);
  assert.equal(notConfigured.body.code, 'SOURCE_NOT_CONFIGURED');
  const ok = await admin('POST', '/api/mandi/sync', { token: 'valid:ops-2:admin', body: { provider: 'MOCK', days: 1 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.is_sample_data, true);
  assert.equal(ok.body.data.records_inserted + ok.body.data.records_unchanged + ok.body.data.records_updated, ok.body.data.records_valid);
});

test('database failures map to 503 without leaking internals', async () => {
  const failing = (code) => new MandiService({ pool: { query: async () => { throw Object.assign(new Error('relation "x" secret detail'), { code }); } } });
  for (const [code, expected] of [['42P01', 'DATABASE_NOT_MIGRATED'], ['ECONNREFUSED', 'DATABASE_UNAVAILABLE']]) {
    const api = await start({ controller: createMandiController({ mandiService: failing(code) }) });
    const r = await api('GET', '/api/mandi/commodities');
    assert.equal(r.status, 503);
    assert.equal(r.body.code, expected);
    assert.ok(!JSON.stringify(r.body).includes('secret detail'));
  }
});
