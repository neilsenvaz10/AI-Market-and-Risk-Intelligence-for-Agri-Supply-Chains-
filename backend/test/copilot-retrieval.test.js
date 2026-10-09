/**
 * Grounded retrieval against the REAL service result shapes ({ rows, total, meta }).
 * The original Copilot tests used a hand-made fake that returned the shape the orchestrator
 * wanted, so the mismatch with MandiService (an array was expected, an object is returned)
 * was never caught and every price question threw. These tests keep that from coming back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GroundedRetrievalService } from '../src/services/copilot/groundedRetrieval.service.js';
import { MandiService } from '../src/services/mandi.service.js';
import { displayMarketName, isGenuine, todayInIndia, daysBetween } from '../src/services/copilot/freshness.js';

const NOW = () => new Date('2026-10-09T06:00:00Z'); // 11:30 in India, 9 October 2026

const PLACES = [
  { id: 1, code: 'NSK', name: 'Nashik APMC (Market 10121)', hindi_name: 'नाशिक एपीएमसी', marathi_name: 'नाशिक बाजार समिती', state: 'Maharashtra', district: 'Nashik', market_center: null },
  { id: 2, code: 'LAS', name: 'Lasalgaon APMC', hindi_name: null, marathi_name: 'लासलगाव', state: 'Maharashtra', district: 'Nashik', market_center: 'Lasalgaon' },
  { id: 3, code: 'PUN1', name: 'Pune APMC (Gultekdi)', hindi_name: null, marathi_name: null, state: 'Maharashtra', district: 'Pune', market_center: 'Gultekdi' },
  { id: 4, code: 'PUN2', name: 'Pune(Moshi)', hindi_name: null, marathi_name: null, state: 'Maharashtra', district: 'Pune', market_center: null },
  { id: 5, code: 'AZD', name: 'Azadpur', hindi_name: 'आज़ादपुर', marathi_name: null, state: 'Delhi', district: 'Delhi', market_center: null },
];

function fakePool() {
  const pool = { queries: [] };
  pool.query = async (sql) => {
    pool.queries.push(sql);
    if (/FROM mandis\s+WHERE is_active/.test(sql)) return { rows: PLACES };
    if (/SELECT name FROM commodities/.test(sql)) return { rows: [{ name: 'Onion' }, { name: 'Tomato' }] };
    return { rows: [] };
  };
  return pool;
}

const onion = { id: 1, code: 'ONION', name: 'Onion' };

/** A row exactly as MandiService.getLatestPrices / getPriceHistory shape it. */
const row = (over = {}) => ({
  id: 1, price_date: '2026-10-08', min_price: '1200.00', max_price: '1900.00', modal_price: '1650.00',
  arrivals_quantity: null, price_unit: 'INR/quintal', arrival_unit: null, variety: null, grade: null,
  source: 'CEDA', source_label: 'CEDA, Ashoka University (Agmarknet data)', is_sample_data: false, quality_flags: [],
  fetched_at: '2026-10-08T10:00:00Z', mandi_id: 1, mandi_code: 'NSK', mandi_name: 'Nashik APMC (Market 10121)',
  district: 'Nashik', state: 'Maharashtra', commodity_id: 1, commodity_code: 'ONION', commodity_name: 'Onion',
  trend_percent: 3.1, trend_direction: 'up',
  ...over,
});
const page = (rows) => ({ rows, total: rows.length, meta: {} });

function build({ latest = () => page([row()]), history = () => page([]), forecast = () => ({ available: false, reason: 'none' }) } = {}) {
  const calls = { latest: [], history: [], forecast: [] };
  const mandiService = {
    async getLatestPrices(filters) { calls.latest.push(filters); return latest(filters); },
    async getPriceHistory(filters) { calls.history.push(filters); return history(filters); },
  };
  const forecastService = { async getForecast(args) { calls.forecast.push(args); return forecast(args); } };
  const pool = fakePool();
  return { service: new GroundedRetrievalService({ pool, mandiService, forecastService, now: NOW }), calls, pool };
}

