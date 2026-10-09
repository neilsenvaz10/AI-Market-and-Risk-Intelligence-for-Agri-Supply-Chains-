/**
 * Tooling for the small real-source test: name guards, preflight and the record trace.
 * No database, no network, no credentials. Records here are IN-MEMORY objects, so no
 * synthetic row is ever written under a genuine source name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLiveTestName } from '../scripts/live-test-db.js';
import { checkTcp, preflight } from '../scripts/live-preflight.js';
import { compareRecord, computeVerdict, expectedDashboardText, replay, traceRow } from '../src/pipeline/trace.js';
import { DataGovInProvider } from '../src/pipeline/providers/data-gov-in.provider.js';
import { normalizeMandiRecord } from '../src/pipeline/normalizer.js';

// ── live-test database name guard ──────────────────────────────────────────

test('live-test database names: only fasalytics_test_live_<id>, never the configured database', () => {
  assert.equal(assertLiveTestName('fasalytics_test_live_20261009', 'fasalytics'), 'fasalytics_test_live_20261009');
  for (const bad of ['fasalytics', 'postgres', 'fasalytics_test_', 'fasalytics_test_live_', 'fasalytics_test_live_UPPER',
    'fasalytics_test_live_x"; DROP DATABASE fasalytics;--', 'fasalytics_test_other', 'other_live', '', undefined, null, 42,
    `fasalytics_test_live_${'a'.repeat(30)}`]) {
    assert.throws(() => assertLiveTestName(bad, 'fasalytics'), /not an allowed live-test database name/);
  }
  assert.throws(() => assertLiveTestName('fasalytics_test_live_x', 'fasalytics_test_live_x'), /not an allowed/);
});

// ── preflight ─────────────────────────────────────────────────────────────

test('preflight reports readiness without sending API requests or printing credentials', async () => {
  const result = await preflight({
    source: 'all',
    tcp: async (host) => ({ ok: host === 'api.ceda.ashoka.edu.in', code: host === 'api.ceda.ashoka.edu.in' ? 'CONNECTED' : 'ECONNREFUSED' }),
    freeBytesFn: async () => 400 * 1024 ** 3,
  });
  const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
  assert.equal(byName['CEDA: TCP 443 to api.ceda.ashoka.edu.in'].ok, true);
  assert.equal(byName['data.gov.in: TCP 443 to api.data.gov.in'].ok, false);
  assert.equal(byName['data.gov.in: TCP 443 to api.data.gov.in'].detail, 'ECONNREFUSED');
  assert.equal(byName['scheduler is disabled'].ok, true);
  assert.equal(byName['sample-data writes are off'].ok, true);
  assert.equal(result.ready, false, 'one failing check makes the whole preflight not ready');
  assert.match(result.note, /No API request was sent/);
  // credential checks expose only set / not set
  for (const check of result.checks.filter((c) => /_API_KEY is set/.test(c.name))) {
    assert.match(check.detail, /^(set \(value not shown\)|not set)$/);
  }
});

test('preflight rejects unknown sources; a low disk fails the check', async () => {
  await assert.rejects(preflight({ source: 'scraper' }), /--source must be/);
  const result = await preflight({ source: 'ceda', tcp: async () => ({ ok: true, code: 'CONNECTED' }), freeBytesFn: async () => 1024 ** 3 });
  assert.equal(result.checks.find((c) => c.name.startsWith('free disk space')).ok, false);
});

test('checkTcp reports a refused connection instead of throwing', async () => {
  const result = await checkTcp('127.0.0.1', 1, 1500); // port 1 is closed on a normal machine
  assert.equal(result.ok, false);
  // Accept any error code string (POSIX: ECONNREFUSED/ETIMEDOUT/EACCES; Windows: WSAECONNREFUSED/ERROR/etc.)
  assert.ok(typeof result.code === 'string' && result.code.length > 0, `expected a non-empty error code, got: ${result.code}`);
});

// ── trace ───────────────────────────────────────────────────────────────

const item = {
  state: 'Maharashtra', district: 'Nashik', market: 'Lasalgaon', commodity: 'Onion', variety: 'Red', grade: 'FAQ',
  arrival_date: '15/09/2026', min_price: '1000', max_price: '1600', modal_price: '1400',
};

/** An in-memory row shaped like loadRow() output, built from a raw item through the real transform + normalizer. */
function memoryRow(rawItem = item, overrides = {}) {
  const normalised = normalizeMandiRecord(new DataGovInProvider({ apiKey: 'unused' }).transformRecord(rawItem, { priceUnit: null, fetchedAt: '2026-10-09T05:00:00Z' }));
  return { ...normalised, id: 1, mandi_id: 7, is_sample_data: false, raw_payload: rawItem, ...overrides };
}
const apiFor = (row, overrides = {}) => async () => ({
  status: 200,
  body: { data: [{ ...row, source_label: 'data.gov.in (Agmarknet daily mandi prices)', ...overrides }] },
});

