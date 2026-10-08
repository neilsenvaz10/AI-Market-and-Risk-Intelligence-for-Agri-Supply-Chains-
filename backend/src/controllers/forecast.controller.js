import defaultForecastService from '../services/forecast.service.js';
import { HttpError, mapDatabaseError } from '../utils/httpError.js';
import { validateForecastPath, validateForecastQuery, MAX_HORIZON } from '../validators/forecast.validator.js';

const invalid = (errors) =>
  new HttpError(400, 'VALIDATION_ERROR', 'One or more request parameters are invalid.', errors);

function parse(validator, input) {
  const result = validator(input);
  if (result.errors) throw invalid(result.errors);
  return result.value;
}

/**
 * Explains an empty forecast set without inventing prices. This distinction is
 * what lets the UI show the correct state:
 *   - no price history at all              -> NO_MARKET_DATA
 *   - history exists but is too short      -> INSUFFICIENT_HISTORY (needs >= 21 rows)
 *   - history is fine, nothing trained yet -> NO_FORECAST
 *   - requested filter matched nothing     -> NO_FORECAST_FOR_FILTER
 * `MIN_OBSERVATIONS` mirrors ml-service/forecasting/features.py (MIN_HISTORY + max horizon).
 */
const MIN_OBSERVATIONS = 21;

function emptyReason({ observationStats, modelVersions, horizon, modelVersion }) {
  if (observationStats.observations === 0) {
    return {
      code: 'NO_MARKET_DATA',
      message: 'No mandi price history has been recorded for this commodity and mandi.',
    };
  }
  if (observationStats.observations < MIN_OBSERVATIONS) {
    return {
      code: 'INSUFFICIENT_HISTORY',
      message:
        `Only ${observationStats.observations} price observation(s) are recorded; at least ` +
        `${MIN_OBSERVATIONS} are required to generate a forecast.`,
    };
  }
  if (modelVersions.length === 0) {
    return {
      code: 'NO_FORECAST',
      message:
        'No forecast has been generated yet. Run "npm run forecast:train" followed by ' +
        '"npm run forecast:generate".',
    };
  }
  const filter = [modelVersion ? `model version "${modelVersion}"` : null, horizon ? `horizon ${horizon}` : null]
    .filter(Boolean)
    .join(' and ');
  return {
    code: 'NO_FORECAST_FOR_FILTER',
    message: filter
      ? `No stored forecast matches ${filter}. Available model version(s): ${modelVersions.join(', ')}.`
      : 'No stored forecast matches the requested filter.',
  };
}

/** Builds the forecast controller; the service is injectable for tests. */
export function createForecastController({ forecastService = defaultForecastService } = {}) {
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(mapDatabaseError(err));
    }
  };

  return {
    /** GET /api/forecast/:commodity/:mandi */
    getForecast: handle(async (req, res) => {
      const path = parse(validateForecastPath, req.params);
      const query = parse(validateForecastQuery, req.query);

      const result = await forecastService.lookup({
        commodity: path.commodity,
        mandi: path.mandi,
        horizon: query.horizon,
        modelVersion: query.modelVersion,
        includeSample: query.includeSample,
        order: query.order,
      });

      const { commodity, mandi, forecast, observationStats, modelVersions, hasForecast } = result;
      const reason = hasForecast
        ? null
        : emptyReason({
            observationStats,
            modelVersions,
            horizon: query.horizon,
            modelVersion: query.modelVersion,
          });

      res.status(200).json({
        status: 'success',
        available: hasForecast,
        reason,
        commodity: {
          id: commodity.id,
          code: commodity.code,
          name: commodity.name,
          hindi_name: commodity.hindi_name,
          marathi_name: commodity.marathi_name,
          category: commodity.category,
          unit: commodity.standard_unit ? `INR/${commodity.standard_unit}` : 'INR/quintal',
        },
        mandi: {
          id: mandi.id,
          code: mandi.code,
          name: mandi.name,
          state: mandi.state,
          district: mandi.district,
        },
        history: observationStats,
        requested: {
          horizon: query.horizon ?? null,
          model_version: query.modelVersion ?? null,
          max_horizon: MAX_HORIZON,
        },
        available_model_versions: modelVersions,
        meta: forecast.run
          ? {
              model_version: forecast.run.model_version,
              generated_at: forecast.run.generated_at,
              training_data_end_date: forecast.run.training_data_end_date,
              history_start_date: forecast.run.history_start_date,
              observations_used: forecast.run.observations_used,
              data_source: forecast.run.data_source,
              is_sample_data: forecast.run.is_sample_data,
              interval_level: forecast.run.interval_level,
              last_observed_price: forecast.run.last_observed_price,
              last_observed_date: forecast.run.last_observed_date,
              unit: forecast.rows[0]?.unit ?? 'INR/quintal',
              count: forecast.rows.length,
              // Forecasts are estimates with uncertainty, never guaranteed prices.
              disclaimer:
                'Forecast estimates only. Prices are not guaranteed; lower/upper bounds describe ' +
                'the prediction interval measured on held-out history.',
            }
          : null,
        data: forecast.rows,
      });
    }),
  };
}

export default createForecastController();
export { MIN_OBSERVATIONS };
