/**
 * Helpers for database-backed tests. They refuse to run unless DB_NAME points to a
 * disposable fasalytics_test_* database created by `npm run test:db`.
 */
import pg from 'pg';
import { config } from '../../src/config/index.js';

export function assertIsolatedDatabase() {
  const name = process.env.DB_NAME || '';
  if (!/^fasalytics_test_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Database tests must run against a disposable database (npm run test:db); DB_NAME="${name}"`);
  }
  return name;
}

function options(database) {
  const db = config.database;
  return { host: db.host, port: db.port, user: db.user, password: db.password, database };
}

/** Creates <DB_NAME>_<suffix>, returns { name, client(), drop() }. Only names under the test prefix. */
export async function createScratchDatabase(suffix) {
  const base = assertIsolatedDatabase();
  const name = `${base}_${suffix}`.slice(0, 63);
  if (!/^fasalytics_test_[a-z0-9_]+$/.test(name)) throw new Error(`Unsafe scratch database name ${name}`);
  const admin = new pg.Client(options('postgres'));
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return {
    name,
    async client() {
      const client = new pg.Client(options(name));
      await client.connect();
      return client;
    },
    async drop() {
      const dropper = new pg.Client(options('postgres'));
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

/** A minimal normalised record for persistence tests (synthetic, flagged as sample). */
export function sampleRecord(overrides = {}) {
  return {
    source: 'MOCK_PROVIDER',
    is_sample_data: true,
    source_record_key: null,
    source_market_id: null,
    source_commodity_id: null,
    source_state_id: null,
    source_district_id: null,
    source_market_name: 'Test Market',
    source_commodity_name: 'Onion',
    source_state_name: 'Test State',
    source_district_name: 'Test District',
    source_variety: 'Red',
    source_grade: 'FAQ',
    mandi_code: 'TEST_STATE__TEST_DISTRICT__TEST_MARKET',
    mandi_name: 'Test Market',
    state: 'Test State',
    district: 'Test District',
    latitude: null,
    longitude: null,
    commodity_code: 'ONION',
    commodity_name: 'Onion',
    commodity_category: 'Vegetables',
    commodity_hindi: null,
    commodity_marathi: null,
    variety: 'Red',
    grade: 'FAQ',
    price_date: '2026-09-01',
    min_price: 1000,
    max_price: 1400,
    modal_price: 1200,
    price_unit: 'INR/quintal',
    arrivals_quantity: 12.5,
    arrival_unit: 'tonne',
    quality_flags: ['SYNTHETIC_TEST_RECORD'],
    fetched_at: null,
    raw_payload: { test: true },
    ...overrides,
  };
}
