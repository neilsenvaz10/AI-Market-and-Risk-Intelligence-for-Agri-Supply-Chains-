# Phase 5 — Status Tracker

Last updated: 2026-10-09. Maintained by the lead engineering agent.

Legend: `[x]` done · `[~]` in progress · `[ ]` not started · `[!]` blocked

---

## 1. Baseline audit (Agent 1) — DONE

Repository inspected. Findings:

- `backend/` = Express 4 + Node ESM (`"type": "module"`), test runner is built-in
  `node:test`, DB driver `pg`. No supertest, no axios, no jest/vitest.
- `frontend/` = Vite + React 19 + react-router 7, plain `fetch`, **no test harness**.
- Migrations auto-discovered by directory read (`backend/scripts/migrate.js`,
  pattern `NNN_lower_snake.sql`). No registry to update when adding a migration.
- Existing Phase 3 pipeline: `providers/{ceda,data-gov-in,mock}.provider.js`,
  `normalizer`, `validator`, `deduplicator`, `persister`, `http`, `scheduler`.
- **AGMARKNET does not exist as an adapter and must not be scraped.**
  `backend/src/config/mandiConfig.js:16-18` maps `AGMARKNET` -> `DATA_GOV_IN` as a
  deprecated env alias, because agmarknet.gov.in is a JS app with no documented
  public API. This decision is carried into Phase 5 (see §3).
- Concurrent-developer hazard: `frontend/src/i18n/strings.js` (1110 lines,
  `en`/`hi`/`mr`), `frontend/src/i18n/languages.js`,
  `frontend/src/context/AuthContext.jsx`, `frontend/scripts/check-i18n.mjs`.
  **Treated as read-only for all Phase 5 agents.**

## 2. What Phase 5 inherited as already-complete

| Area | File(s) | State |
|---|---|---|
| Canonical schema | `database/migrations/007_phase5_canonical_mandi.sql` | done — 8 columns, partial unique index, 4 indexes, 47-col view |
| Canonical field mapper | `backend/src/pipeline/canonical.js` | done — pinned to migration 007 by a drift test |
| Canonical persistence | `backend/src/pipeline/persister.js` | done |
| Normalizer pass-through | `backend/src/pipeline/normalizer.js` | done |
| Storage layer | `backend/src/pipeline/storage/*` (7 files) | done — atomic write, csv.gz, disk guard, budget, manifest, partition |
| Read API | `market.service/controller/routes/validator.js` + `app.js` mount | done — all 5 endpoints |
| Quality report | `qualityReport.service.js` + `quality-report.js` CLI (14 sections) | done |
| Storage usage CLI | `scripts/data-usage.js` | done |

## 3. Remaining work

### 3.1 Source investigation — `[x]` done
`docs/phase5/source-investigation/` — `CEDA.md`, `AGMARKNET.md`, `DATA-GOV-IN.md`,
`SUMMARY.md`. Live-verified with the project's own credentials.

Verdicts: **CEDA = `ACCESSIBLE`** (key valid, catalogue endpoints return real data;
`/prices` contract unresolved; 429 quota exhausted during investigation) ·
**AGMARKNET = `BLOCKED-NO-PUBLIC-API`** (no published API; kept as a deprecated alias
for `DATA_GOV_IN`) · **data.gov.in = `BLOCKED`** (Akamai edge resets TLS from this
network; no API key configured).

Two defects in the pre-existing `ceda.provider.js` were found and fixed: it claimed to
be verified against an official OpenAPI document that does not exist, and it parsed a
response envelope/field names that the live API does not use.

### 3.2 Ingest orchestrator — `[x]` done
`backend/scripts/mandi-ingest.js` was missing while `package.json` declared
`npm run mandi:ingest` — a broken script. Built with subcommands `sources`,
`discover`, `sample`, `preview`, `incremental`, `historical`, `resume`, `status`,
`estimate`, `cleanup`. Plus 55 tests. Safety gates verified live (see §4).

### 3.3 Config hygiene — `[x]` done
- `backend/.env.example` — Phase 5 keys documented, including an explicit warning that
  the three ingest budget/floor/cap knobs are CLI flags only and are NOT read from env.
