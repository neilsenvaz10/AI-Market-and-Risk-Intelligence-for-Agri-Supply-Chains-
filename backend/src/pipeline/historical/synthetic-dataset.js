/**
 * SYNTHETIC recent mandi prices, continuing the synthetic history (see synthetic-history.js)
 * up to "yesterday" and laid out like the data.gov.in current-price resource: state, district,
 * market, commodity, variety, grade, arrival_date as DD/MM/YYYY and min/max/modal price.
 *
 * NOT REAL DATA. Every row carries source MOCK_PROVIDER, is_sample_data=true and the flag
 * SYNTHETIC_SAMPLE. Do not feed these files to the data.gov.in provider: it would label them
 * as genuine DATA_GOV_IN observations.
 */
import { SYNTHETIC_END, SYNTHETIC_SOURCE, createRng, generateSyntheticHistory } from './synthetic-history.js';

export const RECENT_END = '2026-10-08';
export const RECENT_DAYS = 30;

export const RECENT_COLUMNS = [
  'state', 'district', 'market', 'commodity', 'variety', 'grade', 'arrival_date',
  'min_price', 'max_price', 'modal_price', 'source', 'is_sample_data', 'quality_flags',
];

// Plausible variety / grade labels, only to give the synthetic rows realistic structure.
const VARIETIES = {
  Onion: [['Red', 'FAQ'], ['Other', 'FAQ']],
  Tomato: [['Local', 'FAQ'], ['Hybrid', 'FAQ']],
  Potato: [['Potato', 'FAQ'], ['Jyoti', 'FAQ']],
  Wheat: [['Lokwan', 'FAQ'], ['Other', 'FAQ']],
  Soybean: [['Yellow', 'FAQ']],
  Cotton: [['H-4(A) 27mm FS', 'FAQ']],
};

const DAY_MS = 86_400_000;
const toDmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * One deterministic run to RECENT_END, split into the history window (to SYNTHETIC_END) and the
 * recent window (last `recentDays` days). Both share one price path, so overlapping dates agree.
 */
export function generateSyntheticDataset({ seed = 20211001, recentDays = RECENT_DAYS } = {}) {
  const { rows, meta } = generateSyntheticHistory({ seed, to: RECENT_END });
  const recentFrom = addDays(RECENT_END, -(recentDays - 1));
  const history = rows.filter((r) => r.price_date <= SYNTHETIC_END);
  const base = rows.filter((r) => r.price_date >= recentFrom);

  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const pairVarieties = new Map(); // market|commodity -> [[variety, grade, priceMultiplier]]
  const recent = [];
  for (const r of base) {
    const key = `${r.mandi_code}|${r.commodity_code}`;
    if (!pairVarieties.has(key)) {
      const options = VARIETIES[r.commodity_name] || [['Other', 'FAQ']];
      const list = [[...options[0], 1]];
      if (options.length > 1 && rng() < 0.4) list.push([...options[1], 0.93 + rng() * 0.14]);
      pairVarieties.set(key, list);
    }
    for (const [variety, grade, mult] of pairVarieties.get(key)) {
      const min = Math.round(r.min_price * mult);
      const modal = Math.max(min, Math.round(r.modal_price * mult));
      const max = Math.max(modal, Math.round(r.max_price * mult));
      recent.push({
        state: r.state, district: r.district, market: r.mandi_name, commodity: r.commodity_name, variety, grade,
        arrival_date: toDmy(r.price_date), min_price: min, max_price: max, modal_price: modal,
        source: SYNTHETIC_SOURCE, is_sample_data: 'true', quality_flags: 'SYNTHETIC_SAMPLE',
      });
    }
  }
  return { history, recent, meta: { ...meta, historyRows: history.length, recentRows: recent.length, recentFrom, recentTo: RECENT_END, recentDays } };
}
