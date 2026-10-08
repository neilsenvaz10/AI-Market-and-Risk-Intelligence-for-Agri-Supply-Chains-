# FASALYTICS — AI Market and Risk Intelligence for Agri Supply Chains

FASALYTICS is an AI-powered agricultural market intelligence and decision-support system designed for Indian smallholder farmers and agricultural cooperatives.

---

## 1. Project Overview

- **Mobile-First Farmer Experience**: Responsive design adhering to Google Stitch agricultural design tokens.
- **Farmer Authentication & Profiles (Phase 2)**: Secure multi-factor authentication (email/password, Google, one-time phone OTP verification) and PostgreSQL farmer profiles.
- **Mandi Data Pipeline (Phase 3)**: Ingestion, normalisation, validation, de-duplication and PostgreSQL storage for Indian mandi prices from data.gov.in (Agmarknet dataset) and CEDA (Ashoka University). Live source verification is pending API keys — see section 16 and `docs/verification/phase-3-recovery-report.md`.
- **Modular Microservices**: React + Vite frontend, Node.js + Express backend, PostgreSQL database, and FastAPI ML service.
- **Multilingual Support**: Tailored for Marathi (मराठी), Hindi (हिन्दी), and English.

---

## 2. Technology Stack

### Frontend
- **React 19** & **Vite 8**
- **Tailwind CSS v3** (custom Google Stitch color system)
- **React Router v7**
- **Firebase Web SDK** (Auth: Email/Password, Google, Phone OTP)
- **Material Symbols Outlined** & Google Fonts (Barlow Condensed, Inter, Noto Sans Devanagari)

### Backend
- **Node.js (v18+)** & **Express.js** (ES Modules)
- **Firebase Admin SDK** (ID-token verification)
- **PostgreSQL Client (`pg`)** with connection pooling
- **Transactional Email**: Resend / SendGrid provider adapters with idempotent delivery tracking
- **Mandi Data Pipeline**: Extensible provider architecture with data validation, cleaning, unit normalization, within-source & cross-source deduplication, and automated scheduled sync
- **CORS** & **dotenv** configuration
- Centralized error, scheduled cron/interval, and graceful shutdown handlers

### ML Service
- **Python (3.10+)** & **FastAPI**
- **Uvicorn** ASGI server
- Pydantic data modeling

### Database & Infrastructure
- **PostgreSQL 15+** (local installation managed with pgAdmin 4; tested on PostgreSQL 18.2)
- **Docker Compose** (optional alternative; not required for local development)

---

## 3. Architecture

```text
Google Stitch HTML Designs
          │
          ▼
React + Vite Frontend (Port 5173)
          │
          ▼ (HTTP REST)
Node.js + Express Backend (Port 5000 / 5001)
          ├──► PostgreSQL Database (Port 5432)
          └──► Python FastAPI ML Service (Port 8000)
```

For complete architectural details, see [docs/architecture.md](docs/architecture.md), [docs/authentication.md](docs/authentication.md), and [docs/PHASE3_SOURCE_ACCESS.md](docs/PHASE3_SOURCE_ACCESS.md).

---

## 4. Folder Structure

