"""Phase 4 forecasting pipeline: train, evaluate and generate.

Flow (mirrors the Phase 4 objective diagram)::

    history -> features -> baselines -> model -> walk-forward validation
            -> 1..7 day forecasts -> prediction intervals -> confidence
            -> PostgreSQL persistence (forecasts / forecast_runs)

Two entry points are exposed to the CLI:

* :func:`train_series` — loads history, builds features, trains every candidate for
  each horizon, picks the winner by **validation** MAE, refits it on the full
  available history, measures intervals from walk-forward residuals, reports metrics
  against the naive baseline and writes a model artefact.
* :func:`generate_series` — loads the artefact + the latest history, refuses to run
  on insufficient history or on a stale artefact, produces the 1-7 day forecast rows
  and persists them.

The test partition is used **only** for reporting. It never influences model choice,
never enters the interval calibration, and is never refit on.
"""

from __future__ import annotations

import datetime as _dt
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional, Sequence

import numpy as np

from . import features as feature_engineering
from .config import DatabaseConfig, is_production, load_database_config
from .data import ForecastDataAccess, PriceSeries
from .intervals import IntervalModel
from .metrics import compare_models, mae, rmse
from .models import (
    GBM_MODEL_NAME,
    RIDGE_MODEL_NAME,
    HorizonModelSet,
    ModelError,
    build_model,
)
from .persist import (
    TrainingArtifact,
    build_forecast_rows,
    build_interval,
    load_artifact,
    load_interval,
    load_models,
    save_artifact,
    staleness_days,
)
from .validation import (
    backtest,
    build_series_features,
    chronological_split,
    select_model,
    summarise_backtest,
    walk_forward_cutoffs,
)

DEFAULT_HORIZONS: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7)
DEFAULT_CANDIDATES: tuple[str, ...] = (RIDGE_MODEL_NAME, GBM_MODEL_NAME)
# Ridge is the simplest defensible model and is used when nothing beats it.
FALLBACK_MODEL_NAME = RIDGE_MODEL_NAME
# An artefact older than this relative to the newest observation is refused.
MAX_STALENESS_DAYS = 30
MIN_OBSERVATIONS_FOR_TRAINING = feature_engineering.MIN_HISTORY + max(DEFAULT_HORIZONS)
# Interval calibration sub-samples walk-forward cutoffs (metrics use stride 1 for
# the ridge model; the gradient-boosting ensemble is sub-sampled to bound runtime).
INTERVAL_CALIBRATION_STRIDE = 5
TEST_EVALUATION_STRIDE = 3

# The database check constraint on forecasts.unit accepts only the fully-qualified
# form, while commodities.standard_unit stores a bare unit name ("quintal").
PRICE_UNIT = "INR/quintal"


def _price_unit(raw) -> str:
    """Normalizes a stored unit into the canonical ``INR/<unit>`` forecast unit.

    Matches the database check constraint, which requires exactly the lowercase
    form (``INR/quintal``), so an upper-cased variant can never be generated.
    """
    if not raw:
        return PRICE_UNIT
    text = str(raw).strip()
    if text.upper().startswith("INR/"):
        return f"INR/{text.split('/', 1)[1].lower()}"
    return f"INR/{text.lower()}"


class InsufficientHistoryError(Exception):
    """Raised when a series cannot support Phase 4 training or generation."""

    def __init__(self, message: str, *, available: int = 0, required: int = 0, code: str = "INSUFFICIENT_HISTORY"):
        super().__init__(message)
        self.available = available
        self.required = required
        self.code = code


@dataclass
class SeriesSelector:
    """Which series to process: explicit pairs, a filter, or the fixture."""

    mandi: Optional[str] = None
    commodity: Optional[str] = None
    use_fixture: bool = False
    include_sample: bool = True

    def matches(self, mandi_code: str, commodity_code: str) -> bool:
        if self.mandi and self.mandi.upper() not in (mandi_code or "").upper():
            return False
        if self.commodity and self.commodity.upper() not in (commodity_code or "").upper():
            return False
        return True


