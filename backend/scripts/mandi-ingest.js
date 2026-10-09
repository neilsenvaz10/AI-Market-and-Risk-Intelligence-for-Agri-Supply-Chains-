/**
 * Phase 5 MANDI INGESTION ORCHESTRATOR (operator CLI).
 *
 *   node scripts/mandi-ingest.js <subcommand> [options]
 *   npm run mandi:ingest -- <subcommand> [options]
 *   node scripts/mandi-ingest.js --help
 *
 * Subcommands
 *   sources      list every configured source, credential PRESENT/ABSENT (never the key),
 *                base URL and reachability verdict.                          read-only
 *   discover     list available commodities / markets / geographies.         read-only
 *   sample       pull a SMALL authorised sample and print it.               no DB writes
 *   preview      normalise + validate + dedup a small live batch and print exactly what
 *                WOULD be written.                                          no DB writes
 *   incremental  last-N-days incremental ingestion: fetch -> normalise -> validate ->
 *                dedup -> persist, per provider, under the pipeline advisory lock.
 *   historical   CEDA 5-year backfill runner. REQUIRES the literal
 *                --confirm-full-run=<CONFIRM_FULL_RUN_TOKEN>; without it the command
 *                refuses and only prints the storage-estimation preflight.
 *   resume       continue an interrupted historical run from the manifest. Needs no
 *                confirmation: it can only ever REDUCE the remaining work.
 *   status       last successful run per source, pending windows, counts, conflicts.
 *   estimate     storage-estimation preflight: free disk + measured bytes/row -> verdict,
 *                printed WITHOUT downloading anything.
 *   cleanup      OPT-IN deletion of raw downloaded files. REQUIRES the literal
 *                --confirm-cleanup=<CONFIRM_CLEANUP_TOKEN>. Never touches the database.
 *
 * Honesty and safety rules enforced here
 *   - no subcommand ever prints a fabricated price: an unreachable or unauthorised source
 *     is reported as a failure, never papered over with synthetic rows;
 *   - every write path is preceded by `assertMinimumFree` (MANDI_MIN_FREE_DISK_GB, default
 *     20 GB, never below the module HARD_FLOOR_GB of 10 GB) and a `createBudget` check
 *     (DEFAULT_BUDGET_GB = 10 GB) before each batch — both fail CLOSED;
 *   - checkpoint manifests are written atomically (temp file + rename + sha256 integrity
 *     block), so a crash mid-run leaves a consistent, resumable state;
 *   - every credential that could reach an error message or an output line goes through
 *     `redactText` together with the ACTUAL configured key values.
 *
 * Exit codes
 *   0  success
 *   1  error (usage, provider failure, unknown manifest, ...)
 *   2  safety refusal (budget, disk floor, free space unknown, missing confirmation token,
 *      a requested cap beyond the hard limit)
 *   3  blocked (missing credential, unreachable source, unreachable database)
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../src/config/index.js';
import { redactText, redactUrl } from '../src/pipeline/http.js';
import { MandiPipeline, PIPELINE_LOCK_ID, planIncrementalWindow } from '../src/pipeline/index.js';
import { CedaProvider, CEDA_HISTORICAL_END, CEDA_HISTORICAL_START, buildCedaRecords, splitDateRange } from '../src/pipeline/providers/ceda.provider.js';
import { DataGovInProvider } from '../src/pipeline/providers/data-gov-in.provider.js';
import { normalizeMandiRecord } from '../src/pipeline/normalizer.js';
import { validateMandiRecord } from '../src/pipeline/validator.js';
import { deduplicateRecords } from '../src/pipeline/deduplicator.js';
import { deriveCanonicalFields } from '../src/pipeline/canonical.js';
import { CSV_COLUMNS, clampToHistoricalWindow } from '../src/pipeline/historical/ceda-export.js';
import { createCsvGzWriter } from '../src/pipeline/storage/csvGzWriter.js';
import { GB, HARD_FLOOR_GB, assertMinimumFree, availableBytes, estimateRunBytes, resolveMinFreeGb } from '../src/pipeline/storage/diskGuard.js';
import { DEFAULT_BUDGET_GB, createBudget, measureDirectory } from '../src/pipeline/storage/budget.js';
import { createManifest, isWindowComplete, loadManifest, markWindowComplete, markWindowFailed, saveManifest } from '../src/pipeline/storage/manifest.js';
import { createQualityReportService } from '../src/services/qualityReport.service.js';
import { abortOnSignals, parseArgs, requireDatabaseConfirmation } from './cli-utils.js';
import { checkTcp } from './live-preflight.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── exit codes, confirmation tokens, hard caps ─────────────────────────────

export const EXIT = Object.freeze({ SUCCESS: 0, ERROR: 1, SAFETY_REFUSAL: 2, BLOCKED: 3 });

/** The exact literal required by `historical --confirm-full-run=`. */
export const CONFIRM_FULL_RUN_TOKEN = 'YES-DOWNLOAD-FIVE-YEAR-NATIONWIDE-HISTORICAL-BACKFILL';
/** The exact literal required by `cleanup --confirm-cleanup=`. */
export const CONFIRM_CLEANUP_TOKEN = 'YES-DELETE-RAW-DOWNLOADED-DATA';

export const SAMPLE_MAX_DAYS = 7;
export const SAMPLE_DEFAULT_DAYS = 1;
export const SAMPLE_MAX_PAGES = 5;
export const SAMPLE_DEFAULT_PAGES = 2;
export const SAMPLE_PAGE_SIZE = 500;
export const SAMPLE_DEFAULT_LIMIT = 100;
export const SAMPLE_MAX_LIMIT = SAMPLE_MAX_PAGES * SAMPLE_PAGE_SIZE;
export const HISTORICAL_DEFAULT_MAX_ROWS = 1_000_000;
export const HISTORICAL_MANIFEST = 'manifest_historical.json';

/** Credential-bearing HTTP failures, disk/budget failures and our own refusals. */
const SAFETY_CODES = new Set([
  'SAFETY_REFUSAL', 'INSUFFICIENT_DISK_SPACE', 'DISK_SPACE_UNKNOWN', 'LOW_DISK_SPACE',
  'WORKING_BUDGET_EXCEEDED', 'BELOW_DISK_FLOOR', 'WOULD_BREACH_DISK_FLOOR', 'DOWNLOAD_BUDGET_EXCEEDED',
]);
const BLOCKED_CODES = new Set([
  'SOURCE_NOT_CONFIGURED', 'SOURCE_BLOCKED', 'DB_UNAVAILABLE', 'UNAUTHORIZED', 'RATE_LIMITED',
  'NETWORK_ERROR', 'TIMEOUT', 'HTTP_ERROR', 'INVALID_JSON', 'NOT_FOUND',
]);

export const SOURCE_KEYS = Object.freeze(['ceda', 'data-gov-in']);

const SOURCE_REGISTRY = Object.freeze([
  {
    key: 'ceda',
    code: 'CEDA',
    label: 'CEDA, Ashoka University (Agmarknet)',
    credentialEnv: 'CEDA_API_KEY',
    host: 'api.ceda.ashoka.edu.in',
    baseUrl: (m) => m.cedaApiUrl,
    apiKey: (m) => m.cedaApiKey,
    mode: 'HISTORICAL',
    boundedBy: `${CEDA_HISTORICAL_START}..${CEDA_HISTORICAL_END}`,
  },
  {
    key: 'data-gov-in',
    code: 'DATA_GOV_IN',
    label: 'data.gov.in (DMI current daily mandi prices)',
    credentialEnv: 'DATA_GOV_IN_API_KEY',
    host: 'api.data.gov.in',
    baseUrl: (m) => m.dataGovApiUrl,
    apiKey: (m) => m.dataGovApiKey,
    mode: 'INCREMENTAL',
    boundedBy: 'daily current prices (rolling window only)',
  },
]);

// ── typed failures ─────────────────────────────────────────────────────────

export class SafetyRefusalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SafetyRefusalError';
    this.code = 'SAFETY_REFUSAL';
    this.details = details;
  }
}

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.code = 'USAGE';
  }
}

/** Maps any failure to the documented exit code. Unknown failures are errors (1). */
export function exitCodeForError(err) {
  const code = err?.code ?? null;
  if (SAFETY_CODES.has(code)) return EXIT.SAFETY_REFUSAL;
  if (BLOCKED_CODES.has(code)) return EXIT.BLOCKED;
  return EXIT.ERROR;
}

// ── redaction ──────────────────────────────────────────────────────────────

/** Every configured secret that must never reach an output line or a stored message. */
export function secretValues(mandiConfig = config.mandi, appConfig = config) {
  return [
    mandiConfig?.dataGovApiKey,
    mandiConfig?.cedaApiKey,
    appConfig?.firebase?.privateKey,
    appConfig?.firebase?.serviceAccountPath,
    appConfig?.email?.apiKey,
    appConfig?.database?.password,
    appConfig?.database?.connectionString,
  ].filter((value) => typeof value === 'string' && value.length >= 4);
}

