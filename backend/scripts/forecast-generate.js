/**
 * Phase 4 — generate 1-7 day forecasts and persist them to PostgreSQL.
 *
 *   npm run forecast:generate                          # every trained artefact
 *   npm run forecast:generate -- --model-version=<v>   # one model version
 *   npm run forecast:generate -- --commodity=ONION --mandi=MH_PUNE_APMC
 *   npm run forecast:generate -- --dry-run             # compute without writing
 *
 * Forecasts are written to the Phase 4 `forecasts` / `forecast_runs` tables
 * (migration 006) and served read-only by GET /api/forecast/:commodity/:mandi.
 */
import { runForecasting } from './lib/mlPython.js';

runForecasting(['generate', ...process.argv.slice(2)]);
