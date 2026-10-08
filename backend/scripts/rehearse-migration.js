/**
 * Rehearses the pending migrations on a THROW-AWAY CLONE of the configured database.
 *
 *   npm run migrate:rehearse                 clone, add 3 synthetic farmers to the clone, migrate, compare, drop
 *   npm run migrate:rehearse -- --keep       keep the clone afterwards for inspection
 *   npm run migrate:rehearse -- --no-sample-farmers
 *   npm run migrate:rehearse -- --pg-bin="C:\Program Files\PostgreSQL\18\bin"
 *
 * How it stays safe:
 *   - the source database is only READ (pg_dump runs in a read-only snapshot transaction);
 *   - everything else happens in a new database named fasalytics_test_clone_<id>, created and
 *     dropped by this script, never in the source;
 *   - synthetic farmers are inserted into the CLONE only, so the comparison covers real
 *     table shapes plus rows even when the source has no farmers yet;
 *   - credentials are passed to pg_dump/psql through environment variables of the child
 *     process only (never on the command line, never printed).
 *
 * Verdict: every table that existed before and is not part of Phase 3 (farmers, ...) must be
 * identical afterwards: columns, constraints, indexes, triggers and a hash of all rows.
 * Exit code 0 = safe to apply, 1 = a difference or failure was found.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { config } from '../src/config/index.js';
import { getMigrationStatus, runMigrations } from './migrate.js';
import { parseArgs, targetDatabaseName } from './cli-utils.js';

export const CLONE_PREFIX = 'fasalytics_test_clone_';
// Tables the Phase 3 migrations are allowed to change.
export const PHASE3_TABLES = new Set([
  'mandis', 'commodities', 'mandi_prices', 'pipeline_sync_logs', 'mandi_sources', 'mandi_price_revisions',
  'mandi_price_conflicts', 'mandi_source_sync_state', 'system_metadata', 'health_check_audit', 'schema_migrations',
]);

export function assertCloneName(name, source) {
  if (!new RegExp(`^${CLONE_PREFIX}[a-z0-9]{3,20}$`).test(name) || name === source) {
    throw new Error(`Refusing to use "${name}" as a clone database name`);
  }
}

function connection(database) {
  const db = config.database;
  if (db.connectionString) {
    const url = new URL(db.connectionString);
    return {
      host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password), database: database || url.pathname.slice(1),
    };
  }
  return { host: db.host, port: db.port, user: db.user, password: db.password, database: database || db.database };
}

export function findPgBin(explicit) {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const candidates = [explicit, process.env.PG_BIN_DIR];
  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL';
    if (fs.existsSync(root)) {
      for (const version of fs.readdirSync(root).sort((a, b) => Number(b) - Number(a))) candidates.push(path.join(root, version, 'bin'));
    }
  }
  for (const dir of candidates.filter(Boolean)) {
    if (fs.existsSync(path.join(dir, `pg_dump${exe}`)) && fs.existsSync(path.join(dir, `psql${exe}`))) return dir;
  }
  return null; // fall back to PATH
}

/** Streams pg_dump of `source` straight into psql restoring `clone` (no dump file is written). */
function copyDatabase({ source, clone, pgBin }) {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const bin = (name) => (pgBin ? path.join(pgBin, `${name}${exe}`) : name);
  const c = connection(source);
  const env = { ...process.env, PGHOST: c.host, PGPORT: String(c.port), PGUSER: c.user, PGPASSWORD: c.password, PGCLIENTENCODING: 'UTF8' };
  return new Promise((resolve, reject) => {
    const dump = spawn(bin('pg_dump'), ['--no-owner', '--no-privileges', '--dbname', source], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const restore = spawn(bin('psql'), ['--quiet', '--set', 'ON_ERROR_STOP=1', '--dbname', clone], { env, stdio: ['pipe', 'ignore', 'pipe'] });
    let dumpErr = '';
    let restoreErr = '';
    dump.stderr.on('data', (d) => { dumpErr += d; });
    restore.stderr.on('data', (d) => { restoreErr += d; });
    dump.stdout.pipe(restore.stdin);
    let dumpCode = null;
    let restoreCode = null;
    const done = () => {
      if (dumpCode === null || restoreCode === null) return;
      if (dumpCode !== 0) return reject(new Error(`pg_dump failed (exit ${dumpCode}): ${dumpErr.trim().split('\n').pop()}`));
      if (restoreCode !== 0) return reject(new Error(`psql restore failed (exit ${restoreCode}): ${restoreErr.trim().split('\n').pop()}`));
      return resolve();
    };
    dump.on('error', (e) => reject(new Error(`cannot start pg_dump (${e.code}); pass --pg-bin=<PostgreSQL bin folder>`)));
    restore.on('error', (e) => reject(new Error(`cannot start psql (${e.code}); pass --pg-bin=<PostgreSQL bin folder>`)));
    dump.on('close', (code) => { dumpCode = code; done(); });
    restore.on('close', (code) => { restoreCode = code; done(); });
  });
}

/** Structural + row fingerprint of one table. */
export async function snapshotTable(client, table) {
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;
  const ident = `"${table.replace(/"/g, '""')}"`;
  return {
    columns: (await q(
      `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])),
    constraints: (await q(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`, [ident])),
    indexes: (await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`, [table])),
    triggers: (await q(`SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`, [ident])),
    rows: Number((await q(`SELECT COUNT(*) AS n FROM ${ident}`))[0].n),
    rowHash: (await q(`SELECT md5(COALESCE(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS h FROM ${ident} t`))[0].h,
  };
}

export async function snapshotAll(client) {
  const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`))
    .rows.map((r) => r.table_name);
  const snapshots = {};
  for (const table of tables) snapshots[table] = await snapshotTable(client, table);
  return snapshots;
}

export function compareProtectedTables(before, after) {
  const problems = [];
  for (const table of Object.keys(before)) {
    if (PHASE3_TABLES.has(table)) continue;
    if (!after[table]) { problems.push(`${table}: table disappeared`); continue; }
    for (const part of ['columns', 'constraints', 'indexes', 'triggers', 'rows', 'rowHash']) {
      if (JSON.stringify(before[table][part]) !== JSON.stringify(after[table][part])) problems.push(`${table}: ${part} changed`);
    }
  }
  return problems;
}

async function seedSyntheticFarmers(client) {
  const exists = (await client.query(`SELECT to_regclass('public.farmers') AS t`)).rows[0].t;
  if (!exists) return 0;
  const farmers = [
    ['clone-test-uid-1', 'Clone Test Farmer One', '+919800000101', 'Maharashtra', 'Nashik', 'Onion', 12.5],
    ['clone-test-uid-2', 'Clone Test Farmer Two', '+919800000102', 'Maharashtra', 'Pune', 'Tomato', 40],
    ['clone-test-uid-3', 'Clone Test Farmer Three', null, 'Karnataka', 'Belagavi', 'Potato', 8],
  ];
  for (const f of farmers) {
    await client.query(
      `INSERT INTO farmers (firebase_uid, full_name, phone_number, state, district, primary_crop, crop_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`, f);
  }
  return farmers.length;
}

export async function rehearse({ keep = false, sampleFarmers = true, pgBin, log = console } = {}) {
  const source = targetDatabaseName();
  const clone = `${CLONE_PREFIX}${Date.now().toString(36)}`;
  assertCloneName(clone, source);
  const report = { source, clone, pending: [], applied: [], protectedTables: [], problems: [], syntheticFarmers: 0, phase3Tables: {} };

  const admin = new pg.Client(connection('postgres'));
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${clone}"`);
    created = true;
    log.log(`[rehearse] Copying "${source}" (read-only) into throw-away clone "${clone}"...`);
    await copyDatabase({ source, clone, pgBin: findPgBin(pgBin) });

    const client = new pg.Client(connection(clone));
    await client.connect();
    try {
      if (sampleFarmers) report.syntheticFarmers = await seedSyntheticFarmers(client);
      const before = await snapshotAll(client);
      const migrationsBefore = (await client.query(`SELECT filename FROM schema_migrations ORDER BY filename`)).rows.map((r) => r.filename);
      report.pending = (await getMigrationStatus(client)).pending;

      const result = await runMigrations(client, { log: { log: () => {} } });
      report.applied = result.applied;
      const after = await snapshotAll(client);

      report.problems = compareProtectedTables(before, after);
      report.protectedTables = Object.keys(before).filter((t) => !PHASE3_TABLES.has(t)).map((t) => ({ table: t, rows: before[t].rows, unchanged: !report.problems.some((p) => p.startsWith(`${t}:`)) }));
      const migrationsAfter = (await client.query(`SELECT filename FROM schema_migrations ORDER BY filename`)).rows.map((r) => r.filename);
      if (!migrationsBefore.every((f) => migrationsAfter.includes(f))) report.problems.push('schema_migrations: earlier history rows were lost');
      for (const table of PHASE3_TABLES) {
        if (table !== 'schema_migrations' && after[table]) report.phase3Tables[table] = { rowsBefore: before[table]?.rows ?? null, rowsAfter: after[table].rows };
      }
      // A second run must be a no-op.
      const again = await runMigrations(client, { log: { log: () => {} } });
      if (again.applied.length) report.problems.push(`re-run applied ${again.applied.join(', ')}`);
    } finally {
      await client.end();
    }
  } catch (err) {
    report.problems.push(`rehearsal failed: ${err.message}`);
  } finally {
    if (created && !keep) {
      assertCloneName(clone, source);
      await admin.query(`DROP DATABASE IF EXISTS "${clone}" WITH (FORCE)`);
      report.cloneDropped = true;
    } else {
      report.cloneDropped = false;
    }
    await admin.end();
  }
  report.safeToApply = report.problems.length === 0 && report.applied.length === report.pending.length;
  return report;
}

async function main(argv) {
  const args = parseArgs(argv);
  const report = await rehearse({ keep: args.keep === true, sampleFarmers: args['no-sample-farmers'] !== true, pgBin: args['pg-bin'] });
  console.log(JSON.stringify(report, null, 2));
  console.log(report.safeToApply
    ? `[rehearse] RESULT: SAFE — pending migrations applied cleanly to the clone and every Phase 2 table is identical afterwards.`
    : `[rehearse] RESULT: NOT SAFE — ${report.problems.join('; ') || 'migration list differs from the plan'}`);
  process.exitCode = report.safeToApply ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[rehearse] ${err.message}`);
    process.exitCode = 1;
  });
}
