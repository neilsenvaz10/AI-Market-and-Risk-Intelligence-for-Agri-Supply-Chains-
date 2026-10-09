/**
 * Phase 5 canonical persister tests (fake pool; no DB, no network).
 *
 * Proves the INSERT carries the canonical columns in canonicalColumns() order
 * with the values produced by deriveCanonicalFields, and that a duplicate
 * (source, source_record_key) — surfacing as 23505 on the Phase 5 partial index
 * — is counted as a skip instead of aborting the batch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalColumns, deriveCanonicalFields } from '../src/pipeline/canonical.js';
import { MandiPersister, isDuplicateSourceRecordError } from '../src/pipeline/persister.js';

function sampleRecord(overrides = {}) {
  return {
    source: 'MOCK_PROVIDER',
    is_sample_data: true,
    source_record_key: null,
    source_market_id: null,
    source_commodity_id: null,
    source_state_id: null,
    source_district_id: null,
    source_market_name: 'Test Market',
    source_commodity_name: 'Onion',
    source_state_name: 'Test State',
    source_district_name: 'Test District',
    source_variety: 'Red',
    source_grade: 'FAQ',
    mandi_code: 'TEST_STATE__TEST_DISTRICT__TEST_MARKET',
    mandi_name: 'Test Market',
    state: 'Test State',
    district: 'Test District',
    latitude: null,
    longitude: null,
    commodity_code: 'ONION',
    commodity_name: 'Onion',
    commodity_category: 'Vegetables',
    commodity_hindi: null,
    commodity_marathi: null,
    variety: 'Red',
    grade: 'FAQ',
    price_date: '2026-09-01',
    min_price: 1000,
    max_price: 1400,
    modal_price: 1200,
    price_unit: 'INR/quintal',
    arrivals_quantity: 12.5,
    arrival_unit: 'tonne',
    quality_flags: [],
    fetched_at: null,
    raw_payload: { test: true },
    ...overrides,
  };
}

function makeFakePool({ onPriceInsert } = {}) {
  const client = {
    queries: [],
    released: false,
    async query(text, params) {
      client.queries.push({ text, params });
      if (text.includes('INSERT INTO mandis')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (text.includes('INSERT INTO commodities')) return { rows: [{ id: 2 }], rowCount: 1 };
      if (text.includes('SELECT id, min_price')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO mandi_prices (')) {
        return onPriceInsert ? onPriceInsert(text, params) : { rows: [{ id: 10 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { client.released = true; },
  };
  return { connect: async () => client, query: async () => ({ rows: [{ n: 1 }], rowCount: 1 }), client };
}

/** Balanced-paren tuple extraction (VALUES contains COALESCE(...)). */
function tupleAt(sql, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(openIndex + 1, i);
    }
  }
  throw new Error('unbalanced parentheses in SQL');
}

function splitTopLevel(tuple) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of tuple) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

function parseInsert(sql) {
  const insertIndex = sql.indexOf('INSERT INTO mandi_prices (');
  assert.ok(insertIndex >= 0, 'expected an INSERT INTO mandi_prices statement');
  const columns = splitTopLevel(tupleAt(sql, sql.indexOf('(', insertIndex)));
  const valuesIndex = sql.indexOf('VALUES', insertIndex);
  const values = splitTopLevel(tupleAt(sql, sql.indexOf('(', valuesIndex)));
  assert.equal(values.length, columns.length, 'every column must have a value token');
  return { columns, values };
}