test('trace: every stage passes for a consistent genuine-source record', async () => {
  const row = memoryRow();
  const result = await traceRow({ row, fetchApi: apiFor(row) });
  assert.deepEqual(result.stages.map((s) => s.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
  assert.equal(result.verdict, 'GENUINE_TRACE_PASS');
  const ui = result.stages.at(-1).detail.expected_text;
  assert.equal(ui.market, 'Lasalgaon');
  assert.equal(ui.district_state, 'Nashik, Maharashtra');
  assert.equal(ui.modal_price, '₹1,400 / quintal');
  assert.match(ui.reported, /^15 Sep(t)? 2026$/); // ICU spells the month "Sep" or "Sept" depending on version
  assert.equal(ui.source, 'data.gov.in (Agmarknet daily mandi prices)');
});

test('trace negative control: a database row that differs from its raw source fails', async () => {
  const row = memoryRow(item, { modal_price: 1450 }); // stored value no longer matches the raw item
  const result = await traceRow({ row, fetchApi: apiFor(row) });
  const stage4 = result.stages.find((s) => s.stage.startsWith('4'));
  assert.equal(stage4.status, 'FAIL');
  assert.deepEqual(stage4.detail.map((d) => d.field), ['modal_price']);
  assert.equal(result.verdict, 'FAIL');
});

test('trace negative control: an API response that differs from the database fails', async () => {
  const row = memoryRow();
  const result = await traceRow({ row, fetchApi: apiFor(row, { modal_price: 9999, price_date: '2026-09-14' }) });
  assert.equal(result.stages.find((s) => s.stage.startsWith('5')).status, 'FAIL');
  assert.equal(result.verdict, 'FAIL');
});

test('trace: an API error or a missing row fails the API stage', async () => {
  const row = memoryRow();
  assert.equal((await traceRow({ row, fetchApi: async () => ({ status: 503, body: {} }) })).verdict, 'FAIL');
  assert.equal((await traceRow({ row, fetchApi: async () => ({ status: 200, body: { data: [] } }) })).verdict, 'FAIL');
});

test('trace: a row without its raw payload is INCOMPLETE, never a pass', async () => {
  const row = memoryRow(item, { raw_payload: null });
  const result = await traceRow({ row, fetchApi: apiFor(row) });
  assert.equal(result.stages[0].status, 'UNAVAILABLE');
  assert.equal(result.verdict, 'INCOMPLETE');
});

test('trace: a record the validator would reject fails stage 3', async () => {
  const bad = { ...item, arrival_date: '31/02/2026' };
  const row = memoryRow(bad);
  const stage3 = (await traceRow({ row, fetchApi: apiFor(row) })).stages.find((s) => s.stage.startsWith('3'));
  assert.equal(stage3.status, 'FAIL');
});

test('verdicts: sample data and synthetic fixtures can never be reported as a genuine trace', async () => {
  const passing = (row) => traceRow({ row, fetchApi: apiFor(row) });
  const sample = memoryRow(item, { is_sample_data: true });
  assert.equal((await passing(sample)).verdict, 'SAMPLE_ONLY');
  const mock = memoryRow(item, { source: 'MOCK_PROVIDER', is_sample_data: true });
  assert.equal((await passing(mock)).verdict, 'SAMPLE_ONLY');
  const fixture = memoryRow({ ...item, _synthetic_test_fixture: true });
  const result = await passing(fixture);
  assert.deepEqual(result.stages.map((s) => s.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS'], 'all stages pass...');
  assert.equal(result.verdict, 'SYNTHETIC_FIXTURE', '...but the verdict is withheld');
  assert.equal(computeVerdict({ row: { source: 'TEST_SOURCE', is_sample_data: false, raw_payload: null }, stages: [] }), 'SAMPLE_ONLY');
});

test('replay supports CEDA payloads and refuses unknown sources', () => {
  const ceda = {
    source: 'CEDA', is_sample_data: false, fetched_at: '2026-10-09T05:00:00Z', quality_flags: [],
    source_state_name: 'Maharashtra', source_district_name: 'Nashik', source_commodity_name: 'Onion', source_market_name: 'Lasalgaon',
    raw_payload: {
      price: { date: '2026-09-01', commodity_id: 3, market_id: 901, min_price: 1000, max_price: 1700, modal_price: 1450 },
      quantity: { date: '2026-09-01', market_id: 901, quantity: 812.5 },
    },
  };
  const replayed = replay(ceda);
  assert.equal(replayed.status, 'OK');
  assert.equal(replayed.validation.valid, true);
  assert.equal(replayed.normalised.arrivals_quantity, 812.5);
  assert.equal(replay({ ...ceda, source: 'SOMETHING_ELSE' }).status, 'UNAVAILABLE');
});

test('compareRecord treats equal numbers/strings as equal and reports real differences', () => {
  assert.deepEqual(compareRecord({ a: 1400, b: null, c: 'x' }, { a: '1400.00', b: undefined, c: 'x' }, ['a', 'b', 'c']), []);
  assert.deepEqual(compareRecord({ a: 1 }, { a: 2 }, ['a']), [{ field: 'a', expected: 1, actual: 2 }]);
  assert.equal(expectedDashboardText({ price_date: '2026-10-08', modal_price: '1400', mandi_name: 'M', district: 'D', state: 'S', is_sample_data: true }).source,
    'Sample feed (not real market prices)');
});
