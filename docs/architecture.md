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
- **Technology**: React 18/19, Vite, Tailwind CSS v3 (custom theme mapped from Google Stitch), React Router v6/7.
- **Role**: Presents mobile-first UI tailored for Indian farmers, supporting Marathi, Hindi, and English.
- **Communication**: Interacts exclusively with the Node.js Express backend via `src/services/api.js`. Never accesses the database or ML service directly.

### B. Backend (`backend/`)
- **Technology**: Node.js, Express.js (ES modules), `pg` PostgreSQL driver, CORS, dotenv.
- **Role**: Core orchestration engine, business logic, authentication (future), API gateway to ML service, and database persistence.
- **Port**: `5000` (configurable via `PORT`).
- **Endpoints**:
  - `GET /` — Backend API metadata.
  - `GET /api/health` — Backend process status, uptime, and timestamp.
  - `GET /api/health/database` — Executes `SELECT 1` query to verify active PostgreSQL connection.
  - `GET /api/health/ml` — Proxies health probe to Python FastAPI `/health` endpoint.

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
- **Phase 1 Scope**: Minimal schema verification tables (`system_metadata`, `health_check_audit`).

---

## 3. Google Stitch UI to React Mapping

All converted React pages faithfully mirror the Google Stitch design tokens (Barlow Condensed, Inter, Noto Sans Devanagari, Material Symbols Outlined, and custom agricultural green palette `#00260d`, `#086d39`, `#9df6b4`, etc.).

| Original Stitch HTML Directory | Converted React Component | React Router Path | Description & Features |
|---|---|---|---|
| `stitch_ai_mandi_copilot/home` | `frontend/src/pages/HomePage.jsx` | `/` | Farmer greeting, net return hero card, market alert banner, 3 risk/confidence metrics, mandi price list, mic FAB |
| `stitch_ai_mandi_copilot/splash_onboarding` | `frontend/src/pages/SplashOnboardingPage.jsx` | `/onboarding` | Welcoming animation, interactive language selection (EN, HI, MR), Get Started action |
| `stitch_ai_mandi_copilot/ask_ai` | `frontend/src/pages/AskAiPage.jsx` | `/ask-ai` | Conversational advisor chat, Devanagari prompt support, embedded recommendation card, voice mic input, quick prompt chips |
| `stitch_ai_mandi_copilot/recommendation_result` | `frontend/src/pages/RecommendationResultPage.jsx` | `/recommendation` | Optimized net return banner, split allocation bar, collapsible "Why this plan?" analysis, What-if scenario simulation modal |
| *App Navigation Shell* | `frontend/src/components/Header.jsx` | Shared Header | App branding, multilingual indicator, profile avatar, live backend connection badge |
| *App Navigation Shell* | `frontend/src/components/BottomNav.jsx` | Shared Bottom Nav | Tab bar with active route highlighting (Home, Ask AI, Mandis, Alerts, Profile) |
| *Extended Feature* | `frontend/src/pages/MandisPage.jsx` | `/mandis` | Live mandi comparator, modal prices, distance, arrival volume |
| *Extended Feature* | `frontend/src/pages/AlertsPage.jsx` | `/alerts` | Proactive risk alerts, transit weather cautions, surge notifications |
| *Extended Feature* | `frontend/src/pages/ProfilePage.jsx` | `/profile` | Farmer profile, registered crops, preferences |

---

## 4. Security & Configuration Best Practices

1. **Strict Decoupling**: Frontend never possesses direct database credentials.
2. **Environment Isolation**: All service URLs and DB secrets reside in `.env` files, templated via `.env.example`.
3. **CORS Whitelisting**: Express and FastAPI only accept cross-origin requests from explicitly configured client origins.
4. **Resilient Health Probes**: Backend health checks employ request timeouts (3s) to prevent cascading failures when external services are unavailable.
