/**
 * End-to-end identity tests with the real Firebase Admin SDK, using tokens
 * issued by the Firebase Auth Emulator through the same Identity Toolkit
 * endpoints the web SDK calls (email/password, phone OTP linking, email
 * verification, Google sign-in).
 *
 * Skipped unless FIREBASE_AUTH_EMULATOR_HOST is set, e.g.:
 *   npx firebase-tools emulators:start --only auth --project demo-fasalytics
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_PROJECT_ID=demo-fasalytics npm test
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.FIREBASE_PROJECT_ID;
const skip = !EMULATOR || !PROJECT ? 'FIREBASE_AUTH_EMULATOR_HOST / FIREBASE_PROJECT_ID not set' : false;

const ITK = `http://${EMULATOR}/identitytoolkit.googleapis.com/v1`;
const EMU = `http://${EMULATOR}/emulator/v1/projects/${PROJECT}`;
const KEY = '?key=fake-api-key';
const run = `${process.pid}${Date.now() % 100000}`;
const rand8 = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

async function itk(path, body) {
  const res = await fetch(`${ITK}/${path}${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function ok(path, body) {
  const r = await itk(path, body);
  if (r.status !== 200) throw new Error(`${path} ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const signUp = (email, password) => ok('accounts:signUp', { email, password, returnSecureToken: true });
const signInWithPassword = (email, password) => itk('accounts:signInWithPassword', { email, password, returnSecureToken: true });

async function sendPhoneCode(phoneNumber) {
  const { sessionInfo } = await ok('accounts:sendVerificationCode', { phoneNumber, recaptchaToken: 'emulator' });
  const { verificationCodes } = await (await fetch(`${EMU}/verificationCodes`)).json();
  return { sessionInfo, code: verificationCodes.find((c) => c.sessionInfo === sessionInfo).code };
}

/** linkWithPhoneNumber(): OTP + idToken links the phone to the existing account. */
async function linkPhone(idToken, phoneNumber, { wrongCode = false } = {}) {
  const { sessionInfo, code } = await sendPhoneCode(phoneNumber);
  return itk('accounts:signInWithPhoneNumber', { sessionInfo, code: wrongCode ? (code === '000000' ? '111111' : '000000') : code, idToken });
}

