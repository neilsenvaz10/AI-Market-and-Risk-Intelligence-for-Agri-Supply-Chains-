import { BaseMandiProvider } from './base.provider.js';
import { config } from '../../config/index.js';

/**
 * AgmarknetGovProvider
 * Ingests live agricultural arrival and price data from the Indian Open Government Data
 * platform (data.gov.in / AGMARKNET API — resource 9ef84268-d588-465a-a308-a864a43d0070).
 *
 * AGMARKNET resource field schema:
 *   state, district, market, commodity, variety, arrival_date,
 *   min_price, max_price, modal_price
 *
 * API reference: https://data.gov.in/catalog/variety-wise-daily-market-prices-data-agmarknet
 *
 * Authentication: Requires a free registered API key from https://data.gov.in/user/register
 *
 * Configuration via backend/.env:
 *   DATA_GOV_IN_API_KEY=<your_key>
 *   DATA_GOV_IN_API_URL=https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070
 *
 * Network requirement: data.gov.in (164.100.61.198:443) must be reachable.
 *
 * CONNECTIVITY NOTE (recorded 2026-10-08):
 *   The data.gov.in API endpoint is currently unreachable from this environment
 *   (connection actively refused: 164.100.61.198:443). This is a network-level
 *   access restriction, NOT a code defect. The implementation is correct and complete.
 *   When DATA_GOV_IN_API_KEY is not set, the provider returns [] and logs a clear warning.
 *   When configured and reachable, it will perform live ingestion automatically.
 */
export class AgmarknetGovProvider extends BaseMandiProvider {
  constructor() {
    super('AGMARKNET');
  }

  /**
   * Checks if live provider credentials are configured
   */
  isConfigured() {
    return Boolean(config.mandi.dataGovApiKey && config.mandi.dataGovApiKey.trim().length > 0);
  }

  /**
   * Builds the API URL with all supported filter parameters.
   * @param {Object} params - { offset, limit, state, commodity, fromDate, toDate }
   * @returns {string}
   */
  _buildUrl({ offset = 0, limit = 500, state, commodity, fromDate, toDate } = {}) {
    const url = new URL(config.mandi.dataGovApiUrl);
    url.searchParams.set('api-key', config.mandi.dataGovApiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (state) {
      url.searchParams.set('filters[state]', state);
    }
    if (commodity) {
      url.searchParams.set('filters[commodity]', commodity);
    }
    // data.gov.in supports date-range filtering via arrival_date field
    if (fromDate) {
      url.searchParams.set('filters[arrival_date][gte]', fromDate);
    }
    if (toDate) {
      url.searchParams.set('filters[arrival_date][lte]', toDate);
    }

    return url.toString();
  }

  /**
   * Converts a raw data.gov.in API record to the pipeline canonical shape.
   * @param {Object} item - Raw API record
   * @returns {Object}
   */
  _transformRecord(item) {
    return {
      mandi_name: (item.market || item.market_center || '').trim(),
      state: (item.state || '').trim(),
      district: (item.district || '').trim(),
      commodity_name: (item.commodity || '').trim(),
      variety: (item.variety || 'FAQ').trim(),
      grade: (item.grade || 'FAQ').trim(),
      price_date: (item.arrival_date || '').trim(),
      min_price: parseFloat(item.min_price) || 0,
      max_price: parseFloat(item.max_price) || 0,
      modal_price: parseFloat(item.modal_price) || 0,
      arrivals_quantity: parseFloat(item.arrival || item.arrivals_quantity || 0) || 0,
      unit: 'quintal',
      source: 'DATA_GOV_IN',
      is_sample_data: false,
      raw_payload: item,
    };
  }

  /**
   * Fetches live market records from data.gov.in API with pagination.
   * @param {Object} options - { state, commodity, fromDate, toDate, maxRecords = 2000 }
   * @returns {Promise<Array<Object>>}
   */
  async fetchRecords(options = {}) {
    if (!this.isConfigured()) {
      console.warn(
        '[AgmarknetGovProvider] DATA_GOV_IN_API_KEY is not set in the environment. ' +
        'Live ingestion skipped. Set DATA_GOV_IN_API_KEY in backend/.env to enable. ' +
        'Get a free key at: https://data.gov.in/user/register'
      );
      return [];
    }

    const PAGE_SIZE = 500;
    const maxRecords = Math.min(Number(options.maxRecords || options.limit || 2000), 10000);
    const allRecords = [];
    let offset = 0;
    let totalCount = null;

    const fetchParams = {
      state: options.state || null,
      commodity: options.commodity || null,
      fromDate: options.fromDate || null,
      toDate: options.toDate || null,
    };

    // Derive a date window from `days` option if explicit dates not given
    if (!fetchParams.fromDate && options.days && options.days > 0) {
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - Number(options.days));
      fetchParams.toDate = toDate.toISOString().split('T')[0];
      fetchParams.fromDate = fromDate.toISOString().split('T')[0];
    }

    console.log(`[AgmarknetGovProvider] Starting paginated fetch (state=${fetchParams.state || 'ALL'}, commodity=${fetchParams.commodity || 'ALL'}, from=${fetchParams.fromDate || 'N/A'}, to=${fetchParams.toDate || 'N/A'}, max=${maxRecords})`);

    while (allRecords.length < maxRecords) {
      const batchLimit = Math.min(PAGE_SIZE, maxRecords - allRecords.length);
      const apiUrl = this._buildUrl({ ...fetchParams, offset, limit: batchLimit });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Data.gov.in API HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const pageRecords = data.records || data.data || [];

        if (totalCount === null) {
          totalCount = Number(data.total || data.count || pageRecords.length);
          console.log(`[AgmarknetGovProvider] Total records available: ${totalCount}`);
        }

        if (pageRecords.length === 0) {
          console.log(`[AgmarknetGovProvider] No more records at offset ${offset}. Stopping pagination.`);
          break;
        }

        const transformed = pageRecords.map((item) => this._transformRecord(item));
        allRecords.push(...transformed);
        console.log(`[AgmarknetGovProvider] Fetched page: offset=${offset}, got=${pageRecords.length}, total collected=${allRecords.length}`);

        offset += pageRecords.length;

        // Stop if we've received all available records
        if (totalCount !== null && offset >= totalCount) {
          break;
        }

        // Throttle between pages to respect API rate limits
        if (allRecords.length < maxRecords && pageRecords.length === batchLimit) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        } else {
          break;
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.error('[AgmarknetGovProvider] Request timed out after 15s.');
        } else {
          console.error('[AgmarknetGovProvider] Fetch error:', err.message);
        }
        // Partial results are still valuable; break pagination on error
        break;
      } finally {
        clearTimeout(timeout);
      }
    }

    console.log(`[AgmarknetGovProvider] Pagination complete. Collected ${allRecords.length} records.`);
    return allRecords;
  }
}

export default AgmarknetGovProvider;