def _resolve_pairs(access: ForecastDataAccess, selector: SeriesSelector) -> list[tuple[int, int]]:
    pairs = [
        (int(row["mandi_id"]), int(row["commodity_id"]))
        for row in access.list_series(min_observations=1, include_sample=selector.include_sample)
    ]
    resolved: list[tuple[int, int]] = []
    for mandi_id, commodity_id in pairs:
        series = access.load_series(mandi_id, commodity_id, include_sample=selector.include_sample)
        if selector.matches(series.mandi_code, series.commodity_code):
            resolved.append((mandi_id, commodity_id))
    return resolved


# ---------------------------------------------------------------------------
# training
# ---------------------------------------------------------------------------
def train_series(
    series: PriceSeries,
    *,
    model_version: str,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
    candidates: Sequence[str] = DEFAULT_CANDIDATES,
    allow_arrivals: bool = False,
    data_source: str = "DATABASE",
    artifact_root: Path | None = None,
) -> tuple[TrainingArtifact, HorizonModelSet, dict]:
    """Trains, validates, evaluates and persists one series. Returns the report."""
    horizons = tuple(sorted({int(h) for h in horizons}))
    max_horizon = max(horizons)
    if max_horizon > 7:
        raise ValueError("Phase 4 forecasts at most 7 days ahead")

    if series.size < MIN_OBSERVATIONS_FOR_TRAINING:
        raise InsufficientHistoryError(
            f"{series.mandi_code}/{series.commodity_code} has {series.size} observations; "
            f"at least {MIN_OBSERVATIONS_FOR_TRAINING} are required for a 7-day forecast",
            available=series.size,
            required=MIN_OBSERVATIONS_FOR_TRAINING,
        )

    split = chronological_split(series.size)
    cache = build_series_features(series, horizons=horizons, allow_arrivals=allow_arrivals)
    includes_arrivals = cache.includes_arrivals
    arrival_reason = feature_engineering.resolve_arrival_features(series, allow_arrivals=allow_arrivals)[1]

    # --- validation: features come from every partition, but the *training* rows
    #     for each cutoff are restricted to the train partition, so validation
    #     observations can never be learned from.
    selection = select_model(
        cache,
        candidate_names=list(candidates),
        start_index=split.val_start,
        end_index=split.val_end,
        horizons=horizons,
        verbose=True,
    )
    selected_name = selection["selected"] or FALLBACK_MODEL_NAME

    # --- test partition: genuinely out-of-sample, reported only. Sub-sampled when
    #     the selected model is the gradient-boosting ensemble, purely to bound
    #     training time; the sample is still strictly later than every training
    #     observation and the stride is disclosed in the report.
    test_metrics: list[dict] = []
    test_residuals: dict[int, list[float]] = {h: [] for h in horizons}
    test_stride = TEST_EVALUATION_STRIDE if selected_name == GBM_MODEL_NAME else 1
    for horizon in horizons:
        cutoffs = walk_forward_cutoffs(
            series, horizon=horizon, start_index=split.test_start, end_index=split.test_end
        )
        if not cutoffs:
            continue
        result = backtest(
            cache, horizon=horizon, cutoffs=cutoffs, model_name=selected_name, stride=test_stride
        )
        for summary in summarise_backtest(result, selected_name):
            summary.extras["sampled_every"] = test_stride
            test_metrics.append(summary.to_dict())
        test_residuals[horizon] = list(result.residuals_log)

    # --- interval calibration from walk-forward residuals over history up to the end
    #     of the validation partition (never the test partition). Calibrated with the
    #     ridge model, whose closed-form fit makes a dense walk-forward affordable;
    #     the measured residuals are then applied to the selected model's forecast.
    interval_residuals: dict[int, list[float]] = {h: [] for h in horizons}
    for horizon in horizons:
        cutoffs = walk_forward_cutoffs(
            series, horizon=horizon, start_index=feature_engineering.MIN_HISTORY + horizon, end_index=split.val_end
        )
        if not cutoffs:
            continue
        result = backtest(
            cache,
            horizon=horizon,
            cutoffs=cutoffs,
            model_name=FALLBACK_MODEL_NAME,
            stride=INTERVAL_CALIBRATION_STRIDE,
        )
        interval_residuals[horizon] = list(result.residuals_log)
    interval = build_interval(interval_residuals)

    # --- final fit on all available history (train + validation + test), which is
    #     the standard "refit on everything" step once the model is chosen.
    #     The feature layout is recorded on the set: forecast generation refuses to
    #     run if the rebuilt layout ever differs, because that would mis-align
    #     coefficients silently.
    models = HorizonModelSet(feature_names=list(cache.feature_names))
    per_horizon: dict[str, dict] = {}
    limiting: list[str] = []
    for horizon in horizons:
        x, y = cache.matrices[horizon].to_arrays()
        if x.shape[0] < 2:
            limiting.append(f"horizon_{horizon}_has_{x.shape[0]}_training_rows")
            continue
        try:
            model = build_model(selected_name).fit(x, np.log(y))
        except ModelError as exc:
            # A candidate that cannot fit this series falls back to the ridge model,
            # which only needs two rows.
            limiting.append(f"horizon_{horizon}_fell_back_to_{FALLBACK_MODEL_NAME}: {exc}")
            model = build_model(FALLBACK_MODEL_NAME).fit(x, np.log(y))
        models.add(horizon, model)
        per_horizon[str(horizon)] = {
            "training_rows": int(x.shape[0]),
            "training_target_min": round(float(np.min(y)), 2),
            "training_target_max": round(float(np.max(y)), 2),
            "model_name": model.name,
            "model_version": model.version,
        }

    if not models.models:
        raise InsufficientHistoryError(
            f"{series.mandi_code}/{series.commodity_code} produced no trainable horizon",
            available=series.size,
            required=MIN_OBSERVATIONS_FOR_TRAINING,
        )

    # --- baselines for honest comparison on the same test partition.
    baseline_metrics = _baseline_metrics(cache, split=split, horizons=horizons)

    gap = series.gap_report()
    if gap["irregular"]:
        limiting.append(f"irregular_reporting_gaps:{gap['gaps']}_max_{gap['max_gap_days']}d")
    if not includes_arrivals:
        limiting.append(f"arrival_features_unavailable:{arrival_reason}")
    if series.size < 120:
        limiting.append(f"short_history:{series.size}_observations")

    trained_at = _dt.datetime.now(_dt.timezone.utc)
    artifact = TrainingArtifact(
        model_version=model_version,
        model_name=models.metadata()["model_name"] or selected_name,
        mandi_id=series.mandi_id,
        commodity_id=series.commodity_id,
        mandi_code=series.mandi_code,
        mandi_name=series.mandi_name,
        commodity_code=series.commodity_code,
        commodity_name=series.commodity_name,
        unit=_price_unit(series.unit),
        unit_label=PRICE_UNIT,
        horizon_max=max_horizon,
        feature_names=list(models.feature_names),
        includes_arrivals=includes_arrivals,
        arrival_feature_reason=arrival_reason,
        training_data_end_date=series.end_date.isoformat() if series.end_date else "",
        history_start_date=series.start_date.isoformat() if series.start_date else "",
        observations_used=series.size,
        data_source=data_source,
        is_sample_data=series.is_sample_data,
        trained_at=trained_at.isoformat(),
        split=split.describe(series),
        metrics={
            "selected_by": "validation_mae",
            "validation": selection,
            "test": test_metrics,
            "baselines": baseline_metrics,
            "interval_coverage_note": (
                "test metrics are computed on the chronologically last partition and never influenced training"
            ),
        },
        per_horizon=per_horizon,
        interval=interval.to_dict(),
        baselines=baseline_metrics,
        limiting_factors=limiting,
    )
    path = save_artifact(artifact, models, root=artifact_root)

    report = {
        "series": f"{series.mandi_code}/{series.commodity_code}",
        "artifact": str(path),
        "model_version": model_version,
        "model_name": artifact.model_name,
        "observations": series.size,
        "split": artifact.split,
        "selection": selection,
        "interval": interval.to_dict(),
        "limiting_factors": limiting,
        "test_metrics": test_metrics,
        "baseline_metrics": baseline_metrics,
        "gap_report": gap,
        "data_source": data_source,
        "is_sample_data": artifact.is_sample_data,
    }
    return artifact, models, report


