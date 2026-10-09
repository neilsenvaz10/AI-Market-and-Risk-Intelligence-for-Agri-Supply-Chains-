"""Backward-looking feature engineering for mandi price forecasting.

**Leakage contract.** Every feature for a row anchored at index ``i`` is computed
exclusively from observations with index ``< i`` (see :func:`build_training_data`
and :func:`build_inference_features`). A training row never reads the observation
it predicts, and inference only ever reads the series it was given. No function in
this module can see a future price, which is what makes the regression tests in
``ml-service/tests/test_leakage.py`` meaningful.

Missing values are never replaced with ``0``: a feature that cannot be computed
from the available history makes the row *ineligible* and it is dropped (counted
in the returned diagnostics) rather than imputed with a fabricated number.
"""

from __future__ import annotations

import datetime as _dt
import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

from .data import PriceSeries

# Lag structure required before a feature row is considered complete.
LAG_DAYS = (1, 2, 3, 7, 14)
MAX_LAG = max(LAG_DAYS)
ROLLING_WINDOWS = (7, 14)
MIN_HISTORY = MAX_LAG  # rows needed behind the anchor for every price feature

# Arrival features are only built when the series genuinely carries arrivals.
ARRIVAL_MIN_COVERAGE = 0.8


class InsufficientHistoryError(Exception):
    """Raised when a series cannot support the requested feature/horizon build."""

    def __init__(self, message: str, *, available: int = 0, required: int = 0):
        super().__init__(message)
        self.available = available
        self.required = required


@dataclass
class FeatureMatrix:
    """A dense feature block plus the metadata needed to reproduce it."""

    rows: list[list[float]] = field(default_factory=list)
    feature_names: list[str] = field(default_factory=list)
    anchor_indices: list[int] = field(default_factory=list)
    anchor_dates: list[_dt.date] = field(default_factory=list)
    values: list[float] = field(default_factory=list)
    skipped_incomplete: int = 0
    includes_arrivals: bool = False
    arrival_feature_names: list[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.rows)

    def to_arrays(self) -> tuple[np.ndarray, np.ndarray]:
        x = np.asarray(self.rows, dtype=float) if self.rows else np.empty((0, len(self.feature_names)))
        y = np.asarray(self.values, dtype=float)
        return x, y

    def describe(self) -> dict:
        return {
            "feature_count": len(self.feature_names),
            "feature_names": list(self.feature_names),
            "rows": self.size,
            "skipped_incomplete": self.skipped_incomplete,
            "includes_arrivals": self.includes_arrivals,
        }


# ---------------------------------------------------------------------------
# primitive, explicitly backward-looking helpers
# ---------------------------------------------------------------------------
def lag(values: Sequence[float], index: int, days: int) -> Optional[float]:
    """``values[index - days]`` or ``None`` when it reaches before the series start."""
    target = index - days
    if target < 0 or target >= len(values):
        return None
    return float(values[target])


def rolling_mean(values: Sequence[float], index: int, window: int) -> Optional[float]:
    """Mean of the ``window`` observations immediately *before* ``index``."""
    start = index - window
    if start < 0 or index > len(values):
        return None
    chunk = values[start:index]
    if len(chunk) != window:
        return None
    return float(sum(chunk) / window)


def rolling_std(values: Sequence[float], index: int, window: int) -> Optional[float]:
    """Population standard deviation of the ``window`` observations before ``index``."""
    start = index - window
    if start < 0 or index > len(values):
        return None
    chunk = [float(v) for v in values[start:index]]
    if len(chunk) != window:
        return None
    mean = sum(chunk) / window
    return float(math.sqrt(sum((v - mean) ** 2 for v in chunk) / window))


def rolling_slope(values: Sequence[float], index: int, window: int) -> Optional[float]:
    """Least-squares slope (price units per day) over the window before ``index``."""
    start = index - window
    if start < 0 or index > len(values):
        return None
    chunk = [float(v) for v in values[start:index]]
    if len(chunk) != window:
        return None
    n = window
    xs = list(range(n))
    mean_x = (n - 1) / 2
    mean_y = sum(chunk) / n
    denominator = sum((x - mean_x) ** 2 for x in xs)
    if denominator == 0:
        return 0.0
    return float(sum((xs[i] - mean_x) * (chunk[i] - mean_y) for i in range(n)) / denominator)


