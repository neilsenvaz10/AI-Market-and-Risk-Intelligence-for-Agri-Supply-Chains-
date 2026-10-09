import express from 'express';
import { createForecastController } from '../controllers/forecast.controller.js';

/**
 * Phase 4 Price Forecasting Routes
 *
 *   GET /api/forecast/:commodity/:mandi
 *       ?horizon=1..7          single future day (omit for all persisted horizons)
 *       ?modelVersion=<string> restrict to one trained model version
 *       ?includeSample=false   exclude forecasts derived from synthetic input
 *       ?order=ASC|DESC        horizon ordering (default ASC)
 *
 * Read-only and public, like the Phase 3 market-price endpoints: these are
 * persisted forecasts produced offline, never a live model call.
 *   400 invalid input, 404 unknown commodity/mandi, 503 database unavailable.
 * An unknown-but-valid pair with no forecast returns 200 with `available: false`
 * and an explicit `reason` — never a fabricated price.
 */
export function createForecastRoutes({ controller = createForecastController() } = {}) {
  const router = express.Router();
  router.get('/:commodity/:mandi', controller.getForecast);
  return router;
}

export default createForecastRoutes;
