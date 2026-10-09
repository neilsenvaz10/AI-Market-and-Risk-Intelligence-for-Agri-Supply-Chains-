"""Database-backed tests for the Phase 4 historical data-access layer.

Opt-in and isolated: these run only when ``PHASE4_DB_TESTS=1`` and ``DB_NAME``
points at a disposable ``fasalytics_test_*`` database (created by ``npm run test:db``).
They insert their own synthetic rows and delete them again, so the development
database is never touched.
"""

from __future__ import annotations

import datetime as _dt
import os
import unittest

from tests import ML_SERVICE_DIR  # noqa: F401  (ensures the package path is set)

from forecasting.config import load_database_config
from forecasting.data import ForecastDataAccess

PREFIX = "PHASE4TEST"


def _db_tests_enabled() -> bool:
    return os.environ.get("PHASE4_DB_TESTS") == "1" and str(os.environ.get("DB_NAME", "")).startswith(
        "fasalytics_test_"
    )


@unittest.skipUnless(_db_tests_enabled(), "set PHASE4_DB_TESTS=1 inside a disposable test database")
class DataAccessDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.access = ForecastDataAccess(load_database_config())
        cls.access.__enter__()
        cls.conn = cls.access._conn

    @classmethod
    def tearDownClass(cls):
        with cls.access.cursor() as cur:
            cur.execute("DELETE FROM mandi_prices WHERE mandi_id IN (SELECT id FROM mandis WHERE code LIKE %s)", (f"{PREFIX}%",))
            cur.execute("DELETE FROM mandis WHERE code LIKE %s", (f"{PREFIX}%",))
            cur.execute("DELETE FROM commodities WHERE code LIKE %s", (f"{PREFIX}%",))
        cls.conn.commit()
        cls.access.__exit__(None, None, None)

    def setUp(self):
        # A test that deliberately triggers a constraint violation would otherwise
        # leave the connection in an aborted transaction.
        self.conn.rollback()
        with self.access.cursor() as cur:
            cur.execute(
                """INSERT INTO mandis (code, name, state, district, is_active)
                   VALUES (%s, %s, 'Maharashtra', 'Pune', TRUE)
                   ON CONFLICT (code) DO UPDATE SET is_active = TRUE RETURNING id""",
                (f"{PREFIX}_MANDI", "Phase4 Test Mandi"),
            )
            self.mandi_id = int(cur.fetchone()["id"])
            cur.execute(
                """INSERT INTO commodities (code, name, category, standard_unit, is_active)
                   VALUES (%s, %s, 'Vegetables', 'quintal', TRUE)
                   ON CONFLICT (code) DO UPDATE SET is_active = TRUE RETURNING id""",
                (f"{PREFIX}_CROP", "Phase4 Test Crop"),
            )
            self.commodity_id = int(cur.fetchone()["id"])
            cur.execute("DELETE FROM mandi_prices WHERE mandi_id = %s AND commodity_id = %s", (self.mandi_id, self.commodity_id))
        self.conn.commit()

    def _insert(self, rows, *, source="DATA_GOV_IN", sample=False):
        with self.access.cursor() as cur:
            for row in rows:
                cur.execute(
                    """INSERT INTO mandi_prices (
                         mandi_id, commodity_id, price_date, min_price, max_price, modal_price,
                         arrivals_quantity, arrival_unit, unit, source, is_sample_data, price_unit,
                         variety, grade, quality_flags
                       ) VALUES (%s, %s, %s::date, %s, %s, %s, %s, %s, 'quintal', %s, %s, 'INR/quintal',
                                 %s, %s, '{}')
                       ON CONFLICT ON CONSTRAINT uq_mandi_prices_observation DO NOTHING""",
                    (
                        self.mandi_id, self.commodity_id, row["date"], row.get("min"), row.get("max"),
                        row["modal"], row.get("arrivals"), "tonne" if row.get("arrivals") is not None else None,
                        source, sample, row.get("variety"), row.get("grade"),
                    ),
                )
        self.conn.commit()

    def _series(self, **kwargs):
        return self.access.load_series(self.mandi_id, self.commodity_id, **kwargs)

    def test_chronological_observations_are_returned_in_order(self):
        self._insert([
            {"date": "2026-05-03", "modal": 1030},
            {"date": "2026-05-01", "modal": 1010},
            {"date": "2026-05-02", "modal": 1020},
        ])
        series = self._series()
        self.assertEqual(series.dates, [_dt.date(2026, 5, 1), _dt.date(2026, 5, 2), _dt.date(2026, 5, 3)])
        self.assertEqual(series.prices, [1010.0, 1020.0, 1030.0])

    def test_date_range_filtering(self):
        self._insert([{"date": f"2026-06-{day:02d}", "modal": 1000 + day} for day in range(1, 11)])
        series = self._series(start_date=_dt.date(2026, 6, 3), end_date=_dt.date(2026, 6, 6))
        self.assertEqual(series.size, 4)
        self.assertEqual(series.start_date, _dt.date(2026, 6, 3))
        self.assertEqual(series.end_date, _dt.date(2026, 6, 6))

    def test_invalid_prices_are_dropped_and_never_zeroed(self):
        """The Phase 3 schema already refuses non-positive modal prices, so no such
        row can exist in the database. The data layer must still be defensive: the
        aggregation helper drops an invalid price instead of turning it into 0.
        """
        from forecasting.data import _aggregate_day

        rows = [
            {"price_date": _dt.date(2026, 7, 1), "modal_price": 1500, "min_price": 1400,
             "max_price": 1600, "arrivals_quantity": None, "arrival_unit": None,
             "source": "DATA_GOV_IN", "is_sample_data": False},
            {"price_date": _dt.date(2026, 7, 2), "modal_price": 0, "min_price": None,
             "max_price": None, "arrivals_quantity": None, "arrival_unit": None,
             "source": "DATA_GOV_IN", "is_sample_data": False},
            {"price_date": _dt.date(2026, 7, 3), "modal_price": -20, "min_price": None,
             "max_price": None, "arrivals_quantity": None, "arrival_unit": None,
             "source": "DATA_GOV_IN", "is_sample_data": False},
        ]
        self.assertIsNotNone(_aggregate_day([rows[0]]))
        self.assertIsNone(_aggregate_day([rows[1]]), "a zero price must never become an observation")
        self.assertIsNone(_aggregate_day([rows[2]]), "a negative price must never become an observation")

        # And end to end: a stored valid row survives, and the series never contains 0.
        self._insert([{"date": "2026-07-01", "modal": 1500}])
        series = self._series()
        self.assertEqual(series.prices, [1500.0])
        self.assertNotIn(0, series.prices)

    def test_non_positive_modal_price_is_rejected_by_the_database(self):
        """Documents that zero/negative prices cannot even be stored (defence in depth)."""
        for bad in (0, -20):
            with self.assertRaises(Exception):
                self._insert([{"date": "2026-07-04", "modal": bad}])

    def test_missing_min_max_and_arrivals_stay_null(self):
        self._insert([{"date": "2026-07-05", "modal": 1600}])
        series = self._series()
        observation = series.observations[0]
        self.assertIsNone(observation.min_price)
        self.assertIsNone(observation.max_price)
        self.assertIsNone(observation.arrivals_quantity)
        self.assertEqual(series.arrival_coverage(), 0.0)

    def test_multiple_varieties_on_one_day_collapse_to_the_median(self):
        self._insert([
            {"date": "2026-07-06", "modal": 1000, "variety": "A"},
            {"date": "2026-07-06", "modal": 1100, "variety": "B"},
            {"date": "2026-07-06", "modal": 900, "variety": "C"},
        ])
        series = self._series()
        self.assertEqual(series.size, 1)
        self.assertEqual(series.prices, [1000.0])  # median of 900/1000/1100
        self.assertEqual(series.observations[0].contributing_rows, 3)

    def test_higher_precedence_source_wins_on_the_same_day(self):
        self._insert([{"date": "2026-07-07", "modal": 2000, "variety": "A"}], source="MOCK_PROVIDER", sample=True)
        self._insert([{"date": "2026-07-07", "modal": 1500, "variety": "B"}], source="DATA_GOV_IN", sample=False)
        series = self._series()
        self.assertEqual(series.size, 1)
        self.assertEqual(series.prices, [1500.0])  # DATA_GOV_IN precedence 40 > MOCK 0

    def test_sample_series_is_flagged(self):
        self._insert([{"date": "2026-07-08", "modal": 1200}], source="MOCK_PROVIDER", sample=True)
        series = self._series()
        self.assertTrue(series.is_sample_data)

    def test_include_sample_false_excludes_synthetic_rows(self):
        self._insert([{"date": "2026-07-09", "modal": 1200}], source="MOCK_PROVIDER", sample=True)
        series = self._series(include_sample=False)
        self.assertEqual(series.size, 0)

    def test_irregular_dates_are_reported_as_gaps(self):
        self._insert([
            {"date": "2026-08-01", "modal": 1000},
            {"date": "2026-08-05", "modal": 1010},
            {"date": "2026-08-06", "modal": 1020},
        ])
        report = self._series().gap_report()
        self.assertTrue(report["irregular"])
        self.assertEqual(report["max_gap_days"], 4)

    def test_arrivals_are_aggregated_only_when_all_rows_report_them(self):
        self._insert([
            {"date": "2026-08-10", "modal": 1000, "arrivals": 10.0, "variety": "A"},
            {"date": "2026-08-10", "modal": 1000, "arrivals": 5.0, "variety": "B"},
            {"date": "2026-08-11", "modal": 1010, "arrivals": 7.0, "variety": "A"},
        ])
        series = self._series()
        by_date = {o.price_date: o for o in series.observations}
        self.assertEqual(by_date[_dt.date(2026, 8, 10)].arrivals_quantity, 15.0)
        self.assertEqual(by_date[_dt.date(2026, 8, 11)].arrivals_quantity, 7.0)

    def test_resolve_mandi_and_commodity_accept_code_name_and_id(self):
        self.assertIsNotNone(self.access.resolve_mandi(f"{PREFIX}_MANDI"))
        self.assertIsNotNone(self.access.resolve_mandi("phase4 test mandi"))
        self.assertIsNotNone(self.access.resolve_mandi(self.mandi_id))
        self.assertIsNone(self.access.resolve_mandi("NO_SUCH_MANDI"))
        self.assertIsNotNone(self.access.resolve_commodity(f"{PREFIX}_CROP"))
        self.assertIsNone(self.access.resolve_commodity("NO_SUCH_CROP"))

    def test_list_series_reports_history_length(self):
        self._insert([{"date": f"2026-09-{day:02d}", "modal": 1000 + day} for day in range(1, 6)])
        entries = self.access.list_series(min_observations=1)
        match = [e for e in entries if int(e["mandi_id"]) == self.mandi_id and int(e["commodity_id"]) == self.commodity_id]
        self.assertEqual(len(match), 1)
        self.assertEqual(int(match[0]["observations"]), 5)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
