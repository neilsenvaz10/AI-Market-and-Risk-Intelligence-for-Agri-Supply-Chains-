# Phase 5 — Mandi Pipeline Reconnaissance & Integration Contract

Read-only reconnaissance of the Phase 3 mandi pipeline and Phase 4 config surface, produced
so Phase 5 implementers can work in parallel without colliding.

Repo root: `E:\AA Kushal\AAA-Coding\Hackathon\Syrus 7.0 2`.
Everything below is quoted from the files as they exist today. No existing file was modified.

---

## 1. Module inventory & exports

### `backend/src/pipeline/index.js` — orchestrator
Public exports:
- `PIPELINE_LOCK_ID = 7_301_301` — PostgreSQL advisory-lock id (`pg_try_advisory_lock`).
- `MAX_RECORDS_PER_RUN = 10000` — hard cap; effective cap is
  `Math.min(Math.max(Number(options.maxRecords) || 2000, 1), MAX_RECORDS_PER_RUN)`.
- `planIncrementalWindow({ today = isoDay(new Date()), lookbackDays = 3, lastWindowTo = null, maxDays = 30 } = {})`
  → `{ fromDate, toDate }`.
- `class MandiPipeline`
  - `constructor({ pool = defaultPool, mandiConfig = config.mandi, providers, persister, log = console } = {})`
  - `getAvailableProviders()` → `Object.keys(this.providers)`
  - `getProvider(providerKey)` → provider or `null`; uppercases and applies `PROVIDER_ALIASES`
  - `async runPipeline(options = {})` → `stats` object (shape below)
  - private `#startRun`, `#finishRun`, `#lastWindowTo`
- `const mandiPipeline = new MandiPipeline()` (singleton) and `default mandiPipeline`.

Internal (not exported): `PROVIDER_ALIASES = { AGMARKNET: 'DATA_GOV_IN' }`, `isoDay`, `addDays`.

`runPipeline` accepts: `{ provider, state, district, commodity, fromDate, toDate, days,
maxRecords, crossSource, signal, triggeredBy }`. Returned `stats` fields:
`source, mode, status, window_from, window_to, records_fetched, records_valid, records_rejected,
records_inserted, records_updated, records_unchanged, records_failed, duplicates_removed,
conflicts_detected, rejection_summary, persistence_errors, latest_reporting_date, error_code,
error_details, execution_time_ms, is_sample_data, run_id` (set after insert).
Statuses: `SUCCESS | NO_DATA | PARTIAL_SUCCESS | SKIPPED | REFUSED | FAILED`.

### `backend/src/pipeline/normalizer.js`
Exports: `CANONICAL_PRICE_UNIT = 'INR/quintal'`, `CANONICAL_ARRIVAL_UNIT = 'tonne'`,
`cleanText(value)`, `nameKey(value)`, `makeCode(parts, maxLength = 64)`,
`normalizeDate(value, format = 'AUTO')`, `parseNumber(value)` → `{ value, invalid }`,
`normalizePriceUnit(unit)`, `normalizeArrivalUnit(unit)`, `normalizeCommodity(value)`,
`normalizeMandi(market, district, state)`, `normalizeMandiRecord(record)`, plus a `default` object
with the same functions. (Private: `PRICE_UNITS`, `ARRIVAL_UNITS`, `COMMODITY_ALIASES`,
`COMMODITY_META`, `MISSING_TOKENS`, `slugPart`, `round2`.)

### `backend/src/pipeline/validator.js`
Exports: `EARLIEST_ACCEPTED_DATE = '2000-01-01'`, `GENUINE_SOURCES = new Set(['DATA_GOV_IN','CEDA'])`,
`SAMPLE_SOURCES = new Set(['MOCK_PROVIDER'])`,
`validateMandiRecord(record, { now = new Date() } = {})` →
`{ valid, errors: [{ code, message }], warnings: string[] }`.

### `backend/src/pipeline/deduplicator.js`
Exports: `SOURCE_PRECEDENCE = { DATA_GOV_IN: 40, CEDA: 30, MOCK_PROVIDER: 0 }`,
`CONFLICT_TOLERANCE = 0.005`, `getSourcePrecedence(source)` (unknown → `10`),
`observationKey(record)`, `valueSignature(record)`,
`pricesDiffer(a, b, tolerance = CONFLICT_TOLERANCE)`, `deduplicateWithinSource(records)`,
`findCrossSourceOverlaps(records, tolerance = CONFLICT_TOLERANCE)`,
`deduplicateRecords(records, options = {})`, `default` object.

### `backend/src/pipeline/persister.js`
Exports: `class SampleDataWriteError` (`code='SAMPLE_DATA_WRITE_REFUSED'`),
`class PersistenceIntegrityError` (`code='PERSISTENCE_COUNT_MISMATCH'`),
`class MandiPersister`:
- `constructor({ pool = defaultPool, allowSampleData = false, conflictTolerance = CONFLICT_TOLERANCE } = {})`
- `async persistBatch(records, { runId = null, batchConflicts = [] } = {})` →
  `{ inserted, updated, unchanged, failed, conflicts, errors: [{ key, message }] }`

### `backend/src/pipeline/http.js`
Exports: `redactText(text, secrets = [])`, `class SourceHttpError` (`status, code, retryable, url`),
`redactUrl(rawUrl)`, `createSourceHttpClient({ timeoutMs = 20000, retries = 3,
requestIntervalMs = 1000, baseBackoffMs = 1000, maxBackoffMs = 60000, fetchImpl = globalThis.fetch,
log = console } = {})` → `{ requestJson(url, { method='GET', headers={}, body, signal, label='source' }) }`.

### `backend/src/pipeline/scheduler.js`
Exports: `SCHEDULABLE_PROVIDERS = new Set(['DATA_GOV_IN'])`,
`describeSchedulerConfig(mandiConfig)` → `{ enabled, reason, minutes?, provider? }`,
`createMandiSyncScheduler({ mandiConfig, pipeline, log = console, setIntervalFn = setInterval,
clearIntervalFn = clearInterval } = {})` → `{ plan, state, tick, start(), stop() }`
(`state = { runs, skippedOverlaps, lastResult, lastError }`).

