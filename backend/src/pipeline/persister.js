import { pool } from '../db.js';

/**
 * Mandi Data Persister
 * Handles transactional, idempotent persistence into PostgreSQL.
 */
export class MandiPersister {
  constructor() {
    this.mandiCache = new Map();
    this.commodityCache = new Map();
  }

  /**
   * Refreshes internal ID caches from PostgreSQL
   */
  async refreshCaches(client) {
    const mandisRes = await client.query('SELECT id, code FROM mandis');
    this.mandiCache.clear();
    for (const row of mandisRes.rows) {
      this.mandiCache.set(row.code, row.id);
    }

    const commoditiesRes = await client.query('SELECT id, code FROM commodities');
    this.commodityCache.clear();
    for (const row of commoditiesRes.rows) {
      this.commodityCache.set(row.code, row.id);
    }
  }

  /**
   * Ensures mandi exists in the database and returns its ID
   */
  async ensureMandi(client, record) {
    if (this.mandiCache.has(record.mandi_code)) {
      return this.mandiCache.get(record.mandi_code);
    }

    const insertRes = await client.query(
      `INSERT INTO mandis (code, name, state, district, market_center, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        record.mandi_code,
        record.mandi_name,
        record.state,
        record.district,
        record.market_center || record.mandi_name,
        record.latitude || null,
        record.longitude || null,
      ]
    );

    const id = insertRes.rows[0].id;
    this.mandiCache.set(record.mandi_code, id);
    return id;
  }

  /**
   * Ensures commodity exists in the database and returns its ID
   */
  async ensureCommodity(client, record) {
    if (this.commodityCache.has(record.commodity_code)) {
      return this.commodityCache.get(record.commodity_code);
    }

    const insertRes = await client.query(
      `INSERT INTO commodities (code, name, category, standard_unit)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        record.commodity_code,
        record.commodity_name,
        record.commodity_category || 'Vegetables',
        record.unit || 'quintal',
      ]
    );

    const id = insertRes.rows[0].id;
    this.commodityCache.set(record.commodity_code, id);
    return id;
  }

  /**
   * Persists a batch of normalized records into PostgreSQL
   * @param {Array<Object>} records - Normalized, deduplicated records
   * @returns {Promise<{ inserted: number, updated: number, failed: number }>}
   */
  async persistBatch(records) {
    if (!records || records.length === 0) {
      return { inserted: 0, updated: 0, failed: 0 };
    }

    const client = await pool.connect();
    let inserted = 0;
    let updated = 0;
    let failed = 0;

    try {
      await client.query('BEGIN');
      await this.refreshCaches(client);

      for (const record of records) {
        try {
          const mandiId = await this.ensureMandi(client, record);
          const commodityId = await this.ensureCommodity(client, record);

          const upsertSql = `
            INSERT INTO mandi_prices (
              mandi_id, commodity_id, price_date,
              min_price, max_price, modal_price,
              arrivals_quantity, unit, variety, grade,
              source, is_sample_data, raw_payload
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (mandi_id, commodity_id, price_date, variety, source)
            DO UPDATE SET
              min_price = EXCLUDED.min_price,
              max_price = EXCLUDED.max_price,
              modal_price = EXCLUDED.modal_price,
              arrivals_quantity = EXCLUDED.arrivals_quantity,
              updated_at = CURRENT_TIMESTAMP
            RETURNING (xmax = 0) AS is_insert;
          `;

          const res = await client.query(upsertSql, [
            mandiId,
            commodityId,
            record.price_date,
            record.min_price,
            record.max_price,
            record.modal_price,
            record.arrivals_quantity,
            record.unit,
            record.variety,
            record.grade,
            record.source,
            record.is_sample_data,
            record.raw_payload ? JSON.stringify(record.raw_payload) : null,
          ]);

          if (res.rows[0].is_insert) {
            inserted++;
          } else {
            updated++;
          }
        } catch (recordErr) {
          console.error(`[Persister] Failed to persist record (${record.mandi_code}, ${record.commodity_code}, ${record.price_date}):`, recordErr.message);
          failed++;
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error('[Persister] Transaction rollback during batch persistence:', txErr.message);
      throw txErr;
    } finally {
      client.release();
    }

    return { inserted, updated, failed };
  }

  /**
   * Logs pipeline sync execution audit
   */
  async logSync(auditData) {
    try {
      await pool.query(
        `INSERT INTO pipeline_sync_logs (
          source, status, records_fetched, records_valid,
          records_inserted, records_updated, records_rejected,
          error_details, execution_time_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          auditData.source || 'UNKNOWN',
          auditData.status || 'SUCCESS',
          auditData.records_fetched || 0,
          auditData.records_valid || 0,
          auditData.records_inserted || 0,
          auditData.records_updated || 0,
          auditData.records_rejected || 0,
          auditData.error_details || null,
          auditData.execution_time_ms || 0,
        ]
      );
    } catch (err) {
      console.error('[Persister] Failed to write pipeline sync log:', err.message);
    }
  }
}

export default new MandiPersister();
