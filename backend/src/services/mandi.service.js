import { pool as defaultPool } from '../db.js';
import { config } from '../config/index.js';
import { describeSchedulerConfig } from '../pipeline/scheduler.js';
import { MAX_RECORDS_PER_RUN } from '../pipeline/index.js';

/**
 * Mandi Intelligence Service — read side of the mandi data.
 *
 * Price queries read mandi_prices_resolved, which keeps for every market,
 * commodity and day only the highest-precedence source, so two sources reporting
 * the same market-day are never counted twice. Passing `source` reads that
 * source's own rows instead. Every price row carries its reporting date
 * (price_date), fetch time (fetched_at), source code/label and is_sample_data.
 */

const PRICE_COLUMNS = `
  b.id, b.price_date, b.min_price, b.max_price, b.modal_price, b.arrivals_quantity,
  b.price_unit, b.arrival_unit, b.variety, b.grade, b.source, COALESCE(s.label, b.source) AS source_label,
  b.is_sample_data, b.quality_flags, b.fetched_at, b.updated_at,
  m.id AS mandi_id, m.code AS mandi_code, m.name AS mandi_name, m.district, m.state, m.latitude, m.longitude,
  c.id AS commodity_id, c.code AS commodity_code, c.name AS commodity_name, c.category AS commodity_category`;

function priceFilters(filters, values) {
  const conditions = ['m.is_active = TRUE'];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replaceAll('?', `$${values.length}`));
  };
  if (filters.commodity) add('(UPPER(c.code) = UPPER(?) OR UPPER(c.name) = UPPER(?))', filters.commodity);
  if (filters.mandiId) add('m.id = ?', filters.mandiId);
  if (filters.state) add('LOWER(m.state) = LOWER(?)', filters.state);
  if (filters.district) add('LOWER(m.district) = LOWER(?)', filters.district);
  if (filters.source) add('b.source = ?', filters.source);
  if (filters.includeSample === false) conditions.push('b.is_sample_data = FALSE');
  if (filters.startDate) add('b.price_date >= ?::date', filters.startDate);
  if (filters.endDate) add('b.price_date <= ?::date', filters.endDate);
  return conditions;
}

const priceSource = (filters) => (filters.source ? 'mandi_prices' : 'mandi_prices_resolved');

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

function shapePriceRow(row) {
  const { total_count: _total, previous_price_date: previousDate, previous_modal_price: previousModal, ...rest } = row;
  const modal = toNumber(row.modal_price);
  const previous = toNumber(previousModal);
  let trendPercent = null;
  let trendDirection = 'none';
  if (previous !== null && previous > 0 && modal !== null) {
    trendPercent = Number((((modal - previous) / previous) * 100).toFixed(1));
    trendDirection = trendPercent > 0 ? 'up' : trendPercent < 0 ? 'down' : 'stable';
  }
  return {
    ...rest,
    ...(previousDate !== undefined && {
      previous_price_date: previousDate,
      previous_modal_price: previous,
      trend_percent: trendPercent,
      trend_direction: trendDirection,
    }),
  };
}

/** Freshness metadata so clients can show reporting dates honestly. */
export function summarisePrices(rows) {
  const genuine = rows.filter((r) => !r.is_sample_data);
  const maxOf = (list, key) => list.reduce((max, r) => {
    const value = r[key] instanceof Date ? r[key].toISOString() : r[key];
    return value && (!max || value > max) ? value : max;
  }, null);
  const sources = new Map(rows.map((r) => [r.source, r.source_label]));
  return {
    genuine_rows: genuine.length,
    sample_rows: rows.length - genuine.length,
    latest_genuine_reporting_date: maxOf(genuine, 'price_date'),
    latest_sample_reporting_date: maxOf(rows.filter((r) => r.is_sample_data), 'price_date'),
    latest_genuine_fetched_at: maxOf(genuine, 'fetched_at'),
    sources: [...sources].map(([code, label]) => ({ code, label })),
  };
}