### `backend/src/pipeline/trace.js`
Exports: `GENUINE_SOURCES = new Set(['DATA_GOV_IN','CEDA'])`,
`loadRow(pool, { id, source })`, `replay(row)`,
`compareRecord(expected, actual, fields = COMPARED_FIELDS)`,
`expectedDashboardText(apiRow)`, `computeVerdict({ row, stages })`,
`traceRow({ row, fetchApi })`. Verdicts: `GENUINE_TRACE_PASS | SAMPLE_ONLY | SYNTHETIC_FIXTURE |
FAIL | INCOMPLETE`. Fixture marker constant: `_synthetic_test_fixture`.

### `backend/src/pipeline/providers/*`
- `base.provider.js`: `SourceNotConfiguredError` (`code='SOURCE_NOT_CONFIGURED'`, `source`),
  `BaseMandiProvider` with `constructor(name)`, `getName()`, `getSourceCode()` (= `this.name`),
  `isSampleSource()` (false), `async fetchRecords(options = {})` (throws — must be overridden).
- `data-gov-in.provider.js`: `DATA_GOV_IN_RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070'`,
  `toDmy(isoDate)`, `datesBetween(fromDate, toDate)`, `priceUnitFromFieldMeta(fields)`,
  `class DataGovInProvider` with `isConfigured()`, `buildUrl({offset=0, limit=PAGE_SIZE(500), state,
  district, market, commodity, arrivalDate})`, `transformRecord(item, { priceUnit, fetchedAt })`,
  `fetchRecords({ state, district, commodity, fromDate, toDate, maxRecords = 2000, signal })`.
- `ceda.provider.js`: `CEDA_HISTORICAL_START = '2021-10-01'`, `CEDA_HISTORICAL_END = '2026-09-30'`,
  `class CedaClient` (`isConfigured`, `listCommodities`, `listGeographies`,
  `listMarkets({commodityId,stateId,districtId,indicator='price',signal})`,
  `getPrices({commodityId,stateId,districtIds,marketIds,fromDate,toDate,signal})`,
  `getQuantities({...same...})`), `splitDateRange(fromDate,toDate,windowDays)`,
  `findByNameOrId(items, value, { idKey, nameKey: nameField })`,
  `buildCedaRecords(priceRows, quantityRows, ctx)`,
  `class CedaProvider` (`isConfigured`, `getHistoricalBounds`,
  `resolveScope({commodity,state,district,signal})`,
  `fetchRecords({commodity,state,district,fromDate,toDate,maxRecords=5000,signal})`,
  `HISTORICAL_START`/`HISTORICAL_END` instance fields, `windowDays`).
- `mock.provider.js`: `class MockMandiProvider` (`source='MOCK_PROVIDER'`, `isSampleSource() === true`).

### `backend/src/pipeline/historical/*`
- `storage.js`: `DiskGuardError` (`code`), `freeBytes(dir)`,
  `createDiskGuard({ dir, minFreeGb, budgetMb, freeBytesImpl = freeBytes })` →
  `{ bytesWritten, assertSpace(stage), addBytes(bytes) }`,
  `writeCsvGz(filePath, columns, rows, { guard, checkEvery = 5000 })` → `{ rows, bytes, sha256 }`,
  `parseCsvLine(line)`, `async *readCsvGz(filePath)`, `sha256File(filePath)`,
  `class Manifest` (`static load(filePath, defaults)`, `task(id)`, `update(id, patch)`, `save()`).
- `ceda-export.js`: `CSV_COLUMNS` (29 columns, listed in §7), `clampToHistoricalWindow(fromDate, toDate)`,
  `runCedaExport({ provider, commodity, state, district, fromDate, toDate, outDir, windowDays = 92,
  minFreeGb = 20, budgetMb = 500, saveRaw = true, maxTasks = Infinity, persister = null, signal,
  log = console, guard: injectedGuard })`, `importCedaExport({ manifestPath, persister, log = console })`.

### `backend/src/config/*`
- `mandiConfig.js`: `MIN_SYNC_INTERVAL_MINUTES = 15`, `MAX_SYNC_INTERVAL_MINUTES = 7*24*60`,
  `GENUINE_PROVIDERS = ['DATA_GOV_IN','CEDA']`, `SAMPLE_PROVIDERS = ['MOCK']`,
  `parseSyncInterval(raw)`, `parseProvider(raw)`, `parseMandiConfig(env = process.env)`.
- `index.js`: `config.mandi = parseMandiConfig(process.env)`; also `config.database`, `config.firebase`,
  `config.email`, `config.port`, `config.frontendUrl`, `config.mlServiceUrl`.

### `backend/scripts/*` (mandi-relevant)
- `cli-utils.js`: `parseArgs(argv, { allowPositional = false } = {})`, `targetDatabaseName()`,
  `requireDatabaseConfirmation(args)`, `abortOnSignals()`.
- `mandi-sync.js`: CLI `npm run mandi:sync -- --provider=... --confirm-db=<DB>`.
- `ceda-export.js`: CLI `npm run ceda:export -- ... [--import --confirm-db=...]`, `--discover-only`,
  `--import-manifest=<path>`.

---

## 2. Normalized record contract (verbatim)

`normalizeMandiRecord(record)` returns **exactly** this object (`normalizer.js` lines 201–241):

