/**
 * FASALYTICS — Phase 5 market API client.
 *
 * Thin, dependency-free client over the five read-only Phase 5 endpoints:
 *
 *   GET /api/commodities
 *   GET /api/mandis
 *   GET /api/mandis/prices/latest
 *   GET /api/mandis/prices/history
 *   GET /api/mandis/data-status
 *
 * Design rules
 * ------------
 * 1. REUSES the existing HTTP layer. The default transport is `apiRequest` from
 *    `services/api.js`, so there is exactly one HTTP client in the app and the
 *    backend's `:5000 -> :5001` fallback still applies. No second `fetch`.
 * 2. INJECTABLE TRANSPORT. `createMarketApi({ request })` accepts any
 *    `(endpoint, options) => Promise<response>` function, so every function here
 *    is unit-testable with no React, no DOM and no network.
 * 3. ERRORS ARE NOT SWALLOWED. Failures reject with the `ApiError` thrown by the
 *    shared layer, keeping `status`, `code`, `message` and `details` intact so a
 *    page can render the backend's real message (`VALIDATION_ERROR`,
 *    `DATABASE_NOT_MIGRATED`, `DATABASE_UNAVAILABLE`, ...). An empty result is a
 *    successful `{ data: [] }`, never an error and never a fabricated row.
 * 4. NO CLAMPING. Out-of-range `limit`/`offset` are forwarded untouched so the
 *    backend answers `400 VALIDATION_ERROR` instead of silently returning a
 *    different page.
 * 5. PURE LOGIC IS EXPORTED. URL building, row shaping, the location cascade,
 *    freshness derivation and day-over-day movement derivation are plain
 *    exported functions with no React dependency (see `test/market-api.test.mjs`).
 * 6. NO INVENTED FRESHNESS. Staleness comes from the backend only
 *    (`meta.stale_days`, and `overall.stale` from `/api/mandis/data-status`).
 *    This module never compares dates against its own threshold.
 * 7. ALERT HISTORY IS ASSEMBLED PER SERIES. `/prices/history` pages GLOBALLY by
 *    date, so one unfiltered page usually holds a single reporting day and
 *    `deriveMovements` then sees no movement at all. `getAlertHistory` resolves
 *    the existing series with `/prices/latest` first and then reads a small page
 *    per series, so every series is compared with its OWN previous reporting day.
 */

// `services/api.js` reads `import.meta.env`, which only exists under Vite. The
// shared client is therefore bound through a dynamic import so every pure
// helper in this module can also be loaded by plain `node --test` (no bundler,
// no DOM). Production still goes through the one `apiRequest` instance.
let sharedRequest = null;

/** Resolves (and memoises) the app's shared HTTP client. */
export async function resolveSharedRequest() {
  if (!sharedRequest) {
    const api = await import('./api.js');
    sharedRequest = (endpoint, options = {}) => api.apiRequest(endpoint, options);
  }
  return sharedRequest;
}

/** Canonical Phase 5 paths. Mounted at `/api` by the backend composition root. */
export const MARKET_ENDPOINTS = Object.freeze({
  commodities: '/api/commodities',
  mandis: '/api/mandis',
  latestPrices: '/api/mandis/prices/latest',
  priceHistory: '/api/mandis/prices/history',
  dataStatus: '/api/mandis/data-status',
});

/**
 * Server-side ranges, mirrored here ONLY to give the UI a sane default and to
 * clamp accidental nonsense client-side. Values inside the range are forwarded
 * verbatim so the backend stays the single authority on what is valid.
 */
export const MARKET_PAGING = Object.freeze({
  commodities: Object.freeze({ min: 1, max: 1000, fallback: 500 }),
  mandis: Object.freeze({ min: 1, max: 1000, fallback: 500 }),
  latestPrices: Object.freeze({ min: 1, max: 200, fallback: 200 }),
  priceHistory: Object.freeze({ min: 1, max: 1000, fallback: 1000 }),
  offset: Object.freeze({ min: 0, max: 1_000_000, fallback: 0 }),
});

export const MARKET_ORDERS = Object.freeze(['ASC', 'DESC']);

