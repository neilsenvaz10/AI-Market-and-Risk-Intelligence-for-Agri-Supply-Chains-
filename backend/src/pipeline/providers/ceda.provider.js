import { BaseMandiProvider, SourceNotConfiguredError } from './base.provider.js';
import { createSourceHttpClient } from '../http.js';
import { nameKey } from '../normalizer.js';

/**
 * CEDA (Centre for Economic Data and Analysis, Ashoka University) — Agmarknet data.
 *
 * Contract verified against the official OpenAPI document served at
 * https://api.ceda.ashoka.edu.in/documentation/ (CEDA API 1.0.0):
 *   base URL  https://api.ceda.ashoka.edu.in/v1
 *   auth      HTTP Bearer token (Authorization header only — never the query string)
 *   GET  /agmarknet/commodities  -> { commodities: [{ id, name }] }
 *   GET  /agmarknet/geographies  -> { geographies: [{ state_id, state_name, districts: [{ district_id, district_name }] }] }
 *   POST /agmarknet/markets      { commodity_id, state_id, district_id, indicator: 'price'|'quantity' }
 *                                -> { data: [{ census_state_id, census_district_id, market_id, market_name }] }
 *   POST /agmarknet/prices       { commodity_id, state_id, district_id?: [], market_id?: [], from_date, to_date }
 *                                -> { data: [{ date, commodity_id, census_state_id, census_district_id, market_id,
 *                                              min_price, max_price, modal_price }] }
 *   POST /agmarknet/quantities   same request -> { data: [{ date, ..., market_id, quantity }] }
 *   errors: 400 invalid params, 401 missing/invalid token, 429 rate limit, 500.
 * No pagination is documented, so requests are bounded by date windows instead.
 * Units: the CEDA Agmarknet portal labels prices "₹ /quintal" and quantities "Tonne".
 * The API carries no variety or grade, so those stay null.
 * Terms: non-commercial use with attribution to CEDA, Ashoka University.
 */
export const CEDA_HISTORICAL_START = '2021-10-01';
export const CEDA_HISTORICAL_END = '2026-09-30';

export class CedaClient {
  constructor({ apiKey = '', baseUrl = 'https://api.ceda.ashoka.edu.in/v1', http, httpOptions = {} } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.http = http || createSourceHttpClient(httpOptions);
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

  async listCommodities({ signal } = {}) {
    const data = await this.#call('GET', '/agmarknet/commodities', undefined, signal);
    const raw = data?.output?.data || data?.commodities || data?.data || [];
    if (!Array.isArray(raw)) return [];
    return raw.map((c) => ({ id: c.id ?? c.commodity_id, name: c.name ?? c.commodity_name }));
  }

  async listGeographies({ signal } = {}) {
    const data = await this.#call('GET', '/agmarknet/geographies', undefined, signal);
    if (Array.isArray(data?.geographies)) return data.geographies;
    const raw = data?.output?.data || data?.data || [];
    if (!Array.isArray(raw)) return [];
    const stateMap = new Map();
    for (const r of raw) {
      const sId = r.state_id ?? r.census_state_id;
      const sName = r.state_name ?? r.census_state_name;
      const dId = r.district_id ?? r.census_district_id;
      const dName = r.district_name ?? r.census_district_name;
      if (!stateMap.has(sId)) {
        stateMap.set(sId, { state_id: sId, state_name: sName, districts: [] });
      }
      if (dId && dName) {
        stateMap.get(sId).districts.push({ district_id: dId, district_name: dName });
      }
    }
    return Array.from(stateMap.values());
  }

  async listMarkets({ commodityId, stateId, districtId, indicator = 'price', signal }) {
    try {
      const data = await this.#call('POST', '/agmarknet/markets',
        { commodity_id: commodityId, state_id: stateId, district_id: districtId, indicator }, signal);
      const raw = data?.output?.data || data?.data || [];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  async getPrices({ commodityId, stateId, districtIds, marketIds, fromDate, toDate, signal }) {
    const data = await this.#call('POST', '/agmarknet/prices', {
      commodity_id: commodityId, state_id: stateId,
      ...(districtIds?.length ? { district_id: districtIds } : {}),
      ...(marketIds?.length ? { market_id: marketIds } : {}),
      from_date: fromDate, to_date: toDate,
    }, signal);
    const raw = data?.output?.data || data?.data || [];
    return Array.isArray(raw) ? raw : [];
  }

