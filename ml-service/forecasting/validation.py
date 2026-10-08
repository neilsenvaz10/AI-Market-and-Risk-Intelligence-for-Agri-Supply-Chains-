"""Chronological (never random) validation and backtesting for Phase 4.

The time-series dataset is **never** shuffled or randomly split. Every split here
is a contiguous date range, and the order of the three partitions is always:

    TRAIN (earliest) -> VALIDATION (middle) -> TEST (latest)

Walk-forward backtesting re-fits the model on an expanding prefix of history and
scores it on the observation that comes immediately after that prefix, which is
exactly the situation a live forecast is in. Because the feature block for a
cutoff is built in :mod:`forecasting.features` (strictly backward-looking), a
backtest prediction cannot depend on its own target.

Metrics computed here are the only source of the numbers reported in
``docs/phase4/evaluation.md``.
"""

from __future__ import annotations

import datetime as _dt
import math
from dataclasses import dataclass, field
from typing import Callable, Iterable, Sequence

import numpy as np

from . import features as feature_engineering
from .data import PriceSeries
from .metrics import MetricSummary, compare_models, summarise
from .models import HorizonModel, ModelError, build_model

DEFAULT_SPLIT = (0.6, 0.2, 0.2)


@dataclass(frozen=True)
class ChronologicalSplit:
    """Index ranges over the observation list: [train) [validation) [test)."""

    train_start: int
    train_end: int
    val_start: int
    val_end: int
    test_start: int
    test_end: int

    @property
    def train_size(self) -> int:
        return self.train_end - self.train_start

    @property
    def val_size(self) -> int:
        return self.val_end - self.val_start

    @property
    def test_size(self) -> int:
        return self.test_end - self.test_start

    def describe(self, series: PriceSeries) -> dict:
        def label(index: int) -> str | None:
            if index < 0 or index >= series.size:
                return None
            return series.observations[index].price_date.isoformat()

        return {
            "train": {"size": self.train_size, "start": label(self.train_start), "end": label(self.train_end - 1)},
            "validation": {"size": self.val_size, "start": label(self.val_start), "end": label(self.val_end - 1)},
            "test": {"size": self.test_size, "start": label(self.test_start), "end": label(self.test_end - 1)},
        }


def chronological_split(
    size: int,
    *,
    fractions: tuple[float, float, float] = DEFAULT_SPLIT,
    min_train: int = 0,
) -> ChronologicalSplit:
    """Splits ``size`` observations into contiguous train/validation/test ranges."""
    if size <= 2:
        raise ValueError(f"need at least 3 observations to split, received {size}")
    if abs(sum(fractions) - 1.0) > 1e-9:
        raise ValueError(f"split fractions must sum to 1.0, received {sum(fractions)}")
    train_size = int(math.floor(size * fractions[0]))
    val_size = int(math.floor(size * fractions[1]))
    test_size = size - train_size - val_size
    if train_size < 1 or val_size < 1 or test_size < 1:
        raise ValueError(
            f"split of {size} observations with {fractions} does not leave at least one row per partition"
        )
    if min_train and train_size < min_train:
        raise ValueError(f"training partition has {train_size} rows; at least {min_train} are required")
    return ChronologicalSplit(0, train_size, train_size, train_size + val_size, train_size + val_size, size)


# ---------------------------------------------------------------------------
# feature caching so a walk-forward backtest does not rebuild matrices
# ---------------------------------------------------------------------------
def build_series_features(
    series: PriceSeries,
    *,
    horizons: Iterable[int],
    allow_arrivals: bool = False,
) -> feature_engineering.SeriesFeatures:
    """Per-horizon feature matrices, built once and sliced by cutoff."""
    return feature_engineering.SeriesFeatures.build(
        series, horizons=horizons, allow_arrivals=allow_arrivals
    )


@dataclass
class BacktestResult:
    """Walk-forward predictions for one horizon, plus the naive reference."""

    horizon: int
    cutoffs: list[int] = field(default_factory=list)
    dates: list[_dt.date] = field(default_factory=list)
    actual: list[float] = field(default_factory=list)
    predicted: list[float] = field(default_factory=list)
    naive: list[float] = field(default_factory=list)
    residuals_log: list[float] = field(default_factory=list)
    skipped: int = 0

    @property
    def samples(self) -> int:
        return len(self.actual)

    def to_dict(self) -> dict:
        return {
            "horizon": self.horizon,
            "samples": self.samples,
            "cutoffs": len(self.cutoffs),
            "skipped": self.skipped,
            "mean_abs_log_residual": (
                round(float(np.mean(np.abs(self.residuals_log))), 6) if self.residuals_log else None
            ),
        }


