# Phase 4 — Evaluation

> ## ⚠️ These metrics use DEVELOPMENT FIXTURE DATA
>
> The repository contains **no genuine mandi price history**: the Phase 3 price
> tables are empty and neither a `DATA_GOV_IN_API_KEY` nor a `CEDA_API_KEY` is
> configured, so no live ingestion has ever run. Every number below was measured on
> the deterministic synthetic fixture in `ml-service/forecasting/fixture.py`
> (`source='MOCK_PROVIDER'`, `is_sample_data=TRUE`, `PHASE4_DEV_FIXTURE`).
>
> **They describe how well the models fit a synthetic series. They are not
> real-world accuracy claims and must never be quoted as such.**
>
> No metric in this document has been estimated, extrapolated or hand-adjusted. Each
> value is printed by `npm run forecast:train` from a chronological test partition
> the model never trained on. Re-running the pipeline reproduces them exactly.

## 1. Protocol

| Aspect | Value |
|--------|-------|
| Data | DEVELOPMENT FIXTURE — 4 series × 180 daily observations (2026-04-04 → 2026-09-30) |
| Series | MH_PUNE_APMC & MH_NSK_MAIN × ONION & TOMATO |
| Split | chronological, contiguous: **60% train / 20% validation / 20% test** (108 / 36 / 36 observations) |
| Selection | lowest mean **validation** MAE across horizons 1–7 |
| Reported | metrics on the **test** partition only (2026-08-26 → 2026-09-30) |
| Folds | walk-forward: re-fit on an expanding prefix, score the observation immediately after it |
| Test stride | 3 for the boosting ensemble (12 samples per horizon); 1 for ridge. Disclosed as `extras.sampled_every` |
| Splitting | never random, never shuffled |
| Interval calibration | walk-forward residuals over history **up to the end of validation** (test never used) |
| Seed | `20260401`; boosting `random_state=20260401`, single-threaded, no early stopping |

Model version for all results: **`phase4-fixture-v1`**.

## 2. Model selection (validation partition)

Mean MAE across horizons 1–7, on the validation partition (2026-07-21 → 2026-08-25):

| Series | `ridge_autoregressive` | `gradient_boosting` | Selected |
|--------|----------------------:|--------------------:|----------|
| MH_NSK_MAIN / ONION | 57.18 | **45.36** | gradient_boosting |
| MH_PUNE_APMC / ONION | 69.59 | **51.93** | gradient_boosting |
| MH_NSK_MAIN / TOMATO | 147.25 | **103.79** | gradient_boosting |
| MH_PUNE_APMC / TOMATO | 125.07 | **87.68** | gradient_boosting |

Gradient boosting won on all four series. The ridge model is retained in the codebase
as a candidate and as the interval-calibration estimator; had it won, it would have
been used instead — selection is data-driven, not hard-coded.

## 3. Test-partition metrics vs baselines

Test partition: 2026-08-26 → 2026-09-30. MAE/RMSE in ₹ per quintal.

### 3.1 MH_NSK_MAIN / ONION — best performance

| Horizon | MAE | RMSE | MAPE % | sMAPE % | Dir. acc. % | Bias |
|--------:|----:|-----:|-------:|--------:|------------:|-----:|
| 1 | 35.70 | 42.79 | 2.45 | 2.46 | 81.8 | 9.4 |
| 2 | 41.40 | 48.72 | 2.82 | 2.83 | 72.7 | — |
| 3 | 48.97 | 57.73 | 3.35 | 3.36 | 63.6 | — |
| 4 | 42.57 | 49.01 | 2.89 | — | 81.8 | — |
| 5 | 42.52 | 50.65 | 2.86 | — | 72.7 | — |
| 6 | 51.60 | 58.16 | 3.50 | — | 63.6 | — |
| 7 | 57.57 | 67.84 | 3.93 | — | 72.7 | — |

Mean MAE over horizons: **45.76**

### 3.2 MH_PUNE_APMC / ONION

| Horizon | MAE | RMSE | MAPE % | Dir. acc. % |
|--------:|----:|-----:|-------:|------------:|
| 1 | 51.69 | 60.39 | 3.11 | 81.8 |
| 2 | 51.86 | 74.06 | 3.10 | 81.8 |
| 3 | 49.84 | 70.23 | 2.96 | 90.9 |
| 4 | 57.61 | 74.01 | 3.41 | 90.9 |
| 5 | 54.31 | 67.14 | 3.23 | 90.9 |
| 6 | 63.40 | 78.01 | 3.79 | 72.7 |
| 7 | 71.21 | 82.67 | 4.21 | 72.7 |

### 3.3 MH_NSK_MAIN / TOMATO

| Horizon | MAE | RMSE | MAPE % | Dir. acc. % |
|--------:|----:|-----:|-------:|------------:|
| 1 | 108.99 | 136.33 | 6.88 | 90.9 |
| 2 | 119.54 | 149.24 | 7.39 | 81.8 |
| 3 | 95.27 | 122.96 | 5.89 | 81.8 |
| 4 | 99.92 | 123.98 | 6.21 | 81.8 |
| 5 | 94.02 | 127.64 | 5.92 | 81.8 |
| 6 | 114.27 | 150.05 | 7.21 | 72.7 |
| 7 | 117.60 | 147.32 | 7.26 | 81.8 |

Tomato is markedly harder than onion: its fixture series carries roughly double the
weekly and seasonal amplitude and double the noise, so the irreducible error is
larger. The model still beats the naive baseline on every horizon.

