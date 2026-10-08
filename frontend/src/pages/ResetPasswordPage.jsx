import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import { getAuthErrorMessage, hasGoogleProvider, hasPasswordProvider, validatePassword } from '../services/authService';
import AuthBranding, { AuthAlert } from '../components/AuthBranding';
import { PasswordField, PrimaryButton } from '../components/AuthControls';
import AuthStatusScreen from '../components/AuthStatusScreen';
import { t } from '../i18n/strings';

/**
 * Password recovery, step 2 (only after phone-OTP proof in this session).
 * - Password accounts: set a new password that differs from the current one.
 * - Google-only accounts: no password is added unless the farmer explicitly chooses to create one.
 */
export default function ResetPasswordPage() {
  const { user, hasPasswordResetProof, resetPassword, language } = useAuth();
  const { logout } = useLogout();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [createChosen, setCreateChosen] = useState(false);
  // 'idle' | 'saving' | 'done'. Success signs the farmer out (clearing the proof), so the
  // guard below must not bounce back to /forgot-password while that happens.
  const [phase, setPhase] = useState('idle');

  if (phase === 'done') return <Navigate to="/login" replace />;
  if (phase === 'saving' && (!hasPasswordResetProof || !user)) return <AuthStatusScreen message={t(language, 'common.saving')} />;
  if (!hasPasswordResetProof || !user) return <Navigate to="/forgot-password" replace />;
  if (!user.email) return <Navigate to="/" replace />; // mobile-only account: setup adds email + password

  const isPasswordAccount = hasPasswordProvider(user);
  const isGoogleOnly = !isPasswordAccount && hasGoogleProvider(user);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fieldErrors = {};
    const passwordError = validatePassword(password);
    if (passwordError) fieldErrors.password = passwordError;
    if (confirm !== password) fieldErrors.confirm = t(language, 'auth.passwordsDoNotMatch');
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setSaving(true);
    setError(null);
    setPhase('saving');
    try {
      await resetPassword(password);
      setPhase('done');
    } catch (err) {
      setPhase('idle');
      setError(getAuthErrorMessage(err));
      setSaving(false);
    }
  };

  if (isGoogleOnly && !createChosen) {
    return (
      <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
        <AuthBranding icon="verified_user" title={t(language, 'profile.verified')} subtitle={t(language, 'auth.mobileVerifiedSubtitle', { email: user.email })} />
        <div className="flex flex-col gap-space-sm px-gutter my-space-lg">
          <AuthAlert tone="info">You can keep using “Continue with Google”, or create a password to also log in with your email.</AuthAlert>
          <button type="button" onClick={() => navigate('/', { replace: true })}
            className="w-full py-4 rounded-xl bg-secondary text-on-secondary font-headline-md text-headline-md shadow-lg flex items-center justify-center gap-space-sm active:scale-95 transition-transform">
            <span>Continue to dashboard</span>
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
          <button type="button" onClick={() => setCreateChosen(true)}
            className="w-full py-3 rounded-xl bg-surface-container-lowest text-on-surface border border-outline-variant font-label-lg text-label-lg shadow-sm">
            {t(language, 'auth.createPasswordTitle')}
          </button>
        </div>
        <button type="button" onClick={logout} className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
          <span className="material-symbols-outlined text-[16px]">logout</span>
          <span>{t(language, 'profile.logout')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding
        icon="lock_reset"
        title={isPasswordAccount ? t(language, 'auth.setNewPasswordTitle') : t(language, 'auth.createPasswordTitle')}
        subtitle={isPasswordAccount
          ? t(language, 'auth.mobileVerifiedSubtitleDiff', { email: user.email })
          : t(language, 'auth.mobileVerifiedSubtitle', { email: user.email })}
      />
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-md px-gutter my-space-lg">
        <PasswordField id="newPassword" label={t(language, 'auth.newPassword')} value={password}
          onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }}
          error={errors.password} showRules autoComplete="new-password" disabled={saving} />
        <PasswordField id="confirmNewPassword" label={t(language, 'auth.confirmNewPassword')} value={confirm}
          onChange={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }}
          error={errors.confirm} autoComplete="new-password" disabled={saving} />
        {error && <AuthAlert>{error}</AuthAlert>}
        <PrimaryButton loading={saving} loadingLabel={t(language, 'common.saving')}>
          {isPasswordAccount ? t(language, 'auth.updatePassword') : t(language, 'auth.createPassword')}
        </PrimaryButton>
      </form>
      <button type="button" onClick={logout} className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">close</span>
        <span>{t(language, 'auth.cancelAndLogout')}</span>
      </button>
    </div>
  );
}