test('freshness helpers: India calendar day, day counts, provenance and tidy market names', () => {
  assert.equal(todayInIndia(new Date('2026-10-08T20:00:00Z')), '2026-10-09', 'after 5:30 pm UTC it is already tomorrow in India');
  assert.equal(daysBetween('2025-10-07', '2026-10-09'), 367);
  assert.equal(isGenuine({ source: 'CEDA', is_sample_data: false }), true);
  assert.equal(isGenuine({ source: 'MOCK_PROVIDER', is_sample_data: false }), false);
  assert.equal(isGenuine({ source: 'CEDA', is_sample_data: true }), false);
  assert.equal(isGenuine({ source: 'CEDA', quality_flags: ['SYNTHETIC_SAMPLE'] }), false);
  assert.equal(displayMarketName('Nashik APMC (Market 10121)'), 'Nashik APMC');
  assert.equal(displayMarketName('Pune APMC (Gultekdi)'), 'Pune APMC (Gultekdi)');
});

test('latest price: reads the real { rows } shape, labels age, cleans the market name', async () => {
  const { service, calls } = build();
  const result = await service.getLatestPrice({ commodity: onion, mandi: PLACES[0] });
  assert.equal(result.found, true);
  assert.equal(result.modalPrice, 1650);
  assert.equal(result.minPrice, 1200);
  assert.equal(result.priceDate, '2026-10-08');
  assert.equal(result.ageDays, 1);
  assert.equal(result.isStale, false);
  assert.equal(result.mandiName, 'Nashik APMC');
  assert.equal(result.source, 'CEDA, Ashoka University (Agmarknet data)');
  assert.equal(result.scope, 'mandi');
  assert.deepEqual(calls.latest[0], { commodity: 'ONION', includeSample: false, limit: 200, offset: 0, mandiId: 1 });
});

test('latest price: a year-old report is found but flagged as old', async () => {
  const { service } = build({ latest: () => page([row({ price_date: '2025-10-07' })]) });
  const result = await service.getLatestPrice({ commodity: onion, mandi: PLACES[0] });
  assert.equal(result.found, true);
  assert.equal(result.ageDays, 367);
  assert.equal(result.isStale, true);
});

test('latest price: a district returns every reporting market, newest first, without choosing one', async () => {
  const rows = [
    row({ mandi_id: 1, mandi_name: 'Nashik APMC (Market 10121)', price_date: '2026-10-07', modal_price: '1600.00' }),
    row({ mandi_id: 2, mandi_name: 'Lasalgaon APMC', price_date: '2026-10-08', modal_price: '1700.00' }),
    row({ mandi_id: 1, mandi_name: 'Nashik APMC (Market 10121)', price_date: '2026-10-05', modal_price: '1500.00' }),
  ];
  const { service, calls } = build({ latest: () => page(rows) });
  const result = await service.getLatestPrice({ commodity: onion, district: 'Nashik' });
  assert.equal(calls.latest[0].district, 'Nashik');
  assert.equal(calls.latest[0].mandiId, undefined);
  assert.equal(result.scope, 'district');
  assert.equal(result.mandiName, 'Lasalgaon APMC', 'the most recently reporting market leads');
  assert.equal(result.marketCount, 2);
  assert.deepEqual(result.alternatives.map((a) => [a.mandiName, a.modalPrice]), [['Nashik APMC', 1600]]);
});

test('latest price: markets that would read the same keep their market number so they can be told apart', async () => {
  const rows = [
    row({ mandi_id: 1, mandi_name: 'Nashik APMC (Market 167)', price_date: '2026-10-08', modal_price: '1700.00' }),
    row({ mandi_id: 2, mandi_name: 'Nashik APMC (Market 1801)', price_date: '2026-10-08', modal_price: '1650.00' }),
    row({ mandi_id: 3, mandi_name: 'Lasalgaon APMC', price_date: '2026-10-07', modal_price: '1600.00' }),
  ];
  const { service } = build({ latest: () => page(rows) });
  const result = await service.getLatestPrice({ commodity: onion, district: 'Nashik' });
  assert.equal(result.mandiName, 'Nashik APMC (Market 167)');
  assert.deepEqual(result.alternatives.map((a) => a.mandiName), ['Nashik APMC (Market 1801)', 'Lasalgaon APMC']);
});

test('latest price: with no place given, the newest reports across markets are returned and scoped "all"', async () => {
  const { service } = build();
  const result = await service.getLatestPrice({ commodity: onion });
  assert.equal(result.scope, 'all');
});

