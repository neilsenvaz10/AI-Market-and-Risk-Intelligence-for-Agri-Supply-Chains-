/**
 * SYNTHETIC mandi price history (2021-10-01 .. 2026-09-30) shaped like the CEDA / Agmarknet
 * export: daily min / max / modal price in INR per quintal and arrivals in tonnes, per
 * market and commodity.
 *
 * THIS IS NOT REAL MARKET DATA. Every value is generated from a seeded random model for
 * developing and testing forecasting / risk code. Safeguards:
 *   - rows carry source MOCK_PROVIDER, is_sample_data=true and the flag SYNTHETIC_SAMPLE,
 *     never the CEDA source code, so the database constraints and the Phase 4 loader treat
 *     them as sample data;
 *   - the generator writes files only; it never touches PostgreSQL;
 *   - base prices, seasonality and shocks are modelling assumptions, not statistics.
 * Output is deterministic for a given seed.
 */
import { makeCode, normalizeCommodity } from '../normalizer.js';

export const SYNTHETIC_START = '2021-10-01';
export const SYNTHETIC_END = '2026-09-30';
export const SYNTHETIC_SOURCE = 'MOCK_PROVIDER';

export const SYNTHETIC_COLUMNS = [
  'validation_status', 'rejection_codes', 'source', 'source_record_key', 'source_market_id', 'source_commodity_id',
  'source_state_id', 'source_district_id', 'source_market_name', 'source_commodity_name', 'source_state_name',
  'source_district_name', 'mandi_code', 'mandi_name', 'state', 'district', 'commodity_code', 'commodity_name',
  'variety', 'grade', 'price_date', 'min_price', 'max_price', 'modal_price', 'price_unit',
  'arrivals_quantity', 'arrival_unit', 'quality_flags', 'fetched_at', 'is_sample_data',
];

/** Modelling assumptions per commodity (INR/quintal, rough orders of magnitude only). */
export const COMMODITIES = [
  { name: 'Onion', base: 1800, drift: 0.04, seasonAmp: 0.30, peakDoy: 320, vol: 0.020, spread: 0.10, arrivalBase: 220, shocks: 4 },
  { name: 'Tomato', base: 2000, drift: 0.03, seasonAmp: 0.45, peakDoy: 190, vol: 0.040, spread: 0.16, arrivalBase: 150, shocks: 5 },
  { name: 'Potato', base: 1500, drift: 0.04, seasonAmp: 0.18, peakDoy: 230, vol: 0.012, spread: 0.08, arrivalBase: 260, shocks: 2 },
  { name: 'Wheat', base: 2200, drift: 0.05, seasonAmp: 0.06, peakDoy: 60, vol: 0.004, spread: 0.04, arrivalBase: 320, shocks: 1 },
  { name: 'Soyabean', base: 4500, drift: 0.03, seasonAmp: 0.10, peakDoy: 170, vol: 0.007, spread: 0.05, arrivalBase: 180, shocks: 2 },
  { name: 'Cotton', base: 6800, drift: 0.02, seasonAmp: 0.08, peakDoy: 150, vol: 0.006, spread: 0.05, arrivalBase: 90, shocks: 2 },
];

/** Markets (state, district, market) with a price level multiplier relative to the national series. */
export const MARKETS = [
  ['Maharashtra', 'Nashik', 'Lasalgaon', 0.96], ['Maharashtra', 'Nashik', 'Nashik', 1.00],
  ['Maharashtra', 'Pune', 'Pune', 1.08], ['Maharashtra', 'Pune', 'Pune(Moshi)', 1.05],
  ['Maharashtra', 'Ahmednagar', 'Ahmednagar', 0.97], ['Maharashtra', 'Solapur', 'Solapur', 0.95],
  ['Maharashtra', 'Thane', 'Mumbai', 1.14], ['Karnataka', 'Bangalore', 'Bangalore', 1.10],
  ['Madhya Pradesh', 'Indore', 'Indore', 0.93], ['Gujarat', 'Rajkot', 'Rajkot', 0.98],
  ['Uttar Pradesh', 'Agra', 'Agra', 0.94], ['Delhi', 'Delhi', 'Azadpur', 1.12],
];

// Which commodities each market trades (sparse on purpose: not every pair exists).
const MARKET_COMMODITIES = {
  Lasalgaon: ['Onion', 'Tomato'], Nashik: ['Onion', 'Tomato', 'Potato', 'Wheat'],
  Pune: ['Onion', 'Tomato', 'Potato', 'Wheat', 'Soyabean'], 'Pune(Moshi)': ['Onion', 'Tomato', 'Potato'],
  Ahmednagar: ['Onion', 'Tomato', 'Wheat', 'Soyabean', 'Cotton'], Solapur: ['Onion', 'Wheat', 'Soyabean', 'Cotton'],
  Mumbai: ['Onion', 'Tomato', 'Potato'], Bangalore: ['Onion', 'Tomato', 'Potato'],
  Indore: ['Onion', 'Potato', 'Wheat', 'Soyabean'], Rajkot: ['Onion', 'Potato', 'Wheat', 'Cotton', 'Soyabean'],
  Agra: ['Potato', 'Wheat', 'Tomato'], Azadpur: ['Onion', 'Tomato', 'Potato', 'Wheat'],
};

