import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorMessage, validateEmail } from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { GoogleButton, OrDivider, PasswordField, PrimaryButton } from '../components/AuthControls';
import { Field, inputClass } from '../components/FormField';
import { t } from '../i18n/strings';

/** Email/password + Google login. No OTP is sent during normal login. */
export default function LoginPage() {
  const {
    loginWithEmail, signInWithGoogle, pendingGoogleLink, clearPendingGoogleLink,
    authError, language, isFirebaseConfigured, firebaseConfigError,
  } = useAuth();
  const [email, setEmail] = useState(pendingGoogleLink?.email || '');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const busy = submitting || googleLoading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;
    if (!password) errors.password = t(language, 'auth.enterPassword');
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    setError(null);
    try {
      await loginWithEmail(email, password);
      // PublicRoute sends the farmer to the dashboard or their next registration step.
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (err.code === 'auth/account-exists-with-different-credential') {
        setEmail(err.customData?.email || email);
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError(getAuthErrorMessage(err));
      }
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding title={t(language, 'emailLoginTitle')} subtitle={t(language, 'emailLoginSubtitle')} />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-md px-gutter my-space-lg">
        {isUsingAuthEmulator && <EmulatorBadge />}
        {!isFirebaseConfigured && <AuthAlert>{firebaseConfigError}. See README → Phase 2 Firebase setup.</AuthAlert>}
        {authError && <AuthAlert tone="info">{authError}</AuthAlert>}
        {pendingGoogleLink && (
          <AuthAlert tone="info">
            An account already exists for {pendingGoogleLink.email || 'this email'}. Log in with your password to
            securely link Google to it.{' '}
            <button type="button" className="underline font-bold" onClick={clearPendingGoogleLink}>
              {t(language, 'common.cancel')}
            </button>
          </AuthAlert>
        )}

        <Field label={t(language, 'auth.email')} htmlFor="email" error={fieldErrors.email}>
          <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">mail</span>
          <input
            id="email"
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => { setEmail(e.target.value); setFieldErrors((f) => ({ ...f, email: undefined })); }}
            placeholder="you@gmail.com"
            autoComplete="email"
            inputMode="email"
            disabled={busy}
          />
        </Field>
        <PasswordField
          id="password"
          label={t(language, 'auth.password')}
          value={password}
          onChange={(v) => { setPassword(v); setFieldErrors((f) => ({ ...f, password: undefined })); }}
          error={fieldErrors.password}
          disabled={busy}
        />
        <Link to="/forgot-password" className="self-end -mt-space-sm text-secondary text-body-sm font-bold">
          {t(language, 'forgotPassword')}
        </Link>

        {error && <AuthAlert>{error}</AuthAlert>}

        <PrimaryButton loading={submitting} loadingLabel={t(language, 'loggingIn')} disabled={!isFirebaseConfigured || googleLoading}>
          {t(language, 'logIn')}
        </PrimaryButton>
        <OrDivider />
        <GoogleButton onClick={handleGoogle} loading={googleLoading} label={t(language, 'continueGoogle')} disabled={!isFirebaseConfigured || submitting} />
      </form>

      <div className="flex flex-col gap-space-sm px-gutter">
        <p className="text-body-md text-center text-on-surface-variant">
          {t(language, 'auth.newToFasalytics')}{' '}
          <Link to="/signup" className="text-secondary font-bold">{t(language, 'createAccount')}</Link>
        </p>
        <div className="flex items-center justify-center gap-space-md">
          <Link to="/onboarding" className="text-secondary text-body-sm font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">translate</span>
            <span>{t(language, 'auth.changeLanguage')}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
