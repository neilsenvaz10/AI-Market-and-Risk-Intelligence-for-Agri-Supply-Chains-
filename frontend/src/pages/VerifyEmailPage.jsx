import { useEffect, useState } from 'react';
import { useAuth, useLogout } from '../context/AuthContext';
import { EMAIL_RESEND_COOLDOWN_SECONDS, getAuthErrorMessage } from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { PrimaryButton } from '../components/AuthControls';
import { t } from '../i18n/strings';

/**
 * Registration step: Firebase email verification. The link in Firebase's
 * verification email confirms the address; FASALYTICS' welcome email is a
 * separate message sent only after registration is complete.
 */
export default function VerifyEmailPage() {
  const { account, refreshAccount, resendVerificationEmail, language } = useAuth();
  const { logout, loggingOut } = useLogout();
  const [checking, setChecking] = useState(false);
  const [sentAt, setSentAt] = useState(() => Date.now()); // signup just sent one
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cooldown = Math.max(0, EMAIL_RESEND_COOLDOWN_SECONDS - Math.floor((now - sentAt) / 1000));

  const handleCheck = async (e) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    setInfo(null);
    try {
      const refreshed = await refreshAccount();
      if (!refreshed?.emailVerified) setError('Your email is not verified yet. Open the link in the email, then try again.');
      // Once verified, the route guard moves on to profile completion.
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setInfo(null);
    try {
      await resendVerificationEmail();
      setSentAt(Date.now());
      setInfo('Verification email sent. Please check your inbox and spam folder.');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding
        icon="mark_email_unread"
        title={t(language, 'verifyEmailTitle')}
        subtitle={`We sent a verification link to ${account?.email || 'your email'}. Open it to confirm your address.`}
      />

      <form onSubmit={handleCheck} className="flex flex-col gap-space-sm px-gutter my-space-lg">
        {isUsingAuthEmulator && <EmulatorBadge />}
        {error && <AuthAlert>{error}</AuthAlert>}
        {info && (
          <p className="text-body-sm text-secondary font-bold text-center flex items-center justify-center gap-1" role="status">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            {info}
          </p>
        )}
        <PrimaryButton loading={checking} loadingLabel="Checking...">
          I have verified my email
        </PrimaryButton>
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0}
          className="text-secondary text-body-sm font-bold flex items-center justify-center gap-1 mt-space-sm disabled:text-on-surface-variant disabled:opacity-70"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          {cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend verification email'}
        </button>
      </form>

      <button type="button" onClick={logout} disabled={loggingOut}
        className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">logout</span>
        <span>Use a different account</span>
      </button>
    </div>
  );
}
