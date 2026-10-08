/**
 * Mandi Data Normalizer
 * Standardizes commodity names, mandi names, units, and dates into consistent canonical formats.
 */

// Canonical Commodity Dictionary
const COMMODITY_MAP = {
  // Onion
  'onion': { code: 'ONION', name: 'Onion', hindi: 'प्याज', marathi: 'कांदा', category: 'Vegetables' },
  'kanda': { code: 'ONION', name: 'Onion', hindi: 'प्याज', marathi: 'कांदा', category: 'Vegetables' },
  'pyaaz': { code: 'ONION', name: 'Onion', hindi: 'प्याज', marathi: 'कांदा', category: 'Vegetables' },
  'कांदा': { code: 'ONION', name: 'Onion', hindi: 'प्याज', marathi: 'कांदा', category: 'Vegetables' },
  'प्याज': { code: 'ONION', name: 'Onion', hindi: 'प्याज', marathi: 'कांदा', category: 'Vegetables' },

  // Tomato
  'tomato': { code: 'TOMATO', name: 'Tomato', hindi: 'टमाटर', marathi: 'टोमॅटो', category: 'Vegetables' },
  'tamatar': { code: 'TOMATO', name: 'Tomato', hindi: 'टमाटर', marathi: 'टोमॅटो', category: 'Vegetables' },
  'टोमॅटो': { code: 'TOMATO', name: 'Tomato', hindi: 'टमाटर', marathi: 'टोमॅटो', category: 'Vegetables' },
  'टमाटर': { code: 'TOMATO', name: 'Tomato', hindi: 'टमाटर', marathi: 'टोमॅटो', category: 'Vegetables' },

  // Potato
  'potato': { code: 'POTATO', name: 'Potato', hindi: 'आलू', marathi: 'बटाटा', category: 'Vegetables' },
  'batata': { code: 'POTATO', name: 'Potato', hindi: 'आलू', marathi: 'बटाटा', category: 'Vegetables' },
  'aaloo': { code: 'POTATO', name: 'Potato', hindi: 'आलू', marathi: 'बटाटा', category: 'Vegetables' },
  'आलू': { code: 'POTATO', name: 'Potato', hindi: 'आलू', marathi: 'बटाटा', category: 'Vegetables' },
  'बटाटा': { code: 'POTATO', name: 'Potato', hindi: 'आलू', marathi: 'बटाटा', category: 'Vegetables' },

  // Soybean
  'soybean': { code: 'SOYBEAN', name: 'Soybean', hindi: 'सोयाबीन', marathi: 'सोयाबीन', category: 'Oilseeds' },
  'soyabean': { code: 'SOYBEAN', name: 'Soybean', hindi: 'सोयाबीन', marathi: 'सोयाबीन', category: 'Oilseeds' },
  'सोयाबीन': { code: 'SOYBEAN', name: 'Soybean', hindi: 'सोयाबीन', marathi: 'सोयाबीन', category: 'Oilseeds' },

  // Wheat
  'wheat': { code: 'WHEAT', name: 'Wheat', hindi: 'गेहूं', marathi: 'गहू', category: 'Grains' },
  'gehun': { code: 'WHEAT', name: 'Wheat', hindi: 'गेहूं', marathi: 'गहू', category: 'Grains' },
  'gahu': { code: 'WHEAT', name: 'Wheat', hindi: 'गेहूं', marathi: 'गहू', category: 'Grains' },
  'गेहूं': { code: 'WHEAT', name: 'Wheat', hindi: 'गेहूं', marathi: 'गहू', category: 'Grains' },
  'गहू': { code: 'WHEAT', name: 'Wheat', hindi: 'गेहूं', marathi: 'गहू', category: 'Grains' },

  // Cotton
  'cotton': { code: 'COTTON', name: 'Cotton', hindi: 'कपास', marathi: 'कापूस', category: 'Fibers' },
  'kapas': { code: 'COTTON', name: 'Cotton', hindi: 'कपास', marathi: 'कापूस', category: 'Fibers' },
  'kapus': { code: 'COTTON', name: 'Cotton', hindi: 'कपास', marathi: 'कापूस', category: 'Fibers' },
  'कपास': { code: 'COTTON', name: 'Cotton', hindi: 'कपास', marathi: 'कापूस', category: 'Fibers' },
  'कापूस': { code: 'COTTON', name: 'Cotton', hindi: 'कपास', marathi: 'कापूस', category: 'Fibers' },
};

