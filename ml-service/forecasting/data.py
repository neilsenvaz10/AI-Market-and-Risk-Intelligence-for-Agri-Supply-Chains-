"""Historical mandi price access for forecasting (Phase 3 schema, read only).

One observation per market, commodity and day is assembled with explicit rules so
the forecasting pipeline can never silently fabricate a value:

* **Source precedence** — only the highest-precedence source reporting a
  market-day contributes, mirroring the ``mandi_prices_resolved`` view. Sources
  are therefore never summed or averaged together.
* **Varieties** — when a day holds several varieties/grades, the *median* modal
  price is used and the number of contributing rows is kept on the observation.
* **Aggregates** — ``min_price``/``max_price`` are reported only when *every*
  contributing row has one; otherwise they stay ``None``.
* **Arrivals** — ``arrivals_quantity`` is reported only when every contributing
  row carries one and all share the same unit. A missing arrival is ``None``,
  never ``0``.
* **Invalid or missing prices** — rows with a NULL or non-positive modal price are
  dropped (never coerced to zero) and counted in ``dropped_rows``.
* **Duplicates** — impossible to double-count: rows are collapsed per day and the
  resolved source ranking excludes lower-precedence duplicates.

Nothing in this module writes to the database.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

import psycopg2
import psycopg2.extras

from .config import DatabaseConfig, load_database_config


@dataclass(frozen=True)
class Observation:
    """A single market-day observation for one (mandi, commodity) series."""

    price_date: _dt.date
    modal_price: float
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    arrivals_quantity: Optional[float] = None
    arrival_unit: Optional[str] = None
    source: str = ""
    is_sample_data: bool = False
    contributing_rows: int = 1


@dataclass
class PriceSeries:
    """Chronological observations for one (mandi, commodity) pair."""

    mandi_id: int
    commodity_id: int
    mandi_code: str = ""
    mandi_name: str = ""
    commodity_code: str = ""
    commodity_name: str = ""
    unit: str = "INR/quintal"
    observations: list[Observation] = field(default_factory=list)
    dropped_rows: int = 0

    # -- derived properties ------------------------------------------------
    @property
    def dates(self) -> list[_dt.date]:
        return [o.price_date for o in self.observations]

    @property
    def prices(self) -> list[float]:
        return [o.modal_price for o in self.observations]

    @property
    def arrivals(self) -> list[Optional[float]]:
        return [o.arrivals_quantity for o in self.observations]

    @property
    def size(self) -> int:
        return len(self.observations)

    @property
    def start_date(self) -> Optional[_dt.date]:
        return self.observations[0].price_date if self.observations else None

    @property
    def end_date(self) -> Optional[_dt.date]:
        return self.observations[-1].price_date if self.observations else None

    @property
    def is_sample_data(self) -> bool:
        """True when the series has no genuine observation at all."""
        return bool(self.observations) and all(o.is_sample_data for o in self.observations)

    @property
    def sources(self) -> list[str]:
        return sorted({o.source for o in self.observations})

    def summary(self) -> dict:
        return {
            "mandi_code": self.mandi_code,
            "commodity_code": self.commodity_code,
            "observations": self.size,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "sources": self.sources,
            "is_sample_data": self.is_sample_data,
            "dropped_rows": self.dropped_rows,
            "arrival_coverage": self.arrival_coverage(),
        }

    def gap_report(self) -> dict:
        """Calendar gaps between consecutive observations (holidays, missing days)."""
        gaps = [
            (self.observations[i].price_date - self.observations[i - 1].price_date).days
            for i in range(1, self.size)
        ]
        non_unit = [g for g in gaps if g != 1]
        return {
            "gaps": len(non_unit),
            "max_gap_days": max(gaps) if gaps else 0,
            "mean_gap_days": round(sum(gaps) / len(gaps), 3) if gaps else 0.0,
            "irregular": bool(non_unit),
        }

    def arrival_coverage(self) -> float:
        """Fraction of observations that genuinely carry an arrival quantity."""
        if not self.observations:
            return 0.0
        present = sum(1 for o in self.observations if o.arrivals_quantity is not None)
        return round(present / len(self.observations), 4)


def _aggregate_day(rows: Sequence[dict]) -> Optional[Observation]:
    """Collapses one market-day's rows into a single observation (or None)."""
    valid = [r for r in rows if r["modal_price"] is not None and float(r["modal_price"]) > 0]
    if not valid:
        return None
    prices = sorted(float(r["modal_price"]) for r in valid)
    mid = len(prices) // 2
    modal = prices[mid] if len(prices) % 2 else (prices[mid - 1] + prices[mid]) / 2

    def all_present(key: str) -> bool:
        return all(r[key] is not None for r in valid)

    min_price = min(float(r["min_price"]) for r in valid) if all_present("min_price") else None
    max_price = max(float(r["max_price"]) for r in valid) if all_present("max_price") else None

    arrivals = None
    arrival_unit = None
    if all_present("arrivals_quantity"):
        units = {r["arrival_unit"] for r in valid}
        if len(units) == 1:
            arrivals = float(sum(float(r["arrivals_quantity"]) for r in valid))
            arrival_unit = units.pop()

    # Highest precedence first: rank 1 is the row the resolved view would pick.
    chosen = valid[0]
    return Observation(
        price_date=chosen["price_date"],
        modal_price=round(modal, 4),
        min_price=min_price,
        max_price=max_price,
        arrivals_quantity=arrivals,
        arrival_unit=arrival_unit,
        source=chosen["source"],
        is_sample_data=any(bool(r["is_sample_data"]) for r in valid),
        contributing_rows=len(valid),
    )


