# Source Investigation — CEDA (Centre for Economic Data and Analysis, Ashoka University)

Investigation date: **2026-10-09**. All rows marked `VERIFIED` were observed by this
investigator using the project's own `CEDA_API_KEY` from `backend/.env`. No credential
value is reproduced anywhere in this document.

## Verdict

**`ACCESSIBLE` — but currently rate-limited, and the project's existing adapter targets
at least one endpoint that does not exist.**

The API key in `backend/.env` is **valid** (a 200 was observed on catalogue endpoints).
This contradicts `docs/PHASE3_SOURCE_ACCESS.md`, which recorded CEDA as `BLOCKED`
(TCP refused). That note is stale and should be corrected.

## Identity

| Property | Value | Status |
|---|---|---|
| Organisation | Centre for Economic Data and Analysis (CEDA), Ashoka University | `VERIFIED` |
| Portal | https://ceda.ashoka.edu.in/data-portal/ | `VERIFIED` |
| API host | `https://api.ceda.ashoka.edu.in` | `VERIFIED` |
| API version prefix | `/v1` | `VERIFIED` |
| Registration page | https://api.ceda.ashoka.edu.in/ (email + organisation → OTP → key) | `VERIFIED` |
| Swagger UI | https://api.ceda.ashoka.edu.in/documentation/ | `VERIFIED` — **broken**: `swagger-initializer.js` still points at `https://petstore.swagger.io/v2/swagger.json`. No machine-readable spec is published. |
| Underlying data | Directorate of Marketing & Inspection (DMI), Ministry of Agriculture and Farmers Welfare, Govt. of India — i.e. Agmarknet | `VERIFIED` (portal footer) |
| Companion site | https://agmarknet.ceda.ashoka.edu.in/ | `VERIFIED` |

## Authentication

| Property | Value | Status |
|---|---|---|
| Scheme | HTTP `Authorization: Bearer <key>` | `VERIFIED` |
| No key | `401` `{"status":"failure","message":"Unauthorised, no api key passed.","isAuthenticated":false}` | `VERIFIED` |
| Key in query string | **Rejected** — `?api-key=<key>` returned the same 401 | `VERIFIED` |
| Registration | Free. Email + organisation → 6-digit OTP → key generated. | `VERIFIED` (portal form) |

## Endpoints — the important section

Base `https://api.ceda.ashoka.edu.in/v1/agmarknet`.

| Endpoint | Method | Status | Evidence |
|---|---|---|---|
| `/commodities` | GET | `VERIFIED` 200 | `{"output":{"type":"success","message":"Data exists","data":[…]}}`, 453 rows |
| `/geographies` | GET | `VERIFIED` 200 | same envelope, 640 rows |
| `/prices` | **POST** | `VERIFIED` route exists | GET → `404 Cannot GET /v1/agmarknet/prices`; POST → `400` (body contract unmet, see below) |
| `/quantities` | **POST** | `VERIFIED` route exists | GET → 404; POST → 400 |
| `/markets` | POST | `UNVERIFIED` | GET → 404. Not re-tested under POST before the rate limit. |
| `/categories`, `/states`, `/districts`, `/market`, `/cities`, `/series`, `/daily`, `/monthly`, `/yearly`, `/history`, `/arrivals`, `/reports` | — | `VERIFIED` 404 | brute-forced prefixes `/v1/agmarknet`, `/v1/agrimarket`, `/v1/agri`, `/v1/market`, `/v1/data`, `/v1/api`, `/v1` × 16 segments × both methods. Only `/prices` returned non-404 under POST. |

### Successful response shapes

`/commodities`:
```json
{"output":{"type":"success","message":"Data exists","data":[
  {"commodity_id":1,"commodity_name":"Wheat"},
  {"commodity_id":23,"commodity_name":"Onion"}]}}
```

`/geographies` (flat, state+district per row — **not** nested):
```json
{"output":{"type":"success","message":"Data exists","data":[
  {"census_state_id":1,"census_state_name":"Jammu & Kashmir",
   "census_district_id":1,"census_district_name":"Kupwara"}]}}
```

Measured counts: **453 commodities**, **640 state/district rows**. Identifiers are
`census_state_id` / `census_district_id` (Census 2011 codes), *not* the generic
`state_id` / `district_id` the project's adapter assumes.

### `/prices` request contract — PARTIALLY VERIFIED

The contract was recovered from the CEDA portal's own production JavaScript bundle
(`agmarknet.ceda.ashoka.edu.in/_next/static/chunks/app/page-aa7bcb85c5cc9efa.js`),
which calls its own server route and forwards:

```json
{"state_id":27,"commodity_id":23,"district_id":497,
 "calculation_type":"d","start_date":"2025-01-15","end_date":"2025-01-15"}
```
plus optional `data_type:"p"` and `chart_type:"map" | "datadownload"`.

