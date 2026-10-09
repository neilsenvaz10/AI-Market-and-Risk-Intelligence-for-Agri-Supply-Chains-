import { pool as defaultPool } from '../db.js';
import { config } from '../config/index.js';

/**
 * Market Service — read-only Phase 5 API over the canonical mandi-price model.
 *
 * Every query reads `mandi_prices_canonical` (migration 007), which exposes one
 * vocabulary for every source: reported_date = price_date, minimum_price =
 * min_price, original_price_unit = unit as published, normalized_price_unit =
 * price_unit (always INR/quintal). Reading the view (never the raw table) means
 * commodity/state/district/mandi names, source_label and source_precedence come
 * from the same joins everywhere, so two endpoints can never disagree.
 *
 * Nothing here writes, and every value coming from a caller is bound as a query
 * parameter — no user input is ever interpolated into SQL text.
 */

const MS_PER_DAY = 86_400_000;
/** A market feed older than this many days is reported as stale. */
export const STALE_AFTER_DAYS = 3;

/**
 * Columns every price row exposes. Chosen so each row is self-describing:
 * prices + both units, the reporting date, source provenance, quality state,
 * variety/grade and the full geography.
 */
const PRICE_COLUMNS = `
  observation_id, source, source_dataset, source_record_id, source_label, source_precedence,
  commodity_id, commodity_code, commodity, commodity_category,
  mandi_id, mandi, market_code, state, state_code, district, district_code,
  variety, variety_code, grade,
  reported_date, minimum_price, maximum_price, modal_price,
  original_price_unit, normalized_price_unit, arrival_quantity, arrival_unit,
  fetched_at, quality_status, quality_flags, is_sample_data, content_hash`;

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));
const escapeLike = (value) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const contains = (value) => `%${escapeLike(value)}%`;

/**
 * Builds the canonical-view WHERE clauses. `?` marks a placeholder; the single
 * bound value is reused when it appears more than once.
 */
function priceConditions(filters, values) {
  const conditions = [];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replaceAll('?', `$${values.length}`));
  };
  if (filters.commodity) add('(UPPER(commodity_code) = UPPER(?) OR UPPER(commodity) = UPPER(?))', filters.commodity);
  if (filters.commodityCategory) add('LOWER(commodity_category) = LOWER(?)', filters.commodityCategory);
  if (filters.variety) add('LOWER(variety) = LOWER(?)', filters.variety);
  if (filters.state) add('LOWER(state) = LOWER(?)', filters.state);
  if (filters.district) add('LOWER(district) = LOWER(?)', filters.district);
  if (filters.mandi) {
    // `mandi` accepts either the market name (case-insensitive) or its numeric id;
    // the id comparison simply never matches when the value is not a number.
    const numericId = /^\d+$/.test(filters.mandi) ? Number(filters.mandi) : null;
    values.push(filters.mandi, numericId);
    conditions.push(`(LOWER(mandi) = LOWER($${values.length - 1}) OR mandi_id = $${values.length})`);
  }
  if (filters.marketCode) add('LOWER(market_code) = LOWER(?)', filters.marketCode);
  if (filters.source) add('source = ?', filters.source);
  if (filters.qualityStatus) add('quality_status = ?', filters.qualityStatus);
  if (filters.includeSample === false) conditions.push('is_sample_data = FALSE');
  if (filters.startDate) add('reported_date >= ?::date', filters.startDate);
  if (filters.endDate) add('reported_date <= ?::date', filters.endDate);
  return conditions;
}

const whereClause = (conditions) => (conditions.length ? `WHERE ${conditions.join(' AND ')}` : '');

/** Removes the pagination bookkeeping column and normalises NUMERICs to numbers. */
function shapePriceRow(row) {
  const { total_count: _total, row_rank: _rank, ...rest } = row;
  return {
    ...rest,
    minimum_price: toNumber(row.minimum_price),
    maximum_price: toNumber(row.maximum_price),
    modal_price: toNumber(row.modal_price),
    arrival_quantity: toNumber(row.arrival_quantity),
  };
}

/**
 * Whole days between a reporting date and today (UTC), never negative.
 * Returns null when there is no date to measure, so callers can tell
 * "unknown freshness" apart from "fresh".
 */
