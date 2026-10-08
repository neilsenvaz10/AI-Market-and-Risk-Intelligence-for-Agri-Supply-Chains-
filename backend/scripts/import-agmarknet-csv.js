/**
 * Imports an official AGMARKNET commodity-level Price & Arrival CSV into PostgreSQL.
 *
 * Usage:
 *   node scripts/import-agmarknet-csv.js [--file=path/to/report.csv] --confirm-db=fasalytics
 *   npm run agmarknet:import -- --confirm-db=fasalytics
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { parseAgmarknetCsv, importAgmarknetRecords } from '../src/pipeline/historical/agmarknet-import.js';
import { parseArgs, requireDatabaseConfirmation } from './cli-utils.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireDatabaseConfirmation(args);

  const defaultPath = path.resolve(backendDir, 'data/mandi/agmarknet/Market_Wise_Price_Arrival_09-10-2026_01-26-14_AM.csv');
  const filePath = path.resolve(backendDir, args.file || defaultPath);

  console.log(`[AGMARKNET:Import] Reading CSV: ${filePath}`);
  const records = parseAgmarknetCsv(filePath);
  console.log(`[AGMARKNET:Import] Parsed ${records.length} unpivoted observations across ${new Set(records.map(r => r.commodity_name)).size} commodities and ${new Set(records.map(r => r.report_date)).size} dates.`);

  const nullPrices = records.filter(r => r.modal_price === null).length;
  const nullArrivals = records.filter(r => r.arrivals_quantity === null).length;
  console.log(`[AGMARKNET:Import] Data quality: ${records.length - nullPrices} valid prices (${nullPrices} NULL), ${records.length - nullArrivals} valid arrivals (${nullArrivals} NULL).`);

  const result = await importAgmarknetRecords(pool, records);
  console.log(`[AGMARKNET:Import] Persisted to database: inserted=${result.inserted}, updated=${result.updated}, unchanged=${result.unchanged}, total=${result.total}`);
}

main()
  .catch((err) => {
    console.error(`[AGMARKNET:Import] Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
