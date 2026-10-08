import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import { getAuthErrorMessage, hasGoogleProvider, hasPasswordProvider, validatePassword } from '../services/authService';
import AuthBranding, { AuthAlert } from '../components/AuthBranding';
import { PasswordField, PrimaryButton } from '../components/AuthControls';
import AuthStatusScreen from '../components/AuthStatusScreen';

/**
 * Password recovery, step 2 (only after phone-OTP proof in this session).
 * - Password accounts: set a new password that differs from the current one.
 * - Google-only accounts: no password is added unless the farmer explicitly chooses to create one.
 */
export default function ResetPasswordPage() {
  const { user, hasPasswordResetProof, resetPassword } = useAuth();
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
  if (phase === 'saving' && (!hasPasswordResetProof || !user)) return <AuthStatusScreen message="Saving your password..." />;
  if (!hasPasswordResetProof || !user) return <Navigate to="/forgot-password" replace />;
  if (!user.email) return <Navigate to="/" replace />; // mobile-only account: setup adds email + password

  const isPasswordAccount = hasPasswordProvider(user);
  const isGoogleOnly = !isPasswordAccount && hasGoogleProvider(user);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fieldErrors = {};
    const passwordError = validatePassword(password);
    if (passwordError) fieldErrors.password = passwordError;
    if (confirm !== password) fieldErrors.confirm = 'Passwords do not match';
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
        <AuthBranding icon="verified_user" title="Mobile verified" subtitle={`${user.email} signs in with Google and has no password.`} />
        <div className="flex flex-col gap-space-sm px-gutter my-space-lg">
          <AuthAlert tone="info">You can keep using “Continue with Google”, or create a password to also log in with your email.</AuthAlert>
          <button type="button" onClick={() => navigate('/', { replace: true })}
            className="w-full py-4 rounded-xl bg-secondary text-on-secondary font-headline-md text-headline-md shadow-lg flex items-center justify-center gap-space-sm active:scale-95 transition-transform">
            <span>Continue to dashboard</span>
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
          <button type="button" onClick={() => setCreateChosen(true)}
            className="w-full py-3 rounded-xl bg-surface-container-lowest text-on-surface border border-outline-variant font-label-lg text-label-lg shadow-sm">
            Create a password
          </button>
        </div>
        <button type="button" onClick={logout} className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
          <span className="material-symbols-outlined text-[16px]">logout</span>
          <span>Log Out</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding
        icon="lock_reset"
        title={isPasswordAccount ? 'Set a new password' : 'Create a password'}
        subtitle={`Mobile verified for ${user.email}.${isPasswordAccount ? ' Your new password must be different from your current one.' : ''}`}
      />
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-md px-gutter my-space-lg">
        <PasswordField id="newPassword" label="New Password" value={password}
          onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }}
          error={errors.password} showRules autoComplete="new-password" disabled={saving} />
        <PasswordField id="confirmNewPassword" label="Confirm New Password" value={confirm}
          onChange={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }}
          error={errors.confirm} autoComplete="new-password" disabled={saving} />
        {error && <AuthAlert>{error}</AuthAlert>}
        <PrimaryButton loading={saving} loadingLabel="Saving...">
          {isPasswordAccount ? 'Update Password' : 'Create Password'}
        </PrimaryButton>
      </form>
      <button type="button" onClick={logout} className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">close</span>
        <span>Cancel and log out</span>
      </button>
    </div>
  );
}
