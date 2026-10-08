# Phase 4 — Price Forecasting

Phase 4 turns the Phase 3 mandi market-data infrastructure into a working price
forecasting subsystem: it reads historical prices from the existing PostgreSQL
schema, engineers backward-looking features, compares a learned model against naive
baselines on chronological validation, and publishes 1–7 day forecasts with
prediction intervals and a confidence score through the Flask-free Express API and
the existing React UI.

```
Phase 3 history (mandi_prices)
      -> forecasting data access      (ml-service/forecasting/data.py)
      -> feature engineering          (features.py)
      -> naive + moving-average       (baselines.py)
      -> forecasting model            (models.py)
      -> 1..7 day forecast            (pipeline.py)
      -> prediction interval          (intervals.py)
      -> confidence                   (intervals.py)
      -> PostgreSQL persistence       (migration 006)
      -> backend API                  (backend/src/routes/forecast.routes.js)
      -> existing FASALYTICS UI       (frontend/src/components/ForecastPanel.jsx)
```

## Documents

| Document | Contents |
|----------|----------|
| [architecture.md](architecture.md) | Components, data flow, database schema, API contract, decisions |
| [model.md](model.md) | Features, model choice, baselines, training and forecasting procedure |
| [evaluation.md](evaluation.md) | Chronological validation, metrics, measured results, limitations |

## Data source: which numbers are real?

**This build has no genuine mandi history available.** The Phase 3 tables are empty
and neither a `DATA_GOV_IN_API_KEY` nor a `CEDA_API_KEY` is configured, so no live
ingestion has ever run (see the Phase 3 recovery report). Phase 4 therefore ships a
**DEVELOPMENT FIXTURE**:

* synthetic, deterministic (seeded, `sha256`-derived noise — reproducible across processes);
* written with `source='MOCK_PROVIDER'`, `is_sample_data=TRUE` and the `PHASE4_DEV_FIXTURE` quality flag;
* refused outright when `NODE_ENV=production`;
* **any forecast generated from it is persisted with `data_source='FIXTURE'` and `is_sample_data=TRUE`**, and the UI labels it "Fixture data".

Every metric in [evaluation.md](evaluation.md) is measured on **DEVELOPMENT FIXTURE
DATA** and describes how well the model fits a synthetic series. These are *not*
real-world accuracy claims and must not be quoted as such. When genuine data is
available the identical pipeline runs against it, and the recorded `data_source`
changes to `DATABASE` — that is the only difference.

## Commands

Both commands are wrappers that locate the ML service virtualenv and forward to the
Python CLI (`python -m forecasting`). Run them from `backend/`.

```bash
# 1. Train + evaluate. Without --fixture this uses whatever real data exists.
npm run forecast:train -- --fixture

# 2. Generate and persist the 1-7 day forecasts.
npm run forecast:generate -- --model-version phase4-fixture-v1

# Inspect artefacts
npm run forecast:list

# Train and generate in one step
npm run forecast:train -- --fixture --generate
```

Useful flags (full list in `python -m forecasting train --help`):

| Flag | Effect |
|------|--------|
| `--fixture` | seed + use the deterministic development fixture (refused in production) |
| `--commodity=ONION --mandi=MH_PUNE_APMC` | restrict to matching series |
| `--model-version=<v>` | model version stamped on the artefact and forecast rows |
| `--candidates=ridge_autoregressive,gradient_boosting` | candidate models compared on validation MAE |
| `--allow-arrivals` | use arrival-quantity features when the series genuinely carries them |
| `--no-sample` | exclude sample rows from the history |
| `--dry-run` (generate) | compute forecasts without writing to PostgreSQL |
| `--json` | machine-readable report |

## Setup

The forecasting dependencies live in `ml-service/requirements.txt`:

```powershell
cd ml-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..\backend
npm run migrate          # applies 006_phase4_forecasting.sql
```

The Python side reads the **backend's** `.env` (`backend/.env`) for its database
connection, so it always targets the same database as the Express API. Override any
value with `--db-host/--db-port/--db-user/--db-password/--db-name`. Set `ML_PYTHON`
if the virtualenv lives somewhere unusual.

## Running the tests

```bash
# Python unit + leakage + pipeline tests (no database needed)
ml-service/venv/Scripts/python -m unittest discover -s ml-service/tests -t ml-service -v

# Backend unit tests (database-free) and the full disposable-database suite
cd backend
npm run test:unit
npm run test:db
```

## Serving forecasts

The backend only *reads* persisted forecasts — it never trains a model on request.

```
GET /api/forecast/:commodity/:mandi
      ?horizon=1..7
      &modelVersion=<version>
      &includeSample=false
      &order=ASC|DESC
```

`commodity` and `mandi` accept a code, an exact name (case-insensitive) or a
numeric id. See [architecture.md](architecture.md#api-contract) for the full
response shape and status codes.

## Guarantees

* **No invented data.** Missing prices are never coerced to zero; missing arrivals
  are never filled in; arrival features are used only when the series genuinely
  carries them.
* **No fake live prices.** A pair with no persisted forecast returns
  `available: false` plus an explicit reason — never a substituted number.
* **No future leakage.** Features are backward-looking by construction and this is
  enforced by regression tests (`ml-service/tests/test_leakage.py`).
* **Honest uncertainty.** Intervals come from out-of-sample walk-forward residuals,
  not from an arbitrary ±10%; `confidence` is a documented relative score, not a
  probability.
* **Traceability.** Every forecast carries its model version, training-data end date
  and generation timestamp.
* **Non-destructive.** Migration 006 only adds tables; Phase 1–3 tables and existing
  price history are untouched.
