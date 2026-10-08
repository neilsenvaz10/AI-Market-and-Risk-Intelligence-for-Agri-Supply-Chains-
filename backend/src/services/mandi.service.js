import { pool } from '../db.js';



/**

 * Mandi Intelligence Service

 * Business logic and database access layer for Mandi & Price domain.

 */

export class MandiService {

  /**

   * Retrieves list of active mandis, optionally filtered by state or district

   * @param {Object} filters - { state, district, search }

   */

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

      values.push(`%${filters.search}%`);

      conditions.push(`(name ILIKE $${values.length} OR market_center ILIKE $${values.length})`);

    }



    const sql = `

      SELECT id, code, name, hindi_name, marathi_name, state, district, market_center,

             latitude, longitude, created_at, updated_at

      FROM mandis

      WHERE ${conditions.join(' AND ')}

      ORDER BY name ASC;

    `;



    const result = await pool.query(sql, values);

    return result.rows;

  }



  /**

   * Retrieves a single mandi by ID

   */

  async getMandiById(id) {

    const mandiId = parseInt(id, 10);

    if (isNaN(mandiId)) return null;



    const mandiSql = `

      SELECT id, code, name, hindi_name, marathi_name, state, district, market_center,

             latitude, longitude, created_at, updated_at

      FROM mandis

      WHERE id = $1 AND is_active = TRUE;

    `;

    const mandiRes = await pool.query(mandiSql, [mandiId]);

    if (mandiRes.rows.length === 0) return null;



    const mandi = mandiRes.rows[0];



    // Fetch latest prices for this mandi

    const pricesSql = `

      SELECT DISTINCT ON (mp.commodity_id)

        mp.id, mp.price_date, mp.min_price, mp.max_price, mp.modal_price,

        mp.arrivals_quantity, mp.unit, mp.variety, mp.grade, mp.source, mp.is_sample_data,

        c.code AS commodity_code, c.name AS commodity_name, c.category AS commodity_category

      FROM mandi_prices mp

      JOIN commodities c ON mp.commodity_id = c.id

      WHERE mp.mandi_id = $1

      ORDER BY mp.commodity_id, mp.price_date DESC;

    `;

    const pricesRes = await pool.query(pricesSql, [mandiId]);

    mandi.current_prices = pricesRes.rows;



    return mandi;

  }



  /**

   * Retrieves latest market prices across mandis, with trend calculation against preceding day

   * @param {Object} filters - { commodity, mandiId, district, state, limit = 50 }

   */

  async getLatestPrices(filters = {}) {

    const conditions = ['m.is_active = TRUE'];

    const values = [];



    if (filters.commodity) {

      values.push(filters.commodity.toUpperCase());

      conditions.push(`(UPPER(c.code) = $${values.length} OR UPPER(c.name) = $${values.length})`);

    }



    if (filters.mandiId) {

      values.push(parseInt(filters.mandiId, 10));

      conditions.push(`m.id = $${values.length}`);

    }



    if (filters.district) {

      values.push(filters.district);

      conditions.push(`LOWER(m.district) = LOWER($${values.length})`);

    }



    if (filters.state) {

      values.push(filters.state);

      conditions.push(`LOWER(m.state) = LOWER($${values.length})`);

    }



    const limit = Math.min(parseInt(filters.limit || '50', 10), 100);

    values.push(limit);



    // Query distinct latest records per mandi-commodity pair

    const sql = `

      SELECT DISTINCT ON (mp.mandi_id, mp.commodity_id)

        mp.id,

        mp.price_date,

        mp.min_price,

        mp.max_price,

        mp.modal_price,

        mp.arrivals_quantity,

        mp.unit,

        mp.variety,

        mp.grade,

        mp.source,

        mp.is_sample_data,

        mp.updated_at,

        m.id AS mandi_id,

        m.code AS mandi_code,

        m.name AS mandi_name,

        m.district,

        m.state,

        m.latitude,

        m.longitude,

        c.id AS commodity_id,

        c.code AS commodity_code,

        c.name AS commodity_name,

        c.category AS commodity_category

      FROM mandi_prices mp

      JOIN mandis m ON mp.mandi_id = m.id

      JOIN commodities c ON mp.commodity_id = c.id

      WHERE ${conditions.join(' AND ')}

      ORDER BY mp.mandi_id, mp.commodity_id, mp.price_date DESC

      LIMIT $${values.length};

    `;



    const result = await pool.query(sql, values);



    // Enrich with price trend by querying previous day for each record

    const enriched = await Promise.all(

      result.rows.map(async (row) => {

        const prevSql = `

          SELECT modal_price

          FROM mandi_prices

          WHERE mandi_id = $1 AND commodity_id = $2 AND price_date < $3

          ORDER BY price_date DESC

          LIMIT 1;

        `;

        const prevRes = await pool.query(prevSql, [row.mandi_id, row.commodity_id, row.price_date]);

        let trendPercent = 0;

        let trendDirection = 'stable';



        if (prevRes.rows.length > 0) {

          const prevModal = Number(prevRes.rows[0].modal_price);

          const currentModal = Number(row.modal_price);

          if (prevModal > 0) {

            trendPercent = Number((((currentModal - prevModal) / prevModal) * 100).toFixed(1));

            trendDirection = trendPercent > 0 ? 'up' : trendPercent < 0 ? 'down' : 'stable';

          }

        }



        return {

          ...row,

          trend_percent: trendPercent,

          trend_direction: trendDirection,

        };

      })

    );



    return enriched;

  }



  /**

   * Retrieves historical price time-series for a commodity & mandi

   * @param {Object} options - { commodity, mandiId, startDate, endDate, limit = 100 }

   */

  async getPriceHistory(options = {}) {

    const conditions = [];

    const values = [];



    if (options.commodity) {

      values.push(options.commodity.toUpperCase());

      conditions.push(`(UPPER(c.code) = $${values.length} OR UPPER(c.name) = $${values.length})`);

    }



    if (options.mandiId) {

      values.push(parseInt(options.mandiId, 10));

      conditions.push(`mp.mandi_id = $${values.length}`);

    }



    if (options.startDate) {

      values.push(options.startDate);

      conditions.push(`mp.price_date >= $${values.length}`);

    }



    if (options.endDate) {

      values.push(options.endDate);

      conditions.push(`mp.price_date <= $${values.length}`);

    }



    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limit = Math.min(parseInt(options.limit || '100', 10), 365);

    values.push(limit);



    const sql = `

      SELECT

        mp.id,

        mp.price_date,

        mp.min_price,

        mp.max_price,

        mp.modal_price,

        mp.arrivals_quantity,

        mp.unit,

        mp.variety,

        mp.source,

        mp.is_sample_data,

        m.id AS mandi_id,

        m.name AS mandi_name,

        m.district,

        c.id AS commodity_id,

        c.code AS commodity_code,

        c.name AS commodity_name

      FROM mandi_prices mp

      JOIN mandis m ON mp.mandi_id = m.id

      JOIN commodities c ON mp.commodity_id = c.id

      ${whereClause}

      ORDER BY mp.price_date ASC, mp.mandi_id ASC

      LIMIT $${values.length};

    `;



    const result = await pool.query(sql, values);

    return result.rows;

  }



  /**

   * Retrieves list of supported commodities

   */

  async getCommodities() {

    const sql = `

      SELECT id, code, name, hindi_name, marathi_name, category, standard_unit

      FROM commodities

      WHERE is_active = TRUE

      ORDER BY name ASC;

    `;

    const result = await pool.query(sql);

    return result.rows;

  }



  /**

   * Retrieves latest pipeline synchronization audit entries

   */

  async getPipelineStatus() {

    const logsSql = `

      SELECT id, source, status, records_fetched, records_valid,

             records_inserted, records_updated, records_rejected,

             error_details, execution_time_ms, synced_at

      FROM pipeline_sync_logs

      ORDER BY synced_at DESC

      LIMIT 10;

    `;

    const logsRes = await pool.query(logsSql);



    const countsSql = `

      SELECT

        (SELECT COUNT(*) FROM mandis WHERE is_active = TRUE) AS total_mandis,

        (SELECT COUNT(*) FROM commodities WHERE is_active = TRUE) AS total_commodities,

        (SELECT COUNT(*) FROM mandi_prices) AS total_price_records,

        (SELECT MAX(price_date) FROM mandi_prices) AS latest_record_date;

    `;

    const countsRes = await pool.query(countsSql);



    return {

      stats: countsRes.rows[0],

      recent_syncs: logsRes.rows,

    };

  }



  /**

   * Generates a comprehensive data quality and storage safety audit report.

   * Assesses dataset completeness, source coverage, data integrity, and pipeline health.

   */

  async getDataQualityReport() {

    const summarySql = `

      SELECT

        COUNT(*) AS total_records,

        COUNT(DISTINCT mandi_id) AS distinct_mandis_covered,

        COUNT(DISTINCT commodity_id) AS distinct_commodities_covered,

        MIN(price_date) AS earliest_record_date,

        MAX(price_date) AS latest_record_date

      FROM mandi_prices;

    `;

    const summaryRes = await pool.query(summarySql);



    const sourceSql = `

      SELECT

        source,

        is_sample_data,

        COUNT(*) AS record_count,

        COUNT(DISTINCT mandi_id) AS mandis_count,

        COUNT(DISTINCT commodity_id) AS commodities_count,

        MIN(price_date) AS min_date,

        MAX(price_date) AS max_date,

        ROUND(AVG(modal_price), 2) AS avg_modal_price

      FROM mandi_prices

      GROUP BY source, is_sample_data

      ORDER BY record_count DESC;

    `;

    const sourceRes = await pool.query(sourceSql);



    const integritySql = `

      SELECT

        COUNT(*) FILTER (WHERE modal_price IS NULL OR modal_price <= 0) AS invalid_modal_prices,

        COUNT(*) FILTER (WHERE min_price > max_price) AS invalid_price_bounds,

        COUNT(*) FILTER (WHERE arrivals_quantity < 0) AS negative_arrivals,

        COUNT(*) FILTER (WHERE price_date > CURRENT_DATE + INTERVAL '1 day') AS future_dated_records

      FROM mandi_prices;

    `;

    const integrityRes = await pool.query(integritySql);



    const syncSql = `

      SELECT

        COUNT(*) AS total_sync_runs,

        COUNT(*) FILTER (WHERE status = 'SUCCESS') AS successful_runs,

        COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_runs,

        COUNT(*) FILTER (WHERE status = 'PARTIAL_SUCCESS') AS partial_runs,

        COALESCE(SUM(records_inserted), 0) AS total_records_inserted,

        COALESCE(SUM(records_updated), 0) AS total_records_updated,

        COALESCE(SUM(records_rejected), 0) AS total_records_rejected,

        ROUND(AVG(execution_time_ms), 1) AS avg_execution_time_ms

      FROM pipeline_sync_logs;

    `;

    const syncRes = await pool.query(syncSql);



    let storageInfo = { table_size: 'N/A', database_size: 'N/A' };

    try {

      const storageRes = await pool.query(`

        SELECT pg_size_pretty(pg_total_relation_size('mandi_prices')) AS table_size,

               pg_size_pretty(pg_database_size(current_database())) AS database_size;

      `);

      if (storageRes.rows.length > 0) {

        storageInfo = storageRes.rows[0];

      }

    } catch {

      // Graceful fallback

    }



    return {

      generated_at: new Date().toISOString(),

      summary: summaryRes.rows[0] || {},

      source_coverage: sourceRes.rows || [],

      integrity_audit: integrityRes.rows[0] || {},

      sync_health: syncRes.rows[0] || {},

      storage_safety: {

        table_size: storageInfo.table_size,

        database_size: storageInfo.database_size,

        max_batch_limit: 10000,

        default_batch_limit: 2000,

        incremental_upsert_enabled: true,

      },

    };

  }

}



export default new MandiService();
