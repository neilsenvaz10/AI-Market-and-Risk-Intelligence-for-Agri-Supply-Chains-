/**
 * Operator logic for the `admin` custom claim. Uses an in-memory fake of the Firebase
 * Admin SDK Auth object: no network, no Firebase project, no real account is touched.
 * The real operator script is never executed by these tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChange, findAdmins, inspectAccount, maskEmail, planChange } from '../src/admin/adminClaim.js';
import { run } from '../scripts/firebase-admin-claim.js';

function fakeAuth(seed = [], { persist = true } = {}) {
  const users = new Map(seed.map((u) => [u.uid, structuredClone(u)]));
  const calls = [];
  return {
    calls,
    users,
    app: { options: { projectId: 'demo-fasalytics' } },
    async getUser(uid) {
      calls.push(['getUser', uid]);
      const user = users.get(uid);
      if (!user) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
      return structuredClone(user);
    },
    async setCustomUserClaims(uid, claims) {
      calls.push(['setCustomUserClaims', uid, claims]);
      if (persist) users.get(uid).customClaims = claims === null ? {} : structuredClone(claims);
    },
    async revokeRefreshTokens(uid) { calls.push(['revokeRefreshTokens', uid]); },
    async listUsers(max, pageToken) {
      calls.push(['listUsers', max, pageToken]);
      const all = [...users.values()];
      const start = pageToken ? Number(pageToken) : 0;
      const page = all.slice(start, start + max);
      return { users: structuredClone(page), pageToken: start + max < all.length ? String(start + max) : undefined };
    },
  };
}
const writes = (auth) => auth.calls.filter(([name]) => ['setCustomUserClaims', 'revokeRefreshTokens'].includes(name));
const user = (uid, extra = {}) => ({ uid, email: `${uid}@example.in`, emailVerified: true, disabled: false, customClaims: {}, ...extra });

test('maskEmail hides the local part', () => {
  assert.equal(maskEmail('ramesh@example.in'), 'r***@example.in');
  assert.equal(maskEmail('not-an-email'), null);
});

test('status is read-only and never exposes the full e-mail address', async () => {
  const auth = fakeAuth([user('operator1', { customClaims: { admin: true, region: 'MH' } })]);
  const summary = await inspectAccount(auth, 'operator1');
  assert.deepEqual(summary, { uid: 'operator1', email: 'o***@example.in', emailVerified: true, disabled: false, isAdmin: true, otherClaimNames: ['region'] });
  assert.equal(writes(auth).length, 0);
});

test('grant: sets admin, preserves other claims, and verifies the result', async () => {
  const auth = fakeAuth([user('operator1', { customClaims: { region: 'MH' } })]);
  const result = await applyChange(auth, 'operator1', 'grant');
  assert.equal(result.applied, true);
  assert.deepEqual(auth.users.get('operator1').customClaims, { region: 'MH', admin: true });
  assert.deepEqual(writes(auth), [['setCustomUserClaims', 'operator1', { region: 'MH', admin: true }]]);
  assert.equal(result.account.isAdmin, true);
});

test('grant is idempotent: an existing administrator causes no writes', async () => {
  const auth = fakeAuth([user('operator1', { customClaims: { admin: true } })]);
  const result = await applyChange(auth, 'operator1', 'grant');
  assert.equal(result.applied, false);
  assert.equal(writes(auth).length, 0);
});

test('grant is refused for disabled accounts, unverified e-mail and accounts without e-mail', async () => {
  const auth = fakeAuth([
    user('disabled1', { disabled: true }),
    user('unverified1', { emailVerified: false }),
    user('noemail1', { email: undefined }),
  ]);
  for (const uid of ['disabled1', 'unverified1', 'noemail1']) {
    await assert.rejects(applyChange(auth, uid, 'grant'), { code: 'CHANGE_REFUSED' });
  }
  assert.equal(writes(auth).length, 0);
});

test('grant is refused for unknown accounts and malformed uids', async () => {
  const auth = fakeAuth([]);
  await assert.rejects(applyChange(auth, 'missing-user', 'grant'), { code: 'auth/user-not-found' });
  for (const bad of ['', 'x', 'has space', '../etc', 'a'.repeat(200), undefined, 42]) {
    await assert.rejects(applyChange(auth, bad, 'grant'), { code: 'INVALID_UID' });
  }
  await assert.rejects(planChange(auth, 'missing-user', 'promote'), { code: 'INVALID_ACTION' });
  assert.equal(writes(auth).length, 0);
});

test('grant is refused when the claims would exceed the 1000-byte Firebase limit', async () => {
  const auth = fakeAuth([user('bigclaims1', { customClaims: { blob: 'x'.repeat(995) } })]);
  await assert.rejects(applyChange(auth, 'bigclaims1', 'grant'), { code: 'CHANGE_REFUSED' });
});

test('revoke: removes only admin, revokes refresh tokens, keeps other claims', async () => {
  const auth = fakeAuth([user('operator1', { customClaims: { admin: true, region: 'MH' } })]);
  const result = await applyChange(auth, 'operator1', 'revoke');
  assert.equal(result.applied, true);
  assert.deepEqual(auth.users.get('operator1').customClaims, { region: 'MH' });
  assert.deepEqual(writes(auth).map(([name]) => name), ['setCustomUserClaims', 'revokeRefreshTokens']);
});

test('revoke of the only claim clears claims; revoking a non-admin changes nothing', async () => {
  const solo = fakeAuth([user('operator1', { customClaims: { admin: true } })]);
  await applyChange(solo, 'operator1', 'revoke');
  assert.deepEqual(solo.calls.find(([n]) => n === 'setCustomUserClaims'), ['setCustomUserClaims', 'operator1', null]);
  const farmer = fakeAuth([user('farmer1')]);
  const result = await applyChange(farmer, 'farmer1', 'revoke');
  assert.equal(result.applied, false);
  assert.equal(writes(farmer).length, 0);
});

test('revoke is allowed for disabled accounts (so a compromised admin can always be removed)', async () => {
  const auth = fakeAuth([user('operator1', { disabled: true, customClaims: { admin: true } })]);
  assert.equal((await applyChange(auth, 'operator1', 'revoke')).applied, true);
});

test('a write that does not persist is detected', async () => {
  const auth = fakeAuth([user('operator1')], { persist: false });
  await assert.rejects(applyChange(auth, 'operator1', 'grant'), { code: 'VERIFY_FAILED' });
});

test('list pages through accounts and reports whether the scan was complete', async () => {
  const seed = Array.from({ length: 2500 }, (_, i) => user(`user${String(i).padStart(5, '0')}`, i % 500 === 0 ? { customClaims: { admin: true } } : {}));
  const auth = fakeAuth(seed);
  const all = await findAdmins(auth);
  assert.equal(all.scanned, 2500);
  assert.equal(all.complete, true);
  assert.equal(all.admins.length, 5);
  assert.ok(all.admins.every((a) => a.email.startsWith('u***@')));
  const partial = await findAdmins(auth, { maxUsers: 1000 });
  assert.equal(partial.complete, false);
});

// ── Operator CLI logic (run() with an injected fake; the real script is not executed) ──

async function cli(argv, { auth = fakeAuth([user('operator1')]), projectId = 'demo-fasalytics', emulatorHost, getAuth } = {}) {
  const out = [];
  const err = [];
  const code = await run(argv, {
    getAuth: getAuth || (() => auth), projectId, emulatorHost, out: (m) => out.push(String(m)), err: (m) => err.push(String(m)),
  });
  return { code, text: out.join('\n'), errText: err.join('\n'), auth };
}

test('CLI: grant is a DRY RUN by default and changes nothing', async () => {
  const r = await cli(['grant', '--uid=operator1']);
  assert.equal(r.code, 0);
  assert.match(r.text, /DRY RUN/);
  assert.match(r.text, /--apply --confirm-project=demo-fasalytics/);
  assert.equal(writes(r.auth).length, 0);
});

test('CLI: --apply without the matching --confirm-project is refused', async () => {
  for (const argv of [
    ['grant', '--uid=operator1', '--apply'],
    ['grant', '--uid=operator1', '--apply', '--confirm-project=some-other-project'],
    ['revoke', '--uid=operator1', '--apply', '--confirm-project='],
  ]) {
    const r = await cli(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.errText, /--confirm-project must equal/);
    assert.equal(writes(r.auth).length, 0);
  }
});

test('CLI: grant with --apply and the right project id applies once and masks the e-mail', async () => {
  const r = await cli(['grant', '--uid=operator1', '--apply', '--confirm-project=demo-fasalytics']);
  assert.equal(r.code, 0);
  assert.equal(r.auth.users.get('operator1').customClaims.admin, true);
  assert.match(r.text, /must sign in again/);
  assert.ok(!r.text.includes('operator1@example.in'));
  assert.match(r.text, /o\*\*\*@example\.in/);
});

test('CLI: the target project (or Auth Emulator) is always announced first', async () => {
  const live = await cli(['status', '--uid=operator1'], { projectId: 'my-prod-project' });
  assert.match(live.text.split('\n')[0], /Firebase project "my-prod-project" \(LIVE\)/);
  const emulator = await cli(['status', '--uid=operator1'], { emulatorHost: '127.0.0.1:9099' });
  assert.match(emulator.text.split('\n')[0], /EMULATOR \(127\.0\.0\.1:9099\)/);
});

test('CLI: secrets on the command line are rejected without echoing the value', async () => {
  for (const argv of [['status', '--uid=operator1', '--api-key=SUPERSECRETVALUE'], ['list', '--token=SUPERSECRETVALUE'], ['list', '--password=SUPERSECRETVALUE']]) {
    const r = await cli(argv);
    assert.equal(r.code, 2);
    assert.ok(!r.errText.includes('SUPERSECRETVALUE'));
    assert.match(r.errText, /secrets must never be passed on the command line/);
  }
});

test('CLI: usage errors and missing credentials produce clear failures', async () => {
  assert.equal((await cli(['promote'])).code, 2);
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(['grant'])).code, 2);
  const noCreds = await cli(['list'], { getAuth: () => { throw Object.assign(new Error('x'), { code: 'auth/admin-credentials-missing' }); } });
  assert.equal(noCreds.code, 1);
  assert.match(noCreds.errText, /no service account configured/);
});

test('CLI: refused grants and unknown accounts exit non-zero without writing', async () => {
  const auth = fakeAuth([user('unverified1', { emailVerified: false })]);
  assert.equal((await cli(['grant', '--uid=unverified1', '--apply', '--confirm-project=demo-fasalytics'], { auth })).code, 1);
  assert.equal((await cli(['grant', '--uid=nobody-here', '--apply', '--confirm-project=demo-fasalytics'], { auth })).code, 1);
  assert.equal(writes(auth).length, 0);
});

test('CLI: list and status are read-only', async () => {
  const auth = fakeAuth([user('operator1', { customClaims: { admin: true } }), user('farmer1')]);
  const listed = await cli(['list'], { auth });
  assert.equal(listed.code, 0);
  assert.match(listed.text, /"uid": "operator1"/);
  assert.ok(!listed.text.includes('farmer1'));
  assert.equal((await cli(['status', '--uid=farmer1'], { auth })).code, 0);
  assert.equal(writes(auth).length, 0);
});
