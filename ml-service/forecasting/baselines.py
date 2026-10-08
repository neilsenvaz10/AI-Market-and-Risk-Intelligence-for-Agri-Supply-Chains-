"""Naive and moving-average baselines used as the comparison floor for Phase 4.

A forecasting model is only worth deploying if it beats these. Both baselines are
deliberately trivial and completely deterministic, and neither looks at anything
beyond the last observation it is given.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass(frozen=True)
class BaselineSpec:
    name: str
    version: str
    description: str


LAST_VALUE = BaselineSpec(
    name="last_value",
    version="baseline-last-value-v1",
    description="Repeats the most recent observed modal price for every horizon.",
)

MOVING_AVERAGE_7 = BaselineSpec(
    name="moving_average_7",
    version="baseline-moving-average-7-v1",
    description="Repeats the mean of the last 7 observations for every horizon.",
)


def last_value_forecast(prices: Sequence[float], horizons: int) -> list[float]:
    """Naive forecast: the last observed price, held flat across all horizons."""
    if not prices:
        raise ValueError("last_value_forecast needs at least one observed price")
    return [float(prices[-1])] * horizons


def moving_average_forecast(prices: Sequence[float], horizons: int, window: int = 7) -> list[float]:
    """Mean of the last ``window`` observations, held flat across all horizons."""
    if len(prices) < window:
        raise ValueError(f"moving_average_forecast needs at least {window} observations")
    mean = float(np.mean(np.asarray(prices[-window:], dtype=float)))
    return [mean] * horizons


def baseline_forecasts(prices: Sequence[float], horizons: int) -> dict[str, list[float]]:
    """Both baselines side by side; a baseline that cannot be computed is omitted."""
    forecasts: dict[str, list[float]] = {}
    if prices:
        forecasts[LAST_VALUE.name] = last_value_forecast(prices, horizons)
    if len(prices) >= 7:
        forecasts[MOVING_AVERAGE_7.name] = moving_average_forecast(prices, horizons)
    return forecasts


__all__ = [
    "LAST_VALUE",
    "MOVING_AVERAGE_7",
    "BaselineSpec",
    "baseline_forecasts",
    "last_value_forecast",
    "moving_average_forecast",
]
