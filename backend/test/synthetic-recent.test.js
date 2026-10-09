import test from 'node:test';
import assert from 'node:assert/strict';
import { RECENT_COLUMNS, RECENT_END, generateSyntheticDataset } from '../src/pipeline/historical/synthetic-dataset.js';

const dataset = generateSyntheticDataset({ seed: 42 });
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

test('recent: last 30 days ending yesterday, data.gov.in layout, DD/MM/YYYY dates', () => {
  assert.equal(dataset.meta.recentTo, RECENT_END);
  assert.equal(dataset.meta.recentFrom, '2026-09-09');
  assert.ok(dataset.recent.length > 500);
  const dates = new Set(dataset.recent.map((r) => r.arrival_date));
  assert.ok([...dates].every((d) => /^\d{2}\/\d{2}\/2026$/.test(d)));
  assert.ok(dates.has('08/10/2026'));
  assert.ok(!dates.has('09/10/2026'), 'nothing dated after the latest reporting day');
  assert.deepEqual(Object.keys(dataset.recent[0]), RECENT_COLUMNS);
  assert.ok(dataset.recent.some((r) => r.variety === 'Red' && r.grade === 'FAQ'));
});

test('recent rows are flagged synthetic and keep price invariants', () => {
  for (const r of dataset.recent) {
    assert.equal(r.source, 'MOCK_PROVIDER');
    assert.equal(r.is_sample_data, 'true');
    assert.equal(r.quality_flags, 'SYNTHETIC_SAMPLE');
    assert.ok(r.min_price > 0 && r.min_price <= r.modal_price && r.modal_price <= r.max_price);
  }
});

test('history and recent share one price path: overlapping dates agree', () => {
  const recentPrimary = new Map(dataset.recent.filter((r) => r.variety === 'Red').map((r) => [`${r.market}|${r.arrival_date}`, r.modal_price]));
  const overlap = dataset.history.filter((h) => h.commodity_name === 'Onion' && h.price_date >= '2026-09-09' && recentPrimary.has(`${h.mandi_name}|${dmy(h.price_date)}`));
  assert.ok(overlap.length > 20);
  for (const h of overlap) assert.equal(recentPrimary.get(`${h.mandi_name}|${dmy(h.price_date)}`), h.modal_price);
  assert.ok(dataset.history.at(-1).price_date <= '2026-09-30');
});

test('some market-commodity pairs report two varieties on the same day, with different prices', () => {
  const byDay = new Map();
  for (const r of dataset.recent) {
    const key = `${r.market}|${r.commodity}|${r.arrival_date}`;
    byDay.set(key, [...(byDay.get(key) || []), r]);
  }
  const multi = [...byDay.values()].filter((v) => v.length > 1);
  assert.ok(multi.length > 0);
  assert.ok(multi.every((v) => new Set(v.map((r) => r.variety)).size === v.length), 'no duplicate variety rows');
});

test('deterministic', () => {
  assert.deepEqual(generateSyntheticDataset({ seed: 42 }).recent, dataset.recent);
});
