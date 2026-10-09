import { BaseMandiProvider, SourceNotConfiguredError } from './base.provider.js';
import { createSourceHttpClient } from '../http.js';
import { nameKey } from '../normalizer.js';

/**
 * CEDA (Centre for Economic Data and Analysis, Ashoka University) — Agmarknet data.
 *
 * THERE IS NO OFFICIAL SPEC, and this header used to claim otherwise. That claim was false
 * and has been removed. The documentation site (https://api.ceda.ashoka.edu.in/documentation/)
 * serves an unconfigured Swagger UI whose `swagger-initializer.js` still points at
 * https://petstore.swagger.io/v2/swagger.json, so CEDA publishes no machine-readable contract
 * and there was never an OpenAPI document to verify anything against.
 *
 * What this adapter is actually built from, measured live on 2026-10-09 with a real key:
 *   1. observed HTTP responses, and
 *   2. request bodies recovered from the CEDA portal's own JS bundle
 *      (https://agmarknet.ceda.ashoka.edu.in/_next/static/chunks/app/page-aa7bcb85c5cc9efa.js).
 * Full evidence: docs/phase5/source-investigation/CEDA.md and SUMMARY.md.
 *
 *   base URL  https://api.ceda.ashoka.edu.in/v1/agmarknet                       VERIFIED
 *   auth      `Authorization: Bearer <CEDA_API_KEY>` only — a key in the query
 *             string is rejected with 401                                            VERIFIED
 *   errors    401 no/invalid key, 429 "Too many requests", 404 on unknown routes,
 *             400 with a precise message on the gated routes                      VERIFIED
 *
 * VERIFIED working (GET), envelope `{"output":{"type":"success","message":"Data exists","data":[…]}}`:
 *   GET /commodities  -> flat output.data[], 453 rows, { commodity_id, commodity_name }
 *   GET /geographies  -> flat output.data[], 640 rows, { census_state_id, census_state_name,
 *                        census_district_id, census_district_name }
 *                        (state + district on every row — NOT nested `districts[]`)
 *   Neither catalogue is paginated: both return the complete set in one response.
 *
 * VERIFIED absent:
 *   GET /prices, GET /quantities, GET /markets all return 404 ("Cannot GET /v1/agmarknet/prices").
 *   A sweep of 7 path prefixes x 16 segments x both methods found only POST /prices non-404.
 *
 * PARTIALLY verified, and therefore GATED behind `allowUnverifiedContract` — see
 * `CedaContractUnverifiedError` below. Do not call these by accident:
 *   POST /prices, POST /quantities  the routes exist and answer with a precise validation error
 *                                    `{"type":"error","message":"Commodity id, state id, start and end
 *                                    date are required"}`, but the REQUEST BODY CONTRACT IS UNRESOLVED:
 *                                    bodies containing all four named keys were still rejected.
 *                                    `/prices` is POST-only.
 *   POST /markets                    GET is 404; POST was never reached.
 *   The bodies the old adapter sent (commodity_id / state_id / district_id / market_id / from_date /
 *   to_date) are unconfirmed guesses. The portal bundle instead forwards
 *   {state_id, commodity_id, district_id, calculation_type:"d"|"m", start_date, end_date} plus optional
 *   data_type:"p" and chart_type:"map"|"datadownload" — and that did NOT work when sent directly either.
 *   Neither form is treated as known.
 *
 * UNVERIFIED (do not assume): date coverage; pagination on /prices; the rate-limit recovery window
 *   (429 is real, no numeric limit is published, and it had still not recovered after ~5 minutes);
 *   whether `state_id` in a request even uses the `census_state_id` values `/geographies` returns.
 *
 * CONSEQUENCE: CEDA catalogue discovery works. CEDA price/quantity ingestion does NOT work today and
 * must not be claimed to. Anything that needs price rows must first resolve the `/prices` body contract
 * with CEDA (support request, or a retry after the 429 quota resets) and record the evidence.
 *
 * Units: the CEDA Agmarknet portal labels prices "₹ /quintal" and quantities "Tonne". The API carries
 * no variety or grade, so those stay null. Terms: non-commercial use with attribution to CEDA,
 * Ashoka University — required citation "CEDA Agri Market Data (CEDA-AMD), 2000-2023".
 */
