/**
 * Migration chain tests. Each scenario runs in its own scratch database
 * (<disposable test db>_<suffix>) which is dropped afterwards.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsolatedDatabase, createScratchDatabase } from '../helpers/db.js';
import { getMigrationStatus, listMigrationFiles, runMigrations } from '../../scripts/migrate.js';

assertIsolatedDatabase();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const quiet = { log: { log() {} } };
const scratch = [];
after(async () => {
  for (const db of scratch) await db.drop();
});

async function withScratch(suffix, fn) {
  const db = await createScratchDatabase(suffix);
  scratch.push(db);
  const client = await db.client();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const tables = async (client) => (await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map((r) => r.table_name);

async function assertPhase3Schema(client) {
  const names = await tables(client);
  for (const t of ['farmers', 'mandis', 'commodities', 'mandi_prices', 'pipeline_sync_logs', 'mandi_sources',
    'mandi_price_revisions', 'mandi_price_conflicts', 'mandi_source_sync_state', 'schema_migrations']) {
    assert.ok(names.includes(t), `table ${t} exists`);
  }
  const fk = await client.query(
    `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'mandi_prices'::regclass AND contype = 'f' ORDER BY conname`);
  assert.deepEqual(fk.rows.map((r) => [r.conname, r.confdeltype]),
    [['mandi_prices_commodity_fk', 'r'], ['mandi_prices_mandi_fk', 'r']], 'price history uses ON DELETE RESTRICT only');
  const unique = await client.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'uq_mandi_prices_observation'`);
  assert.match(unique.rows[0].def, /UNIQUE NULLS NOT DISTINCT \(source, mandi_id, commodity_id, price_date, variety, grade\)/);
  const nullable = await client.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
     WHERE table_name = 'mandi_prices' AND column_name IN ('min_price','max_price','arrivals_quantity','variety','grade')`);
  for (const col of nullable.rows) {
    assert.equal(col.is_nullable, 'YES', `${col.column_name} nullable`);
    assert.equal(col.column_default, null, `${col.column_name} has no invented default`);
  }
  const indexes = (await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'mandi_prices'`)).rows.map((r) => r.indexname);
  for (const index of ['idx_mandi_prices_market_day', 'idx_mandi_prices_source_date', 'idx_mandi_prices_lookup']) {
    assert.ok(indexes.includes(index), `index ${index}`);
  }
  assert.equal((await client.query(`SELECT to_regclass('public.mandi_prices_resolved') AS v`)).rows[0].v, 'mandi_prices_resolved');
}

test('migration files have unique numbers and Phase 2 runs before Phase 3', async () => {
  const files = await listMigrationFiles();
  assert.deepEqual(files, ['002_phase2_farmers.sql', '003_phase2_email_identity.sql', '004_mandi_data_pipeline.sql', '005_mandi_pipeline_integrity.sql']);
});

test('fresh database: full chain applies from zero, and a re-run applies nothing', async () => {
  await withScratch('fresh', async (client) => {
    const first = await runMigrations(client, quiet);
    assert.equal(first.applied.length, 4);
    await assertPhase3Schema(client);
    const emailColumn = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'farmers' AND column_name = 'welcome_email_status'`);
    assert.equal(emailColumn.rowCount, 1, 'Phase 2 email migration is no longer blocked');
    const second = await runMigrations(client, quiet);
    assert.deepEqual(second.applied, []);
    assert.deepEqual((await getMigrationStatus(client)).pending, []);
  });
});

test('Phase 2 database upgrades to Phase 3 without touching farmer data', async () => {
  await withScratch('phase2', async (client) => {
    const phase2Dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-mig-'));
    try {
      for (const file of ['002_phase2_farmers.sql', '003_phase2_email_identity.sql']) {
        await fs.copyFile(path.join(root, 'database/migrations', file), path.join(phase2Dir, file));
      }
      await runMigrations(client, { ...quiet, migrationsDir: phase2Dir });
    } finally {
      await fs.rm(phase2Dir, { recursive: true, force: true });
    }
    await client.query(
      `INSERT INTO farmers (firebase_uid, full_name, phone_number, state, district, primary_crop, crop_quantity)
       VALUES ('test-uid-1', 'Test Farmer', '+919800000001', 'Maharashtra', 'Nashik', 'Onion', 10)`);
    const before = (await client.query(`SELECT md5(string_agg(f::text, ',' ORDER BY id)) AS h FROM farmers f`)).rows[0].h;

    const result = await runMigrations(client, quiet);
    assert.deepEqual(result.applied, ['004_mandi_data_pipeline.sql', '005_mandi_pipeline_integrity.sql']);
    await assertPhase3Schema(client);
    const afterHash = (await client.query(`SELECT md5(string_agg(f::text, ',' ORDER BY id)) AS h FROM farmers f`)).rows[0].h;
    assert.equal(afterHash, before, 'farmer rows are byte-for-byte unchanged');
  });
});

test('legacy Phase 3 database (schema.sql / old 003 tables with CASCADE and defaults) is repaired in place', async () => {
  await withScratch('legacy', async (client) => {
    const schema = (await fs.readFile(path.join(root, 'database/schema.sql'), 'utf8')).replace(/^﻿/, '');
    await client.query(schema);
    await client.query(`CREATE TABLE schema_migrations (filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query(`INSERT INTO schema_migrations (filename) VALUES ('003_mandi_data_pipeline.sql')`);
    await client.query(`INSERT INTO mandis (code, name, state, district) VALUES ('LEGACY', 'Legacy Market', 'S', 'D')`);
    await client.query(`INSERT INTO commodities (code, name) VALUES ('ONION', 'Onion')`);
    await client.query(
      `INSERT INTO mandi_prices (mandi_id, commodity_id, price_date, min_price, max_price, modal_price, source, is_sample_data)
       VALUES (1, 1, '2026-09-01', 100, 200, 150, 'MOCK_PROVIDER', TRUE)`);

    const result = await runMigrations(client, quiet);
    assert.deepEqual(result.applied, ['002_phase2_farmers.sql', '003_phase2_email_identity.sql', '004_mandi_data_pipeline.sql', '005_mandi_pipeline_integrity.sql']);
    await assertPhase3Schema(client);
    const row = (await client.query(`SELECT variety, grade, price_unit, arrivals_quantity, quality_flags FROM mandi_prices`)).rows[0];
    assert.deepEqual(row, { variety: 'Standard', grade: 'FAQ', price_unit: 'INR/quintal', arrivals_quantity: '0.000', quality_flags: ['LEGACY_ARRIVAL_UNIT_UNKNOWN'] },
      'legacy values are kept, units made explicit, unknown arrival unit flagged');
  });
});

test('foreign keys protect price history (RESTRICT, no cascade delete)', async () => {
  await withScratch('fk', async (client) => {
    await runMigrations(client, quiet);
    await client.query(`INSERT INTO mandis (code, name, state, district) VALUES ('M1', 'Market', 'S', 'D')`);
    await client.query(`INSERT INTO commodities (code, name) VALUES ('ONION', 'Onion')`);
    await client.query(
      `INSERT INTO mandi_prices (mandi_id, commodity_id, price_date, modal_price, price_unit, source, is_sample_data)
       VALUES (1, 1, '2026-09-01', 150, 'INR/quintal', 'MOCK_PROVIDER', TRUE)`);
    // 23001 = restrict_violation (ON DELETE RESTRICT)
    await assert.rejects(client.query('DELETE FROM mandis WHERE id = 1'), { code: '23001' });
    await assert.rejects(client.query('DELETE FROM commodities WHERE id = 1'), { code: '23001' });
    await assert.rejects(client.query(
      `INSERT INTO mandi_prices (mandi_id, commodity_id, price_date, modal_price, source, is_sample_data)
       VALUES (1, 1, '2026-09-02', 150, 'CEDA', TRUE)`), { code: '23514' }, 'sample rows cannot carry a genuine source');
    await assert.rejects(client.query(
      `INSERT INTO mandi_prices (mandi_id, commodity_id, price_date, modal_price, source, is_sample_data)
       VALUES (1, 1, '2026-09-03', 150, 'MOCK_PROVIDER', FALSE)`), { code: '23514' }, 'MOCK rows must be flagged as sample');
  });
});

test('a failing migration rolls back completely and is not recorded', async () => {
  await withScratch('rollback', async (client) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-mig-'));
    try {
      await fs.writeFile(path.join(dir, '001_ok.sql'), 'CREATE TABLE ok_table (id int);');
      await fs.writeFile(path.join(dir, '002_broken.sql'), 'CREATE TABLE half_done (id int); SELECT * FROM missing_table;');
      await assert.rejects(runMigrations(client, { ...quiet, migrationsDir: dir }), /002_broken\.sql failed and was rolled back/);
      const names = await tables(client);
      assert.ok(names.includes('ok_table'));
      assert.ok(!names.includes('half_done'), 'partial objects from the failed file are rolled back');
      const recorded = (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename);
      assert.deepEqual(recorded, ['001_ok.sql']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

test('duplicate migration numbers are refused before anything runs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-mig-'));
  try {
    await fs.writeFile(path.join(dir, '003_a.sql'), 'SELECT 1;');
    await fs.writeFile(path.join(dir, '003_b.sql'), 'SELECT 1;');
    await assert.rejects(listMigrationFiles(dir), /Duplicate migration number/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('two migration runners cannot run at the same time', async () => {
  await withScratch('lock', async (client) => {
    const db = scratch.at(-1);
    const other = await db.client();
    try {
      await other.query('SELECT pg_advisory_lock(7301003)');
      await assert.rejects(runMigrations(client, quiet), /migration lock/);
    } finally {
      await other.end();
    }
  });
});
