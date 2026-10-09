import { pool as defaultPool } from '../db.js';
import { CONFLICT_TOLERANCE, observationKey, valueSignature } from './deduplicator.js';
import { deriveCanonicalFields } from './canonical.js';

/**
 * Mandi Data Persister
 *
 * - Each record is written inside its own SAVEPOINT: a bad row is rolled back
 *   alone and reported; it can no longer undo earlier rows while counts claim success.
 * - Counts are returned only after COMMIT succeeds, and are cross-checked against
 *   the rows that actually carry this run's id.
 * - Re-imports are idempotent: identical values are counted as "unchanged".
 * - A changed value from the same source is stored with its previous version in
 *   mandi_price_revisions (audit trail) before the row is updated.
 * - Sample (MOCK) rows are refused unless explicitly allowed.
 * - Phase 5 (migration 007) adds the canonical columns via deriveCanonicalFields.
 *
 * TWO UNIQUE RULES (Phase 5)
 * -------------------------
 * `mandi_prices` now has two unique rules:
 *   uq_mandi_prices_observation    (source, mandi_id, commodity_id, price_date, variety, grade)
 *   uq_mandi_prices_source_record  partial UNIQUE (source, source_record_key)
 * A single INSERT can only target one ON CONFLICT clause, so the INSERT targets
 * the OBSERVATION constraint (the primary idempotency rule, matching the SELECT
 * ... FOR UPDATE performed first). The source-record index stays as an integrity
 * GUARD: if the same source record was already stored under a different
 * observation identity, PostgreSQL raises 23505 on
 * `uq_mandi_prices_source_record`. That is expected — the batch classifies the
 * row as `skipped` (see `skipped` / `skippedRecords` counters) instead of
 * aborting. Every other error still fails the row and is reported.
 */

export class SampleDataWriteError extends Error {
  constructor() {
    super('Refusing to write sample (MOCK) records: set MANDI_ALLOW_SAMPLE_DATA=true in an isolated test environment only.');
    this.code = 'SAMPLE_DATA_WRITE_REFUSED';
  }
}

export class PersistenceIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PERSISTENCE_COUNT_MISMATCH';
  }
}

const PRICE_FIELDS = ['min_price', 'max_price', 'modal_price', 'arrivals_quantity', 'price_unit', 'arrival_unit'];
const numericOrNull = (value) => (value === null || value === undefined ? null : Number(value));
const sameValue = (a, b) => (a === null || a === undefined ? null : String(Number.isFinite(Number(a)) ? Number(a) : a))
  === (b === null || b === undefined ? null : String(Number.isFinite(Number(b)) ? Number(b) : b));

// Never let database error text (which can contain values) grow without bound in logs.
const safeMessage = (err) => String(err?.message || err).slice(0, 300);

/**
 * True only for a 23505 raised by the Phase 5 partial index
 * `uq_mandi_prices_source_record`. Matched by name so unrelated unique
 * violations are never silently accepted.
 */
export function isDuplicateSourceRecordError(err) {
  if (!err || err.code !== '23505') return false;
  const constraint = String(err.constraint || '');
  const message = String(err.message || '');
  return constraint === 'uq_mandi_prices_source_record'
    || message.includes('uq_mandi_prices_source_record');
}

export class MandiPersister {
  constructor({ pool = defaultPool, allowSampleData = false, conflictTolerance = CONFLICT_TOLERANCE } = {}) {
    this.pool = pool;
    this.allowSampleData = allowSampleData;
    this.conflictTolerance = conflictTolerance;
  }

