/**
 * Validation for the Phase 4 forecasting endpoints.
 * Every function returns { value } or { errors: [{ field, message }] } and never throws,
 * matching the Phase 3 mandi validator conventions.
 */

/**
 * Path segments may be mandi/commodity CODES (`MH_PUNE_APMC`, `ONION`), exact names
 * (`Pune APMC (Gultekdi)`, `नासिक मार्केट यार्ड`, `Kolar (Karnataka)`) or numeric ids.
 * The accepted set is therefore the name pattern plus the code separators `_ - .`,
 * anchored so the value must start with a letter, digit or mark.
 *
 * Quotes, semicolons and SQL comment markers stay rejected, so an injection-shaped
 * value cannot pass validation.
 */
const TEXT_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.,'()&/_-]*$/u;
const CODE_PATTERN = /^[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}\s.,'()&/_-]*$/u;
export const MAX_HORIZON = 7;
export const FORECAST_ORDER = ['ASC', 'DESC'];

function text(raw, field, errors, { max = 100, required = false, pattern = TEXT_PATTERN } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof raw !== 'string') return void errors.push({ field, message: `${field} must be text` });
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!value) {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (value.length > max || !pattern.test(value)) {
    return void errors.push({ field, message: `${field} contains unsupported characters or is too long` });
  }
  return value;
}

function integer(raw, field, errors, { min, max, fallback }) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const textValue = String(raw).trim();
  if (!/^\d+$/.test(textValue)) return void errors.push({ field, message: `${field} must be a whole number` });
  const value = Number(textValue);
  if (value < min || value > max) return void errors.push({ field, message: `${field} must be between ${min} and ${max}` });
  return value;
}

function boolean(raw, field, errors, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return void errors.push({ field, message: `${field} must be true or false` });
}

function oneOf(raw, field, errors, allowed) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = String(raw).trim().toUpperCase();
  if (!allowed.includes(value)) return void errors.push({ field, message: `${field} must be one of ${allowed.join(', ')}` });
  return value;
}

const done = (value, errors) => (errors.length ? { errors } : { value });

/** GET /api/forecast/:commodity/:mandi — path parameters. */
export function validateForecastPath(params = {}) {
  const errors = [];
  const value = {
    commodity: text(params.commodity, 'commodity', errors, { required: true, pattern: CODE_PATTERN }),
    mandi: text(params.mandi, 'mandi', errors, { required: true, pattern: CODE_PATTERN }),
  };
  return done(value, errors);
}

/**
 * GET /api/forecast/:commodity/:mandi — query parameters.
 * `horizon` selects a single future day; omitted returns all persisted horizons (1..7).
 */
export function validateForecastQuery(query = {}) {
  const errors = [];
  const value = {
    horizon: integer(query.horizon, 'horizon', errors, { min: 1, max: MAX_HORIZON }),
    modelVersion: text(query.modelVersion, 'modelVersion', errors, { max: 64 }),
    includeSample: boolean(query.includeSample, 'includeSample', errors, true),
    order: oneOf(query.order, 'order', errors, FORECAST_ORDER) || 'ASC',
  };
  return done(value, errors);
}
