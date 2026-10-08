import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorMessage, validateIndianMobile } from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { PhoneNumberField, PrimaryButton } from '../components/AuthControls';
import { t } from '../i18n/strings';

/**
 * Mobile OTP login — secondary option for farmers whose account was created
 * with a mobile number only. Regular logins use email/password or Google.
 */
export default function PhoneLoginPage() {
  const { startOtp, pendingOtp, language, isFirebaseConfigured, firebaseConfigError } = useAuth();
  const [mobile, setMobile] = useState(pendingOtp?.mode === 'signin' ? pendingOtp.phoneDigits : '');
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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
      await startOtp(mobile, 'signin');
      navigate('/verify-otp', { state: location.state });
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding title={t(language, 'loginTitle')} subtitle={t(language, 'loginSubtitle')} />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-sm px-gutter my-space-lg">
        {isUsingAuthEmulator && <EmulatorBadge />}
        {!isFirebaseConfigured && <AuthAlert>{firebaseConfigError}. See README → Phase 2 Firebase setup.</AuthAlert>}

        <PhoneNumberField
          value={mobile}
          onChange={(v) => { setMobile(v); setFieldError(null); setError(null); }}
          error={fieldError}
          disabled={sending || !isFirebaseConfigured}
          label={t(language, 'auth.mobileNumber')}
        />
        {error && <AuthAlert>{error}</AuthAlert>}

        <PrimaryButton className="mt-space-sm" loading={sending} loadingLabel={t(language, 'sendingOtp')} icon="sms" disabled={!isFirebaseConfigured}>
          {t(language, 'sendOtp')}
        </PrimaryButton>
      </form>

      <div className="flex flex-col gap-space-sm px-gutter">
        <Link to="/login" className="text-secondary text-body-sm font-bold flex items-center justify-center gap-1">
          <span className="material-symbols-outlined text-[16px]">mail</span>
          <span>{t(language, 'auth.loginWithEmailInstead')}</span>
        </Link>
        <p className="text-body-sm text-center text-on-surface-variant mt-2">
          {t(language, 'auth.phoneLoginNotice')}
        </p>
      </div>
    </div>
  );
}