def _baseline_metrics(cache: feature_engineering.SeriesFeatures, *, split, horizons: Sequence[int]) -> list[dict]:
    """Naive / moving-average metrics on exactly the same test targets as the model.

    Each baseline is recomputed at every cutoff from the history known *at that
    cutoff*, so it is a genuine point-in-time competitor rather than a statistic
    computed with hindsight.
    """
    from .baselines import (
        LAST_VALUE,
        MOVING_AVERAGE_7,
        last_value_forecast,
        moving_average_forecast,
    )
    from .metrics import summarise

    rows: list[dict] = []
    series = cache.series
    prices = [float(o.modal_price) for o in series.observations]
    for horizon in horizons:
        cutoffs = walk_forward_cutoffs(
            series, horizon=horizon, start_index=split.test_start, end_index=split.test_end
        )
        if not cutoffs:
            continue
        actual = [float(series.observations[c + horizon - 1].modal_price) for c in cutoffs]
        naive = [last_value_forecast(prices[:c], 1)[0] for c in cutoffs]
        rows.append(
            summarise(
                f'baseline_{LAST_VALUE.name}', horizon, actual, naive,
                extras={"kind": "baseline", "label": LAST_VALUE.version},
            ).to_dict()
        )
        if all(c >= 7 for c in cutoffs):
            ma = [moving_average_forecast(prices[:c], 1)[0] for c in cutoffs]
            rows.append(
                summarise(
                    f'baseline_{MOVING_AVERAGE_7.name}', horizon, actual, ma,
                    extras={"kind": "baseline", "label": MOVING_AVERAGE_7.version},
                ).to_dict()
            )
    return rows