def pct_change(values: Sequence[float], index: int, periods: int) -> Optional[float]:
    """Percentage change from ``index - periods`` to ``index - 1`` (all in the past)."""
    start = index - periods - 1
    end = index - 1
    if start < 0 or end < 0 or end >= len(values):
        return None
    base = float(values[start])
    if base == 0:
        return None
    return float((float(values[end]) - base) / base * 100.0)


def calendar_features(day: _dt.date) -> dict:
    """Deterministic calendar/seasonality encoding (known for any future date)."""
    doy = day.timetuple().tm_yday
    days_in_year = 366 if _is_leap(day.year) else 365
    return {
        "day_of_week": float(day.weekday()),
        "month": float(day.month),
        "day_of_year": float(doy),
        "dow_sin": math.sin(2 * math.pi * day.weekday() / 7),
        "dow_cos": math.cos(2 * math.pi * day.weekday() / 7),
        "doy_sin": math.sin(2 * math.pi * doy / days_in_year),
        "doy_cos": math.cos(2 * math.pi * doy / days_in_year),
        "month_sin": math.sin(2 * math.pi * day.month / 12),
        "month_cos": math.cos(2 * math.pi * day.month / 12),
    }


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


CALENDAR_FEATURE_NAMES = (
    "day_of_week", "month", "day_of_year",
    "dow_sin", "dow_cos", "doy_sin", "doy_cos", "month_sin", "month_cos",
)

ARRIVAL_FEATURE_NAMES = ("arrival_lag_1", "arrival_lag_7", "arrival_rolling_mean_7", "arrival_change_1")


def resolve_arrival_features(series: PriceSeries, *, allow_arrivals: bool) -> tuple[bool, str]:
    """Decides whether arrival features may be used, and says why.

    Arrivals are used only when the caller allows it *and* the series genuinely
    carries them for at least :data:`ARRIVAL_MIN_COVERAGE` of its observations.
    """
    if not allow_arrivals:
        return False, "arrival_features_disabled_by_caller"
    coverage = series.arrival_coverage()
    if coverage < ARRIVAL_MIN_COVERAGE:
        return False, f"arrival_coverage_{coverage:.2f}_below_{ARRIVAL_MIN_COVERAGE}"
    return True, "arrival_features_enabled"


def feature_names(*, includes_arrivals: bool) -> list[str]:
    names = [f"lag_{d}" for d in LAG_DAYS]
    names += [f"rolling_mean_{w}" for w in ROLLING_WINDOWS]
    names += ["rolling_std_7", "pct_change_7", "rolling_slope_7", "deviation_from_mean_14"]
    names += list(CALENDAR_FEATURE_NAMES)
    if includes_arrivals:
        names += list(ARRIVAL_FEATURE_NAMES)
    return names


def _price_feature_block(
    observations: Sequence,
    anchor: int,
    *,
    includes_arrivals: bool,
    horizon: int = 1,
) -> Optional[tuple[list[float], list[str]]]:
    """Price + calendar (+ optional arrival) features for the anchor ``anchor``.

    ``anchor`` is the first index that is *not yet observed* — every value read is
    strictly below it. ``horizon`` only shifts the **calendar** block, which is
    known in advance for any future date, so a 7-day-ahead row correctly carries
    next week's day-of-week/seasonal encoding rather than tomorrow's.
    """
    if anchor < MIN_HISTORY or horizon < 1:
        return None
    prices = [o.modal_price for o in observations]

    block: dict[str, Optional[float]] = {}
    for days in LAG_DAYS:
        block[f"lag_{days}"] = lag(prices, anchor, days)
    for window in ROLLING_WINDOWS:
        block[f"rolling_mean_{window}"] = rolling_mean(prices, anchor, window)
    block["rolling_std_7"] = rolling_std(prices, anchor, 7)
    block["pct_change_7"] = pct_change(prices, anchor, 7)
    block["rolling_slope_7"] = rolling_slope(prices, anchor, 7)
    mean14 = block.get("rolling_mean_14")
    last = block.get("lag_1")
    block["deviation_from_mean_14"] = (
        float(last - mean14) if mean14 is not None and last is not None else None
    )
    if any(block[name] is None for name in block):
        return None

    # Calendar describes the date being predicted, not the last observed date.
    target_date = observations[anchor - 1].price_date + _dt.timedelta(days=horizon)
    block.update(calendar_features(target_date))

    names = feature_names(includes_arrivals=False)
    ordered = [block[name] for name in names]

    if includes_arrivals:
        arrivals = [o.arrivals_quantity for o in observations]
        arrival_lag_1 = lag(arrivals, anchor, 1)
        arrival_lag_7 = lag(arrivals, anchor, 7)
        arrival_mean_7 = rolling_mean(arrivals, anchor, 7)
        if arrival_lag_1 is None or arrival_lag_7 is None or arrival_mean_7 is None:
            return None
        previous_reported = next((v for v in reversed(arrivals[: anchor - 1]) if v is not None), None)
        arrival_change = (
            float(arrival_lag_1 - previous_reported) if previous_reported is not None else 0.0
        )
        names = names + list(ARRIVAL_FEATURE_NAMES)
        ordered = ordered + [arrival_lag_1, arrival_lag_7, arrival_mean_7, arrival_change]

    return [float(v) for v in ordered], names


