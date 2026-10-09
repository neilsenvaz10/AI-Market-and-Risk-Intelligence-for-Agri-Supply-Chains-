# Phase 5 — API & UI Reconnaissance (mandi prices)

> Read-only recon of the Express API and React frontend. Every fact below was read from the
> repository at `Syrus 7.0 2`. No existing file was modified.
>
> Scope note: `frontend/src/i18n/strings.js` and `frontend/src/i18n/languages.js` are owned by a
> parallel developer and are reported **by structure only**. They are listed as *do not modify blindly*.
>
> Working tree at recon time (read-only `git status --short`):
> `?? database/migrations/007_phase5_canonical_mandi.sql` — nothing else uncommitted.
> HEAD: `00bd7e4 Phase 4: mandi price forecasting subsystem`.

---

## 1. Existing mandi routes

All existing mandi read routes are **public** (no auth). They are mounted at **`/api/mandi`** (singular)
in `backend/src/app.js:77`:

```js
app.use('/api/mandi', createMandiRoutes({ requireAuth, ...mandiRoutesOptions }));
```

Router body (`backend/src/routes/mandi.routes.js:25-33`):

```js
router.get('/mandis', controller.getMandis);
router.get('/mandis/:id', controller.getMandiDetails);
router.get('/prices/latest', controller.getLatestPrices);
router.get('/prices/history', controller.getPriceHistory);
router.get('/commodities', controller.getCommodities);
router.get('/sync/status', controller.getSyncStatus);
router.get('/quality/report', controller.getDataQualityReport);

router.post('/sync', syncRateLimiter, requireAuth, authorizeIngestion, controller.triggerSync);
```

| # | Method & full path | Query / body params (validator rules) | Auth | Success envelope |
|---|---|---|---|---|
| 1 | `GET /api/mandi/mandis` | `state` text ≤64; `district` text ≤64; `search` text ≤64; `limit` int 1..1000 (default 500); `offset` int 0..1000000 (default 0) | public | `{ status, count, total, limit, offset, data[] }` |
| 2 | `GET /api/mandi/mandis/:id` | `id` path int 1..2147483647 required | public | `{ status:'success', data }`; 404 `MANDI_NOT_FOUND` |
| 3 | `GET /api/mandi/prices/latest` | `commodity` text ≤100; `state` ≤64; `district` ≤64; `mandiId` int 1..2147483647; `source` one of `DATA_GOV_IN,CEDA,MOCK_PROVIDER`; `includeSample` bool (default `true`); `limit` int 1..200 (default 50); `offset` int 0..1000000 | public | `{ status, count, total, limit, offset, meta, data[] }` |
| 4 | `GET /api/mandi/prices/history` | same as #3 **plus** `startDate`/`endDate` real `YYYY-MM-DD` (start ≤ end); `limit` int 1..1000 (default 100); `order` `ASC`\|`DESC` (default `ASC`) | public | `{ status, count, total, limit, offset, order, meta, data[] }` |
| 5 | `GET /api/mandi/commodities` | none | public | `{ status:'success', count, data[] }` |
| 6 | `GET /api/mandi/sync/status` | none | public | `{ status:'success', data:{ stats, sources[], scheduler, recent_syncs[] } }` |
| 7 | `GET /api/mandi/quality/report` | none | public | `{ status:'success', data:{ generated_at, summary, source_coverage[], integrity_audit, quality_flags[], conflicts[], revisions, sync_health, storage_safety } }` |
| 8 | `POST /api/mandi/sync` | body keys only: `provider` (required, one of `DATA_GOV_IN,CEDA,MOCK`), `state`, `district`, `commodity`, `fromDate`, `toDate`, `days` 1..30, `maxRecords`/`limit` 1..5000 (default 2000), `crossSource` bool (default false). Unknown fields rejected. CEDA span ≤366 days, others ≤31 | rate limit → auth → admin claim | 200 `{ status:'success', message, data }`; non-200 `{ status:'error', message, code?, data }` |

Validation is defined in `backend/src/validators/mandi.validator.js`. Documented middleware order
(`mandi.routes.js:6-15`): rate limit (5 / 15 min per IP → 429) → Firebase ID token (401) →
`admin === true` custom claim (403; 503 if unverifiable, fails closed) → body validation (400).

### Sample envelopes (quoted from real code)

`latest` — `backend/src/controllers/mandi.controller.js:48-52`:

```js
getLatestPrices: handle(async (req, res) => {
  const filters = parse(validateLatestQuery, req.query);
  const { rows, total, meta } = await mandiService.getLatestPrices(filters);
  res.status(200).json({ status: 'success', count: rows.length, total, limit: filters.limit, offset: filters.offset, meta, data: rows });
}),
```

`history` — `mandi.controller.js:54-61`:

```js
res.status(200).json({
  status: 'success', count: rows.length, total, limit: filters.limit, offset: filters.offset,
  order: filters.order, meta, data: rows,
});
```

`mandis` — `mandi.controller.js:35-39`:

```js
res.status(200).json({ status: 'success', count: rows.length, total, limit: filters.limit, offset: filters.offset, data: rows });
```