# ---------------------------------------------------------------------------
# generation
# ---------------------------------------------------------------------------
def generate_series(
    access: ForecastDataAccess,
    *,
    mandi_code: str,
    commodity_code: str,
    model_version: str,
    generated_at: _dt.datetime | None = None,
    artifact_root: Path | None = None,
    persist: bool = True,
    max_staleness_days: int = MAX_STALENESS_DAYS,
) -> dict:
    """Produces and (optionally) persists the 1..N day forecast for one series."""
    payload = load_artifact(mandi_code, commodity_code, model_version, root=artifact_root)
    artifact = TrainingArtifact.from_dict(payload)
    models = load_models(payload, root=artifact_root)
    interval = load_interval(payload)

    series = access.load_series(artifact.mandi_id, artifact.commodity_id, include_sample=True)
    if series.size < feature_engineering.MIN_HISTORY:
        raise InsufficientHistoryError(
            f"{mandi_code}/{commodity_code} has only {series.size} observations; "
            f"at least {feature_engineering.MIN_HISTORY} are required to build a feature row",
            available=series.size,
            required=feature_engineering.MIN_HISTORY,
        )

    horizons = models.horizons()
    built = feature_engineering.build_inference_features(
        series, allow_arrivals=artifact.includes_arrivals, horizons=horizons
    )
    last_date = built[horizons[0]]["last_observed_date"]
    for horizon, block in built.items():
        if block["feature_names"] != artifact.feature_names:
            # A mismatch would silently mis-align coefficients, so refuse instead.
            raise ModelError(
                "feature layout of the stored model does not match the current history "
                f"(horizon {horizon}: {len(artifact.feature_names)} stored vs "
                f"{len(block['feature_names'])} built); retrain the model"
            )

    staleness = staleness_days(artifact, last_date)
    if staleness > max_staleness_days:
        raise InsufficientHistoryError(
            f"model {model_version} was trained up to {artifact.training_data_end_date} but the newest "
            f"observation is {last_date.isoformat()} ({staleness} days newer); retrain before forecasting",
            available=staleness,
            required=max_staleness_days,
            code="MODEL_STALE",
        )

    predictions = {h: models.models[h].predict_price(built[h]["row"]) for h in horizons}
    timestamp = generated_at or _dt.datetime.now(_dt.timezone.utc)
    rows = build_forecast_rows(
        artifact=artifact,
        interval=interval,
        predictions=predictions,
        last_observed_price=float(series.prices[-1]),
        last_observed_date=last_date,
        generated_at=timestamp,
    )

    written = 0
    run_id: int | None = None
    if persist:
        # Consistency is enforced by a database check constraint, so derive the flag
        # from the stored source rather than trusting two independent fields.
        is_sample = artifact.data_source == "FIXTURE"
        with access.cursor() as cur:
            run_id = access.upsert_forecast_run(
                cur,
                {
                    "model_version": model_version,
                    "commodity_id": artifact.commodity_id,
                    "mandi_id": artifact.mandi_id,
                    "training_data_end_date": artifact.training_data_end_date,
                    "history_start_date": artifact.history_start_date or None,
                    "observations_used": series.size,
                    "horizon_max": artifact.horizon_max,
                    "is_sample_data": is_sample,
                    "data_source": artifact.data_source,
                    "metrics": json.dumps(artifact.metrics, default=str),
                    "generated_at": timestamp,
                },
            )
            for row_payload in rows:
                row_payload["run_id"] = run_id
                row_payload["is_sample_data"] = is_sample
                row_payload["data_source"] = artifact.data_source
                access.upsert_forecast(cur, row_payload)
                written += 1
        if access._conn is not None:
            access._conn.commit()

    return {
        "series": f"{artifact.mandi_code}/{artifact.commodity_code}",
        "mandi": {"id": artifact.mandi_id, "code": artifact.mandi_code, "name": artifact.mandi_name},
        "commodity": {"id": artifact.commodity_id, "code": artifact.commodity_code, "name": artifact.commodity_name},
        "model_version": model_version,
        "model_name": artifact.model_name,
        "generated_at": timestamp.isoformat(),
        "training_data_end_date": artifact.training_data_end_date,
        "last_observed_date": last_date.isoformat(),
        "last_observed_price": round(float(series.prices[-1]), 2),
        "staleness_days": staleness,
        "data_source": artifact.data_source,
        "is_sample_data": artifact.is_sample_data,
        "interval": interval.to_dict(),
        "horizons": artifact.horizon_max,
        "persisted": bool(persist),
        "rows_written": written,
        "run_id": run_id,
        "forecasts": [
            {
                "date": r["forecast_date"].isoformat(),
                "horizon_days": r["horizon_days"],
                "predicted_price": r["predicted_price"],
                "lower_bound": r["lower_bound"],
                "upper_bound": r["upper_bound"],
                "confidence": r["confidence"],
            }
            for r in rows
        ],
    }


