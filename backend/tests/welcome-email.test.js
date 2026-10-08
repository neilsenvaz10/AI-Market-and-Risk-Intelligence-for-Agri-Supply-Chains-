/**
 * Welcome email workflow against the real PostgreSQL database with a mocked
 * provider (no real email is sent).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { createWelcomeEmailService } from '../src/services/email/welcomeEmail.service.js';
import { buildWelcomeEmail, maskPhone } from '../src/services/email/welcomeEmail.template.js';
import { createEmailProvider } from '../src/services/email/emailProvider.js';
import { createApp } from '../src/app.js';
import { createRequireAuth } from '../src/middleware/auth.js';

const PREFIX = `test-welcome-${process.pid}-`;
const silent = { log() {}, warn() {}, error() {} };
let seq = 0;

function mockProvider({ fail = false, delayMs = 0 } = {}) {
  const sent = [];
  return {
    sent,
    name: 'mock',
    configured: true,
    async send(message) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (fail) throw new Error('mock provider outage');
      sent.push(message);
      return { providerMessageId: `mock-${sent.length}` };
    },
  };
}

async function insertFarmer({ emailVerified = true, status = 'pending', completed = true } = {}) {
  seq += 1;
  const uid = `${PREFIX}${seq}`;
  await pool.query(
    `INSERT INTO farmers (firebase_uid, full_name, phone_number, phone_verified, email, email_verified,
       state, district, primary_crop, crop_quantity, registration_completed_at, welcome_email_status)
     VALUES ($1, 'Asha <b>Pawar</b>', $2, TRUE, $3, $4, 'Maharashtra', 'Satara', 'Soybean', 12,
       ${completed ? 'CURRENT_TIMESTAMP' : 'NULL'}, $5)`,
    [uid, `+9193${String(process.pid % 1e4).padStart(4, '0')}${String(seq).padStart(4, '0')}`, `${uid}@example.in`, emailVerified, status],
  );
  return uid;
}

const statusOf = async (uid) =>
  (await pool.query('SELECT welcome_email_status, welcome_email_attempts, welcome_email_last_error, welcome_email_sent_at FROM farmers WHERE firebase_uid = $1', [uid])).rows[0];

before(async () => {
  await pool.query('DELETE FROM farmers WHERE firebase_uid LIKE $1', [`${PREFIX}%`]);
});

after(async () => {
  await pool.query('DELETE FROM farmers WHERE firebase_uid LIKE $1', [`${PREFIX}%`]);
  await pool.end();
});

describe('template', () => {
  test('subject, masked phone, escaped name, honest feature copy', () => {
    const m = buildWelcomeEmail({ fullName: 'Asha <b>Pawar</b>', email: 'asha@example.in', phoneNumber: '+919876543210', dashboardUrl: 'http://localhost:5173' });
    assert.equal(m.subject, 'Welcome to FASALYTICS — Your Account Is Ready');
    assert.ok(m.html.includes('Asha &lt;b&gt;Pawar&lt;/b&gt;'));
    assert.ok(!m.html.includes('<b>Pawar</b>'));
    assert.ok(m.text.includes('+91 ••••••3210'));
    assert.ok(!m.text.includes('9876543210'));
    assert.match(m.text, /being rolled out in upcoming releases/);
    assert.match(m.text, /Smarter Markets\. Better Harvest Returns\./);
  });

  test('maskPhone keeps only last 4 digits', () => {
    assert.equal(maskPhone('+919619729227'), '+91 ••••••9227');
  });
});

describe('idempotent delivery', () => {
  test('concurrent triggers send exactly one email', async () => {
    const uid = await insertFarmer();
    const provider = mockProvider({ delayMs: 50 });
    const svc = createWelcomeEmailService({ provider, logger: silent });
    const results = await Promise.all([svc.sendWelcomeEmailOnce(uid), svc.sendWelcomeEmailOnce(uid), svc.sendWelcomeEmailOnce(uid)]);
    assert.deepEqual(results.sort(), ['sent', 'skipped', 'skipped']);
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].idempotencyKey.startsWith('fasalytics-welcome-'), true);
    const row = await statusOf(uid);
    assert.equal(row.welcome_email_status, 'sent');
    assert.ok(row.welcome_email_sent_at);

    assert.equal(await svc.sendWelcomeEmailOnce(uid), 'skipped', 'already sent');
    assert.equal(provider.sent.length, 1);
  });

  test('provider failure keeps the profile, records failure, and retry delivers once', async () => {
    const uid = await insertFarmer();
    const failing = createWelcomeEmailService({ provider: mockProvider({ fail: true }), logger: silent });
    assert.equal(await failing.sendWelcomeEmailOnce(uid), 'failed');
    let row = await statusOf(uid);
    assert.equal(row.welcome_email_status, 'failed');
    assert.match(row.welcome_email_last_error, /outage/);
    const { rowCount } = await pool.query('SELECT 1 FROM farmers WHERE firebase_uid = $1', [uid]);
    assert.equal(rowCount, 1, 'registration is not undone');

    const provider = mockProvider();
    const healthy = createWelcomeEmailService({ provider, logger: silent });
    await healthy.retryPending();
    await healthy.retryPending();
    row = await statusOf(uid);
    assert.equal(row.welcome_email_status, 'sent');
    assert.equal(provider.sent.filter((m) => m.to === `${uid}@example.in`).length, 1);
  });

  test('unconfigured provider never claims delivery; configured retry sends later', async () => {
    const uid = await insertFarmer();
    const unconfigured = createWelcomeEmailService({ provider: createEmailProvider({}), logger: silent });
    assert.equal(await unconfigured.sendWelcomeEmailOnce(uid), 'not_configured');
    let row = await statusOf(uid);
    assert.equal(row.welcome_email_status, 'not_configured');
    assert.equal(row.welcome_email_sent_at, null);
    assert.equal(row.welcome_email_attempts, 0, 'not counted as a delivery attempt');

    const provider = mockProvider();
    await createWelcomeEmailService({ provider, logger: silent }).retryPending();
    row = await statusOf(uid);
    assert.equal(row.welcome_email_status, 'sent');
  });

  test('not eligible until email verified and registration complete', async () => {
    const unverified = await insertFarmer({ emailVerified: false });
    const incomplete = await insertFarmer({ completed: false });
    const legacy = await insertFarmer({ status: 'skipped' });
    const provider = mockProvider();
    const svc = createWelcomeEmailService({ provider, logger: silent });
    for (const uid of [unverified, incomplete, legacy]) {
      assert.equal(await svc.sendWelcomeEmailOnce(uid), 'skipped');
    }
    assert.equal(provider.sent.length, 0);
  });

  test('gives up after the retry budget', async () => {
    const uid = await insertFarmer();
    const failing = createWelcomeEmailService({ provider: mockProvider({ fail: true }), logger: silent });
    for (let i = 0; i < 7; i += 1) await failing.sendWelcomeEmailOnce(uid);
    const row = await statusOf(uid);
    assert.equal(row.welcome_email_attempts, 5);
  });
});

describe('API integration', () => {
  test('POST /api/farmers/me sends the welcome email once after registration', async () => {
    const provider = mockProvider();
    const welcomeEmail = createWelcomeEmailService({ provider, logger: silent });
    const uid = `${PREFIX}api`;
    const verify = async () => ({ uid, phone_number: '+919300000001', email: `${uid}@example.in`, email_verified: true });
    const app = createApp({ requireAuth: createRequireAuth(verify), welcomeEmail });
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const url = `http://127.0.0.1:${server.address().port}/api/farmers/me`;
    const body = JSON.stringify({ fullName: 'Api Farmer', state: 'Maharashtra', district: 'Pune', primaryCrop: 'Onion', cropQuantity: 5 });
    const headers = { Authorization: 'Bearer x', 'Content-Type': 'application/json' };
    try {
      const first = await fetch(url, { method: 'POST', headers, body });
      const second = await fetch(url, { method: 'POST', headers, body });
      assert.equal(first.status, 201);
      assert.equal(second.status, 409);
      for (let i = 0; i < 40 && (await statusOf(uid)).welcome_email_status !== 'sent'; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal((await statusOf(uid)).welcome_email_status, 'sent');
      assert.equal(provider.sent.length, 1);
      assert.equal(provider.sent[0].to, `${uid}@example.in`);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('provider adapters', () => {
  test('resend request shape with idempotency key; 4xx is not retryable', async () => {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 2) return new Response('{"message":"invalid from"}', { status: 422 });
      return new Response('{"id":"re_123"}', { status: 200 });
    };
    const p = createEmailProvider({ provider: 'resend', apiKey: 're_test', from: 'FASALYTICS <no-reply@example.in>' }, fakeFetch);
    const out = await p.send({ to: 'a@example.in', subject: 's', html: '<p>h</p>', text: 't', idempotencyKey: 'k1' });
    assert.equal(out.providerMessageId, 're_123');
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'k1');
    await assert.rejects(p.send({ to: 'a@example.in', subject: 's', html: '', text: '' }), (err) => err.retryable === false);
  });

  test('missing configuration is reported, not thrown', () => {
    assert.equal(createEmailProvider({}).configured, false);
    assert.equal(createEmailProvider({ provider: 'resend', apiKey: 'k' }).configured, false);
    assert.equal(createEmailProvider({ provider: 'carrier-pigeon', apiKey: 'k', from: 'x@y.z' }).configured, false);
  });
});