/**
 * Stable empty page. Components use this instead of a fresh `[]` literal so a
 * "nothing loaded yet" render keeps the same array identity across renders
 * (otherwise every `useMemo` keyed on the rows re-evaluates each pass).
 */
export const EMPTY_ROWS = Object.freeze([]);

/* ------------------------------------------------------------------ *
 * Small pure helpers
 * ------------------------------------------------------------------ */

const isBlank = (value) =>
  value === undefined || value === null || value === '' ||
  (typeof value === 'string' && value.trim() === '');

/** Integer or null — never NaN, never 0 standing in for "unknown". */
export const intOrNull = (value) => {
  if (isBlank(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

/** Integer or the given fallback (used for paging defaults). */
const intOr = (value, fallback) => intOrNull(value) ?? fallback;

/** Finite number or null. NUMERIC columns arrive as strings from Postgres. */
export const numberOrNull = (value) => {
  if (isBlank(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const textOrNull = (value) => (isBlank(value) ? null : String(value));

const compareText = (a, b) => String(a).localeCompare(String(b), 'en');

const equalsIgnoreCase = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/* ------------------------------------------------------------------ *
 * URL / parameter building
 * ------------------------------------------------------------------ */

/**
 * Builds a query string (including the leading `?`) from a plain object.
 * `undefined`, `null` and `''` are omitted; `false` and `0` are kept, because
 * `includeSample=false` and `offset=0` are meaningful requests. Encoding is
 * delegated to `URLSearchParams`, so spaces, `&`, `/` and non-ASCII names are
 * percent-encoded exactly once.
 */
export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (isBlank(value)) continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const buildUrl = (path, params) => `${path}${buildQuery(params)}`;

/** Drops keys whose value is blank, so a params object only ever lists real requests. */
export function compact(params = {}) {
  const result = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (isBlank(value)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Normalises paging. Out-of-range integers are forwarded unchanged (the backend
 * must reject them, not the client silently absorb them); a value that is not a
 * whole number falls back to the documented default.
 */
export function withPaging(params = {}, bounds = MARKET_PAGING.latestPrices) {
  return {
    ...params,
    limit: intOr(params.limit, bounds.fallback),
    offset: intOr(params.offset, MARKET_PAGING.offset.fallback),
  };
}

/** Filters shared by the latest and history price endpoints. */
function priceFilterParams(filters = {}) {
  return compact({
    commodity: filters.commodityCode,
    commodityCategory: filters.commodityCategory,
    variety: filters.variety,
    state: filters.state,
    district: filters.district,
    // The backend accepts a market name or a numeric market id here.
    mandi: filters.mandiId,
    marketCode: filters.marketCode,
    source: filters.source,
    qualityStatus: filters.qualityStatus,
    includeSample: filters.includeSample,
  });
}

/** Query for `GET /api/mandis/prices/latest` from the Mandis page filter state. */
export function latestPriceParams(filters = {}) {
  return withPaging(
    { ...priceFilterParams(filters), limit: filters.limit, offset: filters.offset },
    MARKET_PAGING.latestPrices,
  );
}

/** Query for `GET /api/mandis/prices/history` (latest filters + range + order). */
export function priceHistoryParams(filters = {}) {
  const order = MARKET_ORDERS.includes(String(filters.order).toUpperCase())
    ? String(filters.order).toUpperCase()
    : 'ASC';
  return {
    ...withPaging(
      { ...priceFilterParams(filters), limit: filters.limit, offset: filters.offset },
      MARKET_PAGING.priceHistory,
    ),
    ...compact({ startDate: filters.startDate, endDate: filters.endDate }),
    order,
  };
}

/* ------------------------------------------------------------------ *
 * Row shaping
 * ------------------------------------------------------------------ */

export function shapeCommodityRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    code: textOrNull(row.commodity_code),
    name: textOrNull(row.commodity),
    category: textOrNull(row.commodity_category),
    varietyCount: intOr(row.variety_count, 0),
    stateCount: intOr(row.state_count, 0),
    observationCount: intOr(row.observation_count, 0),
    firstReportedDate: textOrNull(row.first_reported_date),
    lastReportedDate: textOrNull(row.last_reported_date),
  };
}

export function shapeMandiRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.mandi_id ?? null,
    code: textOrNull(row.market_code),
    name: textOrNull(row.mandi),
    district: textOrNull(row.district),
    state: textOrNull(row.state),
    commodityCount: intOr(row.commodity_count, 0),
    observationCount: intOr(row.observation_count, 0),
    earliestReportedDate: textOrNull(row.earliest_reported_date),
    latestReportedDate: textOrNull(row.latest_reported_date),
  };
}

/**
 * One canonical observation, reshaped for the UI. The untouched `raw` row is
 * kept so the shared helpers in `utils/mandiFeed.js` (`sourceLabel`,
 * `formatReportDate`, `hasTrend`, `formatTrend`) can be reused without editing
 * that module.
 */
export function shapePriceRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.observation_id ?? null,
    commodity: {
      id: row.commodity_id ?? null,
      code: textOrNull(row.commodity_code),
      name: textOrNull(row.commodity),
      category: textOrNull(row.commodity_category),
    },
    mandi: {
      id: row.mandi_id ?? null,
      name: textOrNull(row.mandi),
      code: textOrNull(row.market_code),
      district: textOrNull(row.district),
      state: textOrNull(row.state),
    },
    variety: textOrNull(row.variety),
    grade: textOrNull(row.grade),
    reportedDate: textOrNull(row.reported_date),
    prices: {
      min: numberOrNull(row.minimum_price),
      modal: numberOrNull(row.modal_price),
      max: numberOrNull(row.maximum_price),
      unit: textOrNull(row.normalized_price_unit),
      originalUnit: textOrNull(row.original_price_unit),
    },
    arrivals: {
      quantity: numberOrNull(row.arrival_quantity),
      unit: textOrNull(row.arrival_unit),
    },
    fetchedAt: textOrNull(row.fetched_at),
    source: {
      code: textOrNull(row.source),
      label: textOrNull(row.source_label),
      precedence: numberOrNull(row.source_precedence),
    },
    isSampleData: row.is_sample_data === true,
    qualityStatus: textOrNull(row.quality_status),
    qualityFlags: Array.isArray(row.quality_flags) ? row.quality_flags : [],
    raw: row,
  };
}

/** `{ data: [] }` with HTTP 200 is a legitimate empty result, not a failure. */
export function shapeListResponse(response, shaper) {
  const data = Array.isArray(response?.data) ? response.data : [];
  return {
    status: textOrNull(response?.status),
    rows: data.map(shaper).filter(Boolean),
    count: data.length,
    total: intOr(response?.total, data.length),
    limit: intOr(response?.limit, null),
    offset: intOr(response?.offset, null),
  };
}

export function shapePriceResponse(response) {
  return {
    ...shapeListResponse(response, shapePriceRow),
    meta: response?.meta ?? null,
    order: textOrNull(response?.order),
  };
}

/**
 * Backend-computed freshness only. The UI NEVER decides staleness with its own
 * threshold: `meta.stale_days` is page-scoped and computed by the backend, and
 * the `stale` boolean / `staleness_threshold_days` come from `/api/mandis/data-status`,
 * which evaluates the whole canonical dataset. When `data-status` is unavailable
 * `isStale` stays `null` and the UI shows the age only — it never invents a verdict.
 */
export function deriveFreshness(meta, dataStatus) {
  const overall = dataStatus?.overall ?? null;
  return {
    pageAgeDays: intOrNull(meta?.stale_days),
    pageLatestGenuineDate: textOrNull(meta?.latest_genuine_reporting_date),
    pageLatestGenuineFetchedAt: textOrNull(meta?.latest_genuine_fetched_at),
    pageGenuineRows: intOr(meta?.genuine_rows, 0),
    pageSampleRows: intOr(meta?.sample_rows, 0),
    isStale: typeof overall?.stale === 'boolean' ? overall.stale : null,
    globalStalenessDays: intOrNull(overall?.staleness_days),
    globalThresholdDays: intOrNull(overall?.staleness_threshold_days),
    globalLatestReportedDate: textOrNull(overall?.latest_reported_date),
    globalObservationCount: intOr(overall?.total_observations, 0),
    sources: Array.isArray(meta?.sources) ? meta.sources : [],
  };
}

/**
 * State -> district -> market cascade for the Mandis page filters, derived from
 * the flat market list. Comparisons are case-insensitive because the API filter
 * is case-insensitive too; the value sent back is the canonical spelling from the
 * API row, never the raw user text.
 */
export function cascadeLocations(mandiRows = [], selected = {}) {
  const rows = (Array.isArray(mandiRows) ? mandiRows : []).filter(Boolean);
  const uniq = (values) => [...new Set(values.filter(Boolean))].sort(compareText);

  const states = uniq(rows.map((row) => row.state));
  const statePool = selected.state ? rows.filter((row) => equalsIgnoreCase(row.state, selected.state)) : rows;
  const districts = uniq(statePool.map((row) => row.district));
  const districtPool = selected.district
    ? statePool.filter((row) => equalsIgnoreCase(row.district, selected.district))
    : statePool;

  const seen = new Set();
  const mandis = [];
  for (const row of districtPool) {
    const key = String(row.id ?? row.code ?? row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    mandis.push(row);
  }

  return {
    states,
    districts,
    mandis,
    selectedMandi: mandis.find((row) => String(row.id) === String(selected.mandiId)) ?? null,
  };
}

/** Distinct, sorted variety names present in a set of shaped price rows. */
export function deriveVarieties(rows = []) {
  const seen = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.variety ?? '').toLowerCase();
    if (key && !seen.has(key)) seen.set(key, row.variety);
  }
  return [...seen.values()].sort(compareText);
}

/* ------------------------------------------------------------------ *
 * Day-over-day movement (derived from /api/mandis/prices/history)
 * ------------------------------------------------------------------ */

/**
 * Bounds for the per-series alert history read. Every one of them is a hard
 * constant so a large dataset can never turn one page render into an unbounded
 * number of requests or rows.
 *
 * `discoveryLimit` is the backend's own maximum for `/prices/latest` (200).
 * `maxSeries` bounds how many series are followed into history at all.
 * `rowsPerSeries` is how many rows are read per series: two distinct reporting
 * days are needed for a movement, and a small surplus absorbs the rows the same
 * day can carry from more than one source.
 * `maxRequests` bounds discovery pages + per-series reads combined.
 */
export const ALERT_HISTORY_LIMITS = Object.freeze({
  discoveryLimit: 200,
  maxSeries: 12,
  rowsPerSeries: 6,
  maxRequests: 13,
  concurrency: 4,
});

/**
 * Percentage change, or null when it cannot be honestly computed (missing value,
 * non-numeric value, or a zero base where a percentage would be meaningless).
 * Never substitutes 0 for "unknown".
 */
export function percentChange(previous, current) {
  const from = numberOrNull(previous);
  const to = numberOrNull(current);
  if (from === null || to === null || from === 0) return null;
  return Math.round(((to - from) / Math.abs(from)) * 1000) / 10;
}

const movementKey = (row) =>
  [
    // The commodity id first: `id` is stable across renames of code or name,
    // which `code` is not, and the grouping must not split a series on a rename.
    row?.commodity?.id ?? row?.commodity?.code ?? '?',
    row?.mandi?.id ?? row?.mandi?.code ?? row?.mandi?.name ?? '?',
    row?.variety ?? '',
  ].join('|');

/**
 * Compares each market/commodity/variety series with its own previous
 * reporting day. The Phase 5 price endpoints do NOT ship `previous_*`/`trend_*`
 * columns (that was the Phase 3 surface), so the comparison is built here from
 * the history rows and only ever from rows the API actually returned.
 *
 * A series with fewer than two DISTINCT reporting days yields no movement at
 * all, which is what the empty state in the UI reports.
 */
export function deriveMovements(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const key = movementKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const movements = [];
  for (const [key, series] of groups) {
    const byDate = new Map();
    for (const row of series) {
      const date = row.reportedDate;
      if (!date) continue;
      const existing = byDate.get(date);
      if (!existing || String(row.id ?? '') > String(existing.id ?? '')) byDate.set(date, row);
    }
    const days = [...byDate.values()].sort((a, b) => compareText(a.reportedDate, b.reportedDate));
    if (days.length < 2) continue;

    const previous = days[days.length - 2];
    const latest = days[days.length - 1];
    movements.push({
      key,
      commodity: latest.commodity,
      mandi: latest.mandi,
      variety: latest.variety,
      reportedDate: latest.reportedDate,
      previousReportedDate: previous.reportedDate,
      price: {
        previous: previous.prices?.modal ?? null,
        current: latest.prices?.modal ?? null,
        percent: percentChange(previous.prices?.modal, latest.prices?.modal),
      },
      arrivals: {
        previous: previous.arrivals?.quantity ?? null,
        current: latest.arrivals?.quantity ?? null,
        percent: percentChange(previous.arrivals?.quantity, latest.arrivals?.quantity),
      },
      units: {
        price: latest.prices?.unit ?? null,
        arrivals: latest.arrivals?.unit ?? null,
      },
      source: latest.source,
      sourceLabel: latest.source?.label ?? null,
      isSampleData: latest.isSampleData,
      fetchedAt: latest.fetchedAt,
    });
  }
  return movements;
}

/**
 * The series that actually exist, read off a `/prices/latest` page: that
 * endpoint returns the newest row per (mandi, commodity, variety), so it is the
 * only cheap way to learn which series are worth a history request.
 *
 * A series with no usable identity is dropped rather than guessed at, and a
 * series without a variety carries no `variety` filter — the backend compares
 * `LOWER(variety) = LOWER(?)`, which never matches a NULL variety, so sending one
 * would ask for a series that cannot exist.
 */
export function deriveSeries(rows = []) {
  const seen = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const commodityCode = textOrNull(row.commodity?.code) ?? textOrNull(row.commodity?.name);
    const mandiId = intOrNull(row.mandi?.id);
    const marketCode = textOrNull(row.mandi?.code);
    if (!commodityCode || (mandiId === null && !marketCode)) continue;

    const variety = textOrNull(row.variety);
    const key = [
      intOrNull(row.commodity?.id) ?? commodityCode,
      mandiId ?? marketCode,
      variety ?? '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.set(key, {
      key,
      commodityCode,
      mandiId,
      marketCode,
      variety,
      latestReportedDate: textOrNull(row.reportedDate),
    });
  }
  return [...seen.values()];
}