def generate_all(
    access: ForecastDataAccess,
    *,
    model_version: str,
    selector: SeriesSelector | None = None,
    artifact_root: Path | None = None,
    persist: bool = True,
) -> list[dict]:
    """Generates forecasts for every artefact matching the selector."""
    from .persist import list_artifacts

    results: list[dict] = []
    for entry in list_artifacts(root=artifact_root):
        if entry.get("model_version") != model_version:
            continue
        if selector and not selector.matches(entry.get("mandi_code", ""), entry.get("commodity_code", "")):
            continue
        try:
            results.append(
                generate_series(
                    access,
                    mandi_code=entry["mandi_code"],
                    commodity_code=entry["commodity_code"],
                    model_version=model_version,
                    artifact_root=artifact_root,
                    persist=persist,
                )
            )
        except (InsufficientHistoryError, ModelError, FileNotFoundError) as exc:
            results.append(
                {
                    "series": f"{entry.get('mandi_code')}/{entry.get('commodity_code')}",
                    "skipped": True,
                    "reason": str(exc),
                }
            )
    return results


# ---------------------------------------------------------------------------
# orchestration
# ---------------------------------------------------------------------------
@dataclass
class TrainOutcome:
    trained: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    fixture: dict | None = None

    def to_dict(self) -> dict:
        return {"trained": self.trained, "skipped": self.skipped, "fixture": self.fixture}


