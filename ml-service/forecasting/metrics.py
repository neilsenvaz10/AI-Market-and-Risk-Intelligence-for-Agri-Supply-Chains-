"""Forecast evaluation metrics.

All metrics are computed on genuinely held-out, chronologically later
observations. Nothing in this module is allowed to see training data, and no
metric is ever reported for a horizon that was not actually evaluated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np


def _arrays(actual: Sequence[float], predicted: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    if a.shape != p.shape:
        raise ValueError(f"actual and predicted must have the same shape ({a.shape} vs {p.shape})")
    if a.size == 0:
        raise ValueError("cannot compute metrics on an empty sample")
    return a, p


def mae(actual: Sequence[float], predicted: Sequence[float]) -> float:
    """Mean absolute error, in INR per quintal."""
    a, p = _arrays(actual, predicted)
    return float(np.mean(np.abs(a - p)))


def rmse(actual: Sequence[float], predicted: Sequence[float]) -> float:
    """Root mean squared error, in INR per quintal."""
    a, p = _arrays(actual, predicted)
    return float(np.sqrt(np.mean((a - p) ** 2)))


def mape(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    """Mean absolute percentage error, or ``None`` when it is not well defined.

    Returns ``None`` if any actual price is zero or negative: dividing by such a
    value would produce an infinite or sign-flipped number rather than a metric.
    """
    a, p = _arrays(actual, predicted)
    if np.any(a <= 0):
        return None
    return float(np.mean(np.abs((a - p) / a)) * 100.0)


def smape(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    """Symmetric MAPE, defined even when a price is small relative to the error."""
    a, p = _arrays(actual, predicted)
    denominator = (np.abs(a) + np.abs(p)) / 2.0
    if np.any(denominator == 0):
        return None
    return float(np.mean(np.abs(a - p) / denominator) * 100.0)


def directional_accuracy(
    actual: Sequence[float],
    predicted: Sequence[float],
    *,
    reference: Sequence[float] | None = None,
) -> float | None:
    """Share of steps whose predicted *direction* matches the observed direction.

    The direction of step ``i`` is ``sign(value[i] - reference[i])``, where
    ``reference`` defaults to the previous actual value (so the first step is
    skipped). Steps where either direction is flat are excluded rather than
    counted as correct. Returns ``None`` when no step has a defined direction.
    """
    a, p = _arrays(actual, predicted)
    if reference is None:
        if a.size < 2:
            return None
        ref = a[:-1]
        a_steps, p_steps = a[1:], p[1:]
    else:
        ref = np.asarray(reference, dtype=float)
        if ref.shape != a.shape:
            raise ValueError("reference must match the actual series shape")
        a_steps, p_steps = a, p
        if ref.size < 2:
            return None

    actual_dir = np.sign(a_steps - ref)
    predicted_dir = np.sign(p_steps - ref)
    defined = (actual_dir != 0) & (predicted_dir != 0)
    if not np.any(defined):
        return None
    return float(np.mean(actual_dir[defined] == predicted_dir[defined]) * 100.0)


@dataclass
class MetricSummary:
    """Metrics for one model at one horizon."""

    model: str
    horizon: int
    samples: int
    mae: float
    rmse: float
    mape: float | None
    smape: float | None
    directional_accuracy: float | None
    bias: float
    extras: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "horizon": self.horizon,
            "samples": self.samples,
            "mae": round(self.mae, 4),
            "rmse": round(self.rmse, 4),
            "mape": None if self.mape is None else round(self.mape, 4),
            "smape": None if self.smape is None else round(self.smape, 4),
            "directional_accuracy": (
                None if self.directional_accuracy is None else round(self.directional_accuracy, 4)
            ),
            "bias": round(self.bias, 4),
            "extras": dict(self.extras),
        }


def summarise(
    model_name: str,
    horizon: int,
    actual: Sequence[float],
    predicted: Sequence[float],
    *,
    reference: Sequence[float] | None = None,
    extras: dict | None = None,
) -> MetricSummary:
    a, p = _arrays(actual, predicted)
    return MetricSummary(
        model=model_name,
        horizon=horizon,
        samples=int(a.size),
        mae=mae(a, p),
        rmse=rmse(a, p),
        mape=mape(a, p),
        smape=smape(a, p),
        directional_accuracy=directional_accuracy(a, p, reference=reference),
        bias=float(np.mean(p - a)),
        extras=extras or {},
    )


def compare_models(
    summaries: Sequence[MetricSummary],
    *,
    metric: str = "mae",
) -> dict:
    """Ranks models by a metric across horizons and names the winner per horizon."""
    by_horizon: dict[int, list[MetricSummary]] = {}
    for summary in summaries:
        by_horizon.setdefault(summary.horizon, []).append(summary)

    winners: dict[int, str] = {}
    for horizon, entries in sorted(by_horizon.items()):
        scored = [e for e in entries if getattr(e, metric) is not None]
        if scored:
            winners[horizon] = min(scored, key=lambda e: getattr(e, metric)).model
    return {
        "metric": metric,
        "winners_by_horizon": winners,
        "mean_by_model": _mean_by_model(summaries, metric),
    }


def _mean_by_model(summaries: Sequence[MetricSummary], metric: str) -> dict:
    totals: dict[str, list[float]] = {}
    for summary in summaries:
        value = getattr(summary, metric)
        if value is None:
            continue
        totals.setdefault(summary.model, []).append(float(value))
    return {model: round(float(np.mean(values)), 4) for model, values in sorted(totals.items())}


__all__ = [
    "MetricSummary",
    "compare_models",
    "directional_accuracy",
    "mae",
    "mape",
    "rmse",
    "smape",
    "summarise",
]
