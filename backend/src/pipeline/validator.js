import { CANONICAL_ARRIVAL_UNIT, CANONICAL_PRICE_UNIT } from './normalizer.js';

/**
 * Mandi Data Validator — runs on NORMALISED records (see normalizer.js).
 * Every rejection carries a stable code so data-quality reports can count them.
 */

export const EARLIEST_ACCEPTED_DATE = '2000-01-01';
// Sources that publish genuine market records. Their rows may never be flagged as sample data.
export const GENUINE_SOURCES = new Set(['DATA_GOV_IN', 'CEDA']);
export const SAMPLE_SOURCES = new Set(['MOCK_PROVIDER']);
const PRICE_OUTLIER_INR_PER_QUINTAL = 1_000_000;

function todayPlusOneUtc(now) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {object} record normalised record
 * @param {{ now?: Date }} options
 * @returns {{ valid: boolean, errors: Array<{code: string, message: string}>, warnings: string[] }}
 */
export function validateMandiRecord(record, { now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (code, message) => errors.push({ code, message });

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: [{ code: 'INVALID_RECORD', message: 'Record must be an object' }], warnings };
  }

  if (!record.source) fail('MISSING_SOURCE', 'Source identity is required');
  if (GENUINE_SOURCES.has(record.source) && record.is_sample_data) {
    fail('SAMPLE_FLAG_ON_GENUINE_SOURCE', `${record.source} records cannot be flagged as sample data`);
  }
  if (SAMPLE_SOURCES.has(record.source) && !record.is_sample_data) {
    fail('SAMPLE_SOURCE_NOT_FLAGGED', `${record.source} records must be flagged as sample data`);
  }

  if (!record.source_state_name) fail('MISSING_STATE', 'State is missing (never inferred)');
  if (!record.source_district_name) fail('MISSING_DISTRICT', 'District is missing (never inferred)');
  if (!record.source_market_name) fail('MISSING_MARKET', 'Market name is missing');
  if (!record.mandi_code && record.source_state_name && record.source_district_name && record.source_market_name) {
    fail('INVALID_MARKET_IDENTITY', 'Market identity could not be built');
  }
  if (!record.commodity_code) fail('MISSING_COMMODITY', 'Commodity is missing');

  if (!record.price_date) {
    fail(record.quality_flags?.includes('INVALID_DATE') ? 'INVALID_DATE' : 'MISSING_DATE', 'Reporting date is missing or not a real calendar date');
  } else {
    if (record.price_date > todayPlusOneUtc(now)) fail('FUTURE_DATE', `Reporting date ${record.price_date} is in the future`);
    if (record.price_date < EARLIEST_ACCEPTED_DATE) fail('DATE_TOO_OLD', `Reporting date ${record.price_date} is before ${EARLIEST_ACCEPTED_DATE}`);
  }

  if (record.price_unit !== CANONICAL_PRICE_UNIT) {
    fail('UNKNOWN_PRICE_UNIT', 'Price unit is missing or not convertible to INR/quintal');
  }

  const { min_price: min, max_price: max, modal_price: modal } = record;
  for (const [field, value] of [['min_price', min], ['max_price', max], ['modal_price', modal]]) {
    if (value !== null && value !== undefined && !(Number.isFinite(value) && value > 0)) {
      fail('NON_POSITIVE_PRICE', `${field} must be a positive number, got ${value}`);
    }
  }
  if (modal === null || modal === undefined) fail('MISSING_MODAL_PRICE', 'Modal price is required');
  if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
    fail('MIN_ABOVE_MAX', `min_price (${min}) exceeds max_price (${max})`);
  }
  if (Number.isFinite(modal) && ((Number.isFinite(min) && modal < min) || (Number.isFinite(max) && modal > max))) {
    fail('MODAL_OUTSIDE_RANGE', `modal_price (${modal}) is outside min/max (${min}..${max})`);
  }
  if (Number.isFinite(modal) && modal > PRICE_OUTLIER_INR_PER_QUINTAL) warnings.push('PRICE_OUTLIER');

  if (record.arrivals_quantity !== null && record.arrivals_quantity !== undefined) {
    if (!(Number.isFinite(record.arrivals_quantity) && record.arrivals_quantity >= 0)) {
      fail('NEGATIVE_ARRIVALS', `arrivals_quantity must be >= 0, got ${record.arrivals_quantity}`);
    }
    if (record.arrival_unit !== CANONICAL_ARRIVAL_UNIT) fail('UNKNOWN_ARRIVAL_UNIT', 'Arrival unit missing');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export default { validateMandiRecord, GENUINE_SOURCES, SAMPLE_SOURCES };
