/**
 * Validation for mandi API query parameters and the ingestion request body.
 * Every function returns { value } or { errors: [{ field, message }] } and never throws.
 */
import { normalizeDate } from '../pipeline/normalizer.js';

const TEXT_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s.,'()&/-]*$/u;
export const SOURCES = ['DATA_GOV_IN', 'CEDA', 'MOCK_PROVIDER'];
export const SYNC_PROVIDERS = ['DATA_GOV_IN', 'CEDA', 'MOCK'];

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
  if (value < min || value > max) return void errors.push({ field, message: `${field} must be between ${min} and ${max}` });
  return value;
}

function isoDate(raw, field, errors) {
  if (raw === undefined || raw === null || raw === '') return undefined;
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

const done = (value, errors) => (errors.length ? { errors } : { value });

export function validateMandiListQuery(query = {}) {
  const errors = [];
  const value = {
    state: text(query.state, 'state', errors, { max: 64 }),
    district: text(query.district, 'district', errors, { max: 64 }),
    search: text(query.search, 'search', errors, { max: 64 }),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 1000, fallback: 500 }),
    offset: integer(query.offset, 'offset', errors, { min: 0, max: 1_000_000, fallback: 0 }),
  };
  return done(value, errors);
}

export function validateMandiId(raw) {
  const errors = [];
  const id = integer(raw, 'id', errors, { min: 1, max: 2_147_483_647 });
  if (id === undefined && !errors.length) errors.push({ field: 'id', message: 'id is required' });
  return done(id, errors);
}

export function validateLatestQuery(query = {}) {
  const errors = [];
  const value = {
    commodity: text(query.commodity, 'commodity', errors),
    state: text(query.state, 'state', errors, { max: 64 }),
    district: text(query.district, 'district', errors, { max: 64 }),
    mandiId: integer(query.mandiId, 'mandiId', errors, { min: 1, max: 2_147_483_647 }),
    source: oneOf(query.source, 'source', errors, SOURCES),
    includeSample: boolean(query.includeSample, 'includeSample', errors, true),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 200, fallback: 50 }),
    offset: integer(query.offset, 'offset', errors, { min: 0, max: 1_000_000, fallback: 0 }),
  };
  return done(value, errors);
}

export function validateHistoryQuery(query = {}) {
  const errors = [];
  const value = {
    commodity: text(query.commodity, 'commodity', errors),
    state: text(query.state, 'state', errors, { max: 64 }),
    district: text(query.district, 'district', errors, { max: 64 }),
    mandiId: integer(query.mandiId, 'mandiId', errors, { min: 1, max: 2_147_483_647 }),
    source: oneOf(query.source, 'source', errors, SOURCES),
    includeSample: boolean(query.includeSample, 'includeSample', errors, true),
    startDate: isoDate(query.startDate, 'startDate', errors),
    endDate: isoDate(query.endDate, 'endDate', errors),
    limit: integer(query.limit, 'limit', errors, { min: 1, max: 1000, fallback: 100 }),
    offset: integer(query.offset, 'offset', errors, { min: 0, max: 1_000_000, fallback: 0 }),
    order: oneOf(query.order, 'order', errors, ['ASC', 'DESC']) || 'ASC',
  };
  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    errors.push({ field: 'startDate', message: 'startDate must not be after endDate' });
  }
  return done(value, errors);
}

const SYNC_FIELDS = new Set(['provider', 'state', 'district', 'commodity', 'fromDate', 'toDate', 'days', 'maxRecords', 'limit', 'crossSource']);

export function validateSyncRequest(body = {}) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }
  const unknown = Object.keys(body).filter((key) => !SYNC_FIELDS.has(key));
  if (unknown.length) errors.push({ field: unknown[0], message: `Unsupported field(s): ${unknown.join(', ')}` });

  const value = {
    provider: oneOf(body.provider, 'provider', errors, SYNC_PROVIDERS),
    state: text(body.state, 'state', errors, { max: 64 }),
    district: text(body.district, 'district', errors, { max: 64 }),
    commodity: text(body.commodity, 'commodity', errors),
    fromDate: isoDate(body.fromDate, 'fromDate', errors),
    toDate: isoDate(body.toDate, 'toDate', errors),
    days: integer(body.days, 'days', errors, { min: 1, max: 30 }),
    maxRecords: integer(body.maxRecords ?? body.limit, 'maxRecords', errors, { min: 1, max: 5000, fallback: 2000 }),
    crossSource: boolean(body.crossSource, 'crossSource', errors, false),
  };
  if (!value.provider && !errors.some((e) => e.field === 'provider')) errors.push({ field: 'provider', message: 'provider is required' });
  if (value.fromDate && value.toDate && value.fromDate > value.toDate) errors.push({ field: 'fromDate', message: 'fromDate must not be after toDate' });
  if (value.fromDate && value.toDate) {
    const spanDays = (Date.parse(value.toDate) - Date.parse(value.fromDate)) / 86_400_000 + 1;
    const maxSpan = value.provider === 'CEDA' ? 366 : 31;
    if (spanDays > maxSpan) errors.push({ field: 'toDate', message: `date range must be at most ${maxSpan} days for ${value.provider}` });
  }
  if (value.provider === 'CEDA' && (!value.commodity || !value.state || !value.district || !value.fromDate || !value.toDate)) {
    errors.push({ field: 'provider', message: 'CEDA requests need commodity, state, district, fromDate and toDate' });
  }
  return done(value, errors);
}