// Canonical Mandi Dictionary
const MANDI_MAP = {
  'pune apmc (gultekdi)': { code: 'MH_PUNE_APMC', name: 'Pune APMC (Gultekdi)', district: 'Pune', state: 'Maharashtra', lat: 18.4967, lon: 73.8647 },
  'pune': { code: 'MH_PUNE_APMC', name: 'Pune APMC (Gultekdi)', district: 'Pune', state: 'Maharashtra', lat: 18.4967, lon: 73.8647 },
  'pune apmc': { code: 'MH_PUNE_APMC', name: 'Pune APMC (Gultekdi)', district: 'Pune', state: 'Maharashtra', lat: 18.4967, lon: 73.8647 },
  'pune market yard': { code: 'MH_PUNE_APMC', name: 'Pune APMC (Gultekdi)', district: 'Pune', state: 'Maharashtra', lat: 18.4967, lon: 73.8647 },
  'gultekdi': { code: 'MH_PUNE_APMC', name: 'Pune APMC (Gultekdi)', district: 'Pune', state: 'Maharashtra', lat: 18.4967, lon: 73.8647 },

  'nashik market yard': { code: 'MH_NSK_MAIN', name: 'Nashik Market Yard', district: 'Nashik', state: 'Maharashtra', lat: 19.9975, lon: 73.7898 },
  'nashik': { code: 'MH_NSK_MAIN', name: 'Nashik Market Yard', district: 'Nashik', state: 'Maharashtra', lat: 19.9975, lon: 73.7898 },
  'nashik apmc': { code: 'MH_NSK_MAIN', name: 'Nashik Market Yard', district: 'Nashik', state: 'Maharashtra', lat: 19.9975, lon: 73.7898 },
  'nasik': { code: 'MH_NSK_MAIN', name: 'Nashik Market Yard', district: 'Nashik', state: 'Maharashtra', lat: 19.9975, lon: 73.7898 },

  'ahmednagar mandi': { code: 'MH_AHM_APMC', name: 'Ahmednagar Mandi', district: 'Ahmednagar', state: 'Maharashtra', lat: 19.0952, lon: 74.7480 },
  'ahmednagar': { code: 'MH_AHM_APMC', name: 'Ahmednagar Mandi', district: 'Ahmednagar', state: 'Maharashtra', lat: 19.0952, lon: 74.7480 },
  'ahmednagar apmc': { code: 'MH_AHM_APMC', name: 'Ahmednagar Mandi', district: 'Ahmednagar', state: 'Maharashtra', lat: 19.0952, lon: 74.7480 },
  'ahmadnagar': { code: 'MH_AHM_APMC', name: 'Ahmednagar Mandi', district: 'Ahmednagar', state: 'Maharashtra', lat: 19.0952, lon: 74.7480 },

  'baramati apmc': { code: 'MH_BAR_APMC', name: 'Baramati APMC', district: 'Pune', state: 'Maharashtra', lat: 18.1519, lon: 74.5772 },
  'baramati': { code: 'MH_BAR_APMC', name: 'Baramati APMC', district: 'Pune', state: 'Maharashtra', lat: 18.1519, lon: 74.5772 },

  'mumbai apmc (vashi)': { code: 'MH_MUM_VASHI', name: 'Mumbai APMC (Vashi)', district: 'Thane', state: 'Maharashtra', lat: 19.0771, lon: 72.9986 },
  'vashi apmc': { code: 'MH_MUM_VASHI', name: 'Mumbai APMC (Vashi)', district: 'Thane', state: 'Maharashtra', lat: 19.0771, lon: 72.9986 },
  'mumbai apmc': { code: 'MH_MUM_VASHI', name: 'Mumbai APMC (Vashi)', district: 'Thane', state: 'Maharashtra', lat: 19.0771, lon: 72.9986 },
  'mumbai': { code: 'MH_MUM_VASHI', name: 'Mumbai APMC (Vashi)', district: 'Thane', state: 'Maharashtra', lat: 19.0771, lon: 72.9986 },

  'lasalgaon apmc': { code: 'MH_NSK_LASALGAON', name: 'Lasalgaon APMC', district: 'Nashik', state: 'Maharashtra', lat: 20.1472, lon: 74.2289 },
  'lasalgaon': { code: 'MH_NSK_LASALGAON', name: 'Lasalgaon APMC', district: 'Nashik', state: 'Maharashtra', lat: 20.1472, lon: 74.2289 },
};

