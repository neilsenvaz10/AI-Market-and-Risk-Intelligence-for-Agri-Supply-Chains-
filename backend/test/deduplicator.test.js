import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deduplicateRecords,
  deduplicateWithinSource,
  findCrossSourceOverlaps,
  getSourcePrecedence,
} from '../src/pipeline/deduplicator.js';

const rec = (overrides) => ({
  source: 'DATA_GOV_IN',
  mandi_code: 'MAHARASHTRA__NASHIK__LASALGAON',
  commodity_code: 'ONION',
  price_date: '2026-09-01',
  variety: 'Red',
  grade: 'FAQ',
  min_price: 1000,
  max_price: 1600,
  modal_price: 1400,
  arrivals_quantity: null,
  price_unit: 'INR/quintal',
  arrival_unit: null,
  ...overrides,
});

test('within source: identical duplicates collapse without a conflict', () => {
  const { uniqueRecords, duplicatesCount, conflicts } = deduplicateWithinSource([rec({}), rec({})]);
  assert.equal(uniqueRecords.length, 1);
  assert.equal(duplicatesCount, 1);
  assert.equal(conflicts.length, 0);
});

test('within source: conflicting reports are kept for review, not silently discarded', () => {
  const first = rec({ modal_price: 1400 });
  const second = rec({ modal_price: 1550, max_price: 1700 });
  const { uniqueRecords, conflicts } = deduplicateWithinSource([first, second]);
  assert.equal(uniqueRecords.length, 1);
  assert.equal(uniqueRecords[0], second, 'latest report in source order is kept (deterministic)');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'SAME_SOURCE_CONFLICT');
  assert.deepEqual(conflicts[0].discarded, [first]);
});

test('within source: different variety or grade are distinct observations', () => {
  const { uniqueRecords } = deduplicateWithinSource([rec({}), rec({ variety: 'White' }), rec({ grade: 'Local' })]);
  assert.equal(uniqueRecords.length, 3);
});

test('cross source: same market-day from CEDA and data.gov.in is detected and both are preserved', () => {
  const dataGov = rec({});
  const ceda = rec({ source: 'CEDA', variety: null, grade: null, modal_price: 1400 });
  const { uniqueRecords, overlaps } = deduplicateRecords([dataGov, ceda], { crossSource: true });
  assert.equal(uniqueRecords.length, 2, 'provenance: both source rows kept');
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].type, 'CROSS_SOURCE_MATCH');
  assert.deepEqual(overlaps[0].sources, ['CEDA', 'DATA_GOV_IN']);
});

test('cross source: disagreeing reports are classified as a conflict', () => {
  const overlaps = findCrossSourceOverlaps([rec({}), rec({ source: 'CEDA', variety: null, grade: null, modal_price: 1650, max_price: 1800 })]);
  assert.equal(overlaps[0].type, 'CROSS_SOURCE_CONFLICT');
});

test('cross source: several varieties vs one unspecified report is a granularity mismatch', () => {
  const overlaps = findCrossSourceOverlaps([
    rec({ variety: 'Red' }), rec({ variety: 'White', modal_price: 1200 }),
    rec({ source: 'CEDA', variety: null, grade: null, modal_price: 1300 }),
  ]);
  assert.equal(overlaps[0].type, 'GRANULARITY_MISMATCH');
});

test('source precedence: genuine sources outrank synthetic data', () => {
  assert.ok(getSourcePrecedence('DATA_GOV_IN') > getSourcePrecedence('CEDA'));
  assert.ok(getSourcePrecedence('CEDA') > getSourcePrecedence('MOCK_PROVIDER'));
});
