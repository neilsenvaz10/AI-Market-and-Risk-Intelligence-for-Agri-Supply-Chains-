# FASALYTICS — Service Architecture & System Design

## 1. System Overview

**FASALYTICS** is an AI-powered agricultural decision-support platform designed to help Indian farmers make optimal selling and marketing decisions for their agricultural produce.

### Service Topology

```text
+-------------------------------------------------------------+
|               Google Stitch Design References               |
|  (home, splash_onboarding, ask_ai, recommendation_result)    |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                    React + Vite Frontend                    |
|             (Port: 5173, Tailwind CSS v3 Theme)              |
+-------------------------------------------------------------+
                               |
                        HTTP / REST APIs
                               v
+-------------------------------------------------------------+
|                  Node.js + Express Backend                  |
|                 (Port: 5000, Modular Routes)                |
+-------------------------------------------------------------+
               |                               |
        SQL / Connection Pool            HTTP / REST
               v                               v
+-------------------------------+ +---------------------------+
|      PostgreSQL Database      | |   FastAPI Python Service  |
|       (Port: 5432)            | |   (Port: 8000, ML Engine) |
+-------------------------------+ +---------------------------+
```

---

## 2. Service Responsibilities & Boundaries

### A. Frontend (`frontend/`)
- **Technology**: React 19, Vite 8, Tailwind CSS v3 (custom theme mapped from Google Stitch), React Router v7.
- **Role**: Presents mobile-first UI tailored for Indian farmers, supporting Marathi, Hindi, and English.
- **Communication**: Interacts exclusively with the Node.js Express backend via `src/services/api.js`. Never accesses the database or ML service directly.

### B. Backend (`backend/`)
- **Technology**: Node.js, Express.js (ES modules), `pg` PostgreSQL driver, CORS, dotenv.
- **Role**: Core orchestration engine, business logic, Mandi Data Pipeline, automated scheduled sync, API gateway to ML service, and database persistence.
- **Port**: `5000` (configurable via `PORT`, fallback `5001`).
- **Endpoints**:
  - `GET /` — Backend API metadata and endpoint sitemap.
  - `GET /api/health` — Backend process status, uptime, and timestamp.
  - `GET /api/health/database` — Executes `SELECT 1` query to verify active PostgreSQL connection.
  - `GET /api/health/ml` — Proxies health probe to Python FastAPI `/health` endpoint.
  - `GET /api/mandi/mandis` — Lists active mandis with optional location/search filters.
  - `GET /api/mandi/mandis/:id` — Mandi profile with active prices.
  - `GET /api/mandi/prices/latest` — Latest mandi prices and daily trend percentages.
  - `GET /api/mandi/prices/history` — Ascending historical price time-series for forecasting.
  - `GET /api/mandi/commodities` — Supported commodities directory.
  - `POST /api/mandi/sync` — Triggers pipeline ingestion run with options (provider, dates, bounds).
  - `GET /api/mandi/sync/status` — Pipeline observability and sync audit metrics.
  - `GET /api/mandi/quality/report` — Dataset completeness, source coverage, integrity audit, and storage safety metrics.

### C. ML Service (`ml-service/`)
- **Technology**: Python 3.10+, FastAPI, Uvicorn, Pydantic.
- **Role**: AI and machine learning service responsible in later phases for:
  - Price forecasting models (1–7 days)
  - Risk scoring and volatility analysis
  - Mandi harvest split allocation optimization
- **Port**: `8000` (configurable via `PORT`).
- **Endpoints**:
  - `GET /` — ML service metadata and documentation link.
  - `GET /health` — Service readiness and health probe.

### D. Database (`database/`)
- **Technology**: PostgreSQL 16+.
- **Database Name**: `fasalytics`.
- **Role**: Persistent transactional storage for farmers, mandis, commodity arrivals, forecasts, and audits.
- **Phase 1 Tables**: `system_metadata`, `health_check_audit`.
- **Phase 3 Tables**: `mandis`, `commodities`, `mandi_prices`, `pipeline_sync_logs`.

---

## 3. Google Stitch UI to React Mapping

All converted React pages faithfully mirror the Google Stitch design tokens (Barlow Condensed, Inter, Noto Sans Devanagari, Material Symbols Outlined, and custom agricultural green palette `#00260d`, `#086d39`, `#9df6b4`, etc.).