`calculation_type` is observed as `"d"` (daily) / `"m"` (monthly). The portal's default
date range was `22/04/2025`–`30/10/2025`; the portal itself warns before downloads
longer than 365 days.

The live gateway returns a **precise** validation error, which is itself verified:

```
POST /v1/agmarknet/prices  -> 400
{"type":"error","message":"Commodity id, state id, start and end date are required"}
```

**UNRESOLVED:** bodies containing all four named fields were still rejected with the
same message. Variants tried, all rejected: keys as numbers and as strings; keys in
camelCase (`commodityId`/`stateId`/`startDate`/`endDate`); values as arrays; nested
under `filter`/`data`/`request`; `category_id` added; form-encoded and query-string
bodies; `data_type`/`chart_type`/`chart_type:"map"` added; DD/MM/YYYY dates; a valid
Maharashtra `state_id=27` with and without `district_id=497`.

Two hypotheses remain, **neither confirmed**:
1. The gateway validates against different key names than the portal's proxy sends
   (i.e. the portal's Next.js server route rewrites the body before forwarding).
2. `state_id` is validated against an internal state table whose ids are **not** the
   `census_state_id` values returned by `/geographies`.

This must be resolved with CEDA before any real price ingestion. It is **not**
resolvable by guessing.

## Rate limiting — MEASURED

| Property | Value | Status |
|---|---|---|
| Behaviour | `429` `{"status":"failure","message":"Too many requests, please try again later."}` | `VERIFIED` |
| Published numeric limit | — | `NOT_PUBLISHED` |
| Recovery | **Not observed.** After a 75 s pause and then a further ~4 min pause, **every** endpoint still returned 429 — including `/commodities` and `/geographies`, which had succeeded moments earlier. No `Retry-After` header was observed. | `VERIFIED` |
| Budget exhaustion | Aggregate/per-key quota consumed by this investigation's endpoint sweep. | `VERIFIED` |

Consequence: any CEDA adapter must treat 429 as normal, back off hard, persist a
resume checkpoint, and never assume recovery within a run.

## Pagination

| Property | Value | Status |
|---|---|---|
| Observed on catalogue endpoints | **None.** `/commodities` (453) and `/geographies` (640) returned the complete set in one response with no `limit`/`offset`/`total` field. | `VERIFIED` |
| On `/prices` | `UNVERIFIED` — could not be reached before the rate limit. The portal slices client-side from a single response. | `BLOCKED` |

## Filtering

| Dimension | Parameter | Status |
|---|---|---|
| Commodity | `commodity_id` | `VERIFIED` (portal) |
| State | `state_id` (value semantics unresolved) | `PARTIAL` |
| District | `district_id` (optional; portal also passes an empty array for All-India) | `PARTIAL` |
| Date range | `start_date` / `end_date` (`YYYY-MM-DD` at the gateway; portal UI uses `DD/MM/YYYY`) | `PARTIAL` |
| Market | `market_id` — **assumed** from the project's adapter, never observed live | `UNVERIFIED` |

## Date coverage

| Property | Value | Status |
|---|---|---|
| Earliest | `UNVERIFIED` — could not query any date | `BLOCKED` |
| Latest | `UNVERIFIED` — could not query any date | `BLOCKED` |
| Documented span | The Phase 5 requirement of 2021-10-01…2026-09-30 came from project config, **not** from CEDA. | — |
| Secondary evidence | A third-party repository (`Krishna-Baldwa/agmarket-mcp`, read-only) states CEDA covers "2000–present (lags ~a few months)". Treat as **weak, unverified** — do not rely on it. | `UNVERIFIED` |

## Licensing and attribution

| Property | Value | Status |
|---|---|---|
| Terms | https://ceda.ashoka.edu.in/api-terms-conditions/ | `VERIFIED` (page exists) |
| Permitted use | Free to download, display and include in other products **for non-commercial purposes** | `DOCUMENTED` (cited on the terms page) |
| Required citation | `"CEDA Agri Market Data (CEDA-AMD), 2000-2023". Centre for Economic Data & Analysis, Ashoka University, https://ceda.ashoka.edu.in/agmarknet` | `DOCUMENTED` |
| Consequence | FASALYTICS is a hackathon/non-commercial project, so use is permitted. **Any** downstream commercial deployment needs a separate agreement. The citation must be shown wherever CEDA data is displayed. | — |

## Credentials required

- `CEDA_API_KEY` — **already present and valid** in `backend/.env` (64 chars).
- Nothing else. No additional scopes or approval are needed for the endpoints that
  responded.

## What remains blocked and why

1. **`/prices` and `/quantities` request contract** — blocked by 429 exhaustion. Needs
   either a CEDA support request or a retry after the quota resets. Do not guess the
   field names.
2. **Date coverage, pagination, rate-limit recovery time** — same cause.
3. **`/markets` under POST** — untested; GET is 404.
4. **Machine-readable spec** — the published Swagger is unconfigured (petstore).