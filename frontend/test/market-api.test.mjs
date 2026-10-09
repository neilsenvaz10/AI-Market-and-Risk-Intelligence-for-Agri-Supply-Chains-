/**
 * Unit tests for the Phase 5 market client.
 *
 * Self-contained on purpose: `frontend/` has no test runner and this file must
 * not add one (package.json is owned elsewhere). It uses Node's built-in
 * `node:test` + `node:assert/strict`, the same runner the backend uses.
 *
 *   node --test test/market-api.test.mjs      (from frontend/)
 *
 * No DOM, no React, no network: the transport is injected, so these tests
 * exercise URL/param construction, paging, row shaping, the filter cascade,
 * freshness/stale-badge derivation, day-over-day movement derivation and error
 * propagation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALERT_HISTORY_LIMITS,
  MARKET_ENDPOINTS,
  MARKET_PAGING,
  buildAlerts,
  buildQuery,
  buildUrl,
  cascadeLocations,
  compact,
  countSeriesDays,
  createMarketApi,
  deriveFreshness,
  deriveSeries,
  deriveMovements,
  deriveVarieties,
  describeError,
  latestPriceParams,
  percentChange,
  priceHistoryParams,
  shapeMandiRow,
  shapePriceResponse,
  shapePriceRow,
  withAbort,
  withPaging,
} from '../src/services/marketApi.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** A raw canonical observation exactly as `/api/mandis/prices/latest` returns it. */
function rawPriceRow(overrides = {}) {
  return {
    observation_id: 101,
    source: 'DATA_GOV_IN',
    source_label: 'data.gov.in (Agmarknet daily mandi prices)',
    source_precedence: '40',
    commodity_id: 1,
    commodity_code: 'ONION',
    commodity: 'Onion',
    commodity_category: 'Vegetables',
    mandi_id: 7,
    mandi: 'Pune APMC (Gultekdi)',
    market_code: 'MH_PUNE_APMC',
    state: 'Maharashtra',
    district: 'Pune',
    variety: 'Red',
    grade: null,
    reported_date: '2026-10-07',
    minimum_price: '1200.00',
    maximum_price: '2400.00',
    modal_price: '1980.00',
    original_price_unit: 'Rs./Quintal',
    normalized_price_unit: 'INR/quintal',
    arrival_quantity: '450.5',
    arrival_unit: 'tonnes',
    fetched_at: '2026-10-08T04:15:00.000Z',
    quality_status: 'VALID',
    quality_flags: [],
    is_sample_data: false,
    ...overrides,
  };
}

/** Records every call so the exact endpoint string and option passthrough can be asserted. */
function stubTransport(responder) {
  const calls = [];
  const request = (endpoint, options = {}) => {
    calls.push({ endpoint, options });
    return responder ? responder(endpoint, options) : Promise.resolve({ status: 'success', data: [] });
  };
  return { calls, request };
}

const asPriceResponse = (rows, meta = null, extra = {}) => ({
  status: 'success',
  count: rows.length,
  total: rows.length,
  limit: 200,
  offset: 0,
  meta,
  data: rows,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * URL / parameter building
 * ------------------------------------------------------------------ */

test('buildQuery omits blank values but keeps false and zero', () => {
  assert.equal(buildQuery({}), '');
  assert.equal(buildQuery({ commodity: undefined, variety: null, source: '' }), '');
  assert.equal(buildQuery({ includeSample: false }), '?includeSample=false');
  assert.equal(buildQuery({ offset: 0 }), '?offset=0');
});

test('buildQuery percent-encodes values exactly once', () => {
  const query = buildQuery({ district: 'Pune Rural', search: 'a&b', mandi: 'Lasalgaon/Junnar' });
  assert.equal(query, '?district=Pune+Rural&search=a%26b&mandi=Lasalgaon%2FJunnar');
  assert.equal(new URLSearchParams(query.slice(1)).get('search'), 'a&b');
  assert.equal(new URLSearchParams(query.slice(1)).get('mandi'), 'Lasalgaon/Junnar');
});

test('buildQuery encodes non-ASCII market names', () => {
  const query = buildQuery({ district: 'अहमदनगर' });
  assert.ok(query.startsWith('?district='));
  assert.ok(!query.includes('अ'), 'raw Devanagari must not leak into the query string');
  assert.equal(new URLSearchParams(query.slice(1)).get('district'), 'अहमदनगर');
});

test('buildUrl keeps the endpoint path untouched and appends the query', () => {
  assert.equal(buildUrl('/api/mandis', {}), '/api/mandis');
  assert.equal(buildUrl('/api/mandis', { state: 'Maharashtra' }), '/api/mandis?state=Maharashtra');
});

/* ------------------------------------------------------------------ *
 * Paging
 * ------------------------------------------------------------------ */

test('compact drops every blank value so a params object only lists real requests', () => {
  assert.deepEqual(
    compact({ commodity: 'ONION', variety: '', state: null, district: undefined, limit: 0 }),
    { commodity: 'ONION', limit: 0 },
  );
  assert.deepEqual(compact({}), {});
  assert.deepEqual(compact(), {});
});

test('withPaging applies the documented default limit and offset', () => {
  assert.deepEqual(withPaging({}, MARKET_PAGING.latestPrices), { limit: 200, offset: 0 });
  assert.deepEqual(withPaging({}, MARKET_PAGING.priceHistory), { limit: 1000, offset: 0 });
  assert.deepEqual(withPaging({}, MARKET_PAGING.commodities), { limit: 500, offset: 0 });
});

test('withPaging forwards in-range paging untouched', () => {
  assert.deepEqual(withPaging({ limit: 25, offset: 50 }), { limit: 25, offset: 50 });
});

test('withPaging never clamps an out-of-range value — the backend must reject it', () => {
  assert.deepEqual(withPaging({ limit: 5000 }, MARKET_PAGING.latestPrices), { limit: 5000, offset: 0 });
  assert.deepEqual(withPaging({ limit: 0 }, MARKET_PAGING.latestPrices), { limit: 0, offset: 0 });
  assert.deepEqual(withPaging({ offset: -1 }), { limit: 200, offset: -1 });
});

test('withPaging falls back when the value is not a whole number', () => {
  assert.deepEqual(withPaging({ limit: 'abc' }), { limit: 200, offset: 0 });
  assert.deepEqual(withPaging({ limit: 12.5 }), { limit: 200, offset: 0 });
  assert.deepEqual(withPaging({ limit: '25' }), { limit: 25, offset: 0 });
});

/* ------------------------------------------------------------------ *
 * Endpoint query contracts
 * ------------------------------------------------------------------ */

test('latestPriceParams maps UI filter state onto the backend contract', () => {
  const params = latestPriceParams({
    commodityCode: 'ONION',
    variety: 'Red',
    state: 'Maharashtra',
    district: 'Pune',
    mandiId: '7',
    includeSample: false,
  });
  assert.deepEqual(params, {
    commodity: 'ONION',
    variety: 'Red',
    state: 'Maharashtra',
    district: 'Pune',
    mandi: '7',
    includeSample: false,
    limit: 200,
    offset: 0,
  });
});

test('latestPriceParams omits unset filters instead of sending empty strings', () => {
  const params = latestPriceParams({ commodityCode: '', variety: null, state: undefined });
  assert.equal('variety' in params, false);
  assert.equal('state' in params, false);
  assert.equal('commodity' in params, false);
});

test('latestPriceParams leaves includeSample off unless explicitly chosen', () => {
  assert.equal('includeSample' in latestPriceParams({}), false);
  assert.equal(latestPriceParams({ includeSample: true }).includeSample, true);
});

test('priceHistoryParams adds the date range and normalises order', () => {
  const params = priceHistoryParams({
    commodityCode: 'ONION',
    startDate: '2026-09-01',
    endDate: '2026-10-07',
    order: 'desc',
  });
  assert.equal(params.startDate, '2026-09-01');
  assert.equal(params.endDate, '2026-10-07');
  assert.equal(params.order, 'DESC');
});

test('priceHistoryParams rejects an unknown order back to the documented default', () => {
  assert.equal(priceHistoryParams({ order: 'SIDEWAYS' }).order, 'ASC');
  assert.equal(priceHistoryParams({}).order, 'ASC');
});

/* ------------------------------------------------------------------ *
 * Endpoint calls
 * ------------------------------------------------------------------ */

test('getLatestPrices requests the plural Phase 5 endpoint with encoded filters', async () => {
  const stub = stubTransport(() => Promise.resolve(asPriceResponse([rawPriceRow()])));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getLatestPrices({ commodityCode: 'ONION', state: 'Maharashtra' });

  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].endpoint, '/api/mandis/prices/latest?commodity=ONION&state=Maharashtra&limit=200&offset=0');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].commodity.code, 'ONION');
});