/** How many DISTINCT reporting days a set of rows covers (the movement minimum). */
export function countSeriesDays(rows = []) {
  const days = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = textOrNull(row?.reportedDate);
    if (date) days.add(date);
  }
  return days.size;
}

/** Runs `worker` over `items` with at most `limit` calls in flight, order preserved. */
async function mapLimited(items, limit, worker) {
  const list = [...items];
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let cursor = 0;
  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const magnitude = (value) => (value === null || value === undefined ? 0 : Math.abs(value));

/**
 * Ranks movements into the alert list shown by AlertsPage. No threshold is
 * invented here: every series with at least one computable percentage is
 * eligible and the list is simply ordered by how large the move is.
 */
export function buildAlerts(movements = [], { limit = 5 } = {}) {
  const ranked = (Array.isArray(movements) ? movements : [])
    .filter((movement) => movement?.price?.percent !== null || movement?.arrivals?.percent !== null)
    .map((movement) => {
      const byPrice = magnitude(movement.price?.percent);
      const byArrivals = magnitude(movement.arrivals?.percent);
      const driver = byArrivals > byPrice ? 'arrivals' : 'price';
      const value = driver === 'arrivals' ? movement.arrivals?.percent : movement.price?.percent;
      return { movement, driver, value, score: Math.max(byPrice, byArrivals) };
    })
    .sort((a, b) => b.score - a.score || compareText(a.movement.reportedDate, b.movement.reportedDate));

  return ranked.slice(0, Math.max(0, limit)).map((entry, index) => ({
    id: `${entry.movement.key}#${entry.movement.reportedDate}#${index}`,
    driver: entry.driver,
    direction: entry.value > 0 ? 'up' : entry.value < 0 ? 'down' : 'flat',
    percent: entry.value,
    ...entry.movement,
  }));
}

/* ------------------------------------------------------------------ *
 * Error surfacing
 * ------------------------------------------------------------------ */

/**
 * Flattens an `ApiError` (or any thrown value) into what the UI may show.
 * The message is the BACKEND's own text — it is surfaced verbatim rather than
 * replaced by a generic string, because hiding `VALIDATION_ERROR` behind
 * "something went wrong" loses the only actionable information.
 */
export function describeError(error) {
  if (!error) return null;
  return {
    status: intOr(error.status, null),
    code: textOrNull(error.code),
    message: textOrNull(error.message),
    details: Array.isArray(error.details) ? error.details : [],
    isValidation: error.code === 'VALIDATION_ERROR',
    isNetwork: error.code === 'NETWORK_ERROR',
    isUnavailable: ['DATABASE_UNAVAILABLE', 'DATABASE_NOT_MIGRATED'].includes(error.code),
  };
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

function abortError() {
  const error = new Error('The market data request was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Rejects as soon as `signal` aborts. NOTE: `apiRequest` in `services/api.js`
 * does not forward a signal to `fetch`, so this guards the CALLER (stops an
 * in-flight page from committing state) but does not cancel the socket. The
 * signal is still passed through to the transport so an injected request can
 * honour it. See the Phase 5 report — `apiRequest` needs a `signal` option.
 */
export function withAbort(promise, signal) {
  if (!signal || typeof signal.addEventListener !== 'function') return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Default transport: the app's single HTTP client. */
export const defaultMarketRequest = async (endpoint, options = {}) => {
  const request = await resolveSharedRequest();
  return request(endpoint, options);
};

/**
 * Builds the client. `request` defaults to the shared `apiRequest` layer, so
 * production uses one HTTP client; tests inject a stub and assert on the exact
 * endpoint string, the option passthrough and the error propagation.
 */
export function createMarketApi({ request = defaultMarketRequest } = {}) {
  const call = (endpoint, signal) => {
    // An already-aborted caller must not put a request on the wire at all.
    if (signal?.aborted) return Promise.reject(abortError());
    return withAbort(request(endpoint, signal ? { signal } : {}), signal);
  };

  const client = {
    /** Distinct commodities that actually have observations. */
    getCommodities(filters = {}, { signal } = {}) {
      const params = withPaging(
        { category: filters.category, search: filters.search },
        MARKET_PAGING.commodities,
      );
      return call(buildUrl(MARKET_ENDPOINTS.commodities, params), signal)
        .then((res) => shapeListResponse(res, shapeCommodityRow));
    },

    /** Distinct markets that actually have observations. */
    getMandis(filters = {}, { signal } = {}) {
      const params = withPaging(
        {
          state: filters.state,
          district: filters.district,
          search: filters.search,
          commodity: filters.commodity,
        },
        MARKET_PAGING.mandis,
      );
      return call(buildUrl(MARKET_ENDPOINTS.mandis, params), signal)
        .then((res) => shapeListResponse(res, shapeMandiRow));
    },

    /** Latest reported observation per (market, commodity, variety). */
    getLatestPrices(filters = {}, { signal } = {}) {
      const params = latestPriceParams(filters);
      return call(buildUrl(MARKET_ENDPOINTS.latestPrices, params), signal)
        .then(shapePriceResponse);
    },

    /** Price history for a date range; rows carry no backend trend columns. */
    getPriceHistory(filters = {}, { signal } = {}) {
      const params = priceHistoryParams(filters);
      return call(buildUrl(MARKET_ENDPOINTS.priceHistory, params), signal)
        .then(shapePriceResponse);
    },

    /** Whole-dataset freshness / per-source status. Takes no parameters. */
    getDataStatus({ signal } = {}) {
      return call(MARKET_ENDPOINTS.dataStatus, signal).then((res) => ({
        status: textOrNull(res?.status),
        ...(res?.data ?? {}),
      }));
    },

    /**
     * History assembled so every series can actually be compared with its own
     * previous reporting day.
     *
     * `/prices/history` pages globally by `reported_date DESC`, so a single
     * unfiltered page of 1000 rows is almost always one reporting day: each
     * series appears once, `deriveMovements` skips it and the page renders a
     * permanent "not enough data" empty state. Paging that endpoint globally
     * would only buy more rows of the same newest days.
     *
     * Instead the series are resolved first — `/prices/latest` returns the newest
     * row per (mandi, commodity, variety), so it names the series that exist —
     * and each series then reads its own small newest-first page, which contains
     * only that series' rows. No `startDate` is sent: a date window can only
     * DISCARD reporting days, and a series that reports weekly or monthly would
     * be lost by a window that a daily series would survive. `endDate` is the
     * series' own newest reported date, so the request is pinned to the moment
     * the alert is about.
     *
     * Request and row volume are bounded by `ALERT_HISTORY_LIMITS` and the
     * returned `coverage` says exactly what was covered, so the caller can state
     * a partial picture instead of implying a complete one. Freshness is the
     * backend's own `meta` from the discovery page (newest row per discovered
     * series) — nothing is recomputed here.
     */
    async getAlertHistory(filters = {}, { signal, limits = ALERT_HISTORY_LIMITS } = {}) {
      const cap = { ...ALERT_HISTORY_LIMITS, ...(limits ?? {}) };
      const discoveryLimit = intOr(cap.discoveryLimit, ALERT_HISTORY_LIMITS.discoveryLimit);

      const series = [];
      let meta = null;
      let status = null;
      let seriesTotal = 0;
      let requests = 0;
      for (let offset = 0; requests < cap.maxRequests; offset += discoveryLimit) {
        const page = await client.getLatestPrices(
          { ...filters, limit: discoveryLimit, offset },
          { signal },
        );
        requests += 1;
        status ??= page.status;
        meta ??= page.meta;
        series.push(...deriveSeries(page.rows));
        seriesTotal = Math.max(seriesTotal, page.total);
        if (page.rows.length < discoveryLimit) break;
      }

      const wanted = series.slice(0, Math.max(0, cap.maxSeries));
      const pages = await mapLimited(wanted, cap.concurrency, (entry) =>
        client.getPriceHistory(
          {
            ...filters,
            commodityCode: entry.commodityCode,
            mandiId: entry.mandiId === null ? undefined : entry.mandiId,
            marketCode: entry.mandiId === null ? entry.marketCode : undefined,
            variety: entry.variety ?? undefined,
            endDate: entry.latestReportedDate ?? undefined,
            order: 'DESC',
            limit: cap.rowsPerSeries,
            offset: 0,
          },
          { signal },
        ));
      requests += pages.length;

      // The same series can repeat across discovery pages, and a row shared by
      // two reads is still one observation — compare observations, not requests.
      const rows = [];
      const seen = new Set();
      for (const page of pages) {
        for (const row of page.rows) {
          const id = row?.id ?? null;
          if (id !== null) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          rows.push(row);
        }
      }

      const comparable = series.slice(0, wanted.length)
        .filter((entry, index) => countSeriesDays(pages[index]?.rows) >= 2).length;

      return {
        status,
        rows,
        meta,
        series: wanted.map((entry) => entry.key),
        coverage: {
          seriesTotal: Math.max(seriesTotal, series.length),
          seriesDiscovered: series.length,
          seriesRead: wanted.length,
          seriesComparable: comparable,
          requests,
          maxRequests: cap.maxRequests,
          rowLimit: cap.rowsPerSeries,
          // Anything outside `seriesComparable` is coverage the page does not show.
          truncated: Math.max(seriesTotal, series.length) > comparable,
        },
      };
    },
  };

  return client;
}

/** Shared client used by the pages. */
export const marketApi = createMarketApi();

export default marketApi;