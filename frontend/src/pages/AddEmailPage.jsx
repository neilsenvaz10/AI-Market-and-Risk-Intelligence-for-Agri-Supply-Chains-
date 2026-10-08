import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import {
  getAuthErrorMessage, getEmailAwaitingLink, isEmailOwnershipLink, requiresVerifiedEmailFirst,
  validateEmail, validatePassword,
} from '../services/authService';
import AuthBranding, { AuthAlert } from '../components/AuthBranding';
import { GoogleButton, OrDivider, PasswordField, PrimaryButton } from '../components/AuthControls';
import { Field, inputClass } from '../components/FormField';
import { t } from '../i18n/strings';

// Session ended by Firebase after a security-sensitive change: log in again to continue.
const RELOGIN_CODES = new Set(['auth/requires-recent-login', 'auth/user-token-expired', 'auth/user-mismatch']);

/**
 * Registration step for accounts created with a mobile number only: adds an
 * email login to the SAME Firebase account (UID, verified phone and farmer
 * profile are preserved).
 */
export default function AddEmailPage() {
  const {
    account, addEmailPassword, startVerifiedEmailUpgrade, completeVerifiedEmailUpgrade,
    createPasswordForAccount, linkGoogle, logout: contextLogout, language,
  } = useAuth();
  const { logout, loggingOut } = useLogout();
  const navigate = useNavigate();
  const passwordOnly = Boolean(account?.email && account?.emailVerified);
  // Opened from the Firebase email link: finish by linking the verified email + setting the password.
  const [emailLink] = useState(() => (isEmailOwnershipLink(window.location.href) ? window.location.href : null));
  const [values, setValues] = useState(() => ({ email: (emailLink && getEmailAwaitingLink()) || '', password: '', confirmPassword: '' }));

  // The link is captured above; remove its one-time code from the address bar and history.
  useEffect(() => {
    if (emailLink) navigate('/account/email', { replace: true });
  }, [emailLink, navigate]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [notice, setNotice] = useState(null);
  const [awaitingLink, setAwaitingLink] = useState(false); // verify-first link sent
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const busy = submitting || googleLoading;

  const set = (field) => (value) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const showError = (err) => {
    setError(getAuthErrorMessage(err));
    setErrorCode(err?.code?.startsWith('auth/') ? err.code : null);
  };

  const reloginRequired = async () => {
    await contextLogout().catch(() => {});
    navigate('/login/phone', { replace: true });
  };

  const validate = () => {
    const e = {};
    if (!passwordOnly) { // includes the email-link completion (address must match the one the link was sent to)
      const emailError = validateEmail(values.email);
      if (emailError) e.email = emailError;
    }
    const passwordError = validatePassword(values.password);
    if (passwordError) e.password = passwordError;
    if (values.confirmPassword !== values.password) e.confirmPassword = t(language, 'auth.passwordsDoNotMatch');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    setErrorCode(null);
    setNotice(null);
    try {
      if (passwordOnly) {
        await createPasswordForAccount(values.password);
        return; // route guard moves on
      }
      if (emailLink) {
        await completeVerifiedEmailUpgrade(values.email, emailLink, values.password);
        return; // route guard moves on
      }
      try {
        const { verificationEmailSent } = await addEmailPassword(values.email, values.password);
        if (!verificationEmailSent) setNotice('Email login added. We could not send the verification email — use “Resend” on the next screen.');
        return; // route guard continues to email verification
      } catch (err) {
        if (!requiresVerifiedEmailFirst(err)) throw err;
        // Project requires a verified email before it is attached: prove ownership with an email link.
        await startVerifiedEmailUpgrade(values.email);
        setValues((v) => ({ ...v, password: '', confirmPassword: '' })); // never kept while waiting
        setAwaitingLink(true);
        setNotice(`For security, Firebase requires this email to be verified first. We sent a link to ${values.email.trim()}. Open it in this browser to finish adding your email login.`);
      }
    } catch (err) {
      if (err.emailLinked) {
        // Email verified and linked; only the password step failed. Phone-OTP recovery can set it.
        setNotice('Your email is verified and added. Setting the password failed — use “Forgot password” with your mobile number to set it.');
      }
      if (RELOGIN_CODES.has(err.code)) {
        await reloginRequired();
        return;
      }
      showError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendLink = async () => {
    setError(null);
    try {
      await startVerifiedEmailUpgrade(values.email);
      setNotice(`Verification link sent again to ${values.email.trim()}.`);
    } catch (err) {
      showError(err);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      await linkGoogle();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') showError(err);
      setGoogleLoading(false);
    }
  };

  const errorBlock = error && (
    <AuthAlert>
      {error}
      {errorCode && <span className="block mt-1 opacity-80">Error code: {errorCode}</span>}
    </AuthAlert>
  );

  if (awaitingLink) {
    return (
      <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
        <AuthBranding icon="mark_email_unread" title={t(language, 'verifyEmailTitle')} subtitle={notice} />
        <div className="flex flex-col gap-space-sm px-gutter my-space-lg">
          {errorBlock}
          <button type="button" onClick={handleResendLink}
            className="text-secondary text-body-sm font-bold flex items-center justify-center gap-1 mt-space-sm">
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            {t(language, 'auth.resendEmail')}
          </button>
          <button type="button" onClick={() => { setAwaitingLink(false); setNotice(null); }}
            className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
            <span className="material-symbols-outlined text-[16px]">edit</span>
            {t(language, 'auth.useDifferentAccount')}
          </button>
        </div>
        <button type="button" onClick={logout} disabled={loggingOut}
          className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
          <span className="material-symbols-outlined text-[16px]">logout</span>
          <span>{t(language, 'profile.logout')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full py-space-md gap-space-lg">
      <AuthBranding
        icon="alternate_email"
        title={passwordOnly || emailLink ? t(language, 'auth.createPasswordTitle') : 'Add your email'}
        subtitle={passwordOnly
          ? `${account.email} is verified. Create a password to log in without an OTP.`
          : emailLink
            ? 'Email link confirmed. Create a password to finish adding your email login.'
            : 'Your account uses a mobile number only. Add an email login so you can sign in without an OTP.'}
      />
      <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-space-md">
        {!passwordOnly && !emailLink && (
          <>
            <GoogleButton onClick={handleGoogle} loading={googleLoading} label={t(language, 'auth.linkGoogleAccount')} disabled={submitting} />
            <OrDivider />
          </>
        )}
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-md">
          {!passwordOnly && (
            <Field label={t(language, 'auth.email')} htmlFor="email" error={errors.email}>
              <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">mail</span>
              <input id="email" type="email" className={inputClass} value={values.email} onChange={(e) => set('email')(e.target.value)}
                placeholder="you@gmail.com" autoComplete="email" disabled={busy} />
            </Field>
          )}
          <PasswordField id="password" label={t(language, 'auth.password')} value={values.password} onChange={set('password')}
            error={errors.password} showRules autoComplete="new-password" disabled={busy} />
          <PasswordField id="confirmPassword" label={t(language, 'auth.confirmPassword')} value={values.confirmPassword} onChange={set('confirmPassword')}
            error={errors.confirmPassword} autoComplete="new-password" disabled={busy} />
          {notice && <AuthAlert tone="info">{notice}</AuthAlert>}
          {errorBlock}
          <PrimaryButton loading={submitting} loadingLabel={t(language, 'common.saving')}>
            {passwordOnly || emailLink ? t(language, 'auth.createPassword') : 'Add Email Login'}
          </PrimaryButton>
        </form>
      </div>
      <button type="button" onClick={logout} disabled={loggingOut}
        className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">logout</span>
        <span>{t(language, 'profile.logout')}</span>
      </button>
    </div>
  );
}