def build_training_data(
    series: PriceSeries,
    *,
    horizon: int,
    allow_arrivals: bool = False,
) -> FeatureMatrix:
    """Supervised rows predicting ``horizon`` steps ahead.

    Row ``k`` uses observations ``[0, anchor)`` and targets the modal price at
    ``anchor + horizon - 1`` — always a genuine, already-recorded price. The
    target of a row is therefore *never* an input feature of the same row.
    """
    return build_training_matrix(
        series.observations,
        horizon=horizon,
        includes_arrivals=resolve_arrival_features(series, allow_arrivals=allow_arrivals)[0],
    )


def build_training_matrix(
    observations: Sequence,
    *,
    horizon: int,
    includes_arrivals: bool,
) -> FeatureMatrix:
    """Horizon-aligned supervised matrix; see :func:`build_training_data`."""
    if horizon < 1:
        raise ValueError("horizon must be >= 1")
    matrix = FeatureMatrix(includes_arrivals=includes_arrivals)
    last_anchor = len(observations) - horizon  # target index = anchor + horizon - 1
    skipped = 0
    for anchor in range(0, len(observations)):
        if anchor > last_anchor:
            break
        block = _price_feature_block(
            observations, anchor, includes_arrivals=includes_arrivals, horizon=horizon
        )
        if block is None:
            skipped += 1
            continue
        row, names = block
        matrix.rows.append(row)
        matrix.feature_names = names
        matrix.anchor_indices.append(anchor)
        matrix.anchor_dates.append(observations[anchor - 1].price_date)
        matrix.values.append(float(observations[anchor + horizon - 1].modal_price))

    matrix.skipped_incomplete = skipped
    if not matrix.feature_names:
        matrix.feature_names = feature_names(includes_arrivals=includes_arrivals)
    matrix.arrival_feature_names = list(ARRIVAL_FEATURE_NAMES) if includes_arrivals else []
    return matrix


def build_feature_row(
    observations: Sequence,
    anchor: int,
    *,
    includes_arrivals: bool,
    horizon: int = 1,
) -> Optional[list[float]]:
    """Feature vector for ``anchor`` using only earlier observations.

    Public wrapper so validation/backtesting can score an arbitrary cutoff without
    touching private helpers. Returns ``None`` when the prior history is incomplete.
    """
    block = _price_feature_block(
        observations, anchor, includes_arrivals=includes_arrivals, horizon=horizon
    )
    if block is None:
        return None
    row, _names = block
    return row


