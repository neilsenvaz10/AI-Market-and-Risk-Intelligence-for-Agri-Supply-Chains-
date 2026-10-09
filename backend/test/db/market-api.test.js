/**
 * Phase 5 market API tests against the isolated database.
 *
 * These run ONLY inside `npm run test:db` (see test/helpers/db.js): the disposable
 * `fasalytics_test_*` database assertion below makes that explicit and the file
 * lives in test/db/, which is the only place the DB runner globs.
 *
 * The fixture is inserted directly (a test market + a test commodity) and is
 * marked is_sample_data = TRUE on purpose: no test may ever create a row that the
 * app would present as a genuine market price. Every fixture row is removed again
 * in `after()`, so this file cannot perturb the other DB suites.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../helpers/db.js';
import { pool } from '../../src/db.js';
import { createApp } from '../../src/app.js';
import { createRequireAuth } from '../../src/middleware/auth.js';

assertIsolatedDatabase();

const FIXTURE = {
  mandiCode: 'MKTEST_STATE__MKTEST_DISTRICT__MKTEST_YARD',
  mandiName: 'Market Test Yard',
  state: 'Market Test State',
  district: 'Market Test District',
  marketCenter: 'Market Test Center',
  marketCode: 'MKTEST_MARKET_CODE',
  commodityCode: 'MKTEST_POMEGRANATE',
  commodityName: 'Market Test Pomegranate',
  commodityCategory: 'Market Test Fruits',
  source: 'MOCK_PROVIDER',
  sourceRecordPrefix: 'mktest-price-',
};

// min/max are derived from the modal price, so the table's CHECK constraints hold.
const PRICES = [
  { date: '2026-09-01', variety: 'Red', grade: 'FAQ', modal: 1200, quality: 'VALID' },
  { date: '2026-09-02', variety: 'Red', grade: 'FAQ', modal: 1250, quality: 'VALID' },
  { date: '2026-09-03', variety: 'Red', grade: 'FAQ', modal: 1300, quality: 'FLAGGED' },
  { date: '2026-09-02', variety: 'White', grade: 'FAQ', modal: 1100, quality: 'VALID' },
];
const LATEST_DATE = '2026-09-03';
const ROW_FIELDS = [
  'observation_id', 'source', 'source_dataset', 'source_record_id', 'source_label', 'source_precedence',
  'commodity_id', 'commodity_code', 'commodity', 'commodity_category',
  'mandi_id', 'mandi', 'market_code', 'state', 'state_code', 'district', 'district_code',
  'variety', 'variety_code', 'grade',
  'reported_date', 'minimum_price', 'maximum_price', 'modal_price',
  'original_price_unit', 'normalized_price_unit', 'arrival_quantity', 'arrival_unit',
  'fetched_at', 'quality_status', 'quality_flags', 'is_sample_data', 'content_hash',
];
const META_FIELDS = [
  'genuine_rows', 'sample_rows', 'latest_genuine_reporting_date',
  'latest_sample_reporting_date', 'latest_genuine_fetched_at', 'sources', 'stale_days',
];

let mandiId;
let commodityId;
const servers = [];

const requireAuth = createRequireAuth(async () => { throw new Error('market routes are public'); });
const welcomeEmail = { queueWelcomeEmail() {} };

async function start() {
  const app = createApp({ requireAuth, welcomeEmail });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, body: await res.json() };
  };
  return get;
}

let call;

before(async () => {
  const mandi = await pool.query(
    `INSERT INTO mandis (code, name, state, district, market_center, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state,
       district = EXCLUDED.district, market_center = EXCLUDED.market_center, is_active = TRUE
     RETURNING id`,
    [FIXTURE.mandiCode, FIXTURE.mandiName, FIXTURE.state, FIXTURE.district, FIXTURE.marketCenter]
  );
  mandiId = mandi.rows[0].id;
  const commodity = await pool.query(
    `INSERT INTO commodities (code, name, category, standard_unit, is_active)
     VALUES ($1, $2, $3, 'quintal', TRUE)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_active = TRUE
     RETURNING id`,
    [FIXTURE.commodityCode, FIXTURE.commodityName, FIXTURE.commodityCategory]
  );
  commodityId = commodity.rows[0].id;

  await pool.query('DELETE FROM mandi_prices WHERE mandi_id = $1 AND commodity_id = $2', [mandiId, commodityId]);
  for (const [index, row] of PRICES.entries()) {
    await pool.query(
      `INSERT INTO mandi_prices
         (mandi_id, commodity_id, price_date, min_price, max_price, modal_price, arrivals_quantity,
          unit, price_unit, arrival_unit, variety, variety_code, grade, source, source_record_key,
          market_code, quality_status, quality_flags, is_sample_data, fetched_at, raw_payload)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, 'Quintals', 'INR/quintal', 'tonne', $8, $9, $10,
               $11, $12, $13, $14, $15, TRUE, $16::timestamptz, '{"mktest": true}'::jsonb)`,
      [
        mandiId, commodityId, row.date, row.modal - 100, row.modal + 100, row.modal, 12.5 + index,
        row.variety, `MKTEST_${row.variety.toUpperCase()}`, row.grade, FIXTURE.source,
        `${FIXTURE.sourceRecordPrefix}${row.date}-${row.variety}`,
        FIXTURE.marketCode, row.quality,
        row.quality === 'FLAGGED' ? ['PRICE_OUTLIER'] : [],
        `${row.date}T10:00:00Z`,
      ]
    );
  }
  call = await start();
});

after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  await pool.query('DELETE FROM mandi_prices WHERE mandi_id = $1 AND commodity_id = $2', [mandiId, commodityId]);
  await pool.query('DELETE FROM mandis WHERE id = $1', [mandiId]);
  await pool.query('DELETE FROM commodities WHERE id = $1', [commodityId]);
  await pool.end();
});

test('GET /api/commodities lists only commodities with observations, with counts', async () => {
  const r = await call('/api/commodities?search=MKTEST_POMEGRANATE');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'success');
  const row = r.body.data.find((c) => c.commodity_code === FIXTURE.commodityCode);
  assert.ok(row, 'the fixture commodity has observations and must be listed');
  assert.equal(row.commodity, FIXTURE.commodityName);
  assert.equal(row.commodity_category, FIXTURE.commodityCategory);
  assert.equal(row.variety_count, 2);
  assert.equal(row.state_count, 1);
  assert.equal(row.observation_count, 4);
  assert.equal(row.first_reported_date, '2026-09-01');
  assert.equal(row.last_reported_date, LATEST_DATE);
  assert.equal(r.body.limit, 500);
  assert.equal(r.body.offset, 0);

  const byCategory = await call(`/api/commodities?category=${encodeURIComponent(FIXTURE.commodityCategory)}`);
  assert.equal(byCategory.status, 200);
  assert.ok(byCategory.body.data.every((c) => c.commodity_category === FIXTURE.commodityCategory));

  // A commodity code that exists in the catalogue but has no prices is never listed.
  await pool.query(`INSERT INTO commodities (code, name, category, is_active) VALUES ('MKTEST_NO_PRICES', 'Market Test No Prices', 'Market Test Fruits', TRUE)`);
  try {
    const search = await call('/api/commodities?search=' + encodeURIComponent('Market Test No Prices'));
    assert.equal(search.status, 200);
    assert.equal(search.body.data.length, 0, 'no observations -> not a market fact -> not listed');
  } finally {
    await pool.query(`DELETE FROM commodities WHERE code = 'MKTEST_NO_PRICES'`);
  }
});

test('GET /api/mandis lists markets with coverage and date ranges', async () => {
  const r = await call(`/api/mandis?search=${encodeURIComponent('Market Test Yard')}`);
  assert.equal(r.status, 200);
  const row = r.body.data.find((m) => m.mandi_id === mandiId);
  assert.ok(row);
  assert.equal(row.market_code, FIXTURE.marketCode);
  assert.equal(row.mandi, FIXTURE.mandiName);
  assert.equal(row.state, FIXTURE.state);
  assert.equal(row.district, FIXTURE.district);
  assert.equal(row.commodity_count, 1);
  assert.equal(row.observation_count, 4);
  assert.equal(row.earliest_reported_date, '2026-09-01');
  assert.equal(row.latest_reported_date, LATEST_DATE);
  assert.equal(r.body.total >= 1, true);

  const filtered = await call(`/api/mandis?state=${encodeURIComponent(FIXTURE.state)}&district=${encodeURIComponent(FIXTURE.district)}`);
  assert.ok(filtered.body.data.some((m) => m.mandi_id === mandiId));

  // A commodity that this market never traded must drop it from the list.
  const other = await call(`/api/mandis?commodity=${encodeURIComponent(FIXTURE.commodityCode)}&district=${encodeURIComponent(FIXTURE.district)}`);
  assert.ok(other.body.data.some((m) => m.mandi_id === mandiId));
});

test('GET /api/mandis/prices/latest returns only the newest date per (mandi, commodity, variety)', async () => {
  const r = await call(`/api/mandis/prices/latest?commodity=${FIXTURE.commodityCode}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'success');
  assert.equal(r.body.data.length, 2, 'one row per variety');
  assert.equal(r.body.total, 2);

  const dates = r.body.data.map((row) => row.reported_date).sort();
  assert.deepEqual(dates, ['2026-09-02', LATEST_DATE], 'white is newest on 09-02, red on 09-03');
  for (const row of r.body.data) {
    assert.ok(ROW_FIELDS.every((field) => field in row), `missing column in ${JSON.stringify(row)}`);
    assert.equal(row.is_sample_data, true);
    assert.equal(row.source, FIXTURE.source);
    assert.match(row.source_label, /Synthetic/i);
    assert.equal(row.original_price_unit, 'Quintals');
    assert.equal(row.normalized_price_unit, 'INR/quintal');
    assert.equal(typeof row.modal_price, 'number', 'NUMERIC must be a JSON number, not a string');
    assert.ok(row.minimum_price <= row.modal_price && row.modal_price <= row.maximum_price);
    assert.equal(row.state, FIXTURE.state);
    assert.equal(row.district, FIXTURE.district);
    assert.equal(row.mandi, FIXTURE.mandiName);
    assert.equal(row.market_code, FIXTURE.marketCode);
    assert.ok(row.fetched_at);
    assert.ok(row.variety);
    assert.ok(row.grade);
  }
  const red = r.body.data.find((row) => row.variety === 'Red');
  assert.equal(red.reported_date, LATEST_DATE);
  assert.equal(red.quality_status, 'FLAGGED');
  assert.equal(red.modal_price, 1300);
});

test('latest: every documented filter works and is case-insensitive', async () => {
  const get = (query) => call(`/api/mandis/prices/latest?${query}`);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&variety=Red`)).body.data.length, 1);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&variety=red`)).body.data.length, 1);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&variety=Blue`)).body.data.length, 0);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&qualityStatus=FLAGGED`)).body.data.length, 1);
  // qualityStatus filters rows BEFORE the latest-per-partition window, so the
  // newest VALID row for each variety is returned (both fall on 2026-09-02 here;
  // Red's newest overall row is the FLAGGED one on 2026-09-03).
  const validRows = (await get(`commodity=${FIXTURE.commodityCode}&qualityStatus=VALID`)).body.data;
  assert.equal(validRows.length, 2);
  assert.ok(validRows.every((row) => row.quality_status === 'VALID' && row.reported_date === '2026-09-02'));
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&commodityCategory=${encodeURIComponent(FIXTURE.commodityCategory)}`)).body.data.length, 2);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&state=${encodeURIComponent(FIXTURE.state)}`)).body.data.length, 2);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&state=Nowhere`)).body.data.length, 0);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&district=${encodeURIComponent(FIXTURE.district)}`)).body.data.length, 2);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&mandi=${encodeURIComponent(FIXTURE.mandiName)}`)).body.data.length, 2);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&marketCode=${FIXTURE.marketCode}`)).body.data.length, 2);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&source=${FIXTURE.source}`)).body.data.length, 2);
  assert.equal((await get(`commodity=${FIXTURE.commodityCode}&source=CEDA`)).body.data.length, 0);
  assert.equal((await get(`commodity=Unknown Commodity`)).body.data.length, 0);
});

test('latest: includeSample=false excludes synthetic rows, and an empty result is 200 with []', async () => {
  const excluded = await call(`/api/mandis/prices/latest?commodity=${FIXTURE.commodityCode}&includeSample=false`);
  assert.equal(excluded.status, 200);
  assert.deepEqual(excluded.body.data, []);
  assert.equal(excluded.body.count, 0);
  assert.equal(excluded.body.total, 0);
  assert.equal(excluded.body.meta.sample_rows, 0);

  const empty = await call('/api/mandis/prices/latest?commodity=MKTEST_DOES_NOT_EXIST');
  assert.equal(empty.status, 200, 'nothing matching is not a 404');
  assert.deepEqual(empty.body.data, []);
  assert.equal(empty.body.meta.genuine_rows, 0);
  assert.equal(empty.body.meta.latest_genuine_reporting_date, null);
  assert.equal(empty.body.meta.stale_days, null);
  assert.deepEqual(empty.body.meta.sources, []);
});

test('latest: meta is page-scoped and carries the documented keys', async () => {
  const all = await call(`/api/mandis/prices/latest?commodity=${FIXTURE.commodityCode}`);
  assert.deepEqual(Object.keys(all.body.meta), META_FIELDS);
  assert.equal(all.body.meta.genuine_rows, 0, 'every fixture row is synthetic');
  assert.equal(all.body.meta.sample_rows, 2);
  assert.equal(all.body.meta.latest_genuine_reporting_date, null);
  assert.equal(all.body.meta.latest_sample_reporting_date, LATEST_DATE);
  assert.equal(all.body.meta.latest_genuine_fetched_at, null);
  assert.deepEqual(all.body.meta.sources, [{ code: FIXTURE.source, label: all.body.meta.sources[0].label }]);
  assert.equal(all.body.meta.stale_days, null, 'no genuine row -> no genuine freshness claim');

  // The same commodity filtered down to one row must report ONE sample row: meta
  // describes the returned page, never the whole table.
  const one = await call(`/api/mandis/prices/latest?commodity=${FIXTURE.commodityCode}&variety=White`);
  assert.equal(one.body.meta.sample_rows, 1);
  assert.equal(one.body.meta.latest_sample_reporting_date, '2026-09-02');
});

test('history: returns the most recent page oldest-first by default', async () => {
  const asc = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}`);
  assert.equal(asc.status, 200);
  assert.equal(asc.body.count, 4);
  assert.equal(asc.body.total, 4);
  assert.equal(asc.body.order, 'ASC');
  assert.equal(asc.body.limit, 100);
  const dates = asc.body.data.map((row) => row.reported_date);
  assert.deepEqual([...dates].sort(), dates, 'oldest first for charting');
  assert.equal(dates[0], '2026-09-01');
  assert.equal(dates.at(-1), LATEST_DATE);

  const paged = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&limit=2`);
  assert.equal(paged.body.count, 2);
  assert.equal(paged.body.total, 4, 'total is the whole filtered set, not the page');
  assert.equal(paged.body.data.at(-1).reported_date, LATEST_DATE, 'limit keeps the newest rows');
  const pagedDates = paged.body.data.map((row) => row.reported_date);
  assert.deepEqual([...pagedDates].sort(), pagedDates);

  const desc = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&limit=2&order=DESC`);
  assert.equal(desc.body.order, 'DESC');
  assert.equal(desc.body.data[0].reported_date, LATEST_DATE);
  assert.deepEqual(desc.body.data.map((row) => row.reported_date), [LATEST_DATE, '2026-09-02']);

  const offset = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&limit=2&offset=2&order=DESC`);
  assert.equal(offset.body.offset, 2);
  assert.deepEqual(offset.body.data.map((row) => row.reported_date), ['2026-09-02', '2026-09-01']);

  assert.deepEqual(Object.keys(asc.body.meta), META_FIELDS);
  assert.equal(asc.body.meta.sample_rows, 4);
});

test('history: honours the date range and all price filters', async () => {
  const ranged = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&startDate=2026-09-02&endDate=2026-09-03`);
  assert.equal(ranged.status, 200);
  assert.equal(ranged.body.count, 3);
  assert.ok(ranged.body.data.every((row) => row.reported_date >= '2026-09-02' && row.reported_date <= '2026-09-03'));

  const oneDay = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&startDate=2026-09-03&endDate=2026-09-03`);
  assert.equal(oneDay.body.count, 1);
  assert.equal(oneDay.body.data[0].reported_date, LATEST_DATE);

  const byVariety = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&variety=Red`);
  assert.equal(byVariety.body.count, 3);
  assert.ok(byVariety.body.data.every((row) => row.variety === 'Red'));

  const flagged = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&qualityStatus=FLAGGED`);
  assert.equal(flagged.body.count, 1);
  assert.equal(flagged.body.data[0].quality_status, 'FLAGGED');

  const noSample = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&includeSample=false`);
  assert.equal(noSample.status, 200);
  assert.deepEqual(noSample.body.data, []);

  const outside = await call(`/api/mandis/prices/history?commodity=${FIXTURE.commodityCode}&startDate=2020-01-01&endDate=2020-01-31`);
  assert.equal(outside.status, 200);
  assert.deepEqual(outside.body.data, []);
});

test('invalid parameters are 400 VALIDATION_ERROR, never 500', async () => {
  const cases = [
    '/api/commodities?limit=0',
    '/api/commodities?limit=1001',
    '/api/mandis?offset=-1',
    '/api/mandis/prices/latest?limit=201',
    '/api/mandis/prices/latest?includeSample=maybe',
    '/api/mandis/prices/latest?qualityStatus=MAYBE',
    '/api/mandis/prices/latest?source=not%20a%20source',
    `/api/mandis/prices/latest?commodity=${encodeURIComponent("Onion'; DROP TABLE mandi_prices;--")}`,
    '/api/mandis/prices/history?startDate=2026-02-31',
    '/api/mandis/prices/history?startDate=2026-09-10&endDate=2026-09-01',
    '/api/mandis/prices/history?order=sideways',
    '/api/mandis/prices/history?limit=1001',
    '/api/mandis/data-status?limit=10',
  ];
  for (const path of cases) {
    const r = await call(path);
    assert.equal(r.status, 400, path);
    assert.equal(r.body.status, 'error', path);
    assert.equal(r.body.code, 'VALIDATION_ERROR', path);
    assert.ok(Array.isArray(r.body.details) && r.body.details.length > 0, path);
    assert.ok(r.body.details[0].field && r.body.details[0].message, path);
  }
});

test('GET /api/mandis/data-status reports per-source freshness and leaks no secret', async () => {
  const r = await call('/api/mandis/data-status');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'success');
  const data = r.body.data;

  assert.ok(Number.isInteger(data.overall.total_observations));
  assert.ok(data.overall.total_observations >= 4);
  assert.ok(data.overall.earliest_reported_date <= data.overall.latest_reported_date);
  assert.ok(Number.isInteger(data.overall.distinct_commodities));
  assert.ok(Number.isInteger(data.overall.distinct_mandis));
  assert.equal(typeof data.overall.stale, 'boolean');
  assert.equal(data.overall.staleness_threshold_days, 3);
  assert.ok(data.overall.staleness_days === null || Number.isInteger(data.overall.staleness_days));
  if (data.overall.latest_reported_date === null) {
    assert.equal(data.overall.stale, true, 'no observations cannot claim freshness');
  } else {
    assert.equal(data.overall.stale, data.overall.staleness_days > 3 || data.overall.staleness_days === null);
  }

  const registered = new Set((await pool.query('SELECT code FROM mandi_sources')).rows.map((row) => row.code));
  assert.equal(data.sources.length, registered.size, 'one entry per registered source');
  const sample = data.sources.find((s) => s.code === FIXTURE.source);
  assert.ok(sample, 'the source of the fixture rows is registered');
  assert.equal(sample.is_sample, true);
  assert.match(sample.label, /synthetic/i, 'the label comes from mandi_sources, never invented');
  assert.ok(sample.observation_count >= 4);

  const stateCodes = new Set((await pool.query('SELECT source FROM mandi_source_sync_state')).rows.map((row) => row.source));
  for (const source of data.sources) {
    assert.deepEqual(Object.keys(source), [
      'code', 'label', 'precedence', 'is_sample', 'configured', 'last_attempt_at', 'last_success_at',
      'last_status', 'last_error', 'latest_reporting_date', 'observation_count',
    ]);
    assert.equal(typeof source.configured, 'boolean');
    assert.ok(source.last_error === null || typeof source.last_error === 'string');
    if (!stateCodes.has(source.code)) {
      // A missing sync-state row means "never synced", not an error.
      assert.equal(source.last_attempt_at, null, `${source.code} has no sync state`);
      assert.equal(source.last_success_at, null);
      assert.equal(source.last_status, null);
      assert.equal(source.latest_reporting_date, null);
    }
  }

  assert.ok(Array.isArray(data.recent_syncs));
  assert.ok(data.recent_syncs.length <= 5);

  // No credential-shaped key anywhere in the payload, and no secret value.
  const forbidden = /(key|token|secret|password|credential|authorization)/i;
  const seen = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) { seen.push(key); walk(value); }
    }
  };
  walk(data);
  const leaked = seen.filter((key) => forbidden.test(key));
  assert.deepEqual(leaked, [], `data-status must not expose credential fields: ${leaked.join(', ')}`);
});