```text
AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-/
├── .gitignore
├── README.md
├── docker-compose.yml
├── docs/
│   ├── architecture.md
│   ├── authentication.md
│   ├── PHASE3_SOURCE_ACCESS.md
│   └── verification/        (audit, recovery report, live-test plan)
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│       ├── 002_phase2_farmers.sql
│       ├── 003_phase2_email_identity.sql
│       ├── 004_mandi_data_pipeline.sql
│       └── 005_mandi_pipeline_integrity.sql
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── .env.example
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── index.css
│       ├── components/
│       │   ├── Header.jsx
│       │   └── BottomNav.jsx
│       ├── layouts/
│       │   └── MainLayout.jsx
│       ├── pages/
│       │   ├── HomePage.jsx
│       │   ├── SplashOnboardingPage.jsx
│       │   ├── AskAiPage.jsx
│       │   ├── RecommendationResultPage.jsx
│       │   ├── MandisPage.jsx
│       │   ├── AlertsPage.jsx
│       │   ├── ProfilePage.jsx
│       │   ├── LoginPage.jsx
│       │   ├── SignUpPage.jsx
│       │   └── RegisterProfilePage.jsx
│       └── services/
│           └── api.js
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   │   ├── config/
│   │   │   ├── index.js
│   │   │   └── firebaseAdmin.js
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   ├── farmer.controller.js
│   │   │   ├── health.controller.js
│   │   │   └── mandi.controller.js
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── farmer.routes.js
│   │   │   ├── health.routes.js
│   │   │   └── mandi.routes.js
│   │   ├── middleware/
│   │   │   ├── auth.js               (Firebase ID-token verification)
│   │   │   ├── ingestionAuth.js      (admin custom-claim check for POST /api/mandi/sync)
│   │   │   ├── rateLimit.js
│   │   │   └── errorHandler.js
│   │   ├── admin/
│   │   │   └── adminClaim.js         (grant/revoke logic, used only by the operator script)
│   │   ├── pipeline/
│   │   │   ├── providers/
│   │   │   │   ├── base.provider.js
│   │   │   │   ├── mock.provider.js          (synthetic data, tests only)
│   │   │   │   ├── data-gov-in.provider.js
│   │   │   │   └── ceda.provider.js
│   │   │   ├── historical/                   (CEDA export: gzip CSV, manifest, disk guard)
│   │   │   ├── validator.js
│   │   │   ├── normalizer.js
│   │   │   ├── deduplicator.js
│   │   │   ├── persister.js
│   │   │   ├── http.js · scheduler.js · trace.js
│   │   │   └── index.js
│   │   ├── services/
│   │   │   ├── email/
│   │   │   ├── farmer.service.js
│   │   │   ├── mandi.service.js
│   │   │   └── index.js
│   │   ├── db.js
│   │   ├── app.js
│   │   └── server.js
│   ├── scripts/                          (migrate, mandi-sync, ceda-export, firebase-admin-claim, live-*, trace-record, test-db)
│   ├── test/                             (database-free unit tests)
│   │   └── db/                           (run only inside a disposable database: npm run test:db)
│   └── tests/
│       ├── farmers.api.test.js
│       ├── firebase-emulator.test.js
│       └── welcome-email.test.js
├── ml-service/
│   ├── requirements.txt
│   ├── main.py
│   └── .env.example
└── stitch_ai_mandi_copilot/  (Original reference designs preserved intact)
```

---

## 5. Prerequisites

| Tool | Version | Needed for |
|------|---------|------------|
| **Node.js** | v18+ (tested on Node 22/24 & npm 10/11) | Frontend and Backend |
| **Python** | v3.10+ (tested on Python 3.12) | FastAPI ML service |
| **PostgreSQL** | v15+ (tested on PostgreSQL 18.2) | Local install + pgAdmin 4 (Docker optional) |
| **PowerShell** | Windows default terminal | Commands and scripts |

---

## 6. Install Dependencies