def walk_forward_cutoffs(
    series: PriceSeries,
    *,
    horizon: int,
    start_index: int,
    end_index: int | None = None,
) -> list[int]:
    """Cutoffs whose target index falls inside ``[start_index, end_index)``."""
    limit = series.size if end_index is None else min(end_index, series.size)
    first = max(start_index - horizon + 1, feature_engineering.MIN_HISTORY)
    last = limit - horizon  # inclusive target bound
    return [c for c in range(first, last + 1)]


def backtest(
    cache: feature_engineering.SeriesFeatures,
    *,
    horizon: int,
    cutoffs: Sequence[int],
    model_name: str,
    model_kwargs: dict | None = None,
    stride: int = 1,
) -> BacktestResult:
    """Re-fits and predicts at each cutoff; records log residuals for intervals.

    ``stride`` sub-samples the cutoffs (e.g. every 4th day). This is used for
    interval calibration, where a representative sample of held-out residuals is
    enough; evaluation metrics always use ``stride=1`` so no reported number is
    based on a sub-sample in a way that would flatter the model.
    """
    result = BacktestResult(horizon=horizon)
    observations = cache.series.observations
    selected = list(cutoffs)[:: max(1, int(stride))]
    for cutoff in selected:
        x_train, y_train, _anchors = cache.training_rows(horizon, before=cutoff)
        if x_train.shape[0] < 2:
            result.skipped += 1
            continue
        try:
            model = build_model(model_name, **(model_kwargs or {})).fit(x_train, np.log(y_train))
            row = feature_engineering.build_feature_row(
                observations, cutoff, includes_arrivals=cache.includes_arrivals, horizon=horizon
            )
            if row is None:
                result.skipped += 1
                continue
            predicted_price = model.predict_price(row)
        except ModelError:
            result.skipped += 1
            continue

        actual_price = float(observations[cutoff + horizon - 1].modal_price)
        result.cutoffs.append(cutoff)
        result.dates.append(observations[cutoff + horizon - 1].price_date)
        result.actual.append(actual_price)
        result.predicted.append(predicted_price)
        # The naive reference repeats the price known at the cutoff.
        result.naive.append(float(observations[cutoff - 1].modal_price))
        result.residuals_log.append(math.log(actual_price) - math.log(predicted_price))
    return result


def summarise_backtest(result: BacktestResult, model_name: str) -> list[MetricSummary]:
    """Model and naive metrics for one backtest, so the comparison is explicit."""
    if result.samples == 0:
        return []
    reference = None
    return [
        summarise(model_name, result.horizon, result.actual, result.predicted, reference=reference),
        summarise("baseline_last_value", result.horizon, result.actual, result.naive, reference=reference),
    ]


def select_model(
    cache: feature_engineering.SeriesFeatures,
    *,
    candidate_names: Sequence[str],
    start_index: int,
    end_index: int,
    horizons: Sequence[int],
    model_kwargs: dict | None = None,
    verbose: bool = False,
) -> dict:
    """Ranks candidates by mean validation MAE — the only place a model is chosen."""
    scores: dict[str, list[float]] = {name: [] for name in candidate_names}
    per_horizon: dict[str, dict[int, float]] = {name: {} for name in candidate_names}
    for horizon in horizons:
        cutoffs = walk_forward_cutoffs(cache.series, horizon=horizon, start_index=start_index, end_index=end_index)
        if not cutoffs:
            continue
        for name in candidate_names:
            result = backtest(cache, horizon=horizon, cutoffs=cutoffs, model_name=name, model_kwargs=model_kwargs)
            if result.samples == 0:
                continue
            from .metrics import mae as _mae

            score = _mae(result.actual, result.predicted)
            scores[name].append(score)
            per_horizon[name][horizon] = round(score, 4)

    means = {name: (round(float(np.mean(v)), 4) if v else None) for name, v in scores.items()}
    eligible = {name: value for name, value in means.items() if value is not None}
    winner = min(eligible, key=eligible.get) if eligible else None
    if verbose:
        print(f"[train]   model selection (validation MAE): {means} -> {winner}", flush=True)
    return {
        "candidates": list(candidate_names),
        "mean_validation_mae": means,
        "mae_by_horizon": {name: dict(sorted(h.items())) for name, h in per_horizon.items()},
        "selected": winner,
    }


__all__ = [
    "BacktestResult",
    "ChronologicalSplit",
    "DEFAULT_SPLIT",
    "backtest",
    "build_series_features",
    "chronological_split",
    "select_model",
    "summarise_backtest",
    "walk_forward_cutoffs",
]
