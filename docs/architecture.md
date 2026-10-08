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

### Pipeline Data Flow

```text
+---------------------------------------------------------------+
|                      Mandi Data Sources                       |
|  - Data.gov.in / AGMARKNET API (AgmarknetGovProvider)         |
|  - CEDA Ashoka University Historical 5-Yr (CedaProvider)      |
|  - Verified Sample Reference Feed (MockMandiProvider)         |
+---------------------------------------------------------------+
                               |
                               v (raw records)
+---------------------------------------------------------------+
|                      Step 2: Validation                       |
|  - Required identity checks (mandi, commodity, date)          |
|  - Numeric price bounds: min > 0, max >= min, min <= modal <= max
|  - Date bounds: valid date, not future (> today + 1d)         |
|  - Arrival bounds: arrivals >= 0                              |
|  - Rejection logging with exact error attribution             |
+---------------------------------------------------------------+
                               |
                               v (valid records)
+---------------------------------------------------------------+
|                 Step 3: Cleaning & Normalization              |
|  - Commodity dictionary (Kanda, Pyaaz, Onion -> ONION)        |
|  - Mandi dictionary (Gultekdi, Pune -> Pune APMC (Gultekdi))  |
|  - Unit normalization (kg -> quintal x100, ton -> quintal /10)|
|  - Date normalization (DD/MM/YYYY, ISO -> YYYY-MM-DD)         |
+---------------------------------------------------------------+
                               |
                               v
+---------------------------------------------------------------+
|                    Step 4: Deduplication                      |
|  - Within-source: (mandi, commodity, date, variety, source)   |
|  - Cross-source: (mandi, commodity, date, variety) with       |
|    source priority (DATA_GOV_IN > CEDA > MOCK)                |
|  - Retains higher volume arrivals on tie                      |
+---------------------------------------------------------------+
                               |
                               v
+---------------------------------------------------------------+
|                  Step 5: PostgreSQL Persistence               |
|  - Auto-resolves / inserts mandis & commodities foreign keys  |
|  - Idempotent upsert via ON CONFLICT DO UPDATE                |
|  - Audit execution log in pipeline_sync_logs                  |
+---------------------------------------------------------------+
                               |
             +-----------------+-----------------+
             v                                   v
+---------------------------+       +---------------------------+
|    Express Backend API    |       |   Phase 4 ML Service      |
|  GET /api/mandi/prices/*  |       |   Consumes historical     |
|  GET /api/mandi/mandis    |       |   time-series from        |
|  GET /api/mandi/quality/* |       |   /api/mandi/prices/history|
|  Connected to React UI    |       |                           |
+---------------------------+       +---------------------------+
```

### Relational Schema Design

1. **`mandis`**:
   - `id SERIAL PRIMARY KEY`
   - `code VARCHAR(64) UNIQUE NOT NULL`
   - `name VARCHAR(128) NOT NULL`
   - `hindi_name`, `marathi_name`
   - `state VARCHAR(64) NOT NULL`, `district VARCHAR(64) NOT NULL`
   - `market_center VARCHAR(128)`
   - `latitude NUMERIC(9, 6)`, `longitude NUMERIC(9, 6)`
   - `is_active BOOLEAN DEFAULT TRUE`
   - `created_at`, `updated_at`

2. **`commodities`**:
   - `id SERIAL PRIMARY KEY`
   - `code VARCHAR(64) UNIQUE NOT NULL`
   - `name VARCHAR(128) NOT NULL`
   - `hindi_name`, `marathi_name`
   - `category VARCHAR(64) DEFAULT 'Vegetables'`
   - `standard_unit VARCHAR(32) DEFAULT 'quintal'`
   - `is_active BOOLEAN DEFAULT TRUE`
   - `created_at`, `updated_at`

3. **`mandi_prices`**:
   - `id SERIAL PRIMARY KEY`
   - `mandi_id INTEGER REFERENCES mandis(id) ON DELETE CASCADE`
   - `commodity_id INTEGER REFERENCES commodities(id) ON DELETE CASCADE`
   - `price_date DATE NOT NULL`
   - `min_price NUMERIC(10, 2) NOT NULL CHECK (min_price >= 0)`
   - `max_price NUMERIC(10, 2) NOT NULL CHECK (max_price >= min_price)`
   - `modal_price NUMERIC(10, 2) NOT NULL CHECK (modal_price >= min_price AND modal_price <= max_price)`
   - `arrivals_quantity NUMERIC(12, 2) DEFAULT 0 CHECK (arrivals_quantity >= 0)`
   - `unit VARCHAR(32) DEFAULT 'quintal'`
   - `variety VARCHAR(64) DEFAULT 'Standard'`
   - `grade VARCHAR(32) DEFAULT 'FAQ'`
   - `source VARCHAR(64) NOT NULL`
   - `is_sample_data BOOLEAN DEFAULT FALSE`
   - `raw_payload JSONB`
   - `created_at`, `updated_at`
   - `UNIQUE (mandi_id, commodity_id, price_date, variety, source)`
   - Composite index: `(commodity_id, mandi_id, price_date DESC)`

4. **`pipeline_sync_logs`**:
   - `id SERIAL PRIMARY KEY`
   - `source VARCHAR(64) NOT NULL`
   - `status VARCHAR(32) NOT NULL`
   - `records_fetched INTEGER`, `records_valid INTEGER`, `records_inserted INTEGER`, `records_updated INTEGER`, `records_rejected INTEGER`
   - `error_details TEXT`
   - `execution_time_ms INTEGER`
   - `synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`

### Provider Architecture

- **`BaseMandiProvider`**: Abstract base class requiring `getName()` and `fetchRecords(options)`.
- **`MockMandiProvider`**: Deterministic, verified multi-day reference dataset (14+ days) across 6 core Maharashtra mandis (Pune, Nashik, Ahmednagar, Baramati, Mumbai Vashi, Lasalgaon) and 6 commodities (Onion, Tomato, Potato, Soybean, Wheat, Cotton). Explicitly sets `is_sample_data: true`.
- **`AgmarknetGovProvider`**: Multi-page live adapter for Data.gov.in / AGMARKNET resource API (`https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070`). Includes 500-record batching, rate limiting (300ms pause), 15s abort controller timeouts, date-range filtering, and graceful fallback when unconfigured.
- **`CedaProvider`**: Historical adapter for Centre for Economic Data and Analysis (Ashoka University) covering 2,700+ mandis for the 2021-10-01 to 2026-09-30 5-year historical period. Enforces batch safety caps (max 10,000 rows) and graceful fallback when credentials are absent.

### Automated Background Scheduler
`server.js` initializes a recurring sync interval (`MANDI_SYNC_INTERVAL_MINUTES`, default: 60) with an initial 30s grace delay, logging sync results to `pipeline_sync_logs` and safely stopping on `SIGTERM` / `SIGINT`.
