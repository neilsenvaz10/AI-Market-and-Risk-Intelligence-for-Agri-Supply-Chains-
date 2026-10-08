/**
 * Applies pending SQL migrations from database/migrations in numeric order.
 * Applied migrations are recorded in schema_migrations so each runs once.
 *
 * Usage:
 *   npm run migrate                      apply pending migrations
 *   npm run migrate -- --status          list applied / pending (read-only)
 *   npm run migrate -- --create-database create DB_NAME first if it does not exist
 *
 * Safety:
 *   - filenames must be NNN_name.sql and every NNN must be unique (prevents the
 *     former 003 collision);
 *   - each migration runs in its own transaction; a failure rolls back that file
 *     and stops the run;
 *   - a PostgreSQL advisory lock prevents two runners from migrating concurrently;
 *   - credentials are never printed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { config } from '../src/config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');
const MIGRATION_LOCK_ID = 7_301_003;
const FILENAME_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

// Files that were renamed. A database that recorded the old name already has the
// objects; the replacement is idempotent and still runs to apply its fixes.
export const SUPERSEDED_MIGRATIONS = {
  '003_mandi_data_pipeline.sql': '004_mandi_data_pipeline.sql',
};

/** Reads and validates the migration directory without touching the database. */
export async function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const invalid = files.filter((f) => !FILENAME_PATTERN.test(f));
  if (invalid.length) throw new Error(`Invalid migration filename(s): ${invalid.join(', ')} (expected NNN_name.sql)`);
  const byPrefix = new Map();
  for (const file of files) {
    const prefix = file.slice(0, 3);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) || []), file]);
  }
  const duplicates = [...byPrefix.values()].filter((group) => group.length > 1);
  if (duplicates.length) {
    throw new Error(`Duplicate migration number(s): ${duplicates.map((g) => g.join(' & ')).join('; ')}`);
  }
  return files;
}

async function ensureHistoryTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function readApplied(client) {
  const exists = await client.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  if (!exists.rows[0].t) return new Set();
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

/**
 * Returns { applied, pending, unknown } without changing anything. The queries run
 * inside a READ ONLY transaction, so PostgreSQL itself rejects any write.
 */
export async function getMigrationStatus(client, { migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const files = await listMigrationFiles(migrationsDir);
  await client.query('BEGIN READ ONLY');
  try {
    const applied = await readApplied(client);
    return {
      applied: files.filter((f) => applied.has(f)),
      pending: files.filter((f) => !applied.has(f)),
      unknown: [...applied].filter((f) => !files.includes(f)).sort(),
    };
  } finally {
    await client.query('ROLLBACK');
  }
}

/**
 * Applies pending migrations using an already-connected client.
 * @returns {Promise<{ applied: string[], skipped: string[] }>}
 */
export async function runMigrations(client, { migrationsDir = DEFAULT_MIGRATIONS_DIR, log = console } = {}) {
  const files = await listMigrationFiles(migrationsDir);
  const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [MIGRATION_LOCK_ID]);
  if (!lock.rows[0].locked) throw new Error('Another migration run holds the migration lock; try again later.');
  try {
    await ensureHistoryTable(client);
    const applied = await readApplied(client);
    for (const [oldName, newName] of Object.entries(SUPERSEDED_MIGRATIONS)) {
      if (applied.has(oldName)) log.log?.(`[Migrate] ${oldName} was applied earlier; superseded by ${newName}.`);
    }

    const result = { applied: [], skipped: [] };
    for (const file of files) {
      if (applied.has(file)) {
        result.skipped.push(file);
        log.log?.(`[Migrate] Skipping ${file} (already applied)`);
        continue;
      }
      const sql = (await fs.readFile(path.join(migrationsDir, file), 'utf8')).replace(/^﻿/, '');
      log.log?.(`[Migrate] Applying ${file}...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`);
      }
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  }
}

function connectionOptions(database) {
  const db = config.database;
  if (db.connectionString) {
    const url = new URL(db.connectionString);
    if (database) url.pathname = `/${database}`;
    return { connectionString: url.toString() };
  }
  return { host: db.host, port: db.port, user: db.user, password: db.password, database: database || db.database };
}

function describeTarget() {
  const db = config.database;
  if (db.connectionString) {
    const url = new URL(db.connectionString);
    return `${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`;
  }
  return `${db.host}:${db.port}/${db.database}`;
}

async function createDatabaseIfMissing() {
  const target = connectionOptions().database || new URL(config.database.connectionString).pathname.slice(1);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(target)) throw new Error(`Refusing to create database with unsafe name "${target}"`);
  const admin = new pg.Client(connectionOptions('postgres'));
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
    if (exists.rowCount) {
      console.log(`[Migrate] Database "${target}" already exists.`);
    } else {
      await admin.query(`CREATE DATABASE "${target}"`);
      console.log(`[Migrate] Created database "${target}".`);
    }
  } finally {
    await admin.end();
  }
}

async function main(argv) {
  const statusOnly = argv.includes('--status');
  if (argv.includes('--create-database') && !statusOnly) await createDatabaseIfMissing();

  const client = new pg.Client(connectionOptions());
  await client.connect();
  console.log(`[Migrate] Target: ${describeTarget()}`);
  try {
    if (statusOnly) {
      const status = await getMigrationStatus(client);
      console.log(`[Migrate] Applied: ${status.applied.join(', ') || '(none)'}`);
      console.log(`[Migrate] Pending: ${status.pending.join(', ') || '(none)'}`);
      if (status.unknown.length) console.log(`[Migrate] Recorded but not in the directory: ${status.unknown.join(', ')}`);
      return;
    }
    const result = await runMigrations(client);
    console.log(`[Migrate] Done. ${result.applied.length} migration(s) applied.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('[Migrate]', err.message);
    process.exit(1);
  });
}