| Original Stitch HTML Directory | Converted React Component | React Router Path | Description & Features |
|---|---|---|---|
| `stitch_ai_mandi_copilot/home` | `frontend/src/pages/HomePage.jsx` | `/` | Farmer greeting, net return hero card, market alert banner, 3 risk/confidence metrics, live mandi price list, mic FAB |
| `stitch_ai_mandi_copilot/splash_onboarding` | `frontend/src/pages/SplashOnboardingPage.jsx` | `/onboarding` | Welcoming animation, interactive language selection (EN, HI, MR), Get Started action |
| `stitch_ai_mandi_copilot/ask_ai` | `frontend/src/pages/AskAiPage.jsx` | `/ask-ai` | Conversational advisor chat, Devanagari prompt support, embedded recommendation card, voice mic input, quick prompt chips |
| `stitch_ai_mandi_copilot/recommendation_result` | `frontend/src/pages/RecommendationResultPage.jsx` | `/recommendation` | Optimized net return banner, split allocation bar, collapsible "Why this plan?" analysis, What-if scenario simulation modal |
| *App Navigation Shell* | `frontend/src/components/Header.jsx` | Shared Header | App branding, multilingual indicator, profile avatar, live backend connection badge |
| *App Navigation Shell* | `frontend/src/components/BottomNav.jsx` | Shared Bottom Nav | Tab bar with active route highlighting (Home, Ask AI, Mandis, Alerts, Profile) |
| *Extended Feature* | `frontend/src/pages/MandisPage.jsx` | `/mandis` | Live mandi comparator, modal prices, distance, arrival volume, sample data indicator badge |
| *Extended Feature* | `frontend/src/pages/AlertsPage.jsx` | `/alerts` | Proactive risk alerts, transit weather cautions, surge notifications |
| *Extended Feature* | `frontend/src/pages/ProfilePage.jsx` | `/profile` | Farmer profile, registered crops, preferences |

---

## 4. Security & Configuration Best Practices

1. **Strict Decoupling**: Frontend never possesses direct database credentials.
2. **Environment Isolation**: All service URLs and DB secrets reside in `.env` files, templated via `.env.example`.
3. **CORS Whitelisting**: Express and FastAPI only accept cross-origin requests from explicitly configured client origins.
4. **Resilient Health Probes**: Backend health checks employ request timeouts (3s) to prevent cascading failures when external services are unavailable.

---

## 5. Phase 3 — Mandi Data Pipeline Architecture

### Pipeline data flow

```text
 Sources (one provider per run)
   DATA_GOV_IN  data.gov.in "Current Daily Price ... (Mandi)" (DMI / AGMARKNET dataset)   current prices
   CEDA         CEDA, Ashoka University Agmarknet API (Bearer token)                       2021-10-01..2026-09-30
   MOCK         synthetic sample data — isolated tests only, refused unless allowed
        |  raw records (+ raw payload, fetched_at)
        v
 1. Normalise   exact identities (state, district, market) and commodity names, real calendar dates,
                known units only (INR/quintal, tonne), missing values stay NULL, quality flags
 2. Validate    reject with reason codes: missing location/commodity/date/modal price, impossible or
                future dates, min > max, modal outside range, unknown unit, sample/genuine mislabelling
 3. De-duplicate within source: identical -> collapse; different values -> keep latest, record conflict
                across sources: never dropped here (provenance); overlaps classified
 4. Persist     one transaction, SAVEPOINT per row, idempotent upsert on
                (source, mandi, commodity, date, variety, grade); revisions + conflicts recorded;
                counts returned after COMMIT and checked against committed rows
 5. Log         pipeline_sync_logs (status, counts, rejection summary) + mandi_source_sync_state
```

Only one run executes at a time (PostgreSQL advisory lock). Price queries read `mandi_prices_resolved`,
which keeps only the highest-precedence source for each market-day (DATA_GOV_IN > CEDA > MOCK), so
sources are never summed together.

### Tables (migrations 004 + 005)
- `mandis`, `commodities` — canonical identities (codes built from full names; no substring merging)
- `mandi_prices` — one row per source observation with `price_date` (reporting day), `fetched_at`,
  source identifiers and original names, `price_unit`, `arrival_unit`, `quality_flags`, `raw_payload`;
  `ON DELETE RESTRICT` towards mandis/commodities
- `mandi_sources` — source registry (label, publisher, access method, precedence, terms)
- `mandi_price_revisions`, `mandi_price_conflicts` — audit trail and review queue
- `pipeline_sync_logs`, `mandi_source_sync_state` — run history and per-source freshness

### Operation
- Scheduler: off unless `MANDI_SYNC_INTERVAL_MINUTES` is 15–10080 and the provider is `DATA_GOV_IN`.
- `POST /api/mandi/sync`: rate limit → Firebase auth (401) → authorisation (403 until an admin role is approved).
- Operators: `npm run mandi:sync` and `npm run ceda:export` (gzip CSV, checkpoint manifest, resume,
  disk-space guard and download budget); database writes require `--confirm-db=<DB_NAME>`.
