# FASALYTICS — AI Market and Risk Intelligence for Agri Supply Chains

FASALYTICS is an AI-powered agricultural market intelligence and decision-support system designed for Indian smallholder farmers and agricultural cooperatives.

---

## 1. Project Overview

- **Mobile-First Farmer Experience**: Responsive design adhering to Google Stitch agricultural design tokens.
- **Farmer Authentication & Profiles (Phase 2)**: Secure multi-factor authentication (email/password, Google, one-time phone OTP verification) and PostgreSQL farmer profiles.
- **Mandi Data Pipeline (Phase 3)**: Complete end-to-end data ingestion, validation, normalization, and deduplication for Indian agricultural markets.
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
- **PostgreSQL 16+** (Local service or Docker container)
- **Docker Compose** for containerized database management

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
│   └── PHASE3_SOURCE_ACCESS.md
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│       ├── 002_phase2_farmers.sql
│       ├── 003_phase2_email_identity.sql
│       └── 003_mandi_data_pipeline.sql
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
│   │   │   ├── auth.js
│   │   │   └── errorHandler.js
│   │   ├── pipeline/
│   │   │   ├── providers/
│   │   │   │   ├── base.provider.js
│   │   │   │   ├── mock.provider.js
│   │   │   │   ├── agmarknet.provider.js
│   │   │   │   └── ceda.provider.js
│   │   │   ├── validator.js
│   │   │   ├── normalizer.js
│   │   │   ├── deduplicator.js
│   │   │   ├── persister.js
│   │   │   └── index.js
│   │   ├── services/
│   │   │   ├── email/
│   │   │   ├── farmer.service.js
│   │   │   ├── mandi.service.js
│   │   │   └── index.js
│   │   ├── db.js
│   │   ├── app.js
│   │   └── server.js
│   ├── test/
│   │   ├── validator.test.js
│   │   ├── normalizer.test.js
│   │   ├── deduplicator.test.js
│   │   ├── ceda.test.js
│   │   ├── pipeline.test.js
│   │   └── api.test.js
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
| **PostgreSQL** | v14+ (tested on PostgreSQL 16) | Database service or via Docker |
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

### Supported Mandi Data Providers in `backend/.env`:
- **`MOCK`** (default): Deterministic, verified sample dataset for development and CI testing.
- **`AGMARKNET`**: Live daily arrivals from Indian Open Government Data portal (`data.gov.in`). Requires `DATA_GOV_IN_API_KEY`.
- **`CEDA`**: Historical arrivals & prices (2021-10-01 to 2026-09-30) from Centre for Economic Data and Analysis (Ashoka University). Requires `CEDA_API_KEY`.

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

### Option A — Docker Compose
```powershell
docker compose --env-file backend/.env up -d postgres
```

### Option B — Local PostgreSQL
```powershell
psql -U postgres -c "CREATE DATABASE fasalytics;"
psql -U postgres -d fasalytics -f database/schema.sql
psql -U postgres -d fasalytics -f database/seed.sql
```

### Apply Migrations
```powershell
cd backend
npm run migrate
cd ..
```
This applies all migrations in `database/migrations/` sequentially (`002_phase2_farmers.sql`, `003_phase2_email_identity.sql`, `003_mandi_data_pipeline.sql`).

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
| data.gov.in connection timeout | Documented network egress limitation; pipeline safely defaults to `MOCK` provider. |

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

Phase 3 provides end-to-end data ingestion, validation, normalization, deduplication, and PostgreSQL persistence for Indian agricultural market prices and arrivals.

### 16.1 Supported Providers
- **`MOCK`**: High-fidelity deterministic reference dataset for 6 Maharashtra mandis and 6 commodities. Marked with `is_sample_data: true`.
- **`AGMARKNET`**: Live adapter for data.gov.in / Agmarknet API (`https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070`). Features multi-page pagination (500 records/page), 300ms throttling, and date filters.
- **`CEDA`**: Historical adapter for Centre for Economic Data and Analysis (Ashoka University) covering the **2021-10-01 to 2026-09-30** baseline period. Enforces batch safety caps (max 10,000 records).

