import { pool as defaultPool } from '../db.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Forecasting read service (Phase 4).
 *
 * Forecasts are produced offline by the Phase 4 training/generation commands
 * (`npm run forecast:train`, `npm run forecast:generate`) and stored in the
 * `forecasts` / `forecast_runs` tables. This service only *reads* them — the
 * backend never trains a model or invents a price.
 *
 * Observed prices (`last_observed_price` / `last_observed_date`) are carried on
 * every row so a client can always tell a *forecast* apart from what the market
 * actually reported.
 */

const FORECAST_COLUMNS = `
  f.id, f.forecast_date, f.horizon_days, f.predicted_price, f.lower_bound, f.upper_bound,
  f.interval_level, f.confidence, f.unit, f.model_version, f.training_data_end_date,
  f.last_observed_price, f.last_observed_date, f.is_sample_data, f.data_source,
  f.generated_at, f.run_id`;

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

function shapeForecast(row) {
  return {
    ...row,
    horizon_days: Number(row.horizon_days),
    predicted_price: toNumber(row.predicted_price),
    lower_bound: toNumber(row.lower_bound),
    upper_bound: toNumber(row.upper_bound),
    interval_level: toNumber(row.interval_level),
    confidence: toNumber(row.confidence),
    last_observed_price: toNumber(row.last_observed_price),
  };
}

export class ForecastService {
  constructor({ pool = defaultPool } = {}) {
    this.pool = pool;
  }

  /** Exact identity lookup for a mandi, mirroring the Phase 3 convention. */
  async resolveMandi(reference) {
    const result = await this.pool.query(
      `SELECT id, code, name, hindi_name, marathi_name, state, district
       FROM mandis
       WHERE is_active = TRUE
         AND (id::text = $1 OR UPPER(code) = UPPER($1) OR UPPER(name) = UPPER($1))
       ORDER BY id LIMIT 1`,
      [String(reference).trim()]
    );
    return result.rows[0] ?? null;
  }

  async resolveCommodity(reference) {
    const result = await this.pool.query(
      `SELECT id, code, name, hindi_name, marathi_name, category, standard_unit
       FROM commodities
       WHERE is_active = TRUE
         AND (id::text = $1 OR UPPER(code) = UPPER($1) OR UPPER(name) = UPPER($1))
       ORDER BY id LIMIT 1`,
      [String(reference).trim()]
    );
    return result.rows[0] ?? null;
  }

  /** History length, so an empty forecast can be explained honestly. */
  async observationStats({ mandiId, commodityId }) {
    const result = await this.pool.query(
      `SELECT COUNT(*) AS observations, MIN(price_date) AS start_date, MAX(price_date) AS end_date,
              BOOL_AND(is_sample_data) AS only_sample
       FROM mandi_prices WHERE mandi_id = $1 AND commodity_id = $2`,
      [mandiId, commodityId]
    );
    const row = result.rows[0] ?? {};
    return {
      observations: Number(row.observations ?? 0),
      start_date: row.start_date ?? null,
      end_date: row.end_date ?? null,
      only_sample: row.only_sample ?? null,
    };
  }

  /** Distinct model versions that have stored forecasts for this pair. */
  async availableModelVersions({ mandiId, commodityId }) {
    try {
      const result = await this.pool.query(
        `SELECT DISTINCT model_version FROM forecasts
         WHERE mandi_id = $1 AND commodity_id = $2 ORDER BY model_version`,
        [mandiId, commodityId]
      );
      return result.rows.map((row) => row.model_version);
    } catch (err) {
      if (err.code === '42P01') return [];
      throw err;
    }
  }

  /**
   * Latest persisted forecast set for one (commodity, mandi).
   *
   * "Latest" is resolved per series (newest `generated_at`, then newest run id), so
   * a newest-first ordering never mixes rows produced by two different runs.
   */
  async getForecast({
    mandiId,
    commodityId,
    horizon,
    modelVersion,
    includeSample = true,
    order = 'ASC',
  } = {}) {
    const values = [commodityId, mandiId];
    const conditions = ['f.commodity_id = $1', 'f.mandi_id = $2'];
    if (modelVersion) {
      values.push(modelVersion);
      conditions.push(`f.model_version = $${values.length}`);
    }
    if (horizon !== undefined && horizon !== null) {
      values.push(horizon);
      conditions.push(`f.horizon_days = $${values.length}`);
    }
    if (includeSample === false) conditions.push('f.is_sample_data = FALSE');

    const sql = `
      WITH scoped AS (
        SELECT ${FORECAST_COLUMNS}
        FROM forecasts f
        WHERE ${conditions.join(' AND ')}
      ), latest AS (
        SELECT MAX(generated_at) AS generated_at FROM scoped
      )
      SELECT s.*, r.history_start_date, r.observations_used, r.data_source AS run_data_source,
             COUNT(*) OVER () AS total_count
      FROM scoped s
      JOIN latest l ON s.generated_at = l.generated_at
      LEFT JOIN forecast_runs r ON r.id = s.run_id
      ORDER BY s.horizon_days ${order === 'DESC' ? 'DESC' : 'ASC'}, s.forecast_date ASC, s.id ASC`;

    try {
      const result = await this.pool.query(sql, values);
      const rows = result.rows.map(({ total_count: _t, ...row }) => shapeForecast(row));
      return {
        rows,
        total: Number(result.rows[0]?.total_count ?? 0),
        run: rows.length
          ? {
              run_id: rows[0].run_id,
              model_version: rows[0].model_version,
              generated_at: rows[0].generated_at,
              training_data_end_date: rows[0].training_data_end_date,
              history_start_date: rows[0].history_start_date ?? null,
              observations_used: rows[0].observations_used ?? null,
              data_source: rows[0].data_source,
              is_sample_data: rows[0].is_sample_data,
              interval_level: rows[0].interval_level,
              last_observed_price: rows[0].last_observed_price,
              last_observed_date: rows[0].last_observed_date,
            }
          : null,
      };
    } catch (err) {
      if (err.code === '42P01') {
        return { rows: [], total: 0, run: null };
      }
      throw err;
    }
  }

  /**
   * Full read for the API: resolves identities, then returns forecasts or an
   * explicit, actionable reason why none can be shown. Never fabricates a price.
   */
  async lookup({ commodity, mandi, horizon, modelVersion, includeSample = true, order = 'ASC' }) {
    const [commodityRow, mandiRow] = await Promise.all([
      this.resolveCommodity(commodity),
      this.resolveMandi(mandi),
    ]);
    if (!commodityRow) {
      throw new HttpError(404, 'COMMODITY_NOT_FOUND', `No commodity matches "${commodity}".`);
    }
    if (!mandiRow) {
      throw new HttpError(404, 'MANDI_NOT_FOUND', `No mandi matches "${mandi}".`);
    }

    const ids = { mandiId: mandiRow.id, commodityId: commodityRow.id };
    const [forecast, observationStats, modelVersions] = await Promise.all([
      this.getForecast({ ...ids, horizon, modelVersion, includeSample, order }),
      this.observationStats(ids),
      this.availableModelVersions(ids),
    ]);

    const hasForecast = forecast.rows.length > 0;
    return {
      commodity: commodityRow,
      mandi: mandiRow,
      forecast,
      observationStats,
      modelVersions,
      hasForecast,
    };
  }
}

export default new ForecastService();