```powershell
# 1. Frontend
cd frontend
npm install
cd ..

# 2. Backend
cd backend
npm install
cd ..

# 3. ML service
cd ml-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

---

## 7. Environment Configuration

Copy each template and fill in the values:

```powershell
Copy-Item frontend\.env.example frontend\.env
Copy-Item backend\.env.example backend\.env
Copy-Item ml-service\.env.example ml-service\.env
```

### Mandi data settings in `backend/.env`
Defaults are safe: no provider, scheduler off, no sample-data writes.
- **`MANDI_DATA_PROVIDER`**: empty (none, default) · `DATA_GOV_IN` (current daily prices from data.gov.in, needs `DATA_GOV_IN_API_KEY`) · `CEDA` (historical Agmarknet data from CEDA, Ashoka University, needs `CEDA_API_KEY`). `AGMARKNET` is accepted as a deprecated alias of `DATA_GOV_IN`.
- **`MANDI_SYNC_INTERVAL_MINUTES`**: `0` = off (keep it at 0 until live ingestion is approved). Only whole numbers 15–10080 enable it, and only `DATA_GOV_IN` can be scheduled.
- **`MOCK`** generates **synthetic** prices for isolated tests only. It is refused unless `MANDI_ALLOW_SAMPLE_DATA=true` (never in production).

---

## 8. Firebase Setup (One Time — Phase 2 Auth)

In the [Firebase Console](https://console.firebase.google.com):

1. **Create project** (or select existing).
2. **Add Web App** and copy the config to `frontend/.env`:
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
3. In `backend/.env`, set `FIREBASE_PROJECT_ID` to the same Project ID.
4. **Authentication → Sign-in method**:
   - Enable **Email/Password** and **Email link (passwordless sign-in)**.
   - Enable **Google** (set support email).
   - Enable **Phone** (optionally add test numbers e.g. `+91 98765 43210` / `123456`).
5. **Authentication → Settings**:
   - Authorized domains: keep `localhost`.
   - User account linking: **Link accounts that use the same email**.
   - Email enumeration protection: **On**.
   - SMS region policy: Allow **India (+91)**.

---

## 9. Email Provider Setup (Optional — Welcome Email)

1. Create an account with [Resend](https://resend.com) (or SendGrid).
2. In `backend/.env`:
   ```env
   EMAIL_PROVIDER=resend
   EMAIL_API_KEY=re_xxxxxxxxxxxxxxxx
   EMAIL_FROM=FASALYTICS <no-reply@your-verified-domain.in>
   ```
Without a provider, registration still completes: the welcome email is recorded as `not_configured` and retried automatically once configured.

---

## 10. Database Setup & Migrations

### Local PostgreSQL with pgAdmin 4 (recommended)
1. Install PostgreSQL 15+ (it includes pgAdmin 4) and keep the service running on `localhost:5432`.
2. In pgAdmin: *Servers → PostgreSQL → Databases → Create → Database…*, name it `fasalytics` (or run `npm run migrate -- --create-database` from `backend`, which only creates it when missing).
3. Put the connection settings in `backend/.env` (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`). Never hard-code credentials in scripts.
4. Apply the schema through the migration runner (it creates every table the backend needs — `schema.sql`/`seed.sql` are not required):
```powershell
cd backend
npm run migrate:status   # read-only: lists applied and pending migrations
npm run migrate          # applies pending migrations, each in its own transaction
```
Migrations: `002_phase2_farmers.sql`, `003_phase2_email_identity.sql`, `004_mandi_data_pipeline.sql`, `005_mandi_pipeline_integrity.sql`. Numbers must be unique; the runner refuses duplicates and uses a lock so two runs cannot overlap. A database that recorded the old `003_mandi_data_pipeline.sql` is upgraded safely by 004/005.

### Optional — Docker Compose
`docker-compose.yml` is kept as an optional alternative (PostgreSQL 16 container that loads `schema.sql`, `seed.sql` and migration 002 on first start). It is not used for local development; run `npm run migrate` against it afterwards if you use it.

---

## 11. Run the Application

Use three terminals:

```powershell
# 1. Backend (port 5000 or fallback 5001)
cd backend; npm run dev

# 2. ML service (port 8000)
cd ml-service; .\venv\Scripts\Activate.ps1; uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 3. Frontend (port 5173)
cd frontend; npm run dev
```

---

## 12. Verify the Setup

```powershell
Invoke-RestMethod http://localhost:5000/api/health            # Backend
Invoke-RestMethod http://localhost:5000/api/health/database   # Database
Invoke-RestMethod http://localhost:5000/api/health/ml         # ML service via backend
Invoke-RestMethod http://localhost:8000/health                # ML service direct
```

---

## 13. Troubleshooting

