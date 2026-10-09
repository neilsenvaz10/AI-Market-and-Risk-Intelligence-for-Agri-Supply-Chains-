import { useState } from 'react';
import { COMMON_CROPS, QUANTITY_UNITS, formatPhone } from '../constants/profile';
import LocationFields from './LocationFields';
import { validateLocation } from '../services/locationService';
import { EMPTY_PROFILE, toPayload, validateProfile } from '../utils/profileValidation';
import { LANGUAGES } from '../i18n/languages';
import { Field, inputClass } from './FormField';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

function ChoiceChips({ options, value, onChange, name }) {
  return (
    <div className="flex gap-space-sm" role="radiogroup" aria-label={name}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 px-2 rounded-xl text-body-sm font-bold border-2 transition-all ${
              selected
                ? 'bg-secondary-container text-on-secondary-container border-secondary shadow-md'
                : 'bg-surface-container-low text-on-surface border-transparent hover:border-secondary shadow-sm'
            }`}
          >
            {selected && (
              <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                check_circle
              </span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Shared farmer profile form used by registration and profile editing.
 * `onSubmit` receives the API payload and should throw ApiError on failure.
 */
function normalise(v = {}) {
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (k in EMPTY_PROFILE) out[k] = val === null || val === undefined ? '' : String(val);
  }
  return out;
}

export default function FarmerProfileForm({
  initialValues,
  phoneNumber,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
}) {
  const { language } = useAuth();
  const [values, setValues] = useState(() => ({
    ...EMPTY_PROFILE,
    ...normalise(initialValues),
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (e) => {
    const val = typeof e === 'object' && e !== null && 'target' in e ? e.target.value : e;
    setValues((prev) => ({ ...prev, [field]: val }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const setLocation = (changes) => {
    setValues((prev) => ({ ...prev, ...changes }));
    setErrors((prev) => ({ ...prev, ...Object.fromEntries(Object.keys(changes).map((key) => [key, undefined])) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    const validationErrors = validateProfile(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;
    setSubmitting(true);
    try {
      let location;
      try {
        location = await validateLocation(values, initialValues);
      } catch {
        setFormError(t(language, 'location.loadError'));
        return;
      }
      if (Object.keys(location.errors).length) {
        setErrors(Object.fromEntries(Object.entries(location.errors).map(([key, message]) => [key, t(language, message)])));
        return;
      }
      await onSubmit({ ...toPayload(values), village: location.village });
    } catch (err) {
      if (err.details) setErrors(err.details);
      setFormError(err.message || 'Could not save your profile. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={submitting} className="flex flex-col gap-space-md">
      <fieldset disabled={submitting} className="flex flex-col gap-space-md min-w-0">
      <Field label={t(language, 'profile.form.fullName')} htmlFor="fullName" error={errors.fullName}>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">person</span>
        <input id="fullName" className={inputClass} value={values.fullName} onChange={set('fullName')}
          placeholder="e.g. Ramesh Patil" autoComplete="name" maxLength={100} />
      </Field>

      {phoneNumber ? (
        <Field label={t(language, 'profile.form.verifiedMobile')} htmlFor="phoneNumber">
          <span className="material-symbols-outlined text-secondary text-[20px] pl-1" style={{ fontVariationSettings: "'FILL' 1" }}>
            verified
          </span>
          <input id="phoneNumber" className={`${inputClass} text-on-surface-variant`} value={formatPhone(phoneNumber)} readOnly
            aria-readonly="true" tabIndex={-1} />
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container shrink-0">
            {t(language, 'profile.form.otpVerified')}
          </span>
        </Field>
      ) : null}

      <LocationFields values={values} initialValues={initialValues} errors={errors} language={language} onChange={setLocation} />

      <Field label={t(language, 'profile.form.primaryCrop')} htmlFor="primaryCrop" error={errors.primaryCrop}>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">eco</span>
        <input id="primaryCrop" className={inputClass} value={values.primaryCrop} onChange={set('primaryCrop')}
          placeholder="e.g. Onion" list="crop-suggestions" maxLength={64} autoComplete="off" />
        <datalist id="crop-suggestions">
          {COMMON_CROPS.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>

      <div>
        <span className="text-body-sm font-bold text-on-surface block mb-1">{t(language, 'profile.form.preferredLanguage')}</span>
        <ChoiceChips
          name={t(language, 'profile.form.preferredLanguage')}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.code === 'en' ? 'English' : l.code === 'hi' ? 'हिन्दी' : 'मराठी' }))}
          value={values.preferredLanguage}
          onChange={set('preferredLanguage')}
        />
      </div>

      {formError && (
        <div className="bg-error-container text-on-error-container p-3 rounded-xl flex items-center gap-3 shadow-sm" role="alert">
          <span className="material-symbols-outlined text-error text-[22px]">warning</span>
          <p className="font-body-sm text-xs flex-1">{formError}</p>
        </div>
      )}

      <div className="flex gap-space-sm">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1 py-4 rounded-xl bg-surface-container-high text-on-surface font-headline-md text-headline-md shadow-sm active:scale-95 transition-transform disabled:opacity-60"
          >
            {t(language, 'common.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="flex-[2] w-full py-4 rounded-xl bg-secondary text-on-secondary font-headline-md text-headline-md shadow-lg flex items-center justify-center gap-space-sm active:scale-95 transition-transform disabled:opacity-80"
        >
          {submitting ? (
            <>
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>{submittingLabel || t(language, 'common.saving')}</span>
            </>
          ) : (
            <>
              <span>{submitLabel || t(language, 'saveProfile')}</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </>
          )}
        </button>
      </div>
      </fieldset>
    </form>
  );
}
