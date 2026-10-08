/**
 * Read-only readiness check before the small real-source test. It sends NO request to any
 * data API and NEVER prints a credential: it reports only whether each variable is set,
 * opens a bare TCP connection to the API hosts (no data transferred), and checks disk space.
 *
 *   npm run live:preflight                      all sources
 *   npm run live:preflight -- --source=ceda     or --source=data-gov-in
 *
 * Exit code 0 only when everything the chosen source needs is ready.
 */
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config/index.js';
import { freeBytes } from '../src/pipeline/historical/storage.js';
import { hasPrivilegedFirebaseAccess } from '../src/config/firebaseAdmin.js';
import { parseArgs, targetDatabaseName } from './cli-utils.js';

const SOURCES = {
  ceda: { label: 'CEDA', host: 'api.ceda.ashoka.edu.in', key: () => Boolean(config.mandi.cedaApiKey), keyName: 'CEDA_API_KEY' },
  'data-gov-in': { label: 'data.gov.in', host: 'api.data.gov.in', key: () => Boolean(config.mandi.dataGovApiKey), keyName: 'DATA_GOV_IN_API_KEY' },
};

/** Opens (and immediately closes) a TCP connection. Resolves { ok, code }. */
export function checkTcp(host, port = 443, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, code: 'ETIMEDOUT' }));
    socket.once('connect', () => finish({ ok: true, code: 'CONNECTED' }));
    socket.once('error', (err) => finish({ ok: false, code: err.code || 'ERROR' }));
  });
}

export async function preflight({ source = 'all', tcp = checkTcp, freeBytesFn = freeBytes } = {}) {
  const chosen = source === 'all' ? Object.keys(SOURCES) : [source];
  if (chosen.some((s) => !SOURCES[s])) throw new Error(`--source must be ceda, data-gov-in or all`);
  const database = targetDatabaseName();
  const outDir = path.resolve(config.mandi.historical.outputDir || path.join(process.cwd(), 'data/mandi'));
  const free = await freeBytesFn(outDir);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('database is an isolated live-test database', /^fasalytics_test_live_/.test(database), `DB_NAME="${database}"`);
  add('scheduler is disabled', !config.mandi.sync.enabled, config.mandi.sync.reason || 'enabled');
  add('sample-data writes are off', config.mandi.allowSampleData === false, `allowSampleData=${config.mandi.allowSampleData}`);
  add(`free disk space >= ${config.mandi.historical.minFreeDiskGb} GB`, free >= config.mandi.historical.minFreeDiskGb * 1024 ** 3, `${(free / 1024 ** 3).toFixed(1)} GB free`);
  for (const key of chosen) {
    const s = SOURCES[key];
    add(`${s.keyName} is set`, s.key(), s.key() ? 'set (value not shown)' : 'not set');
    const reach = await tcp(s.host);
    add(`${s.label}: TCP 443 to ${s.host}`, reach.ok, reach.code);
  }
  return { database, source, ready: checks.every((c) => c.ok), checks, note: 'No API request was sent; no credential was printed.' };
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await preflight({ source: typeof args.source === 'string' ? args.source : 'all' });
  for (const c of result.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
  console.log(`\nFirebase Admin credentials for admin-gated HTTP ingestion: ${hasPrivilegedFirebaseAccess() ? 'configured' : 'not configured (CLI ingestion does not need them)'}`);
  console.log(result.ready ? '\nREADY for the small real-source test.' : '\nNOT READY — fix the FAIL lines above.');
  process.exitCode = result.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[live:preflight] ${err.message}`);
    process.exitCode = 1;
  });
}
