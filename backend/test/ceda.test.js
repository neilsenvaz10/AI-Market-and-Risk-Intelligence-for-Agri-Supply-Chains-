import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCedaRecords,
  CedaClient,
  CedaProvider,
  findByNameOrId,
  splitDateRange,
} from '../src/pipeline/providers/ceda.provider.js';
import { normalizeMandiRecord } from '../src/pipeline/normalizer.js';
import { validateMandiRecord } from '../src/pipeline/validator.js';

/** Fake HTTP client following the official CEDA OpenAPI contract (no network). */
function fakeCedaHttp() {
  const calls = [];
  const responses = {
    'GET /agmarknet/commodities': { commodities: [{ id: 3, name: 'Onion' }, { id: 4, name: 'Onion Green' }] },
    'GET /agmarknet/geographies': {
      geographies: [{ state_id: 27, state_name: 'Maharashtra', districts: [{ district_id: 516, district_name: 'Nashik' }] }],
    },
    'POST /agmarknet/markets': { data: [{ census_state_id: 27, census_district_id: 516, market_id: 901, market_name: 'Lasalgaon' }] },
    'POST /agmarknet/prices': {
      data: [{ date: '2026-09-01', commodity_id: 3, census_state_id: 27, census_district_id: 516, market_id: 901,
        min_price: 1000, max_price: 1700, modal_price: 1450 }],
    },
    'POST /agmarknet/quantities': {
      data: [{ date: '2026-09-01', commodity_id: 3, census_state_id: 27, census_district_id: 516, market_id: 901, quantity: 812.5 }],
    },
  };
  return {
    calls,
    async requestJson(url, options) {
      const path = new URL(url).pathname.replace('/v1', '');
      calls.push({ url, ...options });
      return { status: 200, data: responses[`${options.method} ${path}`] };
    },
  };
}

test('CedaClient uses the documented endpoints, methods and Bearer header only', async () => {
  const http = fakeCedaHttp();
  const client = new CedaClient({ apiKey: 'test-key', http });
  await client.listCommodities();
  await client.listGeographies();
  await client.listMarkets({ commodityId: 3, stateId: 27, districtId: 516 });
  await client.getPrices({ commodityId: 3, stateId: 27, districtIds: [516], marketIds: [901], fromDate: '2026-09-01', toDate: '2026-09-30' });
  await client.getQuantities({ commodityId: 3, stateId: 27, districtIds: [516], marketIds: [901], fromDate: '2026-09-01', toDate: '2026-09-30' });

  assert.deepEqual(http.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    'GET /v1/agmarknet/commodities',
    'GET /v1/agmarknet/geographies',
    'POST /v1/agmarknet/markets',
    'POST /v1/agmarknet/prices',
    'POST /v1/agmarknet/quantities',
  ]);
  for (const call of http.calls) {
    assert.equal(call.headers.Authorization, 'Bearer test-key');
    assert.ok(!call.url.includes('test-key'), 'API key must never be placed in the URL');
    assert.ok(!call.url.includes('daily-prices'), 'the non-existent legacy route must not be used');
  }
  assert.deepEqual(http.calls[2].body, { commodity_id: 3, state_id: 27, district_id: 516, indicator: 'price' });
  assert.deepEqual(http.calls[3].body, { commodity_id: 3, state_id: 27, district_id: [516], market_id: [901], from_date: '2026-09-01', to_date: '2026-09-30' });
});

test('CedaClient refuses to call the API without a key (no fabricated data)', async () => {
  const client = new CedaClient({ apiKey: '', http: fakeCedaHttp() });
  await assert.rejects(client.listCommodities(), { code: 'SOURCE_NOT_CONFIGURED' });
  await assert.rejects(new CedaProvider({ apiKey: '' }).fetchRecords({}), { code: 'SOURCE_NOT_CONFIGURED' });
});

test('splitDateRange covers 2021-10-01..2026-09-30 inclusively with no gaps', () => {
  const windows = splitDateRange('2021-10-01', '2026-09-30', 92);
  assert.equal(windows[0].from, '2021-10-01');
  assert.equal(windows.at(-1).to, '2026-09-30');
  for (let i = 1; i < windows.length; i += 1) {
    const next = new Date(`${windows[i - 1].to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    assert.equal(windows[i].from, next.toISOString().slice(0, 10));
  }
  assert.deepEqual(splitDateRange('2026-09-30', '2026-09-30', 92), [{ from: '2026-09-30', to: '2026-09-30' }]);
});

test('discovery uses exact names or numeric ids (Onion never matches Onion Green)', () => {
  const items = [{ id: 4, name: 'Onion Green' }, { id: 3, name: 'Onion' }];
  assert.equal(findByNameOrId(items, 'onion', { idKey: 'id', nameKey: 'name' }).id, 3);
  assert.equal(findByNameOrId(items, '4', { idKey: 'id', nameKey: 'name' }).id, 4);
  assert.equal(findByNameOrId(items, 'Garlic', { idKey: 'id', nameKey: 'name' }), null);
});

test('CedaProvider fetches one bounded scope and joins prices with quantities', async () => {
  const http = fakeCedaHttp();
  const provider = new CedaProvider({ client: new CedaClient({ apiKey: 'k', http }), windowDays: 92 });
  const records = await provider.fetchRecords({ commodity: 'Onion', state: 'Maharashtra', district: 'Nashik', fromDate: '2026-09-01', toDate: '2026-09-30' });
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.source, 'CEDA');
  assert.equal(record.mandi_name, 'Lasalgaon');
  assert.equal(record.price_unit, 'INR/quintal');
  assert.equal(record.arrivals_quantity, 812.5);
  assert.equal(record.arrival_unit, 'tonne');
  assert.equal(record.source_market_id, '901');
  assert.equal(record.variety, null);
  await assert.rejects(provider.fetchRecords({ commodity: 'Onion', state: 'Maharashtra' }), /nationwide sweeps are not allowed/);
});

test('CEDA records normalise and validate; missing quantity stays null', () => {
  const ctx = { stateName: 'Maharashtra', districtName: 'Nashik', commodityName: 'Onion', marketNames: new Map([['901', 'Lasalgaon']]) };
  const [withQty, withoutQty] = buildCedaRecords(
    [
      { date: '2026-09-01', commodity_id: 3, market_id: 901, min_price: 1000, max_price: 1700, modal_price: 1450 },
      { date: '2026-09-02', commodity_id: 3, market_id: 901, min_price: 1000, max_price: 1700, modal_price: 1500 },
    ],
    [{ date: '2026-09-01', market_id: 901, quantity: 10 }],
    ctx
  );
  const a = normalizeMandiRecord(withQty);
  const b = normalizeMandiRecord(withoutQty);
  assert.equal(validateMandiRecord(a, { now: new Date('2026-10-08') }).valid, true);
  assert.equal(validateMandiRecord(b, { now: new Date('2026-10-08') }).valid, true);
  assert.equal(b.arrivals_quantity, null);
  assert.equal(a.price_date, '2026-09-01');
});
