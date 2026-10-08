/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth, isFirebaseConfigured, firebaseConfigError } from '../config/firebase';
import * as authService from '../services/authService';
import * as farmerService from '../services/farmerService';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from '../i18n/languages';
import { getSetupStep } from '../utils/setupSteps';

const AuthContext = createContext(null);

const LANGUAGE_STORAGE_KEY = 'fasalytics.language';
const SIGNUP_PHONE_KEY = 'fasalytics.signupPhone';
const PASSWORD_RESET_WINDOW_MS = 10 * 60 * 1000;
const RETRYABLE_AUTH_CODES = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN']);
const SESSION_ENDED_CODES = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'SESSION_REVOKED', 'AUTH_REQUIRED']);

function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** True once the visitor (or their profile) has picked a language on this device. */
export const hasStoredLanguage = () => readStoredLanguage() !== null;

function storeLanguage(code) {
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, code); } catch { /* storage unavailable */ }
}

const session = {
  get: (key) => { try { return sessionStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* unavailable */ } },
};

/** Plain snapshot of the Firebase user so React re-renders when identity details change. */
const accountOf = (u) => (u ? {
  uid: u.uid,
  email: u.email,
  emailVerified: u.emailVerified,
  phoneNumber: u.phoneNumber,
  displayName: u.displayName,
  providers: u.providerData.map((p) => p.providerId).sort(),
} : null);

const keyOf = (a) => (a ? [a.uid, a.email, a.emailVerified, a.phoneNumber, a.providers.join(',')].join('|') : '');

