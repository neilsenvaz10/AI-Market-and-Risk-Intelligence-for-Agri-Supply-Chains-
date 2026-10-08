/**
 * FASALYTICS - Firebase Authentication helpers
 *
 * Email/password, Google and Phone (OTP) providers, account linking and
 * password management. OTPs, password hashing and verification emails are all
 * handled by Firebase — nothing secret is generated or stored by the app.
 */
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  getRedirectResult,
  linkWithCredential,
  linkWithPhoneNumber,
  linkWithPopup,
  linkWithRedirect,
  reauthenticateWithCredential,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  updateProfile,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
} from 'firebase/auth';
import { auth, firebaseConfigError, firebaseProjectId } from '../config/firebase';

export const RECAPTCHA_CONTAINER_ID = 'recaptcha-container';
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_LENGTH = 6;

let recaptchaVerifier = null;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validates a 10-digit Indian mobile number (starts with 6-9). */
export function validateIndianMobile(digits) {
  const clean = String(digits || '').replace(/\D/g, '');
  if (!clean) return 'Please enter your mobile number.';
  if (clean.length !== 10) return 'Mobile number must be exactly 10 digits.';
  if (!/^[6-9]/.test(clean)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
  return null;
}

export const toE164India = (digits) => `+91${String(digits).replace(/\D/g, '')}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Any valid email provider (Gmail, Yahoo, Outlook, custom domains...). */
export function validateEmail(email) {
  const clean = String(email || '').trim();
  if (!clean) return 'Please enter your email address.';
  if (clean.length > 254 || !EMAIL_RE.test(clean)) return 'Please enter a valid email address.';
  return null;
}

export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'One lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'One number (0-9)', test: (p) => /\d/.test(p) },
];

export function validatePassword(password) {
  const p = String(password || '');
  if (!p) return 'Please enter a password.';
  if (p.length > 128) return 'Password must be at most 128 characters.';
  const failed = PASSWORD_RULES.find((rule) => !rule.test(p));
  return failed ? `Password needs: ${failed.label.toLowerCase()}.` : null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireAuth() {
  if (!auth) {
    const err = new Error(firebaseConfigError);
    err.code = 'app/not-configured';
    throw err;
  }
  return auth;
}

function resetRecaptcha() {
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch { /* already cleared */ }
    recaptchaVerifier = null;
  }
  const container = document.getElementById(RECAPTCHA_CONTAINER_ID);
  if (container) container.innerHTML = '';
}

/** Creates an invisible reCAPTCHA in a fresh element (widgets cannot render twice). */
function createRecaptcha(authInstance) {
  resetRecaptcha();
  const container = document.getElementById(RECAPTCHA_CONTAINER_ID);
  if (!container) throw new Error('reCAPTCHA container is missing from the page.');
  const host = document.createElement('div');
  container.appendChild(host);
  recaptchaVerifier = new RecaptchaVerifier(authInstance, host, {
    size: 'invisible',
    'expired-callback': resetRecaptcha,
  });
  return recaptchaVerifier;
}

const emailActionSettings = () => ({ url: `${window.location.origin}/verify-email`, handleCodeInApp: false });

const googleProvider = () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
};

// Popup is preferred; these errors mean the environment needs a full-page redirect instead.
const POPUP_UNAVAILABLE = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']);

// ---------------------------------------------------------------------------
// Phone (OTP)
// ---------------------------------------------------------------------------

/**
 * Sends an OTP that SIGNS IN with the phone number (mobile login / password recovery).
 * @param {string} mobileDigits 10-digit mobile number
 * @param {string} languageCode en | hi | mr — localises the SMS and reCAPTCHA
 */
export async function sendOtp(mobileDigits, languageCode = 'en') {
  const authInstance = requireAuth();
  authInstance.languageCode = languageCode;
  const verifier = createRecaptcha(authInstance);
  try {
    return await signInWithPhoneNumber(authInstance, toE164India(mobileDigits), verifier);
  } catch (err) {
    resetRecaptcha();
    throw err;
  }
}

/** Sends an OTP that LINKS the phone number to the signed-in account (registration). */
export async function sendLinkOtp(user, mobileDigits, languageCode = 'en') {
  const authInstance = requireAuth();
  authInstance.languageCode = languageCode;
  const verifier = createRecaptcha(authInstance);
  try {
    return await linkWithPhoneNumber(user, toE164India(mobileDigits), verifier);
  } catch (err) {
    resetRecaptcha();
    throw err;
  }
}

/** Confirms an OTP. Returns the UserCredential and whether Firebase created a new user. */
export async function verifyOtp(confirmationResult, code) {
  const result = await confirmationResult.confirm(code);
  resetRecaptcha();
  return { result, isNewUser: Boolean(getAdditionalUserInfo(result)?.isNewUser) };
}

// ---------------------------------------------------------------------------
// Email / password
// ---------------------------------------------------------------------------

/** Creates an email/password account and sends Firebase's verification email. */
export async function signUpWithEmail({ fullName, email, password }) {
  const { user } = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password);
  await updateProfile(user, { displayName: fullName.trim() });
  await sendEmailVerification(user, emailActionSettings());
  return user;
}

export async function loginWithEmail(email, password) {
  const { user } = await signInWithEmailAndPassword(requireAuth(), email.trim(), password);
  return user;
}

export const resendVerificationEmail = (user) => sendEmailVerification(user, emailActionSettings());

/**
 * Extracts Firebase's server-side reason from an auth error.
 * SDK messages look like "Firebase: <server reason> (auth/<code>)." or "Firebase: Error (auth/<code>)."
 */
export function getServerReason(err) {
  const match = /^Firebase: (.*) \(auth\/[^)]+\)\.?$/.exec(err?.message || '');
  return match && match[1] !== 'Error' ? match[1] : null;
}

/** Logs the failing Firebase operation, error code and server reason (never credentials, tokens or user data). */
export function logAuthError(operation, err) {
  console.warn(`[Auth] ${operation} failed: ${err?.code || 'unknown'}${getServerReason(err) ? ` — ${getServerReason(err)}` : ''}`);
}

/**
 * True when Firebase refuses to attach an UNVERIFIED email to an existing account.
 * Projects with email enumeration protection reject linkWithCredential(EmailAuthProvider)
 * with OPERATION_NOT_ALLOWED; the email must be proven first (see sendEmailOwnershipLink).
 * (A disabled provider is reported as PASSWORD_LOGIN_DISABLED, which the SDK maps to
 * the same code but without a server reason.)
 */
export const requiresVerifiedEmailFirst = (err) =>
  err?.code === 'auth/operation-not-allowed' && Boolean(getServerReason(err));

/**
 * Adds email/password to an existing (e.g. phone-only) account — same UID — then sends
 * Firebase's verification email. A failure to send that email does not undo the link;
 * the farmer can resend it from the verification step.
 */
export async function addEmailPassword(user, email, password) {
  const credential = EmailAuthProvider.credential(email.trim(), password);
  let linked;
  try {
    ({ user: linked } = await linkWithCredential(user, credential));
  } catch (err) {
    err.operation = 'linkWithCredential';
    logAuthError(err.operation, err);
    throw err;
  }
  let verificationEmailSent = true;
  try {
    await sendEmailVerification(linked, emailActionSettings());
  } catch (err) {
    verificationEmailSent = false;
    logAuthError('sendEmailVerification', err);
  }
  return { user: linked, verificationEmailSent };
}

const EMAIL_LINK_STORAGE_KEY = 'fasalytics.emailForLinking';

/**
 * Verify-first alternative for projects that refuse unverified emails (email
 * enumeration protection): Firebase emails a one-time link proving the farmer
 * owns the address. Only the email address is remembered locally — never the password.
 */
export async function sendEmailOwnershipLink(email) {
  try {
    await sendSignInLinkToEmail(requireAuth(), email.trim(), {
      url: `${window.location.origin}/account/email`,
      handleCodeInApp: true,
    });
  } catch (err) {
    err.operation = 'sendSignInLinkToEmail';
    logAuthError(err.operation, err);
    throw err;
  }
  try { localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email.trim()); } catch { /* storage unavailable */ }
}

export const isEmailOwnershipLink = (url) => Boolean(auth && isSignInWithEmailLink(auth, url));

export function getEmailAwaitingLink() {
  try { return localStorage.getItem(EMAIL_LINK_STORAGE_KEY); } catch { return null; }
}

/**
 * Completes the verify-first flow on the SAME account: links the verified email
 * (EmailAuthProvider.credentialWithLink + linkWithCredential), then sets the password.
 */
export async function linkVerifiedEmailAndSetPassword(user, email, emailLink, password) {
  try {
    await linkWithCredential(user, EmailAuthProvider.credentialWithLink(email.trim(), emailLink));
  } catch (err) {
    err.operation = 'linkWithCredential(emailLink)';
    logAuthError(err.operation, err);
    throw err;
  }
  try { localStorage.removeItem(EMAIL_LINK_STORAGE_KEY); } catch { /* storage unavailable */ }
  try {
    await updatePassword(user, password);
  } catch (err) {
    err.operation = 'updatePassword';
    err.emailLinked = true; // email is verified and linked; only the password step failed
    logAuthError(err.operation, err);
    throw err;
  }
}

/** Adds a password to an account that already has a verified email but no password/Google login. */
export async function setPasswordOnVerifiedAccount(user, password) {
  try {
    await updatePassword(user, password);
  } catch (err) {
    err.operation = 'updatePassword';
    logAuthError(err.operation, err);
    throw err;
  }
}

/**
 * True if `password` equals the account's CURRENT password. Firebase keeps no
 * readable password history, so the only safe check is a re-authentication attempt.
 */
export async function isCurrentPassword(user, password) {
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return true;
  } catch (err) {
    if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(err.code)) return false;
    throw err;
  }
}

export const hasPasswordProvider = (user) => Boolean(user?.providerData?.some((p) => p.providerId === 'password'));
export const hasGoogleProvider = (user) => Boolean(user?.providerData?.some((p) => p.providerId === 'google.com'));

/**
 * Sets a new password after the farmer proved control of the registered phone.
 * Accounts without a password (Google-only) get one only through this explicit call.
 */
export async function setNewPassword(user, newPassword) {
  if (hasPasswordProvider(user)) {
    if (await isCurrentPassword(user, newPassword)) {
      const err = new Error('New password must be different from the current password.');
      err.code = 'fasalytics/password-reused';
      throw err;
    }
    await updatePassword(user, newPassword);
    return 'updated';
  }
  if (!user.email) {
    const err = new Error('This account has no email address yet.');
    err.code = 'fasalytics/no-email';
    throw err;
  }
  // Google-only account: setting a password adds the email/password provider to the same account
  // (linking an EmailAuthProvider credential for the account's own email is rejected as EMAIL_EXISTS).
  await updatePassword(user, newPassword);
  return 'created';
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

/** Google sign-in with popup; falls back to redirect where popups are unavailable. Returns null on redirect. */
export async function signInWithGoogle() {
  const authInstance = requireAuth();
  try {
    return await signInWithPopup(authInstance, googleProvider());
  } catch (err) {
    if (POPUP_UNAVAILABLE.has(err.code)) {
      await signInWithRedirect(authInstance, googleProvider());
      return null;
    }
    throw err;
  }
}

/** Completes a redirect-based Google sign-in / link (call once on app load). */
export const completeGoogleRedirect = () => (auth ? getRedirectResult(auth) : Promise.resolve(null));

/** Links Google to the signed-in account (requires an authenticated session). */
export async function linkGoogle(user) {
  try {
    return await linkWithPopup(user, googleProvider());
  } catch (err) {
    if (POPUP_UNAVAILABLE.has(err.code)) {
      await linkWithRedirect(user, googleProvider());
      return null;
    }
    throw err;
  }
}

/** Google credential carried by auth/account-exists-with-different-credential errors. */
export const googleCredentialFromError = (err) => GoogleAuthProvider.credentialFromError(err);

export const linkPendingCredential = (user, credential) => linkWithCredential(user, credential);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function logout() {
  resetRecaptcha();
  if (auth) await signOut(auth);
}

/** Maps Firebase Auth errors to farmer-friendly messages (no internal details, no account enumeration). */
export function getAuthErrorMessage(err) {
  switch (err?.code) {
    case 'app/not-configured':
      return 'Login is not available yet: Firebase is not configured for this app.';
    // Email / password — deliberately identical so the response never reveals whether an account exists
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'We could not create an account with this email. If you already registered, log in or reset your password.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Please choose a stronger password.';
    case 'fasalytics/password-reused':
      return 'Your new password must be different from your current password.';
    case 'fasalytics/phone-in-use':
      return 'This mobile number is already linked to another FASALYTICS account. Use a different number, or log in to that account.';
    case 'fasalytics/no-account-for-phone':
      return 'No FASALYTICS account is linked to this mobile number.';
    case 'auth/requires-recent-login':
      return 'For your security, please log in again and retry.';
    // Phone
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'Please enter a valid 10-digit Indian mobile number.';
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return 'Incorrect OTP. Please check the code and try again.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This OTP has expired. Please request a new one.';
    case 'auth/credential-already-in-use':
      return 'This mobile number or account is already linked to another FASALYTICS account.';
    case 'auth/provider-already-linked':
      return 'This sign-in method is already linked to your account.';
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
    case 'auth/missing-app-credential':
      return 'Security check failed. Please refresh the page and try again.';
    // Google
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return 'Google sign-in was cancelled.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists for this email. Log in with your password to link Google.';
    // General
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes before trying again.';
    case 'auth/quota-exceeded':
      return 'SMS limit reached for now. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';
    case 'auth/operation-not-allowed': {
      // Distinguish a disabled provider from a project policy refusal (e.g. email verification required).
      const reason = getServerReason(err);
      if (reason && /verify the new email/i.test(reason)) {
        return 'Your email address must be verified before it can be added. We will email you a verification link instead.';
      }
      if (err.operation === 'sendSignInLinkToEmail' || err.operation === 'linkWithCredential(emailLink)') {
        return `Email link sign-in is disabled in Firebase project "${firebaseProjectId}". Enable "Email link (passwordless sign-in)" under Authentication → Sign-in method → Email/Password.`;
      }
      if (reason) return `Firebase refused this request: ${reason}`;
      return `This sign-in method is disabled in Firebase project "${firebaseProjectId}". Enable it under Authentication → Sign-in method.`;
    }
    case 'auth/admin-restricted-operation':
      return 'This action is restricted by the Firebase project settings.';
    case 'auth/unauthorized-continue-uri':
    case 'auth/invalid-continue-uri':
      return 'This website is not authorised for email links. Add it under Authentication → Settings → Authorized domains.';
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'This email link is invalid or has expired. Please request a new one.';
    case 'auth/billing-not-enabled':
      return 'SMS sending is not enabled for this Firebase project yet.';
    case 'auth/unauthorized-domain':
    case 'auth/app-not-authorized':
      return 'This website is not authorised for login. Please contact support.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/configuration-not-found':
      return 'Login is misconfigured. Please contact support.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    default:
      if (err?.message && err.code?.startsWith('fasalytics/')) return err.message;
      // Unknown Firebase errors: show the code so problems can be diagnosed instead of guessed.
      return err?.code ? `Something went wrong (${err.code}). Please try again.` : 'Something went wrong. Please try again.';
  }
}
