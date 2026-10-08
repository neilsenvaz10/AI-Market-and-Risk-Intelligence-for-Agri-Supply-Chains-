# FASALYTICS — AI Market and Risk Intelligence for Agri Supply Chains

> **Phase 1: Project Setup & Architecture**  
> AI-powered agricultural decision-support platform helping Indian farmers optimize market timing, reduce risk, and maximize net returns.

---

## 1. Project Overview

**FASALYTICS** is designed to address price volatility, asymmetric market intelligence, and logistical challenges faced by Indian farmers. The complete application empowers farmers to:
- Identify the best mandi to sell produce.
- Forecast agricultural prices for 1–7 days.
- Decide whether to sell immediately or hold stock.
- Compare multiple nearby mandis with transport & spoilage deductions.
- Simulate what-if market scenarios.
- Receive vernacular advice in Marathi, Hindi, and English.

---

## 2. Technology Stack

### Frontend
- **React.js (v19)** with **Vite**
- **Tailwind CSS (v3)** configured with exact Google Stitch theme tokens
- **React Router** for declarative client-side navigation
- **Material Symbols Outlined** & Google Fonts (Barlow Condensed, Inter, Noto Sans Devanagari)

### Backend
- **Node.js (v24)** & **Express.js (v4)**
- **PostgreSQL (`pg` driver)** with connection pooling and query error resilience
- **CORS** & **dotenv** configuration
- Centralized error and graceful shutdown handlers

### ML Service
- **Python (3.10+)** & **FastAPI**
- **Uvicorn** ASGI server
- Pydantic data modeling

### Database & Infrastructure
- **PostgreSQL 16**
- **Docker Compose** for optional containerized database management

---

## 3. Architecture

```text
Google Stitch HTML Designs
          │
          ▼
React + Vite Frontend (Port 5173)
          │
          ▼ (HTTP REST)
Node.js + Express Backend (Port 5000)
          │
          ├───► PostgreSQL Database (Port 5432)
          │
          └───► Python FastAPI ML Service (Port 8000)
```

For complete architectural details, see [docs/architecture.md](docs/architecture.md).

---

## 4. Folder Structure

```text
AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-/
├── .gitignore
├── README.md
├── docker-compose.yml
├── docs/
│   └── architecture.md
├── database/
│   ├── schema.sql
│   └── seed.sql
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
│       │   └── ProfilePage.jsx
│       └── services/
│           └── api.js
├── backend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── config/
│       │   └── index.js
│       ├── controllers/
│       │   └── health.controller.js
│       ├── routes/
│       │   └── health.routes.js
│       ├── middleware/
│       │   └── errorHandler.js
│       ├── services/
│       │   └── index.js
│       ├── ai/
│       │   └── index.js
│       ├── utils/
│       │   └── index.js
│       ├── db.js
│       ├── app.js
│       └── server.js
├── ml-service/
│   ├── requirements.txt
│   ├── main.py
│   ├── .env.example
│   ├── models/
│   ├── data/
│   ├── preprocessing/
│   ├── forecasting/
│   ├── risk/
│   └── optimization/
└── stitch_ai_mandi_copilot/  (Original reference designs preserved intact)
```

---

## 5. Prerequisites

- **Node.js**: v18+ (tested on Node.js v24 & npm 11)
- **Python**: v3.10+ (tested on Python 3.12)
- **PostgreSQL**: v14+ (local service or via Docker)
- **PowerShell**: Windows 10/11 default terminal

---

## 6. Windows Installation Instructions

Open PowerShell and navigate to the repository:

```powershell
# Clone or navigate to workspace
cd c:\Users\DELL\Desktop\AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-

# 1. Install Frontend Dependencies
cd frontend
npm install
cd ..

# 2. Install Backend Dependencies
cd backend
npm install
cd ..

# 3. Setup Python Virtual Environment for ML Service
cd ml-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

---

## 7. Environment Configuration

Copy the example environment files:

```powershell
# Frontend
Copy-Item frontend\.env.example frontend\.env

# Backend
Copy-Item backend\.env.example backend\.env

# ML Service
Copy-Item ml-service\.env.example ml-service\.env
```

---

## 8. PostgreSQL Setup

### Option A: Via Docker Compose (Recommended)

```powershell
docker-compose up -d postgres
```
This automatically initializes the `fasalytics` database and runs `database/schema.sql` and `database/seed.sql`.

### Option B: Local PostgreSQL (psql / pgAdmin)

Using `psql`:
```powershell
psql -U postgres
# In psql prompt:
CREATE DATABASE fasalytics;
\c fasalytics
\i database/schema.sql
\i database/seed.sql
\q
```

---

## 9. Running React Frontend

```powershell
cd frontend
npm run dev
```
Accessible at: **http://localhost:5173**

---

## 10. Running Express Backend

```powershell
cd backend
npm start
# Or with auto-reload:
npm run dev
```
Accessible at: **http://localhost:5000**

---

## 11. Running FastAPI ML Service

```powershell
cd ml-service
.\venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Accessible at: **http://localhost:8000** (Interactive Swagger docs: **http://localhost:8000/docs**)

---

## 12. Testing API Connections

In PowerShell:

```powershell
# Test Backend Health
Invoke-RestMethod http://localhost:5000/api/health

# Test Database Connectivity via Backend
Invoke-RestMethod http://localhost:5000/api/health/database

# Test ML Service Connectivity via Backend
Invoke-RestMethod http://localhost:5000/api/health/ml

# Test Direct ML Service Health
Invoke-RestMethod http://localhost:8000/health
```

---

## 13. Troubleshooting

- **PostgreSQL Connection Refused**:
  - Verify PostgreSQL is running on port 5432: `Test-NetConnection -ComputerName localhost -Port 5432`
  - Verify password in `backend/.env` matches your postgres user password.
- **PowerShell Script Execution Policy Error (`Activate.ps1`)**:
  - Run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
- **Port Conflicts (5000 / 8000 / 5173)**:
  - Update `PORT` in corresponding `.env` files.

---

## 14. Phase 1 Completion Checklist

- [x] Inspect existing Google Stitch HTML/CSS reference designs.
- [x] Preserve original visual styling, fonts, and Tailwind color tokens without modifications.
- [x] Convert Stitch HTML to modular React components (Home, Splash/Onboarding, Ask AI, Recommendation Result).
- [x] Configure React Router with functional navigation between all pages.
- [x] Set up Express backend with modular architecture, CORS, and error handling.
- [x] Implement `/api/health`, `/api/health/database` (`SELECT 1`), and `/api/health/ml`.
- [x] Create minimal PostgreSQL schema and seed files (`database/schema.sql`, `database/seed.sql`).
- [x] Create FastAPI ML service with `/health` and modular directories.
- [x] Implement frontend API service (`frontend/src/services/api.js`) and live connection indicator.
- [x] Create Docker Compose configuration for PostgreSQL.
- [x] Create environment templates (`.env.example`) and comprehensive `.gitignore`.
- [x] Write architectural documentation (`docs/architecture.md`) and run instructions.
- [x] Verify frontend production build (`npm run build`).

---

## 15. Phase 2 Overview

Phase 2 will introduce:
- Ingestion and data pipeline for AGMARKNET / data.gov.in mandi arrival and price records.
- Comprehensive PostgreSQL database schema (Farmers, Crops, Mandis, Historical Prices).
- Initial price trend visualization and comparative analytics.
- Real-time mandi distance calculation and transport cost estimations.