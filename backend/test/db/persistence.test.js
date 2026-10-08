/**
 * Persistence integrity tests (isolated database; synthetic records only,
 * all flagged is_sample_data / test sources).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase, sampleRecord } from '../helpers/db.js';
import { pool } from '../../src/db.js';
import { MandiPersister, SampleDataWriteError } from '../../src/pipeline/persister.js';
import { deduplicateWithinSource } from '../../src/pipeline/deduplicator.js';

assertIsolatedDatabase();
const persister = new MandiPersister({ pool, allowSampleData: true });
const SOURCES = ['MOCK_PROVIDER', 'TEST_SOURCE_A', 'TEST_SOURCE_B'];

async function clean() {
  await pool.query(`DELETE FROM mandi_price_conflicts WHERE source_a = ANY($1) OR source_b = ANY($1)`, [SOURCES]);
  await pool.query(`DELETE FROM mandi_price_revisions WHERE price_id IN (SELECT id FROM mandi_prices WHERE source = ANY($1))`, [SOURCES]);
  await pool.query(`DELETE FROM mandi_prices WHERE source = ANY($1)`, [SOURCES]);
}
const committed = async (where = '', values = []) =>
  (await pool.query(`SELECT COUNT(*)::int AS n FROM mandi_prices WHERE source = ANY($1) ${where}`, [SOURCES, ...values])).rows[0].n;

before(clean);
after(async () => {
  await clean();
  await pool.end();
});

test('S1 regression: one bad row no longer undoes the others, and counts match committed rows', async () => {
  await clean();
  const good1 = sampleRecord({ variety: 'A' });
  const bad = sampleRecord({ variety: 'B', min_price: 5000 }); // violates min <= max CHECK in PostgreSQL
  const good2 = sampleRecord({ variety: 'C' });
  const result = await persister.persistBatch([good1, bad, good2], { runId: 9001 });
  assert.equal(result.inserted, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(await committed(), 2, 'exactly the reported inserts are committed');
  assert.equal(await committed('AND ingestion_run_id = $2', [9001]), 2);
});

test('re-import is idempotent: identical values are counted as unchanged', async () => {
  await clean();
  const records = [sampleRecord({ variety: 'A' }), sampleRecord({ variety: 'B' })];
  const first = await persister.persistBatch(records, { runId: 9002 });
  const second = await persister.persistBatch(records, { runId: 9003 });
  assert.deepEqual([first.inserted, first.updated, first.unchanged], [2, 0, 0]);
  assert.deepEqual([second.inserted, second.updated, second.unchanged], [0, 0, 2]);
  assert.equal(await committed(), 2);
});

test('missing values are stored as NULL, not 0 or defaults', async () => {
  await clean();
  await persister.persistBatch([sampleRecord({ variety: null, grade: null, min_price: null, max_price: null, arrivals_quantity: null, arrival_unit: null })]);
  const row = (await pool.query(`SELECT variety, grade, min_price, max_price, arrivals_quantity FROM mandi_prices WHERE source = 'MOCK_PROVIDER'`)).rows[0];
  assert.deepEqual(row, { variety: null, grade: null, min_price: null, max_price: null, arrivals_quantity: null });
  // NULL variety/grade still dedupe (NULLS NOT DISTINCT)
  const again = await persister.persistBatch([sampleRecord({ variety: null, grade: null, min_price: null, max_price: null, arrivals_quantity: null, arrival_unit: null })]);
  assert.equal(again.unchanged, 1);
});

test('a changed value from the same source keeps an audit trail', async () => {
  await clean();
  await persister.persistBatch([sampleRecord({ modal_price: 1200 })]);
  const revised = await persister.persistBatch([sampleRecord({ modal_price: 1300 })], { runId: 9004 });
  assert.equal(revised.updated, 1);
  const revision = (await pool.query(
    `SELECT r.previous_values, r.new_values FROM mandi_price_revisions r JOIN mandi_prices p ON p.id = r.price_id WHERE p.source = 'MOCK_PROVIDER'`)).rows;
  assert.equal(revision.length, 1);
  assert.equal(revision[0].previous_values.modal_price, 1200);
  assert.equal(revision[0].new_values.modal_price, 1300);
});

test('sample data is refused unless explicitly allowed', async () => {
  await clean();
  const strict = new MandiPersister({ pool, allowSampleData: false });
  await assert.rejects(strict.persistBatch([sampleRecord()]), SampleDataWriteError);
  assert.equal(await committed(), 0);
});

test('same-source conflicts are stored once for review (idempotent)', async () => {
  await clean();
  const { uniqueRecords, conflicts } = deduplicateWithinSource([sampleRecord({ modal_price: 1200 }), sampleRecord({ modal_price: 1250 })]);
  const first = await persister.persistBatch(uniqueRecords, { batchConflicts: conflicts });
  const second = await persister.persistBatch(uniqueRecords, { batchConflicts: conflicts });
  assert.equal(first.conflicts, 1);
  assert.equal(second.conflicts, 0);
  const stored = (await pool.query(`SELECT conflict_type, details FROM mandi_price_conflicts WHERE source_a = 'MOCK_PROVIDER'`)).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].conflict_type, 'SAME_SOURCE_CONFLICT');
  assert.equal(stored[0].details.versions.length, 2, 'both versions preserved');
});

test('cross-source: both rows kept, conflict recorded, resolved view never double-counts', async () => {
  await clean();
  const a = sampleRecord({ source: 'TEST_SOURCE_A', variety: null, grade: null, modal_price: 1200 });
  const mock = sampleRecord({ source: 'MOCK_PROVIDER', modal_price: 1500, max_price: 1600 });
  await persister.persistBatch([a]);
  const result = await persister.persistBatch([mock]);
  assert.equal(result.conflicts, 1);
  assert.equal(await committed(), 2, 'provenance: one row per source');
  const conflict = (await pool.query(`SELECT source_a, source_b, modal_price_a, modal_price_b FROM mandi_price_conflicts WHERE conflict_type = 'CROSS_SOURCE_CONFLICT' AND (source_a = ANY($1))`, [SOURCES])).rows;
  assert.deepEqual(conflict.map((c) => [c.source_a, c.source_b]), [['MOCK_PROVIDER', 'TEST_SOURCE_A']]);
  const resolved = (await pool.query(
    `SELECT source FROM mandi_prices_resolved r JOIN mandis m ON m.id = r.mandi_id WHERE m.code = $1 AND r.price_date = '2026-09-01'`,
    [a.mandi_code])).rows;
  assert.deepEqual(resolved.map((r) => r.source), ['TEST_SOURCE_A'], 'higher-precedence source only; MOCK (precedence 0) is not added');
});

test('agreeing cross-source reports create no conflict', async () => {
  await clean();
  await persister.persistBatch([sampleRecord({ source: 'TEST_SOURCE_A', variety: null, grade: null })]);
  const result = await persister.persistBatch([sampleRecord({ source: 'TEST_SOURCE_B', variety: null, grade: null })]);
  assert.equal(result.conflicts, 0);
});
