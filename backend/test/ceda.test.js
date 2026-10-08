import test from 'node:test';
import assert from 'node:assert/strict';
import { CedaProvider } from '../src/pipeline/providers/ceda.provider.js';

test('CedaProvider: isConfigured() checks CEDA API key', () => {
  const provider = new CedaProvider();
  const configured = provider.isConfigured();
  assert.equal(typeof configured, 'boolean');
});

test('CedaProvider: getHistoricalBounds() defines 2021-10-01 to 2026-09-30 baseline', () => {
  const provider = new CedaProvider();
  const bounds = provider.getHistoricalBounds();
  assert.equal(bounds.startDate, '2021-10-01');
  assert.equal(bounds.endDate, '2026-09-30');
});

test('CedaProvider: fetchRecords() returns empty array gracefully when unconfigured', async () => {
  const provider = new CedaProvider();
  if (!provider.isConfigured()) {
    const records = await provider.fetchRecords({ commodity: 'Onion', state: 'Maharashtra' });
    assert.ok(Array.isArray(records));
    assert.equal(records.length, 0);
  }
});

test('CedaProvider: _buildUrl() constructs correct query URL with historical bounds', () => {
  const provider = new CedaProvider();
  const url = provider._buildUrl({
    offset: 0,
    limit: 500,
    state: 'Maharashtra',
    commodity: 'Onion',
    fromDate: '2021-10-01',
    toDate: '2022-03-31',
  });

  assert.equal(typeof url, 'string');
  assert.ok(url.includes('/agri-market/daily-prices'));
  assert.ok(url.includes('limit=500'));
  assert.ok(url.includes('Maharashtra'));
  assert.ok(url.includes('Onion'));
  assert.ok(url.includes('from_date=2021-10-01'));
  assert.ok(url.includes('to_date=2022-03-31'));
});

test('CedaProvider: _transformRecord() maps raw CEDA schema to canonical pipeline record', () => {
  const provider = new CedaProvider();
  const raw = {
    market: 'Lasalgaon APMC',
    state: 'Maharashtra',
    district: 'Nashik',
    commodity: 'Onion',
    variety: 'Red',
    grade: 'FAQ',
    date: '2022-01-15',
    min_price: '1650.00',
    max_price: '2400.00',
    modal_price: '2100.00',
    arrivals: '1250',
  };

  const transformed = provider._transformRecord(raw);
  assert.equal(transformed.mandi_name, 'Lasalgaon APMC');
  assert.equal(transformed.state, 'Maharashtra');
  assert.equal(transformed.district, 'Nashik');
  assert.equal(transformed.commodity_name, 'Onion');
  assert.equal(transformed.variety, 'Red');
  assert.equal(transformed.grade, 'FAQ');
  assert.equal(transformed.price_date, '2022-01-15');
  assert.equal(transformed.min_price, 1650);
  assert.equal(transformed.max_price, 2400);
  assert.equal(transformed.modal_price, 2100);
  assert.equal(transformed.arrivals_quantity, 1250);
  assert.equal(transformed.unit, 'quintal');
  assert.equal(transformed.source, 'CEDA');
  assert.equal(transformed.is_sample_data, false);
  assert.deepEqual(transformed.raw_payload, raw);
});