/**
 * Auth state for the whole app:
 * - Firebase user + identity snapshot (email, phone, verification, providers)
 * - farmer profile from PostgreSQL and the next unmet registration step
 * - preferred language (profile value wins over the locally chosen one)
 * - in-flight OTP, pending Google link and password-reset proof
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [account, setAccount] = useState(null);
  const [initializing, setInitializing] = useState(isFirebaseConfigured);
  const [farmer, setFarmer] = useState(null);
  // 'idle' (signed out) | 'loading' | 'complete' | 'missing' | 'error'
  const [profileStatus, setProfileStatus] = useState('idle');
  const [profileError, setProfileError] = useState(null);
  const [authError, setAuthError] = useState(null); // notice shown on the login page
  const [language, setLanguageState] = useState(() => readStoredLanguage() || DEFAULT_LANGUAGE);
  const [pendingOtp, setPendingOtp] = useState(null); // { mode: 'signin'|'link'|'reset', phoneDigits, confirmation, sentAt }
  const [pendingGoogleLink, setPendingGoogleLink] = useState(null); // { credential, email }
  const [passwordReset, setPasswordReset] = useState(null); // { uid, at } after phone-OTP proof
  const [signupPhone, setSignupPhoneState] = useState(() => session.get(SIGNUP_PHONE_KEY));
  const loadIdRef = useRef(0);
  const accountKeyRef = useRef('');

  const setSignupPhone = useCallback((digits) => {
    setSignupPhoneState(digits || null);
    session.set(SIGNUP_PHONE_KEY, digits || null);
  }, []);

  const clearUserState = useCallback(() => {
    loadIdRef.current += 1; // ignore any in-flight profile request
    setFarmer(null);
    setProfileStatus('idle');
    setProfileError(null);
    setPendingOtp(null);
    setPendingGoogleLink(null);
    setPasswordReset(null);
    setSignupPhone(null);
  }, [setSignupPhone]);

  const endSession = useCallback(async (message) => {
    setAuthError(message || null);
    await authService.logout().catch(() => {});
  }, []);

  /**
   * Runs an API call with a fresh ID token. Retries once with a force-refreshed
   * token; if the backend still rejects it, the session is ended.
   */
  const withToken = useCallback(async (fn, firebaseUser = auth?.currentUser) => {
    if (!firebaseUser) {
      const err = new Error('You are not logged in.');
      err.code = 'AUTH_REQUIRED';
      throw err;
    }
    try {
      return await fn(await firebaseUser.getIdToken());
    } catch (err) {
      if (!RETRYABLE_AUTH_CODES.has(err.code)) throw err;
      try {
        return await fn(await firebaseUser.getIdToken(true));
      } catch (retryErr) {
        if (SESSION_ENDED_CODES.has(retryErr.code)) {
          await endSession('Your session has expired. Please log in again.');
        }
        throw retryErr;
      }
    }
  }, [endSession]);

  const applyFarmer = useCallback((profile) => {
    setFarmer(profile);
    setProfileStatus(profile ? 'complete' : 'missing');
    setProfileError(null);
    if (profile?.preferredLanguage) {
      setLanguageState(profile.preferredLanguage);
      storeLanguage(profile.preferredLanguage);
    }
  }, []);

  const loadSession = useCallback(async (firebaseUser) => {
    const loadId = ++loadIdRef.current;
    setProfileStatus('loading');
    setProfileError(null);
    try {
      const result = await withToken(farmerService.getSession, firebaseUser);
      if (loadId !== loadIdRef.current) return;
      applyFarmer(result.farmer);
    } catch (err) {
      if (loadId !== loadIdRef.current) return;
      if (SESSION_ENDED_CODES.has(err.code)) return; // endSession already signed out
      setFarmer(null);
      setProfileStatus('error');
      setProfileError(err.message || 'Unable to load your profile. Please try again.');
    }
  }, [withToken, applyFarmer]);

  /** Updates the identity snapshot; reloads the backend session only when identity changed. */
  const syncFromUser = useCallback((firebaseUser) => {
    setUser(firebaseUser);
    if (!firebaseUser) {
      accountKeyRef.current = '';
      setAccount(null);
      return;
    }
    const next = accountOf(firebaseUser);
    const key = keyOf(next);
    if (key === accountKeyRef.current) return;
    accountKeyRef.current = key;
    setAccount(next);
    loadSession(firebaseUser);
  }, [loadSession]);

  useEffect(() => {
    if (!auth) return undefined;
    // Fires on sign-in, sign-out and token refresh (incl. after linking a provider).
    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      if (!firebaseUser) clearUserState();
      syncFromUser(firebaseUser);
      setInitializing(false);
    });
    return unsubscribe;
  }, [syncFromUser, clearUserState]);

  // Completes a redirect-based Google sign-in (used when popups are blocked).
  useEffect(() => {
    authService.completeGoogleRedirect().catch((err) => {
      if (err.code === 'auth/account-exists-with-different-credential') {
        setPendingGoogleLink({ credential: authService.googleCredentialFromError(err), email: err.customData?.email || '' });
      }
      setAuthError(authService.getAuthErrorMessage(err));
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  /** Re-reads the Firebase user (e.g. after email verification) and refreshes token claims. */
  const refreshAccount = useCallback(async () => {
    const current = auth?.currentUser;
    if (!current) return null;
    await current.reload();
    await current.getIdToken(true);
    syncFromUser(auth.currentUser);
    return accountOf(auth.currentUser);
  }, [syncFromUser]);

  // ---- Email / password -------------------------------------------------

  const loginWithEmail = useCallback(async (email, password) => {
    setAuthError(null);
    const signedIn = await authService.loginWithEmail(email, password);
    // Secure account linking: Google is attached only after the farmer proved the password.
    if (pendingGoogleLink?.credential && pendingGoogleLink.email.toLowerCase() === (signedIn.email || '').toLowerCase()) {
      await authService.linkPendingCredential(signedIn, pendingGoogleLink.credential);
      setPendingGoogleLink(null);
      await signedIn.getIdToken(true);
      syncFromUser(auth.currentUser);
    }
  }, [pendingGoogleLink, syncFromUser]);

  const signUp = useCallback(async ({ fullName, email, password, phoneDigits }) => {
    setAuthError(null);
    setSignupPhone(phoneDigits);
    try {
      await authService.signUpWithEmail({ fullName, email, password });
      syncFromUser(auth.currentUser);
    } catch (err) {
      if (!auth?.currentUser) setSignupPhone(null);
      throw err;
    }
  }, [setSignupPhone, syncFromUser]);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth?.currentUser) throw Object.assign(new Error('Not logged in'), { code: 'AUTH_REQUIRED' });
    await authService.resendVerificationEmail(auth.currentUser);
  }, []);

  /** Links email/password to the current account (same UID). Returns whether the verification email went out. */
  const addEmailPassword = useCallback(async (email, password) => {
    const { user: linked, verificationEmailSent } = await authService.addEmailPassword(auth.currentUser, email, password);
    await linked.getIdToken(true);
    syncFromUser(auth.currentUser);
    return { verificationEmailSent };
  }, [syncFromUser]);

  /** Verify-first path (email enumeration protection): emails a one-time link proving ownership. */
  const startVerifiedEmailUpgrade = useCallback((email) => authService.sendEmailOwnershipLink(email), []);

  /** Opened from that link: link the verified email to THIS account and set the password. */
  const completeVerifiedEmailUpgrade = useCallback(async (email, emailLink, password) => {
    const current = auth.currentUser;
    await authService.linkVerifiedEmailAndSetPassword(current, email, emailLink, password);
    await current.getIdToken(true);
    syncFromUser(auth.currentUser);
  }, [syncFromUser]);

  /** Adds a password to an account that already has a verified email but no login method. */
  const createPasswordForAccount = useCallback(async (password) => {
    const current = auth.currentUser;
    await authService.setPasswordOnVerifiedAccount(current, password);
    await current.getIdToken(true);
    syncFromUser(auth.currentUser);
  }, [syncFromUser]);

  // ---- Google -------------------------------------------------------------

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await authService.signInWithGoogle();
    } catch (err) {
      if (err.code === 'auth/account-exists-with-different-credential') {
        // Never merge automatically: remember the Google credential and require the existing password.
        setPendingGoogleLink({ credential: authService.googleCredentialFromError(err), email: err.customData?.email || '' });
      }
      throw err;
    }
  }, []);

  const linkGoogle = useCallback(async () => {
    const result = await authService.linkGoogle(auth.currentUser);
    if (result) {
      await result.user.getIdToken(true);
      syncFromUser(auth.currentUser);
    }
  }, [syncFromUser]);

  // ---- Phone OTP ----------------------------------------------------------

  /** mode: 'signin' (mobile login), 'link' (registration), 'reset' (password recovery). */
  const startOtp = useCallback(async (phoneDigits, mode = 'signin') => {
    setAuthError(null);
    const confirmation = mode === 'link'
      ? await authService.sendLinkOtp(auth.currentUser, phoneDigits, language)
      : await authService.sendOtp(phoneDigits, language);
    setPendingOtp({ mode, phoneDigits, confirmation, sentAt: Date.now() });
  }, [language]);

  const resendOtp = useCallback(
    () => startOtp(pendingOtp.phoneDigits, pendingOtp.mode),
    [pendingOtp, startOtp],
  );

  /** Confirms the OTP for the pending mode. Returns the mode that was completed. */
  const confirmOtp = useCallback(async (code) => {
    if (!pendingOtp) {
      const err = new Error('No OTP request in progress.');
      err.code = 'auth/session-expired';
      throw err;
    }
    const { mode } = pendingOtp;
    let verified;
    try {
      verified = await authService.verifyOtp(pendingOtp.confirmation, code);
    } catch (err) {
      // Linking a number that already belongs to another Firebase account
      if (mode === 'link' && ['auth/credential-already-in-use', 'auth/account-exists-with-different-credential'].includes(err.code)) {
        throw Object.assign(new Error('This mobile number is already linked to another FASALYTICS account.'), { code: 'fasalytics/phone-in-use' });
      }
      throw err;
    }
    const { result, isNewUser } = verified;

    if (mode === 'reset') {
      if (isNewUser) {
        // Phone proven, but no FASALYTICS account uses it: remove the account Firebase just created.
        await result.user.delete().catch(() => authService.logout());
        setPendingOtp(null);
        const err = new Error('No FASALYTICS account is linked to this mobile number.');
        err.code = 'fasalytics/no-account-for-phone';
        throw err;
      }
      setPasswordReset({ uid: result.user.uid, at: Date.now() });
    }
    if (mode === 'link') {
      setSignupPhone(null);
      await result.user.getIdToken(true); // new token carries phone_number for the backend
      syncFromUser(auth.currentUser);
    }
    setPendingOtp(null);
    return mode;
  }, [pendingOtp, setSignupPhone, syncFromUser]);

  // ---- Password recovery ----------------------------------------------------

  // Phone-OTP proof for password reset expires after a short window.
  useEffect(() => {
    if (!passwordReset) return undefined;
    const id = setTimeout(() => setPasswordReset(null), PASSWORD_RESET_WINDOW_MS - (Date.now() - passwordReset.at));
    return () => clearTimeout(id);
  }, [passwordReset]);

  const hasPasswordResetProof = Boolean(passwordReset && user && passwordReset.uid === user.uid);

  /** Sets a new password after phone-OTP proof, then signs out so the farmer logs in with it. */
  const resetPassword = useCallback(async (newPassword) => {
    if (!hasPasswordResetProof || Date.now() - passwordReset.at >= PASSWORD_RESET_WINDOW_MS) {
      const err = new Error('Please verify your mobile number again to reset your password.');
      err.code = 'fasalytics/reset-expired';
      throw err;
    }
    const outcome = await authService.setNewPassword(auth.currentUser, newPassword);
    await authService.logout();
    clearUserState();
    setAuthError(outcome === 'updated'
      ? 'Your password has been updated. Log in with your new password.'
      : 'Your password has been created. You can now log in with your email and password.');
    return outcome;
  }, [hasPasswordResetProof, passwordReset, clearUserState]);

  // ---- Profile ----------------------------------------------------------------

  const registerProfile = useCallback(async (profile) => {
    const created = await withToken((token) => farmerService.createMyProfile(token, profile));
    applyFarmer(created);
    return created;
  }, [withToken, applyFarmer]);

  const saveProfile = useCallback(async (changes) => {
    const updated = await withToken((token) => farmerService.updateMyProfile(token, changes));
    applyFarmer(updated);
    return updated;
  }, [withToken, applyFarmer]);

  /** Changes the UI language; persisted to PostgreSQL when a profile exists. */
  const setLanguage = useCallback(async (code) => {
    if (!isSupportedLanguage(code) || code === language) return;
    setLanguageState(code);
    storeLanguage(code);
    if (farmer && farmer.preferredLanguage !== code) {
      setFarmer((prev) => (prev ? { ...prev, preferredLanguage: code } : prev));
      try {
        await saveProfile({ preferredLanguage: code });
      } catch (err) {
        console.warn('Could not sync language preference to profile:', err);
      }
    }
  }, [language, farmer, saveProfile]);

  /**
   * Explicit logout. Throws if Firebase signOut() fails so the UI can report it;
   * user-specific state is cleared only after sign-out succeeds.
   * The PostgreSQL profile is untouched.
   */
  const logout = useCallback(async () => {
    await authService.logout();
    clearUserState();
    setAuthError(null);
  }, [clearUserState]);

  const setupStep = getSetupStep(account, profileStatus);

  const value = useMemo(() => ({
    user,
    account,
    farmer,
    initializing,
    profileStatus,
    profileError,
    authError,
    language,
    pendingOtp,
    pendingGoogleLink,
    signupPhone,
    setupStep,
    hasPasswordResetProof,
    isAuthenticated: Boolean(user),
    isProfileComplete: profileStatus === 'complete',
    isFirebaseConfigured,
    firebaseConfigError,
    loginWithEmail,
    signUp,
    signInWithGoogle,
    linkGoogle,
    addEmailPassword,
    startVerifiedEmailUpgrade,
    completeVerifiedEmailUpgrade,
    createPasswordForAccount,
    resendVerificationEmail,
    refreshAccount,
    startOtp,
    resendOtp,
    confirmOtp,
    clearPendingOtp: () => setPendingOtp(null),
    clearPendingGoogleLink: () => setPendingGoogleLink(null),
    resetPassword,
    registerProfile,
    saveProfile,
    setLanguage,
    reloadProfile: () => (auth?.currentUser ? loadSession(auth.currentUser) : Promise.resolve()),
    logout,
  }), [user, account, farmer, initializing, profileStatus, profileError, authError, language, pendingOtp,
    pendingGoogleLink, signupPhone, setupStep, hasPasswordResetProof, loginWithEmail, signUp, signInWithGoogle,
    linkGoogle, addEmailPassword, startVerifiedEmailUpgrade, completeVerifiedEmailUpgrade, createPasswordForAccount,
    resendVerificationEmail, refreshAccount, startOtp, resendOtp, confirmOtp,
    resetPassword, registerProfile, saveProfile, setLanguage, loadSession, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Shared logout action for buttons/menus: signs out, then replaces the current
 * history entry with /login. Exposes a loading flag and a user-facing error.
 */
export function useLogout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setLogoutError('Could not log out. Please check your connection and try again.');
    } finally {
      setLoggingOut(false);
    }
  }, [logout, navigate]);

  return { logout: handleLogout, loggingOut, logoutError };
}
