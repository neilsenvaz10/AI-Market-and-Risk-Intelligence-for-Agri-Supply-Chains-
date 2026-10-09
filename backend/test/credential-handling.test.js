/**
 * Credential-handling guarantees for the mandi sources (CEDA, data.gov.in).
 * A SENTINEL value stands in for an API key; every test asserts that it never appears in
 * errors, log output, run records, API responses, exported files or CLI argument handling.
 * No network, no database, no real key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createSourceHttpClient, redactText, redactUrl } from '../src/pipeline/http.js';
import { DataGovInProvider } from '../src/pipeline/providers/data-gov-in.provider.js';
import { CedaClient, CedaProvider } from '../src/pipeline/providers/ceda.provider.js';
import { MandiPipeline } from '../src/pipeline/index.js';
import { MandiService } from '../src/services/mandi.service.js';
import { createMandiSyncScheduler } from '../src/pipeline/scheduler.js';
import { runCedaExport } from '../src/pipeline/historical/ceda-export.js';
import { parseMandiConfig } from '../src/config/mandiConfig.js';
import { parseArgs } from '../scripts/cli-utils.js';
import express from 'express';
import { createMandiRoutes } from '../src/routes/mandi.routes.js';
import { createMandiController } from '../src/controllers/mandi.controller.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const SENTINEL = 'SENTINEL-KEY-7f3a9c1d2e';
const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '..');
const noSentinel = (value, label) => assert.ok(!JSON.stringify(value ?? '').includes(SENTINEL), `${label} leaked the key`);

function capture() {
  const lines = [];
  const push = (...args) => lines.push(args.map(String).join(' '));
  return { lines, log: { log: push, warn: push, error: push, info: push } };
}

test('redactText removes exact secrets, key=value parameters and Bearer tokens', () => {
  assert.equal(redactText(`oops ${SENTINEL} here`, [SENTINEL]), 'oops REDACTED here');
  assert.equal(redactText('GET https://x.test/r?api-key=abc123&limit=5'), 'GET https://x.test/r?api-key=REDACTED&limit=5');
  assert.equal(redactText('failed token=zzz999'), 'failed token=REDACTED');
  assert.equal(redactText('Authorization: Bearer abc.DEF-123_x'), 'Authorization: Bearer REDACTED');
  assert.equal(redactText(undefined), '');
  assert.equal(redactText('short', ['abc']), 'short', 'secrets under 4 characters are ignored to avoid mangling text');
  assert.equal(redactUrl(`https://x.test/r?api-key=${SENTINEL}&format=json`).includes(SENTINEL), false);
});

test('redactText removes JSON key-value pairs and error structures', () => {
  assert.equal(redactText(`{"api-key":"${SENTINEL}"}`), '{"api-key":"REDACTED"}');
  assert.equal(redactText(`{"apiKey": "${SENTINEL}"}`), '{"apiKey": "REDACTED"}');
  assert.equal(redactText(`{"token": "${SENTINEL}"}`), '{"token": "REDACTED"}');
  assert.equal(redactText(`error: api_key: "${SENTINEL}"`), 'error: api_key: "REDACTED"');
});

test('API responses: POST /api/mandi/sync error payload never contains secrets even when pipeline fails', async () => {
  const leakyPipeline = {
    runPipeline: async () => {
      const err = new Error(`Source failure with key=${SENTINEL} and Bearer ${SENTINEL}`);
      const scrubbed = redactText(err.message, [SENTINEL]);
      return {
        status: 'FAILED',
        error_code: 'SOURCE_ERROR',
        error_details: scrubbed,
        records_fetched: 0,
        records_valid: 0,
        records_inserted: 0,
        records_updated: 0,
        records_unchanged: 0,
        records_rejected: 0,
        records_failed: 0,
        conflicts_detected: 0,
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mandi', createMandiRoutes({
    requireAuth: (req, res, next) => { req.auth = { uid: 'ops1' }; next(); },
    authorizeIngestion: (req, res, next) => next(),
    controller: createMandiController({ pipeline: leakyPipeline }),
  }));
  app.use(errorHandler);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/mandi/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'MOCK', days: 1 }),
    });
    const body = await res.json();
    noSentinel(body, 'POST /sync error response');
    assert.equal(res.status, 502);
    assert.match(body.data.error_details, /REDACTED/);
    assert.ok(!JSON.stringify(body).includes(SENTINEL));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('data.gov.in: network errors that echo the full request URL do not leak the key', async () => {
  const { lines, log } = capture();
  const failures = [
    async (url) => { throw new TypeError(`fetch failed: could not reach ${url}`); },
    async () => new Response(JSON.stringify({ message: `bad api-key=${SENTINEL}` }), { status: 403 }),
    async () => new Response(JSON.stringify({ message: `bad api-key=${SENTINEL}` }), { status: 500 }),
    async () => new Response(`not json ${SENTINEL}`, { status: 200 }),
  ];
  for (const fetchImpl of failures) {
    const http = createSourceHttpClient({ fetchImpl, retries: 1, baseBackoffMs: 1, requestIntervalMs: 0, log });
    const provider = new DataGovInProvider({ apiKey: SENTINEL, http });
    const error = await provider.fetchRecords({ fromDate: '2026-09-01', toDate: '2026-09-01' }).catch((e) => e);
    assert.ok(error instanceof Error);
    noSentinel({ message: error.message, url: error.url, code: error.code, stack: String(error.stack).split('\n')[0] }, 'provider error');
  }
  noSentinel(lines, 'retry log lines');
  assert.ok(lines.length > 0, 'retries were logged (so the assertion above is meaningful)');
});

test('CEDA: the key is sent only in the Authorization header and never leaks through errors or logs', async () => {
  const seen = [];
  const { lines, log } = capture();
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers });
    throw new TypeError(`fetch failed for ${url} with ${init.headers.Authorization}`);
  };
  const client = new CedaClient({ apiKey: SENTINEL, http: createSourceHttpClient({ fetchImpl, retries: 1, baseBackoffMs: 1, requestIntervalMs: 0, log }) });
  const error = await client.listCommodities().catch((e) => e);
  noSentinel({ message: error.message, url: error.url }, 'CEDA error');
  noSentinel(lines, 'CEDA log lines');
  assert.ok(seen.length >= 1);
  for (const request of seen) {
    assert.ok(!request.url.includes(SENTINEL), 'key must not be in the URL');
    assert.equal(request.headers.Authorization, `Bearer ${SENTINEL}`);
  }
});

test('pipeline run: failure text stored in the run record and logged is scrubbed, even for raw key values', async () => {
  const { lines, log } = capture();
  const client = { query: async () => ({ rows: [{ locked: true, id: 1, d: null }], rowCount: 1 }), release() {} };
  const leakyProvider = {
    getSourceCode: () => 'DATA_GOV_IN',
    isSampleSource: () => false,
    fetchRecords: async () => { throw new Error(`library failure while calling with credential ${SENTINEL} (no key= prefix)`); },
  };
  const config = { ...parseMandiConfig({}), dataGovApiKey: SENTINEL, cedaApiKey: `${SENTINEL}-ceda` };
  const pipeline = new MandiPipeline({ pool: { connect: async () => client }, mandiConfig: config, providers: { DATA_GOV_IN: leakyProvider }, persister: {}, log });
  const stats = await pipeline.runPipeline({ provider: 'DATA_GOV_IN', days: 1 });
  assert.equal(stats.status, 'FAILED');
  noSentinel(stats, 'run statistics (returned by the API and stored in pipeline_sync_logs)');
  noSentinel(lines, 'pipeline log lines');
  assert.match(stats.error_details, /REDACTED/);
});

test('scheduler: a crashing run is reported without credentials', async () => {
  const { lines, log } = capture();
  const scheduler = createMandiSyncScheduler({
    mandiConfig: parseMandiConfig({ MANDI_SYNC_INTERVAL_MINUTES: '30', MANDI_DATA_PROVIDER: 'DATA_GOV_IN' }),
    pipeline: { runPipeline: async () => { throw new Error(`boom api-key=${SENTINEL}`); } },
    setIntervalFn: () => ({ unref() {} }),
    log,
  });
  await scheduler.tick();
  noSentinel(lines, 'scheduler log');
  noSentinel(scheduler.state, 'scheduler state');
});

test('status endpoints report only whether a source is configured, never the key', async () => {
  const pool = {
    query: async (sql) => {
      if (/FROM pipeline_sync_logs ORDER/.test(sql)) return { rows: [] };
      if (/FROM mandi_sources s/.test(sql)) return { rows: [{ source: 'DATA_GOV_IN' }, { source: 'CEDA' }] };
      return { rows: [{ total_mandis: 0 }] };
    },
  };
  const service = new MandiService({ pool, mandiConfig: { ...parseMandiConfig({}), dataGovApiKey: SENTINEL, cedaApiKey: SENTINEL } });
  const status = await service.getPipelineStatus();
  noSentinel(status, 'GET /api/mandi/sync/status payload');
  assert.deepEqual(status.sources.map((s) => s.configured), [true, true]);
});

test('config warnings and scheduler descriptions never contain credentials', () => {
  const config = parseMandiConfig({
    CEDA_API_KEY: SENTINEL, DATA_GOV_IN_API_KEY: SENTINEL, MANDI_SYNC_INTERVAL_MINUTES: 'abc', MANDI_DATA_PROVIDER: 'nonsense',
    MANDI_HTTP_RETRIES: '99', MANDI_SYNC_LOOKBACK_DAYS: 'x',
  });
  noSentinel({ warnings: config.warnings, sync: config.sync }, 'config diagnostics');
  assert.ok(config.warnings.length >= 3);
  assert.equal(parseMandiConfig({ CEDA_API_KEY: 'your_ceda_api_key_here' }).cedaApiKey, '', 'template placeholder is not a key');
  assert.equal(parseMandiConfig({ CEDA_API_KEY: '  ' }).cedaApiKey, '');
});

test('CEDA export: no file written to disk (CSV, raw responses, manifest) contains the key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-cred-'));
  try {
    const http = {
      async requestJson(url, { method, body, headers }) {
        assert.equal(headers.Authorization, `Bearer ${SENTINEL}`);
        const route = `${method} ${new URL(url).pathname.replace('/v1', '')}`;
        if (route === 'GET /agmarknet/commodities') return { data: { output: { type: 'success', message: 'Data exists', data: [{ commodity_id: 23, commodity_name: 'Onion' }] } } };
        if (route === 'GET /agmarknet/geographies') return { data: { output: { type: 'success', message: 'Data exists', data: [{ census_state_id: 27, census_state_name: 'Maharashtra', census_district_id: 516, census_district_name: 'Nashik' }] } } };
        if (route === 'POST /agmarknet/markets') return { data: { data: [{ market_id: 901, market_name: 'Lasalgaon' }] } };
        if (route === 'POST /agmarknet/prices') return { data: { data: [{ date: body.from_date, commodity_id: 3, market_id: 901, min_price: 1000, max_price: 1600, modal_price: 1400 }] } };
        if (route === 'POST /agmarknet/quantities') return { data: { data: [{ date: body.from_date, market_id: 901, quantity: 5 }] } };
        throw new Error(`unexpected ${route}`);
      },
    };
    const provider = new CedaProvider({ client: new CedaClient({ apiKey: SENTINEL, http, allowUnverifiedContract: true }) });
    const summary = await runCedaExport({
      provider, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik', fromDate: '2026-09-01', toDate: '2026-09-20',
      windowDays: 10, outDir: dir, log: { log() {}, error() {} },
      guard: { assertSpace: async () => 1e12, addBytes() {}, bytesWritten: 0 },
    });
    assert.equal(summary.tasksCompleted, 2);
    const files = [];
    const walk = async (d) => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else files.push(p); } };
    await walk(dir);
    assert.ok(files.length >= 5);
    for (const file of files) {
      const raw = await fs.readFile(file);
      const text = file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
      assert.ok(!text.includes(SENTINEL), `${path.relative(dir, file)} contains the key`);
      assert.ok(!text.includes('Bearer'), `${path.relative(dir, file)} contains an Authorization header`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('CLIs refuse credentials on the command line without echoing them', () => {
  for (const flag of ['--api-key', '--ceda-api-key', '--data-gov-in-api-key', '--key', '--token', '--secret', '--password', '--private-key', '--credentials']) {
    let error;
    try { parseArgs([`${flag}=${SENTINEL}`]); } catch (e) { error = e; }
    assert.ok(error, `${flag} must be rejected`);
    assert.ok(!error.message.includes(SENTINEL));
  }
  assert.deepEqual(parseArgs(['--confirm-db=fasalytics', '--max-records=50', '--no-raw', '--out-dir=data/mandi']),
    { 'confirm-db': 'fasalytics', 'max-records': '50', 'no-raw': true, 'out-dir': 'data/mandi' });
});

test('source scan: keys are interpolated only into the CEDA Authorization header (and the Phase 2 e-mail provider)', async () => {
  const roots = ['src', 'scripts'];
  const allowed = [
    { file: path.join('src', 'pipeline', 'providers', 'ceda.provider.js'), pattern: /Authorization: `Bearer \$\{this\.apiKey\}`/ },
    { file: path.join('src', 'services', 'email', 'emailProvider.js'), pattern: /Authorization: `Bearer \$\{apiKey\}`/ },
  ];
  const offenders = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const rel = path.relative(backendDir, full);
      const lines = (await fs.readFile(full, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        // Passing a key TO redactText (so it can be removed from a message) is the one allowed mention.
        const scanned = line.replace(/redactText\([^()]*(?:\[[^\]]*\])?[^()]*\)/g, 'redactText(...)');
        const interpolatesKey = /\$\{[^}]*(apiKey|ApiKey|API_KEY|dataGovApiKey|cedaApiKey)[^}]*\}/.test(scanned);
        const logsWholeConfig = /(console|log)\.\w+\([^)]*\bconfig(\.mandi)?\s*[,)]/.test(line) || /JSON\.stringify\(\s*(config|this\.config|mandiConfig)\b/.test(line);
        if ((interpolatesKey && !allowed.some((a) => a.file === rel && a.pattern.test(line))) || logsWholeConfig) {
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 110)}`);
        }
      });
    }
  };
  for (const root of roots) await walk(path.join(backendDir, root));
  assert.deepEqual(offenders, []);
});

test('secret files: .env is git-ignored and .env.example holds no credential values', async () => {
  const repoRoot = path.resolve(backendDir, '..');
  const gitignoreRaw = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf8');
  // Normalize CRLF → LF so multiline $ works correctly on Windows
  const gitignore = gitignoreRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\*\.env$/m);
  assert.match(gitignore, /^backend\/data\/$/m);
  const example = await fs.readFile(path.join(backendDir, '.env.example'), 'utf8');
  for (const name of ['CEDA_API_KEY', 'DATA_GOV_IN_API_KEY']) {
    assert.match(example, new RegExp(`^${name}=\\s*$`, 'm'), `${name} must be empty in .env.example`);
  }
  for (const line of example.split('\n')) {
    const match = line.match(/^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, name, value] = match;
    const placeholder = value === '' || /^(postgres|re_x+|your[-_].*)$/i.test(value);
    assert.ok(placeholder, `${name} in .env.example must be empty or an obvious placeholder`);
  }
});

test('unit-test wrapper: every secret-looking variable in .env.example is blanked for the unit tests', async () => {
  const { BLANKED_ENV } = await import('../scripts/test-env.js');
  const example = await fs.readFile(path.join(backendDir, '.env.example'), 'utf8');
  const secretNames = [...example.matchAll(/^#?\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIALS|SERVICE_ACCOUNT)[A-Z0-9_]*)=/gm)].map((m) => m[1]);
  assert.ok(secretNames.includes('CEDA_API_KEY') && secretNames.includes('DATA_GOV_IN_API_KEY'));
  const missing = [...new Set(secretNames)].filter((name) => !(name in BLANKED_ENV));
  assert.deepEqual(missing, [], `add these to scripts/test-env.js so unit tests can never read a real value: ${missing.join(', ')}`);
  for (const [name, value] of Object.entries(BLANKED_ENV)) {
    if (/KEY|SECRET|TOKEN|PRIVATE|CLIENT_EMAIL|SERVICE_ACCOUNT|APPLICATION_CREDENTIALS|DATABASE_URL/.test(name)) assert.equal(value, '', name);
  }
});
