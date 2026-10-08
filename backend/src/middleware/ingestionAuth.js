/**
 * Authorisation for manual mandi ingestion (POST /api/mandi/sync).
 *
 * Runs AFTER requireAuth (which verifies the Firebase ID token and sets req.auth).
 * An account may start ingestion only when ALL of these hold:
 *   1. the verified ID token carries the custom claim `admin === true` (strict boolean);
 *   2. the token's email is verified;
 *   3. a LIVE lookup of the account through the Firebase Admin SDK confirms the claim
 *      is still `admin === true` and the account is not disabled.
 *
 * Why the live lookup: custom claims travel inside ID tokens that stay valid for up to an
 * hour, so a token alone cannot honour a revocation. Checking the account record makes
 * revocation immediate. If the lookup cannot be made (no service account configured,
 * Firebase unreachable, timeout) the request is REFUSED with 503 — the check fails closed.
 *
 * Claims can only be written with Admin SDK credentials (see scripts/firebase-admin-claim.js);
 * nothing a client sends can create or alter them.
 */
import { getFirebaseUserRecord } from '../config/firebaseAdmin.js';

export const ADMIN_CLAIM = 'admin';
const LOOKUP_TIMEOUT_MS = 5000;

const reply = (res, status, code, message) => res.status(status).json({ status: 'error', code, message });

const FORBIDDEN = ['INGESTION_FORBIDDEN', 'Your account is not authorised to start mandi data ingestion.'];
const UNAVAILABLE = ['ADMIN_VERIFICATION_UNAVAILABLE', 'Administrator status could not be verified right now. Please try again later.'];

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('lookup timed out'), { code: 'auth/lookup-timeout' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} options
 * @param {(uid: string) => Promise<{customClaims?: object, disabled?: boolean}>} options.lookupUser
 *        injectable for tests; defaults to the Firebase Admin SDK.
 * @param {{warn: Function}} options.log receives one audit line per decision (uid + reason only — never tokens).
 */
export function createRequireAdminClaim({ lookupUser = getFirebaseUserRecord, log = console, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const audit = (decision, req, reason) =>
    log.warn?.(`[Security] mandi ingestion ${decision} uid=${req.auth?.uid ?? 'unknown'} reason=${reason}`);

  return async function requireAdminClaim(req, res, next) {
    const auth = req.auth;
    if (!auth?.uid) {
      // Defensive: requireAuth must run first. Never authorise without a verified identity.
      audit('denied', req, 'no-verified-identity');
      return reply(res, 401, 'AUTH_REQUIRED', 'Authentication required. Please log in.');
    }
    if (auth.claims?.[ADMIN_CLAIM] !== true) {
      audit('denied', req, 'no-admin-claim');
      return reply(res, 403, ...FORBIDDEN);
    }
    if (auth.emailVerified !== true) {
      audit('denied', req, 'email-not-verified');
      return reply(res, 403, ...FORBIDDEN);
    }

    let user;
    try {
      user = await withTimeout(Promise.resolve(lookupUser(auth.uid)), timeoutMs);
    } catch (err) {
      if (err?.code === 'auth/user-not-found') {
        audit('denied', req, 'account-not-found');
        return reply(res, 403, ...FORBIDDEN);
      }
      // Only the error code is logged: SDK messages can contain request details.
      audit('refused', req, `verification-unavailable:${err?.code || 'unknown'}`);
      return reply(res, 503, ...UNAVAILABLE);
    }

    if (user?.disabled === true) {
      audit('denied', req, 'account-disabled');
      return reply(res, 403, ...FORBIDDEN);
    }
    if (user?.customClaims?.[ADMIN_CLAIM] !== true) {
      audit('denied', req, 'claim-revoked');
      return reply(res, 403, ...FORBIDDEN);
    }

    audit('authorised', req, 'admin-claim-confirmed');
    return next();
  };
}

export default createRequireAdminClaim;
