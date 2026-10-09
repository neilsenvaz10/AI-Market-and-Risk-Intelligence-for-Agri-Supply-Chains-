# Phase 4 — Architecture

## 1. Component map

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ml-service/forecasting  (Python 3.12, offline batch)                     │
│                                                                          │
│  config.py     backend/.env database settings + artefact paths            │
│  data.py       read-only PostgreSQL history  -> PriceSeries               │
│  features.py   backward-looking feature matrices (per horizon)            │
│  baselines.py  naive last-value + 7-day moving average                    │
│  models.py     ridge / gradient boosting, one model per horizon           │
│  validation.py chronological split + walk-forward backtest                │
│  metrics.py    MAE, RMSE, MAPE, sMAPE, directional accuracy               │
│  intervals.py  residual quantiles -> bounds + confidence                  │
│  persist.py    JSON artefacts (+ joblib for ensembles), forecast rows      │
│  pipeline.py   train_series / generate_series orchestration               │
│  cli.py        `python -m forecasting train|generate|list`                 │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ writes artefacts to ml-service/artifacts/forecasting/<version>/
                │ writes forecasts to PostgreSQL
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ PostgreSQL (Phase 3 tables, read-only for Phase 4)                       │
│   mandis · commodities · mandi_prices · mandi_sources · mandi_prices_...  │
│                                                                          │
│ Phase 4 tables (migration 006)                                           │
│   forecast_runs  ── one row per generation run (provenance + metrics)     │
│   forecasts      ── one row per (market, crop, target date, horizon, model)│
└───────────────┬──────────────────────────────────────────────────────────┘
                │ read-only
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ backend (Express)                                                        │
│   services/forecast.service.js     identity resolution + reads            │
│   validators/forecast.validator.js path/query validation                  │
│   controllers/forecast.controller.js response shaping + empty reasons     │
│   routes/forecast.routes.js        GET /api/forecast/:commodity/:mandi    │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ JSON
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ frontend (React)                                                         │
│   services/api.js          getForecast()                                  │
│   components/ForecastPanel.jsx   loading/empty/insufficient/error + table │
│   pages/MandisPage.jsx     "View price forecast" toggle per mandi card    │
│   i18n/strings.js          forecast.* keys in en / hi / mr                 │
└──────────────────────────────────────────────────────────────────────────┘
```

The backend deliberately does **not** call the ML service at request time. Training
and generation are explicit operator commands; the API is a pure read of persisted
results. That keeps request latency flat, makes a forecast reproducible and
auditable, and means an unreachable ML service can never turn into a fabricated
price.

## 2. Data access layer

`ForecastDataAccess` reads the Phase 3 tables but never writes to them (the only
writes it performs are to the Phase 4 forecast tables).

One observation per **(mandi, commodity, day)** is assembled with explicit rules
that are all documented in `data.py`:

| Concern | Rule |
|---------|------|
| Multiple sources on one market-day | only the highest-precedence source contributes (mirrors `mandi_prices_resolved`) |
| Several varieties/grades on one day | the **median** modal price is used; contributing row count is kept |
| `min_price` / `max_price` | reported only when *every* contributing row has one, else `null` |
| `arrivals_quantity` | reported only when every contributing row has one and all share a unit; otherwise `null` |
| Invalid prices (`null`, `<= 0`) | rows are **dropped**, counted in `dropped_rows` — never coerced to `0` |
| Duplicate observations | collapsed per day by the source ranking above |
| Missing dates | kept as real calendar gaps; `PriceSeries.gap_report()` exposes irregularity |
| Insufficient history | surfaced as `InsufficientHistoryError`, never padded |

The series carries `dates`, `prices`, `arrivals`, `sources`, `is_sample_data`,
`arrival_coverage()` and `gap_report()`.

## 3. Feature engineering

Built per horizon, because the **calendar block describes the date being predicted**,
not the anchor date. A 7-day-ahead row therefore carries next week's day-of-week and
seasonal encoding.

| Group | Features |
|-------|----------|
| Price lags | `lag_1`, `lag_2`, `lag_3`, `lag_7`, `lag_14` |
| Rolling | `rolling_mean_7`, `rolling_mean_14`, `rolling_std_7`, `rolling_slope_7`, `deviation_from_mean_14` |
| Momentum | `pct_change_7` |
| Calendar | `day_of_week`, `month`, `day_of_year`, `dow_sin/cos`, `doy_sin/cos`, `month_sin/cos` |
| Arrivals (conditional) | `arrival_lag_1`, `arrival_lag_7`, `arrival_rolling_mean_7`, `arrival_change_1` |

* Every price/rolling feature reads indices strictly **below** the anchor.
* `MIN_HISTORY = 14` (the longest lag). A row that cannot be completed is dropped and
  counted, never imputed with `0`.
* Arrival features require `allow_arrivals=True` **and** >= 80% genuine arrival
  coverage (`ARRIVAL_MIN_COVERAGE`); otherwise they are omitted and the reason is
  recorded on the artefact.

## 4. Training / validation / test protocol

```
observations (chronological, never shuffled)
├── TRAIN       60%   expanding window used to fit each walk-forward fold
├── VALIDATION  20%   model selection only (mean MAE across horizons)
└── TEST        20%   reported metrics only — never trains, never selects
```

* `chronological_split()` produces contiguous index ranges and rejects a split that
  leaves a partition empty. Random splitting is not implemented anywhere.
* Walk-forward backtesting re-fits the model on an expanding prefix and scores the
  observation immediately after it — the same situation a live forecast is in.
* A training row is included only when `anchor + horizon - 1 < cutoff`, which is the
  mechanical guarantee that no validation/test observation is ever learned from.
* The **test** partition is used for the reported metrics and for the naive-baseline
  comparison. The **interval calibration** deliberately stops at the end of the
  validation partition so the intervals are not fitted to the test set.

## 5. Database schema (migration 006)

`006_phase4_forecasting.sql` is additive and idempotent; nothing from Phases 1–3 is
altered or dropped, and price history stays protected by `ON DELETE RESTRICT`.

### `forecast_runs` — one row per generation run

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `model_version` | varchar(64) | e.g. `phase4-fixture-v1` |
| `commodity_id`, `mandi_id` | FK -> `commodities`/`mandis` | `ON DELETE RESTRICT` |
| `training_data_end_date` | date | last date the model was trained on |
| `history_start_date` | date | first observation used |
| `observations_used` | integer | |
| `horizon_max` | smallint | 1..7 |
| `is_sample_data` | boolean | true for fixture-derived runs |
| `data_source` | varchar(32) | `DATABASE` or `FIXTURE` |
| `metrics` | jsonb | validation/test/baselines snapshot |
| `generated_at`, `created_at` | timestamptz | |

Constraint `forecast_runs_sample_flag_consistent` ties `is_sample_data` to
`data_source = 'FIXTURE'`, so synthetic input can never be recorded as genuine.

### `forecasts` — the forecast rows

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | |
| `run_id` | FK -> `forecast_runs` | `ON DELETE CASCADE` (removing a run removes only its own rows) |
| `commodity_id`, `mandi_id` | FK | `ON DELETE RESTRICT` — protects the parents |
| `forecast_date` | date | target date |
| `horizon_days` | smallint | **CHECK 1..7** |
| `predicted_price` | numeric(12,2) | **CHECK > 0** |
| `lower_bound`, `upper_bound` | numeric(12,2) | **CHECK** `lower <= predicted <= upper`, `lower > 0` |
| `interval_level` | numeric(4,3) | e.g. `0.800` |
| `confidence` | numeric(5,2) | **CHECK 0..100** |
| `unit` | varchar(32) | **CHECK** `= 'INR/quintal'` |
| `model_version` | varchar(64) | |
| `training_data_end_date` | date | |
| `last_observed_price`, `last_observed_date` | numeric/date | the observed anchor, so UI can separate observed from predicted |
| `is_sample_data`, `data_source` | boolean/varchar | same consistency rule as the run |
| `generated_at`, `created_at` | timestamptz | |

Uniqueness: `uq_forecasts_market_target_model` on
`(commodity_id, mandi_id, forecast_date, horizon_days, model_version)`. Re-generating
with the same model version **updates** the row; a new model version keeps its own
rows, so historical forecasts stay comparable.

Indexes: `idx_forecasts_lookup (commodity_id, mandi_id, model_version, generated_at DESC, horizon_days)`
for the API read path, `idx_forecasts_run`, `idx_forecasts_date`,
`idx_forecast_runs_lookup`, `idx_forecast_runs_model`.

## 6. Artefacts

```
ml-service/artifacts/forecasting/<model_version>/<MANDI>__<COMMODITY>.json
                                                <MANDI>__<COMMODITY>__h<N>.joblib
