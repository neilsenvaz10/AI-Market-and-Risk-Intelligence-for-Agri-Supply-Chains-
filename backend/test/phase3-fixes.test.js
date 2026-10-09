/** Regression tests for the Phase 3 QA defects (status truth, truncation, exit codes, timeouts, aliases). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MandiPipeline } from '../src/pipeline/index.js';
import { DataGovInProvider } from '../src/pipeline/providers/data-gov-in.provider.js';
import { createSourceHttpClient } from '../src/pipeline/http.js';
import { exportExitCode } from '../src/pipeline/historical/ceda-export.js';
import { nameKey, normalizeCommodity } from '../src/pipeline/normalizer.js';

const quiet = { log() {}, error() {}, warn() {} };
const client = {
  query: async (sql) => (/pg_try_advisory_lock/.test(sql) ? { rows: [{ locked: true }] }
    : /INSERT INTO pipeline_sync_logs/.test(sql) ? { rows: [{ id: 1 }] } : { rows: [], rowCount: 0 }),
  release() {},
};
const pool = { connect: async () => client, query: async () => ({ rows: [] }) };
const cfg = { provider: 'DATA_GOV_IN', allowSampleData: false, syncLookbackDays: 3, http: {}, dataGovApiKey: 'k', cedaApiKey: '', historical: { windowDays: 92 } };
const okPersist = { persistBatch: async (r) => ({ inserted: r.length, updated: 0, unchanged: 0, failed: 0, conflicts: 0, errors: [] }) };
const item = (market, date) => ({ state: 'Maharashtra', district: 'Nashik', market, commodity: 'Onion', variety: 'Red', grade: 'FAQ', arrival_date: date, min_price: '1000', max_price: '1600', modal_price: '1400' });

function fakeHttp(pages, calls = []) {
  return {
    async requestJson(url) {
      const p = new URL(url).searchParams;
      const day = p.get('filters[arrival_date]');
      calls.push(day);
      const all = pages[day] || [];
      const o = Number(p.get('offset'));
      return { status: 200, data: { total: all.length, records: all.slice(o, o + Number(p.get('limit'))), field: [] } };
    },
  };
}
const pipelineFor = (pages, calls) => new MandiPipeline({
  pool, mandiConfig: cfg, log: quiet, persister: okPersist,
  providers: { DATA_GOV_IN: new DataGovInProvider({ apiKey: 'k', http: fakeHttp(pages, calls) }) },
});

test('A1: a run where every record is rejected is FAILED, not SUCCESS', async () => {
  const bad = { ...item('M', '15/09/2026'), modal_price: '' };
  const r = await pipelineFor({ '15/09/2026': [bad, bad] }).runPipeline({ provider: 'DATA_GOV_IN', fromDate: '2026-09-15', toDate: '2026-09-15' });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.error_code, 'ALL_RECORDS_REJECTED');
  assert.equal(r.records_fetched, 2);
  assert.equal(r.records_persisted, 0);
});

test('A1: a genuinely empty source result stays NO_DATA', async () => {
  const r = await pipelineFor({}).runPipeline({ provider: 'DATA_GOV_IN', fromDate: '2026-09-15', toDate: '2026-09-15' });
  assert.equal(r.status, 'NO_DATA');
});

test('A2: maxRecords keeps the NEWEST day and the run reports truncation', async () => {
  const pages = {
    '14/09/2026': [item('A', '14/09/2026'), item('B', '14/09/2026')],
    '15/09/2026': [item('A', '15/09/2026'), item('B', '15/09/2026')],
    '16/09/2026': [item('A', '16/09/2026'), item('B', '16/09/2026')],
  };
  const calls = [];
  const r = await pipelineFor(pages, calls).runPipeline({ provider: 'DATA_GOV_IN', fromDate: '2026-09-14', toDate: '2026-09-16', maxRecords: 3 });
  assert.equal(r.latest_reporting_date, '2026-09-16');
  assert.equal(calls[0], '16/09/2026', 'newest day is requested first');
  assert.equal(r.status, 'PARTIAL_SUCCESS');
  assert.equal(r.error_code, 'RESULT_TRUNCATED');
  assert.equal(r.truncated, true);
  assert.ok(r.truncation.days_skipped.includes('2026-09-14') || r.truncation.days_partial.length > 0);
});

test('A2: no truncation flag when the limit is not reached', async () => {
  const r = await pipelineFor({ '15/09/2026': [item('A', '15/09/2026')] })
    .runPipeline({ provider: 'DATA_GOV_IN', fromDate: '2026-09-15', toDate: '2026-09-15', maxRecords: 100 });
  assert.equal(r.status, 'SUCCESS');
  assert.equal(r.truncated, false);
});

test('A3: export exit codes (all failed=1, stopped=2, partial=3, clean=0)', () => {
  assert.equal(exportExitCode({ tasksFailed: 3, tasksCompleted: 0, tasksSkipped: 0, stoppedReason: null }), 1);
  assert.equal(exportExitCode({ tasksFailed: 1, tasksCompleted: 2, tasksSkipped: 0, stoppedReason: null }), 3);
  assert.equal(exportExitCode({ tasksFailed: 0, tasksCompleted: 1, tasksSkipped: 0, stoppedReason: 'low disk' }), 2);
  assert.equal(exportExitCode({ tasksFailed: 0, tasksCompleted: 3, tasksSkipped: 0, stoppedReason: null }), 0);
});

const stall = async () => ({ ok: true, status: 200, headers: new Headers(), text: () => new Promise(() => {}) });

test('A4: a stalled response body ends with a TIMEOUT error instead of hanging', async () => {
  const http = createSourceHttpClient({ timeoutMs: 100, retries: 0, requestIntervalMs: 0, fetchImpl: stall, log: quiet });
  await assert.rejects(http.requestJson('https://example.invalid/x'), { code: 'TIMEOUT' });
});

test('A4: the caller abort signal also ends a stalled body', async () => {
  const http = createSourceHttpClient({ timeoutMs: 5000, retries: 0, requestIntervalMs: 0, fetchImpl: stall, log: quiet });
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new Error('job timeout')), 50);
  await assert.rejects(http.requestJson('https://example.invalid/x', { signal: ctrl.signal }), { code: 'ABORTED' });
});

test('A5: Hindi, Marathi and English commodity names resolve to the same code', () => {
  assert.equal(normalizeCommodity('प्याज').code, 'ONION'); // Hindi onion
  assert.equal(normalizeCommodity('कांदा').code, 'ONION'); // Marathi onion
  assert.equal(normalizeCommodity('गेहूं').code, 'WHEAT'); // Hindi wheat
  assert.equal(normalizeCommodity('गहू').code, 'WHEAT'); // Marathi wheat
  assert.equal(normalizeCommodity('ONION ').code, 'ONION');
  assert.equal(normalizeCommodity('Sweet Potato').code, 'SWEET_POTATO');
  assert.notEqual(nameKey('गेहूं'), nameKey('गहू'));
});