export const CEDA_HISTORICAL_START = '2021-10-01';
export const CEDA_HISTORICAL_END = '2026-09-30';

/**
 * Thrown when a caller reaches for a CEDA endpoint whose request contract could not be verified.
 * The full actionable text is the error message (so it lands in logs), and `unresolved` names the
 * single unknown that blocks the call.
 */
export class CedaContractUnverifiedError extends Error {
  constructor(unresolved, message) {
    super(message);
    this.name = 'CedaContractUnverifiedError';
    this.code = 'CEDA_CONTRACT_UNVERIFIED';
    this.source = 'CEDA';
    this.unresolved = unresolved;
  }
}

/** The one thing we do not know about each gated endpoint. */
export const CEDA_UNVERIFIED_CONTRACTS = Object.freeze({
  markets: 'POST /agmarknet/markets request body (GET is 404; POST was never reached)',
  prices: 'POST /agmarknet/prices request body (POST-only; the gateway answers every variant tried with 400 '
    + '"Commodity id, state id, start and end date are required")',
  quantities: 'POST /agmarknet/quantities request body (POST-only; same unresolved 400 as /prices)',
});

function unverifiedContractMessage(endpoint) {
  return [
    `CEDA ${endpoint} request contract is UNVERIFIED and is blocked by default.`,
    `Unresolved: ${CEDA_UNVERIFIED_CONTRACTS[endpoint]}.`,
    'CEDA publishes no OpenAPI document (its Swagger UI still points at petstore.swagger.io), so the field names the',
    'older adapter sent were never confirmed and the live gateway rejects them. Do not guess further: resolve the body',
    'with CEDA (support request, or a retry after the 429 quota resets), record the evidence in',
    'docs/phase5/source-investigation/CEDA.md, then construct the client with allowUnverifiedContract: true to enable',
    'this call path deliberately. CEDA price and quantity ingestion does not work today.',
  ].join(' ');
}

