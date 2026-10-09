/**
 * Pure unit tests for the Phase 5 mandi-data quality report.
 *
 * No database: the service is given a FAKE pool whose `query` returns canned rows for
 * the first SQL containing a known `/* qr:<name> *\/` marker. A DB-gated test at the
 * bottom runs the same service against the real schema when DB_NAME points at an
 * isolated fasalytics_test_* database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityReportService } from '../src/services/qualityReport.service.js';

const SECTION_KEYS = [
  'generated_at',
  'sources',
  'coverage',
  'records',
  'duplicates',
  'cross_source_overlaps',
  'conflicts',
  'invalid_records',
  'missing_values',
  'coverage_by_dimension',
  'records_by_year',
  'refresh',
  'incomplete_coverage',
  'storage',
];

/** Baseline canned data for a COMPLETE, healthy dataset (no gaps). */
function completeRoutes() {
  return {
    'qr:sources': [
      { code: 'CEDA', label: 'CEDA', precedence: 30, is_sample: false, last_attempt_at: '2026-10-01T00:00:00Z', last_success_at: '2026-10-01T00:00:00Z', last_status: 'SUCCESS', last_error: null, latest_reporting_date: '2025-12-31' },
    ],
    'qr:coverage': [{ source: 'CEDA', earliest_reporting_date: '2024-01-01', latest_reporting_date: '2025-12-31', rows: 10 }],
    'qr:records': [{ total_rows: 10, unique_observations: 10, sample_rows: 0, genuine_rows: 10 }],
    'qr:stored': [{ source: 'CEDA', stored: 10 }],
    'qr:downloaded': [{ source: 'CEDA', downloaded: 12 }],
    'qr:duplicates': [],
    'qr:overlap_groups': [{ overlap_groups: 0 }],
    'qr:overlap_pairs': [],
    'qr:conflicts': [],
    'qr:integrity': [{
      total_rows: 10, rejected: 0, valid: 10, flagged: 0,
      null_or_nonpositive_modal_price: 0, min_greater_than_max: 0,
      null_minimum_price: 0, null_maximum_price: 0, null_min_or_max: 0,
      null_arrivals: 0, future_dated: 0, null_normalized_price_unit: 0,
    }],
    'qr:missing': [{
      total_rows: 10, variety: 0, variety_code: 0, arrival_quantity: 0, arrival_unit: 0,
      minimum_price: 0, maximum_price: 0, state_code: 0, district_code: 0, market_code: 0,
      content_hash: 0, source_record_id: 0,
    }],
    'qr:dimensions': [{ commodities: 2, mandis: 1, states: 1, districts: 1, varieties: 1 }],
    'qr:top_commodities': [{ commodity: 'Onion', rows: 6 }, { commodity: 'Wheat', rows: 4 }],
    'qr:top_mandis': [{ mandi: 'Nashik', state: 'Maharashtra', district: 'Nashik', rows: 10 }],
    'qr:by_year': [{ year: 2024, rows: 5 }, { year: 2025, rows: 5 }],
    'qr:commodity_arrivals': [
      { commodity: 'Onion', rows: 6, rows_with_arrivals: 6 },
      { commodity: 'Wheat', rows: 4, rows_with_arrivals: 4 },
    ],
    'qr:refresh_state': [{ latest_state_success_at: '2026-10-01T00:00:00Z' }],
    'qr:refresh_latest': [{ id: 1, source: 'CEDA', status: 'SUCCESS', records_inserted: 10, records_unchanged: 2, error_details: null, synced_at: '2026-10-01T00:00:00Z' }],
    'qr:refresh_failed': [],
    'qr:refresh_counts': [{ total_batches: 1, records_fetched: 12, successful_batches: 1, failed_batches: 0, latest_success_at: '2026-10-01T00:00:00Z' }],
    'qr:sizes': [{ table_bytes: '8192', index_bytes: '4096' }],
    'qr:physical_rows': [{ rows: 10 }],
  };
}

/**
 * Deterministic fake pool: routes is an object keyed by a SQL substring (the qr marker)
 * OR an array of [needle, rows] pairs when order matters.
 */
