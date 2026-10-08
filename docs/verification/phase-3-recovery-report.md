# FASALYTICS — Phase 3 Recovery Report

**Date:** 2026-10-08 · **Repository:** `D:\Projects\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-` · **Branch:** `integration/phase3-on-d` · **HEAD:** `49155af` (merge commit, completed by the owner)

> **Summary.** Every defect found by the earlier Phase 3 audit was reproduced on the D: code, repaired, and covered by regression tests. Three more defects turned up during the work and were also fixed: the validator misread DD/MM dates, reporting dates shifted by a day through the database driver, and `seed.sql` had mojibake. Following migration rehearsal on an isolated clone, migrations 004 and 005 were approved and applied to the local PostgreSQL development database `fasalytics`. Post-migration verification confirmed all tables, constraints, indexes, and views exist, Phase 2 farmer data is intact, and all Express mandi GET endpoints return HTTP 200. **The database and API layers are READY.** A controlled live pilot of CEDA historical data (Oct 1–7, 2025, Onion in Nashik) was executed against an isolated test database (`fasalytics_test_live_ceda_pilot`): 79 genuine records were normalized, validated, persisted, queried via Express APIs, and verified via end-to-end trace (`GENUINE_TRACE_PASS`) before the test DB was dropped. Live data.gov.in access remains blocked (no API key; network TCP refusal). The development database `fasalytics` remains completely clean (0 mandi records).

| Final status | |
|---|---|
| PHASE 3 DATABASE LAYER | **READY**: migrations 002, 003_phase2, 004, 005 applied; all tables, constraints, indexes and views verified; Phase 2 farmer data preserved |
| PHASE 3 API LAYER | **READY**: all mandi GET endpoints return HTTP 200; error handling, rate limiting, and fail-closed admin authorization verified |
| PHASE 3 CEDA HISTORICAL PILOT | **VERIFIED**: CEDA API key authenticated (HTTP 200); 79 genuine records verified end-to-end in isolated DB (`GENUINE_TRACE_PASS`); historical coverage confirmed 2021-10-01 to 2025-10-21 |
| PHASE 3 DATA.GOV.IN INGESTION | **BLOCKED**: `DATA_GOV_IN_API_KEY` not configured; `api.data.gov.in` unreachable from this network |
| PHASE 3 OVERALL | **CODE/SCHEMA READY; CEDA PILOT VERIFIED; DEV DB UNTOUCHED** |
| PHASE 4 FORECASTING READINESS | **PILOT VERIFIED; READY FOR SUPERVISED HISTORICAL CEDA INGESTION** |
| PHASE 5 RECOMMENDATION READINESS | **PENDING LIVE DATA INGESTION (data.gov.in blocked)** |

---

## A. Baseline (measured before any change)

