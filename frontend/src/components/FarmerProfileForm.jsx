import { useState } from 'react';
import { COMMON_CROPS, INDIAN_STATES, QUANTITY_UNITS, formatPhone } from '../constants/profile';
import { EMPTY_PROFILE, toPayload, validateProfile } from '../utils/profileValidation';
import { LANGUAGES } from '../i18n/languages';
import { Field, inputClass } from './FormField';

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
  submittingLabel = 'Saving...',
  onSubmit,
  onCancel,
}) {
  const [values, setValues] = useState(() => ({ ...EMPTY_PROFILE, ...normalise(initialValues) }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (eventOrValue) => {
    const value = eventOrValue?.target ? eventOrValue.target.value : eventOrValue;
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    const clientErrors = validateProfile(values);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setFormError('Please correct the highlighted fields.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(toPayload(values));
    } catch (err) {
      if (err.details) setErrors(err.details);
      setFormError(err.message || 'Could not save your profile. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-md">
      <Field label="Full Name / पूर्ण नाव" htmlFor="fullName" error={errors.fullName}>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">person</span>
        <input id="fullName" className={inputClass} value={values.fullName} onChange={set('fullName')}
          placeholder="e.g. Ramesh Patil" autoComplete="name" maxLength={100} />
      </Field>

      <Field label="Verified Mobile Number" htmlFor="phoneNumber">
        <span className="material-symbols-outlined text-secondary text-[20px] pl-1" style={{ fontVariationSettings: "'FILL' 1" }}>
          verified
        </span>
        <input id="phoneNumber" className={`${inputClass} text-on-surface-variant`} value={formatPhone(phoneNumber)} readOnly
          aria-readonly="true" tabIndex={-1} />
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container shrink-0">
          OTP VERIFIED
        </span>
      </Field>

      <Field label="State / राज्य" htmlFor="state" error={errors.state}>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">map</span>
        <select id="state" className={`${inputClass} appearance-none cursor-pointer`} value={values.state} onChange={set('state')}>
          <option value="">Select state</option>
          {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pointer-events-none">expand_more</span>
      </Field>

      <div className="grid grid-cols-2 gap-space-sm">
        <Field label="District / जिल्हा" htmlFor="district" error={errors.district}>
          <input id="district" className={inputClass} value={values.district} onChange={set('district')}
            placeholder="e.g. Nashik" maxLength={64} />
        </Field>
        <Field label="Village / Town" htmlFor="village" error={errors.village} optional>
          <input id="village" className={inputClass} value={values.village} onChange={set('village')}
            placeholder="e.g. Lasalgaon" maxLength={100} />
        </Field>
      </div>

      <Field label="Primary Crop / मुख्य पीक" htmlFor="primaryCrop" error={errors.primaryCrop}>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">eco</span>
        <input id="primaryCrop" className={inputClass} value={values.primaryCrop} onChange={set('primaryCrop')}
          placeholder="e.g. Onion" list="crop-suggestions" maxLength={64} autoComplete="off" />
        <datalist id="crop-suggestions">
          {COMMON_CROPS.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>

      <div>
        <Field label="Crop Quantity / प्रमाण" htmlFor="cropQuantity" error={errors.cropQuantity}>
          <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1">scale</span>
          <input id="cropQuantity" className={inputClass} value={values.cropQuantity} onChange={set('cropQuantity')}
            placeholder="e.g. 25" inputMode="decimal" />
        </Field>
        <div className="mt-space-sm">
          <ChoiceChips name="Quantity unit" options={QUANTITY_UNITS} value={values.quantityUnit} onChange={set('quantityUnit')} />
        </div>
      </div>

      <div>
        <span className="text-body-sm font-bold text-on-surface block mb-1">Preferred Language / भाषा</span>
        <ChoiceChips
          name="Preferred language"
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
            Cancel
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
              <span>{submittingLabel}</span>
            </>
          ) : (
            <>
              <span>{submitLabel}</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
