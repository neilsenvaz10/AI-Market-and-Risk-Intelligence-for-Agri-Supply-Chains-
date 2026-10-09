/**
 * Registration requirements every FASALYTICS account must satisfy, in order.
 * Returns the route of the first unmet step, or null when the farmer may use the app.
 * The backend enforces the same rules from the verified ID token.
 */
export const SETUP_ROUTES = {
  addEmail: '/account/email',
  verifyPhone: '/verify-phone',
  verifyEmail: '/verify-email',
  profile: '/register',
};

export function getSetupStep(account, profileStatus) {
  if (!account) return null;
  // Older mobile-only accounts must add an email login: an address plus a password or Google.
  const hasEmailLogin = account.providers.includes('password') || account.providers.includes('google.com');
  if (!account.email || !hasEmailLogin) return SETUP_ROUTES.addEmail;
  // OTP phone verification is disabled for now until SMS feature is implemented
  // if (!account.phoneNumber) return SETUP_ROUTES.verifyPhone;
  if (!account.emailVerified) return SETUP_ROUTES.verifyEmail;
  if (profileStatus === 'missing') return SETUP_ROUTES.profile;
  return null;
}
