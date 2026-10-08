import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  OTP_LENGTH,
  OTP_RESEND_COOLDOWN_SECONDS,
  getAuthErrorMessage,
} from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { t } from '../i18n/strings';

// Where "Change number" returns to, per OTP purpose.
const ORIGIN = { signin: '/login/phone', link: '/verify-phone', reset: '/forgot-password' };

const secondsLeft = (sentAt, now) =>
  Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - Math.floor((now - sentAt) / 1000));

export default function VerifyOtpPage() {
  const { pendingOtp, confirmOtp, resendOtp, language } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cooldown = pendingOtp ? secondsLeft(pendingOtp.sentAt, Math.max(now, pendingOtp.sentAt)) : 0;

  // The Firebase confirmation lives in memory; after a refresh the farmer must request a new OTP.
  if (!pendingOtp && !verifying) return <Navigate to="/login" replace state={location.state} />;

  const mode = pendingOtp?.mode || 'signin';

  const phoneLabel = pendingOtp ? `+91 ${pendingOtp.phoneDigits.slice(0, 5)} ${pendingOtp.phoneDigits.slice(5)}` : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.length !== OTP_LENGTH) {
      setError(`Please enter the ${OTP_LENGTH}-digit OTP.`);
      return;
    }
    setVerifying(true);
    setError(null);
    setInfo(null);
    try {
      const completed = await confirmOtp(code);
      // signin/link: the route guards continue to the next registration step or the dashboard.
      navigate(completed === 'reset' ? '/forgot-password/new' : (location.state?.from || '/'), { replace: true });
    } catch (err) {
      if (err.code === 'fasalytics/no-account-for-phone') {
        navigate('/forgot-password', { replace: true, state: { error: getAuthErrorMessage(err) } });
        return;
      }
      setError(getAuthErrorMessage(err));
      setCode('');
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      await resendOtp();
      setCode('');
      setInfo('A new OTP has been sent.');
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      <AuthBranding
        icon="sms"
        title={t(language, 'verifyTitle')}
        subtitle={t(language, 'verifySubtitle', { phone: phoneLabel })}
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-sm px-gutter my-space-lg">
        {isUsingAuthEmulator && <EmulatorBadge />}
        <label
          htmlFor="otp"
          className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider text-center mb-1"
        >
          Enter OTP / OTP टाका
        </label>
        <div
          className={`flex items-center gap-space-md p-space-md rounded-xl shadow-sm transition-all border-2 bg-surface-container-low ${
            error ? 'border-error' : 'border-transparent focus-within:border-secondary'
          }`}
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-highest text-primary shrink-0">
            <span className="material-symbols-outlined">lock</span>
          </div>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH));
              setError(null);
            }}
            placeholder="••••••"
            maxLength={OTP_LENGTH}
            className="flex-grow min-w-0 bg-transparent text-headline-lg font-headline-lg tracking-[0.5em] text-on-surface placeholder:text-on-surface-variant/40 outline-none"
            disabled={verifying}
            aria-invalid={Boolean(error)}
          />
        </div>

        {error && <AuthAlert>{error}</AuthAlert>}
        {info && (
          <p className="text-body-sm text-secondary font-bold text-center flex items-center justify-center gap-1" role="status">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            {info}
          </p>
        )}

        <button
          type="submit"
          className="mt-space-sm w-full py-4 rounded-xl bg-secondary text-on-secondary font-headline-md text-headline-md shadow-lg flex items-center justify-center gap-space-sm active:scale-95 transition-transform disabled:opacity-80"
          disabled={verifying || code.length !== OTP_LENGTH}
        >
          {verifying ? (
            <>
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>{t(language, 'verifying')}</span>
            </>
          ) : (
            <>
              <span>{t(language, 'verify')}</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </>
          )}
        </button>

        <div className="flex items-center justify-between mt-space-sm">
          <Link to={ORIGIN[mode]} state={location.state} className="text-on-surface-variant text-body-sm font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            {t(language, 'changeNumber')}
          </Link>
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || resending || verifying}
            className="text-secondary text-body-sm font-bold flex items-center gap-1 disabled:text-on-surface-variant disabled:opacity-70"
          >
            {resending ? (
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            )}
            {cooldown > 0 ? t(language, 'resendIn', { seconds: cooldown }) : t(language, 'resend')}
          </button>
        </div>
      </form>

      <p className="text-body-sm text-center text-on-surface-variant px-gutter">
        OTP is valid for a few minutes. Never share it with anyone.
      </p>
    </div>
  );
}