`commodities` — `mandi.controller.js:63-66`:

```js
res.status(200).json({ status: 'success', count: commodities.length, data: commodities });
```

`GET /` advertises the endpoint map (`app.js:59-68`), including
`/api/mandi/mandis`, `/api/mandi/mandis/:id`, `/api/mandi/prices/latest`,
`/api/mandi/prices/history`, `/api/mandi/commodities`, `/api/mandi/sync`,
`/api/mandi/sync/status`, `/api/mandi/quality/report`.

---

## 2. Response shape of `getLatestPrices` and `getPriceHistory` (+ `meta`)

### Row columns

Both queries select `PRICE_COLUMNS` (`backend/src/services/mandi.service.js:16-21`):

```
b.id, b.price_date, b.min_price, b.max_price, b.modal_price, b.arrivals_quantity,
b.price_unit, b.arrival_unit, b.variety, b.grade, b.source,
COALESCE(s.label, b.source) AS source_label,
b.is_sample_data, b.quality_flags, b.fetched_at, b.updated_at,
m.id AS mandi_id, m.code AS mandi_code, m.name AS mandi_name, m.district, m.state,
m.latitude, m.longitude,
c.id AS commodity_id, c.code AS commodity_code, c.name AS commodity_name, c.category AS commodity_category
```

So a row = `id, price_date, min_price, max_price, modal_price, arrivals_quantity, price_unit,
arrival_unit, variety, grade, source, source_label, is_sample_data, quality_flags, fetched_at,
updated_at, mandi_id, mandi_code, mandi_name, district, state, latitude, longitude,
commodity_id, commodity_code, commodity_name, commodity_category`.

`price_date` is a **plain `YYYY-MM-DD` string** (node-postgres DATE parser overridden in
`backend/src/db.js:10-11`). `price_unit` is normalised to `INR/quintal`.

### `getLatestPrices` extras

`shapePriceRow` (`mandi.service.js:44-63`) adds, per row:

- `previous_price_date` — previous report of the **same source + variety + grade**
- `previous_modal_price` — numeric
- `trend_percent` — 1 decimal, `null` when no previous
- `trend_direction` — `'up' | 'down' | 'stable' | 'none'`

`getLatestPrices` keeps only the latest reporting day per `(mandi_id, commodity_id)`.
Returns `{ rows, total, meta: summarisePrices(rows) }` (`mandi.service.js:182`).

### `getPriceHistory` shape — important difference

`getPriceHistory` maps rows with only `total_count` stripped — **it does not call `shapePriceRow`**
(`mandi.service.js:208`). History rows therefore have **no `previous_*` / `trend_*` fields**.
Default `order=ASC` is oldest-first **for the most recent page of rows** (page is selected newest-first,
then re-sorted). SQL at `mandi.service.js:195-206`.

### `meta` — `summarisePrices(rows)`

`backend/src/services/mandi.service.js:66-81`:

```js
export function summarisePrices(rows) {
  const genuine = rows.filter((r) => !r.is_sample_data);
  ...
  return {
    genuine_rows: genuine.length,
    sample_rows: rows.length - genuine.length,
    latest_genuine_reporting_date: maxOf(genuine, 'price_date'),
    latest_sample_reporting_date: maxOf(rows.filter((r) => r.is_sample_data), 'price_date'),
    latest_genuine_fetched_at: maxOf(genuine, 'fetched_at'),
    sources: [...sources].map(([code, label]) => ({ code, label })),
  };
}
```

Exact keys: `genuine_rows`, `sample_rows`, `latest_genuine_reporting_date`,
`latest_sample_reporting_date`, `latest_genuine_fetched_at`, `sources: [{ code, label }]`.

> **Caveat for Phase 5:** `meta` is computed over **the returned page only**, not the whole dataset.
> `genuine_rows + sample_rows === count` of that page; `latest_*` are page maxima. If a client needs
> global freshness, Phase 5 must compute it separately (e.g. in a `data-status` endpoint).

### `getMandiById` detail row

`mandi` fields: `id, code, name, hindi_name, marathi_name, state, district, market_center,
latitude, longitude, created_at, updated_at` plus `current_prices[]` (PRICE_COLUMNS, latest day per
commodity, no trend fields) — `mandi.service.js:120-143`.

### `getCommodities` row

`id, code, name, hindi_name, marathi_name, category, standard_unit` — `mandi.service.js:213-216`.

---

## 3. `mandi_prices_resolved` and `source_label`

`mandi_prices_resolved` is a **database view**, not a table. It is created in
`database/migrations/005_mandi_pipeline_integrity.sql:205-221`:

```sql
-- 8. Resolved view: for each market, commodity and day only the highest-precedence
--    source is returned (all of its varieties), so sources are never summed together.
CREATE OR REPLACE VIEW mandi_prices_resolved AS
SELECT ranked.*
FROM (
    SELECT mp.*,
           COALESCE(s.precedence, 10) AS source_precedence,
           COALESCE(s.label, mp.source) AS source_label,
           DENSE_RANK() OVER (
               PARTITION BY mp.mandi_id, mp.commodity_id, mp.price_date
               ORDER BY COALESCE(s.precedence, 10) DESC, mp.source
           ) AS source_rank,
           COUNT(*) OVER (PARTITION BY mp.mandi_id, mp.commodity_id, mp.price_date) AS rows_for_market_day
    FROM mandi_prices mp
    LEFT JOIN mandi_sources s ON s.code = mp.source
) ranked
WHERE ranked.source_rank = 1;
```