/**
 * Normalizes date string to YYYY-MM-DD
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();

  // Handle DD/MM/YYYY or DD-MM-YYYY
  const parts = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (parts) {
    const day = parts[1].padStart(2, '0');
    const month = parts[2].padStart(2, '0');
    const year = parts[3];
    return `${year}-${month}-${day}`;
  }

  // Handle ISO or standard formats
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return str;
}

/**
 * Normalizes commodity metadata
 */
export function normalizeCommodity(commodityInput) {
  if (!commodityInput) return null;
  const clean = String(commodityInput).trim().toLowerCase();

  // Try direct match or key lookup
  for (const [key, meta] of Object.entries(COMMODITY_MAP)) {
    if (clean === key || clean.includes(key)) {
      return meta;
    }
  }

  // Fallback generation for unknown commodities
  const formattedName = clean.charAt(0).toUpperCase() + clean.slice(1);
  const code = clean.replace(/[^a-z0-9]/gi, '_').toUpperCase();
  return {
    code,
    name: formattedName,
    hindi: formattedName,
    marathi: formattedName,
    category: 'General',
  };
}

/**
 * Normalizes mandi identity & location
 */
export function normalizeMandi(mandiInput, fallbackDistrict = 'Unknown', fallbackState = 'Maharashtra') {
  if (!mandiInput) return null;
  const clean = String(mandiInput).trim().toLowerCase();

  for (const [key, meta] of Object.entries(MANDI_MAP)) {
    if (clean === key || clean.includes(key)) {
      return meta;
    }
  }

  // Fallback generation
  const formattedName = mandiInput.trim();
  const district = fallbackDistrict.trim();
  const state = fallbackState.trim();
  const code = `${state.slice(0, 2).toUpperCase()}_${district.slice(0, 3).toUpperCase()}_${clean.replace(/[^a-z0-9]/gi, '_').toUpperCase().slice(0, 10)}`;

  return {
    code,
    name: formattedName,
    district,
    state,
    lat: null,
    lon: null,
  };
}

/**
 * Normalizes a complete mandi price record
 */
export function normalizeMandiRecord(record) {
  const normCommodity = normalizeCommodity(record.commodity_name || record.commodity_code);
  const normMandi = normalizeMandi(record.mandi_name || record.market, record.district, record.state);
  const normDate = normalizeDate(record.price_date);

  let unit = (record.unit || 'quintal').toLowerCase();
  let minPrice = Number(record.min_price);
  let maxPrice = Number(record.max_price);
  let modalPrice = Number(record.modal_price);
  let arrivals = Number(record.arrivals_quantity || 0);

  // Standardize units to 'quintal'
  if (unit === 'kg' || unit === 'kilogram') {
    // 1 quintal = 100 kg
    minPrice = minPrice * 100;
    maxPrice = maxPrice * 100;
    modalPrice = modalPrice * 100;
    arrivals = arrivals / 100;
    unit = 'quintal';
  } else if (unit === 'ton' || unit === 'tonne' || unit === 'mt') {
    // 1 ton = 10 quintals
    minPrice = minPrice / 10;
    maxPrice = maxPrice / 10;
    modalPrice = modalPrice / 10;
    arrivals = arrivals * 10;
    unit = 'quintal';
  } else {
    unit = 'quintal';
  }

  return {
    mandi_code: normMandi.code,
    mandi_name: normMandi.name,
    district: normMandi.district,
    state: normMandi.state,
    latitude: normMandi.lat !== undefined ? normMandi.lat : record.latitude || null,
    longitude: normMandi.lon !== undefined ? normMandi.lon : record.longitude || null,
    commodity_code: normCommodity.code,
    commodity_name: normCommodity.name,
    commodity_category: normCommodity.category,
    price_date: normDate,
    min_price: Number(minPrice.toFixed(2)),
    max_price: Number(maxPrice.toFixed(2)),
    modal_price: Number(modalPrice.toFixed(2)),
    arrivals_quantity: Number(arrivals.toFixed(2)),
    unit,
    variety: record.variety ? String(record.variety).trim() : 'Standard',
    grade: record.grade ? String(record.grade).trim() : 'FAQ',
    source: record.source || 'UNKNOWN',
    is_sample_data: Boolean(record.is_sample_data),
    raw_payload: record.raw_payload || null,
  };
}

export default {
  normalizeDate,
  normalizeCommodity,
  normalizeMandi,
  normalizeMandiRecord,
};
