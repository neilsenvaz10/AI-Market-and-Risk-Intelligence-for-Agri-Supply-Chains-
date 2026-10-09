import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getAuthErrorMessage, validateEmail, validateIndianMobile, validatePassword,
} from '../services/authService';
import { isUsingAuthEmulator } from '../config/firebase';
import AuthBranding, { AuthAlert, EmulatorBadge } from '../components/AuthBranding';
import { GoogleButton, OrDivider, PasswordField, PhoneNumberField, PrimaryButton } from '../components/AuthControls';
import { Field, inputClass } from '../components/FormField';
import { t } from '../i18n/strings';

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;

/**
 * Step 1 of registration: creates the Firebase email/password account and sends
 * Firebase's verification email. The mobile number is verified by OTP in the
 * next step and linked to this same account.
 */
export default function SignupPage() {
  const { signUp, signInWithGoogle, language, isFirebaseConfigured, firebaseConfigError } = useAuth();
  const [values, setValues] = useState({ fullName: '', email: '', password: '', confirmPassword: '', mobile: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const busy = submitting || googleLoading;

  const set = (field) => (value) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const validate = () => {
    const e = {};
    const name = values.fullName.trim();
    if (!name) e.fullName = 'Full name is required';
    else if (name.length < 2 || name.length > 100 || !NAME_RE.test(name)) e.fullName = 'Enter your name using letters only';
    const emailError = validateEmail(values.email);
    if (emailError) e.email = emailError;
    const passwordError = validatePassword(values.password);
    if (passwordError) e.password = passwordError;
    if (!values.confirmPassword) e.confirmPassword = t(language, 'auth.confirmPassword');
    else if (values.confirmPassword !== values.password) e.confirmPassword = t(language, 'auth.passwordsDoNotMatch');
    const mobileError = validateIndianMobile(values.mobile);
    if (mobileError) e.mobile = mobileError;
    return e;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSubmitting(true);
    setError(null);
    try {
      await signUp({ fullName: values.fullName, email: values.email, password: values.password, phoneDigits: values.mobile });
      // PublicRoute now continues to mobile OTP verification.
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
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError(getAuthErrorMessage(err));
      }
      setGoogleLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full py-space-md gap-space-lg">
      <AuthBranding icon="person_add" title={t(language, 'signupTitle')} subtitle={t(language, 'signupSubtitle')} />

      <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-space-md">
        {isUsingAuthEmulator && <EmulatorBadge />}
        {!isFirebaseConfigured && <AuthAlert>{firebaseConfigError}. See README → Phase 2 Firebase setup.</AuthAlert>}

        <GoogleButton onClick={handleGoogle} loading={googleLoading} label={t(language, 'continueGoogle')} disabled={!isFirebaseConfigured || submitting} />
        <OrDivider />

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-md">
          <Field label={t(language, 'auth.fullName')} htmlFor="fullName" error={errors.fullName}>
            <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">person</span>
            <input id="fullName" className={inputClass} value={values.fullName} onChange={(e) => set('fullName')(e.target.value)}
              placeholder="e.g. Ramesh Patil" autoComplete="name" maxLength={100} disabled={busy} />
          </Field>
          <Field label={t(language, 'auth.email')} htmlFor="email" error={errors.email}>
            <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">mail</span>
            <input id="email" type="email" className={inputClass} value={values.email} onChange={(e) => set('email')(e.target.value)}
              placeholder="you@gmail.com" autoComplete="email" inputMode="email" disabled={busy} />
          </Field>
          <PasswordField id="password" label={t(language, 'auth.password')} value={values.password} onChange={set('password')}
            error={errors.password} showRules autoComplete="new-password" disabled={busy} />
          <PasswordField id="confirmPassword" label={t(language, 'auth.confirmPassword')} value={values.confirmPassword} onChange={set('confirmPassword')}
            error={errors.confirmPassword} autoComplete="new-password" disabled={busy} />
          <div>
            <span className="text-body-sm font-bold text-on-surface block mb-1">
              {t(language, 'auth.mobileNumber')}
            </span>
            <PhoneNumberField value={values.mobile} onChange={set('mobile')} error={errors.mobile} disabled={busy} />
          </div>

          {error && <AuthAlert>{error}</AuthAlert>}

          <PrimaryButton loading={submitting} loadingLabel={t(language, 'creatingAccount')} disabled={!isFirebaseConfigured || googleLoading}>
            {t(language, 'createAccount')}
          </PrimaryButton>
        </form>
      </div>

      <p className="text-body-md text-center text-on-surface-variant">
        {t(language, 'auth.alreadyRegistered')} <Link to="/login" className="text-secondary font-bold">{t(language, 'logIn')}</Link>
      </p>
    </div>
  );
}