| Symptom | Fix |
|---------|-----|
| PostgreSQL connection refused | Check `DB_HOST`/`DB_PORT` in `backend/.env` and ensure service is active. |
| `DATABASE_NOT_MIGRATED` | Run `cd backend; npm run migrate`. |
| Port 5000 unavailable on Windows | Server automatically falls back to 5001; set `VITE_API_URL=http://localhost:5001`. |
| Firebase Auth NOT CONFIGURED | Set `FIREBASE_PROJECT_ID` in `backend/.env`. |
| data.gov.in connection refused / timeout | `api.data.gov.in` is not reachable from some networks. The run is recorded as FAILED; no sample data is substituted. Try another network. |
| Mandi API returns 503 `DATABASE_NOT_MIGRATED` | Apply the pending migrations (`npm run migrate`, after review). |

---

## 14. Phase 1 Completion Checklist

- [x] Inspect existing Google Stitch HTML/CSS reference designs.
- [x] Preserve original visual styling, fonts, and Tailwind color tokens without modifications.
- [x] Convert Stitch HTML to modular React components.
- [x] Configure React Router with functional navigation between all pages.
- [x] Set up Express backend with modular architecture, CORS, and error handling.
- [x] Implement `/api/health`, `/api/health/database`, and `/api/health/ml`.
- [x] Create PostgreSQL schema and seed files.
- [x] Create FastAPI ML service with `/health` and modular directories.
- [x] Verify frontend production build (`npm run build`).

---

## 15. Phase 2 — Farmer Authentication & Profile Management

Phase 2 adds Firebase Authentication, multi-method registration (email/password, Google, one-time phone OTP), PostgreSQL farmer profile management, password recovery, and transactional welcome emails.

### 15.1 What's Included
- **Sign-in Methods**: Email + password, Google sign-in (popup with redirect fallback), mobile OTP login.
- **Registration**: `/signup` → phone verification (`/verify-phone`, `/verify-otp`) → email verification → farmer profile (`/register`).
- **Profile APIs**: `GET /api/auth/session`, `GET/POST/PUT /api/farmers/me`.
- **Welcome Email**: Idempotent delivery tracking with automatic retries via Resend / SendGrid.

### 15.2 Authentication Checklist
- [x] Firebase Phone OTP login, verify, resend cooldown, logout, persistent sessions.
- [x] Firebase Admin ID-token verification middleware.
- [x] `farmers` table migration with constraints and indexes.
- [x] `GET/POST/PUT /api/farmers/me`, `GET /api/auth/session`.
- [x] Registration, profile view/edit, protected/public routes.
- [x] Dashboard shows the authenticated farmer's details.
- [x] Language preference saved to PostgreSQL and restored on login.
- [x] Email/password registration, verification email, one-time phone OTP linking.
- [x] Google sign-in and secure Google linking.
- [x] Phone-OTP password recovery.
- [x] Idempotent welcome email with delivery tracking and retries.

---

## 16. Phase 3 — Mandi Data Pipeline

> **Status:** code repaired and tested against isolated databases; **live source verification is BLOCKED** (no CEDA / data.gov.in API keys, and `api.data.gov.in` refuses connections from the development network). No genuine mandi record has been ingested yet. Details: `docs/verification/phase-3-recovery-report.md`.

### 16.1 Sources
| Code | Source | Access | Notes |
|------|--------|--------|-------|
| `DATA_GOV_IN` | data.gov.in — "Current Daily Price of Various Commodities from Various Markets (Mandi)", DMI, generated through AGMARKNET | OGD API resource `9ef84268-d588-465a-a308-a864a43d0070`, `DATA_GOV_IN_API_KEY` | Current prices; never labelled as fetched directly from agmarknet.gov.in (no documented API there) |
| `CEDA` | CEDA, Ashoka University (Agmarknet data) | `https://api.ceda.ashoka.edu.in/v1` — `GET /agmarknet/commodities`, `GET /agmarknet/geographies`, `POST /agmarknet/markets`, `POST /agmarknet/prices`, `POST /agmarknet/quantities`; Bearer token `CEDA_API_KEY` | Historical window 2021-10-01..2026-09-30; prices ₹/quintal, quantities tonnes; non-commercial use with attribution |
| `MOCK_PROVIDER` | Synthetic sample data | generated locally | Isolated tests only; always `is_sample_data = true` |