_HISTORY_SQL = """
WITH ranked AS (
    SELECT p.mandi_id,
           p.commodity_id,
           p.price_date,
           p.modal_price,
           p.min_price,
           p.max_price,
           p.arrivals_quantity,
           p.arrival_unit,
           p.source,
           p.is_sample_data,
           COALESCE(s.precedence, 10) AS source_precedence,
           DENSE_RANK() OVER (
               PARTITION BY p.mandi_id, p.commodity_id, p.price_date
               ORDER BY COALESCE(s.precedence, 10) DESC, p.source
           ) AS source_rank
    FROM mandi_prices p
    LEFT JOIN mandi_sources s ON s.code = p.source
    WHERE p.mandi_id = %(mandi_id)s
      AND p.commodity_id = %(commodity_id)s
      AND (%(start_date)s::date IS NULL OR p.price_date >= %(start_date)s::date)
      AND (%(end_date)s::date IS NULL OR p.price_date <= %(end_date)s::date)
      AND (%(include_sample)s OR p.is_sample_data = FALSE)
)
SELECT mandi_id, commodity_id, price_date, modal_price, min_price, max_price,
       arrivals_quantity, arrival_unit, source, is_sample_data
FROM ranked
WHERE source_rank = 1
ORDER BY price_date ASC, source ASC
"""


