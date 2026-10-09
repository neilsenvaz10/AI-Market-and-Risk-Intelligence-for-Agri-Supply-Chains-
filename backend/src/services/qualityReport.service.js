/**
 * Phase 5 mandi-data QUALITY REPORT.
 *
 * Read-only audit of the canonical mandi model (`mandi_prices_canonical`, defined by
 * database/migrations/007_phase5_canonical_mandi.sql) plus the ingestion bookkeeping
 * tables (pipeline_sync_logs, mandi_source_sync_state, mandi_price_conflicts).
 *
 * Honesty rules enforced here:
 *   - nothing is invented: every figure comes from a query or a filesystem measurement,
 *     and an empty result becomes 0 / null WITH a reason, never a guess;
 *   - every section states whether its values are `measured` or `estimated`;
 *   - the only estimate is `storage.estimated_full_run`, derived from the MEASURED mean
 *     bytes/row and a caller-supplied row count (an operator assumption, never assumed
 *     by this service);
 *   - credentials are never read into the report (only their presence, as availability).
 *
 * Each query carries a `/* qr:<name> *\/` marker so the unit tests can route a fake pool
 * by SQL substring instead of a real database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pool as defaultPool } from '../db.js';
import { config } from '../config/index.js';

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));
const toInt = (value) => (value === null || value === undefined ? 0 : Number(value));
const round = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Nearest existing ancestor is measured when the requested path does not exist yet. */
async function localMeasureDisk(targetPath) {
  const requested = path.resolve(targetPath);
  let probe = requested;
  for (;;) {
    try {
      const stats = await fs.promises.statfs(probe);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      return {
        path: requested,
        measured_path: probe,
        free_bytes: freeBytes,
        free_gb: round(freeBytes / 1024 ** 3, 2),
        measured: true,
        ...(probe !== requested && { note: `requested path does not exist yet; measured the nearest existing ancestor ${probe}` }),
      };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        return { path: requested, free_bytes: null, free_gb: null, measured: false, error: `statfs failed: ${error.message}` };
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        return { path: requested, free_bytes: null, free_gb: null, measured: false, error: `no existing ancestor for ${requested}` };
      }
      probe = parent;
    }
  }
}

/**
 * A source is "available" when its last attempt succeeded OR it is configured.
 * Mirrors the configuration logic in mandi.service.js — presence only, never the secret.
 */
function sourceConfigured(code, mandiConfig) {
  if (code === 'DATA_GOV_IN') return Boolean(mandiConfig.dataGovApiKey);
  if (code === 'CEDA') return Boolean(mandiConfig.cedaApiKey);
  if (code === 'MOCK' || code === 'MOCK_PROVIDER') return Boolean(mandiConfig.allowSampleData);
  return false;
}

