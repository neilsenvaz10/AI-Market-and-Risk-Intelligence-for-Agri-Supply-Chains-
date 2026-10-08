import { useEffect, useState } from 'react';
import { INDIAN_STATES } from '../constants/profile';
import { getDistrict, getDistricts, loadPlaces } from '../services/locationService';
import { t } from '../i18n/strings';
import { Field, inputClass } from './FormField';

export default function LocationFields({ values, initialValues, errors, language, onChange }) {
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const district = getDistrict(values.state, values.district);
  const districts = getDistricts(values.state);
  const key = district?.code;
  const status = !key ? 'idle' : result?.key === key ? result.status : 'loading';
  const names = result?.key === key && result?.status === 'ready' ? result.names : [];
  const query = values.village.trim().toLocaleLowerCase('en-IN');
  const suggestions = names.filter((name) => name.toLocaleLowerCase('en-IN').includes(query)).slice(0, 100);
  const legacyDistrict = values.state === initialValues?.state && values.district === initialValues?.district &&
    values.district && !district;
  const savedDistrictOption = values.state === initialValues?.state && values.district === initialValues?.district &&
    values.district && !districts.some((entry) => entry.name === values.district);

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    loadPlaces(values.state, values.district, { signal: controller.signal }).then((places) => {
      if (!controller.signal.aborted) setResult({ key, status: 'ready', names: places });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key, status: 'error', names: [] });
    });
    return () => controller.abort();
  }, [key, values.state, values.district, retry]);

  return (
    <>
      <Field label={t(language, 'profile.form.state')} htmlFor="state" error={errors.state}>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] pl-1" aria-hidden="true">map</span>
        <select id="state" className={`${inputClass} cursor-pointer`} value={values.state}
          onChange={(e) => onChange({ state: e.target.value, district: '', village: '' })}>
          <option value="">{t(language, 'profile.form.selectState')}</option>
          {INDIAN_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
        </select>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
        <Field label={t(language, 'profile.form.district')} htmlFor="district" error={errors.district}>
          <select id="district" className={`${inputClass} cursor-pointer disabled:opacity-60`}
            value={values.district} disabled={!values.state} aria-invalid={Boolean(errors.district)}
            onChange={(e) => onChange({ district: e.target.value, village: '' })}>
            <option value="">{t(language, values.state ? 'location.selectDistrict' : 'location.selectStateFirst')}</option>
            {savedDistrictOption && <option value={values.district}>{values.district}</option>}
            {districts.map((entry) => <option key={entry.code} value={entry.name}>{entry.name}</option>)}
          </select>
        </Field>
        <div>
          <Field label={t(language, 'profile.form.village')} htmlFor="village" error={errors.village} optional>
            <input id="village" className={`${inputClass} disabled:opacity-60`} value={values.village}
              onChange={(e) => onChange({ village: e.target.value })} maxLength={100}
              disabled={!values.district || status === 'loading'} list="location-places" autoComplete="off"
              aria-describedby="location-help" aria-invalid={Boolean(errors.village)}
              placeholder={t(language, !values.district ? 'location.selectDistrictFirst' : status === 'loading' ? 'location.loading' : 'location.searchVillage')} />
            <datalist id="location-places">
              {suggestions.map((name) => <option key={name} value={name} />)}
            </datalist>
          </Field>
          <p id="location-help" className="text-body-sm text-on-surface-variant mt-2" aria-live="polite">
            {status === 'loading' && t(language, 'location.loading')}
            {status === 'ready' && t(language, names.length ? 'location.searchHint' : 'location.noPlaces')}
            {legacyDistrict && t(language, 'location.legacy')}
            {status === 'error' && t(language, 'location.loadError')}
          </p>
          {status === 'error' && <button type="button" className="text-body-sm text-secondary font-bold underline mt-1"
            onClick={() => { setResult(null); setRetry((value) => value + 1); }}>
            {t(language, 'auth.status.tryAgain')}
          </button>}
        </div>
      </div>
    </>
  );
}
