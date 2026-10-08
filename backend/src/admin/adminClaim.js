/**
 * Administrator custom claim (`admin: true`) management — logic only.
 *
 * Used by the trusted operator script (scripts/firebase-admin-claim.js). Nothing in the
 * HTTP server imports this module, so no request can grant or change claims. All Firebase
 * access goes through an injected Admin SDK `auth` object, which keeps the logic testable
 * with an in-memory fake and guarantees tests never reach a real project.
 *
 * Rules enforced here (not in the CLI), so every caller gets them:
 *   - grant only to an existing, enabled account with a verified email;
 *   - other custom claims on the account are preserved;
 *   - revoke removes only `admin` and revokes the refresh tokens so sessions must re-authenticate;
 *   - output never contains tokens or full e-mail addresses.
 */
export const ADMIN_CLAIM = 'admin';
const MAX_CLAIMS_BYTES = 1000; // Firebase limit for custom claims

export function maskEmail(email) {
  if (!email || !email.includes('@')) return null;
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

function summarise(user) {
  const claims = user.customClaims || {};
  return {
    uid: user.uid,
    email: maskEmail(user.email),
    emailVerified: user.emailVerified === true,
    disabled: user.disabled === true,
    isAdmin: claims[ADMIN_CLAIM] === true,
    otherClaimNames: Object.keys(claims).filter((name) => name !== ADMIN_CLAIM).sort(),
  };
}

function assertUid(uid) {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9:_-]{6,128}$/.test(uid)) {
    throw Object.assign(new Error('uid must be a Firebase UID (6-128 characters: letters, digits, - _ :)'), { code: 'INVALID_UID' });
  }
}

/** Read-only: describes the account and what grant/revoke would do. */
export async function inspectAccount(auth, uid) {
  assertUid(uid);
  const user = await auth.getUser(uid);
  return summarise(user);
}

/**
 * Computes a change without applying it.
 * @returns {{ account: object, action: string, willChange: boolean, problems: string[], nextClaims: object|null }}
 */
export async function planChange(auth, uid, action) {
  if (!['grant', 'revoke'].includes(action)) throw Object.assign(new Error(`unknown action "${action}"`), { code: 'INVALID_ACTION' });
  assertUid(uid);
  const user = await auth.getUser(uid);
  const claims = { ...(user.customClaims || {}) };
  const account = summarise(user);
  const problems = [];

  if (action === 'grant') {
    if (account.disabled) problems.push('account is disabled');
    if (!account.emailVerified) problems.push('email address is not verified');
    if (!account.email) problems.push('account has no email address');
  }
  const has = claims[ADMIN_CLAIM] === true;
  const willChange = action === 'grant' ? !has : has || ADMIN_CLAIM in claims;
  const next = { ...claims };
  if (action === 'grant') next[ADMIN_CLAIM] = true;
  else delete next[ADMIN_CLAIM];
  if (Buffer.byteLength(JSON.stringify(next)) > MAX_CLAIMS_BYTES) problems.push('custom claims would exceed the 1000-byte limit');

  return {
    account,
    action,
    willChange,
    problems,
    nextClaims: Object.keys(next).length ? next : null,
    note: !willChange ? (action === 'grant' ? 'account is already an administrator' : 'account has no admin claim') : null,
  };
}

/** Applies a planned change. Refuses when the plan has problems; a no-op change touches nothing. */
export async function applyChange(auth, uid, action) {
  const plan = await planChange(auth, uid, action);
  if (plan.problems.length) {
    throw Object.assign(new Error(`refused: ${plan.problems.join('; ')}`), { code: 'CHANGE_REFUSED', plan });
  }
  if (!plan.willChange) return { ...plan, applied: false };
  await auth.setCustomUserClaims(uid, plan.nextClaims);
  if (action === 'revoke') await auth.revokeRefreshTokens(uid);
  const after = await auth.getUser(uid);
  const now = summarise(after);
  const expected = action === 'grant';
  if (now.isAdmin !== expected) {
    throw Object.assign(new Error('verification after write failed: claim state does not match the request'), { code: 'VERIFY_FAILED' });
  }
  return { ...plan, applied: true, account: now };
}

/** Read-only audit: lists accounts that currently hold the claim (scans at most maxUsers accounts). */
export async function findAdmins(auth, { maxUsers = 5000 } = {}) {
  const admins = [];
  let scanned = 0;
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      scanned += 1;
      if (user.customClaims?.[ADMIN_CLAIM] === true) admins.push(summarise(user));
    }
    pageToken = page.pageToken;
  } while (pageToken && scanned < maxUsers);
  return { scanned, complete: !pageToken, admins };
}
