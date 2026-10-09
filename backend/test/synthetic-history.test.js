import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMODITIES, SYNTHETIC_COLUMNS, SYNTHETIC_END, SYNTHETIC_START, dateRange, generateSyntheticHistory, toCsv } from '../src/pipeline/historical/synthetic-history.js';

const { rows, meta } = generateSyntheticHistory({ seed: 42 });

test('covers exactly October 2021 to September 2026, sorted, with a realistic number of rows', () => {
  assert.equal(rows[0].price_date >= SYNTHETIC_START, true);
  assert.equal(rows.at(-1).price_date <= SYNTHETIC_END, true);
  assert.equal(meta.days, dateRange(SYNTHETIC_START, SYNTHETIC_END).length);
  assert.equal(meta.days, 1826);
  assert.ok(rows.length > 50_000 && rows.length < 200_000, `rows=${rows.length}`);
  assert.deepEqual(rows.map((r) => r.price_date), rows.map((r) => r.price_date).sort());
});

test('deterministic for a seed, different for another seed', () => {
  assert.equal(toCsv(generateSyntheticHistory({ seed: 42 }).rows), toCsv(rows));
  assert.notEqual(toCsv(generateSyntheticHistory({ seed: 43, from: '2022-01-01', to: '2022-03-31' }).rows), toCsv(generateSyntheticHistory({ seed: 42, from: '2022-01-01', to: '2022-03-31' }).rows));
});

test('every row is labelled synthetic, never as a genuine source', () => {
  for (const r of rows) {
    assert.equal(r.source, 'MOCK_PROVIDER');
    assert.equal(r.is_sample_data, 'true');
    assert.equal(r.quality_flags, 'SYNTHETIC_SAMPLE');
    assert.ok(r.source_record_key.startsWith('SYN:'));
  }
  assert.ok(!toCsv(rows).includes('CEDA'));
});

test('price invariants: positive integers, min <= modal <= max, INR/quintal, arrivals in tonnes', () => {
  for (const r of rows) {
    assert.ok(Number.isInteger(r.min_price) && r.min_price > 0);
    assert.ok(r.min_price <= r.modal_price && r.modal_price <= r.max_price, `${r.price_date} ${r.mandi_name}`);
    assert.equal(r.price_unit, 'INR/quintal');
    assert.equal(r.arrival_unit, 'tonne');
    assert.ok(r.arrivals_quantity > 0);
  }
});

test('one row per market, commodity and day; no invented zero-price days', () => {
  const keys = new Set(rows.map((r) => `${r.mandi_code}|${r.commodity_code}|${r.price_date}`));
  assert.equal(keys.size, rows.length);
  assert.ok(!rows.some((r) => r.modal_price === 0));
});

test('series are sparse like real markets: Sundays mostly closed, gaps exist, not every pair exists', () => {
  const sundays = rows.filter((r) => new Date(`${r.price_date}T00:00:00Z`).getUTCDay() === 0).length;
  assert.ok(sundays / rows.length < 0.02, 'Sunday share should be tiny');
  assert.ok(meta.pairs < 12 * COMMODITIES.length, 'sparse market-commodity matrix');
  const lasalgaonOnion = rows.filter((r) => r.mandi_name === 'Lasalgaon' && r.commodity_name === 'Onion');
  assert.ok(lasalgaonOnion.length < meta.days * 0.9, 'a market does not report every day');
  assert.ok(!rows.some((r) => r.mandi_name === 'Lasalgaon' && r.commodity_name === 'Cotton'));
});

test('prices show seasonality and variation; volatile crops move more than stable ones', () => {
  const cv = (name) => {
    const v = rows.filter((r) => r.commodity_name === name).map((r) => Math.log(r.modal_price));
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  };
  assert.ok(cv('Tomato') > cv('Wheat'), 'tomato is more volatile than wheat');
  assert.ok(cv('Onion') > 0.1, 'onion varies over time');
});

test('uses the repo commodity and market identities so it lines up with the pipeline', () => {
  assert.ok(rows.some((r) => r.commodity_code === 'ONION' && r.commodity_name === 'Onion'));
  assert.ok(rows.some((r) => r.mandi_code === 'MAHARASHTRA__PUNE__PUNE_MOSHI'));
});

test('CSV has the documented columns and quotes safely', () => {
  const csv = toCsv(rows.slice(0, 3));
  assert.equal(csv.split('\n')[0], SYNTHETIC_COLUMNS.join(','));
  assert.equal(toCsv([{ ...rows[0], source_market_name: 'A, "B"' }]).split('\n')[1].includes('"A, ""B"""'), true);
});
