import { config } from '../config/index.js';
import { MockMandiProvider } from './providers/mock.provider.js';
import { AgmarknetGovProvider } from './providers/agmarknet.provider.js';
import { CedaProvider } from './providers/ceda.provider.js';
import { validateMandiRecord } from './validator.js';
import { normalizeMandiRecord } from './normalizer.js';
import { deduplicateRecords } from './deduplicator.js';
import persister from './persister.js';

/**
 * Mandi Data Pipeline Orchestrator
 * Coordinates: Provider Fetch -> Validation -> Cleaning/Normalization -> Deduplication -> Persistence -> Audit Log
 *
 * Supported providers:
 *   - MOCK: High-fidelity deterministic reference dataset for development/testing
 *   - AGMARKNET: Live Indian Government portal (data.gov.in / Agmarknet)
 *   - CEDA: Historical mandi arrivals and price dataset (Ashoka University CEDA)
 *
 * Supported options for runPipeline():
 *   provider    - 'MOCK' | 'AGMARKNET' | 'CEDA' (defaults to MANDI_DATA_PROVIDER env var, or 'MOCK')
 *   state       - Filter by state name (e.g. 'Maharashtra')
 *   commodity   - Filter by commodity name (e.g. 'Onion')
 *   days        - Number of recent days to fetch (auto-derives fromDate/toDate)
 *   fromDate    - Explicit start date (YYYY-MM-DD)
 *   toDate      - Explicit end date (YYYY-MM-DD)
 *   maxRecords  - Maximum records to collect from provider (default: 2000, capped at 10000)
 *   limit       - Alias for maxRecords (legacy)
 *   crossSource - Boolean: if true, applies cross-source deduplication resolving conflicts by source priority
 */
export class MandiPipeline {
  constructor() {
    this.providers = {
      MOCK: new MockMandiProvider(),
      AGMARKNET: new AgmarknetGovProvider(),
      CEDA: new CedaProvider(),
    };
  }

  /**
   * Returns available registered providers
   */
  getAvailableProviders() {
    return Object.keys(this.providers);
  }

  /**
   * Returns a specific registered provider instance
   */
  getProvider(providerKey) {
    const key = (providerKey || '').toUpperCase();
    return this.providers[key] || null;
  }

  /**
   * Executes the complete data pipeline
   * @param {Object} options - Pipeline execution options
   */
  async runPipeline(options = {}) {
    const startTime = Date.now();
    const providerKey = (options.provider || config.mandi.provider || 'MOCK').toUpperCase();
    const provider = this.providers[providerKey] || this.providers.MOCK;

    console.log(`[MandiPipeline] Starting pipeline run using provider: ${provider.getName()}`);

    const stats = {
      source: provider.getName(),
      status: 'SUCCESS',
      records_fetched: 0,
      records_valid: 0,
      records_rejected: 0,
      records_inserted: 0,
      records_updated: 0,
      error_details: null,
      execution_time_ms: 0,
      is_sample_data: providerKey === 'MOCK',
    };

    try {
      // Build fetch options with strict bounds for disk and storage safety
      const fetchOptions = {
        state: options.state || null,
        commodity: options.commodity || null,
        days: options.days || null,
        fromDate: options.fromDate || null,
        toDate: options.toDate || null,
        maxRecords: Math.min(Number(options.maxRecords || options.limit || 2000), 10000),
      };

      // 1. Fetch
      const rawRecords = await provider.fetchRecords(fetchOptions);
      stats.records_fetched = rawRecords.length;
      console.log(`[MandiPipeline] Fetched ${rawRecords.length} raw records from ${provider.getName()}`);

      // 2. Validate
      const validRecords = [];
      const validationErrors = [];

      for (const rec of rawRecords) {
        const vResult = validateMandiRecord(rec);
        if (vResult.valid) {
          validRecords.push(rec);
        } else {
          stats.records_rejected++;
          validationErrors.push({
            mandi: rec.mandi_name,
            commodity: rec.commodity_name,
            errors: vResult.errors,
          });
        }
      }

      stats.records_valid = validRecords.length;
      if (validationErrors.length > 0) {
        console.warn(`[MandiPipeline] Rejected ${stats.records_rejected} records during validation`);
        if (validationErrors.length <= 5) {
          validationErrors.forEach((e) => console.warn(`  - ${e.mandi}/${e.commodity}: ${e.errors.join('; ')}`));
        }
      }

      // 3. Normalize & Clean
      const normalizedRecords = validRecords.map((rec) => normalizeMandiRecord(rec));

      // 4. Deduplicate (Within-Source or Cross-Source based on option)
      const { uniqueRecords, duplicatesCount } = deduplicateRecords(normalizedRecords, {
        crossSource: Boolean(options.crossSource),
      });

      if (duplicatesCount > 0) {
        console.log(`[MandiPipeline] Removed ${duplicatesCount} duplicates (crossSource=${Boolean(options.crossSource)})`);
      }

      // 5. Persist to PostgreSQL with Idempotent Upsert
      const persistResult = await persister.persistBatch(uniqueRecords);
      stats.records_inserted = persistResult.inserted;
      stats.records_updated = persistResult.updated;

      if (persistResult.failed > 0) {
        stats.status = 'PARTIAL_SUCCESS';
        stats.error_details = `Failed to persist ${persistResult.failed} records in PostgreSQL`;
      }
    } catch (pipelineErr) {
      stats.status = 'FAILED';
      stats.error_details = pipelineErr.message;
      console.error('[MandiPipeline] Critical pipeline failure:', pipelineErr.message);
    } finally {
      stats.execution_time_ms = Date.now() - startTime;
      await persister.logSync(stats);
      console.log(`[MandiPipeline] Pipeline finished in ${stats.execution_time_ms}ms with status: ${stats.status}`);
    }

    return stats;
  }
}

export const mandiPipeline = new MandiPipeline();
export default mandiPipeline;