test('each client method hits its own Phase 5 endpoint', async () => {
  const stub = stubTransport(() => Promise.resolve({ status: 'success', data: [] }));
  const api = createMarketApi({ request: stub.request });

  await api.getCommodities();
  await api.getMandis({ state: 'Maharashtra' });
  await api.getLatestPrices();
  await api.getPriceHistory();
  await api.getDataStatus();

  assert.deepEqual(stub.calls.map((call) => call.endpoint), [
    '/api/commodities?limit=500&offset=0',
    '/api/mandis?state=Maharashtra&limit=500&offset=0',
    '/api/mandis/prices/latest?limit=200&offset=0',
    '/api/mandis/prices/history?limit=1000&offset=0&order=ASC',
    '/api/mandis/data-status',
  ]);
});

test('data-status is called with no query string because the endpoint rejects parameters', async () => {
  const stub = stubTransport(() => Promise.resolve({ status: 'success', data: { overall: { stale: false } } }));
  const api = createMarketApi({ request: stub.request });

  const status = await api.getDataStatus();

  assert.ok(!stub.calls[0].endpoint.includes('?'));
  assert.equal(status.overall.stale, false);
});

test('data-status unwraps the single-object data envelope', async () => {
  const stub = stubTransport(() => Promise.resolve({
    status: 'success',
    data: {
      overall: { total_observations: 42, latest_reported_date: '2026-10-07', stale: false, staleness_days: 0, staleness_threshold_days: 3 },
      sources: [{ code: 'DATA_GOV_IN' }],
    },
  }));
  const api = createMarketApi({ request: stub.request });

  const status = await api.getDataStatus();

  assert.equal(status.overall.total_observations, 42);
  assert.equal(status.sources[0].code, 'DATA_GOV_IN');
});

test('the endpoint map is the plural Phase 5 surface, not the legacy /api/mandi routes', () => {
  assert.deepEqual(MARKET_ENDPOINTS, {
    commodities: '/api/commodities',
    mandis: '/api/mandis',
    latestPrices: '/api/mandis/prices/latest',
    priceHistory: '/api/mandis/prices/history',
    dataStatus: '/api/mandis/data-status',
  });
});

/* ------------------------------------------------------------------ *
 * Empty results — HTTP 200 with data: [] is success, not failure
 * ------------------------------------------------------------------ */

test('an empty result is a successful empty page, never a fabricated row', async () => {
  const stub = stubTransport(() => Promise.resolve({ status: 'success', count: 0, total: 0, limit: 200, offset: 0, meta: null, data: [] }));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getLatestPrices({ commodityCode: 'ONION' });

  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 0);
  assert.equal(result.count, 0);
  assert.equal(result.status, 'success');
});

test('a missing data array is treated as empty rather than crashing', async () => {
  const result = shapePriceResponse({ status: 'success' });
  assert.deepEqual(result.rows, []);
  assert.equal(result.total, 0);
});

test('a non-array data payload yields no rows instead of throwing', async () => {
  const result = shapePriceResponse({ status: 'success', data: { nope: true }, total: 3 });
  assert.deepEqual(result.rows, []);
  assert.equal(result.total, 3);
});

/* ------------------------------------------------------------------ *
 * Error propagation
 * ------------------------------------------------------------------ */

test('the backend ApiError reaches the caller with status, code, message and details intact', async () => {
  const apiError = Object.assign(new Error('One or more request parameters are invalid.'), {
    name: 'ApiError',
    status: 400,
    code: 'VALIDATION_ERROR',
    details: [{ field: 'limit', message: 'limit must be between 1 and 200' }],
  });
  const stub = stubTransport(() => Promise.reject(apiError));
  const api = createMarketApi({ request: stub.request });

  const error = await api.getLatestPrices({ limit: 5000 }).then(
    () => assert.fail('a 400 must reject, never resolve with a fallback page'),
    (err) => err,
  );

  assert.equal(error, apiError);
  assert.equal(error.status, 400);
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.deepEqual(error.details[0], { field: 'limit', message: 'limit must be between 1 and 200' });
});

