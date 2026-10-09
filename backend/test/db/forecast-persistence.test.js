/**
 * Phase 4 migration / persistence tests: schema, constraints, indexes, retrieval.
 * Runs only inside the disposable database created by `npm run test:db`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../helpers/db.js';
import {
  FIXTURE_MODEL_VERSION,
  createForecastEntities,
  seedForecasts,
  seedPriceHistory,
} from '../helpers/forecastFixtures.js';
import { pool } from '../../src/db.js';
import { ForecastService } from '../../src/services/forecast.service.js';

assertIsolatedDatabase();

let client;
let entities;

before(async () => {
  client = await pool.connect();
  entities = await createForecastEntities(client, {
    mandiCode: 'TEST_MH_PERSIST',
    commodityCode: 'TEST_PERSIST_CROP',
    mandiName: 'Test Persist Mandi',
    commodityName: 'Test Persist Crop',
  });
  await seedPriceHistory(client, entities, { count: 30, endDate: '2026-09-30' });
});

after(() => {
  if (client) client.release();
});

async function tables() {
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  return new Set(result.rows.map((row) => row.table_name));
}

async function columns(table) {
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_name = $1`,
    [table]
  );
  return new Map(result.rows.map((row) => [row.column_name, row]));
}

async function indexes(table) {
  const result = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = $1`, [table]);
  return result.rows.map((row) => row.indexname);
}

async function constraintNames(table) {
  const result = await client.query(
    `SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = $1`,
    [table]
  );
  return new Set(result.rows.map((row) => row.conname));
}

test('migration 006 created the forecast tables', async () => {
  const existing = await tables();
  assert.ok(existing.has('forecast_runs'), 'forecast_runs must exist');
  assert.ok(existing.has('forecasts'), 'forecasts must exist');
});

test('migration 006 did not disturb the Phase 1-3 tables', async () => {
  const existing = await tables();
  for (const table of ['farmers', 'mandis', 'commodities', 'mandi_prices', 'mandi_price_revisions', 'mandi_price_conflicts', 'schema_migrations']) {
    assert.ok(existing.has(table), `${table} must still exist`);
  }
  // Price history must remain the source of truth and untouched by Phase 4.
  const result = await client.query(`SELECT COUNT(*)::int AS n FROM mandi_prices WHERE source = 'DATA_GOV_IN'`);
  assert.equal(result.rows[0].n, 0);
});

test('migration 007 (Phase 4) is recorded in schema_migrations', async () => {
  const result = await client.query(`SELECT filename FROM schema_migrations ORDER BY filename`);
  const filenames = result.rows.map((row) => row.filename);
  assert.ok(filenames.includes('007_phase4_forecasting.sql'));
});

test('forecasts table has every required Phase 4 field', async () => {
  const cols = await columns('forecasts');
  for (const name of [
    'commodity_id', 'mandi_id', 'forecast_date', 'horizon_days', 'predicted_price',
    'lower_bound', 'upper_bound', 'confidence', 'model_version', 'training_data_end_date',
    'generated_at', 'interval_level', 'last_observed_price', 'last_observed_date',
    'is_sample_data', 'data_source', 'unit',
  ]) {
    assert.ok(cols.has(name), `forecasts.${name} is required`);
  }
  assert.equal(cols.get('predicted_price').data_type, 'numeric');
  assert.equal(cols.get('forecast_date').data_type, 'date');
  assert.equal(cols.get('training_data_end_date').data_type, 'date');
});

test('forecast_runs table records model provenance', async () => {
  const cols = await columns('forecast_runs');
  for (const name of ['model_version', 'training_data_end_date', 'observations_used', 'horizon_max', 'is_sample_data', 'data_source', 'generated_at']) {
    assert.ok(cols.has(name), `forecast_runs.${name} is required`);
  }
});

test('forecasts has the lookup, run and date indexes', async () => {
  const names = await indexes('forecasts');
  for (const expected of ['idx_forecasts_lookup', 'idx_forecasts_run', 'idx_forecasts_date']) {
    assert.ok(names.includes(expected), `${expected} must exist`);
  }
  const runIndexes = await indexes('forecast_runs');
  for (const expected of ['idx_forecast_runs_lookup', 'idx_forecast_runs_model']) {
    assert.ok(runIndexes.includes(expected), `${expected} must exist`);
  }
});

test('forecasts enforces its uniqueness rule', async () => {
  const names = await constraintNames('forecasts');
  assert.ok(names.has('uq_forecasts_market_target_model'));
});

test('persistence and retrieval round-trip through the service', async () => {
  const runId = await seedForecasts(client, entities, { modelVersion: FIXTURE_MODEL_VERSION });
  assert.ok(runId > 0);

  const service = new ForecastService({ pool });
  const result = await service.getForecast({
    mandiId: entities.mandiId,
    commodityId: entities.commodityId,
    modelVersion: FIXTURE_MODEL_VERSION,
  });
  assert.equal(result.rows.length, 7);
  assert.equal(result.run.model_version, FIXTURE_MODEL_VERSION);
  const trainedThrough = result.run.training_data_end_date;
  const isoDate = trainedThrough instanceof Date ? trainedThrough.toISOString().slice(0, 10) : String(trainedThrough).slice(0, 10);
  assert.equal(isoDate, '2026-09-30');
});

test('re-running generation upserts instead of duplicating', async () => {
  const before = await client.query(`SELECT COUNT(*)::int AS n FROM forecasts WHERE mandi_id = $1 AND commodity_id = $2`, [
    entities.mandiId,
    entities.commodityId,
  ]);
  await seedForecasts(client, entities, { modelVersion: FIXTURE_MODEL_VERSION, basePrice: 1300 });
  const after = await client.query(`SELECT COUNT(*)::int AS n FROM forecasts WHERE mandi_id = $1 AND commodity_id = $2`, [
    entities.mandiId,
    entities.commodityId,
  ]);
  assert.equal(after.rows[0].n, before.rows[0].n, 'the unique rule must make regeneration idempotent');
});

test('a distinct model version keeps its own rows', async () => {
  await seedForecasts(client, entities, { modelVersion: 'second-model-v1' });
  const service = new ForecastService({ pool });
  const versions = await service.availableModelVersions({
    mandiId: entities.mandiId,
    commodityId: entities.commodityId,
  });
  assert.ok(versions.includes(FIXTURE_MODEL_VERSION));
  assert.ok(versions.includes('second-model-v1'));
});

test('horizon outside 1..7 is rejected by the database', async () => {
  await assert.rejects(
    client.query(
      `INSERT INTO forecasts (run_id, commodity_id, mandi_id, forecast_date, horizon_days, predicted_price,
         lower_bound, upper_bound, confidence, model_version, training_data_end_date)
       VALUES (1, $1, $2, '2026-10-10', 8, 100, 90, 110, 50, 'x', '2026-09-30')`,
      [entities.commodityId, entities.mandiId]
    ),
    /forecasts_horizon_valid/
  );
});

test('disordered bounds are rejected by the database', async () => {
  const run = await seedForecasts(client, entities, { modelVersion: 'bounds-v1' });
  await assert.rejects(
    client.query(
      `INSERT INTO forecasts (run_id, commodity_id, mandi_id, forecast_date, horizon_days, predicted_price,
         lower_bound, upper_bound, confidence, model_version, training_data_end_date)
       VALUES ($1, $2, $3, '2026-11-01', 1, 100, 200, 300, 50, 'bounds-v1', '2026-09-30')`,
      [run, entities.commodityId, entities.mandiId]
    ),
    /forecasts_bounds_ordered/
  );
});

test('confidence outside 0..100 is rejected by the database', async () => {
  const run = await seedForecasts(client, entities, { modelVersion: 'confidence-v1' });
  await assert.rejects(
    client.query(
      `INSERT INTO forecasts (run_id, commodity_id, mandi_id, forecast_date, horizon_days, predicted_price,
         lower_bound, upper_bound, confidence, model_version, training_data_end_date)
       VALUES ($1, $2, $3, '2026-11-02', 1, 100, 90, 110, 101, 'confidence-v1', '2026-09-30')`,
      [run, entities.commodityId, entities.mandiId]
    ),
    /forecasts_confidence_range/
  );
});

test('a forecast cannot claim a genuine source while flagged as sample', async () => {
  await assert.rejects(
    client.query(
      `INSERT INTO forecast_runs (model_version, commodity_id, mandi_id, training_data_end_date, observations_used, horizon_max, is_sample_data, data_source)
       VALUES ('bad-v1', $1, $2, '2026-09-30', 10, 7, TRUE, 'DATABASE')`,
      [entities.commodityId, entities.mandiId]
    ),
    /forecast_runs_sample_flag_consistent/
  );
});

test('deleting a run cascades only to its own forecast rows', async () => {
  const scratch = await createForecastEntities(client, {
    mandiCode: 'TEST_MH_CASCADE',
    commodityCode: 'TEST_CASCADE_CROP',
    mandiName: 'Test Cascade Mandi',
    commodityName: 'Test Cascade Crop',
  });
  const runId = await seedForecasts(client, scratch, { modelVersion: 'cascade-v1' });
  const before = await client.query(`SELECT COUNT(*)::int AS n FROM forecasts WHERE run_id = $1`, [runId]);
  assert.equal(before.rows[0].n, 7);
  await client.query(`DELETE FROM forecast_runs WHERE id = $1`, [runId]);
  const after = await client.query(`SELECT COUNT(*)::int AS n FROM forecasts WHERE run_id = $1`, [runId]);
  assert.equal(after.rows[0].n, 0);
  // Price history is never touched (ON DELETE RESTRICT protects the parents).
  const prices = await client.query(`SELECT COUNT(*)::int AS n FROM mandi_prices WHERE mandi_id = $1`, [scratch.mandiId]);
  assert.equal(prices.rows[0].n, 0);
});

test('price history cannot be deleted while forecasts reference the mandi', async () => {
  await seedForecasts(client, entities, { modelVersion: 'restrict-v1' });
  await assert.rejects(
    client.query(`DELETE FROM mandis WHERE id = $1`, [entities.mandiId]),
    /violates foreign key constraint|RESTRICT/i
  );
});
