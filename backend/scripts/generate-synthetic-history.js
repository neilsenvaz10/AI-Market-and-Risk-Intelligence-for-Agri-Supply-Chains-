/**
 * Writes SYNTHETIC mandi price datasets (not real data): a 5-year history and the latest 30 days.
 *
 *   npm run synthetic:history                       -> backend/data/synthetic/
 *   npm run synthetic:history -- --seed=7 --gzip
 *
 * Files: synthetic_mandi_history_*.csv (CEDA export layout), synthetic_mandi_recent_*.csv
 * (data.gov.in current-price layout), synthetic_mandi_dataset.meta.json (seed, counts, SHA-256,
 * disclaimer). `--gzip` writes .csv.gz instead. Nothing is written to PostgreSQL.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { SYNTHETIC_COLUMNS, SYNTHETIC_END, SYNTHETIC_START, toCsv } from '../src/pipeline/historical/synthetic-history.js';
import { RECENT_COLUMNS, generateSyntheticDataset } from '../src/pipeline/historical/synthetic-dataset.js';
import { parseArgs } from './cli-utils.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISCLAIMER = 'SYNTHETIC DATA. Not real market prices. Generated for development/testing only; never label as CEDA, Agmarknet or data.gov.in.';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seed = args.seed === undefined ? 20211001 : Number(args.seed);
  if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative whole number');
  const outDir = path.resolve(backendDir, args['out-dir'] || 'data/synthetic');
  if (!outDir.startsWith(path.join(backendDir, 'data'))) throw new Error('--out-dir must be inside backend/data (git-ignored)');

  const { history, recent, meta } = generateSyntheticDataset({ seed });
  await fs.mkdir(outDir, { recursive: true });

  const write = async (name, rows, columns) => {
    const csv = Buffer.from(toCsv(rows, columns), 'utf8');
    const body = args.gzip ? zlib.gzipSync(csv, { level: 9 }) : csv;
    const file = path.join(outDir, `${name}.csv${args.gzip ? '.gz' : ''}`);
    await fs.writeFile(file, body);
    return { path: file, file: path.basename(file), rows: rows.length, bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
  };
  const historyOut = await write(`synthetic_mandi_history_${SYNTHETIC_START}_${SYNTHETIC_END}`, history, SYNTHETIC_COLUMNS);
  const recentOut = await write(`synthetic_mandi_recent_${meta.recentFrom}_${meta.recentTo}`, recent, RECENT_COLUMNS);

  const { path: historyPath, ...historyInfo } = historyOut;
  const { path: recentPath, ...recentInfo } = recentOut;
  await fs.writeFile(path.join(outDir, 'synthetic_mandi_dataset.meta.json'), `${JSON.stringify({
    DISCLAIMER,
    source: 'MOCK_PROVIDER',
    is_sample_data: true,
    seed,
    series: meta.pairs,
    history: { window: [SYNTHETIC_START, SYNTHETIC_END], layout: 'CEDA export columns (+ is_sample_data)', ...historyInfo },
    recent: { window: [meta.recentFrom, meta.recentTo], layout: 'data.gov.in current-price fields (DD/MM/YYYY arrival_date, variety, grade)', ...recentInfo },
  }, null, 2)}\n`);

  console.log(`[synthetic] history: ${history.length} rows -> ${historyPath}`);
  console.log(`[synthetic] recent:  ${recent.length} rows (${meta.recentFrom}..${meta.recentTo}) -> ${recentPath}`);
  console.log('[synthetic] SYNTHETIC DATA: source=MOCK_PROVIDER, is_sample_data=true. Nothing was written to the database.');
}

main().catch((err) => {
  console.error(`[synthetic] ${err.message}`);
  process.exitCode = 1;
});
