import { pool as defaultPool } from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { calculateRiskProfile } from './risk.engine.js';

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

export class RiskService {
  constructor({ pool = defaultPool } = {}) {
    this.pool = pool;
  }

  /**
   * Exact identity lookup for a mandi, mirroring Phase 3/4 conventions.
   */
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

  /**
   * Exact identity lookup for a commodity.
   */
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

  /**
   * Fetches genuine historical prices for one mandi/commodity pair.
   */
  async getMandiPrices({ mandiId, commodityId, includeSample = false }) {
    const values = [mandiId, commodityId];
    const sampleFilter = includeSample
      ? ''
      : "AND is_sample_data = FALSE AND source != 'MOCK_PROVIDER'";

    const sql = `
      SELECT price_date, modal_price, min_price, max_price, arrivals_quantity,
             arrival_unit, price_unit, source, is_sample_data, quality_flags
      FROM mandi_prices
      WHERE mandi_id = $1 AND commodity_id = $2
        ${sampleFilter}
      ORDER BY price_date ASC`;

    const result = await this.pool.query(sql, values);
    return result.rows.map((row) => ({
      ...row,
      modal_price: toNumber(row.modal_price),
      min_price: toNumber(row.min_price),
      max_price: toNumber(row.max_price),
      arrivals_quantity: toNumber(row.arrivals_quantity),
    }));
  }

  /**
   * Fetches latest forecast rows for one mandi/commodity pair.
   */
  async getForecasts({ mandiId, commodityId, includeSample = false }) {
    const values = [commodityId, mandiId];
    const sampleFilter = includeSample
      ? ''
      : "AND f.is_sample_data = FALSE AND f.data_source != 'FIXTURE'";

    const sql = `
      WITH scoped AS (
        SELECT f.id, f.forecast_date, f.horizon_days, f.predicted_price,
               f.lower_bound, f.upper_bound, f.interval_level, f.confidence,
               f.unit, f.model_version, f.training_data_end_date,
               f.last_observed_price, f.last_observed_date, f.is_sample_data,
               f.data_source, f.generated_at, f.run_id
        FROM forecasts f
        WHERE f.commodity_id = $1 AND f.mandi_id = $2
          ${sampleFilter}
      ), latest AS (
        SELECT MAX(generated_at) AS generated_at FROM scoped
      )
      SELECT s.*
      FROM scoped s
      JOIN latest l ON s.generated_at = l.generated_at
      ORDER BY s.horizon_days ASC`;

    try {
      const result = await this.pool.query(sql, values);
      return result.rows.map((row) => ({
        ...row,
        horizon_days: Number(row.horizon_days),
        predicted_price: toNumber(row.predicted_price),
        lower_bound: toNumber(row.lower_bound),
        upper_bound: toNumber(row.upper_bound),
        interval_level: toNumber(row.interval_level),
        confidence: toNumber(row.confidence),
        last_observed_price: toNumber(row.last_observed_price),
      }));
    } catch (err) {
      if (err.code === '42P01') return [];
      throw err;
    }
  }

  /**
   * Detailed risk assessment for a specific commodity at a mandi.
   */
  async getMandiRisk({ commodity, mandi, includeSample = false, referenceDate = new Date() }) {
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

    const [prices, forecasts] = await Promise.all([
      this.getMandiPrices({ mandiId: mandiRow.id, commodityId: commodityRow.id, includeSample }),
      this.getForecasts({ mandiId: mandiRow.id, commodityId: commodityRow.id, includeSample }),
    ]);

    const riskProfile = calculateRiskProfile({
      prices,
      forecasts,
      referenceDate,
    });

    return {
      commodity: commodityRow,
      mandi: mandiRow,
      ...riskProfile,
      meta: {
        pricesCount: prices.length,
        forecastsCount: forecasts.length,
        includeSample,
        dataFilteredForGenuine: !includeSample,
      },
    };
  }

  /**
   * High-level risk intelligence summary across monitored mandis and commodities.
   */
  async getRiskSummary({ includeSample = false, referenceDate = new Date(), limit = 20 }) {
    const sampleFilter = includeSample
      ? ''
      : "WHERE mp.is_sample_data = FALSE AND mp.source != 'MOCK_PROVIDER'";

    // Distinct monitored pairs with price history
    const sql = `
      SELECT DISTINCT mp.commodity_id, mp.mandi_id,
             c.code AS commodity_code, c.name AS commodity_name, c.hindi_name AS commodity_hindi, c.marathi_name AS commodity_marathi,
             m.code AS mandi_code, m.name AS mandi_name, m.hindi_name AS mandi_hindi, m.marathi_name AS mandi_marathi,
             m.district, m.state
      FROM mandi_prices mp
      JOIN commodities c ON c.id = mp.commodity_id
      JOIN mandis m ON m.id = mp.mandi_id
      ${sampleFilter}
      ORDER BY c.name, m.name
      LIMIT $1`;

    const result = await this.pool.query(sql, [limit]);
    const seriesList = result.rows;

    const evaluatedSeries = [];
    const counts = { HIGH: 0, MODERATE: 0, LOW: 0, UNKNOWN: 0, total: 0 };
    const highRiskAlerts = [];

    for (const item of seriesList) {
      const [prices, forecasts] = await Promise.all([
        this.getMandiPrices({ mandiId: item.mandi_id, commodityId: item.commodity_id, includeSample }),
        this.getForecasts({ mandiId: item.mandi_id, commodityId: item.commodity_id, includeSample }),
      ]);

      const profile = calculateRiskProfile({ prices, forecasts, referenceDate });
      const overall = profile.overallLevel;

      counts[overall] = (counts[overall] || 0) + 1;
      counts.total += 1;

      const seriesSummary = {
        commodity: {
          id: item.commodity_id,
          code: item.commodity_code,
          name: item.commodity_name,
          hindi_name: item.commodity_hindi,
          marathi_name: item.commodity_marathi,
        },
        mandi: {
          id: item.mandi_id,
          code: item.mandi_code,
          name: item.mandi_name,
          hindi_name: item.mandi_hindi,
          marathi_name: item.mandi_marathi,
          district: item.district,
          state: item.state,
        },
        overallLevel: overall,
        summaryAdvice: profile.summaryAdvice,
        latestPrice: profile.latestPrice,
        latestPriceDate: profile.latestPriceDate,
        warningsCount: profile.warnings.length,
        warnings: profile.warnings,
        breakdownLevels: {
          priceDecline: profile.breakdown.priceDecline.level,
          volatility: profile.breakdown.volatility.level,
          arrivalSurge: profile.breakdown.arrivalSurge.level,
          forecastUncertainty: profile.breakdown.forecastUncertainty.level,
          dataFreshness: profile.breakdown.dataFreshness.level,
        },
      };

      evaluatedSeries.push(seriesSummary);

      if (overall === 'HIGH' || profile.warnings.some((w) => w.severity === 'HIGH')) {
        highRiskAlerts.push(seriesSummary);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      counts,
      highRiskAlerts,
      series: evaluatedSeries,
      meta: {
        totalMonitored: counts.total,
        includeSample,
        referenceDate: typeof referenceDate === 'string' ? referenceDate : referenceDate.toISOString().slice(0, 10),
      },
    };
  }
}

export default new RiskService();
