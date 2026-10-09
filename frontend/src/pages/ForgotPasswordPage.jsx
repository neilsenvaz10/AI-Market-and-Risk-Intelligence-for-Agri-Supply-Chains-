import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorMessage, sendPasswordReset, validateEmail } from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { PrimaryButton } from '../components/AuthControls';
import { Field, inputClass } from '../components/FormField';
import { t } from '../i18n/strings';

/**
 * Password recovery via Firebase email reset link (no phone OTP).
 */
export default function ForgotPasswordPage() {
  const { isAuthenticated, language, isFirebaseConfigured, firebaseConfigError } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validation = validateEmail(email);
    if (validation) {
      setFieldError(validation);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding
        icon="lock_reset"
        title={t(language, 'auth.resetPasswordTitle')}
        subtitle={t(language, 'auth.resetPasswordSubtitle')}
      />
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-sm px-gutter my-space-lg">
        {isUsingAuthEmulator && <EmulatorBadge />}
        {!isFirebaseConfigured && <AuthAlert>{firebaseConfigError}</AuthAlert>}
        {sent ? (
          <div className="bg-secondary-container/60 border border-secondary text-on-secondary-container p-4 rounded-xl text-center flex flex-col gap-2">
            <span className="material-symbols-outlined text-[28px] text-secondary">mark_email_read</span>
            <p className="font-bold text-sm">Password reset email sent</p>
            <p className="text-xs text-on-surface-variant">
              We sent a password reset link to <strong>{email}</strong>. Please check your inbox and spam folder.
            </p>
          </div>
        ) : (
          <>
            <Field label={t(language, 'auth.email')} htmlFor="resetEmail" error={fieldError}>
              <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">mail</span>
              <input
                id="resetEmail"
                type="email"
                className={inputClass}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setFieldError(null); setError(null); }}
                placeholder="you@gmail.com"
                autoComplete="email"
                inputMode="email"
                disabled={sending || !isFirebaseConfigured}
              />
            </Field>
            {error && <AuthAlert>{error}</AuthAlert>}
            <PrimaryButton className="mt-space-sm" loading={sending} loadingLabel="Sending reset link..." icon="mail" disabled={!isFirebaseConfigured}>
              Send Reset Link
            </PrimaryButton>
          </>
        )}
      </form>
      <Link to="/login" className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        <span>{t(language, 'auth.backToLogin')}</span>
      </Link>
    </div>
  );
}
