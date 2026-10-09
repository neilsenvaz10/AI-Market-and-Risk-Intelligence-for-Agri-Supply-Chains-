/**
 * Phase 4 forecast API tests against the isolated database.
 *
 * Covers: valid request, invalid commodity, invalid mandi, invalid horizon,
 * missing forecast, insufficient history, and database failure — plus the
 * guarantee that forecasts are never returned as if they were observed prices.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../helpers/db.js';
import {
  FIXTURE_MODEL_VERSION,
  createForecastEntities,
  markForecastRunGenuine,
  seedForecasts,
  seedPriceHistory,
} from '../helpers/forecastFixtures.js';
import { pool } from '../../src/db.js';
import { createApp } from '../../src/app.js';
import { createRequireAuth } from '../../src/middleware/auth.js';
import { ForecastService } from '../../src/services/forecast.service.js';
import { createForecastController } from '../../src/controllers/forecast.controller.js';

assertIsolatedDatabase();

const fakeVerify = async (token) => {
  const [kind, uid] = token.split(':');
  if (kind !== 'valid') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
  return { uid, email: `${uid}@example.in`, email_verified: true, firebase: { sign_in_provider: 'password' } };
};

const requireAuth = createRequireAuth(fakeVerify);
const welcomeEmail = { queueWelcomeEmail() {} };
const servers = [];

async function start() {
  const app = createApp({ requireAuth, welcomeEmail });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, body: await res.json() };
  };
  return { base, request };
}

let client;
let api;
let entities; // full history + forecasts
let thinEntities; // only a few observations (insufficient history)
let emptyEntities; // no price history at all

before(async () => {
  api = await start();
  client = await pool.connect();

  entities = await createForecastEntities(client, {
    mandiCode: 'TEST_MH_PUNE_APMC',
    commodityCode: 'TEST_ONION',
    mandiName: 'Test Pune APMC',
    commodityName: 'Test Onion',
  });
  await seedPriceHistory(client, entities, { count: 60, endDate: '2026-09-30' });
  await seedForecasts(client, entities, { modelVersion: FIXTURE_MODEL_VERSION });

  thinEntities = await createForecastEntities(client, {
    mandiCode: 'TEST_MH_THIN_MANDI',
    commodityCode: 'TEST_THIN_CROP',
    mandiName: 'Test Thin Mandi',
    commodityName: 'Test Thin Crop',
  });
  await seedPriceHistory(client, thinEntities, { count: 5, endDate: '2026-09-30' });

  emptyEntities = await createForecastEntities(client, {
    mandiCode: 'TEST_MH_EMPTY_MANDI',
    commodityCode: 'TEST_EMPTY_CROP',
    mandiName: 'Test Empty Mandi',
    commodityName: 'Test Empty Crop',
  });
});

after(async () => {
  if (client) client.release();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

test('GET /api/forecast/:commodity/:mandi returns the persisted 1-7 day forecast', async () => {
  const { status, body } = await api.request(`/api/forecast/${entities.commodityCode}/${entities.mandiCode}`);
  assert.equal(status, 200);
  assert.equal(body.status, 'success');
  assert.equal(body.available, true);
  assert.equal(body.reason, null);
  assert.equal(body.data.length, 7);
  assert.deepEqual(
    body.data.map((row) => row.horizon_days),
    [1, 2, 3, 4, 5, 6, 7]
  );
  for (const row of body.data) {
    assert.ok(row.predicted_price > 0, 'predicted price must be positive');
    assert.ok(row.lower_bound > 0);
    assert.ok(row.lower_bound <= row.predicted_price);
    assert.ok(row.predicted_price <= row.upper_bound);
    assert.ok(row.confidence >= 0 && row.confidence <= 100);
    assert.equal(row.model_version, FIXTURE_MODEL_VERSION);
    assert.equal(row.unit, 'INR/quintal');
  }
  // Observed price is reported separately and is NOT a forecast row.
  assert.equal(body.meta.last_observed_price, 1200);
  assert.equal(body.meta.last_observed_date, '2026-09-30');
  assert.equal(body.meta.model_version, FIXTURE_MODEL_VERSION);
  assert.equal(body.meta.training_data_end_date, '2026-09-30');
  assert.match(body.meta.disclaimer, /not guaranteed/i);
  assert.equal(body.meta.data_source, 'FIXTURE');
  assert.equal(body.meta.is_sample_data, true);
});

test('commodity and mandi resolve by code, exact name and id', async () => {
  const byName = await api.request(`/api/forecast/${encodeURIComponent('Test Onion')}/${encodeURIComponent('Test Pune APMC')}`);
  assert.equal(byName.status, 200);
  assert.equal(byName.body.available, true);

  const byId = await api.request(`/api/forecast/${entities.commodityId}/${entities.mandiId}`);
  assert.equal(byId.status, 200);
  assert.equal(byId.body.available, true);
});

test('horizon filter returns exactly one day and horizon ordering is respected', async () => {
  const one = await api.request(`/api/forecast/${entities.commodityCode}/${entities.mandiCode}?horizon=3`);
  assert.equal(one.status, 200);
  assert.equal(one.body.data.length, 1);
  assert.equal(one.body.data[0].horizon_days, 3);

  const descending = await api.request(`/api/forecast/${entities.commodityCode}/${entities.mandiCode}?order=DESC`);
  assert.equal(descending.body.data[0].horizon_days, 7);
});

test('invalid commodity returns 404 COMMODITY_NOT_FOUND', async () => {
  const { status, body } = await api.request(`/api/forecast/NO_SUCH_CROP/${entities.mandiCode}`);
  assert.equal(status, 404);
  assert.equal(body.code, 'COMMODITY_NOT_FOUND');
});

test('invalid mandi returns 404 MANDI_NOT_FOUND', async () => {
  const { status, body } = await api.request(`/api/forecast/${entities.commodityCode}/NO_SUCH_MANDI`);
  assert.equal(status, 404);
  assert.equal(body.code, 'MANDI_NOT_FOUND');
});

test('invalid horizon returns 400 VALIDATION_ERROR', async () => {
  for (const horizon of ['0', '8', 'abc', '-2']) {
    const { status, body } = await api.request(`/api/forecast/${entities.commodityCode}/${entities.mandiCode}?horizon=${horizon}`);
    assert.equal(status, 400, `horizon=${horizon} should be rejected`);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.ok(body.details.some((detail) => detail.field === 'horizon'));
  }
});

test('invalid order and includeSample return 400', async () => {
  const order = await api.request(`/api/forecast/${entities.commodityCode}/${entities.mandiCode}?order=sideways`);
  assert.equal(order.status, 400);
  const sample = await api.request(`/api/forecast/${entities.commodityCode}/${entities.mandiCode}?includeSample=maybe`);
  assert.equal(sample.status, 400);
});

test('missing forecast returns 200 with available:false and an explicit reason', async () => {
  const noForecast = await createForecastEntities(client, {
    mandiCode: 'TEST_MH_NO_FORECAST',
    commodityCode: 'TEST_NO_FORECAST_CROP',
    mandiName: 'Test No Forecast Mandi',
    commodityName: 'Test No Forecast Crop',
  });
  await seedPriceHistory(client, noForecast, { count: 40, endDate: '2026-09-30' });

  const { status, body } = await api.request(`/api/forecast/${noForecast.commodityCode}/${noForecast.mandiCode}`);
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.equal(body.data.length, 0);
  assert.equal(body.reason.code, 'NO_FORECAST');
  assert.match(body.reason.message, /forecast:train/);
});

test('insufficient history returns 200 with INSUFFICIENT_HISTORY', async () => {
  const { status, body } = await api.request(`/api/forecast/${thinEntities.commodityCode}/${thinEntities.mandiCode}`);
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.equal(body.reason.code, 'INSUFFICIENT_HISTORY');
  assert.equal(body.history.observations, 5);
});

test('no market data returns 200 with NO_MARKET_DATA', async () => {
  const { status, body } = await api.request(`/api/forecast/${emptyEntities.commodityCode}/${emptyEntities.mandiCode}`);
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.equal(body.reason.code, 'NO_MARKET_DATA');
  assert.equal(body.history.observations, 0);
});

test('includeSample=false excludes fixture-derived forecasts', async () => {
  const { status, body } = await api.request(
    `/api/forecast/${entities.commodityCode}/${entities.mandiCode}?includeSample=false`
  );
  assert.equal(status, 200);
  assert.equal(body.available, false, 'fixture forecasts must be excluded');
  assert.equal(body.reason.code, 'NO_FORECAST_FOR_FILTER');
});

test('a genuine run is returned when sample rows are excluded', async () => {
  const genuine = await createForecastEntities(client, {
    mandiCode: 'TEST_MH_GENUINE',
    commodityCode: 'TEST_GENUINE_CROP',
    mandiName: 'Test Genuine Mandi',
    commodityName: 'Test Genuine Crop',
  });
  await seedPriceHistory(client, genuine, { count: 40, endDate: '2026-09-30' });
  const runId = await seedForecasts(client, genuine, { modelVersion: 'genuine-v1' });
  await markForecastRunGenuine(client, runId);

  const { body } = await api.request(`/api/forecast/${genuine.commodityCode}/${genuine.mandiCode}?includeSample=false`);
  assert.equal(body.available, true);
  assert.equal(body.meta.is_sample_data, false);
  assert.equal(body.meta.data_source, 'DATABASE');
});

test('unknown model version returns available:false and lists what exists', async () => {
  const { status, body } = await api.request(
    `/api/forecast/${entities.commodityCode}/${entities.mandiCode}?modelVersion=does-not-exist`
  );
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.equal(body.reason.code, 'NO_FORECAST_FOR_FILTER');
  assert.ok(body.available_model_versions.includes(FIXTURE_MODEL_VERSION));
});

test('the latest run wins when several runs exist for one pair', async () => {
  await seedForecasts(client, entities, {
    modelVersion: 'newer-v2',
    generatedAt: '2026-10-05T00:00:00Z',
    basePrice: 5000,
  });
  const { body } = await api.request(`/api/forecast/${entities.commodityCode}/${entities.mandiCode}?order=DESC`);
  assert.equal(body.meta.model_version, 'newer-v2');
  assert.equal(body.meta.generated_at, '2026-10-05T00:00:00.000Z');
  assert.ok(body.data[0].predicted_price > 4900);
});

test('database failure maps to 503 rather than a 500 or a fake price', async () => {
  // A pool whose every query fails with a driver-level connectivity error.
  const failingService = new ForecastService({
    pool: {
      query: async () => {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      },
    },
  });
  const controller = createForecastController({ forecastService: failingService });

  const result = await new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, body: payload });
      },
    };
    controller.getForecast(
      { params: { commodity: entities.commodityCode, mandi: entities.mandiCode }, query: {} },
      res,
      (err) => resolve({ statusCode: err.statusCode, body: { code: err.code } })
    );
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'DATABASE_UNAVAILABLE');
});
