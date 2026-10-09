import { BaseMandiProvider, SourceNotConfiguredError } from './base.provider.js';
import { createSourceHttpClient } from '../http.js';

/**
 * DataGovInProvider — Open Government Data Platform India (api.data.gov.in).
 *
 * Resource 9ef84268-d588-465a-a308-a864a43d0070: "Current Daily Price of Various
 * Commodities from Various Markets (Mandi)", published by the Directorate of
 * Marketing and Inspection and generated through the AGMARKNET portal.
 * Records therefore come FROM data.gov.in (source "DATA_GOV_IN"); they are never
 * labelled as fetched from agmarknet.gov.in, which offers no documented API.
 *
 * Contract (OGD API): GET <resource>?api-key=&format=json&offset=&limit=&filters[field]=value
 * The API key is a query parameter by design of the OGD API; it is never logged
 * (see redactUrl) and never stored with the records.
 *
 * Fields: state, district, market, commodity, variety, grade, arrival_date
 * (DD/MM/YYYY), min_price, max_price, modal_price. The resource has no arrivals
 * field, so arrivals stay null. Prices are taken as INR/quintal only when the
 * response field metadata says so; otherwise the AGMARKNET publishing convention
 * (Rs./Quintal) is applied and the row is flagged PRICE_UNIT_FROM_PUBLISHER_CONVENTION.
 */
export const DATA_GOV_IN_RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
const PAGE_SIZE = 500;

const fieldKey = (name) => String(name || '').toLowerCase().replace(/_x0020_/g, '_').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function pick(item, ...names) {
  const wanted = new Set(names);
  for (const [key, value] of Object.entries(item || {})) {
    if (wanted.has(fieldKey(key))) return value;
  }
  return undefined;
}

/** Formats YYYY-MM-DD as the DD/MM/YYYY used by the resource's arrival_date field. */
export function toDmy(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function datesBetween(fromDate, toDate) {
  const dates = [];
  const day = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (day <= end) {
    dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return dates;
}

/** Reads the price unit from the response's field metadata when the API provides it. */
export function priceUnitFromFieldMeta(fields) {
  const labels = (Array.isArray(fields) ? fields : []).map((f) => `${f?.name || ''} ${f?.id || ''}`).join(' ');
  if (/rs\.?\s*\/?\s*quintal|inr\s*\/\s*quintal|per\s+quintal/i.test(labels)) return 'INR/quintal';
  if (/rs\.?\s*\/?\s*kg|inr\s*\/\s*kg|per\s+kg/i.test(labels)) return 'INR/kg';
  return null;
}

export class DataGovInProvider extends BaseMandiProvider {
  constructor({ apiKey = '', apiUrl = '', http, httpOptions = {} } = {}) {
    super('DATA_GOV_IN');
    this.apiKey = apiKey;
    this.apiUrl = apiUrl || `https://api.data.gov.in/resource/${DATA_GOV_IN_RESOURCE_ID}`;
    this.http = http || createSourceHttpClient(httpOptions);
    this.lastFetchMeta = null;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  buildUrl({ offset = 0, limit = PAGE_SIZE, state, district, market, commodity, arrivalDate } = {}) {
    const url = new URL(this.apiUrl);
    url.searchParams.set('api-key', this.apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));
    if (state) url.searchParams.set('filters[state]', state);
    if (district) url.searchParams.set('filters[district]', district);
    if (market) url.searchParams.set('filters[market]', market);
    if (commodity) url.searchParams.set('filters[commodity]', commodity);
    if (arrivalDate) url.searchParams.set('filters[arrival_date]', toDmy(arrivalDate));
    return url.toString();
  }

  transformRecord(item, { priceUnit, fetchedAt }) {
    const fields = {
      state: pick(item, 'state'),
      district: pick(item, 'district'),
      market: pick(item, 'market'),
      commodity: pick(item, 'commodity'),
      variety: pick(item, 'variety'),
      grade: pick(item, 'grade'),
      arrival_date: pick(item, 'arrival_date'),
      min_price: pick(item, 'min_price'),
      max_price: pick(item, 'max_price'),
      modal_price: pick(item, 'modal_price'),
    };
    return {
      source: 'DATA_GOV_IN',
      is_sample_data: false,
      state: fields.state,
      district: fields.district,
      mandi_name: fields.market,
      commodity_name: fields.commodity,
      variety: fields.variety,
      grade: fields.grade,
      price_date: fields.arrival_date,
      date_format: 'DMY',
      min_price: fields.min_price,
      max_price: fields.max_price,
      modal_price: fields.modal_price,
      arrivals_quantity: null,
      arrival_unit: null,
      price_unit: priceUnit || 'INR/quintal',
      price_unit_assumed: !priceUnit,
      source_record_key: [fields.state, fields.district, fields.market, fields.commodity, fields.variety, fields.grade, fields.arrival_date]
        .map((v) => String(v ?? '').trim()).join('|').slice(0, 200),
      raw_payload: item,
      fetched_at: fetchedAt,
    };
  }

  /**
   * Fetches each reporting day in [fromDate, toDate] (inclusive) with an exact
   * arrival_date filter, paging until the source has no more rows or maxRecords.
   */
  async fetchRecords({ state, district, commodity, fromDate, toDate, maxRecords = 2000, signal } = {}) {
    if (!this.isConfigured()) {
      throw new SourceNotConfiguredError('DATA_GOV_IN', 'DATA_GOV_IN_API_KEY is not configured; live data.gov.in ingestion is unavailable.');
    }
    if (!fromDate || !toDate) throw new Error('DataGovInProvider requires fromDate and toDate');
    const records = [];
    const meta = {
      requests: 0, days: datesBetween(fromDate, toDate), totalReported: {}, priceUnitSource: 'publisher-convention',
      truncated: false, daysSkipped: [], daysPartial: [],
    };

    // Newest day first: when maxRecords stops the run, the oldest data is what is left out.
    const newestFirst = [...meta.days].reverse();
    for (const [dayIndex, day] of newestFirst.entries()) {
      let offset = 0;
      if (records.length >= maxRecords) {
        meta.truncated = true;
        meta.daysSkipped.push(...newestFirst.slice(dayIndex));
        break;
      }
      while (records.length < maxRecords) {
        const limit = Math.min(PAGE_SIZE, maxRecords - records.length);
        const url = this.buildUrl({ offset, limit, state, district, commodity, arrivalDate: day });
        meta.requests += 1;
        const { data } = await this.http.requestJson(url, { signal, label: 'data.gov.in' });
        const page = Array.isArray(data?.records) ? data.records : [];
        const priceUnit = priceUnitFromFieldMeta(data?.field);
        if (priceUnit) meta.priceUnitSource = 'response-field-metadata';
        meta.totalReported[day] = Number(data?.total ?? page.length);
        const fetchedAt = new Date().toISOString();
        records.push(...page.map((item) => this.transformRecord(item, { priceUnit, fetchedAt })));
        offset += page.length;
        if (page.length < limit || offset >= meta.totalReported[day]) break;
      }
      if (offset < (meta.totalReported[day] ?? 0)) {
        meta.truncated = true;
        meta.daysPartial.push(day);
      }
    }
    this.lastFetchMeta = meta;
    return records;
  }
}

export default DataGovInProvider;