def build_inference_features(
    series: PriceSeries,
    *,
    allow_arrivals: bool = False,
    horizons: Sequence[int] = (1,),
) -> dict[int, dict]:
    """Per-horizon feature rows describing "now", i.e. after the last observation.

    Each horizon gets its own row because the calendar block differs per target
    date. Raises :class:`InsufficientHistoryError` when the series is too short —
    the caller must then report insufficient history instead of forecasting.
    """
    observations = series.observations
    if len(observations) < MIN_HISTORY:
        raise InsufficientHistoryError(
            f"series has {len(observations)} observations; at least {MIN_HISTORY} are required before forecasting",
            available=len(observations),
            required=MIN_HISTORY,
        )
    includes_arrivals, _reason = resolve_arrival_features(series, allow_arrivals=allow_arrivals)
    built: dict[int, dict] = {}
    for horizon in sorted({int(h) for h in horizons}):
        block = _price_feature_block(
            observations, len(observations), includes_arrivals=includes_arrivals, horizon=horizon
        )
        if block is None:
            raise InsufficientHistoryError(
                f"series has {len(observations)} observations; a complete feature row for horizon "
                f"{horizon} could not be built (needs at least {MIN_HISTORY})",
                available=len(observations),
                required=MIN_HISTORY,
            )
        row, names = block
        built[horizon] = {"row": row, "feature_names": names, "last_observed_date": observations[-1].price_date}
    return built


@dataclass
class SeriesFeatures:
    """Per-horizon supervised matrices for one series (built once, sliced often)."""

    series: PriceSeries
    horizons: list[int] = field(default_factory=list)
    matrices: dict[int, FeatureMatrix] = field(default_factory=dict)
    includes_arrivals: bool = False
    arrival_reason: str = ""

    def __post_init__(self):
        if not self.horizons:
            raise ValueError("at least one horizon is required")

    @classmethod
    def build(
        cls,
        series: PriceSeries,
        *,
        horizons: Sequence[int],
        allow_arrivals: bool = False,
    ) -> "SeriesFeatures":
        ordered = sorted({int(h) for h in horizons})
        includes_arrivals, reason = resolve_arrival_features(series, allow_arrivals=allow_arrivals)
        matrices = {
            h: build_training_matrix(series.observations, horizon=h, includes_arrivals=includes_arrivals)
            for h in ordered
        }
        return cls(
            series=series,
            horizons=ordered,
            matrices=matrices,
            includes_arrivals=includes_arrivals,
            arrival_reason=reason,
        )

    @property
    def feature_names(self) -> list[str]:
        first = self.matrices.get(self.horizons[0]) if self.horizons else None
        return list(first.feature_names) if first else []

    def matrix(self, horizon: int) -> FeatureMatrix:
        return self.matrices[int(horizon)]

    def training_rows(self, horizon: int, *, before: int) -> tuple[np.ndarray, np.ndarray, list[int]]:
        """Training rows whose **target index** is strictly below ``before``.

        A row with anchor ``a`` has target index ``a + horizon - 1``. Requiring
        ``target < before`` is the guarantee that no validation or test observation
        can leak into the training set.
        """
        matrix = self.matrix(horizon)
        x, y = matrix.to_arrays()
        keep = [i for i, anchor in enumerate(matrix.anchor_indices) if anchor + horizon - 1 < before]
        if not keep:
            return np.empty((0, len(matrix.feature_names))), np.empty((0,)), []
        return x[keep], y[keep], [matrix.anchor_indices[i] for i in keep]

    def describe(self) -> dict:
        return {
            "horizons": list(self.horizons),
            "includes_arrivals": self.includes_arrivals,
            "arrival_decision": self.arrival_reason,
            "feature_names": self.feature_names,
            "rows_by_horizon": {str(h): self.matrix(h).size for h in self.horizons},
            "skipped_by_horizon": {str(h): self.matrix(h).skipped_incomplete for h in self.horizons},
        }


__all__ = [
    "ARRIVAL_FEATURE_NAMES",
    "ARRIVAL_MIN_COVERAGE",
    "CALENDAR_FEATURE_NAMES",
    "FeatureMatrix",
    "InsufficientHistoryError",
    "LAG_DAYS",
    "MAX_LAG",
    "MIN_HISTORY",
    "ROLLING_WINDOWS",
    "SeriesFeatures",
    "build_feature_row",
    "build_inference_features",
    "build_training_data",
    "build_training_matrix",
    "calendar_features",
    "feature_names",
    "lag",
    "minimum_observations_for",
    "pct_change",
    "resolve_arrival_features",
    "rolling_mean",
    "rolling_slope",
    "rolling_std",
]
