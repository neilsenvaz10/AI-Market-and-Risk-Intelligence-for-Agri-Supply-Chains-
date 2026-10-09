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
const PHASE3 = ['004_mandi_data_pipeline.sql', '005_mandi_pipeline_integrity.sql', '006_agmarknet_commodity_reports.sql'];
const PHASE4 = ['007_phase4_forecasting.sql'];
const PHASE5 = ['008_phase5_canonical_mandi.sql'];
const PHASE8 = ['009_phase8_smart_farmer.sql'];
const PHASE2_TABLES = ['farmers', 'farmer_identities', 'schema_migrations'];

// Comments and string literals are removed so only executable SQL is scanned.
const strip = (sql) => sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");
const statements = (sql) => strip(sql).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

for (const file of [...PHASE3, ...PHASE4, ...PHASE5, ...PHASE8]) {
  test(`${file}: no destructive statements`, async () => {
    const sql = strip(await fs.readFile(path.join(dir, file), 'utf8'));
    const forbiddenPatterns = [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bDROP\s+COLUMN\b/i,
      /\bDROP\s+SCHEMA\b/i, /\bDROP\s+DATABASE\b/i, /\bDROP\s+INDEX\b/i];
    // Phase 3 must not cascade-protect away price history. Phase 4 and 8 legitimately use
    // ON DELETE CASCADE for their own derived rows (checked separately).
    if (PHASE3.includes(file)) forbiddenPatterns.push(/\bCASCADE\b/i);
    for (const forbidden of forbiddenPatterns) {
      assert.ok(!forbidden.test(sql), `${file} must not contain ${forbidden}`);
    }
  });

  if (!PHASE8.includes(file)) {
    test(`${file}: never touches Phase 2 tables`, async () => {
      const sql = strip(await fs.readFile(path.join(dir, file), 'utf8'));
      for (const table of PHASE2_TABLES) {
        assert.ok(!new RegExp(`\\b${table}\\b`, 'i').test(sql), `${file} must not reference ${table}`);
      }
    });
  }
}

test('Phase 8 migration: additive tables and foreign keys protect parent market rows', async () => {
  const sql = strip(await fs.readFile(path.join(dir, PHASE8[0]), 'utf8'));
  const creates = [...sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(creates.sort(), [
    'farmer_alert_evaluations',
    'farmer_favorite_commodities',
    'farmer_favorite_mandis',
    'farmer_notifications',
    'farmer_preferences',
    'farmer_price_alerts',
  ]);
  // Mandi prices, commodities and mandis must never be deleted on cascade from alerts
  assert.ok(/REFERENCES\s+commodities\(id\)\s+ON\s+DELETE\s+RESTRICT/i.test(sql));
  assert.ok(/REFERENCES\s+mandis\(id\)\s+ON\s+DELETE\s+RESTRICT/i.test(sql));
  assert.ok(/REFERENCES\s+mandi_prices\(id\)\s+ON\s+DELETE\s+RESTRICT/i.test(sql));
});

test('Phase 3 migrations: data-modifying statements are limited to Phase 3 tables', async () => {
  for (const file of PHASE3) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    for (const statement of statements(sql)) {
      const write = statement.match(/^(?:INSERT\s+INTO|UPDATE)\s+("?[\w.]+"?)/i);
      if (write) {
        assert.match(write[1], /^(mandi_prices|mandi_sources|mandis|commodities|mandi_source_sync_state|commodity_daily_reports)$/i,
          `unexpected write target: ${statement.slice(0, 80)}`);
      }
    }
  }
});

/**
 * Phase 4 must be additive: it may create its own forecast tables but must never
 * write to (or read from) the Phase 1-3 market and farmer data.
 */
test('007: writes only to its own forecast tables and reads no Phase 3 data', async () => {
  const sql = await fs.readFile(path.join(dir, PHASE4[0]), 'utf8');
  for (const statement of statements(sql)) {
    const write = statement.match(/^(?:INSERT\s+INTO|UPDATE)\s+("?[\w.]+"?)/i);
    if (write) {
      assert.match(write[1], /^(forecast_runs|forecasts)$/i, `unexpected write target: ${statement.slice(0, 80)}`);
    }
    // A CREATE TABLE ... AS SELECT, or any SELECT from Phase 3 tables, would couple
    // Phase 4 to data it must only read through the application layer.
    assert.ok(!/\bSELECT\b/i.test(sql), '007 must not contain a SELECT');
  }
  // Price history is never a cascade target of a Phase 4 delete.
  assert.ok(!/REFERENCES\s+(mandi_prices|mandis|commodities)\s*\([^)]*\)\s*ON\s+DELETE\s+CASCADE/i.test(sql));
});

test('007: the only CASCADE is on the derived forecast rows', async () => {
  const sql = strip(await fs.readFile(path.join(dir, PHASE4[0]), 'utf8'));
  const cascades = [...sql.matchAll(/(\w+)\s+INTEGER\s+NOT NULL\s+REFERENCES\s+(\w+)\(id\)\s+ON\s+DELETE\s+CASCADE/gi)];
  assert.equal(cascades.length, 1, 'exactly one cascade is expected');
  assert.equal(cascades[0][1], 'run_id');
  assert.equal(cascades[0][2], 'forecast_runs');
  // Every other foreign key must protect its parent row.
  const restrict = [...sql.matchAll(/ON\s+DELETE\s+RESTRICT/gi)];
  assert.ok(restrict.length >= 4, 'commodity/mandi references must stay RESTRICT');
});

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

test('migration directory: files are ordered by phase and numbers are unique', async () => {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files, ['002_phase2_farmers.sql', '003_phase2_email_identity.sql', ...PHASE3, ...PHASE4, ...PHASE5, ...PHASE8]);
});
