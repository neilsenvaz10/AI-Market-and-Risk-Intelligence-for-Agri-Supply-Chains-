import { config } from '../config/index.js';
import { pool as defaultPool } from '../db.js';
import { MockMandiProvider } from './providers/mock.provider.js';
import { DataGovInProvider } from './providers/data-gov-in.provider.js';
import { CedaProvider } from './providers/ceda.provider.js';
import { normalizeMandiRecord } from './normalizer.js';
import { validateMandiRecord } from './validator.js';
import { deduplicateRecords } from './deduplicator.js';
import { MandiPersister, SampleDataWriteError } from './persister.js';
import { redactText } from './http.js';

/**
 * Mandi Data Pipeline Orchestrator
 *   fetch -> normalise -> validate -> de-duplicate -> persist -> conflict detection -> run log
 *
 * Providers:
 *   DATA_GOV_IN  current daily prices from data.gov.in (incremental, with late-report lookback)
 *   CEDA         historical Agmarknet data from CEDA, Ashoka University (bounded scope)
 *   MOCK         synthetic sample data — isolated tests only, refused unless allowed
 *
 * Only one run executes at a time (PostgreSQL advisory lock). Every run, including
 * refused and failed runs, is recorded in pipeline_sync_logs with honest counts.
 */

export const PIPELINE_LOCK_ID = 7_301_301;
export const MAX_RECORDS_PER_RUN = 10000;
const PROVIDER_ALIASES = { AGMARKNET: 'DATA_GOV_IN' };

const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
};

/**
 * Incremental window: always re-reads the last `lookbackDays` (late reports), and
 * reaches back to the last successful window when a gap is longer, capped at maxDays.
 */
export function planIncrementalWindow({ today = isoDay(new Date()), lookbackDays = 3, lastWindowTo = null, maxDays = 30 } = {}) {
  let from = addDays(today, -(lookbackDays - 1));
  if (lastWindowTo) {
    const resume = addDays(lastWindowTo, -(lookbackDays - 1));
    if (resume < from) from = resume;
  }
  const earliest = addDays(today, -(maxDays - 1));
  if (from < earliest) from = earliest;
  return { fromDate: from, toDate: today };
}

export class MandiPipeline {
  constructor({ pool = defaultPool, mandiConfig = config.mandi, providers, persister, log = console } = {}) {
    this.pool = pool;
    this.config = mandiConfig;
    this.log = log;
    const httpOptions = mandiConfig.http;
    this.providers = providers || {
      DATA_GOV_IN: new DataGovInProvider({ apiKey: mandiConfig.dataGovApiKey, apiUrl: mandiConfig.dataGovApiUrl, httpOptions }),
      CEDA: new CedaProvider({ apiKey: mandiConfig.cedaApiKey, baseUrl: mandiConfig.cedaApiUrl, httpOptions, windowDays: mandiConfig.historical.windowDays }),
      MOCK: new MockMandiProvider(),
    };
    this.persister = persister || new MandiPersister({ pool, allowSampleData: mandiConfig.allowSampleData });
  }

  getAvailableProviders() {
    return Object.keys(this.providers);
  }

  getProvider(providerKey) {
    const key = String(providerKey || '').trim().toUpperCase();
    return this.providers[PROVIDER_ALIASES[key] || key] || null;
  }

