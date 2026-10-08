import directory from '../data/location-index.json';

const cache = new Map();
const normalise = (value) => String(value || '').normalize('NFC').trim().toLocaleLowerCase('en-IN');

export const getDistricts = (state) => directory.find((entry) => entry.name === state)?.districts || [];
export const getDistrict = (state, name) => getDistricts(state).find((entry) => normalise(entry.name) === normalise(name));

/** Static, same-origin reference data. No profile details or tokens are sent. */
export async function loadPlaces(state, districtName, { signal } = {}) {
  const district = getDistrict(state, districtName);
  if (!district) return [];
  if (cache.has(district.code)) return cache.get(district.code);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}locations/${district.code}.json`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Location directory unavailable');
    const data = await response.json();
    const stateCode = directory.find((entry) => entry.name === state)?.code;
    if (data.districtCode !== district.code || data.stateCode !== stateCode ||
        !Array.isArray(data.names) || !data.names.every((name) => typeof name === 'string')) {
      throw new Error('Invalid location directory');
    }
    cache.set(district.code, data.names);
    return data.names;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** Keep existing saved names editable without silently rewriting legacy addresses. */
export async function validateLocation(values, initialValues = {}) {
  const sameDistrict = values.state === initialValues.state && values.district === initialValues.district;
  if (!sameDistrict && !getDistrict(values.state, values.district)) {
    return { errors: { district: 'location.invalidDistrict' } };
  }
  if (!values.village.trim() || (sameDistrict && values.village === initialValues.village)) {
    return { errors: {}, village: values.village.trim() || null };
  }
  const places = await loadPlaces(values.state, values.district);
  const village = places.find((name) => normalise(name) === normalise(values.village));
  return village ? { errors: {}, village } : { errors: { village: 'location.invalidVillage' } };
}