### 16.2 Deduplication Architecture
- **Within-Source Deduplication**: Resolves collisions on `(mandi, commodity, date, variety, source)`, keeping the record with higher arrivals volume.
- **Cross-Source Deduplication** (`crossSource: true`): Resolves multi-source collisions on `(mandi, commodity, date, variety)` using priority ranking:
  `DATA_GOV_IN` (40) = `AGMARKNET` (40) > `CEDA` (30) > `MOCK` (10).

### 16.3 Automated Background Sync Scheduler
`server.js` initiates an automated background sync interval (`MANDI_SYNC_INTERVAL_MINUTES`, default: 60) with an initial 30s delay, logging sync results to `pipeline_sync_logs` and clearing timers on shutdown.

### 16.4 Running the Test Suite
The automated test suite runs **43 unit and integration tests** (100% passing):

```powershell
node --test `
  "backend/test/validator.test.js" `
  "backend/test/normalizer.test.js" `
  "backend/test/deduplicator.test.js" `
  "backend/test/ceda.test.js" `
  "backend/test/pipeline.test.js" `
  "backend/test/api.test.js"
```

To run teammate authentication tests against PostgreSQL:
```powershell
npm --prefix backend test:auth
```

### 16.5 Triggering Ingestion via API (PowerShell)
```powershell
# Bounded sync using MOCK provider
Invoke-RestMethod -Method POST http://localhost:5000/api/mandi/sync `
  -ContentType "application/json" `
  -Body '{"provider": "MOCK", "days": 7, "limit": 50}'

# Fetch Data Quality & Storage Safety Audit Report
Invoke-RestMethod http://localhost:5000/api/mandi/quality/report

# Inspect pipeline sync audit status
Invoke-RestMethod http://localhost:5000/api/mandi/sync/status

# Retrieve latest prices with trends for Onion
Invoke-RestMethod "http://localhost:5000/api/mandi/prices/latest?commodity=ONION"
```

### 16.6 Phase 3 Completion Checklist
- [x] Mandi Data Provider abstraction (`BaseMandiProvider`, `MockMandiProvider`, `AgmarknetGovProvider`, `CedaProvider`).
- [x] Clear metadata labeling: verified sample records marked with `is_sample_data: true`.
- [x] Database migration (`database/migrations/003_mandi_data_pipeline.sql`).
- [x] Relational tables: `mandis`, `commodities`, `mandi_prices`, `pipeline_sync_logs`.
- [x] Validation module (`validator.js`) enforcing price bounds and integrity.
- [x] Normalization module (`normalizer.js`) standardizing crop names, mandi codes, units, and dates.
- [x] Within-source and cross-source deduplication (`deduplicator.js`) with source priority hierarchy.
- [x] Transactional PostgreSQL persistence with idempotent upsert (`persister.js`).
- [x] CEDA historical provider (`ceda.provider.js`) for the 2021-10-01 to 2026-09-30 period with storage safety caps.
- [x] Multi-page pagination and rate throttling in AGMARKNET provider (`agmarknet.provider.js`).
- [x] Source access investigation report (`docs/PHASE3_SOURCE_ACCESS.md`).
- [x] Background sync scheduler in `server.js` (`MANDI_SYNC_INTERVAL_MINUTES`).
- [x] Express REST API endpoints including data quality report (`/api/mandi/quality/report`).
- [x] Connected frontend React UI (`MandisPage.jsx`, `HomePage.jsx`, `api.js`) to live mandi data while preserving Stitch aesthetic.
- [x] Automated Node.js test suite passing 43/43 tests (100%).
- [x] Verified frontend production build (`npm run build`) with zero errors.

---

## 17. Phase 4 Overview (Next Step)

Phase 4 will build on this clean mandi dataset to introduce:
- ML-driven price forecasting models (1–7 day horizon).
- Price volatility and risk scoring models.
- Mandi split allocation optimization engine.