- Root `.gitignore` — `*.csv.gz`, `*.json.gz`, `*.csv`, `/backend/data/`. A bare
  `data/` pattern was deliberately avoided because it shadows the tracked
  `ml-service/data/` package.
- `docker-compose.yml` — migrations `003`–`007` now mounted into
  `docker-entrypoint-initdb.d`, so a fresh volume reaches `mandi_prices_canonical`.
- `backend/src/app.js` — root `GET /` now reports Phase 5.
- `docs/phase5/OPERATIONS.md` — the runbook `.env.example` points at. Every command in
  it was executed and its exit code observed.

### 3.4 Frontend integration — `[x]` done
`marketApi.js` (610 lines) + rewired `MandisPage`, `HomePage`, `AlertsPage`.
83 tests. Real loading/error/empty/ready states, real filters, source attribution,
backend-computed freshness (never recomputed client-side), real derived movements.

### 3.5 Verification — `[~]` partial
- `npm run test:unit` — **295 tests, 294 pass, 0 fail, 1 DB-gated skip**. ✓
- `node --test test/market-api.test.mjs` — **83 tests, 83 pass**. ✓
- `npm run lint` (frontend) — 0 errors, 16 pre-existing warnings, none in Phase 5 files. ✓
- `npm run build` (frontend) — succeeds. ✓
- `npm run check:i18n` — 289 keys, all present. ✓
- **CEDA live sample: PARTIAL.** `discover --source=ceda` parsed real live data
  (453 commodities, 640 geographies) — this is genuine end-to-end verification of the
  fixed catalogue path. Price ingestion cannot be sampled (contract unresolved).
- **data.gov.in live sample: BLOCKED** (network + missing key).
- **`npm run test:db`: NEVER RUN** — no Docker, no PostgreSQL on this machine. The
  canonical view has never been created in a live database.
- **Storage measurement:** free space measured (97.56 GB on E:), but no dataset has
  been downloaded, so there is no measured sample size and no credible full-run
  estimate. `estimate` correctly fails closed with `UNKNOWN_SIZE` rather than guessing.
- **`quality:report`** — implemented and unit-tested, but never run against a populated
  database.

### 3.6 Final review — `[x]` done
A dedicated review agent audited migrations, API contracts, frontend↔backend matching,
dedup/provenance, disk guards, tests, git state and honesty. Three blockers found and
fixed (see §4). Seven "should fix" items resolved. Remaining known issues are listed
in `OPERATIONS.md` § Known blockers.

## 4. What was verified live during this phase

| Check | Result |
|---|---|
| `mandi-ingest sources` | exit 0; reports both sources, prints no keys |
| `mandi-ingest discover --source=ceda` | exit 0; **453 commodities + 640 geographies parsed from the live CEDA API** |
| `mandi-ingest sample --source=ceda` (bounded) | exit 1 `CEDA_CONTRACT_UNVERIFIED` — gate working, message actionable |
| `mandi-ingest sample --source=data-gov-in` | exit 3 blocked |
| `mandi-ingest historical` (no token) | exit 2, prints the refusal + storage estimate, downloads nothing |
| `mandi-ingest cleanup` (no token) | exit 2, deletes nothing |
| `mandi-ingest cleanup --dry-run` | exit 0, reports what *would* be deleted |
| `mandi-ingest estimate` | exit 2 `UNKNOWN_SIZE` — fails closed rather than inventing a number |
| `backend/data/` | does not exist; 0 B used. **No bulk data was downloaded.** |

## 5. Standing constraints for this phase

- **No git write operations.** The user owns all git.
- **Do not** run the full 5-year nationwide CEDA ingestion. It requires the
  literal confirmation token and the user's explicit approval.
- **Do not fabricate** endpoints, credentials, coverage, prices, or test results.
- **Do not** start/stop the PostgreSQL container or mutate the database without approval.
- **Do not** edit `frontend/src/i18n/*` or `AuthContext.jsx` — parallel developer owns them.