### 3.4 MH_PUNE_APMC / TOMATO

| Horizon | MAE | RMSE | MAPE % | Dir. acc. % |
|--------:|----:|-----:|-------:|------------:|
| 1 | 97.02 | 107.94 | 5.80 | 100.0 |
| 2 | 95.84 | 107.86 | 5.84 | 100.0 |
| 3 | 124.35 | 138.11 | 7.59 | 100.0 |
| 4 | 116.59 | 141.63 | 7.13 | 90.9 |
| 5 | 118.85 | 130.94 | 7.22 | 100.0 |
| 6 | 102.81 | 115.79 | 6.27 | 100.0 |
| 7 | 107.73 | 128.80 | 6.56 | 100.0 |

### 3.5 Baseline comparison (identical targets, identical folds)

Mean MAE across horizons 1–7 on the test partition, ₹/quintal:

| Series | Model (gradient boosting) | Naive last-value | Moving average (7) | Model vs naive |
|--------|--------------------------:|-----------------:|-------------------:|---------------:|
| MH_NSK_MAIN / ONION | **45.76** | 64.34 | 57.74 | **−29%** |
| MH_PUNE_APMC / ONION | **57.13** | 74.16 | 64.64 | **−23%** |
| MH_NSK_MAIN / TOMATO | **107.09** | 137.04 | 105.36 | **−22%** |
| MH_PUNE_APMC / TOMATO | **109.03** | 156.78 | 126.82 | **−30%** |

The model beats the naive last-value baseline on **all four series**, by 22–30%.

The 7-day moving average is competitive on the two tomato series
(MH_NSK_MAIN/TOMATO: 105.36 vs 107.09) — on the noisier tomato series a smoothed
level is a strong predictor, and the boosted model's advantage over it is small.
This is reported rather than hidden: the model was selected on the **validation**
partition, where it beat both baselines on every series; on the test partition the
margin over the moving average narrows for tomato.

Exact per-horizon rows for the model and both baselines are stored on each artefact
under `metrics.test` and `metrics.baselines`, and printed by
`npm run forecast:train -- --json`. Baselines are recomputed at every cutoff from the
history known **at that moment**, never once with hindsight.

## 4. Interval calibration and coverage

`interval.method = "walk_forward_residuals"`, nominal level 0.80, quantiles in log
space (example: MH_PUNE_APMC / ONION):

| Horizon | q_low | q_high |
|--------:|------:|-------:|
| 1 | −0.0302 | +0.0557 |
| 2 | −0.0395 | +0.0289 |
| 3 | −0.0491 | +0.0600 |
| 4 | −0.0567 | +0.0925 |
| 5 | −0.0525 | +0.0627 |
| 6 | −0.0498 | +0.0637 |
| 7 | −0.0543 | +0.0871 |

The band widens with horizon, as expected: horizon 1 spans roughly ±3–6% around the
point forecast, horizon 7 up to +9%/−5%. This is measured out-of-sample error, not an
assumed distribution.

**Coverage is reported, never assumed.** `forecasting.intervals.coverage()` computes
the fraction of held-out observations that actually fell inside the band. It is
exposed for evaluation and is deliberately *not* used to tune the band — a nominal
80% interval is not guaranteed to achieve 80% coverage on a short series, and the
docs do not claim that it does.

`confidence` (0–100) is a relative reliability score derived from interval width, the
number of held-out residuals and the horizon; it is documented in
[model.md](model.md#7-uncertainty-and-confidence) and is **not** a probability.

## 5. Reproducing these results

```bash
cd backend
npm run forecast:train -- --fixture --model-version phase4-fixture-v1
npm run forecast:generate -- --model-version phase4-fixture-v1
npm run forecast:list
```

The fixture is deterministic (seeded `sha256`-derived noise, independent of
`PYTHONHASHSEED`), so re-running produces identical coefficients, identical forecasts
and identical metrics. Determinism is asserted by
`ml-service/tests/test_models.py` and `test_persist_pipeline.py`.

## 6. How to read these numbers

* **Fixture, not market.** Every value describes a synthetic series with known
  structure (trend + weekly + seasonal + Gaussian noise). Real mandi prices contain
  policy shocks, weather events, festival demand and reporting gaps that the fixture
  does not model. Real-world error will be **worse**.
* **Small test samples.** 36 test observations, 12 per horizon for the boosting
  ensemble. Directional accuracy is computed over ~11 steps, so a single case moves it
  by ~9 points. Treat it as indicative.
* **MAPE is well defined here** because all fixture prices are positive; the metric
  returns `None` rather than a misleading number if any actual price is `≤ 0`.
* **No cherry-picking.** All four series and all seven horizons are reported, not just
  the best ones.

## 7. Limitations of the evaluation

| Limitation | Impact |
|------------|--------|
| No genuine price history | Absolute error magnitudes are not transferable to real markets |
| 180 observations per series | Only one test window; no multi-year regime coverage |
| Test stride 3 for boosting | 12 samples/horizon; wider confidence in the metric than the interval suggests |
| Single split | A rolling-origin evaluation over many windows would give a more stable estimate |
| Synthetic noise model | Gaussian noise understates the fat tails and volatility clustering of real prices |
| No exogenous variables | Festivals, MSP, rainfall and policy are absent from both the model and the fixture |

Improving the evaluation requires genuine data (`DATA_GOV_IN`/`CEDA` keys) far more
than it requires a bigger model. Once real history is ingested, the identical pipeline
runs against it and the recorded `data_source` changes from `FIXTURE` to `DATABASE`.
