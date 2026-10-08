import { verifyFirebaseIdToken } from '../config/firebaseAdmin.js';

function authError(res, statusCode, code, message) {
  return res.status(statusCode).json({ status: 'error', code, message });
}

/**
 * Creates middleware that requires a valid Firebase ID token:
 *   Authorization: Bearer <firebase-id-token>
 *
 * On success, sets req.auth = { uid, phoneNumber, email, emailVerified, signInProvider, claims }.
 * The UID always comes from the verified token — never from client input.
 *
 * @param {(token: string) => Promise<object>} verifyIdToken injectable for tests
 */
export function createRequireAuth(verifyIdToken = verifyFirebaseIdToken) {
  return async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      return authError(res, 401, 'AUTH_REQUIRED', 'Authentication required. Please log in.');
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
      return next();
    } catch (err) {
      if (err.code === 'auth/not-configured') {
        return authError(res, 503, 'AUTH_NOT_CONFIGURED', 'Authentication service is not configured on the server.');
      }
      if (err.code === 'auth/id-token-expired') {
        return authError(res, 401, 'TOKEN_EXPIRED', 'Your session has expired. Please log in again.');
      }
      if (err.code === 'auth/id-token-revoked' || err.code === 'auth/user-disabled') {
        return authError(res, 401, 'SESSION_REVOKED', 'Your session is no longer valid. Please log in again.');
      }
      if (err.code === 'app/network-error') {
        return authError(res, 503, 'AUTH_UNAVAILABLE', 'Unable to verify your session right now. Please try again.');
      }
      return authError(res, 401, 'INVALID_TOKEN', 'Invalid authentication token. Please log in again.');
    }
  };
}

export const requireAuth = createRequireAuth();