test('a 503 DATABASE_NOT_MIGRATED is surfaced, not disguised as an empty feed', async () => {
  const apiError = Object.assign(new Error('mandi_prices_canonical is missing'), {
    status: 503,
    code: 'DATABASE_NOT_MIGRATED',
  });
  const stub = stubTransport(() => Promise.reject(apiError));
  const api = createMarketApi({ request: stub.request });

  await assert.rejects(() => api.getLatestPrices(), (err) => err.code === 'DATABASE_NOT_MIGRATED');
});

test('a transport failure rejects with NETWORK_ERROR status 0', async () => {
  const apiError = Object.assign(new Error('Cannot reach the FASALYTICS server.'), { status: 0, code: 'NETWORK_ERROR' });
  const stub = stubTransport(() => Promise.reject(apiError));
  const api = createMarketApi({ request: stub.request });

  await assert.rejects(() => api.getDataStatus(), (err) => {
    assert.equal(err.status, 0);
    assert.equal(err.code, 'NETWORK_ERROR');
    return true;
  });
});

test('describeError keeps the real backend message renderable and flags its kind', () => {
  const validation = describeError(Object.assign(new Error('One or more request parameters are invalid.'), {
    status: 400,
    code: 'VALIDATION_ERROR',
    details: [{ field: 'startDate', message: 'startDate must be a real date in YYYY-MM-DD format' }],
  }));
  assert.equal(validation.isValidation, true);
  assert.equal(validation.message, 'One or more request parameters are invalid.');
  assert.equal(validation.details[0].field, 'startDate');

  assert.equal(describeError({ status: 503, code: 'DATABASE_UNAVAILABLE', message: 'db down' }).isUnavailable, true);
  assert.equal(describeError({ status: 0, code: 'NETWORK_ERROR', message: 'offline' }).isNetwork, true);
  assert.equal(describeError(null), null);
  assert.equal(describeError(new Error('boom')).message, 'boom');
});

/* ------------------------------------------------------------------ *
 * AbortSignal passthrough
 * ------------------------------------------------------------------ */

test('an AbortSignal is forwarded to the transport', async () => {
  const controller = new AbortController();
  const stub = stubTransport(() => Promise.resolve(asPriceResponse([])));
  const api = createMarketApi({ request: stub.request });

  await api.getLatestPrices({}, { signal: controller.signal });

  assert.equal(stub.calls[0].options.signal, controller.signal);
});

test('no signal means no options object is passed to the transport', async () => {
  const stub = stubTransport(() => Promise.resolve(asPriceResponse([])));
  const api = createMarketApi({ request: stub.request });

  await api.getLatestPrices();

  assert.deepEqual(stub.calls[0].options, {});
});

test('aborting rejects the caller immediately instead of committing a stale page', async () => {
  const controller = new AbortController();
  const stub = stubTransport(() => new Promise(() => {})); // never settles
  const api = createMarketApi({ request: stub.request });

  const pending = api.getLatestPrices({}, { signal: controller.signal });
  controller.abort();

  await assert.rejects(pending, (err) => err.name === 'AbortError');
});

test('an already-aborted signal rejects without calling the transport', async () => {
  const controller = new AbortController();
  controller.abort();
  const stub = stubTransport(() => Promise.resolve(asPriceResponse([])));
  const api = createMarketApi({ request: stub.request });

  await assert.rejects(() => api.getLatestPrices({}, { signal: controller.signal }), (err) => err.name === 'AbortError');
  assert.equal(stub.calls.length, 0);
});

test('withAbort resolves normally when the signal never fires', async () => {
  const controller = new AbortController();
  assert.equal(await withAbort(Promise.resolve('ok'), controller.signal), 'ok');
  assert.equal(await withAbort(Promise.resolve('no-signal'), undefined), 'no-signal');
});

test('withAbort passes the original rejection through unchanged', async () => {
  const controller = new AbortController();
  const boom = new Error('boom');
  await assert.rejects(() => withAbort(Promise.reject(boom), controller.signal), (err) => err === boom);
});

/* ------------------------------------------------------------------ *
 * Row shaping
 * ------------------------------------------------------------------ */

test('a canonical price row is shaped with numbers, a real isSampleData flag and its raw source', () => {
  const row = shapePriceRow(rawPriceRow());

  assert.equal(row.id, 101);
  assert.deepEqual(row.commodity, { id: 1, code: 'ONION', name: 'Onion', category: 'Vegetables' });
  assert.deepEqual(row.mandi, { id: 7, name: 'Pune APMC (Gultekdi)', code: 'MH_PUNE_APMC', district: 'Pune', state: 'Maharashtra' });
  assert.equal(row.reportedDate, '2026-10-07');
  assert.deepEqual(row.prices, {
    min: 1200,
    modal: 1980,
    max: 2400,
    unit: 'INR/quintal',
    originalUnit: 'Rs./Quintal',
  });
  assert.equal(row.arrivals.quantity, 450.5);
  assert.equal(row.fetchedAt, '2026-10-08T04:15:00.000Z');
  assert.equal(row.isSampleData, false);
  assert.equal(row.source.code, 'DATA_GOV_IN');
});

test('row shaping keeps missing values as null instead of zero', () => {
  const row = shapePriceRow(rawPriceRow({
    minimum_price: null,
    maximum_price: null,
    modal_price: null,
    arrival_quantity: null,
    variety: null,
    grade: null,
  }));

  assert.equal(row.prices.min, null);
  assert.equal(row.prices.modal, null);
  assert.equal(row.prices.max, null);
  assert.equal(row.arrivals.quantity, null);
  assert.equal(row.variety, null);
  assert.notEqual(row.arrivals.quantity, 0);
});

test('sample rows are flagged so the UI can never present them as genuine', () => {
  const row = shapePriceRow(rawPriceRow({ is_sample_data: true, source: 'MOCK_PROVIDER' }));
  assert.equal(row.isSampleData, true);
  assert.equal(row.source.code, 'MOCK_PROVIDER');
});

test('shaping tolerates junk without throwing', () => {
  assert.equal(shapePriceRow(null), null);
  assert.equal(shapePriceRow('nope'), null);
  assert.equal(shapeMandiRow(undefined), null);
});

