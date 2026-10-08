import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deduplicateRecords,
  deduplicateWithinSource,
  deduplicateCrossSource,
  SOURCE_PRIORITY,
} from '../src/pipeline/deduplicator.js';

test('Deduplicator: removes duplicate entries with identical within-source composite key', () => {
  const records = [
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'MOCK',
      modal_price: 2400,
      arrivals_quantity: 300,
    },
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'MOCK',
      modal_price: 2450,
      arrivals_quantity: 450, // higher arrivals, should be retained
    },
    {
      mandi_code: 'MH_NSK_MAIN',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'MOCK',
      modal_price: 2350,
      arrivals_quantity: 500,
    },
  ];

  const result = deduplicateWithinSource(records);
  assert.equal(result.uniqueRecords.length, 2);
  assert.equal(result.duplicatesCount, 1);

  const puneRecord = result.uniqueRecords.find((r) => r.mandi_code === 'MH_PUNE_APMC');
  assert.equal(puneRecord.arrivals_quantity, 450);
});

test('Deduplicator: within-source mode preserves records from different sources', () => {
  const records = [
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'CEDA',
      modal_price: 2400,
      arrivals_quantity: 300,
    },
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'DATA_GOV_IN',
      modal_price: 2450,
      arrivals_quantity: 400,
    },
  ];

  // Within-source should keep both because sources differ
  const result = deduplicateWithinSource(records);
  assert.equal(result.uniqueRecords.length, 2);
  assert.equal(result.duplicatesCount, 0);
});

test('Deduplicator: cross-source mode resolves conflicts using source priority hierarchy', () => {
  const records = [
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'MOCK', // priority 10
      modal_price: 2300,
      arrivals_quantity: 500,
    },
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'CEDA', // priority 30
      modal_price: 2400,
      arrivals_quantity: 350,
    },
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'DATA_GOV_IN', // priority 40
      modal_price: 2450,
      arrivals_quantity: 300,
    },
  ];

  // Cross-source deduplication must retain the highest priority source (DATA_GOV_IN)
  const result = deduplicateCrossSource(records);
  assert.equal(result.uniqueRecords.length, 1);
  assert.equal(result.duplicatesCount, 2);
  assert.equal(result.uniqueRecords[0].source, 'DATA_GOV_IN');
  assert.equal(result.uniqueRecords[0].modal_price, 2450);
});

test('Deduplicator: cross-source resolves equal priority by arrival volume', () => {
  const records = [
    {
      mandi_code: 'MH_NSK_MAIN',
      commodity_code: 'TOMATO',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'DATA_GOV_IN', // priority 40
      modal_price: 1800,
      arrivals_quantity: 200,
    },
    {
      mandi_code: 'MH_NSK_MAIN',
      commodity_code: 'TOMATO',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'AGMARKNET', // priority 40
      modal_price: 1850,
      arrivals_quantity: 350, // higher volume
    },
  ];

  const result = deduplicateCrossSource(records);
  assert.equal(result.uniqueRecords.length, 1);
  assert.equal(result.duplicatesCount, 1);
  assert.equal(result.uniqueRecords[0].arrivals_quantity, 350);
});

test('Deduplicator: deduplicateRecords() toggles between within-source and cross-source', () => {
  const records = [
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'MOCK',
      modal_price: 2200,
    },
    {
      mandi_code: 'MH_PUNE_APMC',
      commodity_code: 'ONION',
      price_date: '2026-10-07',
      variety: 'FAQ',
      source: 'CEDA',
      modal_price: 2300,
    },
  ];

  const withinRes = deduplicateRecords(records, { crossSource: false });
  assert.equal(withinRes.uniqueRecords.length, 2);

  const crossRes = deduplicateRecords(records, { crossSource: true });
  assert.equal(crossRes.uniqueRecords.length, 1);
  assert.equal(crossRes.uniqueRecords[0].source, 'CEDA');
});

test('Deduplicator: handles empty or invalid arrays safely', () => {
  assert.equal(deduplicateRecords([]).uniqueRecords.length, 0);
  assert.equal(deduplicateRecords(null).uniqueRecords.length, 0);
  assert.equal(deduplicateWithinSource([]).uniqueRecords.length, 0);
  assert.equal(deduplicateCrossSource(null).uniqueRecords.length, 0);
});
