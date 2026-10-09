# Phase 4 — Model

## 1. Problem statement

For a given **(mandi, commodity)** pair, predict the modal price
(`INR/quintal`) for the next **1 to 7 calendar days**, each with a prediction
interval and a confidence score, from observed daily price history only.

The target variable is the **log modal price**:

```
y = ln(modal_price)
```

Two consequences make this the right choice for this data:

1. `exp(prediction)` is always strictly positive — a forecast can never be a
   negative price, which a raw-price linear model cannot guarantee.
2. An additive error in log space is a *multiplicative* error in price, which is
   exactly what percentage error (MAPE) measures. Minimising squared log error
   therefore optimises the quantity the evaluation reports.

## 2. Features

Features are built per horizon. All price and rolling features read observations
strictly **before** the anchor; only the calendar block reflects the target date
(which is known in advance for any future date, so it is not leakage).

| Group | Features | Window |
|-------|----------|--------|
| Lags | `lag_1`, `lag_2`, `lag_3`, `lag_7`, `lag_14` | 1–14 days |
| Rolling location | `rolling_mean_7`, `rolling_mean_14` | 7, 14 days |
| Rolling dispersion | `rolling_std_7` (population std) | 7 days |
| Rolling trend | `rolling_slope_7` (least-squares slope, price/day) | 7 days |
| Deviation | `deviation_from_mean_14` = `lag_1 - rolling_mean_14` | 14 days |
| Momentum | `pct_change_7` = `(p[t-1] - p[t-8]) / p[t-8] * 100` | 7 days |
| Calendar | `day_of_week`, `month`, `day_of_year` | — |
| Calendar (cyclic) | `dow_sin/cos`, `doy_sin/cos`, `month_sin/cos` | — |
| Arrivals *(conditional)* | `arrival_lag_1`, `arrival_lag_7`, `arrival_rolling_mean_7`, `arrival_change_1` | 1, 7 days |

20 features without arrivals, 24 with.

**Minimum history.** `MIN_HISTORY = 14` observations behind the anchor (the longest
lag). A row that cannot be completed is dropped and counted in
`skipped_incomplete` — it is never padded with `0`, because a zero price would be a
fabricated observation.

**Calendar alignment.** Because the calendar block is built from
`last_observed_date + horizon`, horizon 1 and horizon 7 in the same run carry
*different* day-of-week and seasonal encodings. Building one calendar row and reusing
it for every horizon would silently mislabel six of the seven forecasts.

**Arrivals.** Used only when the caller passes `--allow-arrivals` **and** the series
has >= 80% genuine arrival coverage; otherwise they are omitted and the reason is
recorded on the artefact (`features.arrival_decision`). Missing arrivals are never
imputed. For future dates the arrival *lag* features necessarily carry the most
recent genuinely reported value, which is stated explicitly rather than invented.

## 3. Models

Both models are trained **one per horizon** (`h = 1..7`) on the same feature matrix
and the same log-price target. This is a *direct* multi-horizon strategy: there is no
recursive feeding of a prediction back in as input, so error cannot accumulate across
the week, and each horizon is fitted for its own lead time.

### 3.1 `ridge_autoregressive` — `ridge-autoregressive-v1`

Standardize features (zero mean, unit variance; a constant feature's scale is
forced to 1 rather than divided by zero), prepend an unpenalized intercept column,
and solve the ridge normal equations in closed form:

```
(XᵀX + λI) β = Xᵀy ,   λ = 1.0,  I₀₀ = 0
```

Chosen because the feature block is strongly collinear (lags and rolling means of
the same series) and the series are short — the closed-form solution is stable,
needs only two rows to fit, and trains in under a millisecond, which is what makes a
dense walk-forward backtest affordable.

### 3.2 `gradient_boosting` — `gradient-boosting-v1`

`sklearn.ensemble.HistGradientBoostingRegressor` on the standardized features:

| Parameter | Value | Why |
|-----------|-------|-----|
| `max_iter` | 80 | short series; more iterations only overfit the calendar block |
| `learning_rate` | 0.06 | conservative shrinkage |
| `max_depth` | 3 | shallow trees, limited interaction depth |
| `min_samples_leaf` | 5 | a few hundred rows per series cannot support deeper splits |
| `l2_regularization` | 1.0 | additional shrinkage |
| `early_stopping` | `False` | early stopping picks a random validation split, which would make the fit non-deterministic |
| `random_state` | 20260401 | fixed seed |

Histogram boosting is the heaviest model Phase 4 uses. It is **deterministic** under
a fixed seed with a single thread, trains in well under a second per horizon on a
mandi series, and needs no GPU — unlike an LSTM/Transformer, which these series
(≈180 observations) could not support without overfitting.

### 3.3 Selection

Both candidates are evaluated on the **validation** partition by mean MAE across the
seven horizons, and the lower one is selected. Selection is recorded verbatim on the
artefact (`metrics.validation.mean_validation_mae`, `mae_by_horizon`, `selected`).
If a candidate cannot fit a particular horizon (e.g. too few rows for boosting), that
horizon falls back to ridge and the fallback is recorded in `limiting_factors`.

The published point forecast for each horizon always comes from the model that was
selected for that horizon.

## 4. Baselines

Baselines are the floor the model must clear; they are computed on exactly the same
test targets, and each baseline is recomputed **at every cutoff from the history
known at that moment** rather than once with hindsight.