How the service uses it (`mandi.service.js:40`):

```js
const priceSource = (filters) => (filters.source ? 'mandi_prices' : 'mandi_prices_resolved');
```

- **Default** (no `source` filter): `getLatestPrices`/`getPriceHistory` read the **resolved view**, so
  each `(mandi, commodity, price_date)` appears once — the highest-`precedence` source wins.
- **`?source=CEDA`** (etc.): the query reads raw **`mandi_prices`** instead, bypassing de-duplication,
  and filters `b.source = ?`.

`mandi_sources` registry (`005...sql:31-41`) precedence: `DATA_GOV_IN = 40`, `CEDA = 30`,
`MOCK_PROVIDER = 0` (sample). Unknown sources fall back to precedence 10 via `COALESCE`.

`source_label` = `COALESCE(mandi_sources.label, mandi_prices.source)`. It is the **human-readable
attribution string for the row's source** (e.g. "data.gov.in (Agmarknet daily mandi prices)",
"CEDA, Ashoka University (Agmarknet data)", "Synthetic sample data (not real market prices)").
When `is_sample_data = true` the frontend overrides it with the i18n string
`mandiFeed.sampleSource` (`frontend/src/utils/mandiFeed.js:32-35`), so sample rows are never presented
as genuine market data.

Related: migration `007_phase5_canonical_mandi.sql` (currently **untracked / not committed**) adds a
second vocabulary view `mandi_prices_canonical` over the same single physical `mandi_prices` table
(`reported_date = price_date`, `minimum_price = min_price`, `original_price_unit = unit`,
`normalized_price_unit = price_unit`, plus `source_precedence`, `source_label`, `quality_status`).
Phase 5 read paths should read one of these views and must not create a competing price table.

---

## 4. Error conventions

### Envelope

Central handler (`backend/src/middleware/errorHandler.js:17-23`):

```js
res.status(statusCode).json({
  status: 'error',
  ...(err.code && typeof err.code === 'string' && err.expose && { code: err.code }),
  message,
  ...(err.details && { details: err.details }),
  ...(process.env.NODE_ENV === 'development' && isServerError && { stack: err.stack }),
});
```

- `code` is emitted **only when `err.expose === true`** (i.e. an `HttpError` or the auth/rate-limit
  middleware replies). Unexpected 5xx errors are re-messaged to `'Internal Server Error'` and never
  leak SQL/stack. `details` is an array of `{ field, message }` for validation errors.
- 404 fallback (`errorHandler.js:26-30`): `{ status:'error', message:'Cannot GET /x - Route not found' }`
  (no `code`).
- Rate limit (`backend/src/middleware/rateLimit.js:24-27`): 429 + `Retry-After` header and
  `{ status:'error', code, message }`.
- Auth middleware (`backend/src/middleware/auth.js:3-5`, `ingestionAuth.js:24`) replies with the same
  `{ status:'error', code, message }` shape.

### `HttpError`

`backend/src/utils/httpError.js:5-13` — `new HttpError(statusCode, code, message, details)`, sets
`this.expose = true`; consumers call `mapDatabaseError(err)`.

### `mapDatabaseError` (Postgres → HttpError)

`backend/src/utils/httpError.js:15-40`:

| Trigger | Status | `code` |
|---|---|---|
| Any `HttpError` | unchanged | unchanged |
| `DB_UNAVAILABLE_CODES` = `ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ECONNRESET, 57P01, 57P03, 53300, 3D000, 28P01`, or message matches `/timeout|terminated/i` | 503 | `DATABASE_UNAVAILABLE` |
| Postgres `42P01` (undefined_table) | 503 | `DATABASE_NOT_MIGRATED` |
| `23514` (check_violation), `22P02` (invalid_text_representation), `22001` (string_data_right_truncation), `22003` (numeric_value_out_of_range) | 400 | `VALIDATION_ERROR` |
| anything else | rethrown → 500 `Internal Server Error` | — |

### Code inventory (strings that exist in code)