test('a market row is shaped with its id, published code and geography', () => {
  const row = shapeMandiRow({
    mandi_id: 7,
    market_code: 'MH_PUNE_APMC',
    mandi: 'Pune APMC (Gultekdi)',
    state: 'Maharashtra',
    district: 'Pune',
    commodity_count: '4',
    observation_count: '128',
    earliest_reported_date: '2024-01-01',
    latest_reported_date: '2026-10-07',
  });

  assert.equal(row.id, 7);
  assert.equal(row.code, 'MH_PUNE_APMC');
  assert.equal(row.observationCount, 128);
  assert.equal(row.latestReportedDate, '2026-10-07');
});

/* ------------------------------------------------------------------ *
 * Freshness / stale-badge derivation — backend fields only
 * ------------------------------------------------------------------ */

test('freshness comes from the backend, never from a client-side threshold', () => {
  const meta = { genuine_rows: 4, sample_rows: 1, stale_days: 5, latest_genuine_reporting_date: '2026-10-07' };
  const status = { overall: { stale: true, staleness_days: 5, staleness_threshold_days: 3, latest_reported_date: '2026-10-07' } };

  const freshness = deriveFreshness(meta, status);

  assert.equal(freshness.pageAgeDays, 5);
  assert.equal(freshness.isStale, true);
  assert.equal(freshness.globalThresholdDays, 3);
  assert.equal(freshness.globalLatestReportedDate, '2026-10-07');
  assert.equal(freshness.pageSampleRows, 1);
});

test('a feed the backend calls fresh is reported as not stale', () => {
  const freshness = deriveFreshness({ stale_days: 0 }, { overall: { stale: false, staleness_days: 0, staleness_threshold_days: 3 } });
  assert.equal(freshness.isStale, false);
  assert.equal(freshness.pageAgeDays, 0);
});

test('no verdict is invented when data-status is unavailable — isStale stays null', () => {
  const freshness = deriveFreshness({ stale_days: 9 }, null);
  assert.equal(freshness.isStale, null);
  assert.equal(freshness.pageAgeDays, 9);
  assert.equal(freshness.globalThresholdDays, null);
});

test('an empty feed reports unknown freshness rather than a fake zero age', () => {
  const freshness = deriveFreshness({ genuine_rows: 0, sample_rows: 0, stale_days: null }, { overall: { stale: true, staleness_threshold_days: 3 } });
  assert.equal(freshness.pageAgeDays, null);
  assert.equal(freshness.isStale, true);
  assert.equal(freshness.pageGenuineRows, 0);
});

test('deriveFreshness tolerates both inputs being absent', () => {
  const freshness = deriveFreshness();
  assert.equal(freshness.isStale, null);
  assert.equal(freshness.pageAgeDays, null);
  assert.deepEqual(freshness.sources, []);
});

/* ------------------------------------------------------------------ *
 * Filter cascade
 * ------------------------------------------------------------------ */

const MARKETS = [
  shapeMandiRow({ mandi_id: 1, market_code: 'MH_PUNE_APMC', mandi: 'Pune APMC', state: 'Maharashtra', district: 'Pune' }),
  shapeMandiRow({ mandi_id: 2, market_code: 'MH_NSK_MAIN', mandi: 'Nashik Market Yard', state: 'Maharashtra', district: 'Nashik' }),
  shapeMandiRow({ mandi_id: 3, market_code: 'MH_AHM_APMC', mandi: 'Ahmednagar Mandi', state: 'Maharashtra', district: 'Ahmednagar' }),
  shapeMandiRow({ mandi_id: 4, market_code: 'KA_HUB_APMC', mandi: 'Hubli APMC', state: 'Karnataka', district: 'Dharwad' }),
];

test('the cascade lists every state and district when nothing is selected', () => {
  const cascade = cascadeLocations(MARKETS, {});
  assert.deepEqual(cascade.states, ['Karnataka', 'Maharashtra']);
  assert.deepEqual(cascade.districts, ['Ahmednagar', 'Dharwad', 'Nashik', 'Pune']);
  assert.equal(cascade.mandis.length, 4);
  assert.equal(cascade.selectedMandi, null);
});

test('choosing a state narrows the districts to that state only', () => {
  const cascade = cascadeLocations(MARKETS, { state: 'Maharashtra' });
  assert.deepEqual(cascade.districts, ['Ahmednagar', 'Nashik', 'Pune']);
  assert.equal(cascade.mandis.length, 3);
  assert.equal(cascade.mandis.some((m) => m.state === 'Karnataka'), false);
});

test('choosing a district narrows the markets inside that state', () => {
  const cascade = cascadeLocations(MARKETS, { state: 'Maharashtra', district: 'Nashik' });
  assert.deepEqual(cascade.districts, ['Ahmednagar', 'Nashik', 'Pune']);
  assert.deepEqual(cascade.mandis.map((m) => m.code), ['MH_NSK_MAIN']);
});

test('the cascade matches state and district case-insensitively', () => {
  const cascade = cascadeLocations(MARKETS, { state: 'maharashtra', district: 'nashik' });
  assert.deepEqual(cascade.mandis.map((m) => m.code), ['MH_NSK_MAIN']);
});

test('a selection that matches nothing yields an empty, honest list', () => {
  const cascade = cascadeLocations(MARKETS, { state: 'Kerala' });
  assert.deepEqual(cascade.districts, []);
  assert.deepEqual(cascade.mandis, []);
});

test('selectedMandi resolves the chosen market for the price query', () => {
  const cascade = cascadeLocations(MARKETS, { state: 'Maharashtra', district: 'Pune', mandiId: '1' });
  assert.equal(cascade.selectedMandi.code, 'MH_PUNE_APMC');
});

test('the cascade dedupes markets that appear twice in the list', () => {
  const duplicated = [...MARKETS, shapeMandiRow({ mandi_id: 1, market_code: 'MH_PUNE_APMC', mandi: 'Pune APMC', state: 'Maharashtra', district: 'Pune' })];
  assert.equal(cascadeLocations(duplicated, {}).mandis.length, 4);
});

test('the cascade survives an empty or missing market list', () => {
  assert.deepEqual(cascadeLocations([], {}), { states: [], districts: [], mandis: [], selectedMandi: null });
  assert.deepEqual(cascadeLocations(undefined, {}).states, []);
});

