/**
 * Mandi Data Deduplicator
 *
 * Within a source: identical observations are collapsed; DIFFERENT values for the
 * same observation key are a conflict. The last occurrence in source order is
 * kept (deterministic) and every discarded version is returned for the audit trail.
 *
 * Across sources: records are never dropped here. Every source keeps its own row
 * (provenance), overlaps are reported, and downstream queries use the
 * mandi_prices_resolved view so a market-day is never counted twice.
 */

// Higher wins when two sources report the same market, commodity and day.
export const SOURCE_PRECEDENCE = {
  DATA_GOV_IN: 40,
  CEDA: 30,
  MOCK_PROVIDER: 0,
};

// Modal prices within this relative difference are treated as the same report.
export const CONFLICT_TOLERANCE = 0.005;

export function getSourcePrecedence(source) {
  return SOURCE_PRECEDENCE[String(source || '').toUpperCase()] ?? 10;
}

const lower = (value) => (value === null || value === undefined ? '' : String(value).toLowerCase());

/** Identity of one source observation (matches the database unique key). */
export function observationKey(record) {
  return [record.source, record.mandi_code, record.commodity_code, record.price_date, lower(record.variety), lower(record.grade)].join('|');
}

/** Values that must agree for two reports of the same observation to be identical. */
export function valueSignature(record) {
  return [record.min_price, record.max_price, record.modal_price, record.arrivals_quantity, record.price_unit, record.arrival_unit]
    .map((value) => (value === null || value === undefined ? '' : String(value)))
    .join('|');
}

export function pricesDiffer(a, b, tolerance = CONFLICT_TOLERANCE) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return x !== y;
  return Math.abs(x - y) / Math.max(Math.min(x, y), 1) > tolerance;
}

/**
 * @returns {{ uniqueRecords: object[], duplicatesCount: number, conflicts: object[] }}
 */
export function deduplicateWithinSource(records) {
  if (!Array.isArray(records)) return { uniqueRecords: [], duplicatesCount: 0, conflicts: [] };
  const byKey = new Map();
  const conflictsByKey = new Map();
  let duplicatesCount = 0;

  for (const record of records) {
    const key = observationKey(record);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, record);
      continue;
    }
    duplicatesCount += 1;
    if (valueSignature(existing) !== valueSignature(record)) {
      const conflict = conflictsByKey.get(key) || { type: 'SAME_SOURCE_CONFLICT', key, source: record.source, versions: [existing] };
      conflict.versions.push(record);
      conflictsByKey.set(key, conflict);
    }
    // Keep the latest report in source order; earlier versions stay in the conflict record.
    byKey.set(key, record);
  }

  const conflicts = [...conflictsByKey.values()].map((conflict) => ({
    ...conflict,
    kept: byKey.get(conflict.key),
    discarded: conflict.versions.slice(0, -1),
  }));
  return { uniqueRecords: [...byKey.values()], duplicatesCount, conflicts };
}

/**
 * Groups records that describe the same market, commodity and day in DIFFERENT sources.
 * Nothing is removed. Each overlap is classified:
 *   CROSS_SOURCE_MATCH       values agree (within tolerance) — resolved view keeps one
 *   CROSS_SOURCE_CONFLICT    comparable observations disagree — needs review
 *   GRANULARITY_MISMATCH     one source is variety-level with several varieties, the other is not
 */
export function findCrossSourceOverlaps(records, tolerance = CONFLICT_TOLERANCE) {
  const groups = new Map();
  for (const record of records || []) {
    const key = [record.mandi_code, record.commodity_code, record.price_date].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const overlaps = [];
  for (const [key, group] of groups) {
    const sources = [...new Set(group.map((r) => r.source))].sort();
    if (sources.length < 2) continue;
    const bySource = sources.map((source) => group.filter((r) => r.source === source));
    let type = 'CROSS_SOURCE_MATCH';
    for (let i = 0; i < bySource.length; i += 1) {
      for (let j = i + 1; j < bySource.length; j += 1) {
        const a = bySource[i];
        const b = bySource[j];
        const comparable = [];
        for (const x of a) {
          for (const y of b) {
            const sameVariety = lower(x.variety) === lower(y.variety);
            const oneUnspecified = (!x.variety && b.length === 1) || (!y.variety && a.length === 1);
            if (sameVariety || oneUnspecified) comparable.push([x, y]);
          }
        }
        if (comparable.length === 0) {
          if (type === 'CROSS_SOURCE_MATCH') type = 'GRANULARITY_MISMATCH';
        } else if (comparable.some(([x, y]) => pricesDiffer(x.modal_price, y.modal_price, tolerance))) {
          type = 'CROSS_SOURCE_CONFLICT';
        }
      }
    }
    overlaps.push({ type, key, sources, records: group });
  }
  return overlaps;
}

/**
 * Backwards-compatible entry point used by the pipeline.
 * crossSource=true additionally reports overlaps; it never discards records.
 */
export function deduplicateRecords(records, options = {}) {
  const result = deduplicateWithinSource(records);
  return options.crossSource ? { ...result, overlaps: findCrossSourceOverlaps(result.uniqueRecords) } : { ...result, overlaps: [] };
}

export default {
  SOURCE_PRECEDENCE,
  CONFLICT_TOLERANCE,
  getSourcePrecedence,
  observationKey,
  valueSignature,
  pricesDiffer,
  deduplicateWithinSource,
  findCrossSourceOverlaps,
  deduplicateRecords,
};
