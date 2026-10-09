/**
 * Phase 4 — list the trained forecasting artefacts on disk.
 *
 *   npm run forecast:list
 *   npm run forecast:list -- --json
 */
import { runForecasting } from './lib/mlPython.js';

runForecasting(['list', ...process.argv.slice(2)]);
