/**
 * Validation for the Phase 5 read-only market API query parameters.
 *
 * Every function returns { value } or { errors: [{ field, message }] } and never
 * throws, so the controller can turn any failure into a single 400
 * VALIDATION_ERROR envelope. Unknown query parameters are ignored (matching the
 * Phase 3 mandi validators) EXCEPT on /api/mandis/data-status, which accepts no
 * parameters at all and therefore rejects any it is given.
 *
 * Out-of-range values are rejected, never clamped: a caller asking for
 * `limit=5000` gets a 400 instead of a silently different page size.
 */
import { normalizeDate } from '../pipeline/normalizer.js';

// Same conservative text policy as the mandi validator — letters/marks/digits
// first, then the punctuation that appears in real market, district, variety,
// commodity and market-code names (market codes such as `MH_NSK_LASALGAON` use
// underscores). Quotes, semicolons and backslashes are rejected, so
// injection-shaped input never reaches a query; LIKE wildcards (`%`, `_`) are
// additionally escaped in the service. Nothing here is ever interpolated into SQL.
const TEXT_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.,'()&/_-]*$/u;
// A source is a registry code (mandi_sources.code), never free text.
const SOURCE_CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;

export const QUALITY_STATUSES = ['VALID', 'FLAGGED', 'REJECTED'];
export const ORDERS = ['ASC', 'DESC'];

const DATA_STATUS_FIELDS = new Set();

function text(raw, field, errors, { max = 100 } = {}) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') return void errors.push({ field, message: `${field} must be text` });
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!value) return undefined;
  if (value.length > max || !TEXT_PATTERN.test(value)) return void errors.push({ field, message: `${field} contains unsupported characters or is too long` });
  return value;
}

function integer(raw, field, errors, { min, max, fallback }) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const textValue = String(raw).trim();
  if (!/^-?\d+$/.test(textValue)) return void errors.push({ field, message: `${field} must be a whole number` });
  const value = Number(textValue);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return void errors.push({ field, message: `${field} must be between ${min} and ${max}` });
  }
  return value;
}

function isoDate(raw, field, errors) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  // Shape first (cheap reject), then a real calendar check: 2026-02-31 is not a date.
  const value = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? normalizeDate(raw, 'ISO') : null;
  if (!value) return void errors.push({ field, message: `${field} must be a real date in YYYY-MM-DD format` });
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

function sourceCode(raw, field, errors) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = String(raw).trim().toUpperCase();
  if (!SOURCE_CODE_PATTERN.test(value)) {
    return void errors.push({ field, message: `${field} must be a source code (letters, digits and underscores, max 32 characters)` });
  }
  return value;
}

const done = (value, errors) => (errors.length ? { errors } : { value });

/** GET /api/commodities — category, search, limit (1..1000, default 500), offset. */
export function validateCommodityListQuery(query = {}) {
  const errors = [];
  const value = {
    category: text(query.category, 'category', errors, { max: 100 }),
    search: text(query.search, 'search', errors, { max: 64 }),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 1000, fallback: 500 }),
    offset: integer(query.offset, 'offset', errors, { min: 0, max: 1_000_000, fallback: 0 }),
  };
  return done(value, errors);
}

/** GET /api/mandis — state, district, search, commodity, limit (1..1000, default 500), offset. */
export function validateMandiListQuery(query = {}) {
  const errors = [];
  const value = {
    state: text(query.state, 'state', errors, { max: 64 }),
    district: text(query.district, 'district', errors, { max: 64 }),
    search: text(query.search, 'search', errors, { max: 64 }),
    commodity: text(query.commodity, 'commodity', errors, { max: 100 }),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 1000, fallback: 500 }),
    offset: integer(query.offset, 'offset', errors, { min: 0, max: 1_000_000, fallback: 0 }),
  };
  return done(value, errors);
}

/** Shared price filters for /mandis/prices/latest and /mandis/prices/history. */
function priceFilters(query, errors) {
  return {
    commodity: text(query.commodity, 'commodity', errors, { max: 100 }),
    commodityCategory: text(query.commodityCategory, 'commodityCategory', errors, { max: 100 }),
    variety: text(query.variety, 'variety', errors, { max: 100 }),
    state: text(query.state, 'state', errors, { max: 64 }),
    district: text(query.district, 'district', errors, { max: 64 }),
    mandi: text(query.mandi, 'mandi', errors, { max: 128 }),
    marketCode: text(query.marketCode, 'marketCode', errors, { max: 64 }),
    source: sourceCode(query.source, 'source', errors),
    qualityStatus: oneOf(query.qualityStatus, 'qualityStatus', errors, QUALITY_STATUSES),
    includeSample: boolean(query.includeSample, 'includeSample', errors, true),
  };
}

/** GET /api/mandis/prices/latest — one row per (mandi, commodity, variety), limit 1..200 (default 50). */
export function validateLatestQuery(query = {}) {
  const errors = [];
  const value = {
    ...priceFilters(query, errors),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 200, fallback: 50 }),
    offset: integer(query.offset, 'offset', errors, { min: 0, max: 1_000_000, fallback: 0 }),
  };
  return done(value, errors);
}

/** GET /api/mandis/prices/history — latest filters plus a validated date range and order. */
export function validateHistoryQuery(query = {}) {
  const errors = [];
  const value = {
    ...priceFilters(query, errors),
    startDate: isoDate(query.startDate, 'startDate', errors),
    endDate: isoDate(query.endDate, 'endDate', errors),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 1000, fallback: 100 }),
    offset: integer(query.offset, 'offset', errors, { min: 0, max: 1_000_000, fallback: 0 }),
    order: oneOf(query.order, 'order', errors, ORDERS) || 'ASC',
  };
  // ISO dates compare correctly as strings.
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    errors.push({ field: 'startDate', message: 'startDate must not be after endDate' });
  }
  return done(value, errors);
}

/**
 * GET /api/mandis/data-status — takes no parameters, so any parameter it is
 * given is a mistake the caller should hear about instead of silently ignoring.
 */
export function validateDataStatusQuery(query = {}) {
  const errors = [];
  const unknown = Object.keys(query ?? {}).filter((key) => !DATA_STATUS_FIELDS.has(key));
  if (unknown.length) {
    errors.push({ field: unknown[0], message: `Unsupported query parameter(s): ${unknown.join(', ')}` });
  }
  return done({}, errors);
}
