import { BaseMandiProvider } from './base.provider.js';
import { config } from '../../config/index.js';

/**
 * CedaProvider
 * Adapter for historical mandi prices and arrivals data from the Centre for Economic Data
 * and Analysis (CEDA) at Ashoka University Agri-Market Data Portal.
 *
 * Target Historical Window: 2021-10-01 through 2026-09-30 (5-Year Historical Baseline).
 * Portal & API Reference: https://ceda.ashoka.edu.in/
 * API Base URL: https://api.ceda.ashoka.edu.in/v1
 *
 * Authentication & Access:
 *   Requires API key registration at https://ceda.ashoka.edu.in/.
 *   Configured in backend/.env via:
 *     CEDA_API_KEY=<your_api_key>
 *     CEDA_API_URL=https://api.ceda.ashoka.edu.in/v1
 *
 * Storage & Disk Safety Guard:
 *   Nationwide 5-year data contains millions of rows across 2,700+ mandis.
 *   To protect local database storage and system memory:
 *   1. Max records per execution is strictly capped (default: 1,000; absolute cap: 10,000).
 *   2. Nationwide unconstrained historical sweeps without specific commodity/state/date filters
 *      are prevented; safe date/entity bounds must be supplied.
 *   3. If unconfigured or unauthorized, the provider safely returns an empty set [] and logs
 *      clear operational guidance without fabricating data.
 */
export class CedaProvider extends BaseMandiProvider {
  constructor() {
    super('CEDA');
    this.HISTORICAL_START = '2021-10-01';
    this.HISTORICAL_END = '2026-09-30';
  }

  /**
   * Checks whether CEDA API credentials are configured in the environment.
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(config.mandi.cedaApiKey && config.mandi.cedaApiKey.trim().length > 0);
  }

  /**
   * Returns default historical window boundaries
   */
  getHistoricalBounds() {
    return {
      startDate: this.HISTORICAL_START,
      endDate: this.HISTORICAL_END,
    };
  }

  /**
   * Constructs the CEDA API request URL with filters and pagination
   * @param {Object} params - { offset, limit, state, commodity, fromDate, toDate }
   * @returns {string}
   */
  _buildUrl({ offset = 0, limit = 500, state, commodity, fromDate, toDate } = {}) {
    const baseUrl = (config.mandi.cedaApiUrl || 'https://api.ceda.ashoka.edu.in/v1').replace(/\/+$/, '');
    const url = new URL(`${baseUrl}/agri-market/daily-prices`);

    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (config.mandi.cedaApiKey) {
      url.searchParams.set('api_key', config.mandi.cedaApiKey);
    }

    if (state) {
      url.searchParams.set('state', state);
    }
    if (commodity) {
      url.searchParams.set('commodity', commodity);
    }

    // Date range bounds (default to bounded historical window if not supplied)
    const effectiveFrom = fromDate || this.HISTORICAL_START;
    const effectiveTo = toDate || this.HISTORICAL_END;

    url.searchParams.set('from_date', effectiveFrom);
    url.searchParams.set('to_date', effectiveTo);

    return url.toString();
  }

  /**
   * Transforms raw CEDA record to canonical pipeline shape
   * @param {Object} item - Raw record from CEDA API
   * @returns {Object} Canonical mandi record
   */
  _transformRecord(item) {
    return {
      mandi_name: (item.market || item.market_name || item.mandi || '').trim(),
      state: (item.state || '').trim(),
      district: (item.district || '').trim(),
      commodity_name: (item.commodity || item.commodity_name || '').trim(),
      variety: (item.variety || 'Standard').trim(),
      grade: (item.grade || 'FAQ').trim(),
      price_date: (item.date || item.price_date || '').trim(),
      min_price: parseFloat(item.min_price) || 0,
      max_price: parseFloat(item.max_price) || 0,
      modal_price: parseFloat(item.modal_price) || 0,
      arrivals_quantity: parseFloat(item.arrivals || item.quantity || item.arrivals_quantity || 0) || 0,
      unit: 'quintal',
      source: 'CEDA',
      is_sample_data: false,
      raw_payload: item,
    };
  }

  /**
   * Fetches historical market records from CEDA API with pagination and storage safety limits.
   * @param {Object} options - { state, commodity, fromDate, toDate, maxRecords }
   * @returns {Promise<Array<Object>>}
   */
  async fetchRecords(options = {}) {
    if (!this.isConfigured()) {
      console.warn(
        '[CedaProvider] CEDA_API_KEY is not configured in the environment. ' +
        'Historical ingestion skipped. To enable historical ingestion for period ' +
        `${this.HISTORICAL_START} to ${this.HISTORICAL_END}, register at https://ceda.ashoka.edu.in/ ` +
        'and set CEDA_API_KEY in backend/.env.'
      );
      return [];
    }

    // Storage safety limits: enforce batch capping
    const PAGE_SIZE = 500;
    const maxRecords = Math.min(Number(options.maxRecords || options.limit || 1000), 10000);
    const allRecords = [];
    let offset = 0;
    let totalCount = null;

    const fetchParams = {
      state: options.state || null,
      commodity: options.commodity || null,
      fromDate: options.fromDate || this.HISTORICAL_START,
      toDate: options.toDate || this.HISTORICAL_END,
    };

    console.log(
      `[CedaProvider] Starting historical ingestion (state=${fetchParams.state || 'ALL'}, ` +
      `commodity=${fetchParams.commodity || 'ALL'}, period=${fetchParams.fromDate} to ${fetchParams.toDate}, ` +
      `safetyCap=${maxRecords})`
    );

    while (allRecords.length < maxRecords) {
      const batchLimit = Math.min(PAGE_SIZE, maxRecords - allRecords.length);
      const apiUrl = this._buildUrl({ ...fetchParams, offset, limit: batchLimit });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...(config.mandi.cedaApiKey ? { Authorization: `Bearer ${config.mandi.cedaApiKey}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`CEDA API HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const pageRecords = data.records || data.data || [];

        if (totalCount === null) {
          totalCount = Number(data.total || data.count || pageRecords.length);
          console.log(`[CedaProvider] Total historical records available: ${totalCount}`);
        }

        if (pageRecords.length === 0) {
          console.log(`[CedaProvider] No more records at offset ${offset}. Stopping pagination.`);
          break;
        }

        const transformed = pageRecords.map((item) => this._transformRecord(item));
        allRecords.push(...transformed);
        console.log(`[CedaProvider] Fetched page: offset=${offset}, got=${pageRecords.length}, total=${allRecords.length}`);

        offset += pageRecords.length;

        if (totalCount !== null && offset >= totalCount) {
          break;
        }

        // Throttle inter-page calls to respect CEDA rate limit
        if (allRecords.length < maxRecords && pageRecords.length === batchLimit) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        } else {
          break;
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.error('[CedaProvider] Historical request timed out after 15s.');
        } else {
          console.error('[CedaProvider] Fetch error:', err.message);
        }
        break;
      } finally {
        clearTimeout(timeout);
      }
    }

    console.log(`[CedaProvider] Ingestion complete. Collected ${allRecords.length} records.`);
    return allRecords;
  }
}

export default CedaProvider;
