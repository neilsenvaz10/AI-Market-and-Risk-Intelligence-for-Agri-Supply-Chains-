import crypto from 'node:crypto';

/**
 * Mandi Data Normalizer
 *
 * Converts a provider record into the canonical shape stored in mandi_prices.
 * Rules (each one fixes a defect found in the Phase 3 audit):
 *   - identities use EXACT matching on normalised names, never substrings
 *     ("Sweet Potato" stays SWEET_POTATO, "Pune(Moshi)" stays its own market);
 *   - missing state/district/market are never guessed; they stay null and the
 *     validator rejects the record;
 *   - dates must be real calendar dates in the provider's declared format;
 *   - missing prices and arrivals stay null (never 0);
 *   - units are converted only when the unit is known; unknown units stay null
 *     and the record is rejected;
 *   - original source names and identifiers are preserved alongside canonical ones.
 */

export const CANONICAL_PRICE_UNIT = 'INR/quintal';
export const CANONICAL_ARRIVAL_UNIT = 'tonne';

// Price units -> factor that converts the source value into INR per quintal.
const PRICE_UNITS = {
  'inr/quintal': 1, 'rs/quintal': 1, 'rs./quintal': 1, 'rs/qtl': 1, 'inr/qtl': 1, '₹/quintal': 1,
  'inr/kg': 100, 'rs/kg': 100, 'rs./kg': 100, '₹/kg': 100,
  'inr/tonne': 0.1, 'rs/tonne': 0.1, 'inr/ton': 0.1, 'rs/ton': 0.1, '₹/tonne': 0.1,
};

// Arrival quantity units -> factor that converts the source value into tonnes.
const ARRIVAL_UNITS = {
  tonne: 1, tonnes: 1, ton: 1, tons: 1, t: 1, mt: 1, 'metric tonne': 1, 'metric tonnes': 1,
  quintal: 0.1, quintals: 0.1, qtl: 0.1,
  kg: 0.001, kgs: 0.001, kilogram: 0.001, kilograms: 0.001,
};

// Exact aliases only (transliterations / local names of the SAME commodity).
const COMMODITY_ALIASES = {
  onion: 'ONION', kanda: 'ONION', pyaaz: 'ONION', pyaz: 'ONION', 'कांदा': 'ONION', 'प्याज': 'ONION',
  tomato: 'TOMATO', tamatar: 'TOMATO', 'टोमॅटो': 'TOMATO', 'टमाटर': 'TOMATO',
  potato: 'POTATO', batata: 'POTATO', aloo: 'POTATO', aaloo: 'POTATO', 'आलू': 'POTATO', 'बटाटा': 'POTATO',
  soybean: 'SOYBEAN', soyabean: 'SOYBEAN', 'सोयाबीन': 'SOYBEAN',
  wheat: 'WHEAT', gehun: 'WHEAT', gahu: 'WHEAT', 'गेहूं': 'WHEAT', 'गहू': 'WHEAT',
  cotton: 'COTTON', kapas: 'COTTON', kapus: 'COTTON', 'कपास': 'COTTON', 'कापूस': 'COTTON',
};

// Alias lookup goes through nameKey so spelling variants (case, punctuation, Unicode form) match.
const ALIAS_BY_KEY = new Map(Object.entries(COMMODITY_ALIASES).map(([alias, code]) => [alias.normalize('NFKC').toLowerCase(), code]));

const COMMODITY_META = {
  ONION: { name: 'Onion', hindi: 'प्याज', marathi: 'कांदा', category: 'Vegetables' },
  TOMATO: { name: 'Tomato', hindi: 'टमाटर', marathi: 'टोमॅटो', category: 'Vegetables' },
  POTATO: { name: 'Potato', hindi: 'आलू', marathi: 'बटाटा', category: 'Vegetables' },
  SOYBEAN: { name: 'Soybean', hindi: 'सोयाबीन', marathi: 'सोयाबीन', category: 'Oilseeds' },
  WHEAT: { name: 'Wheat', hindi: 'गेहूं', marathi: 'गहू', category: 'Cereals' },
  COTTON: { name: 'Cotton', hindi: 'कपास', marathi: 'कापूस', category: 'Fibre Crops' },
};

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nr', 'null', 'nil', '-', '--', 'none']);

/** Collapses whitespace; returns null for empty or placeholder values. */
export function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return MISSING_TOKENS.has(text.toLowerCase()) ? null : text;
}

