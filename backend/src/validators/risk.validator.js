/**
 * Validation for Phase 6 Agricultural Risk Intelligence endpoints.
 * Returns { value } or { errors: [{ field, message }] } matching validator conventions.
 */

const CODE_PATTERN = /^[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}\s.,'()&/_-]*$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(raw, field, errors, { max = 100, required = false, pattern = CODE_PATTERN } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: `${field} must be text` });
    return undefined;
  }
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!value) {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (value.length > max || !pattern.test(value)) {
    errors.push({ field, message: `${field} contains unsupported characters or is too long` });
    return undefined;
  }
  return value;
}

function dateString(raw, field, errors) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const str = String(raw).trim();
  if (!DATE_PATTERN.test(str)) {
    errors.push({ field, message: `${field} must be in YYYY-MM-DD format` });
    return undefined;
  }
  const date = new Date(str);
  if (isNaN(date.getTime())) {
    errors.push({ field, message: `${field} is not a valid calendar date` });
    return undefined;
  }
  return str;
}

function boolean(raw, field, errors, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  errors.push({ field, message: `${field} must be true or false` });
  return fallback;
}

function integer(raw, field, errors, { min = 1, max = 100, fallback = 20 } = {}) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const textValue = String(raw).trim();
  if (!/^\d+$/.test(textValue)) {
    errors.push({ field, message: `${field} must be a whole number` });
    return fallback;
  }
  const value = Number(textValue);
  if (value < min || value > max) {
    errors.push({ field, message: `${field} must be between ${min} and ${max}` });
    return fallback;
  }
  return value;
}

const done = (value, errors) => (errors.length ? { errors } : { value });

/**
 * GET /api/risk/mandi/:commodity/:mandi — path parameters.
 */
export function validateRiskPath(params = {}) {
  const errors = [];
  const value = {
    commodity: text(params.commodity, 'commodity', errors, { required: true, pattern: CODE_PATTERN }),
    mandi: text(params.mandi, 'mandi', errors, { required: true, pattern: CODE_PATTERN }),
  };
  return done(value, errors);
}

/**
 * GET /api/risk/mandi/:commodity/:mandi — query parameters.
 */
export function validateRiskQuery(query = {}) {
  const errors = [];
  const value = {
    includeSample: boolean(query.includeSample, 'includeSample', errors, false),
    referenceDate: dateString(query.referenceDate, 'referenceDate', errors),
  };
  return done(value, errors);
}

/**
 * GET /api/risk/summary — query parameters.
 */
export function validateRiskSummaryQuery(query = {}) {
  const errors = [];
  const value = {
    includeSample: boolean(query.includeSample, 'includeSample', errors, false),
    referenceDate: dateString(query.referenceDate, 'referenceDate', errors),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 100, fallback: 20 }),
  };
  return done(value, errors);
}