```js
return {
  source: cleanText(record.source),
  is_sample_data: record.is_sample_data === true,
  source_record_key: cleanText(record.source_record_key),
  source_market_id: cleanText(record.source_market_id),
  source_commodity_id: cleanText(record.source_commodity_id),
  source_state_id: cleanText(record.source_state_id),
  source_district_id: cleanText(record.source_district_id),
  source_market_name: cleanText(record.mandi_name ?? record.market),
  source_commodity_name: cleanText(record.commodity_name ?? record.commodity),
  source_state_name: cleanText(record.state),
  source_district_name: cleanText(record.district),
  source_variety: cleanText(record.variety),
  source_grade: cleanText(record.grade),

  mandi_code: mandi?.code ?? null,
  mandi_name: mandi?.name ?? null,
  state: mandi?.state ?? null,
  district: mandi?.district ?? null,
  latitude: parseNumber(record.latitude).value,
  longitude: parseNumber(record.longitude).value,

  commodity_code: commodity?.code ?? null,
  commodity_name: commodity?.name ?? null,
  commodity_category: commodity?.category ?? null,
  commodity_hindi: commodity?.hindi ?? null,
  commodity_marathi: commodity?.marathi ?? null,

  variety: cleanText(record.variety),
  grade: cleanText(record.grade),
  price_date: priceDate,
  min_price: prices.min_price,
  max_price: prices.max_price,
  modal_price: prices.modal_price,
  price_unit: priceUnit?.unit ?? null,
  arrivals_quantity: arrivalsQuantity,
  arrival_unit: arrivalUnit,
  quality_flags: [...new Set([...(record.quality_flags || []), ...flags])],
  fetched_at: record.fetched_at || null,
  raw_payload: record.raw_payload ?? null,
};
```

The canonical fixture `sampleRecord()` in `backend/test/helpers/db.js` (lines 54–93) is the same
shape with concrete values. Note it is the contract the persister/tests rely on:

```js
export function sampleRecord(overrides = {}) {
  return {
    source: 'MOCK_PROVIDER',
    is_sample_data: true,
    source_record_key: null,
    source_market_id: null,
    source_commodity_id: null,
    source_state_id: null,
    source_district_id: null,
    source_market_name: 'Test Market',
    source_commodity_name: 'Onion',
    source_state_name: 'Test State',
    source_district_name: 'Test District',
    source_variety: 'Red',
    source_grade: 'FAQ',
    mandi_code: 'TEST_STATE__TEST_DISTRICT__TEST_MARKET',
    mandi_name: 'Test Market',
    state: 'Test State',
    district: 'Test District',
    latitude: null,
    longitude: null,
    commodity_code: 'ONION',
    commodity_name: 'Onion',
    commodity_category: 'Vegetables',
    commodity_hindi: null,
    commodity_marathi: null,
    variety: 'Red',
    grade: 'FAQ',
    price_date: '2026-09-01',
    min_price: 1000,
    max_price: 1400,
    modal_price: 1200,
    price_unit: 'INR/quintal',
    arrivals_quantity: 12.5,
    arrival_unit: 'tonne',
    quality_flags: ['SYNTHETIC_TEST_RECORD'],
    fetched_at: null,
    raw_payload: { test: true },
    ...overrides,
  };
}
```

**Raw provider record** (input to `normalizeMandiRecord`) is looser. Recognised input keys:
`source`, `is_sample_data`, `state`, `district`, `mandi_name`/`market`, `commodity_name`/`commodity`,
`variety`, `grade`, `price_date`, `date_format` (`'ISO' | 'DMY' | 'AUTO'`), `min_price`, `max_price`,
`modal_price`, `price_unit`, `price_unit_assumed`, `arrivals_quantity`, `arrival_unit`, `latitude`,
`longitude`, `source_record_key`, `source_market_id`, `source_commodity_id`, `source_state_id`,
`source_district_id`, `quality_flags`, `fetched_at`, `raw_payload`.

### Required vs optional (as enforced by `validateMandiRecord`)
Required (rejection code in parentheses):
- `source` (`MISSING_SOURCE`) and sample-flag consistency (`SAMPLE_FLAG_ON_GENUINE_SOURCE`,
  `SAMPLE_SOURCE_NOT_FLAGGED`).
- `source_state_name` (`MISSING_STATE`), `source_district_name` (`MISSING_DISTRICT`),
  `source_market_name` (`MISSING_MARKET`).
- `mandi_code` buildable — only required if all three name fields exist (`INVALID_MARKET_IDENTITY`).
- `commodity_code` (`MISSING_COMMODITY`).
- `price_date` (`MISSING_DATE` / `INVALID_DATE`), plus `FUTURE_DATE` and `DATE_TOO_OLD`
  (`< 2000-01-01`).
- `price_unit === CANONICAL_PRICE_UNIT` (`UNKNOWN_PRICE_UNIT`).
- `modal_price` present (`MISSING_MODAL_PRICE`); if `min`/`max`/`modal` are non-null they must be
  finite and `> 0` (`NON_POSITIVE_PRICE`); `min <= max` (`MIN_ABOVE_MAX`);
  `min <= modal <= max` (`MODAL_OUTSIDE_RANGE`).
Optional / nullable: `min_price`, `max_price`, `arrivals_quantity`, `arrival_unit` (only validated
when `arrivals_quantity` is non-null: `NEGATIVE_ARRIVALS`, and `arrival_unit` must be `tonne` →
`UNKNOWN_ARRIVAL_UNIT`), `latitude`, `longitude`, `variety`, `grade`, all `source_*_id`,
`source_record_key`, `fetched_at`, `raw_payload`, `is_sample_data` (defaults `false`).

Warning (merged into `quality_flags`, does **not** reject): `PRICE_OUTLIER`
(modal > `1_000_000`).

---

## 3. Provenance model

- **Source code** (`source`) is the identity written to `mandi_prices.source`: `DATA_GOV_IN`,
  `CEDA`, `MOCK_PROVIDER`. It is registered in `mandi_sources(code PK, label, publisher,
  access_method, precedence, is_sample, terms)`. Unknown sources get precedence `10` and
  `source_label = source` in `mandi_prices_resolved`.
- **Canonical identity** is derived: `mandi_code = makeCode([stateName, districtName, name])`,
  `commodity_code` from `COMMODITY_ALIASES` or `makeCode([name])`. Never guessed; missing parts
  leave `mandi_code`/`commodity_code` null and the validator rejects.
- **Original names/ids are preserved** alongside canonical ones. The pipeline never overwrites them:
  `source_market_name`, `source_commodity_name`, `source_state_name`, `source_district_name`,
  `source_variety`, `source_grade`, `source_market_id`, `source_commodity_id`, `source_state_id`,
  `source_district_id`.
