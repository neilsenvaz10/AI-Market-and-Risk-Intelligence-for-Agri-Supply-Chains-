import { useState } from 'react';
import { Field, inputClass } from './FormField';
import { PASSWORD_RULES, validateIndianMobile } from '../services/authService';

/** Primary CTA — same markup as the Stitch Splash "Get Started" button. */
export function PrimaryButton({ loading, loadingLabel, children, icon = 'arrow_forward', className = '', disabled, ...props }) {
  return (
    <button
      type="submit"
      className={`w-full py-4 rounded-xl bg-secondary text-on-secondary font-headline-md text-headline-md shadow-lg flex items-center justify-center gap-space-sm active:scale-95 transition-transform disabled:opacity-80 ${className}`}
      {...props}
      disabled={loading || disabled}
    >
      {loading ? (
        <>
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          <span>{loadingLabel}</span>
        </>
      ) : (
        <>
          <span>{children}</span>
          {icon && <span className="material-symbols-outlined">{icon}</span>}
        </>
      )}
    </button>
  );
}

/** Large +91 mobile input — the original Stitch-styled login field. */
export function PhoneNumberField({ id = 'mobile', value, onChange, error, disabled, label }) {
  const valid = value.length === 10 && !validateIndianMobile(value);
  return (
    <div className="flex flex-col gap-space-sm">
      {label && (
        <label htmlFor={id} className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider text-center mb-1">
          {label}
        </label>
      )}
      <div
        className={`flex items-center gap-space-md p-space-md rounded-xl shadow-sm transition-all border-2 bg-surface-container-low ${
          error ? 'border-error' : 'border-transparent focus-within:border-secondary'
        }`}
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold bg-surface-container-highest text-primary shrink-0">
          +91
        </div>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="98765 43210"
          maxLength={10}
          className="flex-grow min-w-0 bg-transparent text-headline-md font-headline-md tracking-wider text-on-surface placeholder:text-on-surface-variant/50 outline-none"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={disabled}
        />
        {valid && (
          <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-body-sm text-error flex items-center gap-1" role="alert">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
    </div>
  );
}

/** Password input with show/hide toggle and optional strength checklist. */
export function PasswordField({ id, label, value, onChange, error, showRules, autoComplete = 'current-password', disabled }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <Field label={label} htmlFor={id} error={error}>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">lock</span>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          maxLength={128}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="material-symbols-outlined text-on-surface-variant text-[20px] pr-1"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? 'visibility_off' : 'visibility'}
        </button>
      </Field>
      {showRules && (
        <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
          {PASSWORD_RULES.map((rule) => {
            const ok = rule.test(value);
            return (
              <li key={rule.id} className={`text-[11px] flex items-center gap-1 ${ok ? 'text-secondary font-bold' : 'text-on-surface-variant'}`}>
                <span className="material-symbols-outlined text-[14px]" style={ok ? { fontVariationSettings: "'FILL' 1" } : {}}>
                  {ok ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                {rule.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "Continue with Google" — secondary surface button using Google's standard "G" mark. */
export function GoogleButton({ onClick, loading, label = 'Continue with Google', disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="w-full py-3 rounded-xl bg-surface-container-lowest text-on-surface border border-outline-variant font-label-lg text-label-lg shadow-sm flex items-center justify-center gap-space-sm active:scale-95 transition-transform disabled:opacity-60"
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
      ) : (
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-space-sm text-on-surface-variant text-body-sm" aria-hidden="true">
      <span className="flex-1 h-px bg-outline-variant" />
      <span>or</span>
      <span className="flex-1 h-px bg-outline-variant" />
    </div>
  );
}