export class CedaClient {
  constructor({
    apiKey = '',
    baseUrl = 'https://api.ceda.ashoka.edu.in/v1',
    http,
    httpOptions = {},
    allowUnverifiedContract = false,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.http = http || createSourceHttpClient(httpOptions);
    this.allowUnverifiedContract = allowUnverifiedContract === true;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async #call(method, path, body, signal) {
    if (!this.isConfigured()) {
      throw new SourceNotConfiguredError('CEDA', 'CEDA_API_KEY is not configured; CEDA requests are unavailable.');
    }
    const { data } = await this.http.requestJson(`${this.baseUrl}${path}`, {
      method,
      body,
      signal,
      label: 'CEDA',
      headers: { Authorization: `Bearer ${this.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    });
    return data;
  }

  /**
   * Gate for the endpoints whose request body could not be verified. Runs before any HTTP call,
   * so the unresolved path is never hit by accident. Opt in with allowUnverifiedContract: true.
   */
  async #callUnverified(method, path, endpoint, body, signal) {
    if (!this.allowUnverifiedContract) {
      throw new CedaContractUnverifiedError(CEDA_UNVERIFIED_CONTRACTS[endpoint], unverifiedContractMessage(endpoint));
    }
    return this.#call(method, path, body, signal);
  }

  /** GET /agmarknet/commodities — VERIFIED: flat `output.data[]` of { commodity_id, commodity_name }. */
  async listCommodities({ signal } = {}) {
    const data = await this.#call('GET', '/agmarknet/commodities', undefined, signal);
    return Array.isArray(data?.output?.data) ? data.output.data : [];
  }

  /** GET /agmarknet/geographies — VERIFIED: flat `output.data[]`, one row per state+district pair. */
  async listGeographies({ signal } = {}) {
    const data = await this.#call('GET', '/agmarknet/geographies', undefined, signal);
    return Array.isArray(data?.output?.data) ? data.output.data : [];
  }

  async listMarkets({ commodityId, stateId, districtId, indicator = 'price', signal }) {
    const data = await this.#callUnverified('POST', '/agmarknet/markets', 'markets',
      { commodity_id: commodityId, state_id: stateId, district_id: districtId, indicator }, signal);
    return Array.isArray(data?.data) ? data.data : [];
  }

  async getPrices({ commodityId, stateId, districtIds, marketIds, fromDate, toDate, signal }) {
    const data = await this.#callUnverified('POST', '/agmarknet/prices', 'prices', {
      commodity_id: commodityId, state_id: stateId,
      ...(districtIds?.length ? { district_id: districtIds } : {}),
      ...(marketIds?.length ? { market_id: marketIds } : {}),
      from_date: fromDate, to_date: toDate,
    }, signal);
    return Array.isArray(data?.data) ? data.data : [];
  }

  async getQuantities({ commodityId, stateId, districtIds, marketIds, fromDate, toDate, signal }) {
    const data = await this.#callUnverified('POST', '/agmarknet/quantities', 'quantities', {
      commodity_id: commodityId, state_id: stateId,
      ...(districtIds?.length ? { district_id: districtIds } : {}),
      ...(marketIds?.length ? { market_id: marketIds } : {}),
      from_date: fromDate, to_date: toDate,
    }, signal);
    return Array.isArray(data?.data) ? data.data : [];
  }
}

/** Splits an inclusive date range into inclusive windows of at most `windowDays` days. */
export function splitDateRange(fromDate, toDate, windowDays) {
  const windows = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (!(start <= end)) return windows;
  for (let cursor = start; cursor <= end;) {
    const windowEnd = new Date(cursor);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + windowDays - 1);
    const to = windowEnd < end ? windowEnd : end;
    windows.push({ from: cursor.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    cursor = new Date(to);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

/** Exact (normalised) name or numeric id lookup — never substring matching. */
export function findByNameOrId(items, value, { idKey, nameKey: nameField }) {
  if (value === undefined || value === null || value === '') return null;
  if (/^\d+$/.test(String(value))) return items.find((item) => String(item[idKey]) === String(value)) || null;
  const wanted = nameKey(value);
  return items.find((item) => nameKey(item[nameField]) === wanted) || null;
}

/** Joins CEDA price and quantity rows (same market and date) into raw pipeline records. */
export function buildCedaRecords(priceRows, quantityRows, ctx) {
  const quantities = new Map();
  for (const row of quantityRows || []) quantities.set(`${row.market_id}|${row.date}`, row);
  const fetchedAt = ctx.fetchedAt || new Date().toISOString();
  return (priceRows || []).map((row) => {
    const qty = quantities.get(`${row.market_id}|${row.date}`);
    const quantity = qty?.quantity ?? null;
    return {
      source: 'CEDA',
      is_sample_data: false,
      state: ctx.stateName,
      district: ctx.districtName,
      mandi_name: ctx.marketNames.get(String(row.market_id)) ?? null,
      commodity_name: ctx.commodityName,
      variety: null,
      grade: null,
      price_date: row.date,
      date_format: 'ISO',
      min_price: row.min_price,
      max_price: row.max_price,
      modal_price: row.modal_price,
      price_unit: 'INR/quintal',
      arrivals_quantity: quantity,
      arrival_unit: quantity === null ? null : 'tonne',
      source_record_key: `${row.commodity_id}:${row.market_id}:${row.date}`,
      source_market_id: String(row.market_id),
      source_commodity_id: String(row.commodity_id),
      source_state_id: row.census_state_id === undefined ? null : String(row.census_state_id),
      source_district_id: row.census_district_id === undefined ? null : String(row.census_district_id),
      raw_payload: { price: row, quantity: qty || null },
      fetched_at: fetchedAt,
    };
  });
}

export class CedaProvider extends BaseMandiProvider {
  constructor({
    apiKey = '', baseUrl, client, httpOptions = {}, windowDays = 92, allowUnverifiedContract = false,
  } = {}) {
    super('CEDA');
    this.allowUnverifiedContract = allowUnverifiedContract === true;
    // An injected client keeps its own gate; the flag is forwarded only to one we build here.
    this.client = client || new CedaClient({ apiKey, baseUrl, httpOptions, allowUnverifiedContract: this.allowUnverifiedContract });
    this.windowDays = windowDays;
    this.HISTORICAL_START = CEDA_HISTORICAL_START;
    this.HISTORICAL_END = CEDA_HISTORICAL_END;
  }

  isConfigured() {
    return this.client.isConfigured();
  }

  getHistoricalBounds() {
    return { startDate: this.HISTORICAL_START, endDate: this.HISTORICAL_END };
  }

  /** Resolves names/ids to CEDA numeric ids for one commodity in one district. */
  async resolveScope({ commodity, state, district, signal }) {
    if (!commodity || !state || !district) {
      throw new Error('CEDA requests must name a commodity, state and district (nationwide sweeps are not allowed here)');
    }
    const commodities = await this.client.listCommodities({ signal });
    const commodityItem = findByNameOrId(commodities, commodity, { idKey: 'commodity_id', nameKey: 'commodity_name' });
    if (!commodityItem) throw new Error(`CEDA commodity not found: ${commodity}`);
    const geographies = await this.client.listGeographies({ signal });
    const stateItem = findByNameOrId(geographies, state, { idKey: 'census_state_id', nameKey: 'census_state_name' });
    if (!stateItem) throw new Error(`CEDA state not found: ${state}`);
    // /geographies is flat: one row per state+district pair, so districts are filtered, not nested.
    const districts = geographies.filter((row) => String(row.census_state_id) === String(stateItem.census_state_id));
    const districtItem = findByNameOrId(districts, district, { idKey: 'census_district_id', nameKey: 'census_district_name' });
    if (!districtItem) throw new Error(`CEDA district not found in ${stateItem.census_state_name}: ${district}`);
    const markets = await this.client.listMarkets({
      commodityId: commodityItem.commodity_id,
      stateId: stateItem.census_state_id,
      districtId: districtItem.census_district_id,
      indicator: 'price',
      signal,
    });
    return {
      commodityId: commodityItem.commodity_id,
      commodityName: commodityItem.commodity_name,
      stateId: stateItem.census_state_id,
      stateName: stateItem.census_state_name,
      districtId: districtItem.census_district_id,
      districtName: districtItem.census_district_name,
      markets,
    };
  }

  /**
   * Bounded fetch: one commodity, one district, a date range inside the historical window.
   * NOT USABLE AGAINST THE LIVE API today: resolveScope() reaches POST /markets and this loop reaches
   * POST /prices and /quantities, all three of which are contract-unverified and therefore throw
   * CedaContractUnverifiedError unless the client was built with allowUnverifiedContract: true.
   */
  async fetchRecords({ commodity, state, district, fromDate, toDate, maxRecords = 5000, signal } = {}) {
    if (!this.isConfigured()) {
      throw new SourceNotConfiguredError('CEDA', 'CEDA_API_KEY is not configured; CEDA historical ingestion is unavailable.');
    }
    const from = fromDate || this.HISTORICAL_START;
    const to = toDate || this.HISTORICAL_END;
    const scope = await this.resolveScope({ commodity, state, district, signal });
    const marketIds = scope.markets.map((m) => m.market_id);
    const marketNames = new Map(scope.markets.map((m) => [String(m.market_id), m.market_name]));
    const records = [];
    for (const window of splitDateRange(from, to, this.windowDays)) {
      const request = {
        commodityId: scope.commodityId, stateId: scope.stateId, districtIds: [scope.districtId], marketIds,
        fromDate: window.from, toDate: window.to, signal,
      };
      const prices = await this.client.getPrices(request);
      const quantities = await this.client.getQuantities(request);
      records.push(...buildCedaRecords(prices, quantities, { ...scope, marketNames }));
      if (records.length >= maxRecords) break;
    }
    return records.slice(0, maxRecords);
  }
}

export default CedaProvider;