- `source_record_key` is source-specific:
  - DATA_GOV_IN: `[state, district, market, commodity, variety, grade, arrival_date].join('|').slice(0,200)`
    (data-gov-in.provider.js lines 119–120).
  - CEDA: `` `${row.commodity_id}:${row.market_id}:${row.date}` `` (ceda.provider.js line 141).
- Provenance survives in `mandi_price_conflicts` (`source_a`, `source_b`, `price_id_a/b`) and in the
  `mandi_prices_resolved` view (`source_precedence`, `source_label`, `source_rank`).
- `raw_payload` keeps the untouched provider item; `trace.js` replays it.

---

## 4. Quality flags (complete list actually used)

**Emitted by `normalizer.js`** (pushed onto `flags`, merged into `quality_flags`):
- `MISSING_LOCATION`
- `MISSING_COMMODITY`
- `MISSING_DATE`
- `INVALID_DATE`
- `MISSING_PRICE_UNIT`
- `UNKNOWN_PRICE_UNIT`
- `PRICE_UNIT_FROM_PUBLISHER_CONVENTION` (when raw record sets `price_unit_assumed`)
- `UNPARSEABLE_MIN_PRICE`, `UNPARSEABLE_MAX_PRICE`, `UNPARSEABLE_MODAL_PRICE`
  (template `` `UNPARSEABLE_${field.toUpperCase()}` `` over `min_price|max_price|modal_price`)
- `ZERO_MIN_PRICE_TREATED_AS_MISSING`, `ZERO_MAX_PRICE_TREATED_AS_MISSING`
  (template `` `ZERO_${field.toUpperCase()}_TREATED_AS_MISSING` ``; only for min/max, never modal;
  the value becomes `null`)
- `MISSING_MIN_PRICE`, `MISSING_MAX_PRICE`, `MISSING_MODAL_PRICE`
- `UNPARSEABLE_ARRIVALS`
- `UNKNOWN_ARRIVAL_UNIT`

**Emitted by `validator.js` as warnings** (pipeline merges `check.warnings` into
`record.quality_flags` in `index.js` line 205):
- `PRICE_OUTLIER`

**Emitted by record producers / DB:**
- `SYNTHETIC_SAMPLE` — `mock.provider.js` line 169.
- `SYNTHETIC_TEST_RECORD` — `backend/test/helpers/db.js` `sampleRecord()`.
- `LEGACY_ARRIVAL_UNIT_UNKNOWN` — migration `005` back-fill (legacy rows with arrivals but no unit).

**Validator error codes written to `pipeline_sync_logs.rejection_summary`** (not quality flags):
`INVALID_RECORD`, `MISSING_SOURCE`, `SAMPLE_FLAG_ON_GENUINE_SOURCE`, `SAMPLE_SOURCE_NOT_FLAGGED`,
`MISSING_STATE`, `MISSING_DISTRICT`, `MISSING_MARKET`, `INVALID_MARKET_IDENTITY`, `MISSING_COMMODITY`,
`INVALID_DATE`, `MISSING_DATE`, `FUTURE_DATE`, `DATE_TOO_OLD`, `UNKNOWN_PRICE_UNIT`,
`NON_POSITIVE_PRICE`, `MISSING_MODAL_PRICE`, `MIN_ABOVE_MAX`, `MODAL_OUTSIDE_RANGE`,
`NEGATIVE_ARRIVALS`, `UNKNOWN_ARRIVAL_UNIT`.

Consumers: `GET /api/mandi/quality/report` aggregates `SELECT flag, COUNT(*) ... unnest(quality_flags)`
(`mandi.service.js` lines 291–294).

---

## 5. Dedup keys

**Within-source** (`deduplicator.js`):
- `observationKey(record)` =
  `` [record.source, record.mandi_code, record.commodity_code, record.price_date,
       lower(record.variety), lower(record.grade)].join('|') ``.
  This is deliberately the JS mirror of the DB unique constraint
  `uq_mandi_prices_observation UNIQUE NULLS NOT DISTINCT
  (source, mandi_id, commodity_id, price_date, variety, grade)` (migration 005 lines 137–140).
- `valueSignature(record)` =
  `` [min_price, max_price, modal_price, arrivals_quantity, price_unit, arrival_unit]
      .map(v => v == null ? '' : String(v)).join('|') ``.
- Same key + same signature → silent duplicate (`duplicatesCount++`, last occurrence wins).
- Same key + different signature → conflict `{ type: 'SAME_SOURCE_CONFLICT', key, source, versions,
  kept, discarded }`; the **last occurrence in source order is kept**.

**Cross-source** (`findCrossSourceOverlaps`, `deduplicateRecords({ crossSource: true })`):
- Group key = `` [mandi_code, commodity_code, price_date].join('|') ``. Nothing is discarded;
  every source keeps its own row.
- Classification per group: `CROSS_SOURCE_MATCH` (comparable modal prices agree within
  `CONFLICT_TOLERANCE = 0.005` relative), `CROSS_SOURCE_CONFLICT` (comparable but disagree),
  `GRANULARITY_MISMATCH` (no comparable pair — e.g. one source is variety-level with several
  varieties).
- Comparability rule: `lower(x.variety) === lower(y.variety)`, or one side has `null` variety and the
  other source contributed exactly one row.

**Persisted conflict keys** (`persister.js`):
- Same-source: `` `SB:${conflict.key}:${versions.map(valueSignature).join('~')}`.slice(0,400) ``,
  `conflict_type = 'SAME_SOURCE_CONFLICT'`.
- Cross-source (SQL): `` 'XS:' || id_a || ':' || id_b || ':' || modal_a || ':' || modal_b ``,
  `conflict_type = 'CROSS_SOURCE_CONFLICT'`, `ON CONFLICT (conflict_key) DO NOTHING`.
  Detection runs only for market-days touched by the batch.

**Resolution precedence** (`SOURCE_PRECEDENCE`): `DATA_GOV_IN: 40`, `CEDA: 30`,
`MOCK_PROVIDER: 0`, unknown `10`. Applied only in the `mandi_prices_resolved` view (highest
precedence wins per market/commodity/day).

---

## 6. Unit rules

