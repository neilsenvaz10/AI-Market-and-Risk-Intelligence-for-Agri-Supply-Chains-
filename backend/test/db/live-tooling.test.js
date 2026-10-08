/**
 * Live-test tooling against real PostgreSQL (disposable test database):
 *  - lifecycle of the isolated live-test database (create -> migrated -> drop guards);
 *  - the record trace over a real stored row and the real Express API.
 * Stored rows are synthetic MOCK_PROVIDER rows, so the trace verdict must be SAMPLE_ONLY.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../helpers/db.js';
import { pool } from '../../src/db.js';
import { config } from '../../src/config/index.js';
import pg from 'pg';
import { createApp } from '../../src/app.js';
import { MandiPipeline } from '../../src/pipeline/index.js';
import { loadRow, traceRow } from '../../src/pipeline/trace.js';
import { createLiveTestDatabase, dropLiveTestDatabase, liveTestDatabaseStatus } from '../../scripts/live-test-db.js';
import { listMigrationFiles } from '../../scripts/migrate.js';

assertIsolatedDatabase();
const quiet = { log() {} };
const liveName = `fasalytics_test_live_t${process.pid}`;
let server;
let base;

before(async () => {
  const seeded = await new MandiPipeline({ pool, mandiConfig: { ...config.mandi, allowSampleData: true } })
    .runPipeline({ provider: 'MOCK', days: 2, triggeredBy: 'test' });
  assert.equal(seeded.status, 'SUCCESS', seeded.error_details);
  server = await new Promise((resolve) => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await dropLiveTestDatabase(liveName, liveName).catch(() => {});
  await pool.end();
});

test('live-test database: create applies every migration, status reports it, drop needs explicit confirmation', async () => {
  const status = await createLiveTestDatabase(liveName, { log: quiet });
  assert.deepEqual(status.pending, []);
  // Compared against the migration directory so adding a phase does not break this.
  assert.equal(status.applied.length, (await listMigrationFiles()).length);

  const info = await liveTestDatabaseStatus(liveName);
  assert.equal(info.exists, true);
  assert.equal(info.marked, true);
  assert.deepEqual(info.rows, { price_rows: '0', genuine_rows: '0' });

  await createLiveTestDatabase(liveName, { log: quiet }); // idempotent
  await assert.rejects(dropLiveTestDatabase(liveName, 'something-else'), /--confirm-drop must equal/);
  assert.equal((await liveTestDatabaseStatus(liveName)).exists, true, 'a refused drop leaves the database in place');

  assert.deepEqual(await dropLiveTestDatabase(liveName, liveName), { name: liveName, dropped: true });
  assert.equal((await liveTestDatabaseStatus(liveName)).exists, false);
  assert.deepEqual(await dropLiveTestDatabase(liveName, liveName), { name: liveName, dropped: false, reason: 'does not exist' });
});

test('live-test database: refuses to drop or reuse a database it did not create', async () => {
  const configured = process.env.DB_NAME; // the disposable harness database, which has no marker comment
  await assert.rejects(dropLiveTestDatabase(configured, configured), /not an allowed live-test database name/);
  await assert.rejects(createLiveTestDatabase('fasalytics', { log: quiet }), /not an allowed/);
  await assert.rejects(dropLiveTestDatabase('postgres', 'postgres'), /not an allowed/);
});

test('live-test database: an existing database without the marker is never reused or dropped', async () => {
  const foreign = `fasalytics_test_live_u${process.pid}`;
  const admin = new pg.Client({ host: config.database.host, port: config.database.port, user: config.database.user, password: config.database.password, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${foreign}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${foreign}"`); // no marker comment: not created by the script
    await assert.rejects(createLiveTestDatabase(foreign, { log: quiet }), /not created by this script/);
    await assert.rejects(dropLiveTestDatabase(foreign, foreign), /not created by this script/);
    assert.equal((await liveTestDatabaseStatus(foreign)).marked, false);
    const still = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [foreign]);
    assert.equal(still.rowCount, 1, 'the foreign database is untouched');
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${foreign}" WITH (FORCE)`);
    await admin.end();
  }
});

test('trace over a real stored row and the real API: stages agree, but sample data is never a genuine trace', async () => {
  assert.equal(await loadRow(pool, { source: 'MOCK_PROVIDER' }), null, 'loadRow by source ignores sample rows (it only looks for genuine ones)');

  const id = (await pool.query(`SELECT id FROM mandi_prices WHERE source = 'MOCK_PROVIDER' ORDER BY id LIMIT 1`)).rows[0].id;
  const stored = await loadRow(pool, { id });
  assert.equal(stored.is_sample_data, true);
  assert.match(String(stored.price_date), /^\d{4}-\d{2}-\d{2}$/);

  const fetchApi = async (p) => { const res = await fetch(base + p); return { status: res.status, body: await res.json() }; };
  const result = await traceRow({ row: stored, fetchApi });
  const stage = Object.fromEntries(result.stages.map((s) => [s.stage.slice(0, 1), s]));
  assert.equal(stage['1'].status, 'UNAVAILABLE', 'sample rows carry no raw source payload');
  assert.equal(stage['5'].status, 'PASS', JSON.stringify(stage['5'].detail));
  assert.equal(stage['5'].detail.source, 'MOCK_PROVIDER');
  assert.equal(result.verdict, 'SAMPLE_ONLY');
});

test('trace API stage detects a row that the API no longer returns', async () => {
  const id = (await pool.query(`SELECT id FROM mandi_prices WHERE source = 'MOCK_PROVIDER' ORDER BY id LIMIT 1`)).rows[0].id;
  const stored = await loadRow(pool, { id });
  const result = await traceRow({ row: stored, fetchApi: async () => ({ status: 200, body: { data: [] } }) });
  assert.equal(result.stages.find((s) => s.stage.startsWith('5')).status, 'FAIL');
});