/** Matching key: case-insensitive, punctuation-insensitive ("Pune(Moshi)" == "Pune (Moshi)"). */
export function nameKey(value) {
  const text = cleanText(value);
  if (!text) return null;
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ') // \p{M}: keep Devanagari vowel signs and virama
    .trim() || null;
}

function slugPart(value) {
  const key = nameKey(value) || '';
  const ascii = key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  // Non-Latin names keep a stable identity through a hash instead of collapsing to "".
  return ascii || `U${crypto.createHash('sha1').update(key).digest('hex').slice(0, 10).toUpperCase()}`;
}

/** Deterministic code (<= 64 chars). Parts are joined with "__" so boundaries never merge. */
export function makeCode(parts, maxLength = 64) {
  const full = parts.map(slugPart).join('__');
  if (full.length <= maxLength) return full;
  const hash = crypto.createHash('sha1').update(full).digest('hex').slice(0, 10).toUpperCase();
  return `${full.slice(0, maxLength - 11)}_${hash}`;
}

/**
 * Parses a reporting date. Supported formats:
 *   'ISO' -> YYYY-MM-DD (a trailing time part is ignored)
 *   'DMY' -> DD/MM/YYYY or DD-MM-YYYY (data.gov.in / Agmarknet convention)
 *   'AUTO'-> ISO when the year comes first, otherwise DMY. Never US month-first.
 * Returns YYYY-MM-DD, or null when the value is missing or not a real calendar date.
 */
export function normalizeDate(value, format = 'AUTO') {
  const text = cleanText(value);
  if (!text) return null;
  let year;
  let month;
  let day;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso && format !== 'DMY') [, year, month, day] = iso.map(Number);
  else if (dmy && format !== 'ISO') [, day, month, year] = dmy.map(Number);
  else return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parses a numeric field; returns { value, invalid } where value is null when missing. */
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? { value, invalid: false } : { value: null, invalid: true };
  const text = cleanText(value);
  if (!text) return { value: null, invalid: false };
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? { value: number, invalid: false } : { value: null, invalid: true };
}

export function normalizePriceUnit(unit) {
  const key = cleanText(unit)?.toLowerCase().replace(/\s+/g, '').replace('rupees', 'rs') ?? null;
  return key && PRICE_UNITS[key] !== undefined ? { unit: CANONICAL_PRICE_UNIT, factor: PRICE_UNITS[key] } : null;
}

export function normalizeArrivalUnit(unit) {
  const key = cleanText(unit)?.toLowerCase() ?? null;
  return key && ARRIVAL_UNITS[key] !== undefined ? { unit: CANONICAL_ARRIVAL_UNIT, factor: ARRIVAL_UNITS[key] } : null;
}

/** Commodity identity by exact (normalised) name; unknown names keep their own identity. */
export function normalizeCommodity(value) {
  const name = cleanText(value);
  const key = nameKey(value);
  if (!name || !key) return null;
  const knownCode = ALIAS_BY_KEY.get(key);
  if (knownCode) return { code: knownCode, ...COMMODITY_META[knownCode] };
  return { code: makeCode([name]), name, hindi: null, marathi: null, category: null };
}

/**
 * Finds the first known commodity mentioned in free text (English, Hindi or Marathi).
 * Whole-word / two-word matches against the exact alias table only -- no substring
 * matching, so "sweet potato" is not read as "potato". Returns the canonical code or null.
 */
export function detectCommodityCode(text) {
  const words = (nameKey(text) || '').split(' ').filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    const pair = ALIAS_BY_KEY.get(`${words[i]} ${words[i + 1] ?? ''}`.trim());
    if (words[i + 1] && pair) return pair;
    if (ALIAS_BY_KEY.has(words[i])) {
      // "sweet potato": a preceding qualifier means this is a different commodity.
      if (words[i - 1] === 'sweet') continue;
      return ALIAS_BY_KEY.get(words[i]);
    }
  }
  return null;
}

/** Market identity = (state, district, market). Returns null when any part is missing. */
export function normalizeMandi(market, district, state) {
  const name = cleanText(market);
  const districtName = cleanText(district);
  const stateName = cleanText(state);
  if (!name || !districtName || !stateName) return null;
  return { code: makeCode([stateName, districtName, name]), name, district: districtName, state: stateName };
}

const round2 = (value) => (value === null ? null : Math.round(value * 100) / 100);

