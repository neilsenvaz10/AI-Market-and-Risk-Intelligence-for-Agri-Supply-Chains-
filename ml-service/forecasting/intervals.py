"""Residual-based prediction intervals and confidence for Phase 4 forecasts.

**Method.** Residual quantiles are measured *out of sample* by walk-forward
backtesting: at every cutoff the model is re-fitted on history strictly before the
target and its error recorded as ``log(actual) - log(predicted)``. For each horizon
the interval is then the empirical quantile band of those held-out residuals,
applied to the point forecast in log space::

    [predicted * exp(q_low), predicted * exp(q_high)]

Because the residuals were produced by the same re-fitting procedure that live
forecasts use, the band reflects the model's real out-of-sample error rather than
its in-sample fit. Systematic bias in the residuals is corrected by centring the
band on the residual median before taking quantiles.

A fixed percentage band (e.g. predicted ± 10%) is deliberately **not** used.

**What confidence means.** ``confidence`` is a 0-100 *relative reliability score*
derived from the width of the interval and the number of backtest observations
behind it. It is a heuristic summary for ranking/comparison and for the UI — it is
**not** the probability that the price will land inside the interval. The
probability statement is carried by ``interval_level`` (an 80% interval means the
band was built to cover roughly 80% of held-out outcomes).

When no out-of-sample residuals exist yet, the interval falls back to a documented
development baseline capped at :data:`DEVELOPMENT_MAX_CONFIDENCE`, and the caller
is told through ``basis='development_fallback'`` so it is never presented as a
calibrated interval.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

INTERVAL_LEVEL = 0.80
# Confidence is capped below 100: no model with this little data can be certain.
MAX_CONFIDENCE = 90.0
DEVELOPMENT_MAX_CONFIDENCE = 40.0
DEVELOPMENT_RELATIVE_WIDTH = 0.20  # only used when no residuals are available
MIN_RESIDUALS = 5


@dataclass
class IntervalModel:
    """Per-horizon log-residual quantiles, or a documented development fallback."""

    level: float = INTERVAL_LEVEL
    quantiles: dict[int, tuple[float, float]] = field(default_factory=dict)
    counts: dict[int, int] = field(default_factory=dict)
    offsets: dict[int, float] = field(default_factory=dict)
    basis: str = "development_fallback"

    @property
    def calibrated(self) -> bool:
        return self.basis == "walk_forward_residuals"

    def band(self, horizon: int) -> tuple[float, float]:
        if horizon in self.quantiles:
            return self.quantiles[horizon]
        if not self.quantiles:
            half = DEVELOPMENT_RELATIVE_WIDTH * self.level
            return (-half, half)
        # Horizons beyond the calibrated ones inherit the widest measured band,
        # because uncertainty cannot shrink with distance.
        widest = max(self.quantiles.items(), key=lambda item: item[1][1] - item[1][0])
        return widest[1]

    def bounds(self, predicted_price: float, horizon: int) -> tuple[float, float]:
        low, high = self.band(horizon)
        lower = predicted_price * math.exp(low)
        upper = predicted_price * math.exp(high)
        # Guarantee a strictly positive, correctly ordered band.
        lower = max(lower, 1e-6)
        if upper <= lower:
            upper = lower * 1.001
        return round(lower, 2), round(upper, 2)

    def confidence(self, predicted_price: float, lower: float, upper: float, horizon: int) -> float:
        """Relative reliability score in [0, 100] (see the module docstring)."""
        if predicted_price <= 0:
            return 0.0
        relative_width = (upper - lower) / predicted_price
        if relative_width <= 0:
            return 0.0
        ceiling = MAX_CONFIDENCE if self.calibrated else DEVELOPMENT_MAX_CONFIDENCE
        width_score = 1.0 / (1.0 + relative_width)
        samples = self.counts.get(horizon, min(self.counts.values()) if self.counts else 0)
        sample_factor = min(1.0, samples / 30.0) if self.calibrated else 1.0
        horizon_factor = 1.0 - 0.06 * (horizon - 1)  # longer horizon, less reliable
        score = 100.0 * width_score * sample_factor * max(horizon_factor, 0.4)
        return round(float(min(score, ceiling)), 2)

    def to_dict(self) -> dict:
        return {
            "method": self.basis,
            "interval_level": self.level,
            "max_confidence": MAX_CONFIDENCE,
            "quantiles": {str(h): [round(low, 6), round(high, 6)] for h, (low, high) in sorted(self.quantiles.items())},
            "residual_counts": {str(h): n for h, n in sorted(self.counts.items())},
            "offsets": {str(h): round(v, 6) for h, v in sorted(self.offsets.items())},
        }

    @classmethod
    def from_dict(cls, payload: dict) -> "IntervalModel":
        model = cls(level=float(payload.get("interval_level", INTERVAL_LEVEL)))
        model.basis = str(payload.get("method", "development_fallback"))
        model.quantiles = {
            int(h): (float(pair[0]), float(pair[1]))
            for h, pair in (payload.get("quantiles") or {}).items()
        }
        model.counts = {int(h): int(n) for h, n in (payload.get("residual_counts") or {}).items()}
        model.offsets = {int(h): float(v) for h, v in (payload.get("offsets") or {}).items()}
        return model


def fit_intervals(
    residuals_by_horizon: dict[int, Sequence[float]],
    *,
    level: float = INTERVAL_LEVEL,
) -> IntervalModel:
    """Builds the interval model from walk-forward log residuals per horizon.

    A horizon with fewer than :data:`MIN_RESIDUALS` held-out residuals is left
    uncalibrated (it will inherit the widest measured band at prediction time),
    because quantiles of a handful of points would not be meaningful.
    """
    if not 0.5 <= level < 1.0:
        raise ValueError(f"interval level must be in [0.5, 1), received {level}")
    model = IntervalModel(level=level)
    alpha = 1.0 - level
    for horizon, residuals in sorted(residuals_by_horizon.items()):
        clean = np.asarray([r for r in residuals if r is not None and math.isfinite(r)], dtype=float)
        if clean.size < MIN_RESIDUALS:
            continue
        median = float(np.median(clean))
        centred = clean - median
        low = float(np.quantile(centred, alpha / 2.0))
        high = float(np.quantile(centred, 1.0 - alpha / 2.0))
        # Centre the band on the residual median so a persistent bias is corrected.
        model.quantiles[int(horizon)] = (low, high)
        model.offsets[int(horizon)] = median
        model.counts[int(horizon)] = int(clean.size)
    if model.quantiles:
        model.basis = "walk_forward_residuals"
    return model


def coverage(
    actual: Sequence[float],
    predicted: Sequence[float],
    intervals: Sequence[tuple[float, float]],
) -> dict:
    """Empirical coverage of an interval band on held-out data.

    Reported in the evaluation so the nominal level can be compared with what was
    actually observed; it is never assumed to match.
    """
    if not actual:
        return {"samples": 0, "inside": 0, "coverage": None}
    inside = sum(
        1 for a, (_p, (low, up)) in zip(actual, zip(predicted, intervals)) if low <= a <= up
    )
    return {
        "samples": len(actual),
        "inside": inside,
        "coverage": round(inside / len(actual), 4),
    }


__all__ = [
    "DEVELOPMENT_MAX_CONFIDENCE",
    "DEVELOPMENT_RELATIVE_WIDTH",
    "INTERVAL_LEVEL",
    "IntervalModel",
    "MAX_CONFIDENCE",
    "MIN_RESIDUALS",
    "coverage",
    "fit_intervals",
]