Canonical constants: `CANONICAL_PRICE_UNIT = 'INR/quintal'`, `CANONICAL_ARRIVAL_UNIT = 'tonne'`.
Conversion happens only when the unit is known; unknown units leave the canonical field `null` and
the record is rejected (`UNKNOWN_PRICE_UNIT` / `UNKNOWN_ARRIVAL_UNIT`).

Price units → factor to INR/quintal (`normalizer.js` lines 23–27):
```js
'inr/quintal': 1, 'rs/quintal': 1, 'rs./quintal': 1, 'rs/qtl': 1, 'inr/qtl': 1, '₹/quintal': 1,
'inr/kg': 100, 'rs/kg': 100, 'rs./kg': 100, '₹/kg': 100,
'inr/tonne': 0.1, 'rs/tonne': 0.1, 'inr/ton': 0.1, 'rs/ton': 0.1, '₹/tonne': 0.1,
```
Lookup normalises: `cleanText(unit)?.toLowerCase().replace(/\s+/g,'').replace('rupees','rs')`.

Arrival units → factor to tonnes (`normalizer.js` lines 30–34):
```js
tonne: 1, tonnes: 1, ton: 1, tons: 1, t: 1, mt: 1, 'metric tonne': 1, 'metric tonnes': 1,
quintal: 0.1, quintals: 0.1, qtl: 0.1,
kg: 0.001, kgs: 0.001, kilogram: 0.001, kilograms: 0.001,
```
Lookup: `cleanText(unit)?.toLowerCase()`.

**Allowed canonical values** (enforced by DB constraints, migration 005 lines 94–101):
- `price_unit IS NULL OR price_unit = 'INR/quintal'`
- `arrival_unit IS NULL OR arrival_unit = 'tonne'`

Dates: `normalizeDate` supports `'ISO'` (`YYYY-MM-DD`, trailing time ignored), `'DMY'`
(`DD/MM/YYYY` or `DD-MM-YYYY`), `'AUTO'` (year-first ⇒ ISO, else DMY; **never** US month-first).
Invalid calendar dates → `null`.

Identities: `makeCode` slugs parts with `__` joins, hashes non-Latin to `U<sha1-10>` and truncates
to 64 chars with a `_<sha1-10>` suffix. `nameKey` = NFKC + lowercase + non-alphanumeric → space
(so `Pune(Moshi)` == `Pune (Moshi)`). Matching is exact — never substring.

---

## 7. HTTP / retry / rate-limit config

Env keys parsed in `mandiConfig.js` (`parseStrictInt` → `{ min, max, fallback }`; a typo yields the
fallback and a `warnings[]` entry, never a silent lenient parse):

| Env key | min..max | fallback | Consumed as |
|---|---|---|---|
| `MANDI_HTTP_TIMEOUT_MS` | 1000..120000 | 20000 | `config.mandi.http.timeoutMs` |
| `MANDI_HTTP_RETRIES` | 0..6 | 3 | `config.mandi.http.retries` |
| `MANDI_REQUEST_INTERVAL_MS` | 0..60000 | 1000 | `config.mandi.http.requestIntervalMs` |

`createSourceHttpClient` defaults: `timeoutMs=20000`, `retries=3`, `requestIntervalMs=1000`,
`baseBackoffMs=1000`, `maxBackoffMs=60000`.

Behaviour:
- Requests are spaced by a module-local `lastRequestAt` (requests share one client, so the interval is
  global per client, not per host).
- Retryable statuses: `RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}`.
- Timeout/network errors are retryable; delay = `min(maxBackoffMs, baseBackoffMs * 2 ** (attempt-1))`.
- HTTP retryable: delay honours `Retry-After` (seconds or HTTP-date, via `retryAfterMs`) else the same
  exponential backoff. Attempt counter increments before the request; `attempt > retries` throws.
- Non-JSON success → `SourceHttpError` `INVALID_JSON`. Status codes: `UNAUTHORIZED` (401/403),
  `RATE_LIMITED` (429), `HTTP_ERROR`, `TIMEOUT`, `NETWORK_ERROR`, `ABORTED`.
- Error bodies are drained but never echoed; `redactUrl` blanks `api-key, api_key, apikey, key, token,
  access_token`; `redactText` scrubs known secret values, `key=...` patterns and `Bearer <token>`;
  `SECRET_QUERY_PARAMS` list above.
- Caller-supplied `AbortSignal` is honoured (`signal.aborted` → `ABORTED`).

---

## 8. Storage & disk guard

`backend/src/pipeline/historical/storage.js` provides (no config reads of its own):
- `freeBytes(dir)` — `statfs` on the nearest existing ancestor of `dir`.
- `createDiskGuard({ dir, minFreeGb, budgetMb })` — `assertSpace(stage)` throws `DiskGuardError
  LOW_DISK_SPACE` when free < `minFreeGb * 1024**3`; `addBytes(bytes)` throws
  `DiskGuardError DOWNLOAD_BUDGET_EXCEEDED` when cumulative written bytes exceed `budgetMb * 1024**2`.
- `writeCsvGz(filePath, columns, rows, { guard, checkEvery = 5000 })` — gzip level 6 into
  `<file>.partial`, SHA-256 hashed, atomically renamed on success; deletes the partial on error.
  Returns `{ rows, bytes, sha256 }`.
- `readCsvGz(filePath)` — streams `<file>.csv.gz` through `createGunzip()`, yields objects keyed by
  header.
- `Manifest` — JSON checkpoint at a caller-supplied path, written atomically (`<path>.tmp` → rename).
  Shape `{ version: 1, createdAt, tasks: { <taskId>: {...} }, updatedAt, lastRun }`.

`ceda-export.js` layout inside `outDir`:
`ceda/commodity=<id>/state=<id>/district=<id>/<from>_<to>.raw.json.gz` and
`<from>_<to>.csv.gz`; manifest at `manifest_c<commodityId>_s<stateId>_d<districtId>.json`.
Task id: `c<commodityId>_s<stateId>_d<districtId>_<from>_<to>`. Resume skips a `done` task when the
file size + SHA-256 still match (and it was imported, if a persister is in use).