export function createQualityReportService({ pool = defaultPool, measureDisk = localMeasureDisk, mandiConfig = config.mandi } = {}) {
  const query = async (sql, values = []) => {
    const result = await pool.query(sql, values);
    return result.rows;
  };

  // `includeSample=false` scopes every canonical count to genuine rows only.
  const sampleFilter = (includeSample) => (includeSample ? '' : ' WHERE is_sample_data = FALSE');
  const logFilter = (includeSample) => (includeSample ? '' : ' WHERE is_sample_data = FALSE');
  const andLogFilter = (includeSample) => (includeSample ? '' : ' AND is_sample_data = FALSE');

  async function readSources() {
    return query(`
      /* qr:sources */
      SELECT s.code, s.label, s.precedence, s.is_sample,
             st.last_attempt_at, st.last_success_at, st.last_status, st.last_error, st.latest_reporting_date
      FROM mandi_sources s
      LEFT JOIN mandi_source_sync_state st ON st.source = s.code
      ORDER BY s.precedence DESC, s.code ASC`);
  }

  async function readCoverage(includeSample) {
    return query(`
      /* qr:coverage */
      SELECT source,
             MIN(reported_date) AS earliest_reporting_date,
             MAX(reported_date) AS latest_reporting_date,
             COUNT(*)::int     AS rows
      FROM mandi_prices_canonical${sampleFilter(includeSample)}
      GROUP BY source
      ORDER BY source ASC`);
  }

  async function readRecordMath(includeSample) {
    const rows = await query(`
      /* qr:records */
      SELECT COUNT(*)::int AS total_rows,
             COUNT(DISTINCT (source, mandi_id, commodity_id, reported_date, variety, grade))::int AS unique_observations,
             COUNT(*) FILTER (WHERE is_sample_data)::int AS sample_rows,
             COUNT(*) FILTER (WHERE NOT is_sample_data)::int AS genuine_rows
      FROM mandi_prices_canonical${sampleFilter(includeSample)}`);
    return rows[0] ?? { total_rows: 0, unique_observations: 0, sample_rows: 0, genuine_rows: 0 };
  }

  async function readStoredPerSource(includeSample) {
    return query(`
      /* qr:stored */
      SELECT source, COUNT(*)::int AS stored
      FROM mandi_prices${sampleFilter(includeSample)}
      GROUP BY source
      ORDER BY source ASC`);
  }

  async function readDownloadedPerSource(includeSample) {
    return query(`
      /* qr:downloaded */
      SELECT source, COALESCE(SUM(records_fetched), 0)::bigint AS downloaded
      FROM pipeline_sync_logs${logFilter(includeSample)}
      GROUP BY source
      ORDER BY source ASC`);
  }

  async function readDuplicates() {
    return query(`
      /* qr:duplicates */
      SELECT source, source_record_key, COUNT(*)::int AS copies
      FROM mandi_prices
      WHERE source_record_key IS NOT NULL AND source_record_key <> ''
      GROUP BY source, source_record_key
      HAVING COUNT(*) > 1
      ORDER BY copies DESC, source ASC, source_record_key ASC`);
  }

  async function readOverlapGroups(includeSample) {
    const rows = await query(`
      /* qr:overlap_groups */
      SELECT COUNT(*)::int AS overlap_groups
      FROM (
        SELECT mandi_id, commodity_id, reported_date
        FROM mandi_prices_canonical${sampleFilter(includeSample)}
        GROUP BY mandi_id, commodity_id, reported_date
        HAVING COUNT(DISTINCT source) > 1
      ) g`);
    return toInt(rows[0]?.overlap_groups);
  }

  async function readOverlapPairs(includeSample) {
    const where = sampleFilter(includeSample);
    return query(`
      /* qr:overlap_pairs */
      SELECT a.source AS source_a, b.source AS source_b, COUNT(*)::int AS groups
      FROM (SELECT DISTINCT mandi_id, commodity_id, reported_date, source FROM mandi_prices_canonical${where}) a
      JOIN (SELECT DISTINCT mandi_id, commodity_id, reported_date, source FROM mandi_prices_canonical${where}) b
        ON a.mandi_id = b.mandi_id AND a.commodity_id = b.commodity_id
       AND a.reported_date = b.reported_date AND a.source < b.source
      GROUP BY a.source, b.source
      ORDER BY groups DESC, source_a ASC, source_b ASC`);
  }

  async function readConflicts() {
    return query(`
      /* qr:conflicts */
      SELECT conflict_type, status, COUNT(*)::int AS conflicts
      FROM mandi_price_conflicts
      GROUP BY conflict_type, status
      ORDER BY conflict_type ASC, status ASC`);
  }

  async function readIntegrity(includeSample) {
    const rows = await query(`
      /* qr:integrity */
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE quality_status = 'REJECTED')::int AS rejected,
        COUNT(*) FILTER (WHERE quality_status = 'VALID')::int    AS valid,
        COUNT(*) FILTER (WHERE quality_status = 'FLAGGED')::int  AS flagged,
        COUNT(*) FILTER (WHERE modal_price IS NULL OR modal_price <= 0)::int AS null_or_nonpositive_modal_price,
        COUNT(*) FILTER (WHERE minimum_price > maximum_price)::int           AS min_greater_than_max,
        COUNT(*) FILTER (WHERE minimum_price IS NULL)::int                   AS null_minimum_price,
        COUNT(*) FILTER (WHERE maximum_price IS NULL)::int                   AS null_maximum_price,
        COUNT(*) FILTER (WHERE minimum_price IS NULL OR maximum_price IS NULL)::int AS null_min_or_max,
        COUNT(*) FILTER (WHERE arrival_quantity IS NULL)::int                AS null_arrivals,
        COUNT(*) FILTER (WHERE reported_date > CURRENT_DATE)::int            AS future_dated,
        COUNT(*) FILTER (WHERE normalized_price_unit IS NULL)::int           AS null_normalized_price_unit
      FROM mandi_prices_canonical${sampleFilter(includeSample)}`);
    return rows[0] ?? {};
  }

  async function readMissingValues(includeSample) {
    const rows = await query(`
      /* qr:missing */
      SELECT COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE variety IS NULL)::int            AS variety,
        COUNT(*) FILTER (WHERE variety_code IS NULL)::int       AS variety_code,
        COUNT(*) FILTER (WHERE arrival_quantity IS NULL)::int   AS arrival_quantity,
        COUNT(*) FILTER (WHERE arrival_unit IS NULL)::int       AS arrival_unit,
        COUNT(*) FILTER (WHERE minimum_price IS NULL)::int      AS minimum_price,
        COUNT(*) FILTER (WHERE maximum_price IS NULL)::int      AS maximum_price,
        COUNT(*) FILTER (WHERE state_code IS NULL)::int         AS state_code,
        COUNT(*) FILTER (WHERE district_code IS NULL)::int      AS district_code,
        COUNT(*) FILTER (WHERE market_code IS NULL)::int        AS market_code,
        COUNT(*) FILTER (WHERE content_hash IS NULL)::int       AS content_hash,
        COUNT(*) FILTER (WHERE source_record_id IS NULL)::int   AS source_record_id
      FROM mandi_prices_canonical${sampleFilter(includeSample)}`);
    return rows[0] ?? {};
  }

  async function readDimensions(includeSample) {
    const rows = await query(`
      /* qr:dimensions */
      SELECT COUNT(DISTINCT commodity)::int AS commodities,
             COUNT(DISTINCT mandi_id)::int   AS mandis,
             COUNT(DISTINCT state)::int      AS states,
             COUNT(DISTINCT district)::int   AS districts,
             COUNT(DISTINCT variety)::int    AS varieties
      FROM mandi_prices_canonical${sampleFilter(includeSample)}`);
    return rows[0] ?? {};
  }

  async function readTopCommodities(includeSample) {
    return query(`
      /* qr:top_commodities */
      SELECT commodity, COUNT(*)::int AS rows
      FROM mandi_prices_canonical${sampleFilter(includeSample)}
      GROUP BY commodity
      ORDER BY rows DESC, commodity ASC
      LIMIT 10`);
  }

  async function readTopMandis(includeSample) {
    return query(`
      /* qr:top_mandis */
      SELECT mandi, state, district, COUNT(*)::int AS rows
      FROM mandi_prices_canonical${sampleFilter(includeSample)}
      GROUP BY mandi, state, district
      ORDER BY rows DESC, mandi ASC
      LIMIT 10`);
  }

  async function readRecordsByYear(includeSample) {
    return query(`
      /* qr:by_year */
      SELECT EXTRACT(YEAR FROM reported_date)::int AS year, COUNT(*)::int AS rows
      FROM mandi_prices_canonical${sampleFilter(includeSample)}
      GROUP BY 1
      ORDER BY 1 ASC`);
  }

  async function readCommodityArrivals(includeSample) {
    return query(`
      /* qr:commodity_arrivals */
      SELECT commodity,
             COUNT(*)::int AS rows,
             COUNT(arrival_quantity)::int AS rows_with_arrivals
      FROM mandi_prices_canonical${sampleFilter(includeSample)}
      GROUP BY commodity
      ORDER BY rows DESC, commodity ASC`);
  }

  async function readRefresh(includeSample) {
    const [state, latest, failed, counts] = await Promise.all([
      query(`/* qr:refresh_state */ SELECT MAX(last_success_at) AS latest_state_success_at FROM mandi_source_sync_state`),
      query(`
        /* qr:refresh_latest */
        SELECT id, source, status, mode, window_from, window_to, records_fetched, records_valid,
               records_inserted, records_updated, records_unchanged, records_rejected, records_failed,
               is_sample_data, error_details, execution_time_ms, started_at, synced_at, triggered_by
        FROM pipeline_sync_logs${logFilter(includeSample)}
        ORDER BY synced_at DESC NULLS LAST, id DESC
        LIMIT 1`),
      query(`
        /* qr:refresh_failed */
        SELECT id, source, status, error_details, started_at, synced_at
        FROM pipeline_sync_logs
        WHERE status IN ('FAILED', 'PARTIAL_SUCCESS')${andLogFilter(includeSample)}
        ORDER BY synced_at DESC NULLS LAST, id DESC
        LIMIT 5`),
      query(`
        /* qr:refresh_counts */
        SELECT COUNT(*)::int AS total_batches,
               COALESCE(SUM(records_fetched), 0)::bigint AS records_fetched,
               COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS successful_batches,
               COUNT(*) FILTER (WHERE status IN ('FAILED', 'PARTIAL_SUCCESS'))::int AS failed_batches,
               MAX(synced_at) FILTER (WHERE status = 'SUCCESS') AS latest_success_at
        FROM pipeline_sync_logs${logFilter(includeSample)}`),
    ]);
    return { state: state[0] ?? {}, latest: latest[0] ?? null, failed, counts: counts[0] ?? {} };
  }

  async function readStorage(includeSample) {
    let sizes = null;
    let sizeError = null;
    try {
      const rows = await query(`
        /* qr:sizes */
        SELECT pg_total_relation_size('mandi_prices')::bigint AS table_bytes,
               pg_indexes_size('mandi_prices')::bigint       AS index_bytes`);
      sizes = rows[0] ?? null;
    } catch (error) {
      sizeError = error.message;
    }
    const rows = await query(`/* qr:physical_rows */ SELECT COUNT(*)::int AS rows FROM mandi_prices${sampleFilter(includeSample)}`);
    return { sizes, sizeError, rows: toInt(rows[0]?.rows) };
  }

  /**
   * @param {{ includeSample?: boolean, diskPath?: string, estimatedFullRunRows?: number|null }} options
   *   estimatedFullRunRows is an OPERATOR ASSUMPTION (how many rows a full ingestion would store);
   *   this service never assumes it. Omit it and estimated_full_run stays null with a reason.
   * @returns {Promise<object>} JSON-serialisable report with the 14 required sections.
   */
  async function generateReport({ includeSample = true, diskPath = null, estimatedFullRunRows = null } = {}) {
    const sourceRows = await readSources();
    const coverageRows = await readCoverage(includeSample);
    const recordMath = await readRecordMath(includeSample);
    const storedRows = await readStoredPerSource(includeSample);
    const downloadedRows = await readDownloadedPerSource(includeSample);
    const duplicateRows = await readDuplicates();
    const overlapGroups = await readOverlapGroups(includeSample);
    const overlapPairs = await readOverlapPairs(includeSample);
    const conflictRows = await readConflicts();
    const integrity = await readIntegrity(includeSample);
    const missing = await readMissingValues(includeSample);
    const dimensions = await readDimensions(includeSample);
    const topCommodities = await readTopCommodities(includeSample);
    const topMandis = await readTopMandis(includeSample);
    const byYear = await readRecordsByYear(includeSample);
    const commodityArrivals = await readCommodityArrivals(includeSample);
    const refresh = await readRefresh(includeSample);
    const storage = await readStorage(includeSample);

    // ---- 2. sources ---------------------------------------------------------
    const sources = sourceRows.map((row) => {
      const configured = sourceConfigured(row.code, mandiConfig);
      const available = row.last_status === 'SUCCESS' || Boolean(row.last_success_at) || configured;
      return {
        code: row.code,
        label: row.label,
        precedence: toNumber(row.precedence),
        is_sample: row.is_sample,
        available,
        last_attempt_at: row.last_attempt_at ?? null,
        last_success_at: row.last_success_at ?? null,
        last_status: row.last_status ?? null,
        last_error: row.last_error ?? null,
        latest_reporting_date: row.latest_reporting_date ?? null,
      };
    });

    // ---- 3. coverage --------------------------------------------------------
    const earliestOverall = coverageRows.reduce(
      (min, r) => (r.earliest_reporting_date && (!min || r.earliest_reporting_date < min) ? r.earliest_reporting_date : min), null);
    const latestOverall = coverageRows.reduce(
      (max, r) => (r.latest_reporting_date && (!max || r.latest_reporting_date > max) ? r.latest_reporting_date : max), null);
    const coverage = {
      earliest_reporting_date: earliestOverall,
      latest_reporting_date: latestOverall,
      per_source: coverageRows.map((r) => ({
        source: r.source,
        earliest_reporting_date: r.earliest_reporting_date ?? null,
        latest_reporting_date: r.latest_reporting_date ?? null,
        rows: toInt(r.rows),
      })),
      ...(coverageRows.length === 0 && { reason: 'no rows in mandi_prices_canonical matched the includeSample filter' }),
      measured: true,
    };

    // ---- 4. records ---------------------------------------------------------
    const downloadedBySource = new Map(downloadedRows.map((r) => [r.source, toInt(r.downloaded)]));
    const storedBySource = new Map(storedRows.map((r) => [r.source, toInt(r.stored)]));
    const allSourceCodes = [...new Set([...downloadedBySource.keys(), ...storedBySource.keys()])].sort();
    const records = {
      include_sample: includeSample,
      downloaded_per_source: allSourceCodes.map((source) => ({ source, downloaded: downloadedBySource.get(source) ?? 0 })),
      stored_per_source: allSourceCodes.map((source) => ({ source, stored: storedBySource.get(source) ?? 0 })),
      stored_total: [...storedBySource.values()].reduce((sum, n) => sum + n, 0),
      unique_observations: toInt(recordMath.unique_observations),
      total_rows: toInt(recordMath.total_rows),
      sample_split: { sample_rows: toInt(recordMath.sample_rows), genuine_rows: toInt(recordMath.genuine_rows) },
      measured: true,
    };

    // ---- 5. duplicates ------------------------------------------------------
    const duplicateRowsTotal = duplicateRows.reduce((sum, r) => sum + (toInt(r.copies) - 1), 0);
    const duplicates = {
      within_source_duplicate_groups: duplicateRows.length,
      duplicate_rows: duplicateRowsTotal,
      groups: duplicateRows.map((r) => ({ source: r.source, source_record_key: r.source_record_key, copies: toInt(r.copies) })),
      note: 'Uniqueness by observation (source, mandi, commodity, reported_date, variety, grade) prevents observation-level duplicates; the unique index uq_mandi_prices_source_record additionally prevents the same source record being stored twice, so a non-zero group count means the index is missing or was bypassed.',
      measured: true,
    };

    // ---- 6. cross_source_overlaps ------------------------------------------
    const crossSourceOverlaps = {
      overlap_groups: overlapGroups,
      breakdown_by_pair: overlapPairs.map((r) => ({ source_a: r.source_a, source_b: r.source_b, groups: toInt(r.groups) })),
      note: 'overlap_groups counts each (mandi_id, commodity_id, reported_date) group once, no matter how many sources reported it; breakdown_by_pair lists unordered source pairs, so a group reported by N sources contributes C(N,2) pairs and the pair groups must not be summed to reproduce overlap_groups.',
      measured: true,
    };

    // ---- 7. conflicts -------------------------------------------------------
    const byStatus = {};
    for (const row of conflictRows) byStatus[row.status] = (byStatus[row.status] ?? 0) + toInt(row.conflicts);
    const conflicts = {
      by_type_and_status: conflictRows.map((r) => ({ conflict_type: r.conflict_type, status: r.status, conflicts: toInt(r.conflicts) })),
      by_status: byStatus,
      total_open: byStatus.OPEN ?? 0,
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      ...(conflictRows.length === 0 && { reason: 'mandi_price_conflicts holds no rows' }),
      measured: true,
    };

    // ---- 8. invalid_records -------------------------------------------------
    const invalidRecords = {
      rejected: toInt(integrity.rejected),
      null_or_nonpositive_modal_price: toInt(integrity.null_or_nonpositive_modal_price),
      min_greater_than_max: toInt(integrity.min_greater_than_max),
      null_min_or_max: toInt(integrity.null_min_or_max),
      null_minimum_price: toInt(integrity.null_minimum_price),
      null_maximum_price: toInt(integrity.null_maximum_price),
      null_arrivals: toInt(integrity.null_arrivals),
      future_dated: toInt(integrity.future_dated),
      null_normalized_price_unit: toInt(integrity.null_normalized_price_unit),
      quality_status: {
        VALID: toInt(integrity.valid),
        FLAGGED: toInt(integrity.flagged),
        REJECTED: toInt(integrity.rejected),
      },
      measured: true,
    };

    // ---- 9. missing_values --------------------------------------------------
    const missingTotal = toInt(missing.total_rows);
    // Output keys follow the report vocabulary; the SQL column for each is named explicitly.
    // arrivals_quantity -> canonical column arrival_quantity; the rest share the column name.
    const missingFields = [
      'variety', 'variety_code', 'arrivals_quantity', 'arrival_unit', 'minimum_price',
      'maximum_price', 'state_code', 'district_code', 'market_code', 'content_hash', 'source_record_id',
    ];
    const missingSqlKey = { arrivals_quantity: 'arrival_quantity' };
    const missingValues = {
      total_rows: missingTotal,
      fields: Object.fromEntries(missingFields.map((field) => {
        const nulls = toInt(missing[missingSqlKey[field] ?? field]);
        return [field, {
          nulls,
          percentage: missingTotal > 0 ? round((nulls / missingTotal) * 100, 2) : null,
          ...(missingTotal === 0 && { reason: 'no rows to measure against' }),
          measured: true,
        }];
      })),
      note: 'arrivals_quantity is the canonical view column arrival_quantity; source_record_id is the canonical view column source_record_id.',
      measured: true,
    };

    // ---- 10. coverage_by_dimension ------------------------------------------
    const coverageByDimension = {
      distinct: {
        commodities: toInt(dimensions.commodities),
        mandis: toInt(dimensions.mandis),
        states: toInt(dimensions.states),
        districts: toInt(dimensions.districts),
        varieties: toInt(dimensions.varieties),
      },
      top_commodities: topCommodities.map((r) => ({ commodity: r.commodity, rows: toInt(r.rows) })),
      top_mandis: topMandis.map((r) => ({ mandi: r.mandi, state: r.state, district: r.district, rows: toInt(r.rows) })),
      measured: true,
    };

    // ---- 11. records_by_year ------------------------------------------------
    const recordsByYear = byYear.map((r) => ({ year: toInt(r.year), rows: toInt(r.rows) }));

    // ---- 12. refresh --------------------------------------------------------
    const counts = refresh.counts ?? {};
    const latestRun = refresh.latest;
    const refreshSection = {
      latest_successful_refresh_at: refresh.state?.latest_state_success_at ?? counts.latest_success_at ?? null,
      latest_successful_sync_at: counts.latest_success_at ?? null,
      total_batches: toInt(counts.total_batches),
      successful_batches: toInt(counts.successful_batches),
      records_fetched_total: toInt(counts.records_fetched),
      latest_run: latestRun
        ? Object.fromEntries(Object.entries(latestRun).map(([k, v]) => [k, v === undefined ? null : v]))
        : null,
      ...(latestRun === null && { latest_run_reason: 'pipeline_sync_logs holds no run matching the includeSample filter' }),
      failed_batches: toInt(counts.failed_batches),
      recent_failed_batches: refresh.failed.map((r) => ({
        id: r.id, source: r.source, status: r.status, error_details: r.error_details ?? null,
        started_at: r.started_at ?? null, synced_at: r.synced_at ?? null,
      })),
      measured: true,
    };

    // ---- 13. incomplete_coverage -------------------------------------------
    // Every entry describes a gap that was actually observed in the query results above.
    const gaps = [];
    for (const source of sources) {
      if (!source.last_success_at && source.last_status !== 'SUCCESS') {
        gaps.push(`source ${source.code}: no successful sync recorded`);
      }
      if (!source.available) {
        gaps.push(`source ${source.code}: not available (no API key configured and no successful sync)`);
      }
      if (source.last_status === 'FAILED' || source.last_status === 'PARTIAL_SUCCESS') {
        gaps.push(`source ${source.code}: last sync ended ${source.last_status}${source.last_error ? ` (${source.last_error})` : ' (no error detail recorded)'}`);
      }
    }
    if (records.total_rows === 0) {
      gaps.push('no price rows stored at all (mandi_prices_canonical returned 0 rows)');
    }
    if (records.sample_split.sample_rows > 0 && records.sample_split.genuine_rows === 0) {
      gaps.push(`all ${records.sample_split.sample_rows} stored row(s) are synthetic sample data (is_sample_data=true); no genuine source data is stored`);
    }
    if (duplicates.within_source_duplicate_groups > 0) {
      gaps.push(`within-source duplicates: ${duplicates.within_source_duplicate_groups} (source, source_record_key) group(s) with more than one row`);
    }
    if (invalidRecords.rejected > 0) {
      gaps.push(`${invalidRecords.rejected} row(s) have quality_status=REJECTED`);
    }
    if (missingValues.fields.arrivals_quantity.nulls > 0) {
      gaps.push(`${missingValues.fields.arrivals_quantity.nulls} row(s) (${missingValues.fields.arrivals_quantity.percentage}%) have no arrival quantity`);
    }
    const commodityGapRows = commodityArrivals.filter((r) => toInt(r.rows) > 0 && toInt(r.rows_with_arrivals) === 0);
    for (const row of commodityGapRows.slice(0, 10)) {
      gaps.push(`commodity ${row.commodity} has no arrivals data (${toInt(row.rows)} row(s))`);
    }
    if (commodityGapRows.length > 10) {
      gaps.push(`and ${commodityGapRows.length - 10} more commodities have no arrivals data`);
    }
    if (invalidRecords.future_dated > 0) {
      gaps.push(`${invalidRecords.future_dated} row(s) are dated in the future (reported_date > CURRENT_DATE)`);
    }
    const presentYears = new Set(recordsByYear.map((r) => r.year));
    if (presentYears.size > 0) {
      const minYear = Math.min(...presentYears);
      const maxYear = Math.max(...presentYears);
      let reported = 0;
      for (let year = minYear; year <= maxYear && reported < 20; year += 1) {
        if (!presentYears.has(year)) {
          gaps.push(`0 rows for year ${year}`);
          reported += 1;
        }
      }
      if (reported === 20 && maxYear - minYear + 1 - presentYears.size > 20) {
        gaps.push(`and more empty years between ${minYear} and ${maxYear}`);
      }
    } else {
      gaps.push('0 rows for any year (no reported_date values)');
    }
    if (refreshSection.latest_successful_sync_at === null && refreshSection.total_batches > 0) {
      gaps.push('pipeline_sync_logs: no successful run recorded');
    }
    if (refreshSection.failed_batches > 0) {
      gaps.push(`${refreshSection.failed_batches} pipeline batch(es) ended FAILED/PARTIAL_SUCCESS`);
    }
    if (missingValues.fields.content_hash.nulls > 0) {
      gaps.push(`${missingValues.fields.content_hash.nulls} row(s) (${missingValues.fields.content_hash.percentage}%) have no content_hash (a re-download cannot be proven byte-identical)`);
    }
    if (invalidRecords.null_normalized_price_unit > 0) {
      gaps.push(`${invalidRecords.null_normalized_price_unit} row(s) have no normalized_price_unit`);
    }

    // ---- 14. storage --------------------------------------------------------
    const disk = diskPath === null
      ? { path: null, free_bytes: null, free_gb: null, measured: false, reason: 'no diskPath supplied to generateReport()' }
      : await measureDisk(diskPath);
    const tableBytes = storage.sizes ? toNumber(storage.sizes.table_bytes) : null;
    const indexBytes = storage.sizes ? toNumber(storage.sizes.index_bytes) : null;
    const physicalRows = storage.rows;
    const meanBytesPerRow = tableBytes !== null && physicalRows > 0 ? round(tableBytes / physicalRows, 2) : null;
    const assumedRows = estimatedFullRunRows === null || estimatedFullRunRows === undefined ? null : Number(estimatedFullRunRows);
    let estimatedFullRun;
    if (assumedRows === null || !Number.isFinite(assumedRows) || assumedRows <= 0) {
      estimatedFullRun = { estimated: true, value_bytes: null, value_gb: null, assumed_rows: null, reason: 'no positive estimatedFullRunRows supplied by the caller; this service never invents a full-run row count' };
    } else if (meanBytesPerRow === null) {
      estimatedFullRun = {
        estimated: true, value_bytes: null, value_gb: null, assumed_rows: assumedRows,
        reason: physicalRows === 0
          ? 'mean bytes/row is undefined because mandi_prices holds 0 rows; nothing to extrapolate from'
          : `table size unavailable (${storage.sizeError ?? 'pg_total_relation_size returned nothing'})`,
      };
    } else {
      const estimatedBytes = Math.round(meanBytesPerRow * assumedRows);
      estimatedFullRun = {
        estimated: true,
        assumed_rows: assumedRows,
        assumption: 'operator-supplied full-ingestion row count extrapolated with the measured mean bytes/row',
        basis: `${meanBytesPerRow} measured bytes/row x ${assumedRows} assumed rows`,
        mean_bytes_per_row_used: meanBytesPerRow,
        value_bytes: estimatedBytes,
        value_gb: round(estimatedBytes / 1024 ** 3, 2),
      };
    }
    const storageSection = {
      disk,
      table_bytes: tableBytes,
      index_bytes: indexBytes,
      rows: physicalRows,
      mean_bytes_per_row: meanBytesPerRow,
      mean_bytes_per_row_basis: meanBytesPerRow === null
        ? (physicalRows === 0 ? 'undefined: 0 rows' : 'undefined: table size unavailable')
        : 'table_bytes / rows, both measured',
      table_bytes_note: 'pg_total_relation_size counts the table plus its indexes and TOAST; index_bytes is reported separately by pg_indexes_size and is therefore already included in table_bytes.',
      ...(storage.sizeError && { size_error: storage.sizeError }),
      estimated_full_run: estimatedFullRun,
      measured: true,
    };

    return {
      generated_at: new Date().toISOString(),
      sources,
      coverage,
      records,
      duplicates,
      cross_source_overlaps: crossSourceOverlaps,
      conflicts,
      invalid_records: invalidRecords,
      missing_values: missingValues,
      coverage_by_dimension: coverageByDimension,
      records_by_year: recordsByYear,
      refresh: refreshSection,
      incomplete_coverage: gaps,
      storage: storageSection,
    };
  }

  return { generateReport };
}

export default createQualityReportService;
