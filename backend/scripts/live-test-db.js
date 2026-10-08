/**
 * Isolated database for the small real-source ingestion test.
 *
 *   npm run live:db -- create --name=fasalytics_test_live_20261009
 *   npm run live:db -- status --name=fasalytics_test_live_20261009
 *   npm run live:db -- drop   --name=fasalytics_test_live_20261009 --confirm-drop=fasalytics_test_live_20261009
 *
 * Safety:
 *   - the name must match fasalytics_test_live_<id> and must differ from the configured DB_NAME;
 *   - create marks the database with a comment; drop REFUSES any database without that marker,
 *     so it can only ever remove a database this script created;
 *   - create applies the migrations (the same runner as production) so the schema under test is real;
 *   - the development database is never read or written.
 * Run the ingestion commands against it by overriding DB_NAME for that terminal session:
 *   $env:DB_NAME = 'fasalytics_test_live_20261009'
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { config } from '../src/config/index.js';
import { getMigrationStatus, runMigrations } from './migrate.js';
import { parseArgs } from './cli-utils.js';

export const LIVE_TEST_MARKER = 'fasalytics-live-test-database';
const NAME_PATTERN = /^fasalytics_test_live_[a-z0-9_]{1,24}$/;

export function assertLiveTestName(name, configuredDatabase) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name === configuredDatabase) {
    throw new Error(`"${name}" is not an allowed live-test database name (expected fasalytics_test_live_<id>, 1-24 lowercase letters, digits or _)`);
  }
  return name;
}

function options(database) {
  const db = config.database;
  if (db.connectionString) {
    const url = new URL(db.connectionString);
    return { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database };
  }
  return { host: db.host, port: db.port, user: db.user, password: db.password, database };
}

const configuredName = () => (config.database.connectionString ? new URL(config.database.connectionString).pathname.slice(1) : config.database.database);

async function withClient(database, fn) {
  const client = new pg.Client(options(database));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function isMarked(admin, name) {
  const row = await admin.query(
    `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1`, [name]);
  return { exists: row.rowCount > 0, marked: row.rows[0]?.comment === LIVE_TEST_MARKER };
}

export async function createLiveTestDatabase(name, { log = console } = {}) {
  assertLiveTestName(name, configuredName());
  await withClient('postgres', async (admin) => {
    const state = await isMarked(admin, name);
    if (state.exists && !state.marked) throw new Error(`Database "${name}" already exists and was not created by this script; refusing to use it`);
    if (!state.exists) {
      await admin.query(`CREATE DATABASE "${name}"`);
      await admin.query(`COMMENT ON DATABASE "${name}" IS '${LIVE_TEST_MARKER}'`);
      log.log(`[live:db] created ${name}`);
    } else {
      log.log(`[live:db] ${name} already exists (marked as a live-test database)`);
    }
  });
  return withClient(name, async (client) => {
    const result = await runMigrations(client, { log: { log: () => {} } });
    log.log(`[live:db] migrations applied: ${result.applied.join(', ') || '(none, already current)'}`);
    return getMigrationStatus(client);
  });
}

export async function liveTestDatabaseStatus(name) {
  assertLiveTestName(name, configuredName());
  const state = await withClient('postgres', (admin) => isMarked(admin, name));
  if (!state.exists) return { name, exists: false };
  // A database this script did not create is reported but never opened or queried.
  if (!state.marked) return { name, exists: true, marked: false };
  const detail = await withClient(name, async (client) => {
    const migrations = await getMigrationStatus(client);
    const migrated = (await client.query(`SELECT to_regclass('public.mandi_prices') AS t`)).rows[0].t;
    const rows = migrated
      ? (await client.query(`SELECT
          (SELECT COUNT(*) FROM mandi_prices) AS price_rows,
          (SELECT COUNT(*) FILTER (WHERE is_sample_data = FALSE) FROM mandi_prices) AS genuine_rows`)).rows[0]
      : null;
    return { migrations, rows };
  });
  return { name, exists: true, marked: true, ...detail };
}

export async function dropLiveTestDatabase(name, confirm) {
  assertLiveTestName(name, configuredName());
  if (confirm !== name) throw new Error(`Refusing to drop: --confirm-drop must equal "${name}"`);
  return withClient('postgres', async (admin) => {
    const state = await isMarked(admin, name);
    if (!state.exists) return { name, dropped: false, reason: 'does not exist' };
    if (!state.marked) throw new Error(`Refusing to drop "${name}": it was not created by this script`);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    return { name, dropped: true };
  });
}

async function main(argv) {
  const args = parseArgs(argv, { allowPositional: true });
  const [command] = args._;
  if (!args.name || args.name === true) throw new Error('--name=<fasalytics_test_live_id> is required');
  if (command === 'create') console.log(JSON.stringify(await createLiveTestDatabase(args.name), null, 2));
  else if (command === 'status') console.log(JSON.stringify(await liveTestDatabaseStatus(args.name), null, 2));
  else if (command === 'drop') console.log(JSON.stringify(await dropLiveTestDatabase(args.name, args['confirm-drop']), null, 2));
  else throw new Error('usage: npm run live:db -- <create|status|drop> --name=fasalytics_test_live_<id> [--confirm-drop=<name>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[live:db] ${err.message}`);
    process.exitCode = 1;
  });
}