/** Redacts free text with the ACTUAL configured credentials. */
export function safeText(text, secrets = secretValues()) {
  return redactText(text, secrets);
}

// ── option parsing ─────────────────────────────────────────────────────────

const HELP_TOKENS = new Set(['-h', '--help', 'help', '-?']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isoToday = (now = new Date()) => new Date(now).toISOString().slice(0, 10);
const addDays = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** `--flag` with no value means `true`; null/empty/absent all mean "not supplied". */
const valueOf = (value) => {
  if (value === undefined || value === null || value === true) return undefined;
  const text = String(value);
  return text === '' ? undefined : text;
};

function positiveInt(value, name, fallback, { max = undefined, capReason = null } = {}) {
  const raw = valueOf(value);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new UsageError(`--${name} must be a positive whole number`);
  const parsed = Number(raw);
  if (max !== undefined && parsed > max) {
    throw new SafetyRefusalError(
      `--${name}=${parsed} exceeds the hard cap of ${max}${capReason ? ` (${capReason})` : ''}`,
      { flag: name, requested: parsed, cap: max }
    );
  }
  return parsed;
}

function nonNegativeNumber(value, name, fallback) {
  const raw = valueOf(value);
  if (raw === undefined) return fallback;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new UsageError(`--${name} must be a non-negative number`);
  return Number(raw);
}

function requiredValue(value, name) {
  const raw = valueOf(value);
  if (raw === undefined || raw === '') throw new UsageError(`--${name} is required`);
  return raw;
}

function isoDay(value, name) {
  const raw = valueOf(value);
  if (raw === undefined) return null;
  if (!ISO_DAY.test(raw)) throw new UsageError(`--${name} must be an ISO calendar day (YYYY-MM-DD)`);
  return raw;
}

function assertDayOrder(from, to, label) {
  if (from > to) throw new UsageError(`${label}: --from (${from}) is after --to (${to})`);
  return { fromDate: from, toDate: to };
}

/**
 * Splits argv into the subcommand and its `--name=value` options using the shared
 * `cli-utils.parseArgs` (so `--name value`, secrets and unknown flags are all refused
 * exactly as in the other operator CLIs).
 */
export function parseCommandLine(argv = []) {
  const parsed = parseArgs(argv, { allowPositional: true });
  const positionals = parsed._ ?? [];
  const options = { ...parsed };
  delete options._;
  return { subcommand: positionals[0] ?? null, extraPositionals: positionals.slice(1), options };
}

export function resolveSourceOption(value, { required = false } = {}) {
  const raw = valueOf(value);
  if (raw === undefined || raw === '') {
    if (required) throw new UsageError(`--source is required (${SOURCE_KEYS.join(' or ')})`);
    return 'data-gov-in';
  }
  const key = raw.trim().toLowerCase();
  const aliases = { 'data-gov-in': 'data-gov-in', data_gov_in: 'data-gov-in', datagovin: 'data-gov-in', agmarknet: 'data-gov-in', ceda: 'ceda', all: 'all' };
  const resolved = aliases[key];
  if (!resolved) throw new UsageError(`--source must be one of: ${SOURCE_KEYS.join(', ')}, all`);
  return resolved;
}

function sourceDescriptor(key, mandiConfig = config.mandi) {
  const found = SOURCE_REGISTRY.find((entry) => entry.key === key);
  if (!found) throw new UsageError(`unknown source "${key}"`);
  return {
    ...found,
    baseUrlValue: found.baseUrl(mandiConfig),
    apiKeyValue: found.apiKey(mandiConfig),
  };
}

const commodityValue = (options) => valueOf(options.commodity) ?? null;
const stateValue = (options) => valueOf(options.state) ?? null;
const districtValue = (options) => valueOf(options.district) ?? null;

/** `ceda` needs a bounded commodity/state/district scope; the other sources do not. */
function assertCedaScope(source, { commodity, state, district }) {
  if (source !== 'ceda') return;
  if (!commodity) throw new UsageError('--commodity is required for --source=ceda (CEDA refuses unbounded sweeps)');
  if (!state) throw new UsageError('--state is required for --source=ceda');
  if (!district) throw new UsageError('--district is required for --source=ceda');
}

/** Options for `discover`. */
export function resolveDiscoverOptions(options = {}) {
  const source = resolveSourceOption(options.source, { required: true });
  return {
    source,
    limit: positiveInt(options.limit, 'limit', 50, { max: 500, capReason: 'discovery listings are capped' }),
    json: options.json === true,
  };
}

/** Options for `sample` and `preview`. Both enforce the same hard caps. */
export function resolveSampleOptions(options = {}, { today = isoToday(), source: forcedSource = null } = {}) {
  const source = forcedSource ?? resolveSourceOption(options.source);
  const days = positiveInt(options.days, 'days', SAMPLE_DEFAULT_DAYS, {
    max: SAMPLE_MAX_DAYS,
    capReason: `a sample must stay inside ${SAMPLE_MAX_DAYS} days; use the incremental command for wider windows`,
  });
  const maxPages = positiveInt(options['max-pages'], 'max-pages', SAMPLE_DEFAULT_PAGES, { max: SAMPLE_MAX_PAGES, capReason: 'page count is capped' });
  const limit = positiveInt(options.limit, 'limit', SAMPLE_DEFAULT_LIMIT, { max: SAMPLE_MAX_LIMIT, capReason: `at most ${SAMPLE_MAX_PAGES} pages x ${SAMPLE_PAGE_SIZE} rows` });
  const toDate = isoDay(options.to, 'to') ?? today;
  const fromDate = isoDay(options.from, 'from') ?? addDays(toDate, -(days - 1));
  assertCedaScope(source, { commodity: commodityValue(options), state: stateValue(options), district: districtValue(options) });
  if (fromDate > toDate) throw new UsageError(`--from (${fromDate}) is after --to (${toDate})`);
  return {
    source,
    days,
    limit,
    maxPages,
    maxRecords: Math.min(limit, maxPages * SAMPLE_PAGE_SIZE),
    fromDate,
    toDate,
    state: stateValue(options),
    district: districtValue(options),
    commodity: commodityValue(options),
    json: options.json === true,
  };
}

/** Options for `incremental`. */
export function resolveIncrementalOptions(options = {}, { mandiConfig = config.mandi } = {}) {
  const source = resolveSourceOption(options.source);
  return {
    source,
    lookbackDays: positiveInt(options['lookback-days'], 'lookback-days', mandiConfig.syncLookbackDays, { max: 30, capReason: 'the incremental window is capped at 30 days' }),
    maxRecords: positiveInt(options['max-records'], 'max-records', 2000),
    crossSource: options['cross-source'] === true,
    state: stateValue(options),
    district: districtValue(options),
    commodity: commodityValue(options),
    budgetGb: nonNegativeNumber(options['budget-gb'], 'budget-gb', DEFAULT_BUDGET_GB),
    minFreeGb: nonNegativeNumber(options['min-free-gb'], 'min-free-gb', resolveMinFreeGb(mandiConfig.historical.minFreeDiskGb)),
    outDir: resolveOutDir(options, mandiConfig),
    json: options.json === true,
  };
}

export function resolveOutDir(options = {}, mandiConfig = config.mandi) {
  const requested = valueOf(options['out-dir']);
  if (requested) return path.resolve(backendDir, requested);
  const configured = valueOf(mandiConfig.historical.outputDir);
  return path.resolve(backendDir, configured || 'data/mandi');
}

/** Options for `historical`. Confirmation is verified separately by cmdHistorical. */
export function resolveHistoricalOptions(options = {}, { mandiConfig = config.mandi } = {}) {
  const fromDate = isoDay(options.from, 'from') ?? CEDA_HISTORICAL_START;
  const toDate = isoDay(options.to, 'to') ?? CEDA_HISTORICAL_END;
  const commodity = commodityValue(options);
  const state = stateValue(options);
  const district = districtValue(options);
  if (!commodity) throw new UsageError('--commodity is required (a nationwide 5-year sweep is never run implicitly)');
  if (!state) throw new UsageError('--state is required');
  if (!district) throw new UsageError('--district is required');
  assertDayOrder(fromDate, toDate, 'historical');
  const range = clampToHistoricalWindow(fromDate, toDate);
  const confirmed = valueOf(options['confirm-full-run']) === CONFIRM_FULL_RUN_TOKEN;
  return {
    source: 'ceda',
    commodity,
    state,
    district,
    fromDate: range.from,
    toDate: range.to,
    windowDays: positiveInt(options['window-days'], 'window-days', mandiConfig.historical.windowDays, { max: 366, capReason: 'window length is capped at one year' }),
    maxRows: positiveInt(options['max-rows'], 'max-rows', HISTORICAL_DEFAULT_MAX_ROWS, {
      capReason: 'the row ceiling is a safety cap, not a licence to download everything',
    }),
    budgetGb: nonNegativeNumber(options['budget-gb'], 'budget-gb', DEFAULT_BUDGET_GB),
    minFreeGb: nonNegativeNumber(options['min-free-gb'], 'min-free-gb', resolveMinFreeGb(mandiConfig.historical.minFreeDiskGb)),
    outDir: resolveOutDir(options, mandiConfig),
    confirmed,
    confirmTokenSeen: valueOf(options['confirm-full-run']) !== undefined,
    dryRun: options['dry-run'] === undefined ? !confirmed : options['dry-run'] !== 'false',
    json: options.json === true,
  };
}

/** Options for `resume` — deliberately narrower than `historical`. */
export function resolveResumeOptions(options = {}, { mandiConfig = config.mandi } = {}) {
  return {
    fromDate: isoDay(options.from, 'from') ?? CEDA_HISTORICAL_START,
    toDate: isoDay(options.to, 'to') ?? CEDA_HISTORICAL_END,
    windowDays: positiveInt(options['window-days'], 'window-days', mandiConfig.historical.windowDays, { max: 366 }),
    maxRows: positiveInt(options['max-rows'], 'max-rows', HISTORICAL_DEFAULT_MAX_ROWS),
    budgetGb: nonNegativeNumber(options['budget-gb'], 'budget-gb', DEFAULT_BUDGET_GB),
    minFreeGb: nonNegativeNumber(options['min-free-gb'], 'min-free-gb', resolveMinFreeGb(mandiConfig.historical.minFreeDiskGb)),
    outDir: resolveOutDir(options, mandiConfig),
    printOnly: options['print-only'] === true,
    json: options.json === true,
  };
}

/** Options for `estimate`. */
export function resolveEstimateOptions(options = {}, { mandiConfig = config.mandi } = {}) {
  const fromDate = isoDay(options.from, 'from') ?? CEDA_HISTORICAL_START;
  const toDate = isoDay(options.to, 'to') ?? CEDA_HISTORICAL_END;
  assertDayOrder(fromDate, toDate, 'estimate');
  const assumedRows = valueOf(options['assumed-rows']);
  return {
    fromDate,
    toDate,
    days: daysBetween(fromDate, toDate),
    assumedRows: assumedRows === undefined ? null : positiveInt(assumedRows, 'assumed-rows'),
    budgetGb: nonNegativeNumber(options['budget-gb'], 'budget-gb', DEFAULT_BUDGET_GB),
    minFreeGb: nonNegativeNumber(options['min-free-gb'], 'min-free-gb', resolveMinFreeGb(mandiConfig.historical.minFreeDiskGb)),
    outDir: resolveOutDir(options, mandiConfig),
    json: options.json === true,
  };
}

/** Options for `cleanup`. */
export function resolveCleanupOptions(options = {}, { mandiConfig = config.mandi } = {}) {
  return {
    outDir: resolveOutDir(options, mandiConfig),
    token: valueOf(options['confirm-cleanup']),
    tokenSeen: valueOf(options['confirm-cleanup']) !== undefined,
    dryRun: options['dry-run'] === true,
    json: options.json === true,
  };
}

export function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * Cleanup deletes RAW downloaded payloads only, and only when the exact confirmation
 * literal is present. A wrong token is refused with the same safety exit code as a
 * missing one; nothing is ever removed.
 *
 * A `--dry-run` is exempt: it deletes nothing, so requiring a destructive
 * confirmation for it would train operators to paste the token reflexively.
 */
export function assertCleanupConfirmed(options) {
  const isDryRun = options['dry-run'] === true || valueOf(options['dry-run']) === 'true';
  if (isDryRun) return false;
  const token = valueOf(options['confirm-cleanup']);
  if (token === undefined) {
    throw new SafetyRefusalError(
      `cleanup deletes raw downloaded data and refuses to run without --confirm-cleanup=${CONFIRM_CLEANUP_TOKEN}. Nothing was deleted. Add --dry-run to preview without deleting.`,
      { token: CONFIRM_CLEANUP_TOKEN }
    );
  }
  if (token !== CONFIRM_CLEANUP_TOKEN) {
    throw new SafetyRefusalError(`--confirm-cleanup did not match the required literal "${CONFIRM_CLEANUP_TOKEN}". Nothing was deleted.`, {
      expected: CONFIRM_CLEANUP_TOKEN,
    });
  }
  return true;
}

/**
 * `historical` needs the literal confirmation token to download anything. Without it the
 * command refuses and falls back to the storage-estimation preflight.
 */
export function assertHistoricalConfirmed(options) {
  const token = valueOf(options['confirm-full-run']);
  if (token === undefined) {
    throw new SafetyRefusalError(
      `a ${options.fromDate ?? CEDA_HISTORICAL_START}..${options.toDate ?? CEDA_HISTORICAL_END} historical download is not started automatically. ` +
        `Re-run with --confirm-full-run=${CONFIRM_FULL_RUN_TOKEN} once you have read the estimate.`,
      { token: CONFIRM_FULL_RUN_TOKEN }
    );
  }
  if (token !== CONFIRM_FULL_RUN_TOKEN) {
    throw new SafetyRefusalError(
      `--confirm-full-run did not match the required literal "${CONFIRM_FULL_RUN_TOKEN}". Nothing was downloaded.`,
      { expected: CONFIRM_FULL_RUN_TOKEN }
    );
  }
  return true;
}

// ── providers ──────────────────────────────────────────────────────────────

/** The pool a handler should use: an injected fake in tests, otherwise the real one. */
async function resolvePool(deps = {}) {
  if (deps.db?.pool !== undefined) return deps.db.pool;
  if ('pool' in deps) return deps.pool;
  return import('../src/db.js').then((m) => m.pool);
}

export function createProvider(key, { mandiConfig = config.mandi, deps = {} } = {}) {
  if (key === 'ceda') {
    return new CedaProvider({
      apiKey: mandiConfig.cedaApiKey,
      baseUrl: mandiConfig.cedaApiUrl,
      httpOptions: deps.httpOptions ?? mandiConfig.http,
      windowDays: mandiConfig.historical.windowDays,
    });
  }
  if (key === 'data-gov-in') {
    return new DataGovInProvider({
      apiKey: mandiConfig.dataGovApiKey,
      apiUrl: mandiConfig.dataGovApiUrl,
      httpOptions: deps.httpOptions ?? mandiConfig.http,
    });
  }
  throw new UsageError(`unknown source "${key}"`);
}

// ── storage estimation preflight ───────────────────────────────────────────

const asNumber = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * MEASURED: free bytes on the data volume, bytes already used in the data directory,
 * bytes per row (from the database table when reachable, otherwise from the files on
 * disk against the rows recorded in the checkpoint manifest).
 * ESTIMATED: the full-run byte total, extrapolated from the measured bytes/row and the
 * planned day span (or from an explicit operator assumption passed as `assumedRows`).
 */
export async function estimateStorage({
  fromDate, toDate, days, assumedRows = null, budgetGb = DEFAULT_BUDGET_GB,
  minFreeGb = resolveMinFreeGb(config.mandi.historical.minFreeDiskGb), outDir,
  deps = {},
} = {}) {
  const measureDisk = deps.measureDisk ?? availableBytes;
  const budgetFactory = deps.createBudget ?? createBudget;
  const qualityFactory = deps.createQualityReportService ?? createQualityReportService;
  const db = deps.pool ?? null;

  const notes = [];
  let disk = null;
  let diskError = null;
  try {
    disk = await measureDisk(outDir);
  } catch (err) {
    diskError = safeText(err.message);
  }

  let usage = null;
  let free = null;
  let budgetError = null;
  try {
    const budget = budgetFactory({ dir: outDir, budgetGb, minFreeGb });
    const report = await budget.report();
    usage = report.usage;
    free = report.free;
    budgetError = report.floorSatisfied ? null : `free space is below the ${report.floor.gb} GB floor (hard floor ${HARD_FLOOR_GB} GB)`;
  } catch (err) {
    budgetError = safeText(err.message);
    notes.push('budget/floor measurement failed — treated as UNKNOWN (fail closed)');
  }

  let bytesPerRow = null;
  let bytesPerRowBasis = null;
  let rowsMeasured = 0;
  let dbReachable = false;

  if (db) {
    try {
      const service = qualityFactory({ pool: db });
      const report = await service.generateReport({ includeSample: true, diskPath: outDir, estimatedFullRunRows: null });
      dbReachable = true;
      const storage = report?.storage ?? {};
      const measured = asNumber(storage.mean_bytes_per_row);
      rowsMeasured = asNumber(report?.records?.total_rows) ?? 0;
      if (measured !== null && measured > 0) {
        bytesPerRow = measured;
        bytesPerRowBasis = `measured: ${storage.mean_bytes_per_row_basis ?? 'database table bytes / rows'}`;
      }
      if (rowsMeasured === 0) notes.push('the database holds no rows yet, so no per-row figure could be measured from it');
    } catch (err) {
      notes.push(`database unreachable (${safeText(err.message).slice(0, 160)}); falling back to on-disk measurement`);
    }
  }

  if (bytesPerRow === null) {
    const measuredDir = await measureDirectory(outDir).catch(() => null);
    const manifest = await loadManifest(path.join(outDir, HISTORICAL_MANIFEST)).catch(() => null);
    const manifestRows = Object.values(manifest?.windows ?? {}).reduce((sum, entry) => sum + (Number(entry?.recordCount) || 0), 0);
    const files = measuredDir?.bytes ?? 0;
    if (measuredDir && manifestRows > 0 && files > 0) {
      bytesPerRow = files / manifestRows;
      bytesPerRowBasis = `measured: ${files} B on disk / ${manifestRows} rows recorded in ${HISTORICAL_MANIFEST}`;
    } else {
      notes.push('no bytes-per-row sample exists yet (run `sample` or a small `historical` window first, or pass --assumed-rows)');
    }
  }

  let rows = assumedRows;
  let rowsBasis = 'not estimated: pass --assumed-rows to extrapolate the full run';
  if (rows !== null) rowsBasis = 'operator assumption (--assumed-rows)';

  // Without a MEASURED bytes-per-row there is no honest byte estimate; the verdict then
  // relies on the measured free space alone and says so.
  const canExtrapolate = rows !== null && bytesPerRow !== null && bytesPerRow > 0;
  const runEstimate = canExtrapolate
    ? { ...estimateRunBytes({ perRecordBytes: bytesPerRow, records: rows }), basis: `estimated from ${bytesPerRowBasis} x ${rows} rows` }
    : {
        estimatedBytes: null,
        measured: false,
        basis: rows === null
          ? 'no row count available — pass --assumed-rows'
          : 'no bytes-per-row measurement — run `sample` or a small `historical` window first',
      };
  if (!canExtrapolate) {
    notes.push('byte extrapolation is impossible: the full-run size stays unknown (it is never guessed)');
  }

  const estimatedBytes = runEstimate.estimatedBytes;
  const freeBytes = free?.freeBytes ?? disk?.freeBytes ?? null;
  const usedBytes = usage?.bytes ?? null;
  const budgetBytes = budgetGb * GB;
  const floorBytes = resolveMinFreeGb(minFreeGb) * GB;

  let verdict = 'PROCEED';
  const reasons = [];
  if (freeBytes === null) {
    verdict = 'UNKNOWN_FREE_SPACE';
    reasons.push(diskError ? `free space could not be measured: ${diskError}` : 'free space could not be measured — failing closed');
  } else if (budgetError) {
    verdict = 'REFUSE_FLOOR';
    reasons.push(budgetError);
  } else if (estimatedBytes === null) {
    verdict = 'UNKNOWN_SIZE';
    reasons.push(`${runEstimate.basis}: a run of unknown size cannot be cleared against the ${formatBytes(budgetBytes)} budget`);
  } else if (usedBytes !== null && usedBytes + estimatedBytes > budgetBytes) {
    verdict = 'REFUSE_BUDGET';
    reasons.push(`estimated run needs ${formatBytes(estimatedBytes)}, which would push the working data to ${formatBytes(usedBytes + estimatedBytes)} against a ${formatBytes(budgetBytes)} budget`);
  } else if (freeBytes - estimatedBytes < floorBytes) {
    verdict = 'REFUSE_FLOOR';
    reasons.push(`estimated run needs ${formatBytes(estimatedBytes)}; that would leave ${formatBytes(freeBytes - estimatedBytes)} free, below the ${formatBytes(floorBytes)} floor`);
  } else {
    reasons.push(`estimated run ${formatBytes(estimatedBytes)} fits the ${formatBytes(budgetBytes)} budget and keeps ${formatBytes(freeBytes - estimatedBytes)} free (floor ${formatBytes(floorBytes)})`);
  }

  return {
    outDir,
    range: { fromDate, toDate, days: days ?? daysBetween(fromDate, toDate) },
    measured: {
      freeBytes,
      freeGb: freeBytes === null ? null : round2(freeBytes / GB),
      usedBytes,
      usedGb: usedBytes === null ? null : round2(usedBytes / GB),
      bytesPerRow: bytesPerRow === null ? null : round2(bytesPerRow),
      bytesPerRowBasis,
      rowsInDatabase: rowsMeasured,
      databaseReachable: dbReachable,
      diskMethod: disk?.method ?? null,
    },
    estimated: {
      rows,
      rowsBasis,
      estimatedBytes,
      estimatedGb: estimatedBytes === null ? null : round2(estimatedBytes / GB),
      basis: runEstimate.basis,
    },
    limits: {
      budgetGb,
      budgetBytes,
      floorGb: resolveMinFreeGb(minFreeGb),
      hardFloorGb: HARD_FLOOR_GB,
    },
    verdict,
    reasons,
    notes,
    downloaded: false,
  };
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : value < 10 ? 2 : 1)} ${units[unit]}`;
}

// ── batch analysis (preview) ───────────────────────────────────────────────

/**
 * normalize -> validate -> dedup -> canonical derivation, without touching the database.
 * Pure and synchronous, so the same function backs `preview` and the tests.
 */
export function analyseBatch(rawRecords = [], { crossSource = false } = {}) {
  const rejectionSummary = {};
  const rejectionSamples = [];
  const valid = [];
  for (const rawRecord of rawRecords) {
    const record = normalizeMandiRecord(rawRecord);
    const check = validateMandiRecord(record);
    if (check.valid) {
      if (check.warnings.length) record.quality_flags = [...new Set([...record.quality_flags, ...check.warnings])];
      valid.push(record);
    } else {
      for (const error of check.errors) rejectionSummary[error.code] = (rejectionSummary[error.code] || 0) + 1;
      if (rejectionSamples.length < 10) rejectionSamples.push({ errors: check.errors.map((e) => e.code), record: stripPayload(record) });
    }
  }

  const { uniqueRecords, duplicatesCount, conflicts, overlaps } = deduplicateRecords(valid, { crossSource });
  const wouldWrite = uniqueRecords.map((record) => {
    const canonical = deriveCanonicalFields(record, { validation: { valid: true } });
    return {
      source: record.source,
      price_date: record.price_date,
      state: record.state,
      district: record.district,
      mandi_name: record.mandi_name,
      commodity_name: record.commodity_name,
      variety: record.variety ?? null,
      min_price: record.min_price ?? null,
      max_price: record.max_price ?? null,
      modal_price: record.modal_price ?? null,
      price_unit: record.price_unit,
      arrivals_quantity: record.arrivals_quantity ?? null,
      quality_status: canonical.quality_status,
      quality_flags: record.quality_flags ?? [],
      content_hash: canonical.content_hash,
    };
  });

  const qualityStatuses = {};
  const flagCounts = {};
  for (const row of wouldWrite) {
    qualityStatuses[row.quality_status] = (qualityStatuses[row.quality_status] || 0) + 1;
    for (const flag of row.quality_flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  }

  return {
    fetched: rawRecords.length,
    valid: valid.length,
    rejected: rawRecords.length - valid.length,
    rejectionSummary,
    rejectionSamples,
    duplicatesRemoved: duplicatesCount,
    uniqueRecords: uniqueRecords.length,
    conflicts: conflicts ?? [],
    overlaps: overlaps ?? [],
    qualityStatuses,
    flagCounts,
    wouldWrite,
    wrote: false,
  };
}

function stripPayload(record) {
  const { raw_payload: _raw, ...rest } = record ?? {};
  return rest;
}

// ── subcommand: sources ────────────────────────────────────────────────────

export async function cmdSources(options = {}, deps = {}) {
  const mandiConfig = deps.mandiConfig ?? config.mandi;
  const tcp = deps.tcp ?? checkTcp;
  const sources = [];

  for (const registry of SOURCE_REGISTRY) {
    const descriptor = sourceDescriptor(registry.key, mandiConfig);
    const credentialPresent = Boolean(descriptor.apiKeyValue);
    let reachability;
    if (!credentialPresent) {
      reachability = { reachable: false, detail: 'not attempted: no credential configured' };
    } else {
      const result = await tcp(descriptor.host);
      reachability = { reachable: Boolean(result.ok), detail: safeText(result.code ?? (result.ok ? 'CONNECTED' : 'ERROR')) };
    }
    sources.push({
      source: descriptor.code,
      key: descriptor.key,
      label: descriptor.label,
      mode: descriptor.mode,
      credential_env: descriptor.credentialEnv,
      credential_present: credentialPresent,
      base_url: redactUrl(descriptor.baseUrlValue),
      host: descriptor.host,
      reachable: reachability.reachable,
      reachability: reachability.detail,
      bounded_by: descriptor.boundedBy,
    });
  }

  const warnings = [...(mandiConfig.warnings ?? [])].map((w) => safeText(w));
  return {
    exitCode: EXIT.SUCCESS,
    data: {
      generated_by: 'scripts/mandi-ingest.js sources',
      credentials_printed: false,
      configured_provider: mandiConfig.provider ?? null,
      sources,
      warnings,
    },
  };
}

// ── subcommand: discover ───────────────────────────────────────────────────

export async function cmdDiscover(options = {}, deps = {}) {
  const resolved = resolveDiscoverOptions(options);
  const mandiConfig = deps.mandiConfig ?? config.mandi;
  const provider = deps.provider ?? createProvider(resolved.source, { mandiConfig, deps });
  const limit = resolved.limit;
  const signal = deps.signal;

  if (!provider.isConfigured()) {
    const err = new Error(`${provider.getSourceCode()} has no credential configured (${sourceDescriptor(resolved.source, mandiConfig).credentialEnv}); discovery is unavailable`);
    err.code = 'SOURCE_NOT_CONFIGURED';
    throw err;
  }

  if (resolved.source === 'ceda') {
    const commodities = await provider.client.listCommodities({ signal });
    const geographies = await provider.client.listGeographies({ signal });
    const states = geographies.map((geo) => ({
      state_id: geo.state_id,
      state_name: geo.state_name,
      districts: (geo.districts ?? []).slice(0, limit).map((d) => ({ district_id: d.district_id, district_name: d.district_name })),
    }));
    return {
      exitCode: EXIT.SUCCESS,
      data: {
        source: 'CEDA',
        writes: false,
        commodities_total: commodities.length,
        commodities: commodities.slice(0, limit),
        geographies_total: geographies.length,
        states: states.slice(0, limit),
        markets: null,
        note: 'Markets are per commodity/state/district: use `ceda-export --discover-only` or `sample --source=ceda` with a scope to list them.',
      },
    };
  }

  const url = provider.buildUrl({ offset: 0, limit: 1 });
  const { data } = await provider.http.requestJson(url, { signal, label: 'data.gov.in' });
  const fields = Array.isArray(data?.field) ? data.field : [];
  return {
    exitCode: EXIT.SUCCESS,
    data: {
      source: 'DATA_GOV_IN',
      writes: false,
      resource: data?.resource_id ?? null,
      records_total_reported: asNumber(data?.total),
      fields: fields.slice(0, limit).map((f) => ({ id: f?.id ?? null, name: f?.name ?? null, type: f?.type ?? null })),
      note: 'data.gov.in publishes no commodity/market catalogue endpoint; the field metadata above is the documented discovery surface. Filters accepted: state, district, market, commodity, arrival_date.',
    },
  };
}

// ── subcommand: sample ─────────────────────────────────────────────────────

export async function cmdSample(options = {}, deps = {}) {
  const resolved = resolveSampleOptions(options, { today: deps.today });
  const mandiConfig = deps.mandiConfig ?? config.mandi;
  const provider = deps.provider ?? createProvider(resolved.source, { mandiConfig, deps });

  if (!provider.isConfigured()) {
    const err = new Error(`${provider.getSourceCode()} has no credential configured (${sourceDescriptor(resolved.source, mandiConfig).credentialEnv}); no sample was fetched`);
    err.code = 'SOURCE_NOT_CONFIGURED';
    throw err;
  }

  const records = await provider.fetchRecords({
    state: resolved.state,
    district: resolved.district,
    commodity: resolved.commodity,
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    maxRecords: resolved.maxRecords,
    signal: deps.signal,
  });

  return {
    exitCode: EXIT.SUCCESS,
    data: {
      source: provider.getSourceCode(),
      writes: false,
      fetched: records.length,
      requested: { days: resolved.days, limit: resolved.limit, maxPages: resolved.maxPages, maxRecords: resolved.maxRecords },
      window: { from: resolved.fromDate, to: resolved.toDate },
      fetch_meta: provider.lastFetchMeta ?? null,
      records,
      note: 'Values are exactly what the source returned; nothing is generated or filled in.',
    },
  };
}

// ── subcommand: preview ────────────────────────────────────────────────────

export async function cmdPreview(options = {}, deps = {}) {
  const resolved = resolveSampleOptions(options, { today: deps.today });
  const mandiConfig = deps.mandiConfig ?? config.mandi;
  const provider = deps.provider ?? createProvider(resolved.source, { mandiConfig, deps });

  if (!provider.isConfigured()) {
    const err = new Error(`${provider.getSourceCode()} has no credential configured (${sourceDescriptor(resolved.source, mandiConfig).credentialEnv}); nothing was previewed`);
    err.code = 'SOURCE_NOT_CONFIGURED';
    throw err;
  }

  const raw = await provider.fetchRecords({
    state: resolved.state,
    district: resolved.district,
    commodity: resolved.commodity,
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    maxRecords: resolved.maxRecords,
    signal: deps.signal,
  });
  const analysis = deps.analyseBatch
    ? deps.analyseBatch(raw, { crossSource: options['cross-source'] === true })
    : analyseBatch(raw, { crossSource: options['cross-source'] === true });

  return {
    exitCode: EXIT.SUCCESS,
    data: {
      source: provider.getSourceCode(),
      wrote: false,
      database_writes: 0,
      window: { from: resolved.fromDate, to: resolved.toDate },
      ...analysis,
    },
  };
}

// ── subcommand: incremental ────────────────────────────────────────────────

export async function cmdIncremental(options = {}, deps = {}) {
  const resolved = resolveIncrementalOptions(options, { mandiConfig: deps.mandiConfig ?? config.mandi });
  const pool = await resolvePool(deps);
  const database = deps.confirmDatabase === undefined ? requireDatabaseConfirmation(options) : deps.confirmDatabase;

  // Fails closed: an unmeasurable volume stops the run before anything is fetched.
  await assertMinimumFree(resolved.outDir, resolved.minFreeGb, deps.diskOptions ?? {});
  const budget = createBudget({ dir: resolved.outDir, budgetGb: resolved.budgetGb, minFreeGb: resolved.minFreeGb });
  await budget.assertCanWrite(0);

  const sources = resolved.source === 'all' ? SOURCE_KEYS : [resolved.source];
  const runs = [];
  for (const key of sources) {
    const descriptor = sourceDescriptor(key, deps.mandiConfig ?? config.mandi);
    if (!descriptor.apiKeyValue) {
      runs.push({ source: descriptor.code, status: 'SKIPPED', reason: `${descriptor.credentialEnv} is not configured` });
      continue;
    }
    const provider = deps.providers?.[key] ?? createProvider(key, { mandiConfig: deps.mandiConfig ?? config.mandi, deps });
    const pipeline = deps.pipeline ?? new MandiPipeline({ pool });
    const planned = planIncrementalWindow({ lookbackDays: resolved.lookbackDays, maxDays: 30 });
    const stats = await pipeline.runPipeline({
      provider: descriptor.code,
      state: resolved.state,
      district: resolved.district,
      commodity: resolved.commodity,
      maxRecords: resolved.maxRecords,
      crossSource: resolved.crossSource,
      signal: deps.signal,
      triggeredBy: 'cli:mandi-ingest:incremental',
    });
    runs.push({
      source: stats.source,
      status: stats.status,
      ingestion_run_id: stats.run_id ?? null,
      planned_window: planned,
      window_from: stats.window_from,
      window_to: stats.window_to,
      records_fetched: stats.records_fetched,
      records_valid: stats.records_valid,
      records_rejected: stats.records_rejected,
      records_inserted: stats.records_inserted,
      records_updated: stats.records_updated,
      records_unchanged: stats.records_unchanged,
      records_failed: stats.records_failed,
      conflicts_detected: stats.conflicts_detected,
      rejection_summary: stats.rejection_summary,
      error_code: stats.error_code,
      error_details: stats.error_details,
      execution_time_ms: stats.execution_time_ms,
    });
  }

  const failed = runs.some((run) => !['SUCCESS', 'NO_DATA', 'SKIPPED'].includes(run.status));
  return {
    exitCode: failed ? EXIT.ERROR : EXIT.SUCCESS,
    data: {
      database,
      advisory_lock_id: PIPELINE_LOCK_ID,
      lookback_days: resolved.lookbackDays,
      budget_gb: resolved.budgetGb,
      min_free_gb: resolveMinFreeGb(resolved.minFreeGb),
      out_dir: resolved.outDir,
      runs,
    },
  };
}

// ── subcommand: historical (window runner) ─────────────────────────────────

/**
 * Downloads one window at a time, writing a gzip CSV plus an atomically saved manifest
 * entry. Completed windows are skipped on the next run, so a crash resumes instead of
 * restarting. Disk floor and working-data budget are re-checked before EVERY window.
 */
export async function runHistoricalWindows({
  provider, outDir, fromDate, toDate, windowDays, budgetGb = DEFAULT_BUDGET_GB,
  minFreeGb = resolveMinFreeGb(config.mandi.historical.minFreeDiskGb), maxRows = HISTORICAL_DEFAULT_MAX_ROWS,
  commodity, state, district, manifestFile = HISTORICAL_MANIFEST, secrets = [], log = console,
  signal, deps = {},
} = {}) {
  const range = clampToHistoricalWindow(fromDate, toDate);
  await fsp.mkdir(outDir, { recursive: true });
  const guard = deps.budgetFactory
    ? deps.budgetFactory({ dir: outDir, budgetGb, minFreeGb })
    : createBudget({ dir: outDir, budgetGb, minFreeGb });
  const checkSpace = deps.assertSpace ?? ((stage) => assertMinimumFree(outDir, minFreeGb).then(() => guard.assertCanWrite(0)).catch((err) => { err.stage = stage; throw err; }));

  await checkSpace('before start');

  const scope = await provider.resolveScope({ commodity, state, district, signal });
  const marketIds = scope.markets.map((m) => m.market_id);
  const marketNames = new Map(scope.markets.map((m) => [String(m.market_id), m.market_name]));
  const manifestPath = path.join(outDir, manifestFile);
  const manifest = await loadManifest(manifestPath, {
    dataset: `ceda/${scope.commodityName}/${scope.stateName}/${scope.districtName}`,
    source: 'CEDA',
  });

  const allWindows = splitDateRange(range.from, range.to, windowDays);
  const summary = {
    manifestPath,
    outDir,
    scope: { commodity: scope.commodityName, state: scope.stateName, district: scope.districtName, markets: scope.markets.length },
    windowsPlanned: allWindows.length,
    windowsAlreadyComplete: 0,
    windowsCompleted: 0,
    rowsWritten: 0,
    rowsValid: 0,
    rowsRejected: 0,
    bytesWritten: 0,
    maxRows,
    stoppedReason: null,
    remainingWindows: [],
    windows: [],
  };

  for (const window of allWindows) {
    if (isWindowComplete(manifest, `${window.from}_${window.to}`)) {
      summary.windowsAlreadyComplete += 1;
      continue;
    }
    if (summary.rowsWritten >= maxRows) {
      summary.stoppedReason = `max-rows (${maxRows}) reached`;
      break;
    }
    if (signal?.aborted) {
      summary.stoppedReason = 'interrupted';
      break;
    }

    const key = `${window.from}_${window.to}`;
    try {
      await checkSpace(`before window ${key}`);
      const request = { commodityId: scope.commodityId, stateId: scope.stateId, districtIds: [scope.districtId], marketIds, fromDate: window.from, toDate: window.to, signal };
      const [prices, quantities] = await Promise.all([
        provider.client.getPrices(request),
        provider.client.getQuantities(request),
      ]);
      const fetchedAt = new Date().toISOString();

      const rows = [];
      let validCount = 0;
      for (const raw of buildCedaRecords(prices, quantities, { ...scope, marketNames, fetchedAt })) {
        const record = normalizeMandiRecord(raw);
        const check = validateMandiRecord(record);
        rows.push({ ...record, validation_status: check.valid ? 'valid' : 'rejected', rejection_codes: check.errors.map((e) => e.code) });
        if (check.valid) validCount += 1;
      }

      const file = path.posix.join('ceda', `commodity=${scope.commodityId}`, `state=${scope.stateId}`, `district=${scope.districtId}`, `${window.from}_${window.to}.csv.gz`);
      const filePath = path.join(outDir, file);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const writer = createCsvGzWriter({ filePath, columns: CSV_COLUMNS });
      for (const row of rows) await writer.writeRow(row);
      const written = await writer.close();

      const decision = await guard.explainWrite(written.compressedBytes);
      markWindowComplete(manifest, key, {
        recordCount: written.rows, bytes: written.compressedBytes, sha256: written.sha256, file,
        rowsValid: validCount, rowsRejected: written.rows - validCount, priceRows: prices.length,
        quantityRows: quantities.length, window, fetchedAt, decision: decision.reason,
      });
      await saveManifest(manifestPath, manifest);

      summary.windowsCompleted += 1;
      summary.rowsWritten += written.rows;
      summary.rowsValid += validCount;
      summary.rowsRejected += written.rows - validCount;
      summary.bytesWritten += written.compressedBytes;
      summary.windows.push({ key, rows: written.rows, valid: validCount, bytes: written.compressedBytes, file });
      log.log?.(`[mandi:ingest] ${key}: ${written.rows} rows (${validCount} valid) -> ${file}`);
    } catch (err) {
      const safeMessage = safeText(err.message);
      markWindowFailed(manifest, key, err, { secrets, window });
      await saveManifest(manifestPath, manifest).catch(() => {});
      summary.stoppedReason = safeMessage;
      summary.error = { window: key, code: err.code ?? null, message: safeMessage };
      break;
    }
  }

  summary.remainingWindows = allWindows
    .filter((w) => !isWindowComplete(manifest, `${w.from}_${w.to}`))
    .map((w) => ({ from: w.from, to: w.to }));
  summary.manifest = manifest;
  return summary;
}

// ── subcommand: historical ─────────────────────────────────────────────────

export async function cmdHistorical(options = {}, deps = {}) {
  const mandiConfig = deps.mandiConfig ?? config.mandi;
  const resolved = resolveHistoricalOptions(options, { mandiConfig });
  const estimateFn = deps.estimateStorage ?? estimateStorage;
  const estimateDeps = { ...deps, pool: await resolvePool(deps) };
  const runPreflight = () => estimateFn({
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    days: daysBetween(resolved.fromDate, resolved.toDate),
    assumedRows: valueOf(options['assumed-rows']) === undefined ? null : positiveInt(options['assumed-rows'], 'assumed-rows'),
    budgetGb: resolved.budgetGb,
    minFreeGb: resolved.minFreeGb,
    outDir: resolved.outDir,
    deps: estimateDeps,
  });

  if (!resolved.confirmed) {
    const estimate = await runPreflight();
    let refusal;
    try {
      assertHistoricalConfirmed(options);
      refusal = null;
    } catch (err) {
      refusal = safeText(err.message);
    }
    return {
      exitCode: EXIT.SAFETY_REFUSAL,
      data: {
        refused: true,
        refusal,
        required_token: CONFIRM_FULL_RUN_TOKEN,
        command_line: `node scripts/mandi-ingest.js historical --commodity=${resolved.commodity} --state=${resolved.state} --district=${resolved.district} --from=${resolved.fromDate} --to=${resolved.toDate} --max-rows=${resolved.maxRows} --confirm-full-run=${CONFIRM_FULL_RUN_TOKEN}`,
        downloaded: false,
        estimate,
      },
    };
  }

  if (resolved.dryRun) {
    const estimate = await runPreflight();
    return {
      exitCode: EXIT.SAFETY_REFUSAL,
      data: { refused: false, dry_run: true, downloaded: false, windows: splitDateRange(resolved.fromDate, resolved.toDate, resolved.windowDays).length, max_rows: resolved.maxRows, estimate },
    };
  }

  const descriptor = sourceDescriptor('ceda', mandiConfig);
  if (!descriptor.apiKeyValue) {
    const err = new Error(`CEDA_API_KEY is not configured; the historical backfill cannot run`);
    err.code = 'SOURCE_NOT_CONFIGURED';
    throw err;
  }

  const provider = deps.provider ?? createProvider('ceda', { mandiConfig, deps });
  const runWindows = deps.runHistoricalWindows ?? runHistoricalWindows;
  const summary = await runWindows({
    provider,
    outDir: resolved.outDir,
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    windowDays: resolved.windowDays,
    budgetGb: resolved.budgetGb,
    minFreeGb: resolved.minFreeGb,
    maxRows: resolved.maxRows,
    commodity: resolved.commodity,
    state: resolved.state,
    district: resolved.district,
    secrets: secretValues(mandiConfig),
    signal: deps.signal,
    deps,
  });
  const { manifest, ...report } = summary;
  return {
    exitCode: summary.stoppedReason ? EXIT.SAFETY_REFUSAL : EXIT.SUCCESS,
    data: { refused: false, dry_run: false, confirmed: true, ...report },
  };
}

// ── subcommand: resume ─────────────────────────────────────────────────────

export async function cmdResume(options = {}, deps = {}) {
  const mandiConfig = deps.mandiConfig ?? config.mandi;
  const resolved = resolveResumeOptions(options, { mandiConfig });
  const manifestPath = path.join(resolved.outDir, HISTORICAL_MANIFEST);
  const manifest = await loadManifest(manifestPath);
  const windows = splitDateRange(resolved.fromDate, resolved.toDate, resolved.windowDays);
  const remaining = windows.filter((w) => !isWindowComplete(manifest, `${w.from}_${w.to}`));
  const completed = windows.filter((w) => isWindowComplete(manifest, `${w.from}_${w.to}`));

  const base = {
    manifest_path: manifestPath,
    dataset: manifest.dataset ?? null,
    windows_total: windows.length,
    windows_complete: completed.length,
    remaining_windows: remaining.map((w) => ({ from: w.from, to: w.to })),
    confirmation_required: false,
    reason: 'resume can only ever skip already-complete windows, so it needs no confirmation token',
  };
  if (remaining.length === 0 || resolved.printOnly) {
    return { exitCode: EXIT.SUCCESS, data: { ...base, ran: false, downloaded: false, note: remaining.length === 0 ? 'nothing to resume' : 'print-only: nothing was downloaded' } };
  }

  const descriptor = sourceDescriptor('ceda', mandiConfig);
  if (!descriptor.apiKeyValue) {
    const err = new Error(`CEDA_API_KEY is not configured; ${remaining.length} window(s) cannot be resumed`);
    err.code = 'SOURCE_NOT_CONFIGURED';
    throw err;
  }

  const provider = deps.provider ?? createProvider('ceda', { mandiConfig, deps });
  const datasetParts = String(manifest.dataset ?? '').split('/');
  const [commodity, state, district] = [
    options['commodity'] ? valueOf(options['commodity']) : datasetParts[1] ?? null,
    options['state'] ? valueOf(options['state']) : datasetParts[2] ?? null,
    options['district'] ? valueOf(options['district']) : datasetParts[3] ?? null,
  ];
  if (!commodity || !state || !district) {
    throw new UsageError('the manifest has no recorded commodity/state/district; re-run with --commodity --state --district');
  }

  const runWindows = deps.runHistoricalWindows ?? runHistoricalWindows;
  const summary = await runWindows({
    provider,
    outDir: resolved.outDir,
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    windowDays: resolved.windowDays,
    budgetGb: resolved.budgetGb,
    minFreeGb: resolved.minFreeGb,
    maxRows: resolved.maxRows,
    commodity,
    state,
    district,
    secrets: secretValues(mandiConfig),
    signal: deps.signal,
    deps,
  });
  const { manifest: _manifest, ...report } = summary;
  return { exitCode: summary.stoppedReason ? EXIT.SAFETY_REFUSAL : EXIT.SUCCESS, data: { ...base, ran: true, downloaded: true, ...report } };
}

// ── subcommand: status ─────────────────────────────────────────────────────

export async function cmdStatus(options = {}, deps = {}) {
  const mandiConfig = deps.mandiConfig ?? config.mandi;
  const resolved = resolveOutDir(options, mandiConfig);
  const pool = await resolvePool(deps);

  let sources = [];
  let counts = [];
  let conflicts = [];
  let recentRuns = [];
  let database = { reachable: false, error: null };
  try {
    const stateRows = (await pool.query('SELECT source, last_attempt_at, last_success_at, last_status, last_error, last_run_id, last_window_from::text AS last_window_from, last_window_to::text AS last_window_to, latest_reporting_date::text AS latest_reporting_date FROM mandi_source_sync_state ORDER BY source')).rows;
    const countRows = (await pool.query('SELECT source, COUNT(*)::int AS rows, MIN(reported_date)::text AS earliest, MAX(reported_date)::text AS latest, COUNT(*) FILTER (WHERE is_sample_data)::int AS sample_rows FROM mandi_prices_canonical GROUP BY source ORDER BY source')).rows;
    const conflictRows = (await pool.query('SELECT status, COUNT(*)::int AS conflicts FROM mandi_price_conflicts GROUP BY status ORDER BY status')).rows;
    const runRows = (await pool.query('SELECT id, source, status, window_from::text AS window_from, window_to::text AS window_to, records_fetched, records_inserted, records_updated, records_unchanged, records_rejected, records_failed, conflicts_detected, started_at, synced_at, triggered_by, error_details FROM pipeline_sync_logs ORDER BY id DESC LIMIT $1', [20])).rows;
    sources = stateRows;
    counts = countRows;
    conflicts = conflictRows;
    recentRuns = runRows;
    database = { reachable: true, error: null };
  } catch (err) {
    database = { reachable: false, error: safeText(err.message) };
  }

  const manifest = await loadManifest(path.join(resolved, HISTORICAL_MANIFEST)).catch(() => null);
  const historicalWindows = manifest
    ? Object.values(manifest.windows).map((entry) => ({ key: entry.key, status: entry.status, recordCount: entry.recordCount ?? 0, bytes: entry.bytes ?? 0, error: entry.error ?? null }))
    : [];
  const pending = historicalWindows.filter((w) => w.status !== 'complete');
  const usage = await measureDirectory(resolved).catch(() => null);

  const data = {
    database,
    data_dir: resolved,
    data_dir_usage: usage ? { bytes: usage.bytes, files: usage.files, measured: true } : null,
    manifest: manifest ? { path: path.join(resolved, HISTORICAL_MANIFEST), dataset: manifest.dataset, windows: historicalWindows.length } : null,
    sources: sources.map((row) => ({
      ...row,
      credential_present: row.source === 'DATA_GOV_IN' ? Boolean(mandiConfig.dataGovApiKey) : row.source === 'CEDA' ? Boolean(mandiConfig.cedaApiKey) : null,
    })),
    counts,
    conflicts,
    pending_historical_windows: pending,
    recent_runs: recentRuns,
  };
  return { exitCode: database.reachable ? EXIT.SUCCESS : EXIT.BLOCKED, data };
}

// ── subcommand: estimate ───────────────────────────────────────────────────

export async function cmdEstimate(options = {}, deps = {}) {
  const resolved = resolveEstimateOptions(options, { mandiConfig: deps.mandiConfig ?? config.mandi });
  const pool = await resolvePool(deps);
  const estimate = await (deps.estimateStorage ?? estimateStorage)({
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    days: resolved.days,
    assumedRows: resolved.assumedRows,
    budgetGb: resolved.budgetGb,
    minFreeGb: resolved.minFreeGb,
    outDir: resolved.outDir,
    deps: { ...deps, pool },
  });
  const exitCode = estimate.verdict === 'PROCEED' ? EXIT.SUCCESS : EXIT.SAFETY_REFUSAL;
  return { exitCode, data: { downloaded: false, generated_by: 'scripts/mandi-ingest.js estimate', ...estimate } };
}

// ── subcommand: cleanup ────────────────────────────────────────────────────

const RAW_SUFFIXES = ['.raw.json.gz', '.partial'];
const TEMP_PATTERN = /^\..+\.tmp$/;

async function collectRawFiles(dir) {
  const found = [];
  const root = path.resolve(dir);
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, full);
      if (RAW_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)) || TEMP_PATTERN.test(entry.name)) found.push({ path: full, relative });
    }
  }
  return found;
}

export async function cmdCleanup(options = {}, deps = {}) {
  const resolved = resolveCleanupOptions(options, { mandiConfig: deps.mandiConfig ?? config.mandi });
  assertCleanupConfirmed(options);

  const freeBefore = await availableBytes(resolved.outDir).catch(() => null);
  const candidates = await collectRawFiles(resolved.outDir);
  const root = path.resolve(resolved.outDir);
  const inside = candidates.filter((entry) => path.resolve(entry.path).startsWith(root + path.sep));

  let bytesFreed = 0;
  const removed = [];
  const refused = [];
  for (const entry of inside) {
    if (resolved.dryRun) { refused.push({ file: entry.relative, reason: '--dry-run' }); continue; }
    const stat = await fsp.stat(entry.path).catch(() => null);
    if (!stat) continue;
    await fsp.rm(entry.path, { force: true });
    bytesFreed += stat.size;
    removed.push({ file: entry.relative, bytes: stat.size });
  }
  const outside = candidates.filter((entry) => !path.resolve(entry.path).startsWith(root + path.sep));
  for (const entry of outside) refused.push({ file: entry.relative, reason: 'outside the data directory' });

  const freeAfter = resolved.dryRun ? freeBefore : await availableBytes(resolved.outDir).catch(() => null);
  return {
    exitCode: EXIT.SUCCESS,
    data: {
      confirmation_token: CONFIRM_CLEANUP_TOKEN,
      data_dir: resolved.outDir,
      dry_run: resolved.dryRun,
      removed_files: removed.length,
      removed,
      refused,
      bytes_freed: bytesFreed,
      database_touched: false,
      kept: 'normalised *.csv.gz exports, manifests and every database table are never removed by cleanup',
      free_bytes_before: freeBefore?.freeBytes ?? null,
      free_bytes_after: freeAfter?.freeBytes ?? null,
    },
  };
}

// ── routing ────────────────────────────────────────────────────────────────

export const SUBCOMMANDS = Object.freeze({
  sources: { handler: cmdSources, writes: false, summary: 'list configured sources, credential presence and reachability' },
  discover: { handler: cmdDiscover, writes: false, summary: 'list available commodities / markets / geographies' },
  sample: { handler: cmdSample, writes: false, summary: 'print a small authorised sample (never writes to the database)' },
  preview: { handler: cmdPreview, writes: false, summary: 'normalise, validate and dedup a small batch; print what WOULD be written' },
  incremental: { handler: cmdIncremental, writes: true, summary: 'last-N-days incremental ingestion (requires --confirm-db=<DB_NAME>)' },
  historical: { handler: cmdHistorical, writes: true, summary: `CEDA 5-year backfill (requires --confirm-full-run=${CONFIRM_FULL_RUN_TOKEN})` },
  resume: { handler: cmdResume, writes: true, summary: 'resume an interrupted historical run from the manifest (no confirmation needed)' },
  status: { handler: cmdStatus, writes: false, summary: 'last run per source, pending windows, counts and conflicts' },
  estimate: { handler: cmdEstimate, writes: false, summary: 'storage-estimation preflight; prints a verdict without downloading' },
  cleanup: { handler: cmdCleanup, writes: true, summary: `delete raw downloads (requires --confirm-cleanup=${CONFIRM_CLEANUP_TOKEN})` },
});

export function resolveHandler(subcommand) {
  if (!subcommand) throw new UsageError('a subcommand is required (see --help)');
  const entry = SUBCOMMANDS[String(subcommand).toLowerCase()];
  if (!entry) throw new UsageError(`unknown subcommand "${subcommand}". Known subcommands: ${Object.keys(SUBCOMMANDS).join(', ')}`);
  return entry;
}

export function helpText() {
  const lines = [];
  lines.push('mandi-ingest — Phase 5 mandi-data ingestion orchestrator');
  lines.push('');
  lines.push('USAGE');
  lines.push('  node scripts/mandi-ingest.js <subcommand> [options]');
  lines.push('  npm run mandi:ingest -- <subcommand> [options]');
  lines.push('  node scripts/mandi-ingest.js --help');
  lines.push('');
  lines.push('SUBCOMMANDS');
  for (const [name, entry] of Object.entries(SUBCOMMANDS)) {
    lines.push(`  ${name.padEnd(12)} ${entry.writes ? '[writes] ' : '[read-only] '}${entry.summary}`);
  }
  lines.push('');
  lines.push('COMMON OPTIONS');
  lines.push('  --json                 machine-readable output on every subcommand');
  lines.push('  --source=ceda|data-gov-in|all    which source to talk to');
  lines.push('  --state= --district= --commodity=  scope filters (ceda requires all three)');
  lines.push('  --out-dir=<dir>        data directory (default MANDI_DATA_DIR or backend/data/mandi)');
  lines.push('  --budget-gb=<n>        working-data budget (default 10)');
  lines.push('  --min-free-gb=<n>      free-space minimum (default MANDI_MIN_FREE_DISK_GB=20, hard floor 10)');
  lines.push('');
  lines.push('PER-SUBCOMMAND OPTIONS');
  lines.push('  discover   --limit=<n> (default 50, max 500)');
  lines.push(`  sample     --days=<n> (default ${SAMPLE_DEFAULT_DAYS}, HARD CAP ${SAMPLE_MAX_DAYS}) --limit=<n> (default ${SAMPLE_DEFAULT_LIMIT}, max ${SAMPLE_MAX_LIMIT})`);
  lines.push(`             --max-pages=<n> (default ${SAMPLE_DEFAULT_PAGES}, HARD CAP ${SAMPLE_MAX_PAGES}) --from= --to=`);
  lines.push('  preview    same options as sample, plus --cross-source');
  lines.push('  incremental --lookback-days=<n> (default MANDI_SYNC_LOOKBACK_DAYS, max 30) --max-records=<n>');
  lines.push('             --cross-source --confirm-db=<DB_NAME>   (required: this writes to PostgreSQL)');
  lines.push(`  historical --from=YYYY-MM-DD (default ${CEDA_HISTORICAL_START}) --to=YYYY-MM-DD (default ${CEDA_HISTORICAL_END})`);
  lines.push('             --window-days=<n> (default CEDA_REQUEST_WINDOW_DAYS) --max-rows=<n> (hard cap)');
  lines.push('             --dry-run=true|false (default: true unless confirmed)');
  lines.push(`             --confirm-full-run=${CONFIRM_FULL_RUN_TOKEN}   MANDATORY to download anything`);
  lines.push('  resume     same window options as historical, plus --print-only');
  lines.push('  status     --out-dir= (reads the manifest from here)');
  lines.push('  estimate   --from= --to= --assumed-rows=<n> (operator assumption for the extrapolation)');
  lines.push(`  cleanup    --dry-run --confirm-cleanup=${CONFIRM_CLEANUP_TOKEN}   MANDATORY to delete anything`);
  lines.push('');
  lines.push('EXIT CODES');
  lines.push('  0 success   1 error   2 safety refusal (budget/disk floor/unknown space/missing token)   3 blocked (missing credential, unreachable source or database)');
  lines.push('');
  lines.push('SAFETY');
  lines.push('  - assertMinimumFree + createBudget(10 GB) run before every write path and before every window; both fail closed.');
  lines.push('  - manifests are written atomically (temp + rename + sha256 integrity block), so a crash resumes cleanly.');
  lines.push('  - credentials never appear in output: they are matched and replaced via redactText.');
  lines.push('  - no subcommand ever prints a fabricated price.');
  return lines.join('\n');
}

export async function runCommand(subcommand, options = {}, deps = {}) {
  const entry = resolveHandler(subcommand);
  const result = await entry.handler(options, deps);
  return { subcommand: String(subcommand).toLowerCase(), exitCode: result?.exitCode ?? EXIT.SUCCESS, data: result?.data ?? null };
}

function renderHuman(subcommand, data) {
  const lines = [`[mandi:ingest] ${subcommand}`];
  const walk = (value, prefix = '  ') => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') walk(item, prefix);
        else lines.push(`${prefix}- ${item}`);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (entry === null || entry === undefined) continue;
        if (typeof entry === 'object') { lines.push(`${prefix}${key}:`); walk(entry, `${prefix}  `); continue; }
        if (Array.isArray(entry) && entry.some((i) => i && typeof i === 'object')) { lines.push(`${prefix}${key}:`); walk(entry, `${prefix}  `); continue; }
        lines.push(`${prefix}${key}: ${Array.isArray(entry) ? entry.join(', ') : entry}`);
      }
      return;
    }
    lines.push(`${prefix}${value}`);
  };
  walk(data);
  return lines.join('\n');
}

/**
 * CLI entry point. Returns the exit code instead of setting it, so tests can assert the
 * mapping without spawning a process.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? console.log;
  if (argv.length === 0 || argv.some((token) => HELP_TOKENS.has(token))) {
    log(helpText());
    return EXIT.SUCCESS;
  }

  let parsed;
  try {
    parsed = parseCommandLine(argv);
  } catch (err) {
    console.error(`[mandi:ingest] ${safeText(err.message)}\nRun "node scripts/mandi-ingest.js --help" for the subcommand list.`);
    return exitCodeForError(err);
  }
  if (parsed.extraPositionals.length > 0) {
    console.error(`[mandi:ingest] unexpected argument "${parsed.extraPositionals[0]}"; only one subcommand is accepted`);
    return EXIT.ERROR;
  }

  let result;
  try {
    result = await runCommand(parsed.subcommand, parsed.options, deps);
  } catch (err) {
    console.error(`[mandi:ingest] ${parsed.subcommand} failed: ${safeText(err.message)}`);
    if (err?.code) console.error(`[mandi:ingest] code: ${err.code}`);
    return exitCodeForError(err);
  }

  if (parsed.options.json === true) log(JSON.stringify({ subcommand: result.subcommand, exit_code: result.exitCode, ...result.data }, null, 2));
  else log(renderHuman(result.subcommand, result.data));
  return result.exitCode;
}

export async function runCli(argv = process.argv.slice(2), deps = {}) {
  const pool = await resolvePool(deps);
  const exitCode = await main(argv, { ...deps, db: { pool } });
  if (!deps.keepPoolOpen) await pool.end();
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = abortOnSignals();
  runCli(process.argv.slice(2), { signal: controller.signal })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      console.error(`[mandi:ingest] ${safeText(err.message)}`);
      process.exitCode = exitCodeForError(err);
    });
}