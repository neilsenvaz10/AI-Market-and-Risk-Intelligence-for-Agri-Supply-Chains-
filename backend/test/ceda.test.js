/**
 * CEDA adapter. Every fixture below is a literal transcript of a shape measured live on 2026-10-09
 * (docs/phase5/source-investigation/CEDA.md): the catalogue envelope is the real flat
 * `output.data[]`, and the commodity/geography field names are the real `commodity_id` /
 * `commodity_name` / `census_*`. No network, no API key, nothing invented.
 *
 * The POST bodies the fake returns are the UNRESOLVED ones: CEDA's `/prices` and `/quantities` body
 * contract is not verified, so those calls are gated and must be opted into explicitly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCedaRecords,
  CedaClient,
  CedaContractUnverifiedError,
  CedaProvider,
  findByNameOrId,
  splitDateRange,
} from '../src/pipeline/providers/ceda.provider.js';
import { normalizeMandiRecord } from '../src/pipeline/normalizer.js';
import { validateMandiRecord } from '../src/pipeline/validator.js';

/** Fake HTTP client replaying the verified live envelopes (no network). */
function fakeCedaHttp() {
  const calls = [];
  const ok = (rows) => ({ output: { type: 'success', message: 'Data exists', data: rows } });
  const responses = {
    // GET /commodities -> 200, 453 rows, flat output.data[]
    'GET /agmarknet/commodities': ok([
      { commodity_id: 1, commodity_name: 'Wheat' },
      { commodity_id: 23, commodity_name: 'Onion' },
      { commodity_id: 24, commodity_name: 'Onion Green' },
    ]),
    // GET /geographies -> 200, 640 rows, flat output.data[], state+district per row
    'GET /agmarknet/geographies': ok([
      { census_state_id: 1, census_state_name: 'Jammu & Kashmir', census_district_id: 1, census_district_name: 'Kupwara' },
      { census_state_id: 27, census_state_name: 'Maharashtra', census_district_id: 497, census_district_name: 'Pune' },
      { census_state_id: 27, census_state_name: 'Maharashtra', census_district_id: 516, census_district_name: 'Nashik' },
    ]),
    // Contract-unverified routes. The gateway rejects every real body tried; these stand in for the
    // shape the older adapter assumed, and are reachable only behind allowUnverifiedContract.
    'POST /agmarknet/markets': { data: [{ census_state_id: 27, census_district_id: 516, market_id: 901, market_name: 'Lasalgaon' }] },
    'POST /agmarknet/prices': {
      data: [{ date: '2026-09-01', commodity_id: 23, census_state_id: 27, census_district_id: 516, market_id: 901,
        min_price: 1000, max_price: 1700, modal_price: 1450 }],
    },
    'POST /agmarknet/quantities': {
      data: [{ date: '2026-09-01', commodity_id: 23, census_state_id: 27, census_district_id: 516, market_id: 901, quantity: 812.5 }],
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

test('catalogue readers parse the verified flat output.data envelope, not the old nested shape', async () => {
  const http = fakeCedaHttp();
  const client = new CedaClient({ apiKey: 'test-key', http });
  const commodities = await client.listCommodities();
  const geographies = await client.listGeographies();

  assert.equal(http.calls[0].method, 'GET');
  assert.equal(new URL(http.calls[0].url).pathname, '/v1/agmarknet/commodities');
  assert.deepEqual(commodities, [
    { commodity_id: 1, commodity_name: 'Wheat' },
    { commodity_id: 23, commodity_name: 'Onion' },
    { commodity_id: 24, commodity_name: 'Onion Green' },
  ]);
  assert.equal(geographies.length, 3);
  assert.deepEqual(geographies[1], {
    census_state_id: 27, census_state_name: 'Maharashtra', census_district_id: 497, census_district_name: 'Pune',
  });
  for (const row of geographies) {
    assert.equal(row.districts, undefined, '/geographies rows are flat — there is no districts[] nesting');
  }
  // The disproven envelopes must never be honoured again.
  const stale = new CedaClient({
    apiKey: 'test-key',
    http: {
      async requestJson() {
        return { data: { commodities: [{ id: 3, name: 'Onion' }], geographies: [{ state_id: 27, districts: [{ district_id: 1 }] }] } };
      },
    },
  });
  assert.deepEqual(await stale.listCommodities(), []);
  assert.deepEqual(await stale.listGeographies(), []);
});

test('commodity and geography lookups use the real field names (Onion never matches Onion Green)', async () => {
  const commodities = [
    { commodity_id: 24, commodity_name: 'Onion Green' },
    { commodity_id: 23, commodity_name: 'Onion' },
  ];
  const keys = { idKey: 'commodity_id', nameKey: 'commodity_name' };
  assert.equal(findByNameOrId(commodities, 'onion', keys).commodity_id, 23);
  assert.equal(findByNameOrId(commodities, '24', keys).commodity_id, 24);
  assert.equal(findByNameOrId(commodities, 'Garlic', keys), null);

  const geographies = [
    { census_state_id: 1, census_state_name: 'Jammu & Kashmir', census_district_id: 1, census_district_name: 'Kupwara' },
    { census_state_id: 27, census_state_name: 'Maharashtra', census_district_id: 497, census_district_name: 'Pune' },
    { census_state_id: 27, census_state_name: 'Maharashtra', census_district_id: 516, census_district_name: 'Nashik' },
  ];
  const state = findByNameOrId(geographies, 'maharashtra', { idKey: 'census_state_id', nameKey: 'census_state_name' });
  assert.equal(state.census_state_id, 27);
  const districts = geographies.filter((row) => String(row.census_state_id) === String(state.census_state_id));
  assert.equal(findByNameOrId(districts, 'nashik', { idKey: 'census_district_id', nameKey: 'census_district_name' }).census_district_id, 516);
  assert.equal(findByNameOrId(districts, 'Pune', { idKey: 'census_district_id', nameKey: 'census_district_name' }).census_district_id, 497);
});

test('resolveScope reads real ids off the flat catalogues (and is blocked at the unverified /markets call)', async () => {
  const client = new CedaClient({ apiKey: 'k', http: fakeCedaHttp(), allowUnverifiedContract: true });
  const provider = new CedaProvider({ client });
  const scope = await provider.resolveScope({ commodity: 'Onion', state: 'Maharashtra', district: 'Nashik' });
  assert.equal(scope.commodityId, 23);
  assert.equal(scope.commodityName, 'Onion');
  assert.equal(scope.stateId, 27);
  assert.equal(scope.stateName, 'Maharashtra');
  assert.equal(scope.districtId, 516);
  assert.equal(scope.districtName, 'Nashik');
  assert.deepEqual(scope.markets.map((m) => m.market_id), [901]);

  const gate = new CedaProvider({ client: new CedaClient({ apiKey: 'k', http: fakeCedaHttp() }) });
  await assert.rejects(gate.resolveScope({ commodity: 'Onion', state: 'Maharashtra', district: 'Nashik' }),
    { name: 'CedaContractUnverifiedError' });
  await assert.rejects(gate.fetchRecords({ commodity: 'Onion', state: 'Maharashtra' }), /nationwide sweeps are not allowed/);
});

test('the unverified endpoints throw a typed, actionable error by default and never touch the network', async () => {
  const http = fakeCedaHttp();
  const client = new CedaClient({ apiKey: 'k', http });
  const calls = [
    ['markets', () => client.listMarkets({ commodityId: 23, stateId: 27, districtId: 516 })],
    ['prices', () => client.getPrices({ commodityId: 23, stateId: 27, districtIds: [516], fromDate: '2025-01-15', toDate: '2025-01-15' })],
    ['quantities', () => client.getQuantities({ commodityId: 23, stateId: 27, districtIds: [516], fromDate: '2025-01-15', toDate: '2025-01-15' })],
  ];
  for (const [endpoint, invoke] of calls) {
    const error = await invoke().then(() => null, (e) => e);
    assert.ok(error, `${endpoint} must not resolve by default`);
    assert.ok(error instanceof CedaContractUnverifiedError, `${endpoint} must throw CedaContractUnverifiedError`);
    assert.equal(error.name, 'CedaContractUnverifiedError');
    assert.equal(error.code, 'CEDA_CONTRACT_UNVERIFIED');
    assert.equal(error.source, 'CEDA');
    // The message itself (not only a property) carries the unresolved item, so logs show it.
    assert.match(error.message, new RegExp(`/agmarknet/${endpoint}`), `${endpoint} message names the endpoint`);
    assert.match(error.message, new RegExp(`Unresolved: [^.]*${endpoint === 'markets' ? 'POST /agmarknet/markets' : endpoint}`));
    assert.match(error.message, /request body/);
    assert.match(error.message, /allowUnverifiedContract: true/);
    assert.match(error.message, /docs\/phase5\/source-investigation\/CEDA\.md/);
    assert.match(error.message, /does not work today/);
    assert.ok(error.unresolved.includes(`POST /agmarknet/${endpoint}`), `${endpoint} error carries the unresolved item`);
    assert.ok(error.message.includes(error.unresolved), 'the unresolved item is inside the message, so it reaches logs');
  }
  assert.deepEqual(http.calls, [], 'the gate fires before any HTTP request');
});

test('allowUnverifiedContract: true opens the call path (the only way to reach it)', async () => {
  const http = fakeCedaHttp();
  const client = new CedaClient({ apiKey: 'test-key', http, allowUnverifiedContract: true });
  await client.listMarkets({ commodityId: 23, stateId: 27, districtId: 516 });
  await client.getPrices({ commodityId: 23, stateId: 27, districtIds: [516], marketIds: [901], fromDate: '2026-09-01', toDate: '2026-09-30' });
  await client.getQuantities({ commodityId: 23, stateId: 27, districtIds: [516], marketIds: [901], fromDate: '2026-09-01', toDate: '2026-09-30' });

  assert.deepEqual(http.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    'POST /v1/agmarknet/markets',
    'POST /v1/agmarknet/prices',
    'POST /v1/agmarknet/quantities',
  ]);
  for (const call of http.calls) {
    assert.equal(call.headers.Authorization, 'Bearer test-key');
    assert.ok(!call.url.includes('test-key'), 'API key must never be placed in the URL');
    assert.ok(!call.url.includes('daily-prices'), 'the non-existent legacy route must not be used');
  }
  assert.deepEqual(http.calls[0].body, { commodity_id: 23, state_id: 27, district_id: 516, indicator: 'price' });
  assert.deepEqual(http.calls[1].body, { commodity_id: 23, state_id: 27, district_id: [516], market_id: [901], from_date: '2026-09-01', to_date: '2026-09-30' });
});

test('CedaClient uses GET on the catalogue, POST on the gated routes, and the Bearer header only', async () => {
  const http = fakeCedaHttp();
  const client = new CedaClient({ apiKey: 'test-key', http, allowUnverifiedContract: true });
  await client.listCommodities();
  await client.listGeographies();

  assert.deepEqual(http.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), [
    'GET /v1/agmarknet/commodities',
    'GET /v1/agmarknet/geographies',
  ]);
  for (const call of http.calls) {
    assert.equal(call.headers.Authorization, 'Bearer test-key');
    assert.ok(!call.url.includes('test-key'), 'API key must never be placed in the URL');
    assert.ok(!call.url.includes('daily-prices'), 'the non-existent legacy route must not be used');
  }
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

test('CedaProvider fetches one bounded scope and joins prices with quantities (opt-in only)', async () => {
  const http = fakeCedaHttp();
  const provider = new CedaProvider({ client: new CedaClient({ apiKey: 'k', http, allowUnverifiedContract: true }), windowDays: 92 });
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
      { date: '2026-09-01', commodity_id: 23, market_id: 901, min_price: 1000, max_price: 1700, modal_price: 1450 },
      { date: '2026-09-02', commodity_id: 23, market_id: 901, min_price: 1000, max_price: 1700, modal_price: 1500 },
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