```

The JSON manifest is the source of truth and contains: schema version, model name
and version, mandi/commodity identity, feature list + whether arrivals were used,
`training_data_end_date`, `history_start_date`, `observations_used`, `data_source`,
`is_sample_data`, `trained_at`, the split description, validation/test/baseline
metrics, per-horizon training stats, and the full interval calibration. Ridge models
are stored inline (`kind: "inline"`); gradient-boosting ensembles reference their
companion `.joblib` file. Adding a new model family only means a new `to_dict`/loader
pair plus a factory entry.

## 7. Prediction intervals and confidence

Residual quantiles are measured **out of sample** by walk-forward backtesting. For
each horizon the model is re-fitted at each cutoff and the error recorded as
`log(actual) - log(predicted)`. The interval is the empirical quantile band of those
held-out residuals, applied in log space and centred on the residual median so a
persistent bias is corrected:

```
[predicted * exp(q_low), predicted * exp(q_high)]
```

If a horizon has fewer than `MIN_RESIDUALS = 5` held-out residuals it stays
uncalibrated and inherits the widest calibrated band, because uncertainty cannot
shrink with distance. If no horizon is calibrated at all, a documented development
fallback band is used and `basis = "development_fallback"` — the API and artefact
never present it as a calibrated interval.

`confidence` (0–100) is a **relative reliability score**:

```
100 * (1 / (1 + relative_interval_width)) * sample_factor * horizon_factor
```

capped at 90 (40 for the uncalibrated fallback). It ranks forecasts and drives the
UI badge; it is explicitly **not** the probability of the price landing in the band.
That probability statement is carried by `interval_level`.

## 8. API contract

### `GET /api/forecast/:commodity/:mandi`

| Query | Meaning |
|-------|---------|
| `horizon` | `1`..`7`; omit for every persisted horizon |
| `modelVersion` | restrict to one trained version |
| `includeSample` | `true` (default) / `false` to exclude fixture-derived forecasts |
| `order` | `ASC` (default) / `DESC` by horizon |

**200** (forecast present):

```json
{
  "status": "success",
  "available": true,
  "reason": null,
  "commodity": { "id": 1, "code": "ONION", "name": "Onion", "hindi_name": "प्याज", "marathi_name": "कांदा", "category": "Vegetables", "unit": "INR/quintal" },
  "mandi": { "id": 1, "code": "MH_PUNE_APMC", "name": "Pune APMC (Gultekdi)", "state": "Maharashtra", "district": "Pune" },
  "history": { "observations": 180, "start_date": "2026-04-04", "end_date": "2026-09-30", "only_sample": true },
  "requested": { "horizon": null, "model_version": null, "max_horizon": 7 },
  "available_model_versions": ["phase4-fixture-v1"],
  "meta": {
    "model_version": "phase4-fixture-v1",
    "generated_at": "2026-10-01T00:00:00.000Z",
    "training_data_end_date": "2026-09-30",
    "observations_used": 180,
    "data_source": "FIXTURE",
    "is_sample_data": true,
    "interval_level": 0.8,
    "last_observed_price": 1443.6,
    "last_observed_date": "2026-09-30",
    "unit": "INR/quintal",
    "count": 7,
    "disclaimer": "Forecast estimates only. Prices are not guaranteed; ..."
  },
  "data": [
    {
      "id": 1, "run_id": 1, "forecast_date": "2026-10-01", "horizon_days": 1,
      "predicted_price": 1447.2, "lower_bound": 1401.5, "upper_bound": 1494.1,
      "interval_level": 0.8, "confidence": 78.4, "unit": "INR/quintal",
      "model_version": "phase4-fixture-v1", "training_data_end_date": "2026-09-30",
      "last_observed_price": 1443.6, "last_observed_date": "2026-09-30",
      "is_sample_data": true, "data_source": "FIXTURE", "generated_at": "..."
    }
  ]
}
```

**200 with `available: false`** — a valid pair that simply has no forecast. `reason.code` is one of:

| `reason.code` | Meaning |
|---------------|---------|
| `NO_MARKET_DATA` | no price history for this pair |
| `INSUFFICIENT_HISTORY` | fewer than 21 observations (14 lags + 7 horizons) |
| `NO_FORECAST` | history is sufficient but nothing has been trained/persisted yet |
| `NO_FORECAST_FOR_FILTER` | a `horizon`/`modelVersion`/`includeSample` filter matched nothing |

**Errors:** `400 VALIDATION_ERROR` (bad horizon/order/path text, with per-field
`details`), `404 COMMODITY_NOT_FOUND` / `MANDI_NOT_FOUND`, `503 DATABASE_UNAVAILABLE`
or `503 DATABASE_NOT_MIGRATED`. **No path returns a substituted or fabricated
price.**

## 9. Frontend

`MandisPage` keeps its existing layout, styling and navigation. Each mandi card gains
a **"View price forecast"** toggle that lazily mounts `ForecastPanel`, so at most one
forecast request is in flight and the feed stays fast. The panel renders:

1. **Today** — the observed modal price and its reporting date (from `meta.last_observed_price`),
2. **Price forecast** — one row per horizon with the interval `₹low – ₹high` and `Confidence: NN%`,
3. the interval disclaimer and, when `meta.is_sample_data` is set, a prominent "Fixture data" notice,
4. freshness/model metadata (model version, trained-through date, generated-at date).

State handling follows the Phase 4 requirement exactly:

| State | Trigger | Message key |
|-------|---------|-------------|
| Loading | request in flight | `forecast.loading` |
| Empty | `available:false`, `NO_FORECAST`/`NO_FORECAST_FOR_FILTER` | `forecast.noForecast` / `forecast.filtered` |
| Insufficient | `INSUFFICIENT_HISTORY` / `NO_MARKET_DATA` | `forecast.insufficient` / `forecast.noMarketData` |
| Error | request threw | `forecast.error` |

All strings exist in English, Hindi and Marathi and are validated by
`npm run check:i18n`. No user-visible text is hard-coded in JSX.

## 10. Decisions and trade-offs

| Decision | Rationale |
|----------|-----------|
| Train offline, serve from PostgreSQL | Reproducible, auditable, flat request latency, no ML runtime dependency on the API path |
| Per-horizon direct models (not recursive) | No error accumulation across steps; each horizon is optimised for its own lead time; the 7-day horizon does not compound 1-day errors |
| Log-price target | Guarantees a positive price after `exp`, and makes additive error in log space correspond to the multiplicative error that MAPE evaluates |
| Ridge **and** gradient boosting, chosen on validation MAE | Correctness over complexity — if the simple model wins, it is kept, and the comparison is recorded |
| Chronological walk-forward, sub-sampled for intervals | Honest out-of-sample residuals at a practical runtime; the stride is recorded in the artefact |
| Residual-quantile intervals | Defensible and non-parametric; no normality assumption, no arbitrary band |
| New tables rather than altering Phase 3 | Forecasts are a derived artefact; price history stays protected and read-only |
| Deterministic synthetic fixture | The pipeline is fully exercisable and testable without inventing "real" accuracy claims |

### Explicitly out of scope

No Kubernetes, distributed training, GPU infrastructure, vector database, LLM agent,
extra microservice, or neural sequence model. Phase 4 is a production-MVP forecasting
subsystem that runs comfortably on a laptop.