| code | status | source |
|---|---|---|
| `VALIDATION_ERROR` | 400 | controller `invalid(...)` (`mandi.controller.js:12`), `mapDatabaseError` |
| `MANDI_NOT_FOUND` | 404 | `mandi.controller.js:44` |
| `DATABASE_UNAVAILABLE` | 503 | `httpError.js` |
| `DATABASE_NOT_MIGRATED` | 503 | `httpError.js` |
| `RATE_LIMITED` (default) / `SYNC_RATE_LIMITED` | 429 | `rateLimit.js` / `mandi.routes.js:19` |
| `AUTH_REQUIRED` | 401 | `auth.js:22`, `ingestionAuth.js:52` |
| `TOKEN_EXPIRED` | 401 | `auth.js:41` |
| `SESSION_REVOKED` | 401 | `auth.js:44` |
| `INVALID_TOKEN` | 401 | `auth.js:49` |
| `AUTH_NOT_CONFIGURED` / `AUTH_UNAVAILABLE` | 503 | `auth.js:38,47` |
| `INGESTION_FORBIDDEN` | 403 | `ingestionAuth.js:26` |
| `ADMIN_VERIFICATION_UNAVAILABLE` | 503 | `ingestionAuth.js:27` |
| Pipeline body `code` (from `result.error_code`) | via `RUN_ERROR_HTTP` | `mandi.controller.js:22`: `SOURCE_NOT_CONFIGURED`→503, `NO_PROVIDER`→400, `UNAUTHORIZED`→502, `RATE_LIMITED`→503, `NETWORK_ERROR`→502, `TIMEOUT`→504 |
| `RUN_STATUS_HTTP` | `SKIPPED`→409, `REFUSED`→403, `FAILED`→mapped above | `mandi.controller.js:21,80` |

Frontend mirror: `frontend/src/services/api.js:88-91` throws `ApiError(status, code || 'HTTP_<n>',
message, details)`, and `NETWORK_ERROR` (status 0) on transport failure.

---

## 5. Route-registration pattern in `app.js` (factory + DI)

`backend/src/app.js` is the composition root. Pattern:

1. **Module factories per feature.** `createMandiRoutes({ ... })` is imported and invoked once:
   ```js
   export function createApp({
     requireAuth = defaultRequireAuth,
     welcomeEmail = createDefaultWelcomeEmailService(),
     mandiRoutesOptions = {},
   } = {}) {
     ...
     app.use('/api/mandi', createMandiRoutes({ requireAuth, ...mandiRoutesOptions }));
   }
   ```
   (`app.js:27-31`, `app.js:77`.)
2. **Dependency injection end-to-end.** `createMandiRoutes` defaults each collaborator and accepts
   overrides (`mandi.routes.js:16-21`):
   ```js
   export function createMandiRoutes({
     requireAuth,
     authorizeIngestion = createRequireAdminClaim(),
     syncRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, code: 'SYNC_RATE_LIMITED' }),
     controller = createMandiController(),
   } = {}) {
     if (typeof requireAuth !== 'function') throw new Error('createMandiRoutes requires requireAuth middleware');
   ```
   The controller is `createMandiController({ mandiService = defaultMandiService, pipeline = defaultPipeline })`
   (`mandi.controller.js:25`). Services are classes with injectable `pool`
   (`MandiService({ pool = defaultPool, mandiConfig = config.mandi })`, `mandi.service.js:83-87`).
3. **Mounting convention.** All feature routers mount under `/api/<feature>`; `healthRoutes` is the only
   non-factory import. Middleware order is fixed: `cors` → `express.json({ limit: '20kb' })` →
   `urlencoded` → routes → `notFoundHandler` → `errorHandler` (`app.js:36-82`).
4. **Everything a Phase 5 route needs must be reachable through this DI chain** so the DB tests can
   inject `createMandiController({ mandiService: failing(code) })` (`backend/test/db/api.test.js:216-224`).

> **Phase 5 naming note.** The requested Phase 5 paths are **plural, top-level**: `/api/commodities`,
> `/api/mandis`, `/api/mandis/prices/latest`, `/api/mandis/prices/history`, `/api/mandis/data-status`.
> They do **not** collide with the existing `/api/mandi/*` (singular) router, so they can be added as a
> **new factory + new route file** mounted in `app.js` without editing `mandi.routes.js`,
> `mandi.controller.js`, `mandi.service.js` or `mandi.validator.js`.

---

## 6. Frontend data flow — where mandi prices are fetched and rendered

| File | Lines | What it does |
|---|---|---|
| `frontend/src/services/api.js` | 135-175 | Mandi client methods using `fetchWithFallback` |
| `frontend/src/services/api.js` | 8-29 | `fetchWithFallback` — plain `fetch`, `:5000`→`:5001` retry, throws bare `Error('HTTP <n>')`, does **not** parse the error envelope |
| `frontend/src/pages/HomePage.jsx` | 6, 36-52 | `getLatestMandiPrices({ commodity: 'ONION' })`; stores `{status, rows, meta}` |
| `frontend/src/pages/HomePage.jsx` | 59-71, 210-240, 267-366 | Sorts to 3 primary mandis, computes `hasSampleData`/`priceSources`, renders freshness tile + Today's Mandi Prices card |
| `frontend/src/pages/MandisPage.jsx` | 6, 37-51 | `getLatestMandiPrices({ commodity: 'ONION' })`; stores `{status, rows}` (meta dropped) |
| `frontend/src/pages/MandisPage.jsx` | 108-182 | Renders per-mandi cards: name, variety/grade, modal price, district/state, arrivals, reported date, source, trend chip, forecast toggle, route link |
| `frontend/src/components/ForecastPanel.jsx` | 4, 47-66, 157-224 | Phase 4 forecast only — `getForecast(commodity, mandi)`; never renders a forecast as an observed price |
| `frontend/src/utils/mandiFeed.js` | 1-43 | Date/source/trend display helpers |

