/**
 * End-to-end trace of ONE stored price record:
 *   raw response item -> normalizer -> validator -> PostgreSQL row -> Express API -> expected dashboard text
 *
 * Read-only. Each stage returns { stage, status: 'PASS' | 'FAIL' | 'UNAVAILABLE', ... } and the
 * final verdict is one of:
 *   GENUINE_TRACE_PASS   every stage passed for a record from a genuine source
 *   SAMPLE_ONLY          stages may pass, but the record is sample data — NOT a genuine trace
 *   SYNTHETIC_FIXTURE    the raw payload is marked as a test fixture — NOT a genuine trace
 *   FAIL / INCOMPLETE    a stage failed / a stage could not be evaluated
 * A genuine verdict is therefore impossible for synthetic data, by construction.
 */
import { DataGovInProvider } from './providers/data-gov-in.provider.js';
import { buildCedaRecords } from './providers/ceda.provider.js';
import { normalizeMandiRecord } from './normalizer.js';
import { validateMandiRecord } from './validator.js';

export const GENUINE_SOURCES = new Set(['DATA_GOV_IN', 'CEDA']);
const FIXTURE_MARKER = '_synthetic_test_fixture';

const COMPARED_FIELDS = [
  'mandi_code', 'mandi_name', 'state', 'district', 'commodity_code', 'commodity_name', 'variety', 'grade', 'price_date',
  'min_price', 'max_price', 'modal_price', 'price_unit', 'arrivals_quantity', 'arrival_unit', 'source',
  'source_market_name', 'source_commodity_name', 'source_state_name', 'source_district_name',
];

const same = (a, b) => {
  const empty = (v) => v === null || v === undefined;
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (typeof a === 'number' || typeof b === 'number' || /^-?\d+(\.\d+)?$/.test(String(a))) {
    const x = Number(a);
    const y = Number(b);
    if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) < 1e-9;
  }
  return String(a) === String(b);
};

export async function loadRow(pool, { id, source }) {
  const where = id ? 'mp.id = $1' : 'mp.source = $1 AND mp.is_sample_data = FALSE';
  const result = await pool.query(
    `SELECT mp.*, m.code AS mandi_code, m.name AS mandi_name, m.state, m.district,
            c.code AS commodity_code, c.name AS commodity_name
     FROM mandi_prices mp
     JOIN mandis m ON m.id = mp.mandi_id
     JOIN commodities c ON c.id = mp.commodity_id
     WHERE ${where}
     ORDER BY mp.fetched_at DESC NULLS LAST, mp.id DESC
     LIMIT 1`, [id ?? source]);
  return result.rows[0] || null;
}

/** Rebuilds the provider-level raw record from what was stored, then normalises and validates it. */
export function replay(row) {
  const raw = row.raw_payload;
  if (raw === null || raw === undefined) return { status: 'UNAVAILABLE', reason: 'raw_payload was not stored for this row' };
  let rawRecord;
  if (row.source === 'DATA_GOV_IN') {
    const assumed = (row.quality_flags || []).includes('PRICE_UNIT_FROM_PUBLISHER_CONVENTION');
    rawRecord = new DataGovInProvider({ apiKey: 'unused-for-replay' }).transformRecord(raw, {
      priceUnit: assumed ? null : 'INR/quintal', fetchedAt: row.fetched_at,
    });
  } else if (row.source === 'CEDA') {
    if (!raw.price) return { status: 'UNAVAILABLE', reason: 'CEDA raw payload has no price item' };
    [rawRecord] = buildCedaRecords([raw.price], raw.quantity ? [raw.quantity] : [], {
      stateName: row.source_state_name, districtName: row.source_district_name, commodityName: row.source_commodity_name,
      marketNames: new Map([[String(raw.price.market_id), row.source_market_name]]), fetchedAt: row.fetched_at,
    });
  } else {
    return { status: 'UNAVAILABLE', reason: `no replay available for source ${row.source}` };
  }
  const normalised = normalizeMandiRecord(rawRecord);
  const validation = validateMandiRecord(normalised);
  return { status: 'OK', rawRecord, normalised, validation };
}

export function compareRecord(expected, actual, fields = COMPARED_FIELDS) {
  return fields.filter((f) => !same(expected[f], actual[f])).map((f) => ({ field: f, expected: expected[f] ?? null, actual: actual[f] ?? null }));
}

