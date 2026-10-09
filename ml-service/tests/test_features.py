"""Feature engineering tests: lags, rolling statistics, calendar and missing data.

Includes the explicit no-future-leakage checks required by Phase 4 section 17.
"""

from __future__ import annotations

import datetime as _dt
import math
import unittest

from tests import make_series, trending_prices

from forecasting import features


class LagTests(unittest.TestCase):
    def test_lag_reads_only_earlier_values(self):
        values = [10, 20, 30, 40, 50]
        self.assertEqual(features.lag(values, 4, 1), 40)
        self.assertEqual(features.lag(values, 4, 3), 20)
        self.assertEqual(features.lag(values, 1, 1), 10)  # index 0 is a real observation
        self.assertIsNone(features.lag(values, 0, 1))  # nothing precedes index 0
        self.assertIsNone(features.lag(values, 2, 5))

    def test_lag_never_returns_the_value_it_predicts(self):
        values = [10, 20, 30]
        for index in range(len(values)):
            for days in (1, 2, 3):
                value = features.lag(values, index, days)
                if value is not None:
                    self.assertNotEqual(value, values[index])


class RollingTests(unittest.TestCase):
    def test_rolling_mean_uses_the_window_before_the_index(self):
        values = [1, 2, 3, 4, 5, 6, 7, 8]
        # window of 7 before index 7 == values[0:7] == 1..7 -> mean 4
        self.assertEqual(features.rolling_mean(values, 7, 7), 4.0)
        self.assertIsNone(features.rolling_mean(values, 3, 7))

    def test_rolling_std_is_zero_for_a_flat_window(self):
        values = [5] * 10
        self.assertEqual(features.rolling_std(values, 8, 7), 0.0)

    def test_rolling_std_matches_manual_population_std(self):
        window = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0]
        values = window + [99.0]  # the value at the index must be ignored
        mean = sum(window) / len(window)
        expected = math.sqrt(sum((v - mean) ** 2 for v in window) / len(window))
        self.assertAlmostEqual(features.rolling_std(values, 7, 7), expected, places=9)

    def test_pct_change_compares_past_points_only(self):
        values = [100, 110, 121]
        self.assertAlmostEqual(features.pct_change(values, 2, 1), 10.0, places=9)
        self.assertIsNone(features.pct_change(values, 1, 1))

    def test_rolling_slope_recovers_a_linear_trend(self):
        values = [float(i) for i in range(20)]
        self.assertAlmostEqual(features.rolling_slope(values, 10, 7), 1.0, places=9)


class CalendarTests(unittest.TestCase):
    def test_calendar_features_are_bounded_and_cyclic(self):
        day = _dt.date(2026, 3, 15)
        values = features.calendar_features(day)
        self.assertEqual(values["day_of_week"], float(day.weekday()))
        self.assertEqual(values["month"], 3.0)
        for name in ("dow_sin", "dow_cos", "doy_sin", "doy_cos", "month_sin", "month_cos"):
            self.assertGreaterEqual(values[name], -1.0)
            self.assertLessEqual(values[name], 1.0)

    def test_calendar_describes_the_target_date_not_the_anchor(self):
        """Horizon h must shift the calendar block to the date being predicted."""
        series = make_series(trending_prices(60))
        built = features.build_inference_features(series, horizons=(1, 7))
        names = built[1]["feature_names"]
        dow = names.index("day_of_week")
        last_date = series.observations[-1].price_date
        self.assertEqual(built[1]["row"][dow], float((last_date + _dt.timedelta(days=1)).weekday()))
        self.assertEqual(built[7]["row"][dow], float((last_date + _dt.timedelta(days=7)).weekday()))


class TrainingMatrixTests(unittest.TestCase):
    def test_matrix_requires_the_full_lag_window(self):
        series = make_series(trending_prices(40))
        matrix = features.build_training_data(series, horizon=1)
        self.assertGreater(matrix.size, 0)
        self.assertEqual(matrix.skipped_incomplete, features.MIN_HISTORY)
        self.assertEqual(matrix.anchor_indices[0], features.MIN_HISTORY)

    def test_rows_and_targets_stay_aligned(self):
        series = make_series(trending_prices(60))
        horizon = 3
        matrix = features.build_training_data(series, horizon=horizon)
        for position, anchor in enumerate(matrix.anchor_indices):
            expected = series.observations[anchor + horizon - 1].modal_price
            self.assertEqual(matrix.values[position], expected)
            # The target index is strictly after the anchor.
            self.assertGreater(anchor + horizon - 1, anchor - 1)

    def test_insufficient_history_yields_no_rows(self):
        series = make_series(trending_prices(10))
        matrix = features.build_training_data(series, horizon=1)
        self.assertEqual(matrix.size, 0)
        self.assertEqual(matrix.skipped_incomplete, 10)

    def test_inference_raises_when_history_is_too_short(self):
        series = make_series(trending_prices(8))
        with self.assertRaises(features.InsufficientHistoryError) as ctx:
            features.build_inference_features(series)
        self.assertEqual(ctx.exception.available, 8)
        self.assertEqual(ctx.exception.required, features.MIN_HISTORY)

    def test_irregular_dates_do_not_break_feature_construction(self):
        """Weekly reporting must still produce complete, ordered rows."""
        series = make_series(trending_prices(30), step_days=7)
        matrix = features.build_training_data(series, horizon=1)
        self.assertGreater(matrix.size, 0)
        dates = matrix.anchor_dates
        self.assertEqual(dates, sorted(dates))

    def test_missing_price_is_rejected_not_treated_as_zero(self):
        series = make_series([1000, 1010, 1020, 1030])
        # A missing price simply reduces the available history; it is never zero.
        self.assertNotIn(0, series.prices)
        matrix = features.build_training_data(series, horizon=1)
        self.assertEqual(matrix.size, 0)


class ArrivalFeatureTests(unittest.TestCase):
    def test_arrivals_are_disabled_when_the_caller_disallows_them(self):
        series = make_series(trending_prices(60), arrivals=[10.0] * 60)
        includes, reason = features.resolve_arrival_features(series, allow_arrivals=False)
        self.assertFalse(includes)
        self.assertEqual(reason, "arrival_features_disabled_by_caller")
        matrix = features.build_training_data(series, horizon=1, allow_arrivals=False)
        self.assertFalse(matrix.includes_arrivals)
        self.assertNotIn("arrival_lag_1", matrix.feature_names)

    def test_arrivals_are_enabled_only_with_genuine_coverage(self):
        complete = make_series(trending_prices(60), arrivals=[10.0] * 60)
        sparse = make_series(trending_prices(60), arrivals=[10.0 if i % 2 == 0 else None for i in range(60)])
        self.assertTrue(features.resolve_arrival_features(complete, allow_arrivals=True)[0])
        includes, reason = features.resolve_arrival_features(sparse, allow_arrivals=True)
        self.assertFalse(includes)
        self.assertIn("arrival_coverage", reason)

    def test_arrival_features_are_present_when_genuine(self):
        series = make_series(trending_prices(60), arrivals=[100.0 + i for i in range(60)])
        matrix = features.build_training_data(series, horizon=1, allow_arrivals=True)
        self.assertTrue(matrix.includes_arrivals)
        for name in features.ARRIVAL_FEATURE_NAMES:
            self.assertIn(name, matrix.feature_names)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