export function staleDays(reportedDate, now = new Date()) {
  if (!reportedDate) return null;
  const reported = Date.parse(`${String(reportedDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(reported)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - reported) / MS_PER_DAY));
}

/**
 * PAGE-SCOPED freshness summary.
 *
 * Reuses the semantics of `summarisePrices` in mandi.service.js (sample rows are
 * never allowed to claim genuine freshness, source attribution is de-duplicated)
 * against the canonical `reported_date` column, and adds `stale_days`.
 *
 * IMPORTANT: this describes the rows on the CURRENT PAGE only — it is computed
 * from the returned `rows`, not from the whole table. A page filtered to one
 * district must not be read as "the newest date in the database".
 */
export function summariseCanonical(rows) {
  const isSample = (row) => row.is_sample_data === true;
  const genuine = rows.filter((row) => !isSample(row));
  const sample = rows.filter(isSample);
  const maxOf = (list, key) => list.reduce((max, row) => {
    const value = row[key] instanceof Date ? row[key].toISOString() : row[key];
    return value && (!max || value > max) ? value : max;
  }, null);
  const latestGenuine = maxOf(genuine, 'reported_date');
  const sources = new Map(rows.map((row) => [row.source, row.source_label]));
  return {
    genuine_rows: genuine.length,
    sample_rows: sample.length,
    latest_genuine_reporting_date: latestGenuine,
    latest_sample_reporting_date: maxOf(sample, 'reported_date'),
    latest_genuine_fetched_at: maxOf(genuine, 'fetched_at'),
    sources: [...sources].map(([code, label]) => ({ code, label })),
    stale_days: staleDays(latestGenuine),
  };
}

const SECRET_PATTERN = /(\b(?:api[-_]?key|access[-_]?key|private[-_]?key|client[-_]?secret|key|token|secret|password|signature|sig|credential)s?\b\s*["']?\s*[:=]\s*["']?)([^"'\s&,;}]+)/gi;

/**
 * Defence in depth for stored error text: a provider can echo the request URL it
 * failed on, which may carry a key. Anything that looks like a secret value is
 * replaced before the text can reach a client.
 */
export function redactSecrets(text, { maxLength = 500 } = {}) {
  if (text === null || text === undefined) return null;
  const redacted = String(text).replace(SECRET_PATTERN, '$1[REDACTED]');
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

export class MarketService {
  constructor({ pool = defaultPool, mandiConfig = config.mandi } = {}) {
    this.pool = pool;
    this.mandiConfig = mandiConfig;
  }

  /**
   * Distinct commodities that actually have observations (an empty commodity
   * catalogue entry with no prices is not a market fact and is never listed).
   */
  async listCommodities(filters = {}) {
    const values = [];
    const conditions = [];
    if (filters.category) {
      values.push(filters.category);
      conditions.push(`LOWER(commodity_category) = LOWER($${values.length})`);
    }
    if (filters.search) {
      values.push(contains(filters.search));
      conditions.push(`(commodity ILIKE $${values.length} OR commodity_code ILIKE $${values.length})`);
    }
    values.push(filters.limit ?? 500, filters.offset ?? 0);
    const result = await this.pool.query(
      `SELECT commodity_code, commodity, commodity_category,
              COUNT(DISTINCT variety) AS variety_count,
              COUNT(DISTINCT state) AS state_count,
              COUNT(*) AS observation_count,
              MIN(reported_date) AS first_reported_date,
              MAX(reported_date) AS last_reported_date,
              COUNT(*) OVER () AS total_count
       FROM mandi_prices_canonical
       ${whereClause(conditions)}
       GROUP BY commodity_code, commodity, commodity_category
       ORDER BY commodity ASC, commodity_code ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const rows = result.rows.map(({ total_count: _t, ...row }) => ({
      ...row,
      variety_count: Number(row.variety_count),
      state_count: Number(row.state_count),
      observation_count: Number(row.observation_count),
    }));
    return { rows, total: Number(result.rows[0]?.total_count ?? 0) };
  }

  /**
   * Distinct markets that actually have observations. With `commodity` the counts
   * describe that commodity only, which is the honest reading of "this market for
   * this commodity". market_code is taken from the source when published and
   * falls back to the internal mandi code in the view; one mandi id can in
   * principle carry more than one published code, so the greatest is reported.
   */
  async listMandis(filters = {}) {
    const values = [];
    const conditions = [];
    const add = (sql, value) => {
      values.push(value);
      conditions.push(sql.replaceAll('?', `$${values.length}`));
    };
    if (filters.state) add('LOWER(state) = LOWER(?)', filters.state);
    if (filters.district) add('LOWER(district) = LOWER(?)', filters.district);
    if (filters.search) add('(mandi ILIKE ? OR market_code ILIKE ?)', contains(filters.search));
    if (filters.commodity) add('(UPPER(commodity_code) = UPPER(?) OR UPPER(commodity) = UPPER(?))', filters.commodity);
    values.push(filters.limit ?? 500, filters.offset ?? 0);
    const result = await this.pool.query(
      `SELECT mandi_id, MAX(market_code) AS market_code, mandi, state, district,
              COUNT(DISTINCT commodity_id) AS commodity_count,
              COUNT(*) AS observation_count,
              MIN(reported_date) AS earliest_reported_date,
              MAX(reported_date) AS latest_reported_date,
              COUNT(*) OVER () AS total_count
       FROM mandi_prices_canonical
       ${whereClause(conditions)}
       GROUP BY mandi_id, mandi, state, district
       ORDER BY mandi ASC, mandi_id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const rows = result.rows.map(({ total_count: _t, ...row }) => ({
      ...row,
      commodity_count: Number(row.commodity_count),
      observation_count: Number(row.observation_count),
    }));
    return { rows, total: Number(result.rows[0]?.total_count ?? 0) };
  }

  /**
   * The latest reported observation for every (mandi, commodity, variety).
   * Partitions by variety so a market that trades two varieties of a commodity
   * reports both, rather than hiding one behind an arbitrary tie-break.
   */
  async getLatestPrices(filters = {}) {
    const values = [];
    const conditions = priceConditions(filters, values);
    values.push(filters.limit ?? 50, filters.offset ?? 0);
    const result = await this.pool.query(
      `WITH filtered AS (
         SELECT ${PRICE_COLUMNS} FROM mandi_prices_canonical ${whereClause(conditions)}
       ), ranked AS (
         SELECT f.*,
                ROW_NUMBER() OVER (
                  PARTITION BY mandi_id, commodity_id, variety
                  ORDER BY reported_date DESC, observation_id DESC
                ) AS row_rank
         FROM filtered f
       ), latest AS (
         SELECT * FROM ranked WHERE row_rank = 1
       )
       SELECT *, COUNT(*) OVER () AS total_count
       FROM latest
       ORDER BY mandi ASC, commodity ASC, variety ASC NULLS FIRST, observation_id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const rows = result.rows.map(shapePriceRow);
    return { rows, total: Number(result.rows[0]?.total_count ?? 0), meta: summariseCanonical(rows) };
  }

  /**
   * Price history. The page is the most recent `limit` rows (after `offset`) in
   * the requested range; order=ASC (default) returns that page oldest-first so a
   * chart can plot it directly, order=DESC returns it newest-first.
   */
  async getPriceHistory(filters = {}) {
    const values = [];
    const conditions = priceConditions(filters, values);
    values.push(filters.limit ?? 100, filters.offset ?? 0);
    // Fixed vocabulary only — never caller text.
    const direction = filters.order === 'DESC' ? 'DESC' : 'ASC';
    const result = await this.pool.query(
      `WITH page AS (
         SELECT ${PRICE_COLUMNS}, COUNT(*) OVER () AS total_count
         FROM mandi_prices_canonical
         ${whereClause(conditions)}
         ORDER BY reported_date DESC, mandi_id DESC, observation_id DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}
       )
       SELECT * FROM page
       ORDER BY reported_date ${direction}, mandi_id ${direction}, observation_id ${direction}`,
      values
    );
    const rows = result.rows.map(shapePriceRow);
    return { rows, total: Number(result.rows[0]?.total_count ?? 0), meta: summariseCanonical(rows) };
  }

  /**
   * Freshness / status overview: per source, plus the whole canonical dataset.
   * A source with no `mandi_source_sync_state` row has simply never synced, so
   * its state fields are null — that is data, not an error.
   * No API key, token or password is ever placed in the response.
   */
  async getDataStatus() {
    const [sources, counts, overall, runs] = await Promise.all([
      this.pool.query(
        `SELECT s.code, s.label, s.precedence, s.is_sample,
                st.last_attempt_at, st.last_success_at, st.last_status, st.last_error,
                st.latest_reporting_date, st.last_window_from, st.last_window_to
         FROM mandi_sources s
         LEFT JOIN mandi_source_sync_state st ON st.source = s.code
         ORDER BY s.precedence DESC, s.code ASC`
      ),
      this.pool.query(
        `SELECT source, COUNT(*) AS observation_count
         FROM mandi_prices_canonical GROUP BY source`
      ),
      this.pool.query(
        `SELECT COUNT(*) AS total_observations,
                COUNT(*) FILTER (WHERE is_sample_data = FALSE) AS genuine_observations,
                COUNT(*) FILTER (WHERE is_sample_data = TRUE) AS sample_observations,
                COUNT(DISTINCT commodity_id) AS distinct_commodities,
                COUNT(DISTINCT mandi_id) AS distinct_mandis,
                COUNT(DISTINCT source) AS distinct_sources,
                MIN(reported_date) AS earliest_reported_date,
                MAX(reported_date) AS latest_reported_date
         FROM mandi_prices_canonical`
      ),
      this.pool.query(
        `SELECT id, source, status, mode, window_from, window_to, records_fetched, records_valid,
                records_inserted, records_updated, records_unchanged, records_rejected, records_failed,
                conflicts_detected, is_sample_data, error_details, triggered_by, execution_time_ms,
                started_at, synced_at
         FROM pipeline_sync_logs
         ORDER BY synced_at DESC, id DESC
         LIMIT 5`
      ),
    ]);

    const perSource = new Map(counts.rows.map((row) => [row.source, Number(row.observation_count)]));
    const cfg = this.mandiConfig ?? {};
    // Only ever a boolean: the key itself never leaves the backend.
    const isConfigured = (row) => (row.code === 'DATA_GOV_IN' ? Boolean(cfg.dataGovApiKey)
      : row.code === 'CEDA' ? Boolean(cfg.cedaApiKey)
        : Boolean(row.is_sample && cfg.allowSampleData));

    const stats = overall.rows[0] ?? {};
    const latestReportedDate = stats.latest_reported_date ?? null;
    const stalenessDays = staleDays(latestReportedDate);
    return {
      generated_at: new Date().toISOString(),
      overall: {
        earliest_reported_date: stats.earliest_reported_date ?? null,
        latest_reported_date: latestReportedDate,
        total_observations: Number(stats.total_observations ?? 0),
        genuine_observations: Number(stats.genuine_observations ?? 0),
        sample_observations: Number(stats.sample_observations ?? 0),
        distinct_commodities: Number(stats.distinct_commodities ?? 0),
        distinct_mandis: Number(stats.distinct_mandis ?? 0),
        distinct_sources: Number(stats.distinct_sources ?? 0),
        staleness_days: stalenessDays,
        staleness_threshold_days: STALE_AFTER_DAYS,
        // No observations at all counts as stale: freshness cannot be claimed.
        stale: stalenessDays === null || stalenessDays > STALE_AFTER_DAYS,
      },
      sources: sources.rows.map((row) => ({
        code: row.code,
        label: row.label,
        precedence: row.precedence === null ? null : Number(row.precedence),
        is_sample: row.is_sample === true,
        configured: isConfigured(row),
        last_attempt_at: row.last_attempt_at ?? null,
        last_success_at: row.last_success_at ?? null,
        last_status: row.last_status ?? null,
        last_error: redactSecrets(row.last_error),
        latest_reporting_date: row.latest_reporting_date ?? null,
        observation_count: perSource.get(row.code) ?? 0,
      })),
      recent_syncs: runs.rows.map((row) => ({
        ...row,
        records_fetched: Number(row.records_fetched ?? 0),
        records_valid: Number(row.records_valid ?? 0),
        records_inserted: Number(row.records_inserted ?? 0),
        records_updated: Number(row.records_updated ?? 0),
        records_unchanged: Number(row.records_unchanged ?? 0),
        records_rejected: Number(row.records_rejected ?? 0),
        records_failed: Number(row.records_failed ?? 0),
        conflicts_detected: Number(row.conflicts_detected ?? 0),
        error_details: redactSecrets(row.error_details),
      })),
    };
  }
}

export default new MarketService();
