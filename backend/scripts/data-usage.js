/**
 * Storage usage report for the Phase 5 mandi-data pipeline.
 *
 *   node scripts/data-usage.js                       # human-readable table
 *   node scripts/data-usage.js --json                # machine-readable JSON
 *   node scripts/data-usage.js --dir=backend/data --budget-gb=10
 *
 * Reads only: it walks the data directory and asks the filesystem for free space.
 * Values read off disk are labelled "measured"; the budget and the 10 GB disk floor are
 * configuration. Exit code 2 means the 10 GB floor (or the budget) is not satisfied.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config/index.js';
import { redactText } from '../src/pipeline/http.js';
import { GB, HARD_FLOOR_GB, resolveMinFreeGb } from '../src/pipeline/storage/diskGuard.js';
import { DEFAULT_BUDGET_GB, createBudget } from '../src/pipeline/storage/budget.js';
import { parseArgs } from './cli-utils.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function positiveNumber(value, name, fallback) {
  if (value === undefined) return fallback;
  if (value === true || !/^\d+(\.\d+)?$/.test(String(value)) || Number(value) < 0) {
    throw new Error(`--${name} must be a non-negative number`);
  }
  return Number(value);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const decimals = unit === 0 ? 0 : value < 10 ? 2 : 1;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

function pad(value, width, align = 'left') {
  const text = String(value);
  return align === 'right' ? text.padStart(width) : text.padEnd(width);
}

function renderHuman(report) {
  const lines = [];
  lines.push('Storage usage (values marked measured come from the filesystem)');
  lines.push(`  Data directory : ${report.dir}${report.usage.exists ? '' : '  [does not exist yet]'}`);
  lines.push(`  Budget         : ${formatBytes(report.budget.bytes)} (${report.budget.gb} GB, configured)`);
  lines.push(`  Used           : ${formatBytes(report.usage.bytes)} measured across ${report.usage.files} file(s) in ${report.datasets.length} dataset(s)`);
  lines.push(`  Remaining      : ${formatBytes(report.remainingBytes)} of budget`);
  lines.push(`  Free on drive  : ${formatBytes(report.free.freeBytes)} measured (${report.free.method}) for ${report.free.path}`);
  lines.push(`  Disk floor     : ${report.floor.gb} GB required (hard floor ${report.floor.hardFloorGb} GB) — ${report.floorSatisfied ? 'SATISFIED' : 'NOT SATISFIED'}`);
  lines.push('');
  if (report.datasets.length === 0) {
    lines.push('  No datasets found.');
    return lines.join('\n');
  }
  const nameWidth = Math.max(20, ...report.datasets.map((entry) => entry.dataset.length + 2));
  lines.push(`  ${pad('Dataset', nameWidth)}${pad('Files', 8, 'right')}${pad('Size (measured)', 18, 'right')}${pad('Share', 9, 'right')}`);
  for (const entry of report.datasets) {
    const share = entry.shareOfBudget === null ? 'n/a' : `${(entry.shareOfBudget * 100).toFixed(2)}%`;
    lines.push(`  ${pad(entry.dataset, nameWidth)}${pad(entry.files, 8, 'right')}${pad(formatBytes(entry.bytes), 18, 'right')}${pad(share, 9, 'right')}`);
  }
  lines.push('');
  lines.push(`  Floor check: ${formatBytes(report.free.freeBytes)} free >= ${formatBytes(report.floor.bytes)} required (${report.floor.gb} GB).`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requestedDir = args.dir && args.dir !== true ? args.dir : null;
  const dir = requestedDir ? path.resolve(backendDir, requestedDir) : path.resolve(backendDir, 'data');
  const budgetGb = positiveNumber(args['budget-gb'], 'budget-gb', DEFAULT_BUDGET_GB);
  const minFreeGb = positiveNumber(args['min-free-gb'], 'min-free-gb', HARD_FLOOR_GB);
  const budget = createBudget({ dir, budgetGb, minFreeGb });
  const report = await budget.report();

  if (args.json) {
    console.log(JSON.stringify({ ...report, floorGbRequested: resolveMinFreeGb(minFreeGb), generatedBy: 'scripts/data-usage.js' }, null, 2));
  } else {
    console.log(renderHuman(report));
  }
  if (!report.floorSatisfied || !report.budgetSatisfied) process.exitCode = 2;
  return report;
}

main().catch((err) => {
  console.error(`[data:usage] ${redactText(err.message, [config.mandi?.cedaApiKey])}`);
  process.exitCode = 1;
});