**No component calls `getMandiPriceHistory`.** `getMandiPriceHistory`, `getMandis`,
`getMandiDetails`, `getCommodities`, `getPipelineStatus`, `triggerMandiSync` and
`getMandiQualityReport` are **defined but not referenced anywhere in the UI** (grep over
`frontend/src` returns only their definitions). Phase 5 will be the first real consumer of history.

### Shape the frontend expects (vs what the backend sends)

`HomePage` consumes: `res.data[]` and `res.meta`.
Row fields read: `id`, `mandi_code`, `mandi_name`, `variety`, `modal_price`, `price_date`,
`trend_direction`, `trend_percent`, `is_sample_data`, `source`, `source_label`.
`meta` fields read: `latest_genuine_reporting_date`, `latest_sample_reporting_date`,
`latest_genuine_fetched_at`.

`MandisPage` consumes: `res.data[]` only.
Row fields read: `id`, `mandi_code`, `mandi_name`, `district`, `state`, `variety`, `grade`,
`modal_price`, `arrivals_quantity`, `price_date`, `is_sample_data`, `source`, `source_label`,
`trend_direction`, `trend_percent`, `mandi_id`, `commodity_code`.

**Mismatches / risks to flag for Phase 5:**

1. `HomePage`'s freshness tile uses page-scoped `meta` while passing `commodity=ONION` with the default
   `limit=50`, so it reflects the **ONION page**, not global freshness. A Phase 5 `data-status`
   endpoint should supply global freshness.
2. `fetchWithFallback` throws `Error('HTTP <n>')` and discards the backend `code`/`message`/`details`.
   All mandi read paths therefore cannot distinguish `VALIDATION_ERROR` from `DATABASE_NOT_MIGRATED`
   from `DATABASE_UNAVAILABLE`. New Phase 5 client code should use `apiRequest`/`ApiError` (or an
   equivalent that parses the envelope) instead of `fetchWithFallback`.
3. `fetchWithFallback` silently switches the whole client to port 5001 after one failure and caches it
   (`api.js:20`) — a latent source of "works on my machine" behaviour.
4. `getPriceHistory` rows lack `trend_*`; a Phase 5 history chart must not assume trend fields.
5. Both pages hard-code `commodity: 'ONION'`; there is no commodity picker yet.

---

## 7. Frontend states + i18n keys

### `MandisPage.jsx`

| State | Condition | i18n key / UI |
|---|---|---|
| loading | `feed.status === 'loading'` | `mandiFeed.loading`; `progress_activity` spinning icon; `role="status"` |
| error | `.status === 'error'` | `mandiFeed.error` + retry button `mandiFeed.retry`; `bg-error-container text-on-error-container`, `error` icon, `role="alert"` |
| empty | `.status === 'ready' && rows.length === 0` | `mandiFeed.empty` |
| ready count | `.status === 'ready'` | `mandis.nearby` pill |
| sample badge | any `row.is_sample_data` | `mandiFeed.sampleBadge` (amber-100/amber-800) |
| trend chip | `hasTrend(row)` | `mandiFeed.vsPrevious`; else `mandiFeed.noEarlierReport` |
| reported date | always | `mandiFeed.reported` with `{ date }` |
| source | always | `mandiFeed.source` with `{ source }` |
| arrivals missing | `arrivals_quantity == null` | `mandiFeed.notReported`; else `unit.tonne` |
| forecast toggle | per card | `forecast.show` / `forecast.hide` |

### `HomePage.jsx`

| State | Condition | i18n key / UI |
|---|---|---|
| price loading | `status === 'loading'` | `mandiFeed.loading` |
| price error | `status === 'error'` | `mandiFeed.error` + `mandiFeed.retry` |
| price empty | `ready && onionPrices.length === 0` | `mandiFeed.empty` |
| sample/demo badge | `hasSampleData` | `home.demoBadge` (card) / `mandiFeed.sampleBadge` (freshness tile) |
| freshness genuine | `meta.latest_genuine_reporting_date` | `home.tile.reportedFetched` (if `fetched`) else `home.tile.reportedDate`; green dot |
| freshness sample-only | else `meta.latest_sample_reporting_date` | `mandiFeed.sampleBadge`; amber dot |
| freshness none | neither date | `home.tile.noMarketData` |
| freshness unavailable | fetch error | `home.tile.feedUnavailable` |
| freshness loading | fetch in flight | `mandiFeed.loading` |
| trend text | `hasTrend(row)` | `mandiFeed.vsPrevious`; else `mandiFeed.noEarlierReport` |
| reported date | per row | `mandiFeed.reported` |
| source line | per row | `mandiFeed.source` with joined `priceSources` |

### `ForecastPanel.jsx`

