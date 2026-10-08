/**
 * Pipeline integration tests (isolated database). Persisted data is synthetic
 * MOCK_PROVIDER data flagged as sample. Genuine-source code paths are exercised
 * with a fake HTTP client and an in-memory persister so no synthetic row is ever
 * stored under a genuine source name.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../helpers/db.js';
import { pool } from '../../src/db.js';
import { config } from '../../src/config/index.js';
import { MandiPipeline } from '../../src/pipeline/index.js';
import { DataGovInProvider } from '../../src/pipeline/providers/data-gov-in.provider.js';
import { MockMandiProvider } from '../../src/pipeline/providers/mock.provider.js';

assertIsolatedDatabase();
const sampleConfig = { ...config.mandi, allowSampleData: true };

async function clean() {
  await pool.query(`DELETE FROM mandi_price_conflicts WHERE source_a = 'MOCK_PROVIDER' OR source_b = 'MOCK_PROVIDER'`);
  await pool.query(`DELETE FROM mandi_price_revisions WHERE price_id IN (SELECT id FROM mandi_prices WHERE source = 'MOCK_PROVIDER')`);
  await pool.query(`DELETE FROM mandi_prices WHERE source = 'MOCK_PROVIDER'`);
}
before(clean);
after(async () => {
  await clean();
  await pool.end();
});

test('MOCK run is stored as sample data, logged, and idempotent on re-run', async () => {
  const pipeline = new MandiPipeline({ pool, mandiConfig: sampleConfig });
  const first = await pipeline.runPipeline({ provider: 'MOCK', days: 2, triggeredBy: 'test' });
  assert.equal(first.status, 'SUCCESS', first.error_details);
  assert.ok(first.records_inserted > 0);
  assert.equal(first.records_inserted, first.records_valid - first.duplicates_removed);
  const counted = (await pool.query(`SELECT COUNT(*)::int AS n, bool_and(is_sample_data) AS all_sample FROM mandi_prices WHERE source = 'MOCK_PROVIDER'`)).rows[0];
  assert.equal(counted.n, first.records_inserted, 'reported inserts equal committed rows');
  assert.equal(counted.all_sample, true);

  const second = await pipeline.runPipeline({ provider: 'MOCK', days: 2, triggeredBy: 'test' });
  assert.equal(second.records_inserted, 0);
  assert.equal(second.records_unchanged, first.records_inserted);

  const log = (await pool.query(`SELECT status, records_inserted, is_sample_data, triggered_by FROM pipeline_sync_logs WHERE id = $1`, [first.run_id])).rows[0];
  assert.deepEqual(log, { status: 'SUCCESS', records_inserted: first.records_inserted, is_sample_data: true, triggered_by: 'test' });
  const state = (await pool.query(`SELECT last_status, latest_reporting_date FROM mandi_source_sync_state WHERE source = 'MOCK_PROVIDER'`)).rows[0];
  assert.equal(state.last_status, 'SUCCESS');
});

test('MOCK run is refused when sample writes are not allowed (default)', async () => {
  const pipeline = new MandiPipeline({ pool, mandiConfig: { ...config.mandi, allowSampleData: false } });
  const result = await pipeline.runPipeline({ provider: 'MOCK', days: 1 });
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.error_code, 'SAMPLE_DATA_WRITE_REFUSED');
});

test('no provider configured -> explicit failure, never a silent MOCK fallback', async () => {
  const result = await new MandiPipeline({ pool, mandiConfig: { ...sampleConfig, provider: null } }).runPipeline({});
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error_code, 'NO_PROVIDER');
});

test('data.gov.in without an API key fails visibly and is recorded per source', async () => {
  const pipeline = new MandiPipeline({ pool, mandiConfig: { ...sampleConfig, dataGovApiKey: '' } });
  const result = await pipeline.runPipeline({ provider: 'DATA_GOV_IN', days: 2, triggeredBy: 'test' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error_code, 'SOURCE_NOT_CONFIGURED');
  assert.equal(result.records_inserted, 0);
  const state = (await pool.query(`SELECT last_status, last_success_at FROM mandi_source_sync_state WHERE source = 'DATA_GOV_IN'`)).rows[0];
  assert.equal(state.last_status, 'FAILED');
  assert.equal(state.last_success_at, null);
});

test('concurrent runs: the second one is skipped by the advisory lock', async () => {
  let release;
  const slowProvider = Object.assign(new MockMandiProvider(), {
    fetchRecords: () => new Promise((resolve) => { release = () => resolve([]); }),
  });
  const pipeline = new MandiPipeline({ pool, mandiConfig: sampleConfig, providers: { MOCK: slowProvider } });
  const first = pipeline.runPipeline({ provider: 'MOCK', days: 1 });
  while (!release) await new Promise((r) => setTimeout(r, 10));
  const second = await pipeline.runPipeline({ provider: 'MOCK', days: 1 });
  release();
  assert.equal(second.status, 'SKIPPED');
  assert.equal(second.error_code, 'ANOTHER_RUN_IN_PROGRESS');
  assert.equal((await first).status, 'NO_DATA');
});

test('data.gov.in path (fake HTTP, in-memory persister): rejects bad rows with reasons, keeps the rest', async () => {
  const item = { state: 'Maharashtra', district: 'Nashik', market: 'Lasalgaon', commodity: 'Onion', variety: 'Red', grade: 'FAQ',
    arrival_date: '15/09/2026', min_price: '1000', max_price: '1600', modal_price: '1400' };
  const pages = [item, { ...item, arrival_date: '31/02/2026' }, { ...item, state: '' }, { ...item, variety: 'White', modal_price: '' }];
  const http = { requestJson: async () => ({ status: 200, data: { total: pages.length, records: pages } }) };
  const persisted = [];
  const fakePersister = { persistBatch: async (records) => { persisted.push(...records); return { inserted: records.length, updated: 0, unchanged: 0, failed: 0, conflicts: 0, errors: [] }; } };
  const pipeline = new MandiPipeline({
    pool,
    mandiConfig: sampleConfig,
    providers: { DATA_GOV_IN: new DataGovInProvider({ apiKey: 'fake', http }) },
    persister: fakePersister,
  });
  const result = await pipeline.runPipeline({ provider: 'DATA_GOV_IN', fromDate: '2026-09-15', toDate: '2026-09-15', triggeredBy: 'test:synthetic-http' });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.records_fetched, 4);
  assert.equal(result.records_valid, 1);
  assert.deepEqual(result.rejection_summary, { INVALID_DATE: 1, MISSING_STATE: 1, MISSING_MODAL_PRICE: 1 });
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].source, 'DATA_GOV_IN');
  assert.equal(persisted[0].price_date, '2026-09-15');
  assert.equal(persisted[0].arrivals_quantity, null);
});
