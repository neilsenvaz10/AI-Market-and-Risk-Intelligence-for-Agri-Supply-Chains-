"""Shared helpers for the Phase 4 Python tests.

Run from the repository root or the ml-service directory:

    ml-service/venv/Scripts/python -m unittest discover -s ml-service/tests -t ml-service -v
"""

from __future__ import annotations

import datetime as _dt
import os
import sys
from pathlib import Path

ML_SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_SERVICE_DIR.parent
if str(ML_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_DIR))

from forecasting.data import Observation, PriceSeries  # noqa: E402

DAY = _dt.timedelta(days=1)
START = _dt.date(2026, 1, 5)


def make_series(
    prices,
    *,
    arrivals=None,
    start: _dt.date = START,
    step_days: int = 1,
    source: str = "DATA_GOV_IN",
    is_sample: bool = False,
) -> PriceSeries:
    """Builds a PriceSeries from a list of prices with synthetic calendar dates."""
    observations = []
    for index, price in enumerate(prices):
        date = start + _dt.timedelta(days=index * step_days)
        arrival = None if arrivals is None else arrivals[index]
        observations.append(
            Observation(
                price_date=date,
                modal_price=float(price),
                min_price=float(price) * 0.95,
                max_price=float(price) * 1.05,
                arrivals_quantity=None if arrival is None else float(arrival),
                arrival_unit=None if arrival is None else "tonne",
                source=source,
                is_sample_data=is_sample,
            )
        )
    return PriceSeries(
        mandi_id=1,
        commodity_id=1,
        mandi_code="TEST_MANDI",
        mandi_name="Test Mandi",
        commodity_code="TEST_CROP",
        commodity_name="Test Crop",
        observations=observations,
    )


def trending_prices(count: int = 180, base: float = 1000.0, slope: float = 1.5, wobble: float = 40.0):
    """A deterministic, mildly noisy upward series for tests."""
    return [base + slope * i + wobble * ((i % 7) - 3) for i in range(count)]


def allow_db_tests() -> bool:
    """Phase 4 database tests are opt-in: they need a disposable test database."""
    return os.environ.get("PHASE4_DB_TESTS") == "1"
