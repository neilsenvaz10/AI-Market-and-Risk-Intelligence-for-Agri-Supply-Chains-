/**
 * Fixture helpers for Phase 4 database/API tests.
 *
 * Forecast rows are synthetic development data. They are written with
 * `is_sample_data = TRUE` / `data_source = 'FIXTURE'` so they can never be
 * mistaken for a forecast derived from real market prices, and they always live in
 * a disposable `fasalytics_test_*` database created by `npm run test:db`.
 */
import { assertIsolatedDatabase } from './db.js';

export const FIXTURE_FLAG = 'PHASE4_DEV_FIXTURE';
export const FIXTURE_MODEL_VERSION = 'test-fixture-v1';

/** Inserts (idempotently) a mandi + commodity pair and returns their ids. */
export async function createForecastEntities(client, overrides = {}) {
  assertIsolatedDatabase();
  const mandiCode = overrides.mandiCode ?? 'TEST_MH_PUNE_APMC';
  const commodityCode = overrides.commodityCode ?? 'TEST_ONION';

  const mandi = await client.query(
    `INSERT INTO mandis (code, name, state, district, market_center, is_active)
     VALUES ($1, $2, $3, $4, $2, TRUE)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
     RETURNING id`,
    [mandiCode, overrides.mandiName ?? 'Test Pune APMC', 'Maharashtra', 'Pune']
  );
  const commodity = await client.query(
    `INSERT INTO commodities (code, name, category, standard_unit, is_active)
     VALUES ($1, $2, 'Vegetables', 'quintal', TRUE)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
     RETURNING id`,
    [commodityCode, overrides.commodityName ?? 'Test Onion']
  );
  return {
    mandiId: mandi.rows[0].id,
    commodityId: commodity.rows[0].id,
    mandiCode,
    commodityCode,
  };
}

/** Inserts `count` daily price observations ending on `endDate` (synthetic, flagged). */
export async function seedPriceHistory(client, { mandiId, commodityId }, { count = 40, endDate = '2026-09-30' } = {}) {
  assertIsolatedDatabase();
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const daysBack = count - 1 - index;
    const priceDate = new Date(`${endDate}T00:00:00Z`);
    priceDate.setUTCDate(priceDate.getUTCDate() - daysBack);
    rows.push({
      priceDate: priceDate.toISOString().slice(0, 10),
      modalPrice: 1000 + index * 5,
    });
  }
  for (const row of rows) {
    // 11 columns, 6 distinct placeholders: $4 (modal price) is reused so the
    // min/max bounds stay consistent with the modal price.
    await client.query(
      `INSERT INTO mandi_prices (
         mandi_id, commodity_id, price_date, min_price, max_price, modal_price,
         unit, source, is_sample_data, price_unit, quality_flags
       ) VALUES (
         $1, $2, $3::date, $4::numeric, $4::numeric + 50, $4::numeric,
         'quintal', 'MOCK_PROVIDER', TRUE, 'INR/quintal', ARRAY[$5]::text[]
       )
       ON CONFLICT ON CONSTRAINT uq_mandi_prices_observation DO NOTHING`,
      [mandiId, commodityId, row.priceDate, row.modalPrice, FIXTURE_FLAG]
    );
  }
  return rows.length;
}

/** Inserts a forecast run plus its 1..7 day rows; returns the run id. */
export async function seedForecasts(
  client,
  { mandiId, commodityId },
  {
    modelVersion = FIXTURE_MODEL_VERSION,
    trainingDataEndDate = '2026-09-30',
    generatedAt = '2026-10-01T00:00:00Z',
    horizons = [1, 2, 3, 4, 5, 6, 7],
    lastObservedPrice = 1200,
    lastObservedDate = '2026-09-30',
    basePrice = 1210,
  } = {}
) {
  assertIsolatedDatabase();
  const run = await client.query(
    `INSERT INTO forecast_runs (
       model_version, commodity_id, mandi_id, training_data_end_date, history_start_date,
       observations_used, horizon_max, is_sample_data, data_source, metrics, generated_at
     ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, TRUE, 'FIXTURE', $8::jsonb, $9::timestamptz)
     RETURNING id`,
    [
      modelVersion,
      commodityId,
      mandiId,
      trainingDataEndDate,
      '2026-04-04',
      180,
      Math.max(...horizons),
      JSON.stringify({ source: 'test' }),
      generatedAt,
    ]
  );
  const runId = run.rows[0].id;

  for (const horizon of horizons) {
    const target = new Date(`${lastObservedDate}T00:00:00Z`);
    target.setUTCDate(target.getUTCDate() + horizon);
    const predicted = basePrice + horizon * 4;
    await client.query(
      `INSERT INTO forecasts (
         run_id, commodity_id, mandi_id, forecast_date, horizon_days, predicted_price,
         lower_bound, upper_bound, interval_level, confidence, unit, model_version,
         training_data_end_date, last_observed_price, last_observed_date,
         is_sample_data, data_source, generated_at
       ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, 0.8, $9, 'INR/quintal', $10,
                 $11::date, $12, $13::date, TRUE, 'FIXTURE', $14::timestamptz)
       ON CONFLICT ON CONSTRAINT uq_forecasts_market_target_model DO UPDATE SET
         predicted_price = EXCLUDED.predicted_price,
         lower_bound = EXCLUDED.lower_bound,
         upper_bound = EXCLUDED.upper_bound,
         confidence = EXCLUDED.confidence,
         run_id = EXCLUDED.run_id,
         generated_at = EXCLUDED.generated_at`,
      [
        runId,
        commodityId,
        mandiId,
        target.toISOString().slice(0, 10),
        horizon,
        predicted,
        predicted - 30,
        predicted + 30,
        70 - horizon,
        modelVersion,
        trainingDataEndDate,
        lastObservedPrice,
        lastObservedDate,
        generatedAt,
      ]
    );
  }
  return runId;
}

export async function markForecastRunGenuine(client, runId) {
  assertIsolatedDatabase();
  await client.query(`UPDATE forecast_runs SET is_sample_data = FALSE, data_source = 'DATABASE' WHERE id = $1`, [runId]);
  await client.query(`UPDATE forecasts SET is_sample_data = FALSE, data_source = 'DATABASE' WHERE run_id = $1`, [runId]);
  return runId;
}

export default {
  FIXTURE_FLAG,
  FIXTURE_MODEL_VERSION,
  createForecastEntities,
  markForecastRunGenuine,
  seedForecasts,
  seedPriceHistory,
};