test('variety options are distinct, sorted and case-deduped', () => {
  const rows = [
    shapePriceRow(rawPriceRow({ variety: 'Red' })),
    shapePriceRow(rawPriceRow({ variety: 'Bell' })),
    shapePriceRow(rawPriceRow({ variety: 'red' })),
    shapePriceRow(rawPriceRow({ variety: null })),
  ];
  assert.deepEqual(deriveVarieties(rows), ['Bell', 'Red']);
  assert.deepEqual(deriveVarieties([]), []);
});

/* ------------------------------------------------------------------ *
 * Day-over-day movement
 * ------------------------------------------------------------------ */

test('percentChange computes a signed, one-decimal percentage', () => {
  assert.equal(percentChange(100, 110), 10);
  assert.equal(percentChange(100, 90), -10);
  assert.equal(percentChange(1980, 2000), 1);
  assert.equal(percentChange(2000, 1980), -1);
});

test('percentChange returns null rather than 0 when it cannot be computed', () => {
  assert.equal(percentChange(null, 100), null);
  assert.equal(percentChange(100, null), null);
  assert.equal(percentChange(undefined, undefined), null);
  assert.equal(percentChange(0, 100), null, 'a zero base has no meaningful percentage');
  assert.equal(percentChange('abc', 100), null);
});

test('movement compares each series with its own previous reporting day', () => {
  const rows = [
    shapePriceRow(rawPriceRow({ observation_id: 1, reported_date: '2026-10-06', modal_price: '1000.00', arrival_quantity: '400.0' })),
    shapePriceRow(rawPriceRow({ observation_id: 2, reported_date: '2026-10-07', modal_price: '1100.00', arrival_quantity: '480.0' })),
  ];

  const [movement] = deriveMovements(rows);

  assert.equal(movement.previousReportedDate, '2026-10-06');
  assert.equal(movement.reportedDate, '2026-10-07');
  assert.deepEqual(movement.price, { previous: 1000, current: 1100, percent: 10 });
  assert.deepEqual(movement.arrivals, { previous: 400, current: 480, percent: 20 });
  assert.equal(movement.isSampleData, false);
});

test('a series with a single reporting day produces no movement', () => {
  assert.deepEqual(deriveMovements([shapePriceRow(rawPriceRow())]), []);
  assert.deepEqual(deriveMovements([]), []);
});

test('two observations on the SAME day are collapsed, never compared as a movement', () => {
  const rows = [
    shapePriceRow(rawPriceRow({ observation_id: 1, reported_date: '2026-10-07', modal_price: '1000.00' })),
    shapePriceRow(rawPriceRow({ observation_id: 2, reported_date: '2026-10-07', modal_price: '1500.00' })),
  ];
  assert.deepEqual(deriveMovements(rows), []);
});

test('different varieties of the same crop in the same market are separate series', () => {
  const rows = [
    shapePriceRow(rawPriceRow({ observation_id: 1, variety: 'Red', reported_date: '2026-10-06', modal_price: '1000.00' })),
    shapePriceRow(rawPriceRow({ observation_id: 2, variety: 'Red', reported_date: '2026-10-07', modal_price: '1200.00' })),
    shapePriceRow(rawPriceRow({ observation_id: 3, variety: 'Bell', reported_date: '2026-10-07', modal_price: '900.00' })),
  ];

  const movements = deriveMovements(rows);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].variety, 'Red');
  assert.equal(movements[0].price.percent, 20);
});

test('out-of-order history rows are sorted before the comparison', () => {
  const rows = [
    shapePriceRow(rawPriceRow({ observation_id: 2, reported_date: '2026-10-07', modal_price: '1100.00' })),
    shapePriceRow(rawPriceRow({ observation_id: 1, reported_date: '2026-10-05', modal_price: '1000.00' })),
    shapePriceRow(rawPriceRow({ observation_id: 3, reported_date: '2026-10-06', modal_price: '1050.00' })),
  ];

  const [movement] = deriveMovements(rows);
  assert.equal(movement.previousReportedDate, '2026-10-06');
  assert.equal(movement.price.previous, 1050);
});

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

function movementsFrom(specs) {
  return specs.map((spec) => {
    const [previousDate, latestDate, previousPrice, latestPrice, previousArrivals, latestArrivals] = spec;
    return deriveMovements([
      shapePriceRow(rawPriceRow({ observation_id: 1, reported_date: previousDate, modal_price: String(previousPrice), arrival_quantity: String(previousArrivals) })),
      shapePriceRow(rawPriceRow({ observation_id: 2, reported_date: latestDate, modal_price: String(latestPrice), arrival_quantity: String(latestArrivals) })),
    ])[0];
  });
}

test('alerts are ranked by the size of the move, largest first', () => {
  const movements = movementsFrom([
    ['2026-10-06', '2026-10-07', 1000, 1010, 100, 100],
    ['2026-10-06', '2026-10-07', 1000, 1300, 100, 100],
    ['2026-10-06', '2026-10-07', 1000, 900, 100, 100],
  ]);

  const alerts = buildAlerts(movements);

  assert.equal(alerts.length, 3);
  assert.equal(alerts[0].price.percent, 30);
  assert.equal(alerts[1].price.percent, -10);
  assert.equal(alerts[2].price.percent, 1);
});

test('an alert names the driver and its direction', () => {
  const [up] = buildAlerts(movementsFrom([['2026-10-06', '2026-10-07', 1000, 1200, 100, 100]]));
  assert.equal(up.driver, 'price');
  assert.equal(up.direction, 'up');
  assert.equal(up.percent, 20);

  const [down] = buildAlerts(movementsFrom([['2026-10-06', '2026-10-07', 1200, 1000, 100, 100]]));
  assert.equal(down.direction, 'down');

  const [arrivals] = buildAlerts(movementsFrom([['2026-10-06', '2026-10-07', 1000, 1010, 100, 220]]));
  assert.equal(arrivals.driver, 'arrivals');
  assert.equal(arrivals.direction, 'up');
});

