/**
 * Operator command for a single mandi ingestion run (the HTTP endpoint is closed
 * until an admin role is approved).
 *
 *   npm run mandi:sync -- --provider=DATA_GOV_IN --days=3 --confirm-db=fasalytics
 *   npm run mandi:sync -- --provider=CEDA --commodity=Onion --state=Maharashtra \
 *        --district=Nashik --from=2026-09-01 --to=2026-09-30 --confirm-db=fasalytics
 *
 * Options: --state --district --commodity --from --to --days --max-records --cross-source
 * Writes to PostgreSQL only with --confirm-db matching the configured DB_NAME.
 */
import { MandiPipeline } from '../src/pipeline/index.js';
import { pool } from '../src/db.js';
import { config } from '../src/config/index.js';
import { redactText } from '../src/pipeline/http.js';
import { validateSyncRequest } from '../src/validators/mandi.validator.js';
import { abortOnSignals, parseArgs, requireDatabaseConfirmation } from './cli-utils.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const parsed = validateSyncRequest({
    provider: args.provider,
    state: args.state,
    district: args.district,
    commodity: args.commodity,
    fromDate: args.from,
    toDate: args.to,
    days: args.days,
    maxRecords: args['max-records'],
    crossSource: args['cross-source'] === true ? true : undefined,
  });
  if (parsed.errors) throw new Error(parsed.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  const database = requireDatabaseConfirmation(args);
  console.log(`[mandi:sync] provider=${parsed.value.provider} database=${database}`);

  const controller = abortOnSignals();
  const result = await new MandiPipeline().runPipeline({ ...parsed.value, signal: controller.signal, triggeredBy: 'cli' });
  console.log(JSON.stringify(result, null, 2));
  if (!['SUCCESS', 'NO_DATA'].includes(result.status)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`[mandi:sync] ${redactText(err.message, [config.mandi.dataGovApiKey, config.mandi.cedaApiKey])}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