Config keys (`config.mandi.historical`):
| Env key | min..max | fallback | Field |
|---|---|---|---|
| `MANDI_MIN_FREE_DISK_GB` | 1..10000 | 20 | `minFreeDiskGb` |
| `MANDI_DOWNLOAD_BUDGET_MB` | 1..1000000 | 500 | `downloadBudgetMb` |
| `MANDI_DATA_DIR` | — | `null` | `outputDir` |
| `CEDA_REQUEST_WINDOW_DAYS` | 1..366 | 92 | `windowDays` |

`MANDI_DATA_DIR` is only a default: the CLI resolves `--out-dir || historical.outputDir ||
'data/mandi'` relative to `backend/` (`scripts/ceda-export.js` line 55).

`CSV_COLUMNS` (the export contract, in order):
`validation_status, rejection_codes, source, source_record_key, source_market_id, source_commodity_id,
source_state_id, source_district_id, source_market_name, source_commodity_name, source_state_name,
source_district_name, mandi_code, mandi_name, state, district, commodity_code, commodity_name,
variety, grade, price_date, min_price, max_price, modal_price, price_unit, arrivals_quantity,
arrival_unit, quality_flags, fetched_at`.

---

## 9. Scheduler

Decision (`describeSchedulerConfig`):
- Disabled unless `mandiConfig.sync.enabled` (from `parseSyncInterval`): `MANDI_SYNC_INTERVAL_MINUTES`
  must be a whole number in `15..10080`; unset/`0`/non-numeric/below 15 → disabled with a `reason`.
- Disabled unless `MANDI_DATA_PROVIDER` is set.
- Disabled unless provider ∈ `SCHEDULABLE_PROVIDERS` (`DATA_GOV_IN` only). CEDA and MOCK are never
  scheduled.

Runtime contract:
- `start()` registers `setInterval(tick, minutes*60*1000)` and `unref()`s it. **No run at start-up** —
  the first run is one full interval later. `stop()` clears the handle.
- In-process overlap guard: if `running`, the tick increments `state.skippedOverlaps` and returns.
- Each tick creates an `AbortController` and aborts after
  `(mandiConfig.syncJobTimeoutMinutes || 30) * 60 * 1000` (`MANDI_SYNC_JOB_TIMEOUT_MINUTES`, 1..240,
  default 30).
- Calls `pipeline.runPipeline({ provider: plan.provider, signal, triggeredBy: 'scheduler' })`.
- Cross-process safety: the pipeline itself takes the PostgreSQL advisory lock
  (`PIPELINE_LOCK_ID = 7_301_301`); if unavailable the run returns `SKIPPED /
  ANOTHER_RUN_IN_PROGRESS` before any run row is created. Lock is always released in `finally`.

Lookback: `planIncrementalWindow({ lookbackDays = options.days || config.syncLookbackDays,
lastWindowTo, maxDays = 30 })`. `from = today - (lookbackDays-1)`, then pulled back to
`lastWindowTo - (lookbackDays-1)` if that is earlier, then clamped to `today - (maxDays-1)`.
`MANDI_SYNC_LOOKBACK_DAYS` = 1..30, fallback 3. When `options.days` is supplied the stored
`last_window_to` is ignored. `last_window_to` is read from `mandi_source_sync_state` keyed by source
code. CEDA uses `provider.HISTORICAL_START..HISTORICAL_END` instead; explicit `fromDate`/`toDate`
wins for any provider.

---

## 10. Provider interface + where a new adapter plugs in

### Interface a new adapter must implement
`backend/src/pipeline/providers/base.provider.js` — extend `BaseMandiProvider`:

```js
class NewProvider extends BaseMandiProvider {
  constructor(opts = {}) { super('SOURCE_CODE'); /* ... */ }

  getName()            // inherited: returns the source code
  getSourceCode()      // inherited: returns this.name — written to mandi_prices.source
  isSampleSource()     // inherited: false; return true only for synthetic providers
  isConfigured()       // CONVENTION (not in base, used by service/CLI) -> boolean

  async fetchRecords({ state, district, commodity, fromDate, toDate, days, maxRecords, signal } = {})
  // MUST return an array of RAW records accepted by normalizeMandiRecord() (see §2).
  // MUST throw SourceNotConfiguredError('SOURCE_CODE', msg) when credentials are missing.
  // MUST honour `signal` (AbortSignal).
}
```
`fetchRecords` is the only abstract method. The orchestrator caps input at
`maxRecords` and never passes `days` to CEDA. Adapters should build their client with
`createSourceHttpClient(config.mandi.http)` so timeout/retry/spacing/redaction are identical.
Add an `isConfigured()` for the `/sync/status` `configured` flag (`mandi.service.js` lines 250–254
is a hard-coded ternary — a new source needs a branch there).

### Exact insertion points
1. **New file** (the natural home):
   `backend/src/pipeline/providers/agmarknet.provider.js`.