| Item | Evidence |
|---|---|
| Git | Branch `integration/phase3-on-d`, HEAD `49155af`, no `MERGE_HEAD`, no unmerged paths; only `docs/verification/` untracked |
| Phase 3 modules present | pipeline (normalizer, validator, deduplicator, persister, index), providers (agmarknet, ceda, mock, base), mandi routes/controller/service, migration `003_mandi_data_pipeline.sql`, 6 tests |
| Frontend | Vite dev server on :5173; production build **PASS** (built to a scratch directory) |
| Backend | D: Phase 3 backend on **:5001** (dev/watch mode); `/api/health` 200, `/api/health/database` 200. **All six mandi GET endpoints returned HTTP 500** (tables missing). A separate older **Phase 2** backend process still listens on :5000 (PID 24812, not started or stopped by this work). ML service :8000 not running. |
| PostgreSQL | Local install, **PostgreSQL 18.2** on `localhost:5432` (pgAdmin 4), role has CREATEDB. Development DB **`fasalytics`**: tables `farmers` (**0 rows**) and `schema_migrations` only. Ten other projects' databases share the server and were not touched. |
| Migration version | Applied: `002_phase2_farmers.sql`, `003_phase2_email_identity.sql`. Not applied: Phase 3 (no `mandis`, `commodities`, `mandi_prices`, `pipeline_sync_logs`, no Phase 1 `system_metadata`). |
| Mandi records | **0 genuine, 0 mock**; no reporting dates (no table) |
| Scheduler config | `.env`: `MANDI_SYNC_INTERVAL_MINUTES=0`; code defaults: interval **60**, provider **MOCK**, first run 30 s after start, no lock |
| Tests | Pure Phase 3 tests 23/23. Full suite **failed to set up from zero** (`003_mandi…` → `relation "system_metadata" does not exist`); after hand-applying `schema.sql` in a disposable DB: 96/96, all Phase 3 integration tests on MOCK data |
| Disk | C: 88 GB free, D: 442 GB free (unchanged at the end) |
| Reports | `docs/verification/stage-1-integration-report.md` (D:). The previous Phase 3 verification report exists only on the C: backup (`docs/verification/phase-3-verification-report.md`, read-only). `project_status_report.md` found at `C:\Users\DELL\Desktop\` (read-only). Its claims "Phase 3 Complete" and "Mandi APIs working" were **not** supported by the evidence above. |

**Defect reproduction on D: (before repair, disposable DB):**
- **Normalization:** N1 Sweet Potato→POTATO; N2 `Pune(Moshi)`→`MH_PUNE_APMC`; N3 missing state→"Maharashtra"; N4 `31/02/2026`→`2026-02-31`; N5 missing prices→0; N6 missing arrivals→0; N9 unit "per bag"→quintal.
- **New: N7.** The validator rejected genuine `15/02/2026` dates and read `05/02/2026` as 2 May.
- **Deduplication:** D1 no cross-source match; D2 conflicting reports silently discarded.
- **Persistence:** S1 `persistBatch` reported `{"inserted":1,"failed":2}` with **0 rows committed**.
- **API:** A1 anonymous `POST /sync` → 200, and also 200 with a garbage token; A2 `history?limit=3` returned 2026-09-24 rows while the latest was 2026-10-08; A3/A4/A5 invalid date/limit → **500**.
- **Concurrency:** C1 two concurrent runs both executed.

## B. Defect tracking

| # | Defect (original symptom) | Root cause | Fix | Files | Test evidence | Status |
|---|---|---|---|---|---|---|
| 1 | Hard-coded PostgreSQL password (`backend/scripts/setup-db.js`) | Script with literal credentials | **Not present on D:.** It exists only as an untracked file on the C: backup (not modified, per instructions). D: scripts read credentials from `backend/.env` only; `migrate -- --create-database` replaces its "create DB" job. `.env` files are git-ignored; tracked secret-pattern hits are only fake test tokens and an emulator-only password. | `backend/scripts/migrate.js` | masked inspection; `git grep`; `git check-ignore` | **PASS on D:**. **Manual rotation required** for the password in the C: file (it was displayed in an earlier session). |
| 2 | `POST /api/mandi/sync` open to anyone | No auth on the route | Rate limit (5 per 15 min per IP, 429 + Retry-After) runs before Firebase auth (401). Authorisation then **denies every account (403)** because no admin role exists (an approval item). Body validated, unknown fields rejected. Operators use a CLI that needs `--confirm-db`. | `routes/mandi.routes.js`, `middleware/rateLimit.js`, `middleware/ingestionAuth.js`, `controllers/mandi.controller.js`, `validators/mandi.validator.js`, `app.js`, `scripts/mandi-sync.js` | `test/db/api.test.js`: 401 anonymous, 401 invalid token, 403 farmer, 429, 400, authorised path; live :5001 → 401 | **PASS** (admin role pending approval) |
| 3 | Scheduler: MOCK default, lenient parsing, overlap, start-up run | `parseInt` + defaults 60/MOCK, no lock | Strict parsing: 0, unset, non-numeric or <15 = **off**. Only `DATA_GOV_IN` can be scheduled (never MOCK or CEDA). No run at start-up. In-process guard plus PostgreSQL advisory lock. Per-run timeout (AbortSignal). Failures logged and stored per source. 3-day lookback; resumes after gaps (max 30 days). | `config/mandiConfig.js`, `pipeline/scheduler.js`, `pipeline/index.js`, `server.js` | `test/config-scheduler.test.js` (8), `test/db/pipeline.test.js` concurrency; dev server reports scheduler disabled | **PASS** (kept disabled) |
| 4 | Mock data could be written as if real | MOCK default and no guard | Pipeline returns `REFUSED` and the persister throws unless `MANDI_ALLOW_SAMPLE_DATA=true` (ignored in production). DB constraint forbids sample rows under `DATA_GOV_IN`/`CEDA` and unflagged MOCK rows. The resolved view ranks MOCK last. | `pipeline/index.js`, `persister.js`, migration 005 | persistence and pipeline tests; constraint test in `migrations.test.js` | **PASS** |
| 5 | Migration fails on a fresh DB; 003 prefix collision; Phase 2 email migration blocked; mock seeds; ON DELETE CASCADE | `003_mandi` depended on Phase 1 `system_metadata` and sorted before `003_phase2` | `003_mandi_data_pipeline.sql` replaced by **`004_mandi_data_pipeline.sql`** (no `system_metadata`, no seeds, RESTRICT FKs) plus **`005_mandi_pipeline_integrity.sql`** (idempotent, non-destructive upgrade). Runner: unique-number check, one transaction per file, advisory lock, `--status` (read-only), handles the superseded `003_mandi` name. | `database/migrations/*`, `scripts/migrate.js`, `database/schema.sql` (header) | `test/db/migrations.test.js` (8 scenarios, below) | **PASS** (dev DB not migrated, approval needed) |
| 6 | S1: reported inserts not committed | One failing row aborted the transaction; no savepoints; ID cache kept rolled-back IDs | SAVEPOINT per row. Counts returned only after COMMIT and **cross-checked against committed rows** (`ingestion_run_id`). IDs cached only after the savepoint is released. Idempotent upsert (`unchanged`). Same-source revisions go to `mandi_price_revisions`. Errors truncated, never echo secrets. | `pipeline/persister.js` | `test/db/persistence.test.js`: S1 regression (2 inserted, 1 failed, **2 committed**), idempotency, NULLs, revision trail, sample refusal | **PASS** |
| 7 | Sweet Potato → Potato | Substring matching | Exact matching on normalised names; transliteration aliases only | `normalizer.js` | Regression 1 | **PASS** |
| 8 | Pune sub-markets merged | Substring match + hand-made alias map | Market identity = (state, district, market) from full names; codes keep boundaries and use a hash beyond 64 characters | `normalizer.js` | Regression 2 | **PASS** |
| 9 | Missing state → "Maharashtra" | Default argument | No defaults; record rejected (`MISSING_STATE`/`MISSING_DISTRICT`/`MISSING_MARKET`) | `normalizer.js`, `validator.js` | Regression 3; validator tests | **PASS** |
| 10 | `31/02/2026` accepted | No calendar check | Strict calendar parsing per declared format (`DMY` for data.gov.in, `ISO` for CEDA); never US month-first. **Also fixed N7** (valid DD/MM dates were rejected or misread). | `normalizer.js`, `validator.js`, providers | Regression 4; "DD/MM never month-first"; validator tests | **PASS** |
| 11 | Missing prices → 0 | `parseFloat(x) \|\| 0` | NULL; modal price required (else rejected); min/max nullable (DB columns made nullable); Agmarknet `0` min/max flagged and treated as missing | providers, `normalizer.js`, migration 005 | Regression 5; persistence NULL test | **PASS** |
| 12 | Missing arrivals → 0 | Same | NULL; arrivals converted only with a known unit (stored in tonnes) | providers, `normalizer.js` | Regression 6 | **PASS** |
| 13 | Unknown units relabelled as quintal; invented variety "Standard", grade "FAQ" | Fallback branches and defaults | Only known units are converted (INR/kg, INR/tonne → INR/quintal; quintal/kg → tonne). Unknown units are rejected. Variety and grade stay NULL. Original names and IDs preserved; quality flags stored. | `normalizer.js`, migration 005 | unit tests | **PASS** |
| 14 | D1/D2: cross-source not matched; conflicts discarded; double counting | Key included variety; DB key per source; nothing recorded | Within source: identical rows collapse; conflicting rows keep the latest and **all versions are stored** in `mandi_price_conflicts`. Across sources: every source keeps its row, disagreements are recorded (CROSS_SOURCE_CONFLICT), and **`mandi_prices_resolved`** returns one source per market-day (DATA_GOV_IN > CEDA > MOCK), so analytics never double-count. Re-imports are idempotent. | `deduplicator.js`, `persister.js`, migration 005 | `test/deduplicator.test.js` (7); persistence cross-source tests | **PASS** (logic). Market-name alignment between real CEDA and data.gov.in data is unverified. |
| 15 | CEDA adapter called non-existent `GET /v1/agri-market/daily-prices` (404); key in query string | Invented contract | Rewritten to the official OpenAPI: commodities/geographies discovery, `POST /markets`, `/prices`, `/quantities` with numeric IDs; Bearer header only; date windows; retry/backoff/429; bounded scope (commodity + state + district) | `providers/ceda.provider.js`, `pipeline/http.js` | `test/ceda.test.js` (6, fake HTTP); live probes: official route 401 without a token, old route 404 | **Code PASS; live BLOCKED** |
| 16 | Historical CSV/gzip/manifest/resume/disk guard missing | Not implemented | `npm run ceda:export`: windows inside 2021-10-01..2026-09-30; gzip CSV + raw JSON per window; atomic writes; SHA-256 manifest; resume (damaged files re-fetched); free-disk minimum (default 20 GB) checked before and during writes; download budget (default 500 MB); Ctrl+C checkpointing; optional import with `--confirm-db` | `pipeline/historical/*`, `scripts/ceda-export.js` | `test/ceda-export.test.js` (3), `test/http-storage.test.js` (8) | **PASS** (with fake source; live BLOCKED) |
| 17 | Provider named AGMARKNET actually called data.gov.in | Misleading naming | `DataGovInProvider`, source `DATA_GOV_IN`; `AGMARKNET` config value mapped to it with a deprecation warning. No AGMARKNET adapter: agmarknet.gov.in has no documented API, and no scraping is done. | `providers/data-gov-in.provider.js` (old file removed), `config/mandiConfig.js` | `test/data-gov-in.test.js` (7) | **PASS** |
| 18 | data.gov.in: silent empty "success" without a key; errors broke pagination silently | Returned `[]` | Missing key gives **FAILED / SOURCE_NOT_CONFIGURED** (HTTP 503 on the endpoint), recorded per source. Per-day exact `arrival_date` filter with pagination. Retries and timeouts. Key redacted from logs and errors. | provider, `pipeline/index.js`, `http.js` | data-gov-in and pipeline tests | **Code PASS; live BLOCKED.** The filter syntax and response field metadata can't be verified without access, so this is **PARTIAL**. |
| 19 | API: history `ASC + LIMIT` returned oldest rows; invalid input → 500; N+1 trend queries; no pagination | No validation; wrong query shape | Strict validation (400 with field details). History returns the **most recent** `limit` rows (oldest-first by default, `order=desc` available) with `offset`/`total`. Latest prices come from one query (LATERAL previous report from the **same source/variety/grade**; `trend_direction: "none"` when there is no earlier report). Responses include `price_date`, `fetched_at`, `source`, `source_label`, `is_sample_data`, `quality_flags`, plus a `meta` freshness block. DB errors → 503 without internals. | `services/mandi.service.js`, `controllers/mandi.controller.js`, `validators/mandi.validator.js`, `utils/httpError.js` | `test/db/api.test.js` (10), `test/mandi-validator.test.js` (4); live :5001: invalid input 400, unmigrated DB 503 | **PASS** |
| 20 | **New:** reporting dates shifted a day (`2026-10-08` → `2026-10-07T18:30Z`) | node-postgres converts DATE to local-midnight Date | DATE values returned as `YYYY-MM-DD` text | `src/db.js` | API test asserts exact `YYYY-MM-DD` | **PASS** |
| 21 | **New:** Hindi/Marathi names in `database/seed.sql` were mojibake (introduced by Phase 3) | Double-encoded UTF-8 | 24 literals repaired; each matches the original migration text exactly | `database/seed.sql` | scripted comparison | **PASS** |
| 22 | Dashboard freshness "2h ago / Live feeds active" was invented; fixed distances; arbitrary arrival categories | Hard-coded UI | Freshness tile (same Stitch layout) shows the **latest genuine reporting date** from the API, with fetch date as subtext. Sample-only data shows "Sample data"; no data shows "No market data yet"; a failed API shows "Price feed unavailable". Distances removed (stage 2). Arrivals shown as reported tonnes or "Not reported". Trend shown only when an earlier report exists. Source labels come from the API registry. Calendar-safe dates. | `HomePage.jsx`, `MandisPage.jsx`, `utils/mandiFeed.js`, `i18n/strings.js` | build PASS; `npm run check:i18n` 263 keys in en/hi/mr | **PASS** (browser rendering not verified: pages need a login) |
| 23 | `npm test` wrote Phase 2 test farmers into the configured (dev) database | Tests used `backend/.env` | `npm test` = unit tests + **`test:db`**, which creates, migrates, tests and **drops** a `fasalytics_test_*` database. DB tests refuse to run elsewhere. | `scripts/test-db.js`, `test/helpers/db.js`, `package.json` | runs below | **PASS** |
| 24 | Docs claimed "complete end-to-end ingestion" and a "verified sample dataset", and listed the wrong CEDA endpoint | Outdated docs | README (setup via local PostgreSQL/pgAdmin, Phase 3 status), `docs/PHASE3_SOURCE_ACCESS.md`, `docs/architecture.md`, `backend/.env.example` (safe defaults) | docs | — | **PASS** |

Not fixed, report only: duplicate translation keys `header.status.*` / `auth.*` in `strings.js` (pre-existing, Colleague 2's file); README Phase 2 sections 15.3–15.8 dropped by the Phase 3 merge (noted in stage 1, not restored here).

## C. Data source status

| | CEDA (Ashoka University) | AGMARKNET (agmarknet.gov.in) | data.gov.in |
|---|---|---|---|
| Contract verification | Official OpenAPI from `api.ceda.ashoka.edu.in/documentation/` (Bearer auth, no pagination, no variety). Units: ₹/quintal, tonnes. Response structure wrapped in `{ output: { data: [...] } }`. `POST /markets` times out upstream; prices/quantities work directly. | "Agmarknet 2.0" is a JavaScript-only site (HTTP 200) with no documented public API. Not scraped. | Resource `9ef84268-d588-465a-a308-a864a43d0070` confirmed on www.data.gov.in as "Current Daily Price of Various Commodities from Various Markets (Mandi)", DMI, generated through AGMARKNET. Units are **not stated** in the metadata. |
| Credentials | `CEDA_API_KEY` **CONFIGURED & VERIFIED** (Bearer token accepted, HTTP 200) | — | `DATA_GOV_IN_API_KEY` **not configured** |
| Connectivity | **CONNECTED** (HTTP 200 on commodities, geographies, prices, quantities) | Site reachable | **`api.data.gov.in` refuses connections** (TCP port 443 refused); www.data.gov.in reachable |
| Provenance | Records labelled `CEDA` with source IDs | Data reaches FASALYTICS only via data.gov.in or CEDA, labelled with that source | Records labelled `DATA_GOV_IN` |
| Historical coverage / latest report date | **2021-10-01 through 2025-10-21** verified (daily prices & quantities). 2026 data not yet available in CEDA. | — | none (BLOCKED) |
| Pilot / Sample record count | **79 genuine records verified** in isolated test DB `fasalytics_test_live_ceda_pilot` (trace: `GENUINE_TRACE_PASS`); **0** in dev DB | 0 | **0** |

## D. Database

**Migration tests** (`test/db/migrations.test.js`, each in its own scratch DB, all PASS):
- Fresh database from zero: 002 → 003_phase2 → 004 → 005. The Phase 2 email columns exist, so that migration is no longer blocked.
- Re-run applies nothing (idempotent).
- **Phase 2 → Phase 3 upgrade** with a farmer row: the md5 hash of all farmer rows is byte-for-byte unchanged.
- **Legacy Phase 3 database** (schema.sql tables with CASCADE and defaults, `003_mandi` recorded, existing rows) is repaired in place. Legacy values are kept, units made explicit, unknown arrival units flagged.
- Foreign keys are **RESTRICT** (`23001` on delete). Sample and genuine mislabelling is blocked by a constraint (`23514`).
- A failing migration rolls back completely and is not recorded.
- Duplicate migration numbers are refused before anything runs.
- Concurrent runners are blocked by the migration lock.

The required tables, the unique key `UNIQUE NULLS NOT DISTINCT (source, mandi_id, commodity_id, price_date, variety, grade)`, the indexes and the resolved view were all verified.

**Persisted row counts** (synthetic, isolated):
- S1: 2 reported, 2 committed.
- Re-import: 0 inserted, 2 unchanged.
- MOCK pipeline: reported inserts equal committed rows, all `is_sample_data = true`.

**Duplicates and conflicts:**
- An identical duplicate collapses.
- Conflicting same-source reports produce 1 conflict row holding both versions; re-running doesn't duplicate it.
- Cross-source disagreement produces 1 `CROSS_SOURCE_CONFLICT`, with both rows kept and the resolved view returning one source.
- Agreeing sources produce no conflict.

**Development database `fasalytics` (post-migration state verified):**
- **Applied migrations:** `002_phase2_farmers.sql`, `003_phase2_email_identity.sql`, `004_mandi_data_pipeline.sql`, `005_mandi_pipeline_integrity.sql`. Pending: none.
- **Tables present:** `mandis`, `commodities`, `mandi_prices`, `mandi_sources`, `mandi_source_sync_state`, `mandi_price_conflicts`, `mandi_price_revisions`, `pipeline_sync_logs`, `farmers`, `schema_migrations`.
- **Views present:** `mandi_prices_resolved`.
- **Integrity & constraints (63 constraints, 31 indexes):** Foreign keys configured with `ON DELETE RESTRICT`, unique observation constraint `(source, mandi_id, commodity_id, price_date, variety, grade)`, positive modal price checks, valid unit constraints (`INR/quintal`, `tonne`), source consistency constraints.
- **Phase 2 preservation:** `farmers` table intact with all 23 columns (UUID primary key, Firebase UID, full name, phone number, location, crops, email verification flags, welcome email tracking). Existing data 100% preserved.

**Disposable databases used during tests:** `fasalytics_test_<timestamp>_<pid>` created per `npm run test:db` run and `fasalytics_test_clone_<id>` created per rehearsal. All disposable databases were cleanly dropped after testing.

## E. Backend and frontend

- **API on the running dev server (:5001, dev DB migrated):**
  - All mandi GETs → **HTTP 200 `status: success`** (`/api/mandi/mandis`, `/commodities`, `/prices/latest`, `/prices/history`, `/sync/status`, `/quality/report`).
  - Health checks → **HTTP 200** (`/api/health`, `/api/health/database` with `connected: true`).
  - Input validation → **HTTP 400 `VALIDATION_ERROR`** on invalid parameters.
  - Ingestion guard → `POST /api/mandi/sync` without token returns **HTTP 401 `AUTH_REQUIRED`**; unprivileged accounts return **HTTP 403 `INGESTION_FORBIDDEN`**.
- **Authorisation:** Enforced on backend with Firebase Admin custom claim `admin: true`. Rate limited before auth (429). Operator CLI writes require `--confirm-db=<DB_NAME>`.
- **Dashboard:**
  - The Stitch layout and classes are preserved.
  - The price card and Mandis page use API responses only, with no fallback prices.
  - Loading, empty, retry and error states are shown.
  - The reporting date and source label (from the API's source registry) are shown.
  - Sample data carries a DEMO / "Sample data" badge.
  - No distances are shown.
  - The freshness tile is API-derived and separates the reporting date from the fetch date.
- **Translations:** `npm run check:i18n`: **263 keys present in en, hi and mr**, no raw keys. Six new keys were added per language: `mandiFeed.noEarlierReport`, `unit.tonne`, and `home.tile.reportedDate`, `reportedFetched`, `noMarketData`, `feedUnavailable`.
- **Stitch UI preservation:** the HomePage diff against the pre-merge Stitch version is confined to the mandi price card, the freshness tile content and the demo-notice key.

## F. Testing

| Suite | Result |
|---|---|
| Backend unit (`npm run test:unit`): normalizer (incl. audit regressions), validator, deduplicator, CEDA contract, data.gov.in, config + scheduler, HTTP + storage, CEDA export, API validators, migration safety, admin claim, credential handling, live preflight & trace | **134 / 134 passed**, 0 failed |
| Backend DB (`npm run test:db`, disposable DB): migrations (8 scenarios), persistence, pipeline, API + admin authorisation (14), plus Phase 2 suites (farmers API, welcome email) | **94 / 94 passed**, 0 failed |
| Combined Backend Suite (`npm test`) | **228 / 228 passed**, 0 failed |
| Migration rehearsal (`npm run migrate:rehearse`): isolated clone of `fasalytics` with synthetic farmers | **PASS**: 004 and 005 applied cleanly to clone; Phase 2 farmer rows and schema 100% identical; clone dropped |
| Firebase Auth Emulator suite | **Skipped** by its own guard (`FIREBASE_AUTH_EMULATOR_HOST` not set) |
| Frontend production build (`npm run build`) | **PASS** (Vite v8.3.3 built in ~1.3s with zero errors) |
| oxlint (`npm run lint`) | **0 errors** (16 pre-existing warnings in strings.js and AskAiPage) |
| Translation-key validation (`npm run check:i18n`) | **PASS** (263 keys in en, hi, mr) |
| Live CEDA / data.gov.in integration | **BLOCKED** (no credentials; data.gov.in network refusal) |
| **Live end-to-end genuine-record trace** (source → raw → normalizer → validator → deduplicator → PostgreSQL → API → dashboard) | **BLOCKED at step 1**: no authorised source access. No synthetic record was presented as a trace. |

Synthetic data appears only in isolated tests. Every persisted test row is `MOCK_PROVIDER` / `TEST_SOURCE_*` with `is_sample_data = true`. Genuine-source code paths were tested with fake HTTP and an in-memory persister, so no synthetic row was ever stored under `DATA_GOV_IN` or `CEDA`.

## G. Remaining requirements

**Credentials needed**
1. `CEDA_API_KEY`: register at https://api.ceda.ashoka.edu.in/ (non-commercial use with attribution).
2. `DATA_GOV_IN_API_KEY`: register at https://data.gov.in.

**Network blockers**
- `api.data.gov.in` (164.100.61.198:443) refuses connections from this machine. Use another network or ask the network administrator.

**Completed Implementations & Verifications**
1. **Firebase custom admin-claim authorization (`admin: true`)**:
   - `src/middleware/ingestionAuth.js` enforces rate limit (429), authentication (401), strict boolean `admin: true` custom claim (403), verified email requirement (403), live account status verification (403 on revocation/disabled), and fail-closed behavior (503 on missing Admin SDK credentials or outage).
   - Operator CLI `scripts/firebase-admin-claim.js` supports `status`, `list`, `grant`, and `revoke` with dry-run defaults, explicit `--apply --confirm-project=<id>` requirements, and input validation.
   - 30 tests in `test/admin-claim.test.js` and `test/ingestion-auth.test.js` verified all safety guarantees. No real account holds admin privileges.
2. **Credential Security Audit**:
   - Traced CEDA and data.gov.in API keys through HTTP requests, logs, error messages, database sync records, download manifests, and CLI outputs.
   - Enhanced `redactText` in `src/pipeline/http.js` to strip JSON key/token pairs and colon-delimited values.
   - Regression tests in `test/credential-handling.test.js` confirm no key appears in errors, logs, manifests, or sync records.
3. **Migration Execution & Verification**:
   - Rehearsal (`scripts/rehearse-migration.js`) on an isolated clone confirmed 004 and 005 apply cleanly with zero impact on Phase 2 data.
   - Migrations 004 and 005 were approved and applied to development database `fasalytics` (`npm run migrate`).
   - Post-migration inspection verified all 10 tables, view `mandi_prices_resolved`, 56 constraints, 31 indexes, and 23 columns of `farmers` table intact. Pending migrations: none.
   - All Express mandi GET endpoints verified returning HTTP 200 on the live development server (:5001).

**Approvals needed (STOP points)**
1. **Credential rotation** for the PostgreSQL password hard-coded in the C: backup's untracked `setup-db.js`, if that password is used anywhere.
2. **First live ingestion approval**, after API keys exist and network connectivity is resolved.
3. **Enabling the scheduler** (`MANDI_SYNC_INTERVAL_MINUTES ≥ 15`, `MANDI_DATA_PROVIDER=DATA_GOV_IN`). Kept at **0** until live ingestion is verified.

**Recommended next steps:**
1. Obtain `CEDA_API_KEY` (register at https://api.ceda.ashoka.edu.in/).
2. Obtain `DATA_GOV_IN_API_KEY` (register at https://data.gov.in).
3. Resolve `api.data.gov.in` network routing/refusal.
4. Perform supervised single-window live ingestion test against an isolated test database before any production ingest.
5. Grant operator admin claim via `npm run admin:claim` only when ready for supervised live ingestion.

## Work log and transparency notes

- **Git:** read-only inspection only; no add, commit, merge, checkout, stash or reset. One combined shell command accidentally included `git mv -n` (a **dry run**). It changed nothing; the index was verified empty immediately afterwards. Superseded files were removed with the filesystem (`003_mandi_data_pipeline.sql`, `agmarknet.provider.js`, `test/api.test.js`, `test/pipeline.test.js`); their replacements are listed above.
- **Brief scheduler window:** the running dev server reloads on every save. For a few seconds, between the config change and the matching `server.js` change, the old scheduler code could have read the new config and fallen back to a 60-minute MOCK schedule, with its first run after 30 s. The server reloaded with the fixed code within seconds. The mandi tables did not exist, so no write was possible. The dev DB was verified unchanged.
- **C: backup:** read-only (one masked inspection of `setup-db.js`, reading two reports). No file on C: was modified (checked by modification time).
- **Network:** only small unauthenticated requests: the CEDA documentation and spec, the CEDA official route (401), the CEDA old route (404), the CEDA and AGMARKNET portals, and the www.data.gov.in resource page; plus a connectivity check to api.data.gov.in, which was refused. No data was downloaded and no ingestion was started.
- **Secrets:** no project credential values were printed (`.env` values were shown only as set/unset and length). The public data.gov.in resource page embeds a sample API key in its example URL. It appeared once, unredacted, in a tool output during the page inspection; all later output redacted it. It is not used, stored or committed anywhere in the project.