test('an alert carries the real market, commodity, dates and source', () => {
  const [alert] = buildAlerts(movementsFrom([['2026-10-06', '2026-10-07', 1000, 1200, 100, 100]]));
  assert.equal(alert.mandi.name, 'Pune APMC (Gultekdi)');
  assert.equal(alert.commodity.name, 'Onion');
  assert.equal(alert.reportedDate, '2026-10-07');
  assert.equal(alert.previousReportedDate, '2026-10-06');
  assert.equal(alert.source.code, 'DATA_GOV_IN');
  assert.equal(alert.isSampleData, false);
});

test('the alert list honours its limit', () => {
  const movements = movementsFrom([
    ['2026-10-06', '2026-10-07', 1000, 1100, 100, 100],
    ['2026-10-06', '2026-10-07', 1000, 1200, 100, 100],
    ['2026-10-06', '2026-10-07', 1000, 1300, 100, 100],
  ]);
  assert.equal(buildAlerts(movements, { limit: 2 }).length, 2);
  assert.equal(buildAlerts(movements, { limit: 0 }).length, 0);
  assert.equal(buildAlerts(movements, { limit: -5 }).length, 0);
});

test('a series with no computable change is dropped instead of shown as 0%', () => {
  const movements = deriveMovements([
    shapePriceRow(rawPriceRow({ observation_id: 1, reported_date: '2026-10-06', modal_price: null, arrival_quantity: null })),
    shapePriceRow(rawPriceRow({ observation_id: 2, reported_date: '2026-10-07', modal_price: null, arrival_quantity: 0 })),
  ]);

  assert.equal(movements.length, 1);
  assert.equal(movements[0].price.percent, null);
  assert.equal(movements[0].arrivals.percent, null);
  assert.deepEqual(buildAlerts(movements), []);
});

test('a genuine 0% change is kept and reported as flat, not dropped', () => {
  const [alert] = buildAlerts(movementsFrom([['2026-10-06', '2026-10-07', 1000, 1000, 100, 100]]));
  assert.equal(alert.percent, 0);
  assert.equal(alert.direction, 'flat');
});

test('no movements means no alerts, so the page renders an empty state', () => {
  assert.deepEqual(buildAlerts([]), []);
  assert.deepEqual(buildAlerts(undefined), []);
});

/* ------------------------------------------------------------------ *
 * Page-level shape: Mandis / Home feed
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Alert history — assembled per series
 * ------------------------------------------------------------------ */

/**
 * A dataset whose rows are shaped like the real canonical table: several series,
 * each with its own reporting days, all sharing the newest day. This is the shape
 * that broke AlertsPage — one globally-paginated history page returns the newest
 * 1000 rows, which are all the newest day, so every series appears exactly once.
 */
function dataset(series, { newestDay = '2026-10-07' } = {}) {
  // `observation_id` is globally unique in the canonical table, so the fixture
  // numbers it that way too — a per-series counter would make two different
  // observations look like one.
  let nextId = 1;
  const rows = series.flatMap((entry) =>
    entry.days.map((day, index) => rawPriceRow({
      observation_id: nextId++,
      commodity_id: entry.commodityId,
      commodity_code: entry.commodityCode,
      commodity: entry.commodityName ?? entry.commodityCode,
      mandi_id: entry.mandiId,
      mandi: entry.mandiName ?? `Mandi ${entry.mandiId}`,
      variety: entry.variety ?? null,
      reported_date: day,
      modal_price: String(entry.prices[index] ?? 1000 + index),
      arrival_quantity: String(entry.arrivals?.[index] ?? 100 + index),
    })));
  const byDayDesc = [...rows].sort((a, b) => b.reported_date.localeCompare(a.reported_date));
  return { rows, rowsNewestFirst: byDayDesc, newestDay };
}

/**
 * A transport that behaves like the real backend: `/prices/latest` returns the
 * newest row per (mandi, commodity, variety); `/prices/history` filters first and
 * only then applies its GLOBAL date-ordered LIMIT/OFFSET window.
 */
function backendTransport(datasetRows) {
  return (endpoint) => {
    const query = new URLSearchParams(endpoint.includes('?') ? endpoint.slice(endpoint.indexOf('?') + 1) : '');
    const limit = Number(query.get('limit') ?? 100);
    const offset = Number(query.get('offset') ?? 0);
    const matches = (row) => {
      const mandi = query.get('mandi');
      const commodity = query.get('commodity');
      const variety = query.get('variety');
      const endDate = query.get('endDate');
      if (mandi && String(row.mandi_id) !== mandi) return false;
      if (commodity && row.commodity_code !== commodity) return false;
      if (variety && row.variety !== variety) return false;
      if (endDate && row.reported_date > endDate) return false;
      return true;
    };

    if (endpoint.startsWith('/api/mandis/prices/latest')) {
      const newest = new Map();
      for (const row of datasetRows) {
        const key = `${row.mandi_id}|${row.commodity_id}|${row.variety ?? ''}`;
        const existing = newest.get(key);
        if (!existing || row.reported_date > existing.reported_date) newest.set(key, row);
      }
      const data = [...newest.values()];
      return Promise.resolve({
        status: 'success', count: data.length, total: data.length, limit, offset, data,
        meta: { genuine_rows: data.length, sample_rows: 0, stale_days: 0, latest_genuine_reporting_date: data[0]?.reported_date ?? null },
      });
    }

    if (endpoint.startsWith('/api/mandis/prices/history')) {
      const filtered = datasetRows.filter(matches);
      const page = [...filtered].sort((a, b) => b.reported_date.localeCompare(a.reported_date)).slice(offset, offset + limit);
      return Promise.resolve({
        status: 'success', count: page.length, total: filtered.length, limit, offset, order: query.get('order'), data: page,
        meta: { genuine_rows: page.length, sample_rows: 0, stale_days: 0 },
      });
    }

    return Promise.reject(Object.assign(new Error(`unexpected ${endpoint}`), { status: 404, code: 'NOT_FOUND' }));
  };
}

/** The (mandi, commodity) identity of a shaped row, as the movement grouper sees it. */
const movementTestKey = (row) => [row.mandi.id, row.commodity.code, row.variety ?? ''].join('|');

const ONION_PUNE = { commodityId: 1, commodityCode: 'ONION', mandiId: 7, variety: 'Red', days: ['2026-10-05', '2026-10-06', '2026-10-07'], prices: [1000, 1050, 1200] };
const TOMATO_PUNE = { commodityId: 2, commodityCode: 'TOMATO', mandiId: 7, variety: null, days: ['2026-10-06', '2026-10-07'], prices: [900, 780] };
const ONION_NASHIK = { commodityId: 1, commodityCode: 'ONION', mandiId: 8, variety: 'Red', days: ['2026-10-07'], prices: [1400] };

