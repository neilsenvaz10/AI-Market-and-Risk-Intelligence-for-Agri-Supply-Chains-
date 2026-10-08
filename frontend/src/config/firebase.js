/**
 * FASALYTICS - Firebase client initialization
 *
 * The web config (API key, project id, ...) identifies the Firebase project
 * and is safe to ship to the browser. It is NOT a service-account credential;
 * those live only on the backend.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
};

// Development only: route auth to the local Firebase Auth Emulator.
const emulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missingKeys = REQUIRED_KEYS.filter((key) => !firebaseConfig[key]);

export const isFirebaseConfigured = missingKeys.length === 0;
export const firebaseProjectId = firebaseConfig.projectId || null;
export const isUsingAuthEmulator = Boolean(emulatorUrl);
export const firebaseConfigError = isFirebaseConfigured
  ? null
  : `Firebase is not configured. Missing: ${missingKeys
      .map((k) => `VITE_FIREBASE_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`)
      .join(', ')}`;

let auth = null;

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Keep farmers signed in across refreshes and browser restarts.
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  if (emulatorUrl) {
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
    console.warn('[Firebase] Auth Emulator in use — development only.');
  }
} else {
  console.warn(`[Firebase] ${firebaseConfigError}`);
}

export { auth };
