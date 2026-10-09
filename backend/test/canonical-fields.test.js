/**
 * Phase 5 canonical-field mapping tests (pure; no DB, no network).
 *
 * Covers: never-guess code rules, quality_status mapping, content_hash
 * determinism/type-sensitivity, canonicalColumns() vs migration 007 drift, and
 * the additive normalizer pass-through fields.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CANONICAL_QUALITY_STATUSES,
  CONTENT_HASH_FIELDS,
  canonicalColumns,
  computeContentHash,
  deriveCanonicalFields,
} from '../src/pipeline/canonical.js';
import { normalizeMandiRecord } from '../src/pipeline/normalizer.js';

const raw = {
  source: 'DATA_GOV_IN',
  state: 'Maharashtra',
  district: 'Pune',
  mandi_name: 'Pune(Moshi)',
  commodity_name: 'Onion',
  variety: 'Red',
  grade: 'FAQ',
  price_date: '15/02/2026',
  date_format: 'DMY',
  min_price: '1200',
  max_price: '1800',
  modal_price: '1500',
  price_unit: 'INR/quintal',
};

const base = (overrides = {}) => normalizeMandiRecord({ ...raw, ...overrides });

const fullValueRecord = {
  source: 'DATA_GOV_IN',
  source_record_key: 'KEY-1',
  mandi_code: 'MAHARASHTRA__PUNE__PUNE_MOSHI',
  commodity_code: 'ONION',
  price_date: '2026-02-15',
  price_unit: 'INR/quintal',
  modal_price: 1500,
  min_price: 1200,
  max_price: 1800,
  arrivals_quantity: 12.5,
  arrival_unit: 'tonne',
  variety: 'Red',
  grade: 'FAQ',
};

// ── Never guess ────────────────────────────────────────────────────────────

test('deriveCanonicalFields returns null for every code the source did not publish', () => {
  const fields = deriveCanonicalFields(base());
  assert.equal(fields.variety_code, null);
  assert.equal(fields.state_code, null);
  assert.equal(fields.district_code, null);
  assert.equal(fields.market_code, null);
  assert.equal(fields.commodity_category_code, null);
  assert.equal(fields.source_dataset, null);
  assert.equal(fields.quality_status, 'VALID');
  assert.equal(typeof fields.content_hash, 'string');
  assert.equal(fields.content_hash.length, 64);
});

test('a code is never derived from a name (names alone leave codes null)', () => {
  const fields = deriveCanonicalFields({
    source_state_name: 'Maharashtra',
    source_district_name: 'Pune',
    source_market_name: 'Pune(Moshi)',
    source_commodity_name: 'Onion',
    commodity_category: 'Vegetables',
    variety: 'Red',
  });
  assert.equal(fields.state_code, null);
  assert.equal(fields.district_code, null);
  assert.equal(fields.market_code, null);
  assert.equal(fields.commodity_category_code, null);
  assert.equal(fields.variety_code, null);
  assert.equal(fields.content_hash.length, 64);
});

test('source-provided codes are passed through verbatim and are never guessed', () => {
  const record = base({
    source_variety_code: 'V-42',
    source_state_id: '27',
    source_district_id: '521',
    source_market_id: 'MKT-9',
    source_commodity_category_code: 'CAT-1',
    source_dataset: 'data-gov-in-resource-9ef84268',
  });
  const fields = deriveCanonicalFields(record);
  assert.equal(fields.variety_code, 'V-42');
  assert.equal(fields.state_code, '27');
  assert.equal(fields.district_code, '521');
  assert.equal(fields.market_code, 'MKT-9');
  assert.equal(fields.commodity_category_code, 'CAT-1');
  assert.equal(fields.source_dataset, 'data-gov-in-resource-9ef84268');
  // An explicit caller override wins over the inline dataset.
  assert.equal(deriveCanonicalFields(record, { sourceDataset: 'override-dataset' }).source_dataset, 'override-dataset');
});

// ── quality_status ─────────────────────────────────────────────────────────

test('quality_status: no flags -> VALID, flags -> FLAGGED, refused -> REJECTED', () => {
  assert.equal(deriveCanonicalFields({}).quality_status, 'VALID');
  assert.equal(deriveCanonicalFields({ quality_flags: [] }).quality_status, 'VALID');
  assert.equal(deriveCanonicalFields({ quality_flags: ['PRICE_UNIT_FROM_PUBLISHER_CONVENTION'] }).quality_status, 'FLAGGED');
  // Refusal can be signalled by the validation outcome or by an explicit marker.
  assert.equal(deriveCanonicalFields(base(), { validation: { valid: false } }).quality_status, 'REJECTED');
  assert.equal(deriveCanonicalFields(base(), { rejected: true }).quality_status, 'REJECTED');
  assert.equal(deriveCanonicalFields({ rejected: true }).quality_status, 'REJECTED');
  assert.equal(deriveCanonicalFields({ validation_valid: false }).quality_status, 'REJECTED');
  assert.equal(deriveCanonicalFields({ quality_status: 'REJECTED' }).quality_status, 'REJECTED');
  assert.equal(deriveCanonicalFields({ quality_flags: ['REJECTED'] }).quality_status, 'REJECTED');
  assert.deepEqual(CANONICAL_QUALITY_STATUSES, ['VALID', 'FLAGGED', 'REJECTED']);
  // A refusal overrides present flags.
  assert.equal(deriveCanonicalFields({ quality_flags: ['MISSING_MIN_PRICE'] }, { rejected: true }).quality_status, 'REJECTED');
});

// ── content_hash ───────────────────────────────────────────────────────────

test('content_hash is deterministic and independent of key order', () => {
  const first = computeContentHash(fullValueRecord);
  const second = computeContentHash({ ...fullValueRecord });
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.match(first, /^[0-9a-f]{64}$/);

  const reordered = {};
  for (const key of [...Object.keys(fullValueRecord)].reverse()) reordered[key] = fullValueRecord[key];
  assert.equal(computeContentHash(reordered), first);
  assert.deepEqual(deriveCanonicalFields(fullValueRecord).content_hash, first);
});

test('content_hash differs whenever any hashed value changes', () => {
  const baseline = computeContentHash(fullValueRecord);
  for (const field of CONTENT_HASH_FIELDS) {
    const current = fullValueRecord[field];
    const changedValue = typeof current === 'number' ? current + 1 : `${current}-changed`;
    const changed = { ...fullValueRecord, [field]: changedValue };
    assert.notEqual(computeContentHash(changed), baseline, `changing ${field} must change the hash`);
  }
  // The tuple itself is the documented, stable field list.
  assert.deepEqual(CONTENT_HASH_FIELDS, [
    'source', 'source_record_key', 'mandi_code', 'commodity_code', 'price_date', 'price_unit',
    'modal_price', 'min_price', 'max_price', 'arrivals_quantity', 'arrival_unit', 'variety', 'grade',
  ]);
});

test('content_hash never collides across null, 0 and empty string', () => {
  const nullMin = computeContentHash({ ...fullValueRecord, min_price: null });
  const zeroMin = computeContentHash({ ...fullValueRecord, min_price: 0 });
  assert.notEqual(nullMin, zeroMin);

  const emptyVariety = computeContentHash({ ...fullValueRecord, variety: '' });
  const nullVariety = computeContentHash({ ...fullValueRecord, variety: null });
  assert.notEqual(emptyVariety, nullVariety);

  // undefined is the same as "missing" (null), as documented.
  assert.equal(computeContentHash({ ...fullValueRecord, variety: undefined }), nullVariety);
});

// ── canonicalColumns() drift ────────────────────────────────────────────────

test('canonicalColumns() matches the real migration 007 column list', () => {
  const sql = readFileSync(new URL('../../database/migrations/007_phase5_canonical_mandi.sql', import.meta.url), 'utf8');
  const parsed = [...sql.matchAll(/ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS\s+([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(parsed, canonicalColumns());
  assert.deepEqual(canonicalColumns(), [
    'variety_code', 'state_code', 'district_code', 'market_code',
    'commodity_category_code', 'source_dataset', 'content_hash', 'quality_status',
  ]);
  // A returned copy can never mutate the module's internal order.
  canonicalColumns().push('nope');
  assert.equal(canonicalColumns().includes('nope'), false);
});

test('deriveCanonicalFields returns exactly the canonical column keys', () => {
  const keys = Object.keys(deriveCanonicalFields(base()));
  assert.equal(keys.length, canonicalColumns().length);
  assert.deepEqual([...keys].sort(), [...canonicalColumns()].sort());
  assert.deepEqual(keys, [
    'variety_code', 'state_code', 'district_code', 'market_code',
    'commodity_category_code', 'source_dataset', 'quality_status', 'content_hash',
  ]);
});

// ── Normalizer pass-through (additive, contract preserved) ─────────────────

const REQUIRED_NORMALIZED_KEYS = [
  'source', 'is_sample_data', 'source_record_key', 'source_market_id', 'source_commodity_id',
  'source_state_id', 'source_district_id', 'source_market_name', 'source_commodity_name',
  'source_state_name', 'source_district_name', 'source_variety', 'source_grade', 'mandi_code',
  'mandi_name', 'state', 'district', 'latitude', 'longitude', 'commodity_code', 'commodity_name',
  'commodity_category', 'commodity_hindi', 'commodity_marathi', 'variety', 'grade', 'price_date',
  'min_price', 'max_price', 'modal_price', 'price_unit', 'arrivals_quantity', 'arrival_unit',
  'quality_flags', 'fetched_at', 'raw_payload',
];

test('normalizer keeps the existing shape and only adds the Phase 5 pass-through fields', () => {
  const record = base();
  for (const key of REQUIRED_NORMALIZED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, key), `existing key ${key} must survive`);
  }
  assert.equal(record.source_market_name, 'Pune(Moshi)');
  assert.equal(record.price_date, '2026-02-15');
  assert.deepEqual([record.min_price, record.max_price, record.modal_price], [1200, 1800, 1500]);
  // Absent on the raw provider record -> null, never a guess.
  assert.equal(record.source_variety_code, null);
  assert.equal(record.source_commodity_category_code, null);
  assert.equal(record.source_dataset, null);
  assert.equal(deriveCanonicalFields(record).variety_code, null);
});

test('normalizer passes through source codes/dataset only when the raw record provides them', () => {
  const withCodes = base({
    source_variety_code: 'V-42',
    source_commodity_category_code: 'CAT-1',
    source_dataset: 'res-123',
  });
  assert.equal(withCodes.source_variety_code, 'V-42');
  assert.equal(withCodes.source_commodity_category_code, 'CAT-1');
  assert.equal(withCodes.source_dataset, 'res-123');
  const fields = deriveCanonicalFields(withCodes);
  assert.equal(fields.variety_code, 'V-42');
  assert.equal(fields.commodity_category_code, 'CAT-1');
  assert.equal(fields.source_dataset, 'res-123');

  const withoutCodes = base();
  assert.equal(withoutCodes.source_variety_code, null);
  assert.equal(deriveCanonicalFields(withoutCodes).variety_code, null);
});
