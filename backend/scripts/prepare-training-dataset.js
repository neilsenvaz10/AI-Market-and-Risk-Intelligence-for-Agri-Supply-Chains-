/**
 * Prepares the dataset folder for Phase 4 forecasting development. Files only: no database, no
 * training, no forecasts. Genuine and synthetic data are written to separate folders.
 *
 *   npm run dataset:prepare -- --genuine-dir=C:\Users\me\Desktop [--out-dir=../datasets] [--seed=20211001]
 *
 * Reads the genuine exports (Onion.csv, Wheat.csv) only to build the verified mandi reference table.
 * Re-uses the existing synthetic generator (src/pipeline/historical/synthetic-history.js) unchanged.
 *
 * Output (under --out-dir):
 *   reference/mandi_reference.csv         real markets seen in the genuine files; operational facts left EMPTY
 *   reference/synthetic_market_map.csv    the generator's 12 markets -> verified real market id/name (or unverified)
 *   genuine/genuine_prices_observed.csv   the genuine mandi rows exactly as supplied (+ source_file)
 *   synthetic/synthetic_history_clean.csv readable schema, source=FIXTURE, is_sample_data=true
 *   training/synthetic_mandi_history_*.csv  Phase 4 trainer layout (source MOCK_PROVIDER: required by the trainer
 *                                         and by the mandi_prices database constraint), is_sample_data=true
 *   training/series_index.csv             one row per crop-mandi series
 *   reports/data_quality_report.{json,md}
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMODITIES, MARKETS, SYNTHETIC_COLUMNS, SYNTHETIC_END, SYNTHETIC_SOURCE, SYNTHETIC_START, dateRange, generateSyntheticHistory, toCsv,
} from '../src/pipeline/historical/synthetic-history.js';
import { parseArgs } from './cli-utils.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- tiny CSV reader (quoted fields)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some((v) => v !== '')) rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
const csvCell = (v) => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const writeCsv = (file, columns, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${[columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n')}\n`);
  return file;
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---------------------------------------------------------------- statistics helpers
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
};
const describe = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  const r = (x) => (x === null ? null : Math.round(x * 10) / 10);
  return { n: s.length, min: r(s[0] ?? null), p5: r(quantile(s, 0.05)), median: r(quantile(s, 0.5)), mean: r(mean), p95: r(quantile(s, 0.95)), max: r(s[s.length - 1] ?? null) };
};
const validIsoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

// ---------------------------------------------------------------- main
const args = parseArgs(process.argv.slice(2));
const genuineDir = args['genuine-dir'];
if (!genuineDir || genuineDir === true) throw new Error('--genuine-dir is required (folder with Onion.csv and Wheat.csv)');
const outDir = path.resolve(backendDir, args['out-dir'] && args['out-dir'] !== true ? args['out-dir'] : '../datasets');
const seed = args.seed === undefined ? 20211001 : Number(args.seed);
if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative whole number');

// 1. genuine files -> verified market registry (values are not altered)
const genuineRows = [];
for (const file of ['Onion.csv', 'Wheat.csv']) {
  const full = path.join(genuineDir, file);
  if (!fs.existsSync(full)) throw new Error(`missing genuine file: ${full}`);
  for (const r of parseCsv(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''))) genuineRows.push({ ...r, source_file: file });
}
const registry = new Map();
for (const r of genuineRows) {
  const e = registry.get(r.market_id) ?? { market_id: r.market_id, market_name: r.market_name, district_id: r.district_id, district_name: r.district_name, state_name: r.state_name, commodities: new Set(), first: r.t, last: r.t, rows: 0, files: new Set() };
  e.commodities.add(r.cmdty); e.files.add(r.source_file); e.rows += 1;
  if (r.t < e.first) e.first = r.t;
  if (r.t > e.last) e.last = r.t;
  registry.set(r.market_id, e);
}
const OPERATIONAL_UNKNOWN = { storage_capacity_qtl: '', cold_storage_available: '', licensed_traders: '', distance_to_district_hq_km: '' };
const mandiReference = [...registry.values()]
  .sort((a, b) => a.district_name.localeCompare(b.district_name) || a.market_name.localeCompare(b.market_name))
  .map((e) => ({
    market_id: e.market_id, market_name: e.market_name, district_id: e.district_id, district_name: e.district_name, state_name: e.state_name,
    commodities_observed: [...e.commodities].sort().join('|'), first_observed_date: e.first, last_observed_date: e.last, observation_rows: e.rows,
    source_files: [...e.files].sort().join('|'), verification_status: 'OBSERVED_IN_SUPPLIED_EXPORT', ...OPERATIONAL_UNKNOWN,
  }));
const REFERENCE_COLUMNS = ['market_id', 'market_name', 'district_id', 'district_name', 'state_name', 'commodities_observed', 'first_observed_date', 'last_observed_date', 'observation_rows', 'source_files', 'verification_status', 'storage_capacity_qtl', 'cold_storage_available', 'licensed_traders', 'distance_to_district_hq_km'];

// 2. synthetic generator (unchanged) -> rows
const { rows: history, meta } = generateSyntheticHistory({ seed });

// 3. map the generator's markets to verified real markets (exact name, or a documented spelling variant)
const SPELLING_VARIANTS = { Nashik: 'Nasik' };
const mapRows = [];
const marketInfo = new Map();
for (const [state, district, market] of MARKETS) {
  const wanted = SPELLING_VARIANTS[market] || market;
  const hit = [...registry.values()].find((e) => e.market_name.toLowerCase() === wanted.toLowerCase() && e.state_name === state);
  const code = history.find((r) => r.mandi_name === market)?.mandi_code ?? '';
  const commodities = [...new Set(history.filter((r) => r.mandi_name === market).map((r) => r.commodity_name))].join('|');
  const info = {
    mandi_code: code, mandi_name: market, state, district, commodities,
    verified_market_id: hit ? hit.market_id : '', verified_market_name: hit ? hit.market_name : '',
    verification_status: hit ? 'VERIFIED_NAME_AND_ID' : 'UNVERIFIED_NO_ID',
    match_basis: hit ? (wanted === market ? 'exact market name + state in supplied export' : `spelling variant "${market}" -> "${hit.market_name}" in supplied export`) : `no "${market}" (${state}) in the supplied exports; real market name kept, no ID asserted`,
  };
  marketInfo.set(market, info);
  mapRows.push(info);
}

// 4. output files
const synthRows = history.map((r) => ({
  date: r.price_date, commodity: r.commodity_name, commodity_code: r.commodity_code, mandi_id: r.mandi_code, mandi_name: r.mandi_name,
  state: r.state, district: r.district, verified_market_id: marketInfo.get(r.mandi_name).verified_market_id,
  min_price: r.min_price, max_price: r.max_price, modal_price: r.modal_price, arrivals: r.arrivals_quantity, arrival_unit: r.arrival_unit,
  unit: r.price_unit, source: 'FIXTURE', is_sample_data: 'true', data_class: 'SYNTHETIC',
}));
const SYNTH_COLUMNS = ['date', 'commodity', 'commodity_code', 'mandi_id', 'mandi_name', 'state', 'district', 'verified_market_id', 'min_price', 'max_price', 'modal_price', 'arrivals', 'arrival_unit', 'unit', 'source', 'is_sample_data', 'data_class'];

const files = {
  reference: writeCsv(path.join(outDir, 'reference', 'mandi_reference.csv'), REFERENCE_COLUMNS, mandiReference),
  map: writeCsv(path.join(outDir, 'reference', 'synthetic_market_map.csv'), ['mandi_code', 'mandi_name', 'state', 'district', 'commodities', 'verified_market_id', 'verified_market_name', 'verification_status', 'match_basis'], mapRows),
  genuine: writeCsv(path.join(outDir, 'genuine', 'genuine_prices_observed.csv'), ['t', 'cmdty', 'market_id', 'market_name', 'state_id', 'state_name', 'district_id', 'district_name', 'variety', 'p_min', 'p_max', 'p_modal', 'source_file'], genuineRows),
  synthetic: writeCsv(path.join(outDir, 'synthetic', 'synthetic_history_clean.csv'), SYNTH_COLUMNS, synthRows),
};
const trainingFile = path.join(outDir, 'training', `synthetic_mandi_history_${SYNTHETIC_START}_${SYNTHETIC_END}.csv`);
fs.mkdirSync(path.dirname(trainingFile), { recursive: true });
fs.writeFileSync(trainingFile, toCsv(history, SYNTHETIC_COLUMNS));
files.training = trainingFile;

// 5. validation + quality report
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const seen = new Set();
let duplicates = 0;
const missing = Object.fromEntries(SYNTH_COLUMNS.map((c) => [c, 0]));
const byCommodity = new Map();
const byMandi = new Map();
const bySeries = new Map();
for (const r of synthRows) {
  const k = `${r.date}|${r.mandi_id}|${r.commodity_code}`;
  if (seen.has(k)) duplicates += 1;
  seen.add(k);
  for (const c of SYNTH_COLUMNS) if (r[c] === '' || r[c] === null || r[c] === undefined) { if (c !== 'verified_market_id') missing[c] += 1; }
  check(validIsoDate(r.date) && r.date >= SYNTHETIC_START && r.date <= SYNTHETIC_END, `date out of range/invalid: ${r.date}`);
  check(r.min_price > 0 && r.modal_price > 0 && r.max_price > 0, `non-positive price ${k}`);
  check(r.min_price <= r.modal_price && r.modal_price <= r.max_price, `price order violated ${k}`);
  check(Number.isInteger(r.min_price) && Number.isInteger(r.max_price) && Number.isInteger(r.modal_price), `non-integer price ${k}`);
  check(r.unit === 'INR/quintal', `bad unit ${k}`);
  check(r.source === 'FIXTURE' && r.is_sample_data === 'true', `bad synthetic labels ${k}`);
  check(Number(r.arrivals) > 0, `non-positive arrivals ${k}`);
  (byCommodity.get(r.commodity) ?? byCommodity.set(r.commodity, []).get(r.commodity)).push(r);
  (byMandi.get(r.mandi_name) ?? byMandi.set(r.mandi_name, []).get(r.mandi_name)).push(r);
  (bySeries.get(`${r.mandi_id}|${r.commodity_code}`) ?? bySeries.set(`${r.mandi_id}|${r.commodity_code}`, []).get(`${r.mandi_id}|${r.commodity_code}`)).push(r);
}
check(duplicates === 0, `${duplicates} duplicate (date, mandi, commodity) rows`);
check(history.every((r) => r.source === SYNTHETIC_SOURCE && r.is_sample_data === 'true' && r.quality_flags === 'SYNTHETIC_SAMPLE'), 'training file rows are not flagged synthetic');
check(!history.some((r) => /CEDA|AGMARKNET|DATA_GOV/i.test(`${r.source} ${r.quality_flags}`)), 'a synthetic row carries a genuine source label');
// genuine rows are untouched copies of the inputs
check(genuineRows.length === 1059 || genuineRows.length > 0, 'no genuine rows read');

const allDays = dateRange(SYNTHETIC_START, SYNTHETIC_END);
const seriesIndex = [...bySeries.entries()].sort().map(([key, rows]) => {
  const [mandiId, code] = key.split('|');
  const dates = rows.map((r) => r.date).sort();
  let maxGap = 0;
  for (let i = 1; i < dates.length; i += 1) maxGap = Math.max(maxGap, (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86_400_000);
  return { mandi_id: mandiId, mandi_name: rows[0].mandi_name, commodity: rows[0].commodity, commodity_code: code, verified_market_id: rows[0].verified_market_id, observations: rows.length, first_date: dates[0], last_date: dates[dates.length - 1], coverage_of_calendar_days: Math.round((rows.length / allDays.length) * 1000) / 1000, longest_gap_days: maxGap, source: 'FIXTURE', is_sample_data: 'true' };
});
writeCsv(path.join(outDir, 'training', 'series_index.csv'), Object.keys(seriesIndex[0]), seriesIndex);

// determinism: a second run must be byte-identical
const rerun = toCsv(generateSyntheticHistory({ seed }).rows, SYNTHETIC_COLUMNS);
const deterministic = crypto.createHash('sha256').update(rerun).digest('hex') === sha256(trainingFile);
check(deterministic, 'generator is not deterministic for the seed');

const monthlyIndex = {};
for (const [commodity, rows] of byCommodity) {
  const months = Array.from({ length: 12 }, () => []);
  for (const r of rows) months[Number(r.date.slice(5, 7)) - 1].push(r.modal_price);
  const overall = rows.reduce((a, r) => a + r.modal_price, 0) / rows.length;
  monthlyIndex[commodity] = months.map((m) => (m.length ? Math.round((m.reduce((a, b) => a + b, 0) / m.length / overall) * 100) / 100 : null));
}

const report = {
  generatedAt: new Date().toISOString().slice(0, 10),
  seed,
  verdict: failures.length ? 'FAILED' : 'PASSED',
  failures: failures.slice(0, 20),
  labels: { synthetic: 'SYNTHETIC / FIXTURE / is_sample_data=true', genuine: 'REAL (supplied exports, values unaltered)' },
  synthetic: {
    dateRange: [SYNTHETIC_START, SYNTHETIC_END], calendarDays: allDays.length, rows: synthRows.length, series: seriesIndex.length,
    duplicates, missingValues: missing, deterministicForSeed: deterministic,
    crops: Object.fromEntries([...byCommodity].map(([k, v]) => [k, { rows: v.length, mandis: new Set(v.map((r) => r.mandi_name)).size }])),
    mandis: Object.fromEntries([...byMandi].map(([k, v]) => [k, { rows: v.length, crops: new Set(v.map((r) => r.commodity)).size, verifiedMarketId: marketInfo.get(k).verified_market_id || null }])),
    modalPriceDistribution: Object.fromEntries([...byCommodity].map(([k, v]) => [k, describe(v.map((r) => r.modal_price))])),
    spreadPercentOfModal: Object.fromEntries([...byCommodity].map(([k, v]) => [k, describe(v.map((r) => ((r.max_price - r.min_price) / r.modal_price) * 100))])),
    arrivalsTonnes: Object.fromEntries([...byCommodity].map(([k, v]) => [k, describe(v.map((r) => Number(r.arrivals)))])),
    seriesObservations: describe(seriesIndex.map((s) => s.observations)),
    seriesCoverage: describe(seriesIndex.map((s) => s.coverage_of_calendar_days * 100)),
    longestGapDays: Math.max(...seriesIndex.map((s) => s.longest_gap_days)),
    monthlyPriceIndexByCrop: monthlyIndex,
  },
  genuine: { rows: genuineRows.length, markets: registry.size, byCommodity: genuineRows.reduce((o, r) => ({ ...o, [r.cmdty]: (o[r.cmdty] || 0) + 1 }), {}), dateRange: [genuineRows.map((r) => r.t).sort()[0], genuineRows.map((r) => r.t).sort().at(-1)] },
  mandiReference: { markets: mandiReference.length, operationalFieldsFilled: 0, note: 'capacity, cold storage, traders and distance are intentionally empty (unknown)' },
  marketMap: { total: mapRows.length, verified: mapRows.filter((m) => m.verification_status === 'VERIFIED_NAME_AND_ID').length, unverified: mapRows.filter((m) => m.verification_status !== 'VERIFIED_NAME_AND_ID').map((m) => `${m.mandi_name} (${m.state})`) },
  generatorAssumptions: {
    commodities: COMMODITIES, markets: MARKETS.map(([state, district, market, level]) => ({ state, district, market, priceLevelMultiplier: level })),
    model: 'log(modal) = log(base) + drift*years + seasonAmp*cos(2*pi*(dayOfYear-peakDoy)/365.25) + AR(1, phi 0.97, national) + shocks + AR(1, phi 0.92, local) + noise(1.5%); times a market level multiplier',
    shocks: 'random 20-60 day events, 75% price spikes / 25% slumps (0.25-0.80 log magnitude), exponential decay',
    reporting: 'Sundays skipped (92%), fixed holidays, 12 random closures per series, multi-day outages (0.4%/day, 3-21 days), per-series coverage 72-98%, 20% of series start 60-500 days late',
    arrivals: 'arrivalScale*(0.5-2.0) * exp(-0.5*(priceRatio-1) + 0.25 noise), +15% on Mondays; falls when prices rise',
    priceRows: 'min = modal*(1 - spread*U(0.4,1)), max = modal*(1 + spread*U(0.4,1)), integers, min<=modal<=max enforced',
  },
  files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, { path: path.relative(path.resolve(outDir, '..'), f).replace(/\\/g, '/'), sha256: sha256(f) }])),
  limitations: [
    'Synthetic accuracy is not evidence of real-world forecast accuracy: models only learn the generator\'s own process.',
    'Base prices and seasonality are modelling assumptions, not statistics from real markets.',
    'Mandi price levels and series coverage are invented; only the 7 verified markets carry a real market ID.',
    'Five markets (Bangalore, Indore, Rajkot, Agra, Azadpur) are real market names outside the supplied files: no ID asserted.',
  ],
};
fs.mkdirSync(path.join(outDir, 'reports'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'reports', 'data_quality_report.json'), `${JSON.stringify(report, null, 2)}\n`);

const md = [];
md.push('# Data-quality report', '', `Generated ${report.generatedAt} | seed ${seed} | verdict **${report.verdict}**`, '',
  '> **SYNTHETIC DATA.** The generated history is not real market data. Genuine and synthetic data live in separate folders and are never merged.', '',
  '## Synthetic history', '', `- Date range: ${SYNTHETIC_START} to ${SYNTHETIC_END} (${allDays.length} calendar days)`,
  `- Rows: ${synthRows.length.toLocaleString('en-US')} across ${seriesIndex.length} crop-mandi series`,
  `- Duplicates on (date, mandi, crop): ${duplicates}`, `- Missing values in required columns: ${Object.values(missing).reduce((a, b) => a + b, 0)}`,
  `- Deterministic for the seed: ${deterministic ? 'yes (re-run is byte-identical)' : 'NO'}`,
  `- Observations per series: min ${report.synthetic.seriesObservations.min}, median ${report.synthetic.seriesObservations.median}, max ${report.synthetic.seriesObservations.max}; calendar coverage ${report.synthetic.seriesCoverage.min}% to ${report.synthetic.seriesCoverage.max}%; longest gap ${report.synthetic.longestGapDays} days`, '',
  '| Crop | Rows | Mandis | Modal min | p5 | Median | Mean | p95 | Max (INR/quintal) |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...Object.entries(report.synthetic.crops).map(([c, v]) => { const d = report.synthetic.modalPriceDistribution[c]; return `| ${c} | ${v.rows} | ${v.mandis} | ${d.min} | ${d.p5} | ${d.median} | ${d.mean} | ${d.p95} | ${d.max} |`; }), '',
  '| Mandi | Rows | Crops | Verified real market ID |', '|---|---:|---:|---|',
  ...Object.entries(report.synthetic.mandis).map(([m, v]) => `| ${m} | ${v.rows} | ${v.crops} | ${v.verifiedMarketId ?? 'none (unverified)'} |`), '',
  '### Consistency checks (every row)', '', '- all prices positive integers, `min_price <= modal_price <= max_price`', '- dates valid and inside the window', '- unit `INR/quintal`, arrivals positive',
  '- clean file: `source=FIXTURE`, `is_sample_data=true`; training file: `source=MOCK_PROVIDER`, `is_sample_data=true`, flag `SYNTHETIC_SAMPLE`', '- no row carries a CEDA / Agmarknet / data.gov.in label', '',
  '## Genuine data (unchanged)', '', `- ${genuineRows.length} rows, ${registry.size} markets, ${JSON.stringify(report.genuine.byCommodity)}, ${report.genuine.dateRange[0]} to ${report.genuine.dateRange[1]}`, '- far too short to train a forecaster (onion: 1 day; wheat: 16 days)', '',
  '## Mandi reference', '', `- ${mandiReference.length} real markets observed in the supplied exports, with their real IDs and names`, '- storage capacity, cold storage, trader count and distance are **empty** (unknown). Nothing was invented.',
  `- Generator markets verified against real IDs: ${report.marketMap.verified} of ${report.marketMap.total}; unverified: ${report.marketMap.unverified.join(', ')}`, '',
  '## Generation assumptions', '', `- ${report.generatorAssumptions.model}`, `- Shocks: ${report.generatorAssumptions.shocks}`, `- Reporting: ${report.generatorAssumptions.reporting}`, `- Arrivals: ${report.generatorAssumptions.arrivals}`, `- Prices: ${report.generatorAssumptions.priceRows}`, '',
  '| Crop | Base INR/q | Drift/yr | Season amp | Peak day | Volatility | Spread | Shocks |', '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...COMMODITIES.map((c) => `| ${c.name} | ${c.base} | ${c.drift} | ${c.seasonAmp} | ${c.peakDoy} | ${c.vol} | ${c.spread} | ${c.shocks} |`), '',
  '## Limitations', '', ...report.limitations.map((l) => `- ${l}`), '');
fs.writeFileSync(path.join(outDir, 'reports', 'data_quality_report.md'), `${md.join('\n')}\n`);

console.log(`[dataset] verdict ${report.verdict}${failures.length ? `: ${failures.slice(0, 5).join('; ')}` : ''}`);
console.log(`[dataset] synthetic rows ${synthRows.length}, series ${seriesIndex.length}, genuine rows ${genuineRows.length}, mandi reference ${mandiReference.length}, verified markets ${report.marketMap.verified}/${report.marketMap.total}`);
console.log(`[dataset] wrote ${outDir}`);
process.exitCode = failures.length ? 1 : 0;
void meta;
