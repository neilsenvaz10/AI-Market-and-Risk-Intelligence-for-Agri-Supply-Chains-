/**
 * Validation and sanitization for farmer profile payloads.
 * Field names are camelCase on the API and snake_case in PostgreSQL.
 */

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

export const QUANTITY_UNITS = ['kg', 'quintal'];
export const LANGUAGES = ['en', 'hi', 'mr'];

// Letters in any script (incl. Devanagari marks), spaces and common name punctuation.
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;
const PLACE_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.,'()/&@+[\]"-]*$/u;
const CROP_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'()/-]*$/u;

const MAX_QUANTITY = 10_000_000; // fits NUMERIC(12,2)

const EDITABLE_FIELDS = [
  'fullName', 'state', 'district', 'village', 'primaryCrop',
  'cropQuantity', 'quantityUnit', 'preferredLanguage',
];
const PROTECTED_FIELDS = ['id', 'firebaseUid', 'firebase_uid', 'uid', 'phoneNumber', 'phone_number', 'phone', 'createdAt', 'updatedAt'];

const collapse = (value) => value.normalize('NFC').trim().replace(/\s+/g, ' ');

function validateText(value, { label, min, max, pattern, required }) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return required ? { error: `${label} is required` } : { value: null };
  }
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const clean = collapse(value);
  if (clean.length < min) return { error: `${label} must be at least ${min} characters` };
  if (clean.length > max) return { error: `${label} must be at most ${max} characters` };
  if (!pattern.test(clean)) return { error: `${label} contains invalid characters` };
  return { value: clean };
}

const validators = {
  fullName: (v) => validateText(v, { label: 'Full name', min: 2, max: 100, pattern: NAME_PATTERN, required: true }),
  state: (v) => {
    if (typeof v !== 'string' || !v.trim()) return { error: 'State is required' };
    const match = INDIAN_STATES.find((s) => s.toLowerCase() === collapse(v).toLowerCase());
    return match ? { value: match } : { error: 'Select a valid Indian state or union territory' };
  },
  district: (v) => validateText(v, { label: 'District', min: 2, max: 64, pattern: PLACE_PATTERN, required: true }),
  village: (v) => validateText(v, { label: 'Village / town', min: 2, max: 100, pattern: PLACE_PATTERN, required: false }),
  primaryCrop: (v) => validateText(v, { label: 'Primary crop', min: 2, max: 64, pattern: CROP_PATTERN, required: true }),
  cropQuantity: (v) => {
    if (v === undefined || v === null || v === '') return { error: 'Crop quantity is required' };
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
    if (!Number.isFinite(n)) return { error: 'Crop quantity must be a number' };
    if (n <= 0) return { error: 'Crop quantity must be greater than zero' };
    if (n >= MAX_QUANTITY) return { error: 'Crop quantity is too large' };
    return { value: Math.round(n * 100) / 100 };
  },
  quantityUnit: (v) => (QUANTITY_UNITS.includes(v) ? { value: v } : { error: 'Quantity unit must be kg or quintal' }),
  preferredLanguage: (v) => (LANGUAGES.includes(v) ? { value: v } : { error: 'Preferred language must be en, hi or mr' }),
};

/**
 * Validates a farmer payload.
 * @param {object} body request body
 * @param {{ partial?: boolean }} options partial=true for updates (only provided fields are checked)
 * @returns {{ data: object, errors: Record<string,string> | null }}
 */
export function validateFarmerPayload(body, { partial = false } = {}) {
  const errors = {};
  const data = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { data, errors: { body: 'Request body must be a JSON object' } };
  }

  for (const key of Object.keys(body)) {
    if (PROTECTED_FIELDS.includes(key)) {
      errors[key] = `${key} cannot be set or changed by the client`;
    } else if (!EDITABLE_FIELDS.includes(key)) {
      errors[key] = `Unknown field: ${key}`;
    }
  }

  for (const field of EDITABLE_FIELDS) {
    const provided = Object.prototype.hasOwnProperty.call(body, field);
    if (partial && !provided) continue;
    // Optional fields with defaults on create
    if (!partial && !provided && field === 'village') { data.village = null; continue; }
    if (!partial && !provided && field === 'quantityUnit') { data.quantityUnit = 'quintal'; continue; }
    if (!partial && !provided && field === 'preferredLanguage') { data.preferredLanguage = 'en'; continue; }

    const result = validators[field](body[field]);
    if (result.error) errors[field] = result.error;
    else data[field] = result.value;
  }

  if (partial && Object.keys(errors).length === 0 && Object.keys(data).length === 0) {
    errors.body = 'Provide at least one field to update';
  }

  return { data, errors: Object.keys(errors).length ? errors : null };
}
