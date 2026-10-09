/**
 * Farmer profile API tests against the real PostgreSQL database.
 * Token verification is replaced by a fake verifier so these tests run
 * without Firebase; see firebase-emulator.test.js for real token checks.
 *
 * Requires: PostgreSQL reachable via backend/.env and migration 002 applied.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createRequireAuth } from '../src/middleware/auth.js';
import { pool } from '../src/db.js';

const PREFIX = `test-phase2-${process.pid}-`;
const UID_A = `${PREFIX}a`;
const UID_B = `${PREFIX}b`;
const UID_C = `${PREFIX}c`;
const UID_NO_PHONE = `${PREFIX}nophone`;
const rand = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const PHONE_A = `+9198${rand()}`;
const PHONE_B = `+9197${rand()}`;

// Fake tokens: "valid:<uid>[:<phone>[:<email|->[:<emailVerified>]]]" | "expired" | anything else = invalid
// Email defaults to <uid>@example.in (verified) so profile creation is allowed.
const fakeVerify = async (token) => {
  if (token === 'expired') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' });
  const [kind, uid, phone, email = `${uid}@example.in`, verified = 'true'] = token.split(':');
  if (kind !== 'valid') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
  return {
    uid,
    phone_number: phone || undefined,
    email: email === '-' ? undefined : email,
    email_verified: verified === 'true',
    firebase: { sign_in_provider: 'password' },
  };
};

// Records welcome-email triggers instead of sending (delivery is covered in welcome-email.test.js)
const queuedWelcomeEmails = [];
const welcomeEmailStub = { queueWelcomeEmail: (uid) => queuedWelcomeEmails.push(uid) };

let server;
let baseUrl;

async function call(method, path, { token, body, rawBody } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, body: await res.json() };
}

const tokenA = `valid:${UID_A}:${PHONE_A}`;
const tokenB = `valid:${UID_B}:${PHONE_B}`;

const validProfile = {
  fullName: 'Ramesh Patil',
  state: 'Maharashtra',
  district: 'Nashik',
  village: 'Pimpalgaon',
  primaryCrop: 'Onion',
  cropQuantity: 25,
  quantityUnit: 'quintal',
  preferredLanguage: 'mr',
};

before(async () => {
  await pool.query('DELETE FROM farmers WHERE firebase_uid LIKE $1', [`${PREFIX}%`]);
  const app = createApp({ requireAuth: createRequireAuth(fakeVerify), welcomeEmail: welcomeEmailStub });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await pool.query('DELETE FROM farmers WHERE firebase_uid LIKE $1', [`${PREFIX}%`]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

describe('authentication middleware', () => {
  test('rejects missing Authorization header with 401', async () => {
    const r = await call('GET', '/api/farmers/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'AUTH_REQUIRED');
  });

  test('rejects malformed Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/farmers/me`, { headers: { Authorization: 'Token abc' } });
    assert.equal(res.status, 401);
  });

  test('rejects invalid token with 401 INVALID_TOKEN', async () => {
    const r = await call('GET', '/api/auth/session', { token: 'garbage' });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'INVALID_TOKEN');
  });

  test('rejects expired token with 401 TOKEN_EXPIRED', async () => {
    const r = await call('GET', '/api/farmers/me', { token: 'expired' });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'TOKEN_EXPIRED');
  });

  test('all farmer methods require auth', async () => {
    for (const method of ['GET', 'POST', 'PUT']) {
      const r = await call(method, '/api/farmers/me', method === 'GET' ? {} : { body: validProfile });
      assert.equal(r.status, 401, `${method} should be 401`);
    }
  });
});

describe('profile lifecycle', () => {
  test('session reports incomplete profile for a new farmer', async () => {
    const r = await call('GET', '/api/auth/session', { token: tokenA });
    assert.equal(r.status, 200);
    assert.equal(r.body.authenticated, true);
    assert.equal(r.body.profileComplete, false);
    assert.equal(r.body.phoneNumber, PHONE_A);
    assert.equal(r.body.farmer, null);
  });

  test('GET /me returns 404 before registration', async () => {
    const r = await call('GET', '/api/farmers/me', { token: tokenA });
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'PROFILE_NOT_FOUND');
  });

  test('POST /me creates profile using token UID and phone', async () => {
    const r = await call('POST', '/api/farmers/me', { token: tokenA, body: { ...validProfile, fullName: '  Ramesh   Patil ' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.farmer.fullName, 'Ramesh Patil');
    assert.equal(r.body.farmer.phoneNumber, PHONE_A);
    assert.equal(r.body.farmer.cropQuantity, 25);
    assert.equal(r.body.farmer.firebaseUid, undefined, 'firebase uid must not be exposed');

    const { rows } = await pool.query('SELECT firebase_uid, phone_number FROM farmers WHERE firebase_uid = $1', [UID_A]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phone_number, PHONE_A);
  });

  test('duplicate POST /me returns 409 PROFILE_EXISTS', async () => {
    const r = await call('POST', '/api/farmers/me', { token: tokenA, body: validProfile });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'PROFILE_EXISTS');
  });

  test('same phone under a different UID returns 409 PHONE_ALREADY_REGISTERED', async () => {
    const r = await call('POST', '/api/farmers/me', { token: `valid:${UID_C}:${PHONE_A}`, body: validProfile });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'PHONE_ALREADY_REGISTERED');
  });

  test('session and GET /me return the stored profile', async () => {
    const s = await call('GET', '/api/auth/session', { token: tokenA });
    assert.equal(s.body.profileComplete, true);
    const r = await call('GET', '/api/farmers/me', { token: tokenA });
    assert.equal(r.status, 200);
    assert.equal(r.body.farmer.district, 'Nashik');
    assert.equal(r.body.farmer.preferredLanguage, 'mr');
  });

  test('PUT /me updates editable fields and bumps updated_at', async () => {
    const before = await call('GET', '/api/farmers/me', { token: tokenA });
    const r = await call('PUT', '/api/farmers/me', {
      token: tokenA,
      body: { primaryCrop: 'Tomato', cropQuantity: '1200.5', quantityUnit: 'kg', preferredLanguage: 'hi', village: '' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.farmer.primaryCrop, 'Tomato');
    assert.equal(r.body.farmer.cropQuantity, 1200.5);
    assert.equal(r.body.farmer.quantityUnit, 'kg');
    assert.equal(r.body.farmer.preferredLanguage, 'hi');
    assert.equal(r.body.farmer.village, null);
    assert.equal(r.body.farmer.fullName, 'Ramesh Patil', 'untouched fields preserved');
    assert.ok(new Date(r.body.farmer.updatedAt) >= new Date(before.body.farmer.updatedAt));

    const { rows } = await pool.query('SELECT primary_crop, quantity_unit FROM farmers WHERE firebase_uid = $1', [UID_A]);
    assert.equal(rows[0].primary_crop, 'Tomato');
    assert.equal(rows[0].quantity_unit, 'kg');
  });

  test('PUT /me cannot change phone number or UID', async () => {
    for (const body of [{ phoneNumber: '+919999999999' }, { firebaseUid: UID_B }, { id: 'x' }]) {
      const r = await call('PUT', '/api/farmers/me', { token: tokenA, body });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'VALIDATION_ERROR');
    }
    const r = await call('GET', '/api/farmers/me', { token: tokenA });
    assert.equal(r.body.farmer.phoneNumber, PHONE_A);
  });

  test('PUT /me without a profile returns 404', async () => {
    const r = await call('PUT', '/api/farmers/me', { token: tokenB, body: { fullName: 'Someone Else' } });
    assert.equal(r.status, 404);
  });
});

describe('isolation between farmers', () => {
  test('farmer B only ever sees and edits their own profile', async () => {
    const created = await call('POST', '/api/farmers/me', { token: tokenB, body: { ...validProfile, fullName: 'Sunita Jadhav', district: 'Pune' } });
    assert.equal(created.status, 201);

    const b = await call('GET', '/api/farmers/me', { token: tokenB });
    assert.equal(b.body.farmer.fullName, 'Sunita Jadhav');
    assert.equal(b.body.farmer.phoneNumber, PHONE_B);

    await call('PUT', '/api/farmers/me', { token: tokenB, body: { fullName: 'Sunita J' } });
    const a = await call('GET', '/api/farmers/me', { token: tokenA });
    assert.equal(a.body.farmer.fullName, 'Ramesh Patil', 'A unaffected by B update');
  });

  test('UID supplied in the body is rejected, not trusted', async () => {
    const r = await call('POST', '/api/farmers/me', { token: `valid:${UID_C}:+919811111111`, body: { ...validProfile, firebaseUid: UID_A } });
    assert.equal(r.status, 400);
    assert.ok(r.body.details.firebaseUid);
  });
});

describe('validation', () => {
  const token = `valid:${UID_C}:+9196${rand()}`;

  const cases = [
    ['missing name', { ...validProfile, fullName: undefined }, 'fullName'],
    ['name too short', { ...validProfile, fullName: 'R' }, 'fullName'],
    ['name with markup', { ...validProfile, fullName: '<script>x</script>' }, 'fullName'],
    ['invalid state', { ...validProfile, state: 'Atlantis' }, 'state'],
    ['missing district', { ...validProfile, district: '  ' }, 'district'],
    ['missing crop', { ...validProfile, primaryCrop: '' }, 'primaryCrop'],
    ['zero quantity', { ...validProfile, cropQuantity: 0 }, 'cropQuantity'],
    ['negative quantity', { ...validProfile, cropQuantity: -5 }, 'cropQuantity'],
    ['non-numeric quantity', { ...validProfile, cropQuantity: '12abc' }, 'cropQuantity'],
    ['huge quantity', { ...validProfile, cropQuantity: 1e12 }, 'cropQuantity'],
    ['bad unit', { ...validProfile, quantityUnit: 'tonne' }, 'quantityUnit'],
    ['bad language', { ...validProfile, preferredLanguage: 'fr' }, 'preferredLanguage'],
    ['unknown field', { ...validProfile, isAdmin: true }, 'isAdmin'],
  ];

  for (const [name, body, field] of cases) {
    test(`rejects ${name}`, async () => {
      const r = await call('POST', '/api/farmers/me', { token, body });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'VALIDATION_ERROR');
      assert.ok(r.body.details[field], `expected error on ${field}: ${JSON.stringify(r.body.details)}`);
    });
  }

  test('accepts Devanagari names and places', async () => {
    const r = await call('POST', '/api/farmers/me', {
      token,
      body: { ...validProfile, fullName: 'रमेश पाटील', district: 'नाशिक', village: undefined, primaryCrop: 'कांदा' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.farmer.fullName, 'रमेश पाटील');
    assert.equal(r.body.farmer.village, null);
  });

  test('rejects invalid JSON body with 400', async () => {
    const r = await call('POST', '/api/farmers/me', { token: tokenA, rawBody: '{not json' });
    assert.equal(r.status, 400);
  });

  test('rejects empty update', async () => {
    const r = await call('PUT', '/api/farmers/me', { token: tokenA, body: {} });
    assert.equal(r.status, 400);
  });

  test('profile creation allows registration without a phone claim when phone verification is disabled', async () => {
    const r = await call('POST', '/api/farmers/me', { token: `valid:${UID_NO_PHONE}`, body: validProfile });
    assert.equal(r.status, 201);
  });
});

describe('email / phone registration requirements', () => {
  before(() => { process.env.REQUIRE_PHONE_VERIFICATION = 'true'; });
  after(() => { delete process.env.REQUIRE_PHONE_VERIFICATION; });

  const UID_E = `${PREFIX}email`;
  const PHONE_E = `+9195${rand()}`;
  const EMAIL_E = `Farmer.${process.pid}@Example.IN`;

  test('profile creation requires a verified phone (no phone claim)', async () => {
    const r = await call('POST', '/api/farmers/me', { token: `valid:${UID_E}::${EMAIL_E}:true`, body: validProfile });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'PHONE_NOT_VERIFIED');
  });

  test('profile creation requires an email address', async () => {
    const r = await call('POST', '/api/farmers/me', { token: `valid:${UID_E}:${PHONE_E}:-`, body: validProfile });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'EMAIL_REQUIRED');
  });

  test('profile creation requires a verified email', async () => {
    const r = await call('POST', '/api/farmers/me', { token: `valid:${UID_E}:${PHONE_E}:${EMAIL_E}:false`, body: validProfile });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'EMAIL_NOT_VERIFIED');
  });

  test('completed registration stores token identity, flags and queues one welcome email', async () => {
    queuedWelcomeEmails.length = 0;
    const r = await call('POST', '/api/farmers/me', {
      token: `valid:${UID_E}:${PHONE_E}:${EMAIL_E}:true`,
      body: { ...validProfile, email: 'attacker@evil.test' },
    });
    assert.equal(r.status, 400, 'email in body is rejected — identity only comes from the token');

    const ok = await call('POST', '/api/farmers/me', { token: `valid:${UID_E}:${PHONE_E}:${EMAIL_E}:true`, body: validProfile });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.farmer.email, EMAIL_E.toLowerCase());
    assert.equal(ok.body.farmer.emailVerified, true);
    assert.equal(ok.body.farmer.phoneVerified, true);
    assert.ok(ok.body.farmer.registrationCompletedAt);
    assert.deepEqual(queuedWelcomeEmails, [UID_E]);

    const { rows } = await pool.query(
      'SELECT email, email_verified, phone_verified, registration_completed_at, welcome_email_status FROM farmers WHERE firebase_uid = $1',
      [UID_E],
    );
    assert.equal(rows[0].email, EMAIL_E.toLowerCase());
    assert.equal(rows[0].phone_verified, true);
    assert.ok(rows[0].registration_completed_at);
    assert.equal(rows[0].welcome_email_status, 'pending');
  });

  test('same email (any case) on another Firebase account cannot create a second profile', async () => {
    const r = await call('POST', '/api/farmers/me', {
      token: `valid:${PREFIX}email2:+9194${rand()}:${EMAIL_E.toUpperCase()}:true`,
      body: validProfile,
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'EMAIL_ALREADY_REGISTERED');
  });

  test('session mirrors verified token claims onto the profile', async () => {
    const newEmail = `changed.${process.pid}@example.in`;
    const r = await call('GET', '/api/auth/session', { token: `valid:${UID_E}:${PHONE_E}:${newEmail}:true` });
    assert.equal(r.status, 200);
    assert.equal(r.body.account.email, newEmail);
    assert.equal(r.body.farmer.email, newEmail);
    const { rows } = await pool.query('SELECT email FROM farmers WHERE firebase_uid = $1', [UID_E]);
    assert.equal(rows[0].email, newEmail);
  });

  test('session for an account without profile reveals nothing about other accounts', async () => {
    const r = await call('GET', '/api/auth/session', { token: `valid:${PREFIX}fresh::${EMAIL_E}:true` });
    assert.equal(r.status, 200);
    assert.equal(r.body.profileComplete, false);
    assert.equal(r.body.farmer, null);
  });
});

describe('phase 1 endpoints', () => {
  test('GET /api/health still works', async () => {
    const r = await call('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
  });

  test('GET /api/health/database still works', async () => {
    const r = await call('GET', '/api/health/database');
    assert.equal(r.status, 200);
    assert.equal(r.body.connected, true);
  });
});
