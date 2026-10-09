# FASALYTICS Phase 4 — Deployment & Operational Guide

## 1. Prerequisites

- **Node.js**: v20+
- **Python**: 3.10+ (tested on Python 3.14 on Windows)
- **PostgreSQL**: 16+ (tested on PostgreSQL 18 at `localhost:5432/fasalytics`)
- **Git**: Working tree clean, branch synchronized

---

## 2. Environment Setup

### 2.1 Python ML Environment
```powershell
cd ml-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Verify Python dependencies:
```powershell
.\venv\Scripts\python.exe -c "import numpy, pandas, sklearn, joblib, psycopg2, fastapi; print('READY')"
```

### 2.2 Database Migration (Additive 007)
When approved by the database owner, apply migration 007:
```powershell
cd backend
npm run migrate
```
This applies [007_phase4_forecasting.sql](file:///d:/Projects/AI-Market-and-Risk-Intelligence-for-Agri-Supply-Chains-/database/migrations/007_phase4_forecasting.sql), creating `forecast_runs` and `forecasts` tables without modifying existing tables.

---

## 3. Operational Workflows

### 3.1 Model Training
Train and backtest models on market data:
```powershell
# Using genuine data (when imported)
npm run forecast:train

# For development / rehearsal using the deterministic 180-day fixture:
npm run forecast:train -- --fixture

# Train specific series:
npm run forecast:train -- --commodity=ONION --mandi=MH_NSK_MAIN --fixture
```

### 3.2 Forecast Generation & Publishing
Generate 1–7 day projections and save them to PostgreSQL:
```powershell
# Dry run check (no database writes):
npm run forecast:generate -- --dry-run

# Persist to database:
npm run forecast:generate -- --all
```

### 3.3 List Active Models
Inspect all serialized model artifacts:
```powershell
npm run forecast:list
```

---

## 4. Verification Checklist

1. **Python Unit Tests**:
   ```powershell
   ml-service\venv\Scripts\pytest.exe ml-service/tests
   ```
   Expected: 101 passed, 13 skipped (db tests require test db).

2. **Backend Unit Tests**:
   ```powershell
   npm --prefix backend run test:unit
   ```
   Expected: 150 passed.

3. **Frontend Tests & Build**:
   ```powershell
   npm --prefix frontend test -- --run
   npm --prefix frontend run lint
   npm --prefix frontend run build
   ```
   Expected: 37 passed, 0 lint errors, build succeeds.
