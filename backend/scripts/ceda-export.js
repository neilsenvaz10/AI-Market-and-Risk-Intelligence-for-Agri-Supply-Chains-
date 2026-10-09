/**
 * CEDA historical export (and optional import) for ONE commodity in ONE district.
 *
 *   npm run ceda:export -- --commodity=Onion --state=Maharashtra --district=Nashik \
 *        --from=2026-09-01 --to=2026-09-30 [--window-days=31] [--out-dir=data/mandi]
 *        [--min-free-gb=20] [--budget-mb=500] [--max-tasks=1] [--no-raw]
 *        [--import --confirm-db=fasalytics]
 *   npm run ceda:export -- --import-manifest=<path> --confirm-db=fasalytics
 *   npm run ceda:export -- --commodity=Onion --state=Maharashtra --district=Nashik --discover-only
 *        (3 small discovery calls: resolves ids and markets, downloads no prices, writes nothing)
 *
 * Files: gzip CSV per date window + raw JSON responses + a checkpoint manifest.
 * Re-running the same command resumes: finished windows are skipped.
 * Dates must lie inside 2021-10-01..2026-09-30. Ctrl+C stops after the current window.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config/index.js';
import { redactText } from '../src/pipeline/http.js';
import { pool } from '../src/db.js';
import { CedaProvider } from '../src/pipeline/providers/ceda.provider.js';
import { MandiPersister } from '../src/pipeline/persister.js';
import { exportExitCode, importCedaExport, runCedaExport } from '../src/pipeline/historical/ceda-export.js';
import { abortOnSignals, parseArgs, requireDatabaseConfirmation } from './cli-utils.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const positiveInt = (value, name, fallback) => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new Error(`--${name} must be a positive whole number`);
  return Number(value);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const historical = config.mandi.historical;

  if (args['import-manifest']) {
    requireDatabaseConfirmation(args);
    const totals = await importCedaExport({ manifestPath: path.resolve(args['import-manifest']), persister: new MandiPersister({ pool }) });
    console.log(JSON.stringify(totals, null, 2));
    return;
  }

  const required = args['discover-only'] ? ['commodity', 'state', 'district'] : ['commodity', 'state', 'district', 'from', 'to'];
  for (const name of required) {
    if (!args[name] || args[name] === true) throw new Error(`--${name} is required`);
  }
  if (args['discover-only']) {
    const provider = new CedaProvider({ apiKey: config.mandi.cedaApiKey, baseUrl: config.mandi.cedaApiUrl, httpOptions: config.mandi.http });
    const scope = await provider.resolveScope({ commodity: args.commodity, state: args.state, district: args.district });
    console.log(JSON.stringify({ commodity: { id: scope.commodityId, name: scope.commodityName }, state: { id: scope.stateId, name: scope.stateName }, district: { id: scope.districtId, name: scope.districtName }, marketCount: scope.markets.length, markets: scope.markets.slice(0, 25) }, null, 2));
    return;
  }
  const persister = args.import ? (requireDatabaseConfirmation(args), new MandiPersister({ pool })) : null;
  const outDir = path.resolve(backendDir, args['out-dir'] || historical.outputDir || 'data/mandi');
  const provider = new CedaProvider({ apiKey: config.mandi.cedaApiKey, baseUrl: config.mandi.cedaApiUrl, httpOptions: config.mandi.http });
  const controller = abortOnSignals();

  console.log(`[ceda:export] ${args.commodity} / ${args.state} / ${args.district} ${args.from}..${args.to} -> ${outDir}`);
  const summary = await runCedaExport({
    provider,
    commodity: args.commodity,
    state: args.state,
    district: args.district,
    fromDate: args.from,
    toDate: args.to,
    outDir,
    windowDays: positiveInt(args['window-days'], 'window-days', historical.windowDays),
    minFreeGb: positiveInt(args['min-free-gb'], 'min-free-gb', historical.minFreeDiskGb),
    budgetMb: positiveInt(args['budget-mb'], 'budget-mb', historical.downloadBudgetMb),
    maxTasks: args['max-tasks'] === undefined ? Infinity : positiveInt(args['max-tasks'], 'max-tasks'),
    saveRaw: !args['no-raw'],
    persister,
    signal: controller.signal,
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = exportExitCode(summary);
}

main()
  .catch((err) => {
    console.error(`[ceda:export] ${redactText(err.message, [config.mandi.cedaApiKey])}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