class ForecastDataAccess:
    """Read-only access to the Phase 3 mandi price tables."""

    def __init__(self, config: DatabaseConfig | None = None, connection=None):
        self.config = config or load_database_config()
        self._connection = connection

    # -- connection handling ----------------------------------------------
    def _connect(self):
        if self._connection is not None:
            return self._connection
        kwargs = self.config.as_dsn_kwargs()
        if "dsn" in kwargs:
            return psycopg2.connect(kwargs["dsn"])
        return psycopg2.connect(**kwargs)

    def __enter__(self):
        self._owns = self._connection is None
        self._conn = self._connect()
        return self

    def __exit__(self, *exc):
        if getattr(self, "_owns", False) and self._conn is not None:
            self._conn.close()
        return False

    def cursor(self, **kwargs):
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor, **kwargs)

    # -- reference lookups -------------------------------------------------
    def resolve_mandi(self, reference: str | int) -> Optional[dict]:
        """Finds an active mandi by numeric id, or by code / exact name (case-insensitive)."""
        sql = """
            SELECT id, code, name, state, district
            FROM mandis
            WHERE is_active = TRUE
              AND (id::text = %(ref)s OR UPPER(code) = UPPER(%(ref)s) OR UPPER(name) = UPPER(%(ref)s))
            ORDER BY id
            LIMIT 1
        """
        with self.cursor() as cur:
            cur.execute(sql, {"ref": str(reference).strip()})
            return cur.fetchone()

    def resolve_commodity(self, reference: str | int) -> Optional[dict]:
        sql = """
            SELECT id, code, name, category, standard_unit
            FROM commodities
            WHERE is_active = TRUE
              AND (id::text = %(ref)s OR UPPER(code) = UPPER(%(ref)s) OR UPPER(name) = UPPER(%(ref)s))
            ORDER BY id
            LIMIT 1
        """
        with self.cursor() as cur:
            cur.execute(sql, {"ref": str(reference).strip()})
            return cur.fetchone()

    def list_series(self, *, min_observations: int = 0, include_sample: bool = True) -> list[dict]:
        """All (mandi, commodity) pairs that have any price history."""
        sql = """
            SELECT p.mandi_id, p.commodity_id,
                   m.code AS mandi_code, m.name AS mandi_name,
                   c.code AS commodity_code, c.name AS commodity_name,
                   COUNT(*) AS observations,
                   MIN(p.price_date) AS start_date,
                   MAX(p.price_date) AS end_date,
                   BOOL_AND(p.is_sample_data) AS only_sample
            FROM mandi_prices p
            JOIN mandis m ON m.id = p.mandi_id
            JOIN commodities c ON c.id = p.commodity_id
            WHERE (%(include_sample)s OR p.is_sample_data = FALSE)
            GROUP BY p.mandi_id, p.commodity_id, m.code, m.name, c.code, c.name
            HAVING COUNT(*) >= %(min_observations)s
            ORDER BY c.name, m.name
        """
        with self.cursor() as cur:
            cur.execute(sql, {"include_sample": include_sample, "min_observations": min_observations})
            return [dict(r) for r in cur.fetchall()]

    # -- history -----------------------------------------------------------
    def load_series(
        self,
        mandi_id: int,
        commodity_id: int,
        *,
        start_date: _dt.date | None = None,
        end_date: _dt.date | None = None,
        include_sample: bool = True,
    ) -> PriceSeries:
        """Chronological observations for one (mandi, commodity) pair."""
        params = {
            "mandi_id": mandi_id,
            "commodity_id": commodity_id,
            "start_date": start_date,
            "end_date": end_date,
            "include_sample": include_sample,
        }
        with self.cursor() as cur:
            cur.execute(_HISTORY_SQL, params)
            rows = [dict(r) for r in cur.fetchall()]
            meta = self._series_meta(cur, mandi_id, commodity_id)

        by_day: dict[_dt.date, list[dict]] = {}
        for row in rows:
            by_day.setdefault(row["price_date"], []).append(row)

        observations: list[Observation] = []
        dropped = 0
        for day in sorted(by_day):
            aggregate = _aggregate_day(by_day[day])
            if aggregate is None:
                dropped += len(by_day[day])
                continue
            observations.append(aggregate)

        series = PriceSeries(
            mandi_id=mandi_id,
            commodity_id=commodity_id,
            observations=observations,
            dropped_rows=dropped,
        )
        if meta:
            series.mandi_code = meta["mandi_code"]
            series.mandi_name = meta["mandi_name"]
            series.commodity_code = meta["commodity_code"]
            series.commodity_name = meta["commodity_name"]
            series.unit = meta["standard_unit"] or "INR/quintal"
        return series

    def _series_meta(self, cur, mandi_id: int, commodity_id: int) -> Optional[dict]:
        cur.execute(
            """
            SELECT m.code AS mandi_code, m.name AS mandi_name,
                   c.code AS commodity_code, c.name AS commodity_name,
                   c.standard_unit
            FROM mandis m, commodities c
            WHERE m.id = %(mandi_id)s AND c.id = %(commodity_id)s
            """,
            {"mandi_id": mandi_id, "commodity_id": commodity_id},
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def load_many_series(self, pairs: Iterable[tuple[int, int]], **kwargs) -> list[PriceSeries]:
        return [self.load_series(m, c, **kwargs) for m, c in pairs]

    # -- writes (forecast tables only) ------------------------------------
    def upsert_forecast_run(self, cur, run: dict) -> int:
        cur.execute(
            """
            INSERT INTO forecast_runs (
                model_version, commodity_id, mandi_id, training_data_end_date, history_start_date,
                observations_used, horizon_max, is_sample_data, data_source, metrics, generated_at
            ) VALUES (
                %(model_version)s, %(commodity_id)s, %(mandi_id)s, %(training_data_end_date)s,
                %(history_start_date)s, %(observations_used)s, %(horizon_max)s, %(is_sample_data)s,
                %(data_source)s, %(metrics)s, %(generated_at)s
            )
            RETURNING id
            """,
            run,
        )
        return int(cur.fetchone()["id"])

    def upsert_forecast(self, cur, row: dict) -> None:
        """Idempotent on (commodity, mandi, forecast_date, horizon, model_version)."""
        cur.execute(
            """
            INSERT INTO forecasts (
                run_id, commodity_id, mandi_id, forecast_date, horizon_days,
                predicted_price, lower_bound, upper_bound, interval_level, confidence, unit,
                model_version, training_data_end_date, last_observed_price, last_observed_date,
                is_sample_data, data_source, generated_at
            ) VALUES (
                %(run_id)s, %(commodity_id)s, %(mandi_id)s, %(forecast_date)s, %(horizon_days)s,
                %(predicted_price)s, %(lower_bound)s, %(upper_bound)s, %(interval_level)s,
                %(confidence)s, %(unit)s, %(model_version)s, %(training_data_end_date)s,
                %(last_observed_price)s, %(last_observed_date)s, %(is_sample_data)s,
                %(data_source)s, %(generated_at)s
            )
            ON CONFLICT (commodity_id, mandi_id, forecast_date, horizon_days, model_version)
            DO UPDATE SET
                run_id = EXCLUDED.run_id,
                predicted_price = EXCLUDED.predicted_price,
                lower_bound = EXCLUDED.lower_bound,
                upper_bound = EXCLUDED.upper_bound,
                interval_level = EXCLUDED.interval_level,
                confidence = EXCLUDED.confidence,
                training_data_end_date = EXCLUDED.training_data_end_date,
                last_observed_price = EXCLUDED.last_observed_price,
                last_observed_date = EXCLUDED.last_observed_date,
                is_sample_data = EXCLUDED.is_sample_data,
                data_source = EXCLUDED.data_source,
                generated_at = EXCLUDED.generated_at
            """,
            row,
        )


__all__ = [
    "ForecastDataAccess",
    "Observation",
    "PriceSeries",
]