### 16.2 Data integrity rules
- Pipeline: fetch → normalise → validate → de-duplicate → persist (per-row savepoints) → conflict detection → run log.
- Exact identities only (no substring matching): "Sweet Potato" ≠ Potato, "Pune(Moshi)" ≠ Pune. Missing state/district/market, invalid dates (e.g. 31/02/2026), unknown units and missing modal prices are **rejected with a reason code**, never guessed. Missing min/max prices and arrivals stay `NULL`.
- Every row keeps its source code, original names/ids, units (`INR/quintal`, `tonne`), quality flags, reporting date (`price_date`) and fetch time (`fetched_at`).
- One row per source observation; other sources keep their own rows. `mandi_prices_resolved` returns one source per market-day (precedence DATA_GOV_IN > CEDA > MOCK), so sources are never double-counted. Disagreements go to `mandi_price_conflicts`; same-source revisions to `mandi_price_revisions`.

### 16.3 Ingestion (operators only)
`POST /api/mandi/sync` is rate-limited (429), requires a Firebase login (401) and an account that holds the Firebase **custom claim `admin: true`** (403) — see "Administrator claim" in `docs/authentication.md`. The claim is confirmed live through the Firebase Admin SDK, so the server needs a service account (`FIREBASE_SERVICE_ACCOUNT_PATH`); without one the endpoint answers 503 and never ingests. **No account holds the claim yet.** Operators can also use the CLI, which needs direct database access and writes only with `--confirm-db=<DB_NAME>`:
```powershell
cd backend
npm run mandi:sync -- --provider=DATA_GOV_IN --days=3 --confirm-db=fasalytics
npm run ceda:export -- --commodity=Onion --state=Maharashtra --district=Nashik --from=2026-09-01 --to=2026-09-30 --max-tasks=1
npm run ceda:export -- --import-manifest=data/mandi/<manifest>.json --confirm-db=fasalytics
```
The claim is granted and revoked only by the operator script `npm run admin:claim` (dry run by default; `--apply --confirm-project=<id>` to change anything).

`ceda:export` writes gzip CSV + raw responses + a checkpoint manifest under `backend/data/mandi` (git-ignored), resumes finished windows, and stops on low disk space (`MANDI_MIN_FREE_DISK_GB`, default 20) or when the download budget (`MANDI_DOWNLOAD_BUDGET_MB`, default 500) is reached.

The scheduler is off unless `MANDI_SYNC_INTERVAL_MINUTES` is 15–10080 **and** `MANDI_DATA_PROVIDER=DATA_GOV_IN`; runs never overlap (advisory lock) and re-read a 3-day lookback for late reports.

### 16.4 API
`GET /api/mandi/mandis`, `/mandis/:id`, `/prices/latest`, `/prices/history`, `/commodities`, `/sync/status`, `/quality/report` — invalid input returns 400, an unmigrated database 503. Price rows include `price_date`, `fetched_at`, `source`, `source_label` and `is_sample_data`; `/prices/latest` adds a `meta` freshness summary. `/prices/history` returns the most recent `limit` rows (oldest-first by default, `order=desc` for newest-first) with `offset` paging.

### 16.5 Tests
```powershell
cd backend
npm run test:unit   # no database needed
npm run test:db     # creates a disposable fasalytics_test_* database, migrates, runs DB + Phase 2 suites, drops it
cd ../frontend
npm run check:i18n  # every translation key exists in en/hi/mr
```
`test:db` never touches the development database (it needs a role with CREATEDB).

## 17. Phase 4 Overview (Next Step)

Phase 4 will build on this clean mandi dataset to introduce:
- ML-driven price forecasting models (1–7 day horizon).
- Price volatility and risk scoring models.
- Mandi split allocation optimization engine.
