/**
 * Runs the database-backed test suites inside a DISPOSABLE PostgreSQL database.
 *
 *   npm run test:db              create fasalytics_test_<timestamp>, migrate, test, drop
 *   KEEP_TEST_DB=1 npm run test:db   keep the database afterwards for inspection
 *
 * The development database is never used: the temporary name must start with
 * "fasalytics_test_" and must differ from DB_NAME. Only databases created by this
 * run are dropped. Requires a PostgreSQL role with CREATEDB.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config/index.js';
import { runMigrations } from './migrate.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_DB_PREFIX = 'fasalytics_test_';
const SUITES = ['test/db/*.test.js', 'tests/*.test.js'];

function adminOptions(database) {
  const db = config.database;
  if (db.connectionString) {
    const url = new URL(db.connectionString);
    url.pathname = `/${database}`;
    return { connectionString: url.toString() };
  }
  return { host: db.host, port: db.port, user: db.user, password: db.password, database };
}

export function assertDisposableName(name) {
  const configured = config.database.connectionString
    ? new URL(config.database.connectionString).pathname.slice(1)
    : config.database.database;
  if (!new RegExp(`^${TEST_DB_PREFIX}[a-z0-9_]{1,40}$`).test(name) || name === configured) {
    throw new Error(`Refusing to use "${name}" as a disposable test database`);
  }
}

async function withAdmin(fn) {
  const admin = new pg.Client(adminOptions('postgres'));
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

function runNodeTests(dbName) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      DB_NAME: dbName,
      DATABASE_URL: '',
      NODE_ENV: 'test',
      MANDI_ALLOW_SAMPLE_DATA: 'true',
      MANDI_SYNC_INTERVAL_MINUTES: '0',
      MANDI_DATA_PROVIDER: '',
      DATA_GOV_IN_API_KEY: '',
      CEDA_API_KEY: '',
      // The isolated suites must not use (or depend on) real Firebase Admin credentials.
      FIREBASE_SERVICE_ACCOUNT_PATH: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '',
    };
    if (config.database.connectionString) env.DATABASE_URL = adminOptions(dbName).connectionString;
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...SUITES], { cwd: backendDir, env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const name = `${TEST_DB_PREFIX}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${process.pid}`;
  assertDisposableName(name);
  console.log(`[test:db] Creating disposable database ${name}`);
  await withAdmin((admin) => admin.query(`CREATE DATABASE "${name}"`));
  let exitCode = 1;
  try {
    const client = new pg.Client(adminOptions(name));
    await client.connect();
    try {
      const result = await runMigrations(client, { log: { log: () => {} } });
      console.log(`[test:db] Migrations applied: ${result.applied.join(', ')}`);
    } finally {
      await client.end();
    }
    exitCode = await runNodeTests(name);
  } finally {
    if (process.env.KEEP_TEST_DB === '1') {
      console.log(`[test:db] KEEP_TEST_DB=1 — database ${name} kept`);
    } else {
      assertDisposableName(name);
      await withAdmin(async (admin) => {
        const leftovers = await admin.query('SELECT datname FROM pg_database WHERE datname LIKE $1', [`${name}%`]);
        for (const { datname } of leftovers.rows) {
          assertDisposableName(datname);
          await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
        }
      });
      console.log(`[test:db] Dropped disposable database ${name} (and any ${name}_* scratch databases)`);
    }
  }
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[test:db] ${err.message}`);
    process.exitCode = 1;
  });
}