| Baseline | Definition |
|----------|------------|
| `baseline-last-value-v1` | repeat the most recently observed modal price for every horizon (naive/random-walk) |
| `baseline-moving-average-7-v1` | repeat the mean of the last 7 observations |

## 5. Training procedure (`npm run forecast:train`)

1. **Load history** — one observation per market-day via the Phase 3 rules
   ([architecture.md](architecture.md#2-data-access-layer)).
2. **Split chronologically** — 60% train / 20% validation / 20% test, contiguous.
3. **Build features** — one matrix per horizon, with the calendar block aligned to
   that horizon.
4. **Select the model** — walk-forward over the validation partition, each fold
   refit on an expanding training prefix; winner = lowest mean MAE.
5. **Evaluate on test** — walk-forward over the test partition (stride 3 for the
   boosting ensemble, recorded as `extras.sampled_every`), producing MAE, RMSE, MAPE,
   sMAPE, directional accuracy and bias for the model and both baselines.
6. **Calibrate intervals** — dense walk-forward over all history up to the end of the
   validation partition, residual quantiles per horizon (never touching test).
7. **Refit on all available history** — the standard "refit on everything" step once
   the model is chosen.
8. **Save the artefact** — JSON manifest (+ `.joblib` per horizon for boosting) under
   `ml-service/artifacts/forecasting/<model_version>/`.

Determinism: the same input history produces byte-identical coefficients and
identical forecasts, which is asserted by
`ml-service/tests/test_models.py::test_predictions_are_deterministic` and
`test_persist_pipeline.py::test_training_is_deterministic`.

## 6. Forecast generation (`npm run forecast:generate`)

1. Load the artefact for the series and rebuild its estimators.
2. Load the latest history from PostgreSQL.
3. Build the inference feature row **per horizon**.
4. **Refuse** if the stored feature layout no longer matches the rebuilt one (that
   would silently mis-align coefficients) — retraining is required.
5. **Refuse** if the newest observation is more than 30 days past the artefact's
   `training_data_end_date` (`MODEL_STALE`), because the model would be extrapolating
   from stale levels.
6. Predict each horizon, convert out of log space, and apply the interval band and
   confidence score.
7. Persist one `forecast_runs` row plus one `forecasts` row per horizon, idempotent on
   `(commodity, mandi, forecast_date, horizon, model_version)`.

The first forecast date is the calendar day after the last observation, so horizon
`h` always lands on `last_observed_date + h`.

## 7. Uncertainty and confidence

Intervals are **residual-quantile intervals**, calibrated out of sample:

```
residual_h = ln(actual) - ln(predicted)      # for each walk-forward cutoff
q_low, q_high = quantile(residual_h - median, [(1-level)/2, 1-(1-level)/2])
[lower, upper] = predicted * exp([q_low, q_high])
```

* Nominal level: **80%** (`interval_level = 0.800`).
* Minimum 5 held-out residuals per horizon; below that the horizon inherits the
  widest calibrated band.
* Centring on the residual median corrects a persistent bias.
* A fixed `±10%` band is **not** used. If no horizon can be calibrated at all, a
  documented development fallback applies and `basis = "development_fallback"` — it is
  never presented as calibrated.

**What `confidence` means.** It is a 0–100 *relative reliability score*:

```
100 * 1/(1 + relative_interval_width) * sample_factor * horizon_factor
```

`sample_factor` grows with the number of held-out residuals (saturating at 30);
`horizon_factor = 1 - 0.06*(h-1)` decays with lead time. It saturates at **90**
(40 for the uncalibrated fallback). It is intended for ranking forecasts and driving
the UI badge. It is **not** the probability that the price will fall inside the band —
that statement belongs to `interval_level`.

## 8. Model versioning

Every artefact and every persisted forecast carries a `model_version` string, e.g.
`phase4-fixture-v1`, generated as `phase4-{fixture|data}-v1-{YYYYMMDD}` unless
overridden with `--model-version`.

Each forecast row additionally records `training_data_end_date` and `generated_at`,
so any number the API returns can be traced to the exact model and data window that
produced it. The uniqueness rule keeps a new model version separate from the previous
one, so a re-trained model never silently overwrites the history of an older one.

The design is extensible: a new model family needs a `fit`/`predict`/`to_dict` class
in `models.py`, a factory entry in `build_model`, and (for non-JSON state) a companion
file convention in `persist.py`.

## 9. Known limitations

* **Series length.** Around 180 daily observations per series is enough for 20
  features and 7 horizons but not for deep interaction learning; the models are
  deliberately small.
* **Single series per model.** No pooling of information across mandis or
  commodities, so a short series cannot borrow strength from a long one.
* **Daily frequency only.** No intraday or weekly-aggregated forecasting.
* **No exogenous drivers.** Rainfall, MSP, fuel price, policy announcements and
  festival calendars are not inputs; nothing beyond own-price history and calendar
  effects is modelled.
* **Arrivals rarely usable.** Fixture arrival coverage (~72%) is below the 80%
  threshold, so arrival features are correctly disabled in the shipped run; with
  genuine Agmarknet arrivals they activate automatically.
* **Interval calibration uses ridge residuals** while the point forecast may come
  from boosting, so the band is a good but not exact characterisation of the selected
  model's own error.
* **Test metrics are sub-sampled (stride 3) for boosting** to bound training time;
  `samples` and `sampled_every` are reported alongside every metric so this is
  visible.
* **Not a price guarantee.** These are model estimates with quantified uncertainty.
  They must not be presented as guaranteed prices, and the API response says so
  explicitly.