/** mulberry32: small deterministic PRNG. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.normal = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return next;
}

const DAY_MS = 86_400_000;
export function dateRange(from, to) {
  const days = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}
const dayOfYear = (iso) => Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${iso.slice(0, 4)}-01-01T00:00:00Z`)) / DAY_MS) + 1;
const isSunday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

/** Fixed-date public holidays (approximate; movable festivals are modelled as random closures). */
const FIXED_HOLIDAYS = ['01-26', '08-15', '10-02', '12-25'];

function shockSeries(rng, days, count) {
  const series = new Float64Array(days.length);
  for (let s = 0; s < count; s += 1) {
    const start = rng.int(30, days.length - 90);
    const length = rng.int(20, 60);
    const magnitude = (rng() < 0.75 ? 1 : -0.5) * (0.25 + rng() * 0.55); // mostly spikes, some slumps
    for (let i = 0; i < length; i += 1) series[start + i] += magnitude * Math.exp((-3 * i) / length);
  }
  return series;
}

/**
 * Generates rows (objects keyed by SYNTHETIC_COLUMNS). Pure and deterministic.
 * @param {{seed?: number, from?: string, to?: string, generatedNote?: string}} options
 * @returns {{rows: object[], meta: object}}
 */
export function generateSyntheticHistory({ seed = 20211001, from = SYNTHETIC_START, to = SYNTHETIC_END } = {}) {
  const days = dateRange(from, to);
  const rng = createRng(seed);
  const rows = [];
  const meta = { seed, from, to, days: days.length, commodities: {}, pairs: 0 };

  for (const commodity of COMMODITIES) {
    const ident = normalizeCommodity(commodity.name);
    const shocks = shockSeries(rng, days, commodity.shocks);
    meta.commodities[commodity.name] = { shocks: shocks.reduce((n, v, i) => n + (v !== 0 && (i === 0 || shocks[i - 1] === 0) ? 1 : 0), 0) };

    // National (shared) log-price path: trend + season + slow AR(1) + shocks.
    const national = new Float64Array(days.length);
    let ar = 0;
    days.forEach((day, i) => {
      ar = 0.97 * ar + commodity.vol * rng.normal();
      const years = i / 365.25;
      const season = commodity.seasonAmp * Math.cos((2 * Math.PI * (dayOfYear(day) - commodity.peakDoy)) / 365.25);
      national[i] = Math.log(commodity.base) + commodity.drift * years + season + ar + shocks[i];
    });

    for (const [state, district, market, level] of MARKETS) {
      if (!MARKET_COMMODITIES[market]?.includes(commodity.name)) continue;
      meta.pairs += 1;
      const mandiCode = makeCode([state, district, market]);
      const arrivalScale = commodity.arrivalBase * (0.5 + rng() * 1.5);
      const coverage = 0.72 + rng() * 0.26; // share of open days this market actually reports
      const startOffset = rng() < 0.2 ? rng.int(60, 500) : 0; // some markets join the series late
      const festivalClosures = new Set(Array.from({ length: 12 }, () => rng.int(0, days.length - 1)));
      let local = 0;
      let outage = 0;

      days.forEach((day, i) => {
        local = 0.92 * local + 0.012 * rng.normal();
        if (i < startOffset) return;
        if (isSunday(day) && rng() < 0.92) return;
        if (FIXED_HOLIDAYS.includes(day.slice(5)) || festivalClosures.has(i)) return;
        if (outage > 0) { outage -= 1; return; }
        if (rng() < 0.004) { outage = rng.int(3, 21); return; } // multi-day gap in reporting
        if (rng() > coverage) return;

        const modal = Math.exp(national[i] + local + 0.015 * rng.normal()) * level;
        const minP = modal * (1 - commodity.spread * (0.4 + rng() * 0.6));
        const maxP = modal * (1 + commodity.spread * (0.4 + rng() * 0.6));
        // Arrivals fall when prices are high (supply squeeze), with weekday and noise effects.
        const priceRatio = Math.exp(national[i] - Math.log(commodity.base));
        const arrivals = arrivalScale * Math.exp(-0.5 * (priceRatio - 1) + 0.25 * rng.normal()) * (new Date(`${day}T00:00:00Z`).getUTCDay() === 1 ? 1.15 : 1);

        const roundTo = (v) => Math.round(v);
        const mn = roundTo(minP);
        const md = Math.max(mn, roundTo(modal));
        const mx = Math.max(md, roundTo(maxP));
        rows.push({
          validation_status: 'valid', rejection_codes: '', source: SYNTHETIC_SOURCE,
          source_record_key: `SYN:${mandiCode}:${ident.code}:${day}`,
          source_market_id: '', source_commodity_id: '', source_state_id: '', source_district_id: '',
          source_market_name: market, source_commodity_name: commodity.name, source_state_name: state, source_district_name: district,
          mandi_code: mandiCode, mandi_name: market, state, district,
          commodity_code: ident.code, commodity_name: ident.name, variety: '', grade: '',
          price_date: day, min_price: mn, max_price: mx, modal_price: md, price_unit: 'INR/quintal',
          arrivals_quantity: Math.max(0.1, Math.round(arrivals * 10) / 10), arrival_unit: 'tonne',
          quality_flags: 'SYNTHETIC_SAMPLE', fetched_at: '', is_sample_data: 'true',
        });
      });
    }
  }
  rows.sort((a, b) => (a.price_date < b.price_date ? -1 : a.price_date > b.price_date ? 1 : a.mandi_code.localeCompare(b.mandi_code) || a.commodity_code.localeCompare(b.commodity_code)));
  meta.rows = rows.length;
  return { rows, meta };
}

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export const toCsv = (rows, columns = SYNTHETIC_COLUMNS) => `${[columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n')}\n`;