/**
 * Normalises one provider record. Never throws: problems become quality flags,
 * and identity/unit/date problems leave the relevant canonical fields null so the
 * validator can reject the record with a clear reason.
 */
export function normalizeMandiRecord(record) {
  const flags = [];
  const commodity = normalizeCommodity(record.commodity_name ?? record.commodity);
  const mandi = normalizeMandi(record.mandi_name ?? record.market, record.district, record.state);
  if (!mandi) flags.push('MISSING_LOCATION');
  if (!commodity) flags.push('MISSING_COMMODITY');

  const priceDate = normalizeDate(record.price_date, record.date_format || 'AUTO');
  if (!priceDate) flags.push(cleanText(record.price_date) ? 'INVALID_DATE' : 'MISSING_DATE');

  const priceUnit = normalizePriceUnit(record.price_unit);
  if (!priceUnit) flags.push(cleanText(record.price_unit) ? 'UNKNOWN_PRICE_UNIT' : 'MISSING_PRICE_UNIT');
  if (record.price_unit_assumed) flags.push('PRICE_UNIT_FROM_PUBLISHER_CONVENTION');

  const prices = {};
  for (const field of ['min_price', 'max_price', 'modal_price']) {
    const parsed = parseNumber(record[field]);
    if (parsed.invalid) flags.push(`UNPARSEABLE_${field.toUpperCase()}`);
    let value = parsed.value;
    // Agmarknet publishes 0 where a min/max price was not reported.
    if (value === 0 && field !== 'modal_price') {
      flags.push(`ZERO_${field.toUpperCase()}_TREATED_AS_MISSING`);
      value = null;
    }
    if (value === null && !parsed.invalid) flags.push(`MISSING_${field.toUpperCase()}`);
    prices[field] = value !== null && priceUnit ? round2(value * priceUnit.factor) : null;
  }

  const arrivals = parseNumber(record.arrivals_quantity);
  if (arrivals.invalid) flags.push('UNPARSEABLE_ARRIVALS');
  let arrivalsQuantity = null;
  let arrivalUnit = null;
  if (arrivals.value !== null) {
    const unit = normalizeArrivalUnit(record.arrival_unit);
    if (unit) {
      arrivalsQuantity = round2(arrivals.value * unit.factor);
      arrivalUnit = unit.unit;
    } else {
      flags.push('UNKNOWN_ARRIVAL_UNIT'); // value kept in raw_payload only
    }
  }

  return {
    source: cleanText(record.source),
    is_sample_data: record.is_sample_data === true,
    source_record_key: cleanText(record.source_record_key),
    source_market_id: cleanText(record.source_market_id),
    source_commodity_id: cleanText(record.source_commodity_id),
    source_state_id: cleanText(record.source_state_id),
    source_district_id: cleanText(record.source_district_id),
    source_market_name: cleanText(record.mandi_name ?? record.market),
    source_commodity_name: cleanText(record.commodity_name ?? record.commodity),
    source_state_name: cleanText(record.state),
    source_district_name: cleanText(record.district),
    source_variety: cleanText(record.variety),
    source_grade: cleanText(record.grade),

    mandi_code: mandi?.code ?? null,
    mandi_name: mandi?.name ?? null,
    state: mandi?.state ?? null,
    district: mandi?.district ?? null,
    latitude: parseNumber(record.latitude).value,
    longitude: parseNumber(record.longitude).value,

    commodity_code: commodity?.code ?? null,
    commodity_name: commodity?.name ?? null,
    commodity_category: commodity?.category ?? null,
    commodity_hindi: commodity?.hindi ?? null,
    commodity_marathi: commodity?.marathi ?? null,

    variety: cleanText(record.variety),
    grade: cleanText(record.grade),
    price_date: priceDate,
    min_price: prices.min_price,
    max_price: prices.max_price,
    modal_price: prices.modal_price,
    price_unit: priceUnit?.unit ?? null,
    arrivals_quantity: arrivalsQuantity,
    arrival_unit: arrivalUnit,
    quality_flags: [...new Set([...(record.quality_flags || []), ...flags])],
    fetched_at: record.fetched_at || null,
    raw_payload: record.raw_payload ?? null,
  };
}

export default {
  cleanText,
  nameKey,
  makeCode,
  normalizeDate,
  parseNumber,
  normalizePriceUnit,
  normalizeArrivalUnit,
  normalizeCommodity,
  detectCommodityCode,
  normalizeMandi,
  normalizeMandiRecord,
};