test('latest price: synthetic rows are never returned as prices, and sample-only data is reported as such', async () => {
  const sample = row({ source: 'MOCK_PROVIDER', is_sample_data: true });
  const { service, calls } = build({ latest: (f) => page(f.includeSample ? [sample] : []) });
  const result = await service.getLatestPrice({ commodity: onion, mandi: PLACES[0] });
  assert.equal(result.found, false);
  assert.equal(result.sampleOnly, true);
  assert.deepEqual(calls.latest.map((c) => c.includeSample), [false, true]);

  // Even if a sample row slipped through the SQL filter it would be dropped here.
  const leaky = build({ latest: () => page([sample]) });
  assert.equal((await leaky.service.getLatestPrice({ commodity: onion })).found, false);
  const none = build({ latest: () => page([]) });
  assert.equal((await none.service.getLatestPrice({ commodity: onion })).sampleOnly, undefined);
});

test('price trend: newest-first history, one value per day, honest arithmetic and age', async () => {
  const history = [
    row({ price_date: '2026-10-08', modal_price: '1650.00' }),
    row({ id: 9, price_date: '2026-10-08', modal_price: '1550.00', variety: 'Red' }), // second variety same day: averaged
    row({ price_date: '2026-10-07', modal_price: '1500.00' }),
    row({ price_date: '2026-10-05', modal_price: '1400.00' }),
    row({ price_date: '2026-10-06', modal_price: '0' }), // never treated as a price
  ];
  const { service, calls } = build({ history: () => page(history) });
  const trend = await service.getPriceTrend({ commodity: onion, mandi: PLACES[0], days: 7 });
  assert.equal(calls.history[0].order, 'DESC');
  assert.equal(calls.history[0].mandiId, 1);
  assert.equal(trend.found, true);
  assert.equal(trend.observationCount, 3);
  assert.equal(trend.endDate, '2026-10-08');
  assert.equal(trend.startDate, '2026-10-05');
  assert.equal(trend.latestModal, 1600);
  assert.equal(trend.oldestModal, 1400);
  assert.equal(trend.changePercent, 14.3);
  assert.equal(trend.direction, 'up');
  assert.equal(trend.ageDays, 1);
  assert.equal(trend.minPrice, 1400);
  assert.equal(trend.maxPrice, 1600);
});

test('price trend: needs a market or district and at least two reporting days', async () => {
  const { service } = build({ history: () => page([row()]) });
  assert.equal((await service.getPriceTrend({ commodity: onion })).found, false);
  assert.match((await service.getPriceTrend({ commodity: onion, mandi: PLACES[0] })).reason, /Insufficient/);
  assert.equal((await service.getPriceTrend({ mandi: PLACES[0] })).found, false);
});

const forecastRow = (over = {}) => ({
  forecast_date: '2026-10-10', horizon_days: 1, predicted_price: '1675.00', lower_bound: '1600.00', upper_bound: '1750.00',
  confidence: 77, interval_level: 0.8, unit: 'INR/quintal', model_version: 'v1',
  last_observed_price: '1650.00', last_observed_date: '2026-10-08', is_sample_data: false, ...over,
});

test('forecast: asks the Phase 4 service by id, excludes synthetic forecasts and reports the interval level', async () => {
  const { service, calls } = build({ forecast: () => ({ available: true, mandi: PLACES[0], forecasts: [forecastRow(), forecastRow({ horizon_days: 2, forecast_date: '2026-10-11', interval_level: 80 })] }) });
  const result = await service.getForecast({ commodity: onion, mandi: PLACES[0], horizon: null });
  assert.equal(calls.forecast[0].commodityId, 1);
  assert.equal(calls.forecast[0].mandiId, 1);
  assert.equal(calls.forecast[0].includeSample, false);
  assert.equal(result.found, true);
  assert.equal(result.forecasts[0].predictedPrice, 1675);
  assert.equal(result.forecasts[0].lowerBound, 1600);
  assert.equal(result.forecasts[0].intervalLevelPercent, 80, '0.8 becomes 80 percent');
  assert.equal(result.forecasts[1].intervalLevelPercent, 80, '80 stays 80 percent');
  assert.equal(result.forecasts[0].forecastDate, '2026-10-10');
});