function fakePool(routes) {
  const entries = Array.isArray(routes) ? routes : Object.entries(routes);
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      for (const [needle, rows] of entries) {
        if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows() : rows };
      }
      throw new Error(`fake pool has no canned rows for SQL: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
    },
  };
}

const fakeDisk = (path) => ({ path: String(path), free_bytes: 500_000_000_000, free_gb: 465.66, measured: true });

const generate = (pool, options = {}) =>
  createQualityReportService({ pool, measureDisk: async (p) => fakeDisk(p) })
    .generateReport({ diskPath: 'C:/repo/backend/data', ...options });

test('report exposes exactly the 14 required sections', async () => {
  const report = await generate(fakePool(completeRoutes()));
  assert.deepEqual(Object.keys(report), SECTION_KEYS);
  assert.equal(typeof report.generated_at, 'string');
  assert.ok(Array.isArray(report.sources));
  assert.ok(Array.isArray(report.records_by_year));
  assert.ok(Array.isArray(report.incomplete_coverage));
});

test('records and coverage math come from the canned rows', async () => {
  const pool = fakePool(completeRoutes());
  const report = await generate(pool);

  assert.equal(report.records.total_rows, 10);
  assert.equal(report.records.unique_observations, 10);
  assert.equal(report.records.stored_total, 10);
  assert.deepEqual(report.records.downloaded_per_source, [{ source: 'CEDA', downloaded: 12 }]);
  assert.deepEqual(report.records.stored_per_source, [{ source: 'CEDA', stored: 10 }]);
  assert.deepEqual(report.records.sample_split, { sample_rows: 0, genuine_rows: 10 });

  assert.equal(report.coverage.earliest_reporting_date, '2024-01-01');
  assert.equal(report.coverage.latest_reporting_date, '2025-12-31');
  assert.deepEqual(report.coverage.per_source, [
    { source: 'CEDA', earliest_reporting_date: '2024-01-01', latest_reporting_date: '2025-12-31', rows: 10 },
  ]);

  // Sources report availability from the sync state without exposing credentials.
  assert.equal(report.sources[0].available, true);
  assert.equal(report.sources[0].last_status, 'SUCCESS');
  assert.equal(report.sources[0].precedence, 30);
  assert.equal('api_key' in report.sources[0], false);
});

test('measured and estimated labels are present where required', async () => {
  const report = await generate(fakePool(completeRoutes()), { estimatedFullRunRows: 1000 });

  for (const section of ['coverage', 'records', 'duplicates', 'cross_source_overlaps', 'conflicts',
    'invalid_records', 'missing_values', 'coverage_by_dimension', 'refresh', 'storage']) {
    assert.equal(report[section].measured, true, `${section}.measured`);
  }
  assert.equal(report.storage.disk.measured, true);
  assert.equal(report.storage.mean_bytes_per_row !== null, true);
  assert.equal(report.storage.mean_bytes_per_row, 819.2, '8192 measured bytes / 10 measured rows');

  const est = report.storage.estimated_full_run;
  assert.equal(est.estimated, true);
  assert.equal(est.assumed_rows, 1000);
  assert.equal(est.value_bytes, Math.round(819.2 * 1000));
  assert.match(est.basis, /measured bytes\/row/);
  assert.equal(report.storage.table_bytes, 8192);
  assert.equal(report.storage.index_bytes, 4096);
  assert.equal(report.storage.rows, 10);
});

test('mean_bytes_per_row guards divide-by-zero: 0 rows -> null estimate with a reason', async () => {
  const routes = completeRoutes();
  routes['qr:physical_rows'] = [{ rows: 0 }];
  const report = await generate(fakePool(routes), { estimatedFullRunRows: 1000000 });

  assert.equal(report.storage.rows, 0);
  assert.equal(report.storage.mean_bytes_per_row, null);
  assert.match(report.storage.mean_bytes_per_row_basis, /0 rows/);
  assert.equal(report.storage.estimated_full_run.value_bytes, null);
  assert.equal(report.storage.estimated_full_run.estimated, true);
  assert.match(report.storage.estimated_full_run.reason, /0 rows/);
});

test('no caller-supplied row count means no invented estimate', async () => {
  const report = await generate(fakePool(completeRoutes()));
  const est = report.storage.estimated_full_run;
  assert.equal(est.estimated, true);
  assert.equal(est.assumed_rows, null);
  assert.equal(est.value_bytes, null);
  assert.match(est.reason, /estimatedFullRunRows/);
});

test('incomplete_coverage is empty when the canned data is complete', async () => {
  const report = await generate(fakePool(completeRoutes()));
  assert.deepEqual(report.incomplete_coverage, []);
});

test('incomplete_coverage lists real gaps when the canned data has them', async () => {
  const routes = completeRoutes();
  routes['qr:sources'] = [
    { code: 'CEDA', label: 'CEDA', precedence: 30, is_sample: false, last_attempt_at: null, last_success_at: null, last_status: null, last_error: null, latest_reporting_date: null },
    { code: 'DATA_GOV_IN', label: 'data.gov.in', precedence: 20, is_sample: false, last_attempt_at: '2026-10-01T00:00:00Z', last_success_at: '2026-10-01T00:00:00Z', last_status: 'FAILED', last_error: 'HTTP 503', latest_reporting_date: null },
  ];
  routes['qr:coverage'] = [{ source: 'DATA_GOV_IN', earliest_reporting_date: '2024-01-01', latest_reporting_date: '2025-12-31', rows: 10 }];
  routes['qr:duplicates'] = [{ source: 'CEDA', source_record_key: 'r1', copies: 2 }];
  routes['qr:by_year'] = [{ year: 2023, rows: 4 }, { year: 2025, rows: 6 }]; // 2024 is empty
  routes['qr:commodity_arrivals'] = [
    { commodity: 'Onion', rows: 6, rows_with_arrivals: 0 },
    { commodity: 'Wheat', rows: 4, rows_with_arrivals: 4 },
  ];
  routes['qr:missing'] = [{ ...routes['qr:missing'][0], arrival_quantity: 6, content_hash: 3 }];
  routes['qr:integrity'] = [{ ...routes['qr:integrity'][0], rejected: 1 }];
  routes['qr:refresh_failed'] = [{ id: 9, source: 'DATA_GOV_IN', status: 'FAILED', error_details: 'HTTP 503', started_at: null, synced_at: null }];
  routes['qr:refresh_counts'] = [{ total_batches: 2, records_fetched: 12, successful_batches: 0, failed_batches: 1, latest_success_at: null }];
  routes['qr:refresh_state'] = [{ latest_state_success_at: null }];

  const report = await generate(fakePool(routes));
  assert.ok(report.incomplete_coverage.length > 0);
  assert.equal(report.missing_values.fields.arrivals_quantity.nulls, 6, 'reads the canonical arrival_quantity column');
  assert.equal(report.missing_values.fields.arrivals_quantity.percentage, 60);
  assert.ok(report.incomplete_coverage.some((g) => /source CEDA: no successful sync recorded/.test(g)));
  assert.ok(report.incomplete_coverage.some((g) => /source DATA_GOV_IN: last sync ended FAILED/.test(g)));
  assert.ok(report.incomplete_coverage.some((g) => /commodity Onion has no arrivals data/.test(g)));
  assert.ok(report.incomplete_coverage.some((g) => /0 rows for year 2024/.test(g)));
  assert.ok(report.incomplete_coverage.some((g) => /quality_status=REJECTED/.test(g)));
  assert.ok(report.incomplete_coverage.some((g) => /no successful run recorded/.test(g)));
});

test('cross-source overlap counting never double counts a multi-source group', async () => {
  const routes = completeRoutes();
  // Three market-day groups are reported by 2+ sources; the pair breakdown happens to
  // sum to 4 because one group has three sources (C(3,2) = 3 pairs).
  routes['qr:overlap_groups'] = [{ overlap_groups: 3 }];
  routes['qr:overlap_pairs'] = [
    { source_a: 'CEDA', source_b: 'DATA_GOV_IN', groups: 3 },
    { source_a: 'CEDA', source_b: 'MOCK_PROVIDER', groups: 1 },
  ];
  const pool = fakePool(routes);
  const report = await generate(pool);

  assert.equal(report.cross_source_overlaps.overlap_groups, 3, 'deduplicated group count, not the pair sum (4)');
  assert.equal(report.cross_source_overlaps.breakdown_by_pair.reduce((n, p) => n + p.groups, 0), 4);
  assert.match(report.cross_source_overlaps.note, /no matter how many sources/);
  assert.equal(pool.calls.filter((c) => c.sql.includes('qr:overlap_groups')).length, 1, 'group count is one query, not per-pair');
});

test('DB-gated: report runs against an isolated fasalytics_test_* database', { skip: !/^fasalytics_test_/.test(process.env.DB_NAME || '') }, async () => {
  const { assertIsolatedDatabase } = await import('./helpers/db.js');
  const { pool } = await import('../src/db.js');
  assertIsolatedDatabase();
  try {
    const service = createQualityReportService({ pool, measureDisk: async (p) => fakeDisk(p) });
    const report = await service.generateReport({ includeSample: true, diskPath: 'C:/repo/backend/data' });
    assert.deepEqual(Object.keys(report), SECTION_KEYS);
    assert.equal(typeof report.records.total_rows, 'number');
    assert.ok(Array.isArray(report.sources));
    assert.equal(report.storage.measured, true);
  } finally {
    await pool.end();
  }
});