/** Enough series that the newest reporting day alone overflows one 1000-row page. */
const BULK_SERIES = Array.from({ length: 1200 }, (_, index) => ({
  commodityId: 1000 + index,
  commodityCode: `CROP${index}`,
  mandiId: 7,
  variety: 'Red',
  days: ['2026-10-05', '2026-10-06', '2026-10-07'],
  prices: [1000, 1000 + (index % 50), 1000 + index % 90],
}));

test('REGRESSION: one globally-paginated history page yields no movement at all', async () => {
  const { rows } = dataset(BULK_SERIES);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  // The old AlertsPage call: a single unfiltered page of the newest 1000 rows.
  const page = await api.getPriceHistory({ order: 'ASC' });

  assert.equal(page.rows.length, 1000);
  assert.equal(new Set(page.rows.map((row) => row.reportedDate)).size, 1, 'the page is one reporting day');
  assert.equal(new Set(page.rows.map((row) => movementTestKey(row))).size, 1000, 'every series appears exactly once');
  assert.deepEqual(deriveMovements(page.rows), [], 'no series can be compared, so no movement exists');
  assert.deepEqual(buildAlerts(deriveMovements(page.rows)), [], 'the page renders the empty state');
});

test('REGRESSION: the same bulk dataset still yields movements when read per series', async () => {
  const { rows } = dataset(BULK_SERIES);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getAlertHistory();

  assert.equal(deriveMovements(result.rows).length, ALERT_HISTORY_LIMITS.maxSeries);
  assert.equal(result.coverage.truncated, true, '1190 of 1200 series are not examined and that is stated');
  assert.equal(result.coverage.seriesComparable, ALERT_HISTORY_LIMITS.maxSeries);
  assert.equal(buildAlerts(deriveMovements(result.rows), { limit: 5 }).length, 5);
});

test('REGRESSION: reading history per series still produces the movements', async () => {
  const { rows } = dataset([ONION_PUNE, TOMATO_PUNE, ONION_NASHIK]);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getAlertHistory();
  const movements = deriveMovements(result.rows);

  assert.equal(movements.length, 2, 'the two series with a previous day both produce a movement');
  const onion = movements.find((m) => m.commodity.code === 'ONION' && m.mandi.id === 7);
  assert.equal(onion.price.previous, 1050);
  assert.equal(onion.price.current, 1200);
  assert.equal(onion.price.percent, 14.3);
  assert.equal(onion.previousReportedDate, '2026-10-06');
  const tomato = movements.find((m) => m.commodity.code === 'TOMATO');
  assert.equal(tomato.price.percent, -13.3);
  assert.deepEqual(buildAlerts(movements, { limit: 5 }).map((a) => a.direction), ['up', 'down']);
});

test('getAlertHistory resolves the series once, then reads one small page per series', async () => {
  const { rows } = dataset([ONION_PUNE, TOMATO_PUNE, ONION_NASHIK]);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getAlertHistory();

  assert.deepEqual(stub.calls.map((call) => call.endpoint), [
    '/api/mandis/prices/latest?limit=200&offset=0',
    '/api/mandis/prices/history?commodity=ONION&variety=Red&mandi=7&limit=6&offset=0&endDate=2026-10-07&order=DESC',
    '/api/mandis/prices/history?commodity=TOMATO&mandi=7&limit=6&offset=0&endDate=2026-10-07&order=DESC',
    '/api/mandis/prices/history?commodity=ONION&variety=Red&mandi=8&limit=6&offset=0&endDate=2026-10-07&order=DESC',
  ]);
  assert.equal(result.coverage.requests, 4);
  assert.equal(result.coverage.seriesTotal, 3);
  assert.equal(result.coverage.seriesDiscovered, 3);
  assert.equal(result.coverage.seriesRead, 3);
  assert.equal(result.coverage.seriesComparable, 2);
});

test('a series with no variety sends no variety filter, because NULL never matches', async () => {
  const { rows } = dataset([TOMATO_PUNE]);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  await api.getAlertHistory();

  const historyCall = stub.calls[1].endpoint;
  assert.ok(!historyCall.includes('variety='), 'a NULL variety must not be sent as a filter');
  assert.ok(historyCall.includes('mandi=7'));
});

test('a series that has only one reporting day produces no movement and is reported as uncovered', async () => {
  const { rows } = dataset([ONION_PUNE, ONION_NASHIK]);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getAlertHistory();

  assert.equal(deriveMovements(result.rows).length, 1);
  assert.equal(result.coverage.seriesComparable, 1);
  assert.equal(result.coverage.seriesTotal, 2);
  assert.equal(result.coverage.truncated, true, 'a series with no comparable history is coverage the page does not show');
});

test('the per-series cap bounds requests and reports the truncated coverage', async () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    commodityId: 100 + index,
    commodityCode: `CROP${index}`,
    mandiId: 7,
    variety: 'Red',
    days: ['2026-10-06', '2026-10-07'],
    prices: [1000, 1000 + index],
  }));
  const { rows } = dataset(many);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getAlertHistory();

  assert.equal(stub.calls.length, ALERT_HISTORY_LIMITS.maxSeries + 1);
  assert.equal(result.coverage.requests, ALERT_HISTORY_LIMITS.maxSeries + 1);
  assert.ok(result.coverage.requests <= ALERT_HISTORY_LIMITS.maxRequests);
  assert.equal(result.coverage.seriesTotal, 30);
  assert.equal(result.coverage.seriesRead, ALERT_HISTORY_LIMITS.maxSeries);
  assert.equal(result.coverage.seriesComparable, ALERT_HISTORY_LIMITS.maxSeries);
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.rows.length <= ALERT_HISTORY_LIMITS.maxSeries * ALERT_HISTORY_LIMITS.rowsPerSeries, true);
});

test('coverage is not reported as truncated when every discovered series was compared', async () => {
  const { rows } = dataset([ONION_PUNE, TOMATO_PUNE]);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getAlertHistory();

  assert.equal(result.coverage.seriesComparable, 2);
  assert.equal(result.coverage.seriesTotal, 2);
  assert.equal(result.coverage.truncated, false);
});

