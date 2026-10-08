import fs from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from './index.js';

let authInstance = null;
let initError = null;

/**
 * Lazily initializes Firebase Admin.
 *
 * Verifying ID tokens only needs the project ID (public signing keys are
 * fetched from Google). A service account is optional and only required for
 * privileged Admin operations in later phases. Credentials never leave the
 * backend.
 */
function initFirebaseAdmin() {
  if (authInstance || initError) return;

  const { projectId, serviceAccountPath, clientEmail, privateKey, authEmulatorHost } = config.firebase;

  try {
    const options = {};

    if (serviceAccountPath) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      options.credential = cert(serviceAccount);
      options.projectId = projectId || serviceAccount.project_id;
    } else if (clientEmail && privateKey && projectId) {
      options.credential = cert({ projectId, clientEmail, privateKey });
      options.projectId = projectId;
    } else if (projectId) {
      options.projectId = projectId;
    } else {
      throw new Error('FIREBASE_PROJECT_ID (or a service account) is not configured');
    }

    if (authEmulatorHost) {
      console.warn(`[Firebase] Using Auth Emulator at ${authEmulatorHost} — development only, never set in production.`);
    }

    const app = getApps().length ? getApps()[0] : initializeApp(options);
    authInstance = getAuth(app);
    console.log(`[Firebase] Admin SDK initialized for project "${options.projectId}"`);
  } catch (err) {
    initError = err;
    console.error('[Firebase] Admin SDK not initialized:', err.message);
  }
}

export function isFirebaseAdminReady() {
  initFirebaseAdmin();
  return Boolean(authInstance);
}

/**
 * Verifies a Firebase ID token and returns the decoded claims.
 * Throws an error with code 'auth/not-configured' when Firebase Admin is unavailable.
 */
export async function verifyFirebaseIdToken(idToken) {
  initFirebaseAdmin();
  if (!authInstance) {
    const err = new Error('Firebase Admin is not configured');
    err.code = 'auth/not-configured';
    throw err;
  }
  return authInstance.verifyIdToken(idToken);
}
