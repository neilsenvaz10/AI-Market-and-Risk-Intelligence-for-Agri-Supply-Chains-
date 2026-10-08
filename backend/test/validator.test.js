import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMandiRecord } from '../src/pipeline/normalizer.js';
import { validateMandiRecord } from '../src/pipeline/validator.js';

const NOW = new Date('2026-10-08T12:00:00Z');
const raw = {
  source: 'DATA_GOV_IN',
  state: 'Maharashtra',
  district: 'Nashik',
  mandi_name: 'Lasalgaon',
  commodity_name: 'Onion',
  variety: 'Red',
  price_date: '15/09/2026',
  date_format: 'DMY',
  min_price: '1000',
  max_price: '1600',
  modal_price: '1400',
  price_unit: 'INR/quintal',
};
const check = (overrides) => validateMandiRecord(normalizeMandiRecord({ ...raw, ...overrides }), { now: NOW });
const codes = (result) => result.errors.map((e) => e.code);

test('accepts a complete genuine record (DD/MM/YYYY with day > 12)', () => {
  const result = check({});
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('accepts a record whose min/max are missing but modal is present', () => {
  assert.equal(check({ min_price: '', max_price: '' }).valid, true);
});

test('rejects missing modal price', () => {
  assert.deepEqual(codes(check({ modal_price: '' })), ['MISSING_MODAL_PRICE']);
});

test('rejects missing state / district / market instead of guessing', () => {
  assert.ok(codes(check({ state: '' })).includes('MISSING_STATE'));
  assert.ok(codes(check({ district: null })).includes('MISSING_DISTRICT'));
  assert.ok(codes(check({ mandi_name: ' ' })).includes('MISSING_MARKET'));
});

test('rejects impossible and future dates', () => {
  assert.ok(codes(check({ price_date: '31/02/2026' })).includes('INVALID_DATE'));
  assert.ok(codes(check({ price_date: '20/10/2026' })).includes('FUTURE_DATE'));
  assert.ok(codes(check({ price_date: '01/01/1990' })).includes('DATE_TOO_OLD'));
});

test('rejects inconsistent prices', () => {
  assert.ok(codes(check({ min_price: '2000', max_price: '1500' })).includes('MIN_ABOVE_MAX'));
  assert.ok(codes(check({ modal_price: '1700' })).includes('MODAL_OUTSIDE_RANGE'));
  assert.ok(codes(check({ modal_price: '-5', min_price: '', max_price: '' })).includes('NON_POSITIVE_PRICE'));
});

test('rejects unknown price units', () => {
  assert.ok(codes(check({ price_unit: 'per bag' })).includes('UNKNOWN_PRICE_UNIT'));
});

test('sample data can never pass as a genuine source and vice versa', () => {
  assert.ok(codes(check({ is_sample_data: true })).includes('SAMPLE_FLAG_ON_GENUINE_SOURCE'));
  assert.ok(codes(check({ source: 'MOCK_PROVIDER', is_sample_data: false })).includes('SAMPLE_SOURCE_NOT_FLAGGED'));
  assert.equal(check({ source: 'MOCK_PROVIDER', is_sample_data: true }).valid, true);
});

test('flags extreme prices as outliers without rejecting them', () => {
  const result = check({ min_price: '', max_price: '', modal_price: '2000000' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, ['PRICE_OUTLIER']);
});
