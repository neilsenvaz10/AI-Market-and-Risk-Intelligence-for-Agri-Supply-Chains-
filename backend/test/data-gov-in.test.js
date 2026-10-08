import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_GOV_IN_RESOURCE_ID,
  DataGovInProvider,
  datesBetween,
  priceUnitFromFieldMeta,
  toDmy,
} from '../src/pipeline/providers/data-gov-in.provider.js';
import { normalizeMandiRecord } from '../src/pipeline/normalizer.js';
import { validateMandiRecord } from '../src/pipeline/validator.js';
import { redactUrl } from '../src/pipeline/http.js';

const sampleItem = {
  state: 'Maharashtra', district: 'Pune', market: 'Pune(Moshi)', commodity: 'Onion', variety: 'Red', grade: 'FAQ',
  arrival_date: '15/09/2026', min_price: '1200', max_price: '1800', modal_price: '1500',
};

function fakeHttp(pages) {
  const calls = [];
  return {
    calls,
    async requestJson(url) {
      calls.push(url);
      const day = new URL(url).searchParams.get('filters[arrival_date]');
      const offset = Number(new URL(url).searchParams.get('offset'));
      const records = (pages[day] || []).slice(offset, offset + Number(new URL(url).searchParams.get('limit')));
      return { status: 200, data: { total: (pages[day] || []).length, records, field: [] } };
    },
  };
}

test('source is DATA_GOV_IN, never relabelled as a direct AGMARKNET fetch', () => {
  const provider = new DataGovInProvider({ apiKey: 'k' });
  const record = provider.transformRecord(sampleItem, { priceUnit: null, fetchedAt: '2026-10-08T00:00:00Z' });
  assert.equal(provider.getSourceCode(), 'DATA_GOV_IN');
  assert.equal(record.source, 'DATA_GOV_IN');
  assert.ok(provider.apiUrl.endsWith(DATA_GOV_IN_RESOURCE_ID));
});

test('records keep source values; missing arrivals stay null; unit assumption is flagged', () => {
  const provider = new DataGovInProvider({ apiKey: 'k' });
  const normalised = normalizeMandiRecord(provider.transformRecord({ ...sampleItem, min_price: '' }, { priceUnit: null }));
  assert.equal(normalised.min_price, null);
  assert.equal(normalised.arrivals_quantity, null);
  assert.equal(normalised.price_date, '2026-09-15');
  assert.equal(normalised.source_market_name, 'Pune(Moshi)');
  assert.ok(normalised.quality_flags.includes('PRICE_UNIT_FROM_PUBLISHER_CONVENTION'));
  assert.equal(validateMandiRecord(normalised, { now: new Date('2026-10-08') }).valid, true);
});

test('unit is read from response field metadata when the API provides it', () => {
  assert.equal(priceUnitFromFieldMeta([{ id: 'modal_price', name: 'Modal Price (Rs./Quintal)' }]), 'INR/quintal');
  assert.equal(priceUnitFromFieldMeta([{ id: 'modal_price', name: 'Modal_x0020_Price' }]), null);
});

test('API key is sent as the OGD query parameter but redacted in every loggable URL', () => {
  const provider = new DataGovInProvider({ apiKey: 'secret-key-123' });
  const url = provider.buildUrl({ arrivalDate: '2026-09-15', state: 'Maharashtra' });
  assert.ok(url.includes('api-key=secret-key-123'));
  assert.ok(url.includes('filters%5Barrival_date%5D=15%2F09%2F2026'));
  assert.ok(!redactUrl(url).includes('secret-key-123'));
});

test('fetchRecords walks each day of the lookback window and pages until exhausted', async () => {
  const http = fakeHttp({ '14/09/2026': [sampleItem], '15/09/2026': Array.from({ length: 3 }, () => sampleItem) });
  const provider = new DataGovInProvider({ apiKey: 'k', http });
  const records = await provider.fetchRecords({ fromDate: '2026-09-14', toDate: '2026-09-16', maxRecords: 100 });
  assert.equal(records.length, 4);
  assert.deepEqual(provider.lastFetchMeta.days, ['2026-09-14', '2026-09-15', '2026-09-16']);
});

test('fetchRecords refuses to run without a key instead of returning an empty "success"', async () => {
  await assert.rejects(new DataGovInProvider({ apiKey: '' }).fetchRecords({ fromDate: '2026-09-01', toDate: '2026-09-01' }), {
    code: 'SOURCE_NOT_CONFIGURED',
  });
});

test('date helpers', () => {
  assert.equal(toDmy('2026-09-05'), '05/09/2026');
  assert.deepEqual(datesBetween('2026-02-27', '2026-03-01'), ['2026-02-27', '2026-02-28', '2026-03-01']);
});
