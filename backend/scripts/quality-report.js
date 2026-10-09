/**
 * Phase 5 mandi-data QUALITY REPORT (operator CLI, READ-ONLY).
 *
 *   node scripts/quality-report.js [--json] [--out=<path>] [--exclude-sample]
 *        [--disk-path=<dir>] [--estimated-rows=<n>]
 *
 * Reads the canonical mandi model and prints the honest quality report. It writes
 * nothing to PostgreSQL; the only file it may create is the JSON copy requested with
 * --out. Every printed figure is measured except storage.estimated_full_run, which is
 * extrapolated from the measured mean bytes/row and the OPERATOR ASSUMPTION passed as
 * --estimated-rows (omit it and the estimate stays null with a reason).
 *
 * Defaults: --disk-path=<repo>/backend/data, estimate row count unset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config/index.js';
import { redactText } from '../src/pipeline/http.js';
import { pool } from '../src/db.js';
import { createQualityReportService } from '../src/services/qualityReport.service.js';
import { parseArgs } from './cli-utils.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// cli-utils.parseArgs takes --name=value only; the quality report also documents the
// conventional "--out <path>" form, so normalise known value flags into --name=value.
const VALUE_FLAGS = new Set(['out', 'disk-path', 'estimated-rows']);
function normaliseArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const match = /^--([a-z0-9-]+)$/i.exec(token);
    if (match && VALUE_FLAGS.has(match[1].toLowerCase()) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      out.push(`${token}=${argv[i + 1]}`);
      i += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

const positiveInt = (value, name) => {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) throw new Error(`--${name} must be a positive whole number`);
  return Number(value);
};

const bytes = (value) => (value === null || value === undefined ? 'n/a' : `${value} B`);

function printHuman(report) {
  const line = (title) => console.log(`\n== ${title} ==`);
  console.log(`Mandi data quality report — generated_at=${report.generated_at}`);

  line('SOURCES');
  for (const s of report.sources) {
    console.log(`  ${s.code.padEnd(14)} available=${String(s.available).padEnd(5)} sample=${String(s.is_sample).padEnd(5)} precedence=${s.precedence ?? 'n/a'} last_status=${s.last_status ?? 'never'} last_success_at=${s.last_success_at ?? 'never'} latest_reporting_date=${s.latest_reporting_date ?? 'n/a'}${s.last_error ? ` error=${s.last_error}` : ''}`);
  }

  line('COVERAGE');
  console.log(`  overall: ${report.coverage.earliest_reporting_date ?? 'n/a'} .. ${report.coverage.latest_reporting_date ?? 'n/a'}`);
  for (const c of report.coverage.per_source) {
    console.log(`  ${c.source.padEnd(14)} ${c.earliest_reporting_date ?? 'n/a'} .. ${c.latest_reporting_date ?? 'n/a'} rows=${c.rows}`);
  }

  line('RECORDS');
  console.log(`  total_rows=${report.records.total_rows} unique_observations=${report.records.unique_observations} stored_total=${report.records.stored_total} sample=${report.records.sample_split.sample_rows} genuine=${report.records.sample_split.genuine_rows}`);
  console.log(`  downloaded_per_source: ${report.records.downloaded_per_source.map((r) => `${r.source}=${r.downloaded}`).join(', ') || 'none'}`);
  console.log(`  stored_per_source:     ${report.records.stored_per_source.map((r) => `${r.source}=${r.stored}`).join(', ') || 'none'}`);

  line('DUPLICATES');
  console.log(`  within_source_duplicate_groups=${report.duplicates.within_source_duplicate_groups} duplicate_rows=${report.duplicates.duplicate_rows}`);
  console.log(`  note: ${report.duplicates.note}`);

  line('CROSS-SOURCE OVERLAPS');
  console.log(`  overlap_groups (deduplicated)=${report.cross_source_overlaps.overlap_groups}`);
  for (const p of report.cross_source_overlaps.breakdown_by_pair) console.log(`  pair ${p.source_a} + ${p.source_b}: ${p.groups} group(s)`);

  line('CONFLICTS');
  console.log(`  total_open=${report.conflicts.total_open} total=${report.conflicts.total}`);
  for (const c of report.conflicts.by_type_and_status) console.log(`  ${c.conflict_type} / ${c.status}: ${c.conflicts}`);

  line('INVALID RECORDS');
  console.log(`  quality_status VALID=${report.invalid_records.quality_status.VALID} FLAGGED=${report.invalid_records.quality_status.FLAGGED} REJECTED=${report.invalid_records.quality_status.REJECTED}`);
  console.log(`  modal_price null/<=0=${report.invalid_records.null_or_nonpositive_modal_price} min>max=${report.invalid_records.min_greater_than_max} null min/max=${report.invalid_records.null_min_or_max} null arrivals=${report.invalid_records.null_arrivals} future-dated=${report.invalid_records.future_dated} null unit=${report.invalid_records.null_normalized_price_unit}`);

  line('MISSING VALUES');
  for (const [field, value] of Object.entries(report.missing_values.fields)) {
    console.log(`  ${field.padEnd(20)} nulls=${String(value.nulls).padEnd(8)} ${value.percentage === null ? '(no rows)' : `${value.percentage}%`}`);
  }

  line('COVERAGE BY DIMENSION');
  const d = report.coverage_by_dimension.distinct;
  console.log(`  commodities=${d.commodities} mandis=${d.mandis} states=${d.states} districts=${d.districts} varieties=${d.varieties}`);
  console.log(`  top commodities: ${report.coverage_by_dimension.top_commodities.map((r) => `${r.commodity}=${r.rows}`).join(', ') || 'none'}`);
  console.log(`  top mandis:      ${report.coverage_by_dimension.top_mandis.map((r) => `${r.mandi}=${r.rows}`).join(', ') || 'none'}`);

  line('ROWS BY YEAR');
  console.log(`  ${report.records_by_year.map((r) => `${r.year}=${r.rows}`).join(', ') || 'none'}`);

  line('REFRESH');
  console.log(`  latest_successful_refresh_at=${report.refresh.latest_successful_refresh_at ?? 'never'} latest_successful_sync_at=${report.refresh.latest_successful_sync_at ?? 'never'}`);
  console.log(`  batches total=${report.refresh.total_batches} successful=${report.refresh.successful_batches} failed/partial=${report.refresh.failed_batches}`);
  if (report.refresh.latest_run) {
    const r = report.refresh.latest_run;
    console.log(`  latest run: id=${r.id} source=${r.source} status=${r.status} synced_at=${r.synced_at ?? 'n/a'} inserted=${r.records_inserted} unchanged=${r.records_unchanged}`);
  } else {
    console.log(`  latest run: none (${report.refresh.latest_run_reason})`);
  }
  for (const f of report.refresh.recent_failed_batches) console.log(`  failed batch id=${f.id} source=${f.source} status=${f.status} error=${f.error_details ?? 'none'}`);

  line(`INCOMPLETE COVERAGE (${report.incomplete_coverage.length} gap(s))`);
  if (report.incomplete_coverage.length === 0) console.log('  none found in the measured data');
  for (const gap of report.incomplete_coverage) console.log(`  - ${gap}`);

  line('STORAGE');
  const disk = report.storage.disk;
  console.log(`  disk path=${disk.path ?? 'n/a'} free_bytes=${bytes(disk.free_bytes)} free_gb=${disk.free_gb ?? 'n/a'} measured=${disk.measured}${disk.note ? ` (${disk.note})` : ''}${disk.error ? ` error=${disk.error}` : ''}`);
  console.log(`  table_bytes=${bytes(report.storage.table_bytes)} index_bytes=${bytes(report.storage.index_bytes)} rows=${report.storage.rows}`);
  console.log(`  mean_bytes_per_row=${report.storage.mean_bytes_per_row ?? 'n/a'} (${report.storage.mean_bytes_per_row_basis})`);
  const est = report.storage.estimated_full_run;
  console.log(`  estimated_full_run: ${est.value_bytes === null ? 'null' : `${est.value_bytes} B (~${est.value_gb} GB)`} assumed_rows=${est.assumed_rows ?? 'none'}${est.reason ? ` reason=${est.reason}` : ` basis=${est.basis}`}`);
}

async function main() {
  const args = parseArgs(normaliseArgv(process.argv.slice(2)));
  const includeSample = args['exclude-sample'] !== true;
  const diskPath = args['disk-path'] && args['disk-path'] !== true
    ? path.resolve(backendDir, args['disk-path'])
    : path.join(backendDir, 'data');
  const estimatedFullRunRows = args['estimated-rows'] === undefined ? null : positiveInt(args['estimated-rows'], 'estimated-rows');

  const service = createQualityReportService({ pool });
  const report = await service.generateReport({ includeSample, diskPath, estimatedFullRunRows });

  if (args.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (args.out) {
    const target = path.isAbsolute(args.out) ? args.out : path.resolve(backendDir, args.out);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\n[quality-report] JSON written to ${target}`);
  }
}

main()
  .catch((err) => {
    console.error(`[quality-report] ${redactText(err.message, [config.mandi.dataGovApiKey, config.mandi.cedaApiKey])}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