2. **Registry (the orchestrator's inline map)** — `backend/src/pipeline/index.js`, constructor lines
   57–61. Insert `AGMARKNET: new AgmarknetProvider({ ... })` into `this.providers`. There is **no
   separate provider-registry module**; this object is the registry, and `PROVIDER_ALIASES`
   (line 27) plus `getProvider()` (lines 69–72) already resolve names to keys.
3. **Config allow-list** — `backend/src/config/mandiConfig.js`: `GENUINE_PROVIDERS` (line 13) and
   `PROVIDER_ALIASES` (line 18). `parseProvider()` rejects unknown names, so without this the new
   provider can never be selected by env.
4. **Validator/source allow-lists** — `backend/src/pipeline/validator.js` `GENUINE_SOURCES` (line 10)
   and `backend/src/pipeline/trace.js` `GENUINE_SOURCES` (line 18);
   `backend/src/validators/mandi.validator.js` `SOURCES` (line 8) and `SYNC_PROVIDERS` (line 9).
5. **Dedup precedence** — `backend/src/pipeline/deduplicator.js` `SOURCE_PRECEDENCE` (lines 14–18).
6. **DB source registry** — a new migration must `INSERT INTO mandi_sources (code, label, publisher,
   access_method, precedence, is_sample, terms)` (see `005` lines 31–44 for the pattern). Note
   `mandi_source_sync_state.source` FKs to `mandi_sources(code)`, so this insert is mandatory before
   any run row for a new source.
7. **Storage/export** — `CSV_COLUMNS` in `historical/ceda-export.js` is CEDA-specific but generic
   enough to reuse; `historical/storage.js` (`createDiskGuard`, `writeCsvGz`, `Manifest`) is
   source-agnostic and should be reused as-is.
8. **Unit/identity maps** — only if the new source reports units or commodities not in
   `PRICE_UNITS` / `ARRIVAL_UNITS` / `COMMODITY_ALIASES` (`normalizer.js`).
9. **HTTP config** — reuse `config.mandi.http`; add new key/URL only if the source needs auth
   different from data.gov.in query-param or CEDA Bearer.

There is **no plugin autoloading**; registration is explicit and centralised in `index.js`.

---

## 11. Sync-log writes (`pipeline_sync_logs` + `mandi_source_sync_state`)

Both written exclusively by `MandiPipeline` in `backend/src/pipeline/index.js`.
`Persister` writes `mandi_prices`, `mandi_price_revisions`, `mandi_price_conflicts` only.

`#startRun` (INSERT, line 75–79): `source`, `status='RUNNING'`, `mode` (`'HISTORICAL'` for CEDA else
`'INCREMENTAL'`; note `'NONE'`/unknown provider is never inserted — refusal happens before the lock),
`window_from`, `window_to`, `is_sample_data`, `started_at=CURRENT_TIMESTAMP`,
`triggered_by` (`'manual'` default, `'cli'`, `'scheduler'`, `'user:<uid>'`). Returns `id` →
`stats.run_id`.

`#finishRun` (UPDATE, lines 84–93): `status`, `records_fetched`, `records_valid`, `records_inserted`,
`records_updated`, `records_rejected`, `records_unchanged`, `records_failed`, `conflicts_detected`,
`error_details`, `execution_time_ms`, `rejection_summary` (JSON), `synced_at=CURRENT_TIMESTAMP`.

Then `#finishRun` upserts `mandi_source_sync_state` (lines 94–112) only `WHERE EXISTS (SELECT 1 FROM
mandi_sources WHERE code = $1)`: `source`, `last_attempt_at`, `last_status`, `last_error`,
`last_run_id`, and on `SUCCESS`/`NO_DATA` also `last_success_at`, `last_window_from`,
`last_window_to`; `latest_reporting_date` is `GREATEST`-merged; `updated_at`.

Not persisted as columns (in-memory `stats` only): `duplicates_removed`, `persistence_errors`
(first 20 returned to the API), `latest_reporting_date` (goes to sync state), `error_code`
(prefixed into `error_details` semantics; the status/code is what callers read).

Readers: `MandiService.getPipelineStatus()` (last 10 runs + per-source sync state),
`getDataQualityReport().sync_health` (aggregates).

---

## 12. File ownership map

### `backend/src/pipeline/**` (14 files)
| Path | Role | Phase 5 note |
|---|---|---|
| `backend/src/pipeline/index.js` | Orchestrator + provider registry + sync-log writes | **Shared/hot file** — serialize edits |
| `backend/src/pipeline/normalizer.js` | Canonical record + unit/identity/date rules | Shared (canonical model additions) |
| `backend/src/pipeline/validator.js` | Validity + quality warnings | Shared |
| `backend/src/pipeline/deduplicator.js` | Dedup/conflict keys + precedence | Shared |
| `backend/src/pipeline/persister.js` | DB upsert + revisions + conflicts | Shared |
| `backend/src/pipeline/http.js` | Timeout/retry/rate-limit/redaction | Reuse, likely frozen |
| `backend/src/pipeline/scheduler.js` | Interval + job timeout | Reuse |
| `backend/src/pipeline/trace.js` | End-to-end single-record trace | Per-source replay branch needed for a new adapter |
| `backend/src/pipeline/providers/base.provider.js` | Adapter contract | Reuse |
| `backend/src/pipeline/providers/data-gov-in.provider.js` | data.gov.in adapter | Frozen unless extended |
| `backend/src/pipeline/providers/ceda.provider.js` | CEDA adapter | Frozen unless extended |
| `backend/src/pipeline/providers/mock.provider.js` | Synthetic | Frozen |
| `backend/src/pipeline/historical/storage.js` | Disk guard/gzip/manifest | Reuse as-is |
| `backend/src/pipeline/historical/ceda-export.js` | CEDA bulk export/import | Reuse patterns; source-specific |

### `backend/scripts/**` (14 files)
| Path | Role | Phase 5 note |
|---|---|---|
| `backend/scripts/cli-utils.js` | Arg parsing + DB confirmation + signals | Reuse; likely shared |
| `backend/scripts/mandi-sync.js` | CLI one-shot run | Add `--provider=AGMARKNET` allow-list change upstream |
| `backend/scripts/ceda-export.js` | CLI export/import | CEDA-specific |
| `backend/scripts/migrate.js` | Migration runner (`NNN_name.sql`, unique prefix, advisory lock `7_301_003`) | Frozen; Phase 5 adds `007_*.sql` |
| `backend/scripts/rehearse-migration.js` | Migration rehearsal | Frozen |
| `backend/scripts/test-db.js` | DB-backed test harness | Frozen |
| `backend/scripts/live-preflight.js` | Live preflight | Frozen |
| `backend/scripts/live-test-db.js` | Live DB test | Frozen |
| `backend/scripts/trace-record.js` | Trace CLI | Touched if trace gains a source |
| `backend/scripts/firebase-admin-claim.js` | Admin claim | Out of scope |
| `backend/scripts/forecast-train.js` | Phase 4 | Out of scope |
| `backend/scripts/forecast-generate.js` | Phase 4 | Out of scope |
| `backend/scripts/forecast-list.js` | Phase 4 | Out of scope |
| `backend/scripts/lib/mlPython.js` | Phase 4 helper | Out of scope |

### Related files outside those trees (Phase 5 will likely touch)
- `backend/src/config/mandiConfig.js` — provider allow-list, new env keys.
- `backend/src/config/index.js` — expose new config (e.g. storage/quality).
- `backend/src/services/mandi.service.js` — data-status API + quality report (`getPipelineStatus`,
  `getDataQualityReport` already exist; Phase 5 "data-status API" likely extends these).
- `backend/src/controllers/mandi.controller.js` — new handler(s).
- `backend/src/routes/mandi.routes.js` — new route(s) (`/quality/report`, `/sync/status` exist).
- `backend/src/validators/mandi.validator.js` — `SOURCES`, `SYNC_PROVIDERS`, new query validators.
- `backend/src/app.js` — root endpoint catalogue (`phase`, `endpoints.mandi`) if a route is added.
- `database/migrations/` — `006_phase4_forecasting.sql` is the last committed migration.
  **`007` is already taken**: an untracked `database/migrations/007_phase5_canonical_mandi.sql`
  exists as of this recon (Phase 5 canonical-model work already started; additive only —
  `mandi_prices_canonical` view + `variety_code`/`state_code`/`district_code`/`market_code`/
  `commodity_category_code`/`source_dataset` columns). The next free prefix for another Phase 5
  migration is therefore **`008`** unless it is folded into 007.
- Tests: `backend/test/*.test.js` (unit) and `backend/test/db/*.test.js` (DB-backed; require
  `DB_NAME=fasalytics_test_*`).

---

## 13. Config keys currently supported in `backend/.env.example` (mandi/pipeline)

```
MANDI_DATA_PROVIDER=                 # '' | DATA_GOV_IN | CEDA (MOCK only with allow flag)
MANDI_ALLOW_SAMPLE_DATA=false
DATA_GOV_IN_API_KEY=
DATA_GOV_IN_API_URL=https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070
CEDA_API_KEY=
CEDA_API_URL=https://api.ceda.ashoka.edu.in/v1
CEDA_REQUEST_WINDOW_DAYS=92
MANDI_SYNC_INTERVAL_MINUTES=0        # 15..10080 enables; 0/unset/invalid disables
MANDI_SYNC_LOOKBACK_DAYS=3
MANDI_SYNC_JOB_TIMEOUT_MINUTES=30
MANDI_HTTP_TIMEOUT_MS=20000
MANDI_HTTP_RETRIES=3
MANDI_REQUEST_INTERVAL_MS=1000
# MANDI_DATA_DIR=data/mandi
MANDI_MIN_FREE_DISK_GB=20
MANDI_DOWNLOAD_BUDGET_MB=500
```
Undocumented but parsed: `NODE_ENV` (production disables `MANDI_ALLOW_SAMPLE_DATA`). Any new Phase 5
key must be added to `parseMandiConfig` **and** `.env.example`, and must follow the safe-default +
strict-parse convention (out-of-range → fallback + entry in `config.mandi.warnings`).

---

## 14. Existing extension points Phase 5 should reuse (not reinvent)

- **Provider registry object** in `index.js` (`this.providers` + `PROVIDER_ALIASES` + `getProvider`).
- **`BaseMandiProvider`** contract and **`SourceNotConfiguredError`**.
- **`createSourceHttpClient`** for all outbound HTTP (timeout/retry/spacing/redaction).
- **`normalizeMandiRecord` / `validateMandiRecord` / `deduplicateWithinSource`** pipeline stages —
  call them in order; do not bypass.
- **`MandiPersister.persistBatch`** for any DB write, including imports (idempotent, savepointed,
  revision-tracked, sample-refusing).
- **`historical/storage.js`** (`createDiskGuard`, `writeCsvGz`, `readCsvGz`, `Manifest`) for the
  Phase 5 storage-efficiency work.
- **`mandi_sources` registry table + `mandi_prices_resolved` view** — the canonical place to declare
  a new source and its precedence; the view already handles multi-source resolution.
- **`pipeline_sync_logs` + `mandi_source_sync_state`** — the data-status API should read these
  (`getPipelineStatus` already does).
- **`getDataQualityReport`** already aggregates flags/conflicts/revisions/integrity; the Phase 5
  quality report should extend this method rather than add a parallel query surface.
- **`cli-utils.parseArgs` / `requireDatabaseConfirmation` / `abortOnSignals`** for any new CLI.
- **Migration runner conventions**: filename `NNN_name.sql`, unique 3-digit prefix, each file in one
  transaction. Next prefix: `007`.

## 15. Known facts/risks for parallel work

- `PROVIDER_ALIASES` exists in **two** places (`pipeline/index.js` and `config/mandiConfig.js`) and
  both map `AGMARKNET → DATA_GOV_IN`. A genuine AGMARKNET adapter must decide whether to keep that
  alias (it currently silently redirects `AGMARKNET` to data.gov.in) — this is the single most
  collision-prone change for Phase 5.
- `mandi.service.js` hard-codes `configured` per source (lines 250–254); a new source falls through
  to `allowSampleData` unless that branch is extended.
- The pipeline requires a matching `mandi_sources` row before `mandi_source_sync_state` can be
  written (guarded by `WHERE EXISTS`), so a new adapter needs its migration first.
- `mandi_prices.source` is `VARCHAR(64) NOT NULL` with no FK to `mandi_sources`; `mandi_prices_resolved`
  left-joins it and defaults precedence to 10 for unregistered sources.
- `MAX_RECORDS_PER_RUN = 10000`; `validateSyncRequest` caps HTTP/CLI `maxRecords` at 5000.
- Dates: `db.js` registers a `DATE` (OID 1082) type parser returning the raw `'YYYY-MM-DD'` string —
  keep that; do not reintroduce JS `Date` objects for `price_date`.
- A parallel implementer has already added `database/migrations/007_phase5_canonical_mandi.sql`
  (untracked). It adds a `mandi_prices_canonical` VIEW (aliasing `price_date`→`reported_date`,
  `min_price`→`minimum_price`, `unit`→`original_price_unit`, `price_unit`→`normalized_price_unit`)
  plus additive source-code columns. Treat that view/column vocabulary as the Phase 5 canonical
  contract and do not add a competing table or rename existing columns.