export class MandiService {
  constructor({ pool = defaultPool, mandiConfig = config.mandi } = {}) {
    this.pool = pool;
    this.mandiConfig = mandiConfig;
  }

  async listMandis(filters = {}) {
    const conditions = ['is_active = TRUE'];
    const values = [];
    if (filters.state) {
      values.push(filters.state);
      conditions.push(`LOWER(state) = LOWER($${values.length})`);
    }
    if (filters.district) {
      values.push(filters.district);
      conditions.push(`LOWER(district) = LOWER($${values.length})`);
    }
    if (filters.search) {
      values.push(`%${filters.search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
      conditions.push(`(name ILIKE $${values.length} OR market_center ILIKE $${values.length})`);
    }
    values.push(filters.limit ?? 500, filters.offset ?? 0);
    const result = await this.pool.query(
      `SELECT id, code, name, hindi_name, marathi_name, state, district, market_center,
              latitude, longitude, created_at, updated_at, COUNT(*) OVER () AS total_count
       FROM mandis
       WHERE ${conditions.join(' AND ')}
       ORDER BY name ASC, id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return {
      rows: result.rows.map(({ total_count: _t, ...row }) => row),
      total: Number(result.rows[0]?.total_count ?? 0),
    };
  }

  async getMandiById(id) {
    const mandiRes = await this.pool.query(
      `SELECT id, code, name, hindi_name, marathi_name, state, district, market_center,
              latitude, longitude, created_at, updated_at
       FROM mandis WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    if (mandiRes.rows.length === 0) return null;
    const mandi = mandiRes.rows[0];
    const prices = await this.pool.query(
      `SELECT ${PRICE_COLUMNS}
       FROM mandi_prices_resolved b
       JOIN mandis m ON m.id = b.mandi_id
       JOIN commodities c ON c.id = b.commodity_id
       LEFT JOIN mandi_sources s ON s.code = b.source
       WHERE b.mandi_id = $1
         AND b.price_date = (SELECT MAX(x.price_date) FROM mandi_prices_resolved x
                             WHERE x.mandi_id = b.mandi_id AND x.commodity_id = b.commodity_id)
       ORDER BY c.name, b.variety NULLS FIRST, b.grade NULLS FIRST, b.id`,
      [id]
    );
    mandi.current_prices = prices.rows;
    return mandi;
  }

  /**
   * Latest reporting day for every (mandi, commodity); all varieties/grades reported
   * that day are returned. Trend compares with the previous report of the SAME
   * source, variety and grade (never across sources).
   */
  async getLatestPrices(filters = {}) {
    const values = [];
    const conditions = priceFilters(filters, values);
    values.push(filters.limit ?? 50, filters.offset ?? 0);
    const sql = `
      WITH base AS (
        SELECT ${PRICE_COLUMNS}
        FROM ${priceSource(filters)} b
        JOIN mandis m ON m.id = b.mandi_id
        JOIN commodities c ON c.id = b.commodity_id
        LEFT JOIN mandi_sources s ON s.code = b.source
        WHERE ${conditions.join(' AND ')}
      ), latest AS (
        SELECT *, MAX(price_date) OVER (PARTITION BY mandi_id, commodity_id) AS latest_day FROM base
      )
      SELECT l.*, prev.price_date AS previous_price_date, prev.modal_price AS previous_modal_price,
             COUNT(*) OVER () AS total_count
      FROM latest l
      LEFT JOIN LATERAL (
        SELECT p.price_date, p.modal_price
        FROM mandi_prices p
        WHERE p.source = l.source AND p.mandi_id = l.mandi_id AND p.commodity_id = l.commodity_id
          AND p.variety IS NOT DISTINCT FROM l.variety AND p.grade IS NOT DISTINCT FROM l.grade
          AND p.price_date < l.price_date
        ORDER BY p.price_date DESC
        LIMIT 1
      ) prev ON TRUE
      WHERE l.price_date = l.latest_day
      ORDER BY l.mandi_name, l.commodity_name, l.variety NULLS FIRST, l.grade NULLS FIRST, l.id
      LIMIT $${values.length - 1} OFFSET $${values.length}`;
    const result = await this.pool.query(sql, values);
    const rows = result.rows.map(({ latest_day: _d, ...row }) => shapePriceRow(row));
    return { rows, total: Number(result.rows[0]?.total_count ?? 0), meta: summarisePrices(rows) };
  }

  /**
   * Price history. The page is the most recent `limit` rows (after `offset`) in the
   * requested range; order=ASC (default) returns that page oldest-first for charts,
   * order=DESC newest-first.
   */
  async getPriceHistory(options = {}) {
    const values = [];
    const conditions = priceFilters(options, values);
    values.push(options.limit ?? 100, options.offset ?? 0);
    const direction = options.order === 'DESC' ? 'DESC' : 'ASC';
    const sql = `
      WITH page AS (
        SELECT ${PRICE_COLUMNS}, COUNT(*) OVER () AS total_count
        FROM ${priceSource(options)} b
        JOIN mandis m ON m.id = b.mandi_id
        JOIN commodities c ON c.id = b.commodity_id
        LEFT JOIN mandi_sources s ON s.code = b.source
        WHERE ${conditions.join(' AND ')}
        ORDER BY b.price_date DESC, m.id DESC, b.id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
      )
      SELECT * FROM page ORDER BY price_date ${direction}, mandi_id ${direction}, id ${direction}`;
    const result = await this.pool.query(sql, values);
    const rows = result.rows.map(({ total_count: _t, ...row }) => row);
    return { rows, total: Number(result.rows[0]?.total_count ?? 0), meta: summarisePrices(rows) };
  }

  async getCommodities() {
    const result = await this.pool.query(
      `SELECT id, code, name, hindi_name, marathi_name, category, standard_unit
       FROM commodities WHERE is_active = TRUE ORDER BY name ASC`
    );
    return result.rows;
  }

  /**
   * Aggregated commodity-level daily reports (macro/national prices, arrivals, MSP)
   * from official sources such as AGMARKNET.
   */
  async getCommodityDailyReports(filters = {}) {
    const conditions = [];
    const values = [];

    const add = (sql, value) => {
      values.push(value);
      conditions.push(sql.replaceAll('?', `$${values.length}`));
    };

    if (filters.commodity) {
      add('(UPPER(r.commodity_code) = UPPER(?) OR UPPER(r.commodity_name) = UPPER(?))', filters.commodity);
    }
    if (filters.group) {
      add('LOWER(r.commodity_group) = LOWER(?)', filters.group);
    }
    if (filters.source) {
      add('r.source = ?', filters.source);
    }
    if (filters.startDate) {
      add('r.report_date >= ?::date', filters.startDate);
    }
    if (filters.endDate) {
      add('r.report_date <= ?::date', filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(filters.limit ?? 100, filters.offset ?? 0);

    const sql = `
      WITH ranked AS (
        SELECT r.*,
               COALESCE(s.label, r.source) AS source_label,
               LAG(r.modal_price) OVER (PARTITION BY r.commodity_name ORDER BY r.report_date ASC) AS prev_modal_price,
               LAG(r.report_date) OVER (PARTITION BY r.commodity_name ORDER BY r.report_date ASC) AS prev_report_date,
               COUNT(*) OVER () AS total_count
        FROM commodity_daily_reports r
        LEFT JOIN mandi_sources s ON s.code = r.source
        ${whereClause}
      )
      SELECT *
      FROM ranked
      ORDER BY report_date DESC, commodity_group ASC, commodity_name ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const result = await this.pool.query(sql, values);
    const rows = result.rows.map((row) => {
      const modal = toNumber(row.modal_price);
      const prev = toNumber(row.prev_modal_price);
      let trendPercent = null;
      let trendDirection = 'none';
      if (modal !== null && prev !== null && prev > 0) {
        trendPercent = Number((((modal - prev) / prev) * 100).toFixed(1));
        trendDirection = trendPercent > 0 ? 'up' : trendPercent < 0 ? 'down' : 'stable';
      }
      return {
        id: row.id,
        source: row.source,
        source_label: row.source_label,
        commodity_code: row.commodity_code,
        commodity_name: row.commodity_name,
        commodity_group: row.commodity_group,
        report_date: row.report_date,
        modal_price: modal,
        price_unit: row.price_unit,
        arrivals_quantity: toNumber(row.arrivals_quantity),
        arrival_unit: row.arrival_unit,
        msp: toNumber(row.msp),
        msp_season: row.msp_season,
        geographic_level: row.geographic_level,
        previous_modal_price: prev,
        previous_report_date: row.prev_report_date,
        trend_percent: trendPercent,
        trend_direction: trendDirection,
        updated_at: row.updated_at,
      };
    });

    const dates = rows.map((r) => r.report_date).filter(Boolean);
    const meta = {
      total_rows: rows.length,
      latest_reporting_date: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      earliest_reporting_date: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      source: 'AGMARKNET',
      geographic_level: 'NATIONAL_AGGREGATE',
    };

    return { rows, total: Number(result.rows[0]?.total_count ?? 0), meta };
  }

  async getPipelineStatus() {
    const [runs, sources, counts] = await Promise.all([
      this.pool.query(
        `SELECT id, source, status, mode, window_from, window_to, records_fetched, records_valid,
                records_inserted, records_updated, records_unchanged, records_rejected, records_failed,
                conflicts_detected, is_sample_data, error_details, rejection_summary, triggered_by,
                execution_time_ms, started_at, synced_at
         FROM pipeline_sync_logs ORDER BY synced_at DESC, id DESC LIMIT 10`
      ),
      this.pool.query(
        `SELECT s.code AS source, s.label, s.is_sample, st.last_attempt_at, st.last_success_at, st.last_status,
                st.last_error, st.last_window_from, st.last_window_to, st.latest_reporting_date
         FROM mandi_sources s LEFT JOIN mandi_source_sync_state st ON st.source = s.code
         ORDER BY s.precedence DESC`
      ),
      this.pool.query(
        `SELECT
           (SELECT COUNT(*) FROM mandis WHERE is_active = TRUE) AS total_mandis,
           (SELECT COUNT(*) FROM commodities WHERE is_active = TRUE) AS total_commodities,
           (SELECT COUNT(*) FROM mandi_prices) AS total_price_records,
           (SELECT COUNT(*) FROM mandi_prices WHERE is_sample_data = FALSE) AS genuine_price_records,
           (SELECT COUNT(*) FROM mandi_prices WHERE is_sample_data = TRUE) AS sample_price_records,
           (SELECT MAX(price_date) FROM mandi_prices) AS latest_record_date,
           (SELECT MAX(price_date) FROM mandi_prices WHERE is_sample_data = FALSE) AS latest_genuine_record_date,
           (SELECT COUNT(*) FROM mandi_price_conflicts WHERE status = 'OPEN') AS open_conflicts`
      ),
    ]);
    const scheduler = describeSchedulerConfig(this.mandiConfig);
    return {
      stats: counts.rows[0],
      sources: sources.rows.map((row) => ({
        ...row,
        configured: row.source === 'DATA_GOV_IN' ? Boolean(this.mandiConfig.dataGovApiKey)
          : row.source === 'CEDA' ? Boolean(this.mandiConfig.cedaApiKey) : this.mandiConfig.allowSampleData,
      })),
      scheduler: { enabled: scheduler.enabled, reason: scheduler.reason, interval_minutes: scheduler.minutes ?? null },
      recent_syncs: runs.rows,
    };
  }

  async getDataQualityReport() {
    const [summary, coverage, integrity, flags, conflicts, revisions, sync] = await Promise.all([
      this.pool.query(
        `SELECT COUNT(*) AS total_records,
                COUNT(*) FILTER (WHERE is_sample_data = FALSE) AS genuine_records,
                COUNT(*) FILTER (WHERE is_sample_data = TRUE) AS sample_records,
                COUNT(DISTINCT mandi_id) AS distinct_mandis_covered,
                COUNT(DISTINCT commodity_id) AS distinct_commodities_covered,
                MIN(price_date) AS earliest_record_date, MAX(price_date) AS latest_record_date
         FROM mandi_prices`
      ),
      this.pool.query(
        `SELECT mp.source, COALESCE(s.label, mp.source) AS source_label, mp.is_sample_data,
                COUNT(*) AS record_count, COUNT(DISTINCT mp.mandi_id) AS mandis_count,
                COUNT(DISTINCT mp.commodity_id) AS commodities_count,
                MIN(mp.price_date) AS min_date, MAX(mp.price_date) AS max_date,
                MAX(mp.fetched_at) AS last_fetched_at
         FROM mandi_prices mp LEFT JOIN mandi_sources s ON s.code = mp.source
         GROUP BY mp.source, s.label, mp.is_sample_data ORDER BY record_count DESC`
      ),
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE modal_price IS NULL OR modal_price <= 0) AS invalid_modal_prices,
           COUNT(*) FILTER (WHERE min_price > max_price) AS invalid_price_bounds,
           COUNT(*) FILTER (WHERE min_price IS NULL OR max_price IS NULL) AS missing_min_or_max,
           COUNT(*) FILTER (WHERE arrivals_quantity IS NULL) AS missing_arrivals,
           COUNT(*) FILTER (WHERE arrivals_quantity < 0) AS negative_arrivals,
           COUNT(*) FILTER (WHERE price_date > CURRENT_DATE + 1) AS future_dated_records,
           COUNT(*) FILTER (WHERE price_unit IS NULL) AS missing_price_unit
         FROM mandi_prices`
      ),
      this.pool.query(
        `SELECT flag, COUNT(*) AS records FROM mandi_prices, unnest(quality_flags) AS flag
         GROUP BY flag ORDER BY records DESC LIMIT 20`
      ),
      this.pool.query(
        `SELECT conflict_type, status, COUNT(*) AS conflicts FROM mandi_price_conflicts
         GROUP BY conflict_type, status ORDER BY conflict_type, status`
      ),
      this.pool.query('SELECT COUNT(*) AS revisions FROM mandi_price_revisions'),
      this.pool.query(
        `SELECT COUNT(*) AS total_sync_runs,
                COUNT(*) FILTER (WHERE status = 'SUCCESS') AS successful_runs,
                COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_runs,
                COUNT(*) FILTER (WHERE status = 'PARTIAL_SUCCESS') AS partial_runs,
                COALESCE(SUM(records_inserted), 0) AS total_records_inserted,
                COALESCE(SUM(records_updated), 0) AS total_records_updated,
                COALESCE(SUM(records_rejected), 0) AS total_records_rejected,
                ROUND(AVG(execution_time_ms), 1) AS avg_execution_time_ms
         FROM pipeline_sync_logs`
      ),
    ]);
    let storage = { table_size: null, database_size: null };
    try {
      storage = (await this.pool.query(
        `SELECT pg_size_pretty(pg_total_relation_size('mandi_prices')) AS table_size,
                pg_size_pretty(pg_database_size(current_database())) AS database_size`
      )).rows[0];
    } catch {
      // size functions need no special privilege on PostgreSQL 16+, but stay optional
    }
    return {
      generated_at: new Date().toISOString(),
      summary: summary.rows[0],
      source_coverage: coverage.rows,
      integrity_audit: integrity.rows[0],
      quality_flags: flags.rows,
      conflicts: conflicts.rows,
      revisions: Number(revisions.rows[0].revisions),
      sync_health: sync.rows[0],
      storage_safety: {
        table_size: storage.table_size,
        database_size: storage.database_size,
        max_batch_limit: MAX_RECORDS_PER_RUN,
        default_batch_limit: 2000,
        incremental_upsert_enabled: true,
        min_free_disk_gb: this.mandiConfig.historical.minFreeDiskGb,
        download_budget_mb: this.mandiConfig.historical.downloadBudgetMb,
      },
    };
  }
}

export default new MandiService();
