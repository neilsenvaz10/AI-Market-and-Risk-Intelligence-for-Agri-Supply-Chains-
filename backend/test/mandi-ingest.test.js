/**
 * Unit tests for the Phase 5 mandi ingestion orchestrator (scripts/mandi-ingest.js).
 *
 * NO network and NO database. Every dependency the handlers touch — providers, disk,
 * the storage estimate, the pool — is injected as a fake, so importing the module has no
 * side effect (it only auto-runs when it IS the process entry point).
 *
 * What is covered:
 *   - parseArgs-based option resolution for every subcommand;
 *   - the confirmation gates (`historical`, `cleanup`), including a wrong token;
 *   - the hard caps (--days on sample/preview, --max-rows, --max-pages, --limit);
 *   - the storage-estimation preflight that runs when confirmation is absent;
 *   - subcommand routing and unknown-subcommand handling;
 *   - the documented exit-code mapping;
 *   - credential redaction of a fake key inside a thrown error message.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CONFIRM_CLEANUP_TOKEN,
  CONFIRM_FULL_RUN_TOKEN,
  EXIT,
  HISTORICAL_DEFAULT_MAX_ROWS,
  SAMPLE_DEFAULT_DAYS,
  SAMPLE_MAX_DAYS,
  SAMPLE_MAX_LIMIT,
  SAMPLE_MAX_PAGES,
  SUBCOMMANDS,
  SafetyRefusalError,
  UsageError,
  analyseBatch,
  assertCleanupConfirmed,
  assertHistoricalConfirmed,
  cmdCleanup,
  cmdDiscover,
  cmdEstimate,
  cmdHistorical,
  cmdIncremental,
  cmdPreview,
  cmdResume,
  cmdSample,
  cmdSources,
  daysBetween,
  estimateStorage,
  exitCodeForError,
  helpText,
  main,
  parseCommandLine,
  resolveCleanupOptions,
  resolveDiscoverOptions,
  resolveEstimateOptions,
  resolveHandler,
  resolveHistoricalOptions,
  resolveIncrementalOptions,
  resolveResumeOptions,
  resolveSampleOptions,
  resolveSourceOption,
  runCommand,
  runHistoricalWindows,
  safeText,
  secretValues,
} from '../scripts/mandi-ingest.js';
import { BudgetExceededError } from '../src/pipeline/storage/budget.js';
import { InsufficientDiskSpaceError } from '../src/pipeline/storage/diskGuard.js';
import { SourceNotConfiguredError } from '../src/pipeline/providers/base.provider.js';
import { SourceHttpError } from '../src/pipeline/http.js';
import { CEDA_HISTORICAL_END, CEDA_HISTORICAL_START } from '../src/pipeline/providers/ceda.provider.js';

// ── fakes ──────────────────────────────────────────────────────────────────

const FAKE_CEDA_KEY = 'CEDA-FAKE-KEY-0123456789abcdef';
const FAKE_DGI_KEY = 'DGI-FAKE-KEY-fedcba9876543210';

function fakeMandiConfig(overrides = {}) {
  return {
    provider: null,
    sync: { enabled: false, minutes: 0, reason: 'test' },
    syncLookbackDays: 3,
    syncJobTimeoutMinutes: 30,
    allowSampleData: false,
    dataGovApiKey: '',
    dataGovApiUrl: 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070',
    cedaApiKey: '',
    cedaApiUrl: 'https://api.ceda.ashoka.edu.in/v1',
    http: { timeoutMs: 1000, retries: 0, requestIntervalMs: 0 },
    historical: { outputDir: null, minFreeDiskGb: 20, downloadBudgetMb: 500, windowDays: 92 },
    warnings: [],
    ...overrides,
  };
}

async function tempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'mandi-ingest-test-'));
}

/** Captures everything written to console.error / console.log while `fn` runs. */
async function capture(fn) {
  const out = [];
  const err = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts) => out.push(parts.join(' '));
  console.error = (...parts) => err.push(parts.join(' '));
  try {
    return { result: await fn(), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

const VALID_RAW = {
  source: 'DATA_GOV_IN',
  is_sample_data: false,
  state: 'Maharashtra',
  district: 'Nashik',
  mandi_name: 'Nashik Market Yard',
  commodity_name: 'Onion',
  variety: null,
  grade: null,
  price_date: '01/10/2026',
  date_format: 'DMY',
  min_price: 1000,
  max_price: 2000,
  modal_price: 1500,
  arrivals_quantity: null,
  arrival_unit: null,
  price_unit: 'INR/quintal',
  source_record_key: 'Maharashtra|Nashik|Nashik Market Yard|Onion|||01/10/2026',
  raw_payload: { modal_price: 1500 },
  fetched_at: '2026-10-02T00:00:00.000Z',
};

function fakeProvider(records = [VALID_RAW], { source = 'DATA_GOV_IN', configured = true } = {}) {
  return {
    isConfigured: () => configured,
    getSourceCode: () => source,
    getName: () => source,
    lastFetchMeta: null,
    async fetchRecords(options) {
      this.lastOptions = options;
      return records;
    },
  };
}

// ── option parsing: routing of the argv shape ──────────────────────────────

test('parseCommandLine splits the subcommand from --name=value options', () => {
  const parsed = parseCommandLine(['sample', '--source=ceda', '--days=2', '--json']);
  assert.equal(parsed.subcommand, 'sample');
  assert.deepEqual(parsed.options, { source: 'ceda', days: '2', json: true });
  assert.deepEqual(parsed.extraPositionals, []);
});

test('parseCommandLine refuses secrets and unknown argument shapes (shared cli-utils rules)', () => {
  assert.throws(() => parseCommandLine(['sample', '--api-key=abc']), /secrets must never be passed on the command line/);
  assert.throws(() => parseCommandLine(['sample', '--token=abc']), /secrets must never be passed on the command line/);
  assert.throws(() => parseCommandLine(['sample', '-x']), /Unrecognised argument "-x"/);
  assert.equal(parseCommandLine(['--days=2']).subcommand, null, 'options without a subcommand are still parsed');
  // cli-utils only accepts --name=value, so a detached value surfaces as an extra
  // positional instead of being silently swallowed: main() then refuses the command line.
  const detached = parseCommandLine(['sample', '--days', '2']);
  assert.equal(detached.subcommand, 'sample');
  assert.equal(detached.options.days, true);
  assert.deepEqual(detached.extraPositionals, ['2']);
});

test('parseCommandLine reports extra positionals instead of silently ignoring them', () => {
  const parsed = parseCommandLine(['sources', 'discover']);
  assert.equal(parsed.subcommand, 'sources');
  assert.deepEqual(parsed.extraPositionals, ['discover']);
});

// ── option parsing: sources / discover ─────────────────────────────────────

test('resolveSourceOption accepts the documented names and refuses everything else', () => {
  assert.equal(resolveSourceOption('ceda'), 'ceda');
  assert.equal(resolveSourceOption('CEDA'), 'ceda');
  assert.equal(resolveSourceOption('data-gov-in'), 'data-gov-in');
  assert.equal(resolveSourceOption('agmarknet'), 'data-gov-in');
  assert.equal(resolveSourceOption('all'), 'all');
  assert.equal(resolveSourceOption(undefined), 'data-gov-in');
  assert.throws(() => resolveSourceOption(undefined, { required: true }), /--source is required/);
  assert.throws(() => resolveSourceOption('scraper'), /--source must be one of/);
});

test('resolveDiscoverOptions: default limit 50, capped at 500, --source required', () => {
  assert.deepEqual(resolveDiscoverOptions({ source: 'ceda' }), { source: 'ceda', limit: 50, json: false });
  assert.equal(resolveDiscoverOptions({ source: 'ceda', limit: '10' }).limit, 10);
  assert.throws(() => resolveDiscoverOptions({ source: 'ceda', limit: '501' }), SafetyRefusalError);
  assert.throws(() => resolveDiscoverOptions({ source: 'ceda', limit: 'many' }), UsageError);
  assert.throws(() => resolveDiscoverOptions({}), /--source is required/);
});

test('cmdSources reports credential PRESENCE only and never prints the key', async () => {
  const result = await cmdSources({}, {
    mandiConfig: fakeMandiConfig({ cedaApiKey: FAKE_CEDA_KEY, provider: 'CEDA', warnings: ['a warning'] }),
    tcp: async (host) => ({ ok: host === 'api.ceda.ashoka.edu.in', code: host === 'api.ceda.ashoka.edu.in' ? 'CONNECTED' : 'ECONNREFUSED' }),
  });
  assert.equal(result.exitCode, EXIT.SUCCESS);
  assert.equal(result.data.credentials_printed, false);
  assert.equal(result.data.configured_provider, 'CEDA');
  assert.deepEqual(result.data.warnings, ['a warning']);

  const ceda = result.data.sources.find((s) => s.key === 'ceda');
  assert.equal(ceda.credential_present, true);
  assert.equal(ceda.credential_env, 'CEDA_API_KEY');
  assert.equal(ceda.reachable, true);
  assert.equal(JSON.stringify(result.data).includes(FAKE_CEDA_KEY), false, 'the key must never appear in sources output');

  const dgi = result.data.sources.find((s) => s.key === 'data-gov-in');
  assert.equal(dgi.credential_present, false);
  assert.equal(dgi.reachable, false);
  assert.match(dgi.reachability, /not attempted/);
});

test('cmdSources never opens a connection for a source without a credential', async () => {
  const hosts = [];
  await cmdSources({}, {
    mandiConfig: fakeMandiConfig(),
    tcp: async (host) => { hosts.push(host); return { ok: true, code: 'CONNECTED' }; },
  });
  assert.deepEqual(hosts, [], 'no credential means no reachability probe at all');
});

test('cmdDiscover refuses a source without a credential instead of printing anything', async () => {
  await assert.rejects(cmdDiscover({ source: 'ceda' }, { mandiConfig: fakeMandiConfig() }), (err) => {
    assert.equal(err.code, 'SOURCE_NOT_CONFIGURED');
    return true;
  });
});

// ── option parsing: sample / preview caps ──────────────────────────────────

test('resolveSampleOptions defaults to a 1-day window and applies every documented cap', () => {
  const resolved = resolveSampleOptions({ source: 'data-gov-in' }, { today: '2026-10-02' });
  assert.equal(resolved.days, SAMPLE_DEFAULT_DAYS);
  assert.equal(resolved.days, 1);
  assert.equal(resolved.fromDate, '2026-10-02');
  assert.equal(resolved.toDate, '2026-10-02');
  assert.equal(resolved.limit, 100);
  assert.equal(resolved.maxPages, 2);
  assert.equal(resolved.maxRecords, 100);

  const wider = resolveSampleOptions({ source: 'data-gov-in', days: '3' }, { today: '2026-10-02' });
  assert.equal(wider.fromDate, '2026-09-30');
  assert.equal(wider.toDate, '2026-10-02');
});

test('sample cannot exceed the 7-day hard cap', () => {
  assert.equal(resolveSampleOptions({ days: '7' }, { today: '2026-10-02' }).days, SAMPLE_MAX_DAYS);
  assert.throws(() => resolveSampleOptions({ days: '8' }, { today: '2026-10-02' }), (err) => {
    assert.ok(err instanceof SafetyRefusalError);
    assert.equal(exitCodeForError(err), EXIT.SAFETY_REFUSAL);
    assert.match(err.message, /--days=8 exceeds the hard cap of 7/);
    return true;
  });
  assert.throws(() => resolveSampleOptions({ days: '0' }, { today: '2026-10-02' }), UsageError);
  assert.throws(() => resolveSampleOptions({ days: 'many' }, { today: '2026-10-02' }), UsageError);
});

test('sample caps --max-pages and --limit, and both overruns are safety refusals', () => {
  assert.equal(resolveSampleOptions({ 'max-pages': String(SAMPLE_MAX_PAGES) }).maxPages, SAMPLE_MAX_PAGES);
  assert.equal(resolveSampleOptions({ 'max-pages': '5', limit: '2500' }).maxRecords, SAMPLE_MAX_LIMIT);
  assert.throws(() => resolveSampleOptions({ 'max-pages': '6' }), SafetyRefusalError);
  assert.throws(() => resolveSampleOptions({ limit: '2501' }), SafetyRefusalError);
});

test('sample refuses an inverted or malformed window and a scope-less CEDA request', () => {
  assert.throws(() => resolveSampleOptions({ from: '2026-10-05', to: '2026-10-01' }), /--from .* is after --to/);
  assert.throws(() => resolveSampleOptions({ to: '02-10-2026' }), /--to must be an ISO calendar day/);
  assert.throws(() => resolveSampleOptions({ source: 'ceda' }), /--commodity is required for --source=ceda/);
  assert.throws(() => resolveSampleOptions({ source: 'ceda', commodity: 'Onion' }), /--state is required for --source=ceda/);
  assert.throws(() => resolveSampleOptions({ source: 'ceda', commodity: 'Onion', state: 'Maharashtra' }), /--district is required/);
  const scoped = resolveSampleOptions({ source: 'ceda', commodity: 'Onion', state: 'Maharashtra', district: 'Nashik' });
  assert.equal(scoped.source, 'ceda');
  assert.equal(scoped.commodity, 'Onion');
});

test('preview uses the same caps as sample', () => {
  assert.throws(() => resolveSampleOptions({ days: '30' }), SafetyRefusalError);
  assert.deepEqual(resolveSampleOptions({}, { today: '2026-10-02' }), resolveSampleOptions({}, { today: '2026-10-02' }));
});

// ── sample / preview never write ───────────────────────────────────────────

test('cmdSample prints exactly what the provider returned and writes nothing', async () => {
  const provider = fakeProvider([VALID_RAW]);
  const result = await cmdSample({ source: 'data-gov-in' }, {
    mandiConfig: fakeMandiConfig({ dataGovApiKey: FAKE_DGI_KEY }), provider, today: '2026-10-02',
  });
  assert.equal(result.exitCode, EXIT.SUCCESS);
  assert.equal(result.data.writes, false);
  assert.equal(result.data.fetched, 1);
  assert.equal(result.data.records[0].modal_price, 1500);
  assert.equal(provider.lastOptions.maxRecords, 100);
  assert.equal(provider.lastOptions.fromDate, '2026-10-02');
});

test('cmdPreview normalises, validates and dedups WITHOUT any database write', async () => {
  const result = await cmdPreview({ source: 'data-gov-in' }, {
    mandiConfig: fakeMandiConfig({ dataGovApiKey: FAKE_DGI_KEY }),
    provider: fakeProvider([VALID_RAW, { ...VALID_RAW, source_record_key: 'other', modal_price: 1600 }]),
    today: '2026-10-02',
  });
  assert.equal(result.exitCode, EXIT.SUCCESS);
  assert.equal(result.data.wrote, false);
  assert.equal(result.data.database_writes, 0);
  assert.equal(result.data.fetched, 2);
  assert.equal(result.data.valid, 2);
  assert.equal(result.data.rejected, 0);
  assert.equal(result.data.duplicatesRemoved, 1, 'the same market/commodity/day is a duplicate observation');
  assert.equal(result.data.wouldWrite.length, 1, 'only the deduplicated observation would be written');
  const row = result.data.wouldWrite[0];
  assert.equal(row.price_date, '2026-10-01', 'DD/MM/YYYY is normalised to ISO');
  assert.equal(row.price_unit, 'INR/quintal');
  assert.ok(['VALID', 'FLAGGED'].includes(row.quality_status));
  assert.match(row.content_hash, /^[0-9a-f]{64}$/);
});

test('analyseBatch reports rejections honestly and never invents a price', () => {
  const analysis = analyseBatch([
    VALID_RAW,
    { ...VALID_RAW, source_record_key: 'bad', modal_price: null },
  ]);
  assert.equal(analysis.fetched, 2);
  assert.equal(analysis.valid, 1);
  assert.equal(analysis.rejected, 1);
  assert.equal(analysis.wrote, false);
  assert.ok(Object.keys(analysis.rejectionSummary).length > 0);
  assert.equal(analysis.wouldWrite.length, 1);
  for (const row of analysis.wouldWrite) assert.notEqual(row.modal_price, null);
});

test('cmdSample and cmdPreview are blocked when the credential is missing', async () => {
  await assert.rejects(cmdSample({ source: 'data-gov-in' }, { mandiConfig: fakeMandiConfig(), provider: fakeProvider([], { configured: false }) }), (err) => {
    assert.equal(err.code, 'SOURCE_NOT_CONFIGURED');
    assert.equal(exitCodeForError(err), EXIT.BLOCKED);
    return true;
  });
  await assert.rejects(cmdPreview({ source: 'ceda', commodity: 'Onion', state: 'Maharashtra', district: 'Nashik' }, {
    mandiConfig: fakeMandiConfig(), provider: fakeProvider([], { source: 'CEDA', configured: false }),
  }), (err) => err.code === 'SOURCE_NOT_CONFIGURED');
});

// ── incremental ────────────────────────────────────────────────────────────

test('resolveIncrementalOptions defaults the window to MANDI_SYNC_LOOKBACK_DAYS and caps it', () => {
  const resolved = resolveIncrementalOptions({}, { mandiConfig: fakeMandiConfig({ syncLookbackDays: 5 }) });
  assert.equal(resolved.lookbackDays, 5);
  assert.equal(resolved.budgetGb, 10, 'the working-data budget defaults to DEFAULT_BUDGET_GB');
  assert.equal(resolved.minFreeGb, 20);
  assert.throws(() => resolveIncrementalOptions({ 'lookback-days': '31' }, { mandiConfig: fakeMandiConfig() }), SafetyRefusalError);
  assert.throws(() => resolveIncrementalOptions({ 'budget-gb': '-1' }), UsageError);
});

test('cmdIncremental routes through MandiPipeline and reports the ingestion_run_id', async () => {
  const dir = await tempDir();
  const seen = [];
  try {
    const pipeline = {
      runPipeline: async (options) => {
        seen.push(options);
        return {
          source: 'DATA_GOV_IN', status: 'SUCCESS', run_id: 77, window_from: '2026-09-30', window_to: '2026-10-02',
          records_fetched: 5, records_valid: 5, records_inserted: 4, records_updated: 1, records_unchanged: 0,
          records_rejected: 0, records_failed: 0, conflicts_detected: 0, rejection_summary: {}, error_code: null,
          error_details: null, execution_time_ms: 12,
        };
      },
    };
    const result = await cmdIncremental({ 'out-dir': dir, 'source': 'data-gov-in' }, {
      mandiConfig: fakeMandiConfig({ dataGovApiKey: FAKE_DGI_KEY }),
      db: { pool: {} },
      confirmDatabase: 'fasalytics',
      pipeline,
    });
    assert.equal(result.exitCode, EXIT.SUCCESS);
    assert.equal(result.data.advisory_lock_id, 7_301_301, 'the pipeline advisory lock prevents concurrent runs');
    assert.equal(result.data.runs.length, 1);
    assert.equal(result.data.runs[0].ingestion_run_id, 77);
    assert.equal(result.data.runs[0].status, 'SUCCESS');
    assert.equal(seen[0].provider, 'DATA_GOV_IN');
    assert.equal(seen[0].triggeredBy, 'cli:mandi-ingest:incremental');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('cmdIncremental skips a provider with no credential instead of failing the run', async () => {
  const dir = await tempDir();
  try {
    const result = await cmdIncremental({ 'out-dir': dir, 'source': 'all' }, {
      mandiConfig: fakeMandiConfig(),
      db: { pool: {} },
      confirmDatabase: 'fasalytics',
      pipeline: { runPipeline: async () => { throw new Error('must not be called'); } },
    });
    assert.equal(result.exitCode, EXIT.SUCCESS);
    assert.deepEqual(result.data.runs.map((r) => r.status), ['SKIPPED', 'SKIPPED']);
    assert.match(result.data.runs[0].reason, /CEDA_API_KEY is not configured/);
    assert.match(result.data.runs[1].reason, /DATA_GOV_IN_API_KEY is not configured/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ── historical: the confirmation gate ──────────────────────────────────────

test('resolveHistoricalOptions defaults to the full CEDA window and needs a bounded scope', () => {
  const resolved = resolveHistoricalOptions({ commodity: 'Onion', state: 'Maharashtra', district: 'Nashik' });
  assert.equal(resolved.fromDate, CEDA_HISTORICAL_START);
  assert.equal(resolved.toDate, CEDA_HISTORICAL_END);
  assert.equal(resolved.maxRows, HISTORICAL_DEFAULT_MAX_ROWS);
  assert.equal(resolved.dryRun, true, 'dry-run is the default until the run is confirmed');
  assert.equal(resolved.confirmed, false);
  assert.throws(() => resolveHistoricalOptions({ state: 'Maharashtra', district: 'Nashik' }), /--commodity is required/);
  assert.throws(() => resolveHistoricalOptions({ commodity: 'Onion', district: 'Nashik' }), /--state is required/);
  assert.throws(() => resolveHistoricalOptions({ commodity: 'Onion', state: 'Maharashtra' }), /--district is required/);
  assert.throws(() => resolveHistoricalOptions({ commodity: 'Onion', state: 'M', district: 'N', from: '2020-01-01' }), /must lie within/);
  assert.throws(() => resolveHistoricalOptions({ commodity: 'Onion', state: 'M', district: 'N', from: '2026-01-01', to: '2025-01-01' }), /--from .* is after --to/);
});

test('historical REFUSES without the exact confirmation token', () => {
  assert.throws(() => assertHistoricalConfirmed({}), (err) => {
    assert.ok(err instanceof SafetyRefusalError);
    assert.equal(exitCodeForError(err), EXIT.SAFETY_REFUSAL);
    assert.match(err.message, /is not started automatically/);
    assert.match(err.message, new RegExp(CONFIRM_FULL_RUN_TOKEN));
    return true;
  });
});

test('historical ACCEPTS the exact confirmation token and rejects a wrong one', () => {
  assert.equal(assertHistoricalConfirmed({ 'confirm-full-run': CONFIRM_FULL_RUN_TOKEN }), true);
  for (const wrong of ['yes', 'YES-DOWNLOAD-FIVE-YEAR-NATIONWIDE-HISTORICAL-BACKFILL ', 'confirm', '1', CONFIRM_CLEANUP_TOKEN]) {
    assert.throws(() => assertHistoricalConfirmed({ 'confirm-full-run': wrong }), (err) => {
      assert.ok(err instanceof SafetyRefusalError);
      assert.equal(exitCodeForError(err), EXIT.SAFETY_REFUSAL);
      assert.match(err.message, /did not match the required literal/);
      return true;
    });
  }
});

test('cmdHistorical without confirmation runs the storage-estimation preflight and downloads nothing', async () => {
  let estimateCalls = 0;
  const result = await cmdHistorical({ commodity: 'Onion', state: 'Maharashtra', district: 'Nashik' }, {
    mandiConfig: fakeMandiConfig(),
    estimateStorage: async (input) => {
      estimateCalls += 1;
      return { verdict: 'PROCEED', measured: { freeGb: 99 }, estimated: { rows: 10, estimatedBytes: 1024 }, downloaded: false, received: input };
    },
  });
  assert.equal(estimateCalls, 1, 'the preflight is what runs instead of the download');
  assert.equal(result.exitCode, EXIT.SAFETY_REFUSAL);
  assert.equal(result.data.refused, true);
  assert.equal(result.data.downloaded, false);
  assert.equal(result.data.required_token, CONFIRM_FULL_RUN_TOKEN);
  assert.match(result.data.command_line, new RegExp(`--confirm-full-run=${CONFIRM_FULL_RUN_TOKEN}`));
  assert.equal(result.data.estimate.received.fromDate, CEDA_HISTORICAL_START);
  assert.equal(result.data.estimate.received.toDate, CEDA_HISTORICAL_END);
});

test('cmdHistorical with the exact token runs the window runner and honours --dry-run=false', async () => {
  let ran = false;
  const result = await cmdHistorical(
    { commodity: 'Onion', state: 'Maharashtra', district: 'Nashik', 'confirm-full-run': CONFIRM_FULL_RUN_TOKEN, 'max-rows': '25' },
    {
      mandiConfig: fakeMandiConfig({ cedaApiKey: FAKE_CEDA_KEY }),
      provider: { isConfigured: () => true },
      runHistoricalWindows: async (input) => {
        ran = true;
        return { windowsCompleted: 2, rowsWritten: 2, stoppedReason: null, manifest: {}, maxRows: input.maxRows, outDir: input.outDir };
      },
    }
  );
  assert.equal(ran, true);
  assert.equal(result.exitCode, EXIT.SUCCESS);
  assert.equal(result.data.confirmed, true);
  assert.equal(result.data.dry_run, false);
});

test('cmdHistorical with the token but --dry-run stays a refusal and never downloads', async () => {
  let ran = false;
  const result = await cmdHistorical(
    { commodity: 'Onion', state: 'Maharashtra', district: 'Nashik', 'confirm-full-run': CONFIRM_FULL_RUN_TOKEN, 'dry-run': 'true' },
    {
      mandiConfig: fakeMandiConfig({ cedaApiKey: FAKE_CEDA_KEY }),
      provider: { isConfigured: () => true },
      runHistoricalWindows: async () => { ran = true; return {}; },
      estimateStorage: async () => ({ verdict: 'PROCEED', downloaded: false }),
    }
  );
  assert.equal(ran, false);
  assert.equal(result.exitCode, EXIT.SAFETY_REFUSAL);
  assert.equal(result.data.downloaded, false);
  assert.ok(result.data.windows > 0, 'the dry run still reports the planned window count');
});

test('a wrong historical token produces a refusal, not a download', async () => {
  let ran = false;
  const result = await cmdHistorical(
    { commodity: 'Onion', state: 'Maharashtra', district: 'Nashik', 'confirm-full-run': 'ALMOST' },
    {
      mandiConfig: fakeMandiConfig({ cedaApiKey: FAKE_CEDA_KEY }),
      provider: { isConfigured: () => true },
      runHistoricalWindows: async () => { ran = true; return {}; },
      estimateStorage: async () => ({ verdict: 'PROCEED' }),
    }
  );
  assert.equal(ran, false);
  assert.equal(result.exitCode, EXIT.SAFETY_REFUSAL);
  assert.match(result.data.refusal, /did not match the required literal/);
});

test('historical --max-rows is a hard cap and a bad value is a usage error', () => {
  const capped = resolveHistoricalOptions({ commodity: 'Onion', state: 'M', district: 'N', 'max-rows': '5000' });
  assert.equal(capped.maxRows, 5000);
  assert.throws(() => resolveHistoricalOptions({ commodity: 'Onion', state: 'M', district: 'N', 'max-rows': '0' }), UsageError);
  assert.throws(() => resolveHistoricalOptions({ commodity: 'Onion', state: 'M', district: 'N', 'max-rows': '-5' }), UsageError);
  assert.throws(() => resolveHistoricalOptions({ commodity: 'Onion', state: 'M', district: 'N', 'window-days': '400' }), SafetyRefusalError);
});

// ── estimate ───────────────────────────────────────────────────────────────

test('resolveEstimateOptions computes the span and accepts an operator assumption', () => {
  const resolved = resolveEstimateOptions({ from: '2021-10-01', to: '2021-10-31', 'assumed-rows': '1000' });
  assert.equal(resolved.days, 31);
  assert.equal(resolved.assumedRows, 1000);
  assert.equal(resolved.budgetGb, 10);
  assert.equal(resolveEstimateOptions({}).assumedRows, null);
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 1);
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 31);
});

test('estimateStorage extrapolates from a MEASURED bytes/row and labels it as estimated', async () => {
  const dir = await tempDir();
  try {
    const huge = 400 * 1024 ** 3;
    const report = await estimateStorage({
      fromDate: '2021-10-01', toDate: '2026-09-30', days: 1826, assumedRows: 1_000_000,
      budgetGb: 10, minFreeGb: 10, outDir: dir,
      deps: {
        pool: { async query() { return { rows: [] }; } },
        createQualityReportService: () => ({
          generateReport: async () => ({
            records: { total_rows: 500 },
            storage: { mean_bytes_per_row: 1500, mean_bytes_per_row_basis: 'table_bytes / rows, both measured' },
          }),
        }),
        measureDisk: async () => ({ freeBytes: huge, method: 'fake' }),
        createBudget: () => ({
          report: async () => ({ usage: { bytes: 0 }, free: { freeBytes: huge }, floor: { gb: 10 }, floorSatisfied: true }),
        }),
      },
    });
    assert.equal(report.measured.databaseReachable, true);
    assert.equal(report.measured.bytesPerRow, 1500);
    assert.match(report.measured.bytesPerRowBasis, /^measured/);
    assert.equal(report.measured.freeGb, 400);
    assert.equal(report.estimated.rows, 1_000_000);
    assert.match(report.estimated.rowsBasis, /operator assumption/);
    assert.equal(report.estimated.estimatedBytes, 1_500_000_000);
    assert.equal(report.estimated.estimatedGb, 1.4);
    assert.equal(report.downloaded, false, 'the preflight never downloads');
    assert.equal(report.verdict, 'PROCEED');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('estimateStorage never guesses a size when nothing has been measured yet', async () => {
  const dir = await tempDir();
  try {
    const report = await estimateStorage({
      fromDate: '2021-10-01', toDate: '2026-09-30', days: 1826, assumedRows: null,
      budgetGb: 10, minFreeGb: 10, outDir: dir,
      deps: {
        pool: null,
        measureDisk: async () => ({ freeBytes: 400 * 1024 ** 3, method: 'fake' }),
        createBudget: () => ({
          report: async () => ({ usage: { bytes: 0 }, free: { freeBytes: 400 * 1024 ** 3 }, floor: { gb: 10 }, floorSatisfied: true }),
        }),
      },
    });
    assert.equal(report.measured.bytesPerRow, null);
    assert.equal(report.estimated.estimatedBytes, null);
    assert.equal(report.verdict, 'UNKNOWN_SIZE');
    assert.ok(report.notes.some((n) => /no bytes-per-row sample exists/.test(n)));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('estimateStorage refuses (fails closed) when free space cannot be measured', async () => {
  const dir = await tempDir();
  try {
    const report = await estimateStorage({
      fromDate: '2021-10-01', toDate: '2026-09-30', days: 1826, assumedRows: 1000,
      budgetGb: 10, minFreeGb: 10, outDir: dir,
      deps: {
        pool: null,
        measureDisk: async () => { throw new InsufficientDiskSpaceError('Cannot determine free space', { code: 'DISK_SPACE_UNKNOWN' }); },
        createBudget: () => ({ report: async () => { throw new InsufficientDiskSpaceError('Cannot determine free space', { code: 'DISK_SPACE_UNKNOWN' }); } }),
      },
    });
    assert.equal(report.verdict, 'UNKNOWN_FREE_SPACE');
    assert.equal(report.measured.freeBytes, null);
    assert.equal(report.measured.freeGb, null, 'an unmeasured value is never turned into a number');
    assert.equal(report.estimated.estimatedBytes, null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('estimateStorage refuses a run that would breach the 10 GB budget', async () => {
  const dir = await tempDir();
  try {
    const huge = 20 * 1024 ** 3;
    const report = await estimateStorage({
      fromDate: '2021-10-01', toDate: '2026-09-30', days: 1826, assumedRows: 10_000_000,
      budgetGb: 10, minFreeGb: 10, outDir: dir,
      deps: {
        pool: {
          async query() { return { rows: [] }; },
        },
        createQualityReportService: () => ({
          generateReport: async () => ({
            records: { total_rows: 100 },
            storage: { mean_bytes_per_row: 2000, mean_bytes_per_row_basis: 'test fixture' },
          }),
        }),
        measureDisk: async () => ({ freeBytes: huge, method: 'fake' }),
        createBudget: () => ({
          report: async () => ({ usage: { bytes: 0 }, free: { freeBytes: huge }, floor: { gb: 10 }, floorSatisfied: true }),
          explainWrite: async (n) => ({ allowed: true, reason: 'OK', requestedBytes: n }),
        }),
      },
    });
    assert.equal(report.measured.bytesPerRow, 2000);
    assert.match(report.measured.bytesPerRowBasis, /measured/);
    assert.equal(report.estimated.estimatedBytes, 20_000_000_000);
    assert.equal(report.verdict, 'REFUSE_BUDGET');
    assert.match(report.reasons[0], /budget/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('cmdEstimate returns a safety exit code for anything other than PROCEED', async () => {
  const ok = await cmdEstimate({ 'assumed-rows': '10' }, {
    pool: null,
    estimateStorage: async () => ({ verdict: 'PROCEED', measured: {}, estimated: {} }),
  });
  assert.equal(ok.exitCode, EXIT.SUCCESS);
  assert.equal(ok.data.downloaded, false);

  const refused = await cmdEstimate({ 'assumed-rows': '10' }, {
    pool: null,
    estimateStorage: async () => ({ verdict: 'REFUSE_FLOOR', measured: {}, estimated: {} }),
  });
  assert.equal(refused.exitCode, EXIT.SAFETY_REFUSAL);
});

// ── cleanup ────────────────────────────────────────────────────────────────

test('cleanup refuses without its token and with a wrong token', () => {
  assert.throws(() => assertCleanupConfirmed({}), (err) => {
    assert.ok(err instanceof SafetyRefusalError);
    assert.equal(exitCodeForError(err), EXIT.SAFETY_REFUSAL);
    assert.match(err.message, /Nothing was deleted/);
    return true;
  });
  assert.throws(() => assertCleanupConfirmed({ 'confirm-cleanup': 'yes' }), /did not match the required literal/);
  assert.throws(() => assertCleanupConfirmed({ 'confirm-cleanup': CONFIRM_FULL_RUN_TOKEN }), SafetyRefusalError);
  assert.equal(assertCleanupConfirmed({ 'confirm-cleanup': CONFIRM_CLEANUP_TOKEN }), true);
});

test('cmdCleanup removes only raw downloads and never the database or the exports', async () => {
  const dir = await tempDir();
  try {
    await fsp.mkdir(path.join(dir, 'ceda', 'commodity=1'), { recursive: true });
    const rawFile = path.join(dir, 'ceda', 'commodity=1', '2021_2022.raw.json.gz');
    const partialFile = path.join(dir, 'ceda', 'commodity=1', '2021_2022.csv.gz.partial');
    const exportFile = path.join(dir, 'ceda', 'commodity=1', '2021_2022.csv.gz');
    const manifestFile = path.join(dir, 'manifest_historical.json');
    for (const file of [rawFile, partialFile, exportFile, manifestFile]) await fsp.writeFile(file, 'x');

    await assert.rejects(cmdCleanup({ 'out-dir': dir }, { mandiConfig: fakeMandiConfig() }), SafetyRefusalError);
    assert.equal((await fsp.stat(rawFile)).isFile(), true, 'the refusal path deletes nothing');

    const result = await cmdCleanup({ 'out-dir': dir, 'confirm-cleanup': CONFIRM_CLEANUP_TOKEN }, { mandiConfig: fakeMandiConfig() });
    assert.equal(result.exitCode, EXIT.SUCCESS);
    assert.equal(result.data.database_touched, false);
    assert.equal(result.data.removed_files, 2);
    await assert.rejects(fsp.stat(rawFile), { code: 'ENOENT' });
    await assert.rejects(fsp.stat(partialFile), { code: 'ENOENT' });
    assert.equal((await fsp.stat(exportFile)).isFile(), true, 'normalised exports are never removed');
    assert.equal((await fsp.stat(manifestFile)).isFile(), true, 'the checkpoint manifest is never removed');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('cleanup --dry-run with the token reports what it would remove and removes nothing', async () => {
  const dir = await tempDir();
  try {
    const rawFile = path.join(dir, '2021_2022.raw.json.gz');
    await fsp.writeFile(rawFile, 'x');
    const result = await cmdCleanup({ 'out-dir': dir, 'confirm-cleanup': CONFIRM_CLEANUP_TOKEN, 'dry-run': true }, { mandiConfig: fakeMandiConfig() });
    assert.equal(result.data.dry_run, true);
    assert.equal(result.data.removed_files, 0);
    assert.equal(result.data.refused.length, 1);
    assert.equal((await fsp.stat(rawFile)).isFile(), true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('resolveCleanupOptions records whether the token was supplied at all', () => {
  assert.deepEqual(resolveCleanupOptions({ 'out-dir': 'x' }, { mandiConfig: fakeMandiConfig() }).tokenSeen, false);
  assert.equal(resolveCleanupOptions({ 'confirm-cleanup': CONFIRM_CLEANUP_TOKEN }, { mandiConfig: fakeMandiConfig() }).token, CONFIRM_CLEANUP_TOKEN);
});

// ── resume ─────────────────────────────────────────────────────────────────

test('resolveResumeOptions needs no confirmation token and mirrors the window options', () => {
  const resolved = resolveResumeOptions({ 'max-rows': '10' }, { mandiConfig: fakeMandiConfig() });
  assert.equal(resolved.maxRows, 10);
  assert.equal(resolved.fromDate, CEDA_HISTORICAL_START);
  assert.equal(resolved.printOnly, false);
  assert.throws(() => resolveResumeOptions({ 'window-days': '0' }), UsageError);
});

test('cmdResume prints the remaining windows and runs only what is left', async () => {
  const dir = await tempDir();
  try {
    let ran = false;
    const result = await cmdResume({ 'out-dir': dir, 'max-rows': '10', commodity: 'Onion', state: 'Maharashtra', district: 'Nashik' }, {
      mandiConfig: fakeMandiConfig({ cedaApiKey: FAKE_CEDA_KEY }),
      provider: { isConfigured: () => true },
      runHistoricalWindows: async (input) => {
        ran = true;
        return { windowsCompleted: 1, rowsWritten: 1, stoppedReason: null, manifest: {}, maxRows: input.maxRows };
      },
    });
    assert.equal(result.data.confirmation_required, false);
    assert.ok(result.data.remaining_windows.length > 0, 'an empty manifest means every window is still pending');
    assert.equal(ran, true);
    assert.equal(result.exitCode, EXIT.SUCCESS);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('cmdResume with a missing manifest has nothing to resume and downloads nothing', async () => {
  const dir = await tempDir();
  try {
    const result = await cmdResume({ 'out-dir': dir, 'print-only': true }, { mandiConfig: fakeMandiConfig({ cedaApiKey: FAKE_CEDA_KEY }) });
    assert.equal(result.data.ran, false);
    assert.equal(result.data.downloaded, false);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ── historical window runner (no network, no database) ─────────────────────

test('runHistoricalWindows writes a gzip CSV per window, checkpoints atomically and resumes', async () => {
  const dir = await tempDir();
  const provider = {
    async resolveScope() {
      return {
        commodityId: 1, commodityName: 'Onion', stateId: 2, stateName: 'Maharashtra',
        districtId: 3, districtName: 'Nashik',
        markets: [{ market_id: 10, market_name: 'Nashik Market Yard' }],
      };
    },
    client: {
      async getPrices({ fromDate, toDate }) {
        return [{ date: fromDate, commodity_id: 1, census_state_id: 2, census_district_id: 3, market_id: 10, min_price: 1000, max_price: 2000, modal_price: 1500 }];
      },
      async getQuantities({ fromDate }) {
        return [{ date: fromDate, commodity_id: 1, market_id: 10, quantity: 12 }];
      },
    },
  };
  const silent = { log() {} };
  try {
    const first = await runHistoricalWindows({
      provider, outDir: dir, fromDate: '2021-10-01', toDate: '2021-10-10', windowDays: 5,
      minFreeGb: 10, budgetGb: 10, maxRows: 1000, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik',
      log: silent,
    });
    assert.equal(first.windowsPlanned, 2);
    assert.equal(first.windowsCompleted, 2);
    assert.equal(first.rowsWritten, 2);
    assert.equal(first.rowsValid, 2);
    assert.equal(first.remainingWindows.length, 0);
    assert.equal(first.stoppedReason, null);

    const files = await fsp.readdir(path.join(dir, 'ceda', 'commodity=1', 'state=2', 'district=3'));
    assert.equal(files.filter((f) => f.endsWith('.csv.gz')).length, 2);

    const manifestFile = JSON.parse(await fsp.readFile(path.join(dir, 'manifest_historical.json'), 'utf8'));
    assert.equal(manifestFile.integrity.complete, true);
    assert.equal(manifestFile.integrity.algorithm, 'sha256');
    assert.equal(Object.keys(manifestFile.windows).length, 2);
    assert.equal(manifestFile.source, 'CEDA');

    const second = await runHistoricalWindows({
      provider, outDir: dir, fromDate: '2021-10-01', toDate: '2021-10-10', windowDays: 5,
      minFreeGb: 10, budgetGb: 10, maxRows: 1000, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik',
      log: silent,
    });
    assert.equal(second.windowsAlreadyComplete, 2, 'a resumed run skips the finished windows');
    assert.equal(second.windowsCompleted, 0);
    assert.equal(second.rowsWritten, 0);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('runHistoricalWindows stops at --max-rows and records the reason', async () => {
  const dir = await tempDir();
  const provider = {
    async resolveScope() {
      return { commodityId: 1, commodityName: 'Onion', stateId: 2, stateName: 'Maharashtra', districtId: 3, districtName: 'Nashik', markets: [{ market_id: 10, market_name: 'M' }] };
    },
    client: {
      async getPrices({ fromDate }) { return [{ date: fromDate, commodity_id: 1, market_id: 10, min_price: 1000, max_price: 2000, modal_price: 1500 }]; },
      async getQuantities({ fromDate }) { return [{ date: fromDate, commodity_id: 1, market_id: 10, quantity: 5 }]; },
    },
  };
  try {
    const summary = await runHistoricalWindows({
      provider, outDir: dir, fromDate: '2021-10-01', toDate: '2021-10-31', windowDays: 5,
      minFreeGb: 10, budgetGb: 10, maxRows: 5, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik',
      log: { log() {} },
    });
    assert.equal(summary.windowsPlanned, 7);
    assert.equal(summary.windowsCompleted, 5, 'one row per window, so five windows hit the cap');
    assert.match(summary.stoppedReason, /max-rows \(5\) reached/);
    assert.equal(summary.remainingWindows.length, 2);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('runHistoricalWindows fails closed when the disk floor cannot be guaranteed', async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(runHistoricalWindows({
      provider: {}, outDir: dir, fromDate: '2021-10-01', toDate: '2021-10-05', windowDays: 5,
      minFreeGb: 10, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik',
      deps: { assertSpace: async () => { throw new InsufficientDiskSpaceError('free space unknown', { code: 'DISK_SPACE_UNKNOWN' }); } },
    }), (err) => {
      assert.equal(err.code, 'DISK_SPACE_UNKNOWN');
      assert.equal(exitCodeForError(err), EXIT.SAFETY_REFUSAL);
      return true;
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('runHistoricalWindows records a failed window in the manifest and stops', async () => {
  const dir = await tempDir();
  const provider = {
    async resolveScope() {
      return { commodityId: 1, commodityName: 'Onion', stateId: 2, stateName: 'Maharashtra', districtId: 3, districtName: 'Nashik', markets: [] };
    },
    client: {
      async getPrices() { throw new SourceHttpError('CEDA responded HTTP 503', { status: 503, code: 'HTTP_ERROR' }); },
      async getQuantities() { return []; },
    },
  };
  try {
    const summary = await runHistoricalWindows({
      provider, outDir: dir, fromDate: '2021-10-01', toDate: '2021-10-05', windowDays: 5,
      minFreeGb: 10, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik', log: { log() {} },
    });
    assert.ok(summary.stoppedReason);
    assert.equal(summary.error.code, 'HTTP_ERROR');
    const manifestFile = JSON.parse(await fsp.readFile(path.join(dir, 'manifest_historical.json'), 'utf8'));
    assert.equal(Object.values(manifestFile.windows)[0].status, 'failed');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ── routing ────────────────────────────────────────────────────────────────

test('every subcommand routes to its own handler', async () => {
  const expected = {
    sources: cmdSources,
    discover: cmdDiscover,
    sample: cmdSample,
    preview: cmdPreview,
    historical: cmdHistorical,
    resume: cmdResume,
    estimate: cmdEstimate,
    cleanup: cmdCleanup,
  };
  for (const [name, handler] of Object.entries(expected)) {
    assert.equal(resolveHandler(name).handler, handler, `${name} must route to its handler`);
  }
  assert.equal(typeof resolveHandler('incremental').handler, 'function');
  assert.equal(typeof resolveHandler('status').handler, 'function');
  assert.deepEqual(Object.keys(SUBCOMMANDS), ['sources', 'discover', 'sample', 'preview', 'incremental', 'historical', 'resume', 'status', 'estimate', 'cleanup']);
});

test('routing is case-insensitive and refuses an unknown or missing subcommand', () => {
  assert.equal(resolveHandler('SOURCES').handler, cmdSources);
  assert.throws(() => resolveHandler('scraper'), (err) => {
    assert.ok(err instanceof UsageError);
    assert.match(err.message, /unknown subcommand "scraper"/);
    return true;
  });
  assert.throws(() => resolveHandler(undefined), /a subcommand is required/);
  assert.throws(() => resolveHandler(''), /a subcommand is required/);
});

test('runCommand wraps a handler result with the subcommand and its exit code', async () => {
  const result = await runCommand('sources', {}, { mandiConfig: fakeMandiConfig(), tcp: async () => ({ ok: false, code: 'ECONNREFUSED' }) });
  assert.equal(result.subcommand, 'sources');
  assert.equal(result.exitCode, EXIT.SUCCESS);
  assert.equal(result.data.sources.length, 2);
});

// ── exit codes ─────────────────────────────────────────────────────────────

test('exit-code mapping: 1 error, 2 safety refusal, 3 blocked', () => {
  assert.equal(exitCodeForError(new Error('boom')), EXIT.ERROR);
  assert.equal(exitCodeForError(new UsageError('bad flag')), EXIT.ERROR);

  assert.equal(exitCodeForError(new SafetyRefusalError('refused')), EXIT.SAFETY_REFUSAL);
  assert.equal(exitCodeForError(new InsufficientDiskSpaceError('low', { code: 'INSUFFICIENT_DISK_SPACE' })), EXIT.SAFETY_REFUSAL);
  assert.equal(exitCodeForError(new InsufficientDiskSpaceError('unknown', { code: 'DISK_SPACE_UNKNOWN' })), EXIT.SAFETY_REFUSAL);
  assert.equal(exitCodeForError(new BudgetExceededError('budget', {})), EXIT.SAFETY_REFUSAL);
  assert.equal(exitCodeForError({ code: 'WOULD_BREACH_DISK_FLOOR' }), EXIT.SAFETY_REFUSAL);

  assert.equal(exitCodeForError(new SourceNotConfiguredError('CEDA', 'no key')), EXIT.BLOCKED);
  assert.equal(exitCodeForError(new SourceHttpError('HTTP 401', { status: 401, code: 'UNAUTHORIZED' })), EXIT.BLOCKED);
  assert.equal(exitCodeForError(new SourceHttpError('HTTP 429', { status: 429, code: 'RATE_LIMITED' })), EXIT.BLOCKED);
  assert.equal(exitCodeForError({ code: 'NETWORK_ERROR' }), EXIT.BLOCKED);
  assert.equal(exitCodeForError({ code: 'DB_UNAVAILABLE' }), EXIT.BLOCKED);
});

test('main() maps a safety refusal to exit code 2 without printing anything else', async () => {
  const { result, err } = await capture(() => main(['cleanup', '--out-dir=data/mandi'], { mandiConfig: fakeMandiConfig() }));
  assert.equal(result, EXIT.SAFETY_REFUSAL);
  assert.match(err, /refuses to run without --confirm-cleanup/);
});

test('main() maps an unknown subcommand to exit code 1 and a missing one too', async () => {
  const unknown = await capture(() => main(['scraper']));
  assert.equal(unknown.result, EXIT.ERROR);
  assert.match(unknown.err, /unknown subcommand "scraper"/);

  const empty = await capture(() => main([]));
  assert.equal(empty.result, EXIT.SUCCESS);
  assert.match(empty.out, /USAGE/);
});

test('main() refuses a second positional argument', async () => {
  const { result, err } = await capture(() => main(['sources', 'discover']));
  assert.equal(result, EXIT.ERROR);
  assert.match(err, /only one subcommand is accepted/);
});

test('main() --help prints the full contract and exits 0', async () => {
  const { result, out } = await capture(() => main(['--help']));
  assert.equal(result, EXIT.SUCCESS);
  for (const name of Object.keys(SUBCOMMANDS)) assert.match(out, new RegExp(`\\b${name}\\b`));
  assert.match(out, /EXIT CODES/);
  assert.match(out, new RegExp(CONFIRM_FULL_RUN_TOKEN));
  assert.match(out, new RegExp(CONFIRM_CLEANUP_TOKEN));
  assert.equal(helpText(), out);
});

// ── redaction ──────────────────────────────────────────────────────────────

test('a fake credential in a thrown error message never reaches the output', async () => {
  const mandiConfig = fakeMandiConfig({ cedaApiKey: FAKE_CEDA_KEY, dataGovApiKey: FAKE_DGI_KEY });
  const secrets = secretValues(mandiConfig, { database: {}, firebase: {}, email: {} });
  assert.ok(secrets.includes(FAKE_CEDA_KEY));
  assert.ok(secrets.includes(FAKE_DGI_KEY));

  const thrown = new Error(`CEDA responded HTTP 401 for https://api.ceda.ashoka.edu.in/v1/agmarknet/prices?api-key=${FAKE_CEDA_KEY}`);
  const safe = safeText(thrown.message, secrets);
  assert.equal(safe.includes(FAKE_CEDA_KEY), false);
  assert.match(safe, /REDACTED/);

  const provider = {
    isConfigured: () => true,
    client: {
      listCommodities: async () => {
        throw new SourceHttpError(`CEDA responded HTTP 401 for /v1/agmarknet/commodities?api-key=${FAKE_CEDA_KEY}`, { status: 401, code: 'UNAUTHORIZED' });
      },
      listGeographies: async () => [],
    },
  };
  const { result, err, out } = await capture(() => main(
    ['discover', '--source=ceda', '--json'],
    { mandiConfig, provider },
  ));
  assert.equal(result, EXIT.BLOCKED);
  assert.equal(out.includes(FAKE_CEDA_KEY), false);
  assert.equal(err.includes(FAKE_CEDA_KEY), false);
  assert.match(err, /discover failed/);
});

test('secretValues ignores short and empty values so it can never mangle output', () => {
  const secrets = secretValues(fakeMandiConfig({ cedaApiKey: 'ab', dataGovApiKey: '' }), {});
  assert.deepEqual(secrets, []);
});