test('persister INSERT carries the canonical columns in canonicalColumns() order with derived values', async () => {
  const pool = makeFakePool();
  const persister = new MandiPersister({ pool, allowSampleData: true });
  const record = sampleRecord({
    source_variety_code: 'V-42',
    source_state_id: '27',
    source_district_id: '521',
    source_market_id: 'MKT-9',
    source_commodity_category_code: 'CAT-1',
    source_dataset: 'res-123',
  });

  const result = await persister.persistBatch([record], { runId: null });
  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);

  const insert = pool.client.queries.find((q) => q.text.includes('INSERT INTO mandi_prices ('));
  assert.ok(insert, 'INSERT INTO mandi_prices must have been executed');
  assert.ok(insert.text.includes('ON CONFLICT ON CONSTRAINT uq_mandi_prices_observation DO NOTHING'),
    'the observation constraint is the documented single ON CONFLICT target');

  const { columns, values } = parseInsert(insert.text);
  const canonicalInSql = columns.filter((column) => canonicalColumns().includes(column));
  assert.deepEqual(canonicalInSql, canonicalColumns(), 'canonical columns appear in canonicalColumns() order');

  const fields = deriveCanonicalFields(record);
  for (const column of canonicalColumns()) {
    const token = values[columns.indexOf(column)];
    assert.match(token, /^\$\d+$/, `${column} must bind a parameter`);
    assert.equal(insert.params[Number(token.slice(1)) - 1], fields[column], `${column} parameter value`);
  }
  assert.equal(fields.variety_code, 'V-42');
  assert.equal(fields.market_code, 'MKT-9');
  assert.equal(fields.quality_status, 'VALID');
});

test('persister still inserts when every canonical code is null', async () => {
  const pool = makeFakePool();
  const persister = new MandiPersister({ pool, allowSampleData: true });
  const record = sampleRecord();
  const result = await persister.persistBatch([record], { runId: null });
  assert.equal(result.inserted, 1);

  const insert = pool.client.queries.find((q) => q.text.includes('INSERT INTO mandi_prices ('));
  const { columns, values } = parseInsert(insert.text);
  for (const column of ['variety_code', 'state_code', 'district_code', 'market_code', 'commodity_category_code', 'source_dataset']) {
    const token = values[columns.indexOf(column)];
    assert.equal(insert.params[Number(token.slice(1)) - 1], null, `${column} stays NULL`);
  }
  const statusToken = values[columns.indexOf('quality_status')];
  assert.equal(insert.params[Number(statusToken.slice(1)) - 1], 'VALID');
});

test('a simulated 23505 on uq_mandi_prices_source_record is counted as a skip, not thrown', async () => {
  const duplicate = Object.assign(
    new Error('duplicate key value violates unique constraint "uq_mandi_prices_source_record"'),
    { code: '23505', constraint: 'uq_mandi_prices_source_record' }
  );
  const pool = makeFakePool({ onPriceInsert: () => { throw duplicate; } });
  const persister = new MandiPersister({ pool, allowSampleData: true });

  const result = await persister.persistBatch([sampleRecord({ source_record_key: 'DUP-1' })], { runId: null });

  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.inserted, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(result.skippedRecords.length, 1);
  assert.equal(result.skippedRecords[0].reason, 'SOURCE_RECORD_ALREADY_STORED');
  assert.equal(result.skippedRecords[0].key, 'MOCK_PROVIDER|TEST_STATE__TEST_DISTRICT__TEST_MARKET|ONION|2026-09-01|red|faq');
  assert.ok(pool.client.queries.some((q) => q.text === 'ROLLBACK TO SAVEPOINT record_write'), 'the row is rolled back alone');
  assert.ok(pool.client.queries.some((q) => q.text === 'COMMIT'), 'the rest of the batch still commits');
  assert.ok(pool.client.released);
});

test('other errors are never swallowed: they still fail the row', async () => {
  const foreignKey = Object.assign(new Error('insert or update violates foreign key constraint'), { code: '23503' });
  const pool = makeFakePool({ onPriceInsert: () => { throw foreignKey; } });
  const persister = new MandiPersister({ pool, allowSampleData: true });

  const result = await persister.persistBatch([sampleRecord()], { runId: null });
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.skippedRecords.length, 0);
});

test('isDuplicateSourceRecordError matches only the Phase 5 source-record index', () => {
  assert.equal(isDuplicateSourceRecordError({ code: '23505', constraint: 'uq_mandi_prices_source_record' }), true);
  assert.equal(isDuplicateSourceRecordError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "uq_mandi_prices_source_record"',
  }), true);
  assert.equal(isDuplicateSourceRecordError({ code: '23505', constraint: 'uq_mandi_prices_observation' }), false);
  assert.equal(isDuplicateSourceRecordError({ code: '23503', constraint: 'uq_mandi_prices_source_record' }), false);
  assert.equal(isDuplicateSourceRecordError(null), false);
});
