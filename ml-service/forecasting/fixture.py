"""Deterministic DEVELOPMENT FIXTURE data for Phase 4.

There is no genuine historical mandi data in this repository or database (no
``DATA_GOV_IN`` / ``CEDA`` API keys are configured and the mandi price tables are
empty). Phase 4 therefore ships a synthetic fixture so the whole forecasting
pipeline can be exercised end to end. The fixture is:

* **clearly synthetic** — every row uses ``source='MOCK_PROVIDER'``,
  ``is_sample_data=TRUE`` and carries the ``PHASE4_DEV_FIXTURE`` quality flag;
* **isolated from production** — it lives in the normal Phase 3 tables but is
  flagged, and any forecast generated from it is persisted with
  ``data_source='FIXTURE'`` / ``is_sample_data=TRUE``, so it can never be mistaken
  for a real forecast. It is refused outright when ``NODE_ENV=production``;
* **deterministic** — prices come from a seeded ``random.Random``, so repeated runs
  produce byte-identical values (there is no wall-clock or unseeded randomness);
* **sufficient** — enough observations per series to exercise feature engineering,
  chronological train/validation/test splitting and 1-7 day forecasting.

The fixture is **not** a source of real prices and must never be presented as one.
The production pipeline reads the same Phase 3 schema; pointing the trainer at real
data changes nothing except the ``data_source`` recorded on the output.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import math
import random
from dataclasses import dataclass

from .data import ForecastDataAccess, Observation, PriceSeries

FIXTURE_SOURCE = "MOCK_PROVIDER"
FIXTURE_SEED = 20260401
FIXTURE_FLAG = "PHASE4_DEV_FIXTURE"
FIXTURE_DAYS = 180
# Fixed anchor so the fixture never depends on "today".
FIXTURE_END_DATE = _dt.date(2026, 9, 30)


@dataclass(frozen=True)
class FixtureSeries:
    """Definition of one synthetic series."""

    mandi_code: str
    mandi_name: str
    mandi_hindi: str
    mandi_marathi: str
    state: str
    district: str
    commodity_code: str
    commodity_name: str
    commodity_hindi: str
    commodity_marathi: str
    category: str
    base_price: float
    trend_per_day: float
    weekly_amplitude: float
    seasonal_amplitude: float
    noise_sigma: float
    base_arrivals: float
    phase: float


FIXTURE_SERIES: tuple[FixtureSeries, ...] = (
    FixtureSeries(
        mandi_code="MH_PUNE_APMC", mandi_name="Pune APMC (Gultekdi)",
        mandi_hindi="पुणे एपीएमसी (गुलटेकड़ी)", mandi_marathi="पुणे एपीएमसी (गुलटेकडी)",
        state="Maharashtra", district="Pune",
        commodity_code="ONION", commodity_name="Onion",
        commodity_hindi="प्याज", commodity_marathi="कांदा", category="Vegetables",
        base_price=1450.0, trend_per_day=2.1, weekly_amplitude=70.0,
        seasonal_amplitude=140.0, noise_sigma=38.0, base_arrivals=820.0, phase=0.0,
    ),
    FixtureSeries(
        mandi_code="MH_NSK_MAIN", mandi_name="Nashik Market Yard",
        mandi_hindi="नासिक मार्केट यार्ड", mandi_marathi="नाशिक मार्केट यार्ड",
        state="Maharashtra", district="Nashik",
        commodity_code="ONION", commodity_name="Onion",
        commodity_hindi="प्याज", commodity_marathi="कांदा", category="Vegetables",
        base_price=1320.0, trend_per_day=1.6, weekly_amplitude=55.0,
        seasonal_amplitude=120.0, noise_sigma=33.0, base_arrivals=1150.0, phase=1.1,
    ),
    FixtureSeries(
        mandi_code="MH_PUNE_APMC", mandi_name="Pune APMC (Gultekdi)",
        mandi_hindi="पुणे एपीएमसी (गुलटेकड़ी)", mandi_marathi="पुणे एपीएमसी (गुलटेकडी)",
        state="Maharashtra", district="Pune",
        commodity_code="TOMATO", commodity_name="Tomato",
        commodity_hindi="टमाटर", commodity_marathi="टोमॅटो", category="Vegetables",
        base_price=2100.0, trend_per_day=-1.4, weekly_amplitude=130.0,
        seasonal_amplitude=260.0, noise_sigma=75.0, base_arrivals=520.0, phase=2.3,
    ),
    FixtureSeries(
        mandi_code="MH_NSK_MAIN", mandi_name="Nashik Market Yard",
        mandi_hindi="नासिक मार्केट यार्ड", mandi_marathi="नाशिक मार्केट यार्ड",
        state="Maharashtra", district="Nashik",
        commodity_code="TOMATO", commodity_name="Tomato",
        commodity_hindi="टमाटर", commodity_marathi="टोमॅटो", category="Vegetables",
        base_price=1980.0, trend_per_day=-0.9, weekly_amplitude=110.0,
        seasonal_amplitude=230.0, noise_sigma=68.0, base_arrivals=430.0, phase=0.7,
    ),
)


def series_key(item: FixtureSeries) -> tuple[str, str]:
    return (item.mandi_code, item.commodity_code)


def _stable_noise(seed: int, mandi_code: str, commodity_code: str, day: int) -> float:
    """Deterministic standard-normal draw, independent of iteration order.

    Uses sha256 rather than ``hash()`` because Python salts string hashing per
    process (PYTHONHASHSEED), which would make the "fixture" non-reproducible.
    """
    material = f"{seed}|{mandi_code}|{commodity_code}|{day}".encode("utf-8")
    digest = hashlib.sha256(material).digest()
    local_seed = int.from_bytes(digest[:8], "big")
    return random.Random(local_seed).gauss(0.0, 1.0)


def generate_series(item: FixtureSeries, *, days: int = FIXTURE_DAYS, seed: int = FIXTURE_SEED) -> PriceSeries:
    """Builds one deterministic synthetic series ending on :data:`FIXTURE_END_DATE`.

    ``arrivals_quantity`` is deliberately present on only ~70% of days so the
    pipeline's "arrivals are used only when genuinely available" rule is exercised
    by the fixture itself.
    """
    start = FIXTURE_END_DATE - _dt.timedelta(days=days - 1)
    observations: list[Observation] = []
    rng = random.Random(seed)

    for offset in range(days):
        day = start + _dt.timedelta(days=offset)
        noise = _stable_noise(seed, item.mandi_code, item.commodity_code, offset)
        weekly = item.weekly_amplitude * math.sin(2 * math.pi * (offset + item.phase) / 7.0)
        seasonal = item.seasonal_amplitude * math.sin(2 * math.pi * (offset + item.phase) / 90.0)
        trend = item.trend_per_day * offset
        modal = item.base_price + trend + weekly + seasonal + item.noise_sigma * noise
        modal = max(200.0, round(modal, 2))
        spread = max(15.0, round(modal * 0.06, 2))

        # Arrivals: present on about 7 of every 10 days, never invented when absent.
        has_arrivals = (rng.random() < 0.7) and offset > 2
        arrivals = None
        if has_arrivals:
            arrival_noise = _stable_noise(seed + 7, item.mandi_code, item.commodity_code, offset)
            arrivals = round(max(5.0, item.base_arrivals + 90.0 * arrival_noise), 3)

        observations.append(
            Observation(
                price_date=day,
                modal_price=modal,
                min_price=round(max(1.0, modal - spread), 2),
                max_price=round(modal + spread, 2),
                arrivals_quantity=arrivals,
                arrival_unit="tonne" if arrivals is not None else None,
                source=FIXTURE_SOURCE,
                is_sample_data=True,
                contributing_rows=1,
            )
        )

    return PriceSeries(
        mandi_id=0,
        commodity_id=0,
        mandi_code=item.mandi_code,
        mandi_name=item.mandi_name,
        commodity_code=item.commodity_code,
        commodity_name=item.commodity_name,
        unit="INR/quintal",
        observations=observations,
    )


def generate_all(*, days: int = FIXTURE_DAYS, seed: int = FIXTURE_SEED) -> dict[tuple[str, str], PriceSeries]:
    """Every fixture series, keyed by ``(mandi_code, commodity_code)``."""
    return {series_key(item): generate_series(item, days=days, seed=seed) for item in FIXTURE_SERIES}


def materialise(access: ForecastDataAccess, *, days: int = FIXTURE_DAYS, seed: int = FIXTURE_SEED) -> dict:
    """Writes the fixture into the Phase 3 tables, flagged as synthetic.

    Idempotent: re-running refreshes the same rows. Genuine rows are never touched
    because every statement is scoped to ``source='MOCK_PROVIDER'`` and the fixture's
    own market/commodity codes.
    """
    inserted = 0
    mandis: dict[str, int] = {}
    commodities: dict[str, int] = {}
    series_map = generate_all(days=days, seed=seed)

    with access.cursor() as cur:
        for item in FIXTURE_SERIES:
            cur.execute(
                """
                INSERT INTO mandis (code, name, hindi_name, marathi_name, state, district, market_center, is_active)
                VALUES (%(code)s, %(name)s, %(hindi)s, %(marathi)s, %(state)s, %(district)s, %(name)s, TRUE)
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name, hindi_name = EXCLUDED.hindi_name,
                    marathi_name = EXCLUDED.marathi_name, state = EXCLUDED.state,
                    district = EXCLUDED.district, is_active = TRUE,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
                """,
                {
                    "code": item.mandi_code, "name": item.mandi_name, "hindi": item.mandi_hindi,
                    "marathi": item.mandi_marathi, "state": item.state, "district": item.district,
                },
            )
            mandis[item.mandi_code] = int(cur.fetchone()["id"])

            cur.execute(
                """
                INSERT INTO commodities (code, name, hindi_name, marathi_name, category, standard_unit, is_active)
                VALUES (%(code)s, %(name)s, %(hindi)s, %(marathi)s, %(category)s, 'quintal', TRUE)
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name, hindi_name = EXCLUDED.hindi_name,
                    marathi_name = EXCLUDED.marathi_name, category = EXCLUDED.category,
                    is_active = TRUE, updated_at = CURRENT_TIMESTAMP
                RETURNING id
                """,
                {
                    "code": item.commodity_code, "name": item.commodity_name, "hindi": item.commodity_hindi,
                    "marathi": item.commodity_marathi, "category": item.category,
                },
            )
            commodities[item.commodity_code] = int(cur.fetchone()["id"])

        for item in FIXTURE_SERIES:
            series = series_map[series_key(item)]
            mandi_id = mandis[item.mandi_code]
            commodity_id = commodities[item.commodity_code]
            for observation in series.observations:
                cur.execute(
                    """
                    INSERT INTO mandi_prices (
                        mandi_id, commodity_id, price_date, min_price, max_price, modal_price,
                        arrivals_quantity, unit, variety, grade, source, is_sample_data, price_unit,
                        arrival_unit, quality_flags, fetched_at, last_seen_at
                    ) VALUES (
                        %(mandi_id)s, %(commodity_id)s, %(price_date)s, %(min_price)s, %(max_price)s,
                        %(modal_price)s, %(arrivals_quantity)s, 'quintal', NULL, NULL,
                        %(source)s, TRUE, 'INR/quintal', %(arrival_unit)s,
                        ARRAY[%(flag)s]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT ON CONSTRAINT uq_mandi_prices_observation
                    DO UPDATE SET
                        modal_price = EXCLUDED.modal_price,
                        min_price = EXCLUDED.min_price,
                        max_price = EXCLUDED.max_price,
                        arrivals_quantity = EXCLUDED.arrivals_quantity,
                        arrival_unit = EXCLUDED.arrival_unit,
                        is_sample_data = TRUE,
                        quality_flags = EXCLUDED.quality_flags,
                        last_seen_at = CURRENT_TIMESTAMP
                    """,
                    {
                        "mandi_id": mandi_id, "commodity_id": commodity_id,
                        "price_date": observation.price_date, "min_price": observation.min_price,
                        "max_price": observation.max_price, "modal_price": observation.modal_price,
                        "arrivals_quantity": observation.arrivals_quantity, "source": FIXTURE_SOURCE,
                        "arrival_unit": observation.arrival_unit, "flag": FIXTURE_FLAG,
                    },
                )
                inserted += 1

        # Resolve the generated series to their real database ids for training.
        for key, series in series_map.items():
            series.mandi_id = mandis[key[0]]
            series.commodity_id = commodities[key[1]]

    return {
        "mandis": len(mandis),
        "commodities": len(commodities),
        "series": len(series_map),
        "observations": inserted,
        "days": days,
        "seed": seed,
        "source": FIXTURE_SOURCE,
        "flag": FIXTURE_FLAG,
        "end_date": FIXTURE_END_DATE.isoformat(),
    }


def purge(access: ForecastDataAccess) -> dict:
    """Removes fixture rows (and only those) from the Phase 3 price table."""
    with access.cursor() as cur:
        cur.execute(
            """
            DELETE FROM mandi_prices
            WHERE source = %(source)s AND %(flag)s = ANY (quality_flags)
            """,
            {"source": FIXTURE_SOURCE, "flag": FIXTURE_FLAG},
        )
        deleted = cur.rowcount
    return {"deleted_observations": int(deleted)}


__all__ = [
    "FIXTURE_DAYS",
    "FIXTURE_END_DATE",
    "FIXTURE_FLAG",
    "FIXTURE_SEED",
    "FIXTURE_SERIES",
    "FIXTURE_SOURCE",
    "FixtureSeries",
    "generate_all",
    "generate_series",
    "materialise",
    "purge",
    "series_key",
]
