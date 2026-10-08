/**
 * Phase 4 — train the price forecasting models and evaluate them.
 *
 *   npm run forecast:train                          # train on every series in the database
 *   npm run forecast:train -- --fixture             # seed + train on the DEVELOPMENT FIXTURE
 *   npm run forecast:train -- --commodity=ONION --mandi=MH_PUNE_APMC
 *   npm run forecast:train -- --candidates=ridge_autoregressive
 *   npm run forecast:train -- --fixture --generate  # train, then generate forecasts
 *
 * Add --json for the full machine-readable report. The Python CLI
 * (ml-service/forecasting/cli.py) documents every remaining flag; this script only
 * locates the virtualenv and forwards the arguments.
 */
import { runForecasting } from './lib/mlPython.js';

runForecasting(['train', ...process.argv.slice(2)]);