Follows the same four-state discipline with `forecast.*`: `forecast.loading`, `forecast.error` +
`forecast.retry`, `forecast.noMarketData` / `forecast.insufficient` / `forecast.noForecast` /
`forecast.filtered` (mapped from `reason.code` at `ForecastPanel.jsx:22-27`), `forecast.title`,
`forecast.subtitle`, `forecast.badge`, `forecast.observedTitle`, `forecast.observedPrice`,
`forecast.observedOn`, `forecast.predictedTitle`, `forecast.tomorrow`, `forecast.day`,
`forecast.confidence`, `forecast.intervalNote`, `forecast.sampleBadge`, `forecast.sampleNote`,
`forecast.model`, `forecast.trainedThrough`, `forecast.generatedAt`, `forecast.hide`, `forecast.show`,
`forecast.freshness`.

> Global convention: a failed request is never rendered as stale/fabricated data — the UI shows an
> explicit loading, error or empty state and offers retry. Phase 5 UI must follow the same rule.

### Source attribution & reporting dates (`frontend/src/utils/mandiFeed.js`)

- `formatReportDate(value, language, { year } = {})` — slices to the first 10 chars, validates
  `YYYY-MM-DD`, parses as UTC midnight and formats with `timeZone: 'UTC'` so a reporting **day** never
  shifts to the previous day. Locales `en-IN | hi-IN | mr-IN`.
- `formatFetchedAt(value, language)` — a fetch **instant**, formatted in the viewer's local timezone
  as day + month.
- `sourceLabel(row, language)` — returns `mandiFeed.sampleSource` when `is_sample_data`, else
  `row.source_label || row.source`.
- `hasTrend(row)` — true only when `trend_direction ∈ {up,down,stable}` **and** `trend_percent !== null`.
- `formatTrend(row)` — `+x.x%` / `-x.x%`.

---

## 8. Design-system tokens (use these; do not redesign)

Tailwind theme is in `frontend/tailwind.config.js`. `frontend/src/index.css` adds `pb-safe`, `pt-safe`,
`.no-scrollbar`, `.rounded-br-xs` and an `.animate-spin` keyframe.

**Colour tokens (Tailwind class roots):** `primary`, `on-primary`, `primary-container`,
`on-primary-container`, `primary-fixed`, `primary-fixed-dim`, `on-primary-fixed`,
`on-primary-fixed-variant`, `inverse-primary`, `secondary`, `on-secondary`, `secondary-container`,
`on-secondary-container`, `secondary-fixed`, `secondary-fixed-dim`, `on-secondary-fixed`,
`on-secondary-fixed-variant`, `tertiary`, `on-tertiary`, `tertiary-container`, `on-tertiary-container`,
`tertiary-fixed`, `tertiary-fixed-dim`, `on-tertiary-fixed`, `on-tertiary-fixed-variant`, `error`,
`on-error`, `error-container`, `on-error-container`, `background`, `on-background`, `surface`,
`on-surface`, `surface-variant`, `surface-dim`, `surface-bright`, `surface-tint`,
`surface-container`, `surface-container-low`, `surface-container-lowest`, `surface-container-high`,
`surface-container-highest`, `inverse-surface`, `inverse-on-surface`, `outline`, `outline-variant`.

**Typography tokens** (`font-<token>` + `text-<token>`, sizes in `fontSize`):
`headline-xl` (36/42/700, Barlow Condensed), `headline-lg` (28/34/600), `headline-md` (22/28/600),
`body-lg` (16/24, Inter), `body-md` (14/20), `body-sm` (12/16), `label-lg` (15/22, Noto Sans
Devanagari), `label-md` (13/18). Convention in pages: `font-headline-lg text-headline-lg`,
`text-body-sm`, `font-label-md`.

**Radius tokens:** `rounded` = 0.125rem, `rounded-lg` = 0.25rem, `rounded-xl` = 0.5rem,
`rounded-full` = 0.75rem.

**Spacing tokens:** `p-gutter`/`px-gutter` (1.5rem), `space-xs` (0.25rem), `space-sm` (0.5rem),
`space-md` (1rem), `space-lg` (1.5rem), `space-xl` (2.5rem), `margin` (1.5rem).

**Recurring component recipes** (copy these, do not invent new ones):
- Card/surface: `bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30`
- Error block: `bg-error-container text-on-error-container p-4 rounded-xl shadow-sm` + `role="alert"`
- Success/positive chip: `bg-secondary-container text-on-secondary-container`
- Muted chip: `bg-surface-container-high text-on-surface-variant`
- Sample/warning chip: `bg-amber-100 text-amber-800`
- Primary button: `bg-secondary text-on-secondary ... rounded-lg font-bold active:scale-95`
- Secondary button: `bg-secondary-container text-on-secondary-container ... rounded-lg`
- Loading: `material-symbols-outlined animate-spin text-secondary` with `progress_activity`

**Material Symbols icon names in use for mandi/price UI:** `progress_activity`, `error`, `info`,
`location_on`, `storefront`, `trending_up`, `trending_down`, `trending_flat`, `horizontal_rule`,
`arrow_forward`, `chevron_right`, `warning`, `eco`, `psychology`, `shield`, `payments`, `help`, `mic`,
`home`, `smart_toy`, `notifications`, `person`, `add_to_home_screen`. Icons render as
`<span className="material-symbols-outlined text-[N px]">name</span>`.
Currency is formatted `₹` + `toLocaleString('en-IN')`; units are `unit.quintal` / `unit.tonne`.
**Never hard-code English strings — every user-facing string goes through `t(language, key)`.**

