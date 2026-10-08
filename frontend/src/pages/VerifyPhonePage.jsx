import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import { getAuthErrorMessage, validateIndianMobile } from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { PhoneNumberField, PrimaryButton } from '../components/AuthControls';
import { t } from '../i18n/strings';

/** Registration step: one-time OTP that links the mobile number to the signed-in account. */
export default function VerifyPhonePage() {
  const { account, signupPhone, pendingOtp, startOtp, language } = useAuth();
  const { logout, loggingOut } = useLogout();
  const [mobile, setMobile] = useState(pendingOtp?.mode === 'link' ? pendingOtp.phoneDigits : signupPhone || '');
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();

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
      await startOtp(mobile, 'link');
      navigate('/verify-otp');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding icon="phonelink_lock" title={t(language, 'verifyPhoneTitle')} subtitle={t(language, 'verifyPhoneSubtitle')} />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-sm px-gutter my-space-lg">
        {isUsingAuthEmulator && <EmulatorBadge />}
        {account?.email && (
          <p className="text-body-sm text-center text-on-surface-variant">
            {t(language, 'auth.account')}: <span className="font-bold text-on-surface">{account.email}</span>
          </p>
        )}
        <PhoneNumberField
          value={mobile}
          onChange={(v) => { setMobile(v); setFieldError(null); setError(null); }}
          error={fieldError}
          disabled={sending}
          label={t(language, 'auth.mobileNumber')}
        />
        {error && <AuthAlert>{error}</AuthAlert>}
        <PrimaryButton className="mt-space-sm" loading={sending} loadingLabel={t(language, 'sendingOtp')} icon="sms">
          {t(language, 'sendOtp')}
        </PrimaryButton>
      </form>

      <button type="button" onClick={logout} disabled={loggingOut}
        className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">logout</span>
        <span>{t(language, 'auth.useDifferentAccount')}</span>
      </button>
    </div>
  );
}
