import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorMessage, validateIndianMobile } from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { PhoneNumberField, PrimaryButton } from '../components/AuthControls';
import { t } from '../i18n/strings';

/**
 * Password recovery, step 1: prove control of the registered mobile number
 * with a Firebase phone OTP. Phone sign-in returns the account the number is
 * linked to, which then authorises setting a new password.
 */
export default function ForgotPasswordPage() {
  const { isAuthenticated, hasPasswordResetProof, startOtp, language, isFirebaseConfigured } = useAuth();
  const [mobile, setMobile] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const location = useLocation();
  const [error, setError] = useState(location.state?.error || null);
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();

  if (hasPasswordResetProof) return <Navigate to="/forgot-password/new" replace />;
  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validation = validateIndianMobile(mobile);
    if (validation) {
      setFieldError(validation);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await startOtp(mobile, 'reset');
      navigate('/verify-otp');
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
        title="Reset your password"
        subtitle="Enter the mobile number registered with your FASALYTICS account. We will verify it with an OTP."
      />
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-sm px-gutter my-space-lg">
        {isUsingAuthEmulator && <EmulatorBadge />}
        <PhoneNumberField
          value={mobile}
          onChange={(v) => { setMobile(v); setFieldError(null); setError(null); }}
          error={fieldError}
          disabled={sending || !isFirebaseConfigured}
          label={`Registered ${t(language, 'mobileNumber')}`}
        />
        {error && <AuthAlert>{error}</AuthAlert>}
        <PrimaryButton className="mt-space-sm" loading={sending} loadingLabel={t(language, 'sendingOtp')} icon="sms" disabled={!isFirebaseConfigured}>
          {t(language, 'sendOtp')}
        </PrimaryButton>
      </form>
      <Link to="/login" className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        <span>Back to login</span>
      </Link>
    </div>
  );
}
