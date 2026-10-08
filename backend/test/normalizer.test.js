import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCode,
  nameKey,
  normalizeCommodity,
  normalizeDate,
  normalizeMandi,
  normalizeMandiRecord,
  normalizePriceUnit,
  parseNumber,
} from '../src/pipeline/normalizer.js';

const base = {
  source: 'DATA_GOV_IN',
  state: 'Maharashtra',
  district: 'Pune',
  mandi_name: 'Pune',
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

// ── Regression tests for the six defects found by the Phase 3 audit ─────────

test('Regression 1: "Sweet Potato" is not normalised to Potato', () => {
  assert.equal(normalizeCommodity('Potato').code, 'POTATO');
  const sweet = normalizeCommodity('Sweet Potato');
  assert.equal(sweet.code, 'SWEET_POTATO');
  assert.equal(sweet.name, 'Sweet Potato');
  assert.notEqual(normalizeCommodity('Onion Green').code, 'ONION');
  assert.notEqual(normalizeCommodity('Cotton Seed').code, 'COTTON');
});

test('Regression 2: distinct Pune sub-markets keep distinct identities', () => {
  const main = normalizeMandi('Pune', 'Pune', 'Maharashtra');
  const moshi = normalizeMandi('Pune(Moshi)', 'Pune', 'Maharashtra');
  const pimpri = normalizeMandi('Pune(Pimpri)', 'Pune', 'Maharashtra');
  assert.equal(new Set([main.code, moshi.code, pimpri.code]).size, 3);
  assert.equal(moshi.name, 'Pune(Moshi)');
  // Formatting-only differences of the SAME name do match.
  assert.equal(normalizeMandi('Pune (Moshi)', 'Pune', 'Maharashtra').code, moshi.code);
});

test('Regression 3: a missing state is never filled in (no "Maharashtra" default)', () => {
  const record = normalizeMandiRecord({ ...base, state: '' });
  assert.equal(record.state, null);
  assert.equal(record.mandi_code, null);
  assert.equal(record.source_state_name, null);
  assert.ok(record.quality_flags.includes('MISSING_LOCATION'));
  assert.equal(normalizeMandi('Pune', 'Pune', undefined), null);
  assert.equal(normalizeMandi('Pune', undefined, 'Maharashtra'), null);
});

test('Regression 4: impossible calendar dates such as 31/02/2026 are rejected', () => {
  assert.equal(normalizeDate('31/02/2026', 'DMY'), null);
  assert.equal(normalizeDate('2026-02-31', 'ISO'), null);
  assert.equal(normalizeDate('29/02/2025', 'DMY'), null);
  assert.equal(normalizeDate('29/02/2024', 'DMY'), '2024-02-29');
  assert.equal(normalizeDate('not-a-date'), null);
  const record = normalizeMandiRecord({ ...base, price_date: '31/02/2026' });
  assert.equal(record.price_date, null);
  assert.ok(record.quality_flags.includes('INVALID_DATE'));
});

test('Regression 5: missing prices stay null (never 0)', () => {
  const record = normalizeMandiRecord({ ...base, min_price: '', max_price: undefined, modal_price: 'NA' });
  assert.equal(record.min_price, null);
  assert.equal(record.max_price, null);
  assert.equal(record.modal_price, null);
  assert.ok(record.quality_flags.includes('MISSING_MIN_PRICE'));
  assert.ok(record.quality_flags.includes('MISSING_MODAL_PRICE'));
});

test('Regression 6: missing arrivals stay null (never 0)', () => {
  const record = normalizeMandiRecord({ ...base, arrivals_quantity: null });
  assert.equal(record.arrivals_quantity, null);
  assert.equal(record.arrival_unit, null);
  const blank = normalizeMandiRecord({ ...base, arrivals_quantity: '' });
  assert.equal(blank.arrivals_quantity, null);
});

// ── Further normalisation rules ────────────────────────────────────────────

test('DD/MM/YYYY is never read as US month-first', () => {
  assert.equal(normalizeDate('05/02/2026', 'DMY'), '2026-02-05');
  assert.equal(normalizeDate('15/02/2026'), '2026-02-15');
  assert.equal(normalizeDate('2026-09-01T00:00:00.000Z'), '2026-09-01');
});

test('original source names, variety and grade are preserved', () => {
  const record = normalizeMandiRecord({ ...base, mandi_name: '  Pune(Moshi) ', variety: 'Nasik Red', grade: 'Local' });
  assert.equal(record.source_market_name, 'Pune(Moshi)');
  assert.equal(record.source_commodity_name, 'Onion');
  assert.equal(record.variety, 'Nasik Red');
  assert.equal(record.source_grade, 'Local');
  assert.equal(record.price_date, '2026-02-15');
  assert.deepEqual([record.min_price, record.max_price, record.modal_price], [1200, 1800, 1500]);
});

test('missing variety and grade stay null (no "Standard"/"FAQ" defaults)', () => {
  const record = normalizeMandiRecord({ ...base, variety: undefined, grade: '' });
  assert.equal(record.variety, null);
  assert.equal(record.grade, null);
});

test('units: known units convert to INR/quintal; unknown units are not relabelled', () => {
  assert.deepEqual(normalizePriceUnit('Rs./Quintal'), { unit: 'INR/quintal', factor: 1 });
  const perKg = normalizeMandiRecord({ ...base, min_price: 12, max_price: 18, modal_price: 15, price_unit: 'INR/kg' });
  assert.deepEqual([perKg.min_price, perKg.max_price, perKg.modal_price, perKg.price_unit], [1200, 1800, 1500, 'INR/quintal']);
  const perTonne = normalizeMandiRecord({ ...base, modal_price: 15000, min_price: null, max_price: null, price_unit: 'INR/tonne' });
  assert.equal(perTonne.modal_price, 1500);
  const bag = normalizeMandiRecord({ ...base, price_unit: 'per bag' });
  assert.equal(bag.price_unit, null);
  assert.equal(bag.modal_price, null);
  assert.ok(bag.quality_flags.includes('UNKNOWN_PRICE_UNIT'));
});

test('arrivals convert only with a known arrival unit', () => {
  const quintals = normalizeMandiRecord({ ...base, arrivals_quantity: '250', arrival_unit: 'quintal' });
  assert.deepEqual([quintals.arrivals_quantity, quintals.arrival_unit], [25, 'tonne']);
  const unknown = normalizeMandiRecord({ ...base, arrivals_quantity: '250', arrival_unit: 'bags' });
  assert.equal(unknown.arrivals_quantity, null);
  assert.ok(unknown.quality_flags.includes('UNKNOWN_ARRIVAL_UNIT'));
});

test('Agmarknet zero min/max are treated as not reported and flagged', () => {
  const record = normalizeMandiRecord({ ...base, min_price: '0', max_price: '0' });
  assert.equal(record.min_price, null);
  assert.ok(record.quality_flags.includes('ZERO_MIN_PRICE_TREATED_AS_MISSING'));
  assert.equal(record.modal_price, 1500);
});

test('helpers: parseNumber, nameKey and makeCode', () => {
  assert.deepEqual(parseNumber('1,250.5'), { value: 1250.5, invalid: false });
  assert.deepEqual(parseNumber('abc'), { value: null, invalid: true });
  assert.deepEqual(parseNumber(''), { value: null, invalid: false });
  assert.equal(nameKey('  Pune (Moshi) '), 'pune moshi');
  // part boundaries never merge ("A B"+"C" differs from "A"+"B C")
  assert.notEqual(makeCode(['A B', 'C']), makeCode(['A', 'B C']));
  const long = makeCode(['Maharashtra', 'Chhatrapati Sambhajinagar', 'A very long market name that keeps going on']);
  assert.ok(long.length <= 64);
  assert.match(makeCode(['कांदा बाजार']), /^U[0-9A-F]{10}$/);
});
