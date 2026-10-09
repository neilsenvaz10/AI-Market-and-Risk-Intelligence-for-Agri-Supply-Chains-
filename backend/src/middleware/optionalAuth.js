import { verifyFirebaseIdToken } from '../config/firebaseAdmin.js';

/**
 * Creates optional authentication middleware.
 * Attaches req.auth when a valid Bearer token is present, but allows unauthenticated
 * requests to proceed without error.
 *
 * @param {(token: string) => Promise<object>} verifyIdToken injectable for tests
 */
export function createOptionalAuth(verifyIdToken = verifyFirebaseIdToken) {
  return async function optionalAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      return next();
    }

    try {
      const decoded = await verifyIdToken(match[1]);
      req.auth = {
        uid: decoded.uid,
        phoneNumber: decoded.phone_number || null,
        email: decoded.email ? String(decoded.email).toLowerCase() : null,
        emailVerified: decoded.email_verified === true,
        signInProvider: decoded.firebase?.sign_in_provider || null,
        claims: decoded,
      };
    } catch {
      // Ignored for optional authentication — proceeds without req.auth
    }

    return next();
  };
}

export const optionalAuth = createOptionalAuth();