  async #startRun(client, stats, options) {
    const res = await client.query(
      `INSERT INTO pipeline_sync_logs (source, status, mode, window_from, window_to, is_sample_data, started_at, triggered_by)
       VALUES ($1, 'RUNNING', $2, $3, $4, $5, CURRENT_TIMESTAMP, $6) RETURNING id`,
      [stats.source, stats.mode, stats.window_from, stats.window_to, stats.is_sample_data, options.triggeredBy || 'manual']
    );
    return res.rows[0].id;
  }

  async #finishRun(client, runId, stats) {
    await client.query(
      `UPDATE pipeline_sync_logs SET status = $2, records_fetched = $3, records_valid = $4, records_inserted = $5,
         records_updated = $6, records_rejected = $7, records_unchanged = $8, records_failed = $9,
         conflicts_detected = $10, error_details = $11, execution_time_ms = $12, rejection_summary = $13,
         synced_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [runId, stats.status, stats.records_fetched, stats.records_valid, stats.records_inserted, stats.records_updated,
        stats.records_rejected, stats.records_unchanged, stats.records_failed, stats.conflicts_detected,
        stats.error_details, stats.execution_time_ms, JSON.stringify(stats.rejection_summary)]
    );
    await client.query(
      `INSERT INTO mandi_source_sync_state (source, last_attempt_at, last_status, last_error, last_run_id,
         last_success_at, last_window_from, last_window_to, latest_reporting_date, updated_at)
       SELECT $1::varchar, CURRENT_TIMESTAMP, $2::varchar, $3::text, $4::integer,
              CASE WHEN $5::boolean THEN CURRENT_TIMESTAMP END,
              CASE WHEN $5::boolean THEN $6::date END, CASE WHEN $5::boolean THEN $7::date END,
              $8::date, CURRENT_TIMESTAMP
       WHERE EXISTS (SELECT 1 FROM mandi_sources WHERE code = $1::varchar)
       ON CONFLICT (source) DO UPDATE SET
         last_attempt_at = EXCLUDED.last_attempt_at, last_status = EXCLUDED.last_status, last_error = EXCLUDED.last_error,
         last_run_id = EXCLUDED.last_run_id,
         last_success_at = COALESCE(EXCLUDED.last_success_at, mandi_source_sync_state.last_success_at),
         last_window_from = COALESCE(EXCLUDED.last_window_from, mandi_source_sync_state.last_window_from),
         last_window_to = COALESCE(EXCLUDED.last_window_to, mandi_source_sync_state.last_window_to),
         latest_reporting_date = GREATEST(EXCLUDED.latest_reporting_date, mandi_source_sync_state.latest_reporting_date),
         updated_at = CURRENT_TIMESTAMP`,
      [stats.source, stats.status, stats.error_details, runId, ['SUCCESS', 'NO_DATA'].includes(stats.status),
        stats.window_from, stats.window_to, stats.latest_reporting_date]
    );
  }

  async #lastWindowTo(client, source) {
    const res = await client.query('SELECT last_window_to::text AS d FROM mandi_source_sync_state WHERE source = $1', [source]);
    return res.rows[0]?.d || null;
  }

  /**
   * @param {object} options { provider, state, district, commodity, fromDate, toDate, days,
   *                           maxRecords, crossSource, signal, triggeredBy }
   */
  async runPipeline(options = {}) {
    const startTime = Date.now();
    const requested = String(options.provider ?? this.config.provider ?? '').trim().toUpperCase();
    const providerKey = PROVIDER_ALIASES[requested] || requested;
    const provider = this.providers[providerKey];
    const stats = {
      source: provider ? provider.getSourceCode() : providerKey || 'NONE',
      mode: providerKey === 'CEDA' ? 'HISTORICAL' : 'INCREMENTAL',
      status: 'RUNNING',
      window_from: null,
      window_to: null,
      records_fetched: 0,
      records_valid: 0,
      records_rejected: 0,
      records_inserted: 0,
      records_updated: 0,
      records_unchanged: 0,
      records_failed: 0,
      duplicates_removed: 0,
      conflicts_detected: 0,
      rejection_summary: {},
      persistence_errors: [],
      latest_reporting_date: null,
      error_code: null,
      error_details: null,
      execution_time_ms: 0,
      is_sample_data: Boolean(provider?.isSampleSource()),
    };
    const finish = (status, code = null, details = null) => {
      stats.status = status;
      stats.error_code = code;
      stats.error_details = details;
      stats.execution_time_ms = Date.now() - startTime;
      return stats;
    };

    if (!provider) return finish('FAILED', 'NO_PROVIDER', providerKey ? `Unknown provider "${providerKey}"` : 'No mandi data provider configured');
    if (stats.is_sample_data && !this.config.allowSampleData) {
      return finish('REFUSED', 'SAMPLE_DATA_WRITE_REFUSED', new SampleDataWriteError().message);
    }

    const lockClient = await this.pool.connect();
    let runId = null;
    let locked = false;
    try {
      locked = (await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [PIPELINE_LOCK_ID])).rows[0].locked;
      if (!locked) return finish('SKIPPED', 'ANOTHER_RUN_IN_PROGRESS', 'Another mandi pipeline run is in progress');

      if (options.fromDate || options.toDate) {
        stats.window_from = options.fromDate || options.toDate;
        stats.window_to = options.toDate || options.fromDate;
      } else if (providerKey === 'CEDA') {
        stats.window_from = provider.HISTORICAL_START;
        stats.window_to = provider.HISTORICAL_END;
      } else {
        const lookbackDays = options.days || this.config.syncLookbackDays;
        const window = planIncrementalWindow({ lookbackDays, lastWindowTo: options.days ? null : await this.#lastWindowTo(lockClient, stats.source) });
        stats.window_from = window.fromDate;
        stats.window_to = window.toDate;
      }
      runId = await this.#startRun(lockClient, stats, options);
      stats.run_id = runId;

      const maxRecords = Math.min(Math.max(Number(options.maxRecords) || 2000, 1), MAX_RECORDS_PER_RUN);
      const raw = await provider.fetchRecords({
        state: options.state || null,
        district: options.district || null,
        commodity: options.commodity || null,
        fromDate: stats.window_from,
        toDate: stats.window_to,
        days: options.days || null,
        maxRecords,
        signal: options.signal,
      });
      stats.records_fetched = raw.length;

      const valid = [];
      for (const rawRecord of raw) {
        const record = normalizeMandiRecord(rawRecord);
        const check = validateMandiRecord(record);
        if (check.valid) {
          if (check.warnings.length) record.quality_flags = [...new Set([...record.quality_flags, ...check.warnings])];
          valid.push(record);
        } else {
          stats.records_rejected += 1;
          for (const error of check.errors) stats.rejection_summary[error.code] = (stats.rejection_summary[error.code] || 0) + 1;
        }
      }
      stats.records_valid = valid.length;

      const { uniqueRecords, duplicatesCount, conflicts } = deduplicateRecords(valid, { crossSource: Boolean(options.crossSource) });
      stats.duplicates_removed = duplicatesCount;

      const persisted = await this.persister.persistBatch(uniqueRecords, { runId, batchConflicts: conflicts });
      stats.records_inserted = persisted.inserted;
      stats.records_updated = persisted.updated;
      stats.records_unchanged = persisted.unchanged;
      stats.records_failed = persisted.failed;
      stats.conflicts_detected = persisted.conflicts;
      stats.persistence_errors = persisted.errors.slice(0, 20);
      stats.latest_reporting_date = uniqueRecords.reduce((max, r) => (r.price_date > (max || '') ? r.price_date : max), null);

      if (persisted.failed > 0) finish('PARTIAL_SUCCESS', 'PERSISTENCE_FAILURES', `${persisted.failed} record(s) could not be stored`);
      else if (raw.length === 0) finish('NO_DATA', null, 'The source returned no records for the requested window');
      else finish('SUCCESS');
    } catch (err) {
      const code = err.code || 'PIPELINE_ERROR';
      // Failure text is scrubbed of credentials before it is logged or stored in pipeline_sync_logs.
      const message = redactText(err.message, [this.config.dataGovApiKey, this.config.cedaApiKey]);
      this.log.error?.(`[MandiPipeline] ${stats.source} run failed (${code}): ${message}`);
      finish('FAILED', code, message.slice(0, 500));
    } finally {
      try {
        if (runId !== null) await this.#finishRun(lockClient, runId, stats);
      } catch (logErr) {
        this.log.error?.(`[MandiPipeline] Could not record run ${runId}: ${logErr.message}`);
      }
      if (locked) await lockClient.query('SELECT pg_advisory_unlock($1)', [PIPELINE_LOCK_ID]).catch(() => {});
      lockClient.release();
    }
    this.log.log?.(
      `[MandiPipeline] ${stats.source} ${stats.status}: fetched=${stats.records_fetched} valid=${stats.records_valid} ` +
      `inserted=${stats.records_inserted} updated=${stats.records_updated} unchanged=${stats.records_unchanged} ` +
      `rejected=${stats.records_rejected} failed=${stats.records_failed} conflicts=${stats.conflicts_detected}`
    );
    return stats;
  }
}

export const mandiPipeline = new MandiPipeline();
export default mandiPipeline;