def run_training(
    *,
    access: ForecastDataAccess,
    selector: SeriesSelector,
    model_version: str,
    db_config: DatabaseConfig | None = None,
    artifact_root: Path | None = None,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
    candidates: Sequence[str] = DEFAULT_CANDIDATES,
    allow_arrivals: bool = False,
    materialise_fixture: bool = True,
) -> TrainOutcome:
    """Trains every selected series; optionally seeds the development fixture first."""
    outcome = TrainOutcome()

    if selector.use_fixture:
        if is_production():
            raise RuntimeError("the development fixture is refused when NODE_ENV=production")
        from . import fixture as fixture_module

        if materialise_fixture:
            outcome.fixture = fixture_module.materialise(access)
            if access._conn is not None:
                access._conn.commit()

    pairs = _resolve_pairs(access, selector)
    if not pairs:
        raise InsufficientHistoryError(
            "no mandi/commodity series matched; the Phase 3 price tables are empty",
            code="NO_DATA",
        )

    for index, (mandi_id, commodity_id) in enumerate(pairs, start=1):
        series = access.load_series(mandi_id, commodity_id, include_sample=True)
        key = f"{series.mandi_code}/{series.commodity_code}"
        if series.is_sample_data and not selector.use_fixture and not selector.include_sample:
            outcome.skipped.append({"series": key, "reason": "sample_only_series_excluded"})
            continue
        # The recorded provenance follows the DATA, not the flag that selected it: a
        # series made entirely of synthetic rows is a FIXTURE run even when the
        # operator did not pass --fixture. This keeps `data_source` and
        # `is_sample_data` consistent (enforced by a database check constraint).
        data_source = "FIXTURE" if series.is_sample_data else "DATABASE"
        print(
            f"[train] ({index}/{len(pairs)}) {key}: {series.size} observations "
            f"[{data_source}{', synthetic' if series.is_sample_data else ', genuine'}]",
            flush=True,
        )
        try:
            _artifact, _models, report = train_series(
                series,
                model_version=model_version,
                horizons=horizons,
                candidates=candidates,
                allow_arrivals=allow_arrivals,
                data_source=data_source,
                artifact_root=artifact_root,
            )
            outcome.trained.append(report)
        except InsufficientHistoryError as exc:
            outcome.skipped.append({"series": key, "reason": str(exc), "available": exc.available})
    return outcome


def default_model_version(*, fixture: bool, trained_at: _dt.datetime | None = None) -> str:
    """Model version stamped on an artefact, e.g. ``gradient-boosting-v1`` style."""
    stamp = (trained_at or _dt.datetime.now(_dt.timezone.utc)).strftime("%Y%m%d")
    suffix = "fixture" if fixture else "data"
    return f"phase4-{suffix}-v1-{stamp}"


def model_version_family(artifact: TrainingArtifact) -> str:
    """Coarse family name derived from the fitted estimator, for reporting."""
    return artifact.model_name or FALLBACK_MODEL_NAME


__all__ = [
    "DEFAULT_CANDIDATES",
    "DEFAULT_HORIZONS",
    "FALLBACK_MODEL_NAME",
    "InsufficientHistoryError",
    "MAX_STALENESS_DAYS",
    "MIN_OBSERVATIONS_FOR_TRAINING",
    "SeriesSelector",
    "TrainOutcome",
    "default_model_version",
    "generate_all",
    "generate_series",
    "model_version_family",
    "run_training",
    "train_series",
]