test('forecast: synthetic fixtures are not shown as predictions', async () => {
  const { service, calls } = build({ forecast: (a) => (a.includeSample ? { available: true, forecasts: [forecastRow({ is_sample_data: true })] } : { available: false, reason: 'No genuine forecast' }) });
  const result = await service.getForecast({ commodity: onion, mandi: PLACES[0] });
  assert.equal(result.found, false);
  assert.equal(result.sampleOnly, true);
  assert.deepEqual(calls.forecast.map((c) => c.includeSample), [false, true]);
});

test('forecast: a district is searched market by market; no market means no forecast', async () => {
  const { service, calls } = build({ forecast: (a) => (a.mandiId === 2 ? { available: true, mandi: PLACES[1], forecasts: [forecastRow()] } : { available: false, reason: 'none' }) });
  const result = await service.getForecast({ commodity: onion, district: 'Nashik' });
  assert.equal(result.found, true);
  assert.deepEqual(calls.forecast.map((c) => c.mandiId), [1, 2]);
  assert.match((await service.getForecast({ commodity: onion })).reason, /specific market/);
});

test('place detection: a single market, English, Hindi and Marathi names', async () => {
  const { service } = build();
  assert.deepEqual((await service.detectPlace('price at Azadpur today')).mandi.id, 5);
  assert.equal((await service.detectPlace('आज़ादपुर में भाव')).mandi.id, 5);
  assert.equal((await service.detectPlace('लासलगावमध्ये कांदा')).mandi.id, 2, 'Marathi name with an inflected suffix');
  assert.equal((await service.detectPlace('Gultekdi market')).mandi.id, 3, 'market centre names work too');
});

test('place detection: a district or a name shared by several markets is a district scope, never one market', async () => {
  const { service } = build();
  const pune = await service.detectPlace('onion price in Pune');
  assert.equal(pune.kind, 'district');
  assert.equal(pune.district, 'Pune');
  assert.deepEqual(pune.mandis.map((m) => m.id), [3, 4]);
  const nashikDistrict = await service.detectPlace('prices around nashik');
  assert.equal(nashikDistrict.kind, 'mandi', 'exactly one market is called Nashik, so that market is meant');
  assert.equal(nashikDistrict.mandi.id, 1);
});

test('place detection: unknown or unrelated text finds nothing; Devanagari city names reach the Latin market list', async () => {
  const { service } = build();
  assert.equal(await service.detectPlace('hello there'), null);
  assert.equal(await service.detectPlace('price in Atlantis'), null);
  assert.equal((await service.detectPlace('नाशिकमध्ये भाव')).mandi.id, 1);
});

test('reference data is cached: the market and commodity lists are loaded once', async () => {
  const { service, pool } = build();
  await service.detectPlace('Azadpur');
  await service.detectPlace('Pune');
  await service.supportedCommodityNames();
  await service.supportedCommodityNames();
  assert.equal(pool.queries.filter((q) => /FROM mandis/.test(q)).length, 1);
  assert.equal(pool.queries.filter((q) => /FROM commodities/.test(q)).length, 1);
});

// --- the same code against the REAL MandiService, so a shape change in either side fails here.

function realMandiService(rows) {
  const pool = {
    async query(sql) {
      const withTotals = rows.map((r) => ({ ...r, total_count: String(rows.length), latest_day: r.price_date, previous_price_date: null, previous_modal_price: null }));
      return { rows: withTotals };
    },
  };
  return new MandiService({ pool, mandiConfig: {} });
}

test('integration with the real MandiService: latest price and history parse without throwing', async () => {
  const rows = [row({ price_date: '2026-10-08' }), row({ id: 2, price_date: '2026-10-07', modal_price: '1600.00' })];
  const service = new GroundedRetrievalService({ pool: fakePool(), mandiService: realMandiService(rows), forecastService: { getForecast: async () => ({ available: false }) }, now: NOW });
  const latest = await service.getLatestPrice({ commodity: onion, mandi: PLACES[0] });
  assert.equal(latest.found, true);
  assert.equal(latest.modalPrice, 1650);
  const trend = await service.getPriceTrend({ commodity: onion, mandi: PLACES[0] });
  assert.equal(trend.found, true);
  assert.equal(trend.observationCount, 2);
});