  async getQuantities({ commodityId, stateId, districtIds, marketIds, fromDate, toDate, signal }) {
    const data = await this.#call('POST', '/agmarknet/quantities', {
      commodity_id: commodityId, state_id: stateId,
      ...(districtIds?.length ? { district_id: districtIds } : {}),
      ...(marketIds?.length ? { market_id: marketIds } : {}),
      from_date: fromDate, to_date: toDate,
    }, signal);
    const raw = data?.output?.data || data?.data || [];
    return Array.isArray(raw) ? raw : [];
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
      mandi_name: ctx.marketNames?.get(String(row.market_id)) ?? (row.market_name || (ctx.districtName ? `${ctx.districtName} APMC (${row.market_id})` : null)),
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
  constructor({ apiKey = '', baseUrl, client, httpOptions = {}, windowDays = 92 } = {}) {
    super('CEDA');
    this.client = client || new CedaClient({ apiKey, baseUrl, httpOptions });
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
    const commodityItem = findByNameOrId(commodities, commodity, { idKey: 'id', nameKey: 'name' });
    if (!commodityItem) throw new Error(`CEDA commodity not found: ${commodity}`);
    const geographies = await this.client.listGeographies({ signal });
    const stateItem = findByNameOrId(geographies, state, { idKey: 'state_id', nameKey: 'state_name' });
    if (!stateItem) throw new Error(`CEDA state not found: ${state}`);
    const districtItem = findByNameOrId(stateItem.districts || [], district, { idKey: 'district_id', nameKey: 'district_name' });
    if (!districtItem) throw new Error(`CEDA district not found in ${stateItem.state_name}: ${district}`);
    const markets = await this.client.listMarkets({
      commodityId: commodityItem.id, stateId: stateItem.state_id, districtId: districtItem.district_id, indicator: 'price', signal,
    });
    return {
      commodityId: commodityItem.id,
      commodityName: commodityItem.name,
      stateId: stateItem.state_id,
      stateName: stateItem.state_name,
      districtId: districtItem.district_id,
      districtName: districtItem.district_name,
      markets,
    };
  }

  /** Bounded fetch: one commodity, one district, a date range inside the historical window. */
  async fetchRecords({ commodity, state, district, fromDate, toDate, maxRecords = 5000, signal } = {}) {
    if (!this.isConfigured()) {
      throw new SourceNotConfiguredError('CEDA', 'CEDA_API_KEY is not configured; CEDA historical ingestion is unavailable.');
    }
    const from = fromDate || this.HISTORICAL_START;
    const to = toDate || this.HISTORICAL_END;
    const scope = await this.resolveScope({ commodity, state, district, signal });
    const marketIds = (scope.markets || []).map((m) => m.market_id).filter(Boolean);
    const marketNames = new Map((scope.markets || []).map((m) => [String(m.market_id), m.market_name]));
    const records = [];
    let windowsDone = 0;
    for (const window of splitDateRange(from, to, this.windowDays)) {
      const request = {
        commodityId: scope.commodityId, stateId: scope.stateId, districtIds: [scope.districtId],
        ...(marketIds.length ? { marketIds } : {}),
        fromDate: window.from, toDate: window.to, signal,
      };
      const prices = await this.client.getPrices(request);
      const quantities = await this.client.getQuantities(request);
      records.push(...buildCedaRecords(prices, quantities, { ...scope, marketNames }));
      windowsDone += 1;
      if (records.length >= maxRecords) break;
    }
    const windowsTotal = splitDateRange(from, to, this.windowDays).length;
    this.lastFetchMeta = { truncated: records.length > maxRecords || (records.length >= maxRecords && windowsDone < windowsTotal), daysSkipped: [], daysPartial: [] };
    return records.slice(0, maxRecords);
  }
}

export default CedaProvider;