  async #ensureMandi(client, record, cache) {
    if (cache.has(record.mandi_code)) return cache.get(record.mandi_code);
    // Existing mandis are never renamed or relocated by a later import.
    const res = await client.query(
      `INSERT INTO mandis (code, name, state, district, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET updated_at = mandis.updated_at
       RETURNING id`,
      [record.mandi_code, record.mandi_name, record.state, record.district, record.latitude, record.longitude]
    );
    return res.rows[0].id;
  }

  async #ensureCommodity(client, record, cache) {
    if (cache.has(record.commodity_code)) return cache.get(record.commodity_code);
    const res = await client.query(
      `INSERT INTO commodities (code, name, hindi_name, marathi_name, category, standard_unit)
       VALUES ($1, $2, $3, $4, $5, 'quintal')
       ON CONFLICT (code) DO UPDATE SET updated_at = commodities.updated_at
       RETURNING id`,
      [record.commodity_code, record.commodity_name, record.commodity_hindi, record.commodity_marathi, record.commodity_category]
    );
    return res.rows[0].id;
  }

  async #upsertPrice(client, record, mandiId, commodityId, runId) {
    const canonical = deriveCanonicalFields(record);
    const existing = await client.query(
      `SELECT id, min_price, max_price, modal_price, arrivals_quantity, price_unit, arrival_unit
       FROM mandi_prices
       WHERE source = $1 AND mandi_id = $2 AND commodity_id = $3 AND price_date = $4
         AND variety IS NOT DISTINCT FROM $5 AND grade IS NOT DISTINCT FROM $6
       FOR UPDATE`,
      [record.source, mandiId, commodityId, record.price_date, record.variety, record.grade]
    );

    if (existing.rowCount === 0) {
      const res = await client.query(
        `INSERT INTO mandi_prices (
           mandi_id, commodity_id, price_date, min_price, max_price, modal_price,
           arrivals_quantity, unit, price_unit, arrival_unit, variety, grade, source, is_sample_data,
           source_record_key, source_market_id, source_commodity_id, source_state_id, source_district_id,
           source_market_name, source_commodity_name, source_state_name, source_district_name,
           source_variety, source_grade,
           variety_code, state_code, district_code, market_code, commodity_category_code, source_dataset, content_hash, quality_status,
           quality_flags, raw_payload, fetched_at, last_seen_at, ingestion_run_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'quintal',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
                   $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
                   COALESCE($35::timestamptz, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, $36)
         ON CONFLICT ON CONSTRAINT uq_mandi_prices_observation DO NOTHING
         RETURNING id`,
        [
          mandiId, commodityId, record.price_date, record.min_price, record.max_price, record.modal_price,
          record.arrivals_quantity, record.price_unit, record.arrival_unit, record.variety, record.grade,
          record.source, record.is_sample_data,
          record.source_record_key, record.source_market_id, record.source_commodity_id, record.source_state_id,
          record.source_district_id, record.source_market_name, record.source_commodity_name, record.source_state_name,
          record.source_district_name, record.source_variety, record.source_grade,
          canonical.variety_code, canonical.state_code, canonical.district_code, canonical.market_code,
          canonical.commodity_category_code, canonical.source_dataset, canonical.content_hash, canonical.quality_status,
          record.quality_flags || [],
          record.raw_payload === null || record.raw_payload === undefined ? null : JSON.stringify(record.raw_payload),
          record.fetched_at, runId,
        ]
      );
      // ON CONFLICT DO NOTHING: a concurrent writer stored this observation first.
      if (res.rowCount === 0) return { outcome: 'unchanged', id: null };
      return { outcome: 'inserted', id: res.rows[0].id };
    }

    const row = existing.rows[0];
    const changed = PRICE_FIELDS.some((field) => !sameValue(row[field], record[field]));
    if (!changed) {
      await client.query('UPDATE mandi_prices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);
      return { outcome: 'unchanged', id: row.id };
    }

    const previous = Object.fromEntries(PRICE_FIELDS.map((f) => [f, row[f] === null ? null : (f.endsWith('unit') ? row[f] : Number(row[f]))]));
    const next = Object.fromEntries(PRICE_FIELDS.map((f) => [f, f.endsWith('unit') ? record[f] : numericOrNull(record[f])]));
    await client.query(
      `INSERT INTO mandi_price_revisions (price_id, ingestion_run_id, previous_values, new_values)
       VALUES ($1, $2, $3, $4)`,
      [row.id, runId, JSON.stringify(previous), JSON.stringify(next)]
    );
    await client.query(
      `UPDATE mandi_prices SET
         min_price = $2, max_price = $3, modal_price = $4, arrivals_quantity = $5,
         price_unit = $6, arrival_unit = $7,
         variety_code = $8, state_code = $9, district_code = $10, market_code = $11,
         commodity_category_code = $12, source_dataset = $13, content_hash = $14, quality_status = $15,
         quality_flags = $16,
         raw_payload = $17, fetched_at = COALESCE($18::timestamptz, CURRENT_TIMESTAMP),
         last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, ingestion_run_id = $19
       WHERE id = $1`,
      [
        row.id, record.min_price, record.max_price, record.modal_price, record.arrivals_quantity,
        record.price_unit, record.arrival_unit,
        canonical.variety_code, canonical.state_code, canonical.district_code, canonical.market_code,
        canonical.commodity_category_code, canonical.source_dataset, canonical.content_hash, canonical.quality_status,
        record.quality_flags || [],
        record.raw_payload === null || record.raw_payload === undefined ? null : JSON.stringify(record.raw_payload),
        record.fetched_at, runId,
      ]
    );
    return { outcome: 'updated', id: row.id };
  }

  /** Records same-source conflicts found by the deduplicator (all versions kept in details). */
  async #recordBatchConflicts(client, conflicts, runId) {
    let stored = 0;
    for (const conflict of conflicts || []) {
      const versions = [...(conflict.discarded || []), conflict.kept].filter(Boolean);
      const key = `SB:${conflict.key}:${versions.map(valueSignature).join('~')}`.slice(0, 400);
      const res = await client.query(
        `INSERT INTO mandi_price_conflicts (conflict_key, conflict_type, price_date, source_a, source_b,
           modal_price_a, modal_price_b, details, ingestion_run_id)
         VALUES ($1, 'SAME_SOURCE_CONFLICT', $2, $3, $3, $4, $5, $6, $7)
         ON CONFLICT (conflict_key) DO NOTHING`,
        [
          key, conflict.kept?.price_date ?? null, conflict.source,
          versions[0]?.modal_price ?? null, conflict.kept?.modal_price ?? null,
          JSON.stringify({
            observation: conflict.key,
            resolution: 'latest report in source order kept',
            versions: versions.map((v) => ({ ...Object.fromEntries(PRICE_FIELDS.map((f) => [f, v[f] ?? null])), raw_payload: v.raw_payload ?? null })),
          }),
          runId,
        ]
      );
      stored += res.rowCount;
    }
    return stored;
  }

  /** Detects cross-source disagreements for the market-days touched by this batch. */
  async #detectCrossSourceConflicts(client, priceIds, runId) {
    if (!priceIds.length) return 0;
    const res = await client.query(
      `WITH touched AS (
         SELECT DISTINCT mandi_id, commodity_id, price_date FROM mandi_prices WHERE id = ANY($1::int[])
       ), rows AS (
         SELECT mp.*, COUNT(*) OVER (PARTITION BY mp.mandi_id, mp.commodity_id, mp.price_date, mp.source) AS rows_in_source
         FROM mandi_prices mp JOIN touched t USING (mandi_id, commodity_id, price_date)
       ), pairs AS (
         SELECT a.id AS id_a, b.id AS id_b, a.mandi_id, a.commodity_id, a.price_date,
                a.source AS source_a, b.source AS source_b, a.modal_price AS modal_a, b.modal_price AS modal_b,
                a.variety AS variety_a, b.variety AS variety_b
         FROM rows a JOIN rows b
           ON a.mandi_id = b.mandi_id AND a.commodity_id = b.commodity_id AND a.price_date = b.price_date
          AND a.source < b.source
         WHERE (lower(a.variety) IS NOT DISTINCT FROM lower(b.variety))
            OR (a.variety IS NULL AND b.rows_in_source = 1)
            OR (b.variety IS NULL AND a.rows_in_source = 1)
       )
       INSERT INTO mandi_price_conflicts (conflict_key, conflict_type, mandi_id, commodity_id, price_date,
         price_id_a, price_id_b, source_a, source_b, modal_price_a, modal_price_b, details, ingestion_run_id)
       SELECT 'XS:' || id_a || ':' || id_b || ':' || modal_a || ':' || modal_b, 'CROSS_SOURCE_CONFLICT',
              mandi_id, commodity_id, price_date, id_a, id_b, source_a, source_b, modal_a, modal_b,
              jsonb_build_object('variety_a', variety_a, 'variety_b', variety_b, 'tolerance', $2::numeric,
                                 'resolution', 'both rows kept; mandi_prices_resolved uses source precedence'),
              $3
       FROM pairs
       WHERE abs(modal_a - modal_b) / GREATEST(LEAST(modal_a, modal_b), 1) > $2::numeric
       ON CONFLICT (conflict_key) DO NOTHING`,
      [priceIds, this.conflictTolerance, runId]
    );
    return res.rowCount;
  }

  /**
   * Persists normalised, validated, de-duplicated records in one transaction.
   * Existing counter names/meanings are unchanged; `skipped` / `skippedRecords`
   * are additive and cover only a duplicate (source, source_record_key).
   * @returns {Promise<{inserted:number, updated:number, unchanged:number, skipped:number,
   *   failed:number, conflicts:number, errors:Array<{key:string, message:string}>,
   *   skippedRecords:Array<{key:string, reason:string}>}>}
   */
  async persistBatch(records, { runId = null, batchConflicts = [] } = {}) {
    const result = { inserted: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, conflicts: 0, errors: [], skippedRecords: [] };
    if ((!records || records.length === 0) && !batchConflicts.length) return result;
    if (!this.allowSampleData && (records || []).some((r) => r.is_sample_data)) throw new SampleDataWriteError();

    const client = await this.pool.connect();
    const mandiIds = new Map();
    const commodityIds = new Map();
    const touched = [];
    try {
      await client.query('BEGIN');
      for (const record of records || []) {
        await client.query('SAVEPOINT record_write');
        try {
          const mandiId = await this.#ensureMandi(client, record, mandiIds);
          const commodityId = await this.#ensureCommodity(client, record, commodityIds);
          const { outcome, id } = await this.#upsertPrice(client, record, mandiId, commodityId, runId);
          await client.query('RELEASE SAVEPOINT record_write');
          // Ids are cached only after the savepoint is released, so a rolled-back
          // insert can never leave a dangling id behind.
          mandiIds.set(record.mandi_code, mandiId);
          commodityIds.set(record.commodity_code, commodityId);
          result[outcome] += 1;
          if (outcome !== 'unchanged') touched.push(id);
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT record_write');
          if (isDuplicateSourceRecordError(err)) {
            // Expected Phase 5 outcome: this source record is already stored under a
            // different observation identity. Roll the row back alone and count it.
            result.skipped += 1;
            result.skippedRecords.push({ key: observationKey(record), reason: 'SOURCE_RECORD_ALREADY_STORED' });
          } else {
            result.failed += 1;
            result.errors.push({ key: observationKey(record), message: safeMessage(err) });
          }
        }
      }
      result.conflicts += await this.#recordBatchConflicts(client, batchConflicts, runId);
      result.conflicts += await this.#detectCrossSourceConflicts(client, touched, runId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Cross-check: rows written by this run must exist after commit.
    if (runId !== null && result.inserted + result.updated > 0) {
      const check = await this.pool.query('SELECT COUNT(*)::int AS n FROM mandi_prices WHERE ingestion_run_id = $1', [runId]);
      if (check.rows[0].n < result.inserted + result.updated) {
        throw new PersistenceIntegrityError(
          `Run ${runId} reported ${result.inserted + result.updated} written rows but ${check.rows[0].n} are committed`
        );
      }
    }
    return result;
  }
}

export default MandiPersister;