test('an empty dataset stays an honest empty page — no fabricated movement', async () => {
  const stub = stubTransport(backendTransport([]));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getAlertHistory();

  assert.deepEqual(result.rows, []);
  assert.equal(result.coverage.seriesTotal, 0);
  assert.equal(result.coverage.seriesComparable, 0);
  assert.equal(result.coverage.truncated, false);
  assert.deepEqual(buildAlerts(deriveMovements(result.rows)), []);
});

test('a failing discovery request reaches the caller so the page can retry', async () => {
  const apiError = Object.assign(new Error('mandi_prices_canonical is missing'), { status: 503, code: 'DATABASE_NOT_MIGRATED' });
  const stub = stubTransport(() => Promise.reject(apiError));
  const api = createMarketApi({ request: stub.request });

  await assert.rejects(() => api.getAlertHistory(), (err) => err.code === 'DATABASE_NOT_MIGRATED');
});

test('a failing per-series request fails the whole read instead of hiding a partial picture', async () => {
  const { rows } = dataset([ONION_PUNE, TOMATO_PUNE]);
  const transport = backendTransport(rows);
  const api = createMarketApi({
    request: (endpoint, options) => {
      if (endpoint.includes('commodity=TOMATO')) return Promise.reject(Object.assign(new Error('boom'), { code: 'NETWORK_ERROR', status: 0 }));
      return transport(endpoint, options);
    },
  });

  await assert.rejects(() => api.getAlertHistory(), (err) => err.code === 'NETWORK_ERROR');
});

test('getAlertHistory forwards the AbortSignal to every request it makes', async () => {
  const controller = new AbortController();
  const { rows } = dataset([ONION_PUNE, TOMATO_PUNE]);
  const stub = stubTransport(backendTransport(rows));
  const api = createMarketApi({ request: stub.request });

  await api.getAlertHistory({}, { signal: controller.signal });

  assert.equal(stub.calls.length, 3);
  for (const call of stub.calls) assert.equal(call.options.signal, controller.signal);
});

test('aborting mid-read rejects rather than committing a partial history', async () => {
  const controller = new AbortController();
  const { rows } = dataset([ONION_PUNE]);
  const api = createMarketApi({ request: backendTransport(rows) });
  controller.abort();

  await assert.rejects(() => api.getAlertHistory({}, { signal: controller.signal }), (err) => err.name === 'AbortError');
});

test('deriveSeries names each distinct series once and drops unusable rows', () => {
  const series = deriveSeries([
    shapePriceRow(rawPriceRow({ commodity_id: 1, mandi_id: 7, variety: 'Red' })),
    shapePriceRow(rawPriceRow({ observation_id: 2, commodity_id: 1, mandi_id: 7, variety: 'Red' })),
    shapePriceRow(rawPriceRow({ observation_id: 3, commodity_id: 2, mandi_id: 7, variety: 'Red' })),
    shapePriceRow(rawPriceRow({ observation_id: 4, commodity_id: 1, mandi_id: 8, variety: 'Red' })),
    shapePriceRow(rawPriceRow({ observation_id: 5, commodity_id: 1, mandi_id: 7, variety: null })),
    shapePriceRow(rawPriceRow({ observation_id: 6, commodity_id: null, mandi_id: 7 })),
    shapePriceRow(rawPriceRow({ observation_id: 7, commodity_code: null, commodity: null, mandi_id: 7 })),
    shapePriceRow(rawPriceRow({ observation_id: 8, commodity_code: null, commodity: null, mandi_id: null, market_code: null })),
    null,
  ]);

  assert.deepEqual(series.map((s) => s.key), ['1|7|Red', '2|7|Red', '1|8|Red', '1|7|', 'ONION|7|Red']);
  assert.equal(series[0].commodityCode, 'ONION');
  assert.equal(series[0].mandiId, 7);
  assert.equal(series[3].variety, null);
  assert.equal(series[4].commodityCode, 'ONION', 'a row with no commodity id still has a usable code');
  assert.equal(series[0].latestReportedDate, '2026-10-07');
  assert.deepEqual(deriveSeries([]), []);
});

test('deriveSeries falls back to the commodity name when a code is missing', () => {
  const [series] = deriveSeries([shapePriceRow(rawPriceRow({ commodity_code: null, commodity: 'Onion' }))]);
  assert.equal(series.commodityCode, 'Onion');
});

test('countSeriesDays counts DISTINCT reporting days, not rows', () => {
  const rows = [
    shapePriceRow(rawPriceRow({ observation_id: 1, reported_date: '2026-10-06' })),
    shapePriceRow(rawPriceRow({ observation_id: 2, reported_date: '2026-10-07' })),
    shapePriceRow(rawPriceRow({ observation_id: 3, reported_date: '2026-10-07' })),
    shapePriceRow(rawPriceRow({ observation_id: 4, reported_date: null })),
  ];
  assert.equal(countSeriesDays(rows), 2);
  assert.equal(countSeriesDays([]), 0);
  assert.equal(countSeriesDays(undefined), 0);
});

test('the alert-history caps are the documented constants', () => {
  assert.equal(ALERT_HISTORY_LIMITS.discoveryLimit, 200);
  assert.equal(ALERT_HISTORY_LIMITS.rowsPerSeries, 6);
  assert.ok(ALERT_HISTORY_LIMITS.maxSeries < ALERT_HISTORY_LIMITS.discoveryLimit);
  assert.ok(ALERT_HISTORY_LIMITS.maxRequests >= ALERT_HISTORY_LIMITS.maxSeries + 1);
});

test('a ready feed exposes the count pill the pages render', async () => {
  const stub = stubTransport(() => Promise.resolve(asPriceResponse(
    [rawPriceRow(), rawPriceRow({ observation_id: 102 })],
    { genuine_rows: 2, sample_rows: 0, stale_days: 1, latest_genuine_reporting_date: '2026-10-07' },
  )));
  const api = createMarketApi({ request: stub.request });

  const result = await api.getLatestPrices({ commodityCode: 'ONION' });

  assert.equal(result.count, 2);
  assert.equal(result.total, 2);
  assert.equal(result.limit, 200);
  assert.equal(result.offset, 0);
  assert.equal(result.meta.genuine_rows, 2);
  assert.equal(deriveFreshness(result.meta, null).pageAgeDays, 1);
});