---

## 9. i18n namespaces and key inventory

`frontend/src/i18n/strings.js` = one `STRINGS` object with three sibling language blocks:
`en` (lines 14-373), `hi` (374-733), `mr` (734-1098); `t(lang, key, vars)` at line 1099.
Fallback chain (file header): requested language → English → key name. `{var}` interpolation.
`frontend/src/i18n/languages.js` = `LANGUAGES` (`en`/`hi`/`mr`), `DEFAULT_LANGUAGE = 'en'`,
`isSupportedLanguage`, `languageLabel`.

**Namespace prefixes present (counts are per language):**

| prefix | keys | notes |
|---|---|---|
| (root, no dot) | 30 | auth/onboarding labels + `greeting` |
| `ai` | 23 | Ask AI page |
| `alerts` | 7 | Alerts page |
| `auth` | 56 | auth flows |
| `common` | 5 | shared |
| `forecast` | 26 | Phase 4 forecast panel |
| `header` | 6 | header status pills |
| `home` | 42 | dashboard |
| `mandiFeed` | 11 | mandi price display helpers |
| `mandis` | 15 | Mandis page |
| `nav` | 5 | bottom navigation |
| `onboarding` | 12 | language selection |
| `profile` | 46 | profile |
| `rec` | 28 | recommendation |
| `unit` | 3 | `unit.quintal`, `unit.tonne`, … |

**Totals: `en` = 315, `hi` = 315, `mr` = 315. All three blocks contain exactly the same key set —
zero missing, zero extra in `hi`/`mr` (verified by extraction, including every nested prefix).**

### `mandis.*` (15 keys — identical in en/hi/mr)

`mandis.ahmednagarName`, `mandis.arrival`, `mandis.baramatiName`, `mandis.distance`,
`mandis.modalPrice`, `mandis.nashikName`, `mandis.nearby`, `mandis.puneName`, `mandis.subtitle`,
`mandis.title`, `mandis.viewRoute`, `mandis.volume.high`, `mandis.volume.medium`,
`mandis.volume.moderate`, `mandis.volume.veryHigh`.

Currently **unused in the UI**: `mandis.distance`, `mandis.volume.*`.

### `mandiFeed.*` (11 keys — identical in en/hi/mr)

`mandiFeed.empty`, `mandiFeed.error`, `mandiFeed.loading`, `mandiFeed.noEarlierReport`,
`mandiFeed.notReported`, `mandiFeed.reported`, `mandiFeed.retry`, `mandiFeed.sampleBadge`,
`mandiFeed.sampleSource`, `mandiFeed.source`, `mandiFeed.vsPrevious`. All 11 are used.

### `home.tile.*` (13 keys — identical in en/hi/mr)

`home.tile.aiConf`, `home.tile.aiConfLevel`, `home.tile.aiConfSubtext`, `home.tile.feedUnavailable`,
`home.tile.freshness`, `home.tile.freshnessSubtext`, `home.tile.freshnessUnit`,
`home.tile.noMarketData`, `home.tile.reportedDate`, `home.tile.reportedFetched`, `home.tile.risk`,
`home.tile.riskLevel`, `home.tile.riskSubtext`.

Currently **unused in the UI**: `home.tile.freshnessSubtext`, `home.tile.freshnessUnit`.
Also unused elsewhere in `home.*`: `home.mandiPrices.today`, `home.demoNotice`, `home.demoLabel`.
(`HomePage` uses `home.demoNoticePartial` instead.)

**Verification result: no `mandis.*`, `mandiFeed.*` or `home.tile.*` key is missing in `hi` or `mr`,
and none is extra.** Any Phase 5 key must be added to **all three** blocks to keep the totals equal;
`frontend/scripts/check-i18n.mjs` exists and should be run after adding keys.

---

## 10. Files that must not be modified blindly

| File | Reason |
|---|---|
| `frontend/src/i18n/strings.js` | **Owned by a parallel developer, actively edited.** Add new keys in all three language blocks only; do not reorder, rename, reformat or "clean up" existing keys. |
| `frontend/src/i18n/languages.js` | Same owner. Structure read-only; language codes are persisted as `farmers.preferred_language` in PostgreSQL. |
| `backend/src/db.js` | The DATE type parser (1082 → raw string) is load-bearing for reporting-date correctness. Do not change. |
| `backend/src/utils/httpError.js`, `backend/src/middleware/errorHandler.js` | Every endpoint depends on the `{ status, code, message, details }` contract; changing it silently breaks tests and the client. |
| `backend/src/middleware/auth.js`, `ingestionAuth.js`, `rateLimit.js` | Security-critical: fail-closed admin verification, token handling, pre-auth rate limiting. |
| `backend/src/app.js` | Composition root shared by all features — make **append-only, single-block** edits when registering Phase 5 routers. |
| `database/migrations/005_mandi_pipeline_integrity.sql`, `006_phase4_forecasting.sql` | Applied migrations; never edit in place, add a new numbered migration. |
| `database/migrations/007_phase5_canonical_mandi.sql` | Phase 5's own migration, currently **untracked**. Coordinate before touching; do not duplicate its canonical view/table logic. |
| `backend/src/routes/mandi.routes.js`, `controllers/mandi.controller.js`, `services/mandi.service.js`, `validators/mandi.validator.js` | Phase 3/4 surface under `/api/mandi`; Phase 5's plural paths should not require editing these. |
| `backend/src/pipeline/**` | Ingestion pipeline owned by Phase 3; Phase 5 read endpoints must not alter ingestion behaviour. |
| `frontend/src/pages/HomePage.jsx`, `MandisPage.jsx`, `components/ForecastPanel.jsx` | Shared, currently working UI; change only additively after coordinating, or build new components/pages instead. |

