import crypto from 'node:crypto';

/**
 * Mandi canonical-field mapping (Phase 5, migration 007).
 *
 * Turns a NORMALISED record (see normalizer.js) into the additive canonical
 * columns introduced by `database/migrations/007_phase5_canonical_mandi.sql`:
 *   variety_code, state_code, district_code, market_code,
 *   commodity_category_code, source_dataset, content_hash, quality_status.
 *
 * This module is PURE: no database, no network, no clock. It only reads fields
 * the source itself published, plus values the caller explicitly passes in.
 *
 * NEVER GUESS
 * -----------
 * `variety_code`, `state_code`, `district_code` and `market_code` are SOURCE
 * identities. They are copied verbatim from the source-provided values the
 * normalizer preserved (`source_variety_code`, `source_state_id`,
 * `source_district_id`, `source_market_id`). A code is NEVER derived from a
 * display name: if the source did not publish a code, the canonical value stays
 * `null`. The canonical view is responsible for the one documented fallback
 * (`COALESCE(mp.market_code, m.code)`); this module deliberately does not do it,
 * because a synthetic name-derived code would masquerade as a source code.
 * The same rule applies to `commodity_category_code`: null unless the source
 * published `source_commodity_category_code`.
 */

/** Ordered canonical quality states. Matches the migration 007 CHECK constraint. */
export const CANONICAL_QUALITY_STATUSES = Object.freeze(['VALID', 'FLAGGED', 'REJECTED']);

// Kept in EXACT migration 007 order so a drift test can compare the two lists.
const CANONICAL_COLUMNS = Object.freeze([
  'variety_code',
  'state_code',
  'district_code',
  'market_code',
  'commodity_category_code',
  'source_dataset',
  'content_hash',
  'quality_status',
]);

/** The new canonical column names this module can produce, in migration order. */
export function canonicalColumns() {
  return [...CANONICAL_COLUMNS];
}

/**
 * The STABLE canonical tuple hashed by `content_hash`, in order:
 *
 *   1. source
 *   2. source_record_key
 *   3. mandi_code
 *   4. commodity_code
 *   5. price_date
 *   6. price_unit          (the NORMALIZED unit; canonical view: normalized_price_unit)
 *   7. modal_price
 *   8. min_price
 *   9. max_price
 *  10. arrivals_quantity
 *  11. arrival_unit
 *  12. variety
 *  13. grade
 *
 * The tuple is fixed here, so the hash is independent of object key order and
 * stable across runs. It intentionally excludes canonical codes so that adding a
 * source code later does not invalidate the bytes-equality proof of the values.
 */
export const CONTENT_HASH_FIELDS = Object.freeze([
  'source',
  'source_record_key',
  'mandi_code',
  'commodity_code',
  'price_date',
  'price_unit',
  'modal_price',
  'min_price',
  'max_price',
  'arrivals_quantity',
  'arrival_unit',
  'variety',
  'grade',
]);

// Unit separator: not expected inside the hashed identity/value fields.
const HASH_SEPARATOR = '\u001f';

/**
 * Type-tagged encoding so `null`, `0` and `''` can never collide:
 *   null / undefined / non-finite -> 'N'
 *   number                        -> '#<value>'
 *   boolean                       -> 'B<value>'
 *   everything else               -> 'S<value>'
 */
function encodeHashValue(value) {
  if (value === null || value === undefined) return 'N';
  if (typeof value === 'number') return Number.isFinite(value) ? `#${value}` : 'N';
  if (typeof value === 'boolean') return `B${value}`;
  return `S${String(value)}`;
}

/** Deterministic sha256 (hex) over CONTENT_HASH_FIELDS. */
export function computeContentHash(record) {
  const tuple = CONTENT_HASH_FIELDS.map((field) => encodeHashValue(record?.[field]));
  return crypto.createHash('sha256').update(tuple.join(HASH_SEPARATOR)).digest('hex');
}

/** Trims a source-provided code; blank stays null. Values are otherwise NOT rewritten. */
function sourceCode(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function flagsOf(record) {
  return Array.isArray(record?.quality_flags)
    ? record.quality_flags.filter((flag) => flag !== null && flag !== undefined && flag !== '')
    : [];
}

/**
 * Derives the canonical columns from a normalised record.
 *
 * @param {object} normalized normalised record (see normalizer.js)
 * @param {{ sourceDataset?: string|null, validation?: { valid?: boolean }, rejected?: boolean }} [options]
 *   `sourceDataset` overrides an inline `source_dataset`. `validation.valid === false`
 *   or `rejected === true` marks the record as REFUSED. A record can also be marked
 *   refused on itself via `rejected: true`, `validation_valid: false`,
 *   `quality_status: 'REJECTED'` or a `'REJECTED'` quality flag.
 * @returns {{ variety_code: string|null, state_code: string|null, district_code: string|null,
 *   market_code: string|null, commodity_category_code: string|null, source_dataset: string|null,
 *   quality_status: 'VALID'|'FLAGGED'|'REJECTED', content_hash: string }}
 */
export function deriveCanonicalFields(normalized = {}, options = {}) {
  const record = normalized && typeof normalized === 'object' ? normalized : {};
  const flags = flagsOf(record);

  const refused = options?.rejected === true
    || options?.validation?.valid === false
    || record.rejected === true
    || record.validation_valid === false
    || record.quality_status === 'REJECTED'
    || flags.includes('REJECTED');

  const qualityStatus = refused ? 'REJECTED' : (flags.length ? 'FLAGGED' : 'VALID');

  return {
    variety_code: sourceCode(record.source_variety_code ?? record.variety_code),
    state_code: sourceCode(record.source_state_id),
    district_code: sourceCode(record.source_district_id),
    market_code: sourceCode(record.source_market_id),
    commodity_category_code: sourceCode(record.source_commodity_category_code ?? record.commodity_category_code),
    source_dataset: sourceCode(options?.sourceDataset ?? record.source_dataset),
    quality_status: qualityStatus,
    content_hash: computeContentHash(record),
  };
}

export default {
  CANONICAL_QUALITY_STATUSES,
  CONTENT_HASH_FIELDS,
  canonicalColumns,
  computeContentHash,
  deriveCanonicalFields,
};
