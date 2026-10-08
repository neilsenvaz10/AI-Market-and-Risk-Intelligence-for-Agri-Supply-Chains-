/**
 * Static safety scan of the Phase 3 migrations (no database needed).
 * Guards the promise that 004/005 never destroy data and never touch Phase 2
 * (farmer / authentication) tables. A failing assertion here means the migration
 * needs a human review before it may be applied to any database that holds data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
const PHASE3 = ['004_mandi_data_pipeline.sql', '005_mandi_pipeline_integrity.sql'];
const PHASE2_TABLES = ['farmers', 'farmer_identities', 'schema_migrations'];

// Comments and string literals are removed so only executable SQL is scanned.
const strip = (sql) => sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");
const statements = (sql) => strip(sql).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

for (const file of PHASE3) {
  test(`${file}: no destructive statements`, async () => {
    const sql = strip(await fs.readFile(path.join(dir, file), 'utf8'));
    for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bDROP\s+COLUMN\b/i,
      /\bDROP\s+SCHEMA\b/i, /\bDROP\s+DATABASE\b/i, /\bDROP\s+INDEX\b/i, /\bCASCADE\b/i]) {
      assert.ok(!forbidden.test(sql), `${file} must not contain ${forbidden}`);
    }
  });

  test(`${file}: never touches Phase 2 tables`, async () => {
    const sql = strip(await fs.readFile(path.join(dir, file), 'utf8'));
    for (const table of PHASE2_TABLES) {
      assert.ok(!new RegExp(`\\b${table}\\b`, 'i').test(sql), `${file} must not reference ${table}`);
    }
  });

  test(`${file}: data-modifying statements are limited to Phase 3 tables`, async () => {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    for (const statement of statements(sql)) {
      const write = statement.match(/^(?:INSERT\s+INTO|UPDATE)\s+("?[\w.]+"?)/i);
      if (write) {
        assert.match(write[1], /^(mandi_prices|mandi_sources|mandis|commodities|mandi_source_sync_state)$/i,
          `unexpected write target: ${statement.slice(0, 80)}`);
      }
    }
  });
}

test('005: only a derived view, replaced constraints and NOT NULL/DEFAULT relaxations are dropped', async () => {
  const sql = strip(await fs.readFile(path.join(dir, PHASE3[1]), 'utf8'));
  const kinds = [...sql.matchAll(/\bDROP\s+(\w+)/gi)].map((m) => m[1].toLowerCase());
  assert.ok(kinds.length > 0);
  assert.deepEqual([...new Set(kinds)].sort(), ['constraint', 'default', 'not', 'view']);
  const named = [...sql.matchAll(/\bDROP\s+(?:VIEW|CONSTRAINT)(?:\s+IF\s+EXISTS)?\s+("?[\w%]+"?)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(named)].sort(), ['mandi_prices_resolved', 'uq_mandi_commodity_date_variety_source']);

  // Dynamic SQL hides inside string literals, so check it on the raw text: the only
  // EXECUTE drops the old mandi_prices foreign keys, which are re-created as RESTRICT.
  const raw = await fs.readFile(path.join(dir, PHASE3[1]), 'utf8');
  const executes = [...raw.matchAll(/EXECUTE\s+([^;]+);/gi)].map((m) => m[1].replace(/\s+/g, ' '));
  assert.equal(executes.length, 1);
  assert.match(executes[0], /^format\('ALTER TABLE mandi_prices DROP CONSTRAINT %I', fk\.conname\)$/);
  assert.match(raw, /conrelid = 'mandi_prices'::regclass AND c\.contype = 'f'/);
  assert.match(raw, /FOREIGN KEY \(mandi_id\) REFERENCES mandis\(id\) ON DELETE RESTRICT/);
  assert.match(raw, /FOREIGN KEY \(commodity_id\) REFERENCES commodities\(id\) ON DELETE RESTRICT/);
});

test('005: column type changes only widen', async () => {
  const sql = strip(await fs.readFile(path.join(dir, PHASE3[1]), 'utf8'));
  const varchars = { variety: [64, 200], grade: [32, 100] };
  for (const [column, [before, after]] of Object.entries(varchars)) {
    const match = sql.match(new RegExp(`ALTER COLUMN ${column} TYPE VARCHAR\\((\\d+)\\)`, 'i'));
    assert.ok(match && Number(match[1]) >= after && after > before, `${column} must widen from ${before}`);
  }
  const numerics = { min_price: [10, 2], max_price: [10, 2], modal_price: [10, 2], arrivals_quantity: [12, 2] };
  for (const [column, [precision, scale]] of Object.entries(numerics)) {
    const match = sql.match(new RegExp(`ALTER COLUMN ${column} TYPE NUMERIC\\((\\d+),\\s*(\\d+)\\)`, 'i'));
    assert.ok(match && Number(match[1]) >= precision && Number(match[2]) >= scale, `${column} numeric type must not narrow`);
  }
});

test('migration directory: Phase 3 files come after Phase 2 files and numbers are unique', async () => {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files, ['002_phase2_farmers.sql', '003_phase2_email_identity.sql', ...PHASE3]);
});