---

## 11. Recommended non-overlapping ownership for Phase 5

Phase 5 adds **new plural, top-level** endpoints that do not collide with `/api/mandi/*`:

`/api/commodities`, `/api/mandis`, `/api/mandis/prices/latest`, `/api/mandis/prices/history`,
`/api/mandis/data-status`.

### Backend — Phase 5 owns (all new files)

- `backend/src/routes/market.routes.js` — `createMarketRoutes({ controller = createMarketController() } = {})`
- `backend/src/controllers/market.controller.js` — `createMarketController({ marketService = defaultMarketService } = {})`,
  reusing the `handle(fn)` → `mapDatabaseError` and `parse(validator, input)` → `HttpError(400,'VALIDATION_ERROR',...)` idioms.
- `backend/src/services/market.service.js` — `MarketService({ pool = defaultPool, mandiConfig = config.mandi })`,
  reading `mandi_prices_resolved` / `mandi_prices_canonical` (do **not** create a new price table).
- `backend/src/validators/market.validator.js` — reuse the same `{ value } | { errors:[{field,message}] }` contract.

### Backend — shared, append-only (coordinate)

- `backend/src/app.js` — **one added import + one `app.use('/api/...', ...)` line**, plus (optionally) the
  `/` endpoint advert. No restructuring.
- `backend/src/utils/httpError.js` — only if a genuinely new stable `code` is needed (prefer reusing
  `VALIDATION_ERROR` / `DATABASE_*`).

### Backend — do not touch

`mandi.routes.js`, `mandi.controller.js`, `mandi.service.js`, `mandi.validator.js`, `pipeline/**`,
`middleware/**`, `db.js`, and every applied migration. New DB needs go into a **new** migration `008_*`.

### Frontend — Phase 5 owns (all new files)

- `frontend/src/services/marketApi.js` — new client using `apiRequest`/`ApiError` from
  `services/api.js` so backend `code`/`message`/`details` reach the UI (avoids the `fetchWithFallback` gap).
- `frontend/src/pages/MarketsPage.jsx` (or equivalent) + new components under
  `frontend/src/components/` for the commodity picker / history chart / data-status.
- New display helpers in a new module (do not edit `mandiFeed.js`; reuse its exported functions).

### Frontend — shared, append-only (coordinate)

- `frontend/src/App.jsx` — add one `<Route>` under the existing `<ProtectedRoute />` block if a new page
  is introduced (existing routes: `/`, `/ask-ai`, `/recommendation`, `/mandis`, `/alerts`, `/profile`).
- `frontend/src/services/api.js` — add new exports only if they must live here; never change
  `apiRequest`, `ApiError` or the existing mandi methods.
- `frontend/src/i18n/strings.js` — **add new keys to all three language blocks** (`en`/`hi`/`mr`),
  namespaced under a Phase 5 prefix (e.g. `market.*`); do not edit or reorder existing keys. Run
  `frontend/scripts/check-i18n.mjs` afterwards.
- `frontend/src/components/BottomNav.jsx` — only if a new tab is genuinely required (the nav has 5 fixed
  items); prefer linking from existing surfaces.

### Frontend — do not touch

`frontend/src/pages/HomePage.jsx`, `frontend/src/pages/MandisPage.jsx`,
`frontend/src/components/ForecastPanel.jsx`, `frontend/src/utils/mandiFeed.js`,
`frontend/src/constants/profile.js`, `frontend/tailwind.config.js`, `frontend/src/index.css`,
`frontend/src/i18n/languages.js`.

### Suggested first steps for Phase 5

1. Confirm whether `/api/mandis/data-status` should report **global** freshness (the current page-scoped
   `meta` cannot). Define its envelope before UI work.
2. Decide whether Phase 5 reads `mandi_prices_resolved` (default, de-duplicated) or the new
   `mandi_prices_canonical` view; expose the same `source_label` / `is_sample_data` honesty guarantees.
3. Add a small golden-file/contract test alongside `backend/test/db/api.test.js` for each new endpoint
   (public read → 200; bad params → 400 `VALIDATION_ERROR`; DB down → 503 `DATABASE_UNAVAILABLE`;
   unmigrated → 503 `DATABASE_NOT_MIGRATED`).
