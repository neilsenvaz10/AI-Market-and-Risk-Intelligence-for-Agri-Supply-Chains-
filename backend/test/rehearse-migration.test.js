import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCloneName, compareProtectedTables, findPgBin } from '../scripts/rehearse-migration.js';

const farmers = (overrides = {}) => ({
  columns: [{ column_name: 'id' }, { column_name: 'full_name' }],
  constraints: [{ conname: 'farmers_pkey', def: 'PRIMARY KEY (id)' }],
  indexes: [{ indexname: 'farmers_pkey', indexdef: 'CREATE UNIQUE INDEX farmers_pkey ON farmers (id)' }],
  triggers: [{ tgname: 'trg_farmers_updated_at', def: 'CREATE TRIGGER ...' }],
  rows: 3,
  rowHash: 'abc',
  ...overrides,
});

test('comparator: identical protected tables and changed Phase 3 tables are fine', () => {
  const before = { farmers: farmers(), mandi_prices: farmers({ rows: 5 }) };
  const after = { farmers: farmers(), mandi_prices: farmers({ rows: 6, rowHash: 'zzz' }), mandi_sources: farmers() };
  assert.deepEqual(compareProtectedTables(before, after), []);
});

test('comparator (negative controls): any change to a protected table is reported', () => {
  const before = { farmers: farmers() };
  for (const [part, change] of [
    ['rowHash', { rowHash: 'different' }],
    ['rows', { rows: 2 }],
    ['columns', { columns: [{ column_name: 'id' }] }],
    ['constraints', { constraints: [] }],
    ['indexes', { indexes: [] }],
    ['triggers', { triggers: [] }],
  ]) {
    assert.deepEqual(compareProtectedTables(before, { farmers: farmers(change) }), [`farmers: ${part} changed`]);
  }
  assert.deepEqual(compareProtectedTables(before, {}), ['farmers: table disappeared']);
});

test('clone name guard: only fasalytics_test_clone_* names that differ from the source', () => {
  assert.doesNotThrow(() => assertCloneName('fasalytics_test_clone_abc123', 'fasalytics'));
  for (const bad of ['fasalytics', 'postgres', 'fasalytics_test_', 'fasalytics_test_clone_', 'fasalytics_test_clone_ABC', 'other_db', 'fasalytics_test_clone_a"; DROP DATABASE x;--']) {
    assert.throws(() => assertCloneName(bad, 'fasalytics'), /Refusing/);
  }
  assert.throws(() => assertCloneName('fasalytics_test_clone_abc', 'fasalytics_test_clone_abc'), /Refusing/);
});

test('pg bin lookup returns a folder or null (falls back to PATH), never throws', () => {
  const found = findPgBin('Z:\\definitely\\missing');
  assert.ok(found === null || typeof found === 'string');
});
