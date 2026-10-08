/**
 * Mandi Data Deduplicator
 * Provides within-source and cross-source deduplication algorithms based on natural composite keys.
 */

export const SOURCE_PRIORITY = {
  DATA_GOV_IN: 40,
  AGMARKNET: 40,
  CEDA: 30,
  MOCK: 10,
};

function getSourcePriority(source) {
  if (!source) return 0;
  const upper = String(source).toUpperCase();
  return SOURCE_PRIORITY[upper] || 20;
}

/**
 * Within-source deduplication:
 * Filters duplicate records from the same source sharing identical
 * (mandi_code, commodity_code, price_date, variety, source).
 * In case of collision, prefers record with higher arrivals volume, then higher modal price.
 *
 * @param {Array<Object>} records
 * @returns {{ uniqueRecords: Array<Object>, duplicatesCount: number }}
 */
export function deduplicateWithinSource(records) {
  if (!Array.isArray(records)) {
    return { uniqueRecords: [], duplicatesCount: 0 };
  }

  const map = new Map();
  let duplicatesCount = 0;

  for (const record of records) {
    const key = [
      record.mandi_code || '',
      record.commodity_code || '',
      record.price_date || '',
      record.variety || 'Standard',
      record.source || '',
    ].join('::').toLowerCase();

    if (map.has(key)) {
      duplicatesCount++;
      const existing = map.get(key);
      const newArrivals = Number(record.arrivals_quantity) || 0;
      const oldArrivals = Number(existing.arrivals_quantity) || 0;
      if (
        newArrivals > oldArrivals ||
        (newArrivals === oldArrivals && Number(record.modal_price) > Number(existing.modal_price))
      ) {
        map.set(key, record);
      }
    } else {
      map.set(key, record);
    }
  }

  return {
    uniqueRecords: Array.from(map.values()),
    duplicatesCount,
  };
}

/**
 * Cross-source deduplication:
 * Filters conflicting records across different sources sharing identical
 * (mandi_code, commodity_code, price_date, variety).
 * Resolves conflicts using source priority hierarchy:
 * Live Government (DATA_GOV_IN / AGMARKNET) > Cleaned Historical (CEDA) > Development Mock (MOCK).
 *
 * @param {Array<Object>} records
 * @returns {{ uniqueRecords: Array<Object>, duplicatesCount: number }}
 */
export function deduplicateCrossSource(records) {
  if (!Array.isArray(records)) {
    return { uniqueRecords: [], duplicatesCount: 0 };
  }

  const map = new Map();
  let duplicatesCount = 0;

  for (const record of records) {
    const key = [
      record.mandi_code || '',
      record.commodity_code || '',
      record.price_date || '',
      record.variety || 'Standard',
    ].join('::').toLowerCase();

    if (map.has(key)) {
      duplicatesCount++;
      const existing = map.get(key);
      const newPrio = getSourcePriority(record.source);
      const oldPrio = getSourcePriority(existing.source);

      if (newPrio > oldPrio) {
        map.set(key, record);
      } else if (newPrio === oldPrio) {
        const newArrivals = Number(record.arrivals_quantity) || 0;
        const oldArrivals = Number(existing.arrivals_quantity) || 0;
        if (
          newArrivals > oldArrivals ||
          (newArrivals === oldArrivals && Number(record.modal_price) > Number(existing.modal_price))
        ) {
          map.set(key, record);
        }
      }
    } else {
      map.set(key, record);
    }
  }

  return {
    uniqueRecords: Array.from(map.values()),
    duplicatesCount,
  };
}

/**
 * Deduplicates records using specified strategy.
 * @param {Array<Object>} records
 * @param {Object} options - { crossSource: boolean }
 */
export function deduplicateRecords(records, options = {}) {
  if (options.crossSource) {
    return deduplicateCrossSource(records);
  }
  return deduplicateWithinSource(records);
}

export default {
  deduplicateRecords,
  deduplicateWithinSource,
  deduplicateCrossSource,
  SOURCE_PRIORITY,
};
