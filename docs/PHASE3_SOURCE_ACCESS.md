# FASALYTICS Phase 3: Mandi Data Sources — Access, Contracts and Safeguards

Verified 2026-10-08 against the official sources with small, unauthenticated requests only
(no data downloaded). Current verification status and evidence: `docs/verification/phase-3-recovery-report.md`.

---

## 1. Source matrix

| | **data.gov.in (`DATA_GOV_IN`)** | **CEDA, Ashoka University (`CEDA`)** | **MOCK (`MOCK_PROVIDER`)** |
| :--- | :--- | :--- | :--- |
| Dataset | "Current Daily Price of Various Commodities from Various Markets (Mandi)" — Directorate of Marketing and Inspection (DMI), Ministry of Agriculture and Farmers Welfare; generated through the AGMARKNET portal | Agmarknet price and quantity series compiled by the Centre for Economic Data and Analysis | Synthetic prices generated locally |
| Role | Current daily prices (incremental refresh) | Historical baseline 2021-10-01..2026-09-30 | Isolated tests only |
| API | `GET https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=&format=json&offset=&limit=&filters[field]=` | `https://api.ceda.ashoka.edu.in/v1` (OpenAPI 3.0, CEDA API 1.0.0) | none |
| Auth | API key as query parameter (OGD API design); redacted from all logs | HTTP Bearer token in the `Authorization` header only | none |
| Env | `DATA_GOV_IN_API_KEY` | `CEDA_API_KEY` | `MANDI_ALLOW_SAMPLE_DATA=true` (refused in production) |
| Units | Not stated in the dataset metadata; Agmarknet publishes Rs./Quintal. Rows are flagged `PRICE_UNIT_FROM_PUBLISHER_CONVENTION` unless the API's field metadata states the unit | Prices ₹/quintal, quantities tonnes (labels on the CEDA Agmarknet portal) | INR/quintal, tonne (synthetic) |
| Status (2026-10-08) | **BLOCKED** — `api.data.gov.in` refuses TCP connections from the development network (www.data.gov.in is reachable); no key configured | **BLOCKED** — no key configured. Official route answers `401` without a token (contract confirmed) | Isolated tests only |

**AGMARKNET (agmarknet.gov.in):** the site ("Agmarknet 2.0") is a JavaScript application with no documented public API. FASALYTICS does not scrape it. Agmarknet data reaches FASALYTICS only through data.gov.in or CEDA, and records are labelled with that real source.

---

## 2. CEDA API contract (from https://api.ceda.ashoka.edu.in/documentation/)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/agmarknet/commodities` | — | `{ commodities: [{ id, name }] }` |
| GET | `/agmarknet/geographies` | — | `{ geographies: [{ state_id, state_name, districts: [{ district_id, district_name }] }] }` |
| POST | `/agmarknet/markets` | `{ commodity_id, state_id, district_id, indicator: "price" \| "quantity" }` (all required) | `{ data: [{ census_state_id, census_district_id, market_id, market_name }] }` |
| POST | `/agmarknet/prices` | `{ commodity_id, state_id (0 = all India), district_id?: [], market_id?: [], from_date, to_date }` | `{ data: [{ date, commodity_id, census_state_id, census_district_id, market_id, min_price, max_price, modal_price }] }` |
| POST | `/agmarknet/quantities` | same as prices | `{ data: [{ date, …, market_id, quantity }] }` |

Errors: 400 invalid parameters, 401 missing/invalid token, 429 rate limit, 500. No pagination and no
variety/grade are documented, so requests are bounded by date windows (`CEDA_REQUEST_WINDOW_DAYS`, default 92)
and CEDA rows carry `variety = NULL`. Terms: non-commercial use with attribution to CEDA, Ashoka University.

The earlier adapter called `GET /v1/agri-market/daily-prices` (HTTP 404) and put the key in the query
string; both were removed.

---

## 3. Safeguards implemented

- **Scheduler** — off unless `MANDI_SYNC_INTERVAL_MINUTES` is a whole number 15–10080 *and* `MANDI_DATA_PROVIDER=DATA_GOV_IN`. No run at start-up, no overlapping runs (in-process guard + PostgreSQL advisory lock), per-run timeout, 3-day lookback for late reports, per-source sync state.
- **Ingestion endpoint** — `POST /api/mandi/sync`: rate limit (5/15 min/IP) → Firebase login (401) → authorisation (403 for all accounts until an admin role is approved) → body validation (400).
- **HTTP** — timeouts, bounded retries with exponential backoff honouring `Retry-After`, request spacing, credentials redacted from errors/logs.
- **Sample data** — MOCK rows are refused by the pipeline and the persister unless explicitly allowed; a database constraint forbids sample rows under `DATA_GOV_IN`/`CEDA` and unflagged MOCK rows.
- **Historical export** (`npm run ceda:export`) — one commodity + district per run, date windows inside 2021-10-01..2026-09-30, gzip CSV + raw JSON per window, atomic writes, checkpoint manifest with SHA-256, resume, free-disk minimum (`MANDI_MIN_FREE_DISK_GB`, default 20) checked before and during writes, download budget (`MANDI_DOWNLOAD_BUDGET_MB`, default 500), Ctrl+C stops after the current window. Files go to `backend/data/mandi` (git-ignored). Nothing is deleted automatically.
- **Persistence** — per-row savepoints; counts returned only after COMMIT and cross-checked against committed rows; idempotent upserts (identical values = unchanged); same-source revisions kept in `mandi_price_revisions`; cross-source disagreements in `mandi_price_conflicts`; `mandi_prices_resolved` returns one source per market-day so sources are never double-counted.

---

## 4. Getting live access

1. **CEDA** — register at https://api.ceda.ashoka.edu.in/ (email → OTP → "Verify & Generate Key"); set `CEDA_API_KEY` in `backend/.env`; then a one-window sample:
   `npm run ceda:export -- --commodity=Onion --state=Maharashtra --district=Nashik --from=2026-09-01 --to=2026-09-30 --max-tasks=1`
2. **data.gov.in** — register at https://data.gov.in, generate an API key, set `DATA_GOV_IN_API_KEY`; ensure outbound HTTPS to `api.data.gov.in` (164.100.61.198:443) is allowed on your network; then
   `npm run mandi:sync -- --provider=DATA_GOV_IN --days=1 --max-records=50 --confirm-db=<test database>`
3. Writes to the development database require explicit approval and `--confirm-db=<DB_NAME>`.