async function verifyEmail(idToken) {
  await ok('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });
  const { oobCodes } = await (await fetch(`${EMU}/oobCodes`)).json();
  const { email } = await ok('accounts:lookup', { idToken }).then((r) => r.users[0]);
  const entry = oobCodes.filter((c) => c.email === email && c.requestType === 'VERIFY_EMAIL').pop();
  await ok('accounts:update', { oobCode: entry.oobCode });
}

/** signInWithCredential(GoogleAuthProvider.credential(idToken)) — emulator accepts unsigned JSON id_tokens. */
function googleSignIn({ sub, email, idToken }) {
  return itk('accounts:signInWithIdp', {
    postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub, email, email_verified: true }))}&providerId=google.com`,
    requestUri: 'http://localhost',
    returnSecureToken: true,
    returnIdpCredential: true,
    ...(idToken && { idToken }),
  });
}

const profileBody = (fullName) => JSON.stringify({
  fullName, state: 'Maharashtra', district: 'Pune', primaryCrop: 'Onion', cropQuantity: 10,
});

describe('Firebase identity flows (Auth Emulator + real Firebase Admin)', { skip }, () => {
  let server;
  let baseUrl;
  let pool;
  const sentWelcome = [];
  const createdEmails = [];

  const api = (method, path, idToken, body) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(idToken && { Authorization: `Bearer ${idToken}` }), 'Content-Type': 'application/json' },
      body,
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

  before(async () => {
    const { createApp } = await import('../src/app.js');
    const { createWelcomeEmailService } = await import('../src/services/email/welcomeEmail.service.js');
    ({ pool } = await import('../src/db.js'));
    const provider = { name: 'mock', configured: true, send: async (m) => { sentWelcome.push(m); return { providerMessageId: 'mock' }; } };
    const welcomeEmail = createWelcomeEmailService({ provider, logger: { log() {}, warn() {}, error() {} } });
    const app = createApp({ welcomeEmail }); // default middleware => real Firebase Admin verifyIdToken
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (createdEmails.length) await pool.query('DELETE FROM farmers WHERE email = ANY($1)', [createdEmails]);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  const waitForWelcome = async (email) => {
    for (let i = 0; i < 40 && !sentWelcome.some((m) => m.to === email); i += 1) await new Promise((r) => setTimeout(r, 50));
    return sentWelcome.filter((m) => m.to === email).length;
  };

  describe('email/password registration', () => {
    const email = `farmer.${run}@example.in`;
    const password = 'Fasal@2026x';
    const phone = `+9198${rand8()}`;
    let uid;

    test('incomplete accounts cannot create a profile (phone, then email verification required)', async () => {
      const created = await signUp(email, password);
      uid = created.localId;
      createdEmails.push(email);

      let r = await api('POST', '/api/farmers/me', created.idToken, profileBody('Email Farmer'));
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'PHONE_NOT_VERIFIED');

      const wrong = await linkPhone(created.idToken, phone, { wrongCode: true });
      assert.equal(wrong.status, 400, 'incorrect OTP rejected by Firebase');

      const linked = await linkPhone(created.idToken, phone);
      assert.equal(linked.status, 200);
      assert.equal(linked.body.localId, uid, 'phone linked to the SAME Firebase account');

      r = await api('POST', '/api/farmers/me', linked.body.idToken, profileBody('Email Farmer'));
      assert.equal(r.status, 400);
      assert.equal(r.body.code, 'EMAIL_NOT_VERIFIED');
    });

    test('after email verification the profile is created and one welcome email is sent', async () => {
      const login = await signInWithPassword(email, password);
      await verifyEmail(login.body.idToken);
      const fresh = await signInWithPassword(email, password); // new token carries email_verified + phone_number
      assert.equal(fresh.status, 200);

      const session = await api('GET', '/api/auth/session', fresh.body.idToken);
      assert.equal(session.body.account.emailVerified, true);
      assert.equal(session.body.account.phoneNumber, phone);
      assert.equal(session.body.profileComplete, false);

      const created = await api('POST', '/api/farmers/me', fresh.body.idToken, profileBody('Email Farmer'));
      assert.equal(created.status, 201);
      assert.equal(created.body.farmer.email, email);
      assert.equal(created.body.farmer.phoneNumber, phone);

      const again = await api('POST', '/api/farmers/me', fresh.body.idToken, profileBody('Email Farmer'));
      assert.equal(again.status, 409);
      assert.equal(await waitForWelcome(email), 1);

      const { rows } = await pool.query('SELECT firebase_uid, email_verified, phone_verified, welcome_email_status FROM farmers WHERE email = $1', [email]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].firebase_uid, uid);
      assert.equal(rows[0].welcome_email_status, 'sent');
    });

    test('returning email/password login needs no SMS and retrieves the existing profile', async () => {
      const before = (await (await fetch(`${EMU}/verificationCodes`)).json()).verificationCodes.length;
      const login = await signInWithPassword(email, password);
      assert.equal(login.status, 200);
      const me = await api('GET', '/api/farmers/me', login.body.idToken);
      assert.equal(me.status, 200);
      assert.equal(me.body.farmer.fullName, 'Email Farmer');
      const after = (await (await fetch(`${EMU}/verificationCodes`)).json()).verificationCodes.length;
      assert.equal(after, before, 'no OTP was sent during login');
    });

    test('wrong password is rejected', async () => {
      const r = await signInWithPassword(email, 'Wrong@2026x');
      assert.equal(r.status, 400);
    });

    test('a phone already linked to one account cannot be linked to another', async () => {
      const other = await signUp(`other.${run}@example.in`, password);
      createdEmails.push(`other.${run}@example.in`);
      const r = await linkPhone(other.idToken, phone);
      // Identity Toolkit answers with a temporaryProof instead of linking; the web SDK
      // surfaces this as auth/credential-already-in-use.
      assert.notEqual(r.body.localId, other.localId);
      assert.ok(r.body.temporaryProof || r.body.error, 'phone was not linked');
      const { users } = await ok('accounts:lookup', { idToken: other.idToken });
      assert.equal(users[0].phoneNumber, undefined, 'second account still has no phone');
      const profile = await api('POST', '/api/farmers/me', other.idToken, profileBody('Other'));
      assert.equal(profile.body.code, 'PHONE_NOT_VERIFIED');
    });

    test('phone OTP recovery signs into the same account (proof of phone control)', async () => {
      const { sessionInfo, code } = await sendPhoneCode(phone);
      const r = await ok('accounts:signInWithPhoneNumber', { sessionInfo, code });
      assert.equal(r.localId, uid);
      assert.equal(r.isNewUser, false);
    });
  });

  describe('Google sign-in', () => {
    const gEmail = `google.${run}@gmail.com`;
    const gSub = `g-${run}`;
    const phone = `+9197${rand8()}`;
    let uid;

    test('new Google farmer must verify phone, then completes registration', async () => {
      const first = await googleSignIn({ sub: gSub, email: gEmail });
      assert.equal(first.status, 200);
      uid = first.body.localId;
      createdEmails.push(gEmail);

      let r = await api('POST', '/api/farmers/me', first.body.idToken, profileBody('Google Farmer'));
      assert.equal(r.body.code, 'PHONE_NOT_VERIFIED');

      const linked = await linkPhone(first.body.idToken, phone);
      assert.equal(linked.body.localId, uid);
      r = await api('POST', '/api/farmers/me', linked.body.idToken, profileBody('Google Farmer'));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.farmer.emailVerified, true, 'Google email is verified by the provider');
      assert.equal(await waitForWelcome(gEmail), 1);
    });

    test('Google login again reuses the same account and profile (no duplicates)', async () => {
      const again = await googleSignIn({ sub: gSub, email: gEmail });
      assert.equal(again.body.localId, uid);
      const me = await api('GET', '/api/farmers/me', again.body.idToken);
      assert.equal(me.status, 200);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM farmers WHERE email = $1', [gEmail]);
      assert.equal(rows[0].n, 1);
    });

    test('signed-in email/password farmer can link Google to the same account', async () => {
      const email = `link.${run}@example.in`;
      const created = await signUp(email, 'Fasal@2026x');
      const linked = await googleSignIn({ sub: `g-link-${run}`, email, idToken: created.idToken });
      assert.equal(linked.status, 200);
      assert.equal(linked.body.localId, created.localId, 'Google linked to the authenticated account');
      const relog = await googleSignIn({ sub: `g-link-${run}`, email });
      assert.equal(relog.body.localId, created.localId);
    });

    test('a Google identity already used by another account cannot be linked again', async () => {
      const other = await signUp(`steal.${run}@example.in`, 'Fasal@2026x');
      const r = await googleSignIn({ sub: gSub, email: gEmail, idToken: other.idToken });
      const sameAccount = r.status === 200 && r.body.localId === other.localId;
      assert.equal(sameAccount, false, 'must not move the Google identity to another account');
    });
  });

  test('tampered token is rejected', async () => {
    const r = await api('GET', '/api/farmers/me', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.');
    assert.equal(r.status, 401);
  });
});