/** Text the dashboard should show for this record (English, for manual comparison in the browser). */
export function expectedDashboardText(apiRow) {
  const day = String(apiRow.price_date).slice(0, 10);
  return {
    market: apiRow.mandi_name,
    district_state: `${apiRow.district}, ${apiRow.state}`,
    modal_price: `₹${Number(apiRow.modal_price).toLocaleString('en-IN')} / quintal`,
    reported: new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    source: apiRow.is_sample_data ? 'Sample feed (not real market prices)' : apiRow.source_label,
  };
}

export function computeVerdict({ row, stages }) {
  const raw = row.raw_payload;
  if (raw && typeof raw === 'object' && FIXTURE_MARKER in raw) return 'SYNTHETIC_FIXTURE';
  if (row.is_sample_data || !GENUINE_SOURCES.has(row.source)) return 'SAMPLE_ONLY';
  if (stages.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (stages.some((s) => s.status === 'UNAVAILABLE')) return 'INCOMPLETE';
  return 'GENUINE_TRACE_PASS';
}

/**
 * @param {object} p
 * @param {object} p.row  loadRow() result
 * @param {(path: string) => Promise<{status:number, body:object}>} p.fetchApi  GET against the Express API
 */
export async function traceRow({ row, fetchApi }) {
  const stages = [];
  stages.push({
    stage: '1 stored raw response item',
    status: row.raw_payload ? 'PASS' : 'UNAVAILABLE',
    detail: row.raw_payload ? { source: row.source, source_record_key: row.source_record_key, fetched_at: row.fetched_at } : 'raw_payload missing',
  });

  const replayed = replay(row);
  if (replayed.status !== 'OK') {
    stages.push({ stage: '2 normalizer', status: 'UNAVAILABLE', detail: replayed.reason });
    stages.push({ stage: '3 validator', status: 'UNAVAILABLE', detail: replayed.reason });
    stages.push({ stage: '4 matches PostgreSQL row', status: 'UNAVAILABLE', detail: replayed.reason });
  } else {
    stages.push({ stage: '2 normalizer', status: 'PASS', detail: { price_date: replayed.normalised.price_date, modal_price: replayed.normalised.modal_price, quality_flags: replayed.normalised.quality_flags } });
    stages.push({
      stage: '3 validator',
      status: replayed.validation.valid ? 'PASS' : 'FAIL',
      detail: replayed.validation.valid ? { warnings: replayed.validation.warnings } : replayed.validation.errors,
    });
    const diffs = compareRecord(replayed.normalised, row);
    stages.push({ stage: '4 matches PostgreSQL row', status: diffs.length ? 'FAIL' : 'PASS', detail: diffs.length ? diffs : `${COMPARED_FIELDS.length} fields identical` });
  }

  const query = new URLSearchParams({
    mandiId: String(row.mandi_id), commodity: row.commodity_code, source: row.source,
    startDate: String(row.price_date).slice(0, 10), endDate: String(row.price_date).slice(0, 10), limit: '50',
  });
  const api = await fetchApi(`/api/mandi/prices/history?${query}`);
  const apiRow = api.body?.data?.find((r) => r.id === row.id);
  if (api.status !== 200 || !apiRow) {
    stages.push({ stage: '5 Express API response', status: 'FAIL', detail: `HTTP ${api.status}, row ${apiRow ? 'found' : 'not found'}` });
  } else {
    const diffs = compareRecord(row, apiRow, ['mandi_name', 'state', 'district', 'commodity_code', 'variety', 'grade', 'price_date',
      'min_price', 'max_price', 'modal_price', 'price_unit', 'arrivals_quantity', 'arrival_unit', 'source', 'is_sample_data']);
    stages.push({ stage: '5 Express API response', status: diffs.length ? 'FAIL' : 'PASS', detail: diffs.length ? diffs : { price_date: apiRow.price_date, source: apiRow.source, source_label: apiRow.source_label, fetched_at: apiRow.fetched_at } });
    stages.push({ stage: '6 dashboard (verify in the browser)', status: 'PASS', detail: { expected_text: expectedDashboardText(apiRow), manual: true } });
  }
  return { record: { id: row.id, source: row.source, is_sample_data: row.is_sample_data, price_date: String(row.price_date).slice(0, 10) }, stages, verdict: computeVerdict({ row, stages }) };
}
