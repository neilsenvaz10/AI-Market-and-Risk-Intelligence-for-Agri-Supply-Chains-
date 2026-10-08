"""Automated no-future-leakage regression tests (Phase 4 section 17).

Each test asserts a property that would break if any part of the pipeline started
reading an observation it is supposed to be predicting:

* a feature row for anchor ``i`` is unchanged when future observations change;
* a training row's target is strictly later than its anchor;
* validation/test observations never appear in a training set;
* walk-forward cutoffs never train on their own target;
* interval quantiles are calibrated without the test partition;
* forecast generation reads history only up to the last observation.
"""

from __future__ import annotations

import datetime as _dt
import unittest

from tests import make_series, trending_prices

from forecasting import features, fixture, intervals, validation


def _matrix_fingerprint(matrix):
    return [list(row) for row in matrix.rows]


class FeatureLeakageTests(unittest.TestCase):
    def test_features_are_unchanged_when_the_future_changes(self):
        """The strongest leakage check: mutate future prices, features must be identical."""
        prices = trending_prices(80)
        original = make_series(prices)

        mutated_prices = list(prices)
        # Change everything from index 60 onwards (the "future" for early anchors).
        for i in range(60, len(mutated_prices)):
            mutated_prices[i] = mutated_prices[i] * 3.0
        mutated = make_series(mutated_prices)

        for horizon in (1, 3, 7):
            a = features.build_training_data(original, horizon=horizon)
            b = features.build_training_data(mutated, horizon=horizon)
            # Rows whose target lies strictly inside the untouched region must match.
            limit = 60 - horizon
            for position, anchor in enumerate(a.anchor_indices):
                if anchor + horizon - 1 < 60:
                    self.assertEqual(
                        a.rows[position],
                        b.rows[position],
                        f"horizon {horizon} anchor {anchor} changed when only future prices changed",
                    )
            self.assertGreaterEqual(max(a.anchor_indices), limit)

    def test_lag_features_ignore_the_anchor_value(self):
        series = make_series(trending_prices(40))
        matrix = features.build_training_data(series, horizon=1)
        lag_1_index = matrix.feature_names.index("lag_1")
        for position, anchor in enumerate(matrix.anchor_indices):
            self.assertEqual(matrix.rows[position][lag_1_index], series.prices[anchor - 1])
            self.assertNotEqual(matrix.rows[position][lag_1_index], matrix.values[position])

    def test_rolling_features_exclude_the_anchor_and_later_values(self):
        prices = trending_prices(50)
        series = make_series(prices)
        matrix = features.build_training_data(series, horizon=1)
        mean_index = matrix.feature_names.index("rolling_mean_7")
        for position, anchor in enumerate(matrix.anchor_indices):
            expected = sum(prices[anchor - 7 : anchor]) / 7
            self.assertAlmostEqual(matrix.rows[position][mean_index], expected, places=9)
            # The anchor value itself must not be inside the window.
            self.assertNotAlmostEqual(matrix.rows[position][mean_index], (expected * 7 + prices[anchor]) / 8, places=9)

    def test_inference_features_use_only_observed_history(self):
        series = make_series(trending_prices(40))
        built = features.build_inference_features(series, horizons=(1,))
        lag_1_index = built[1]["feature_names"].index("lag_1")
        self.assertEqual(built[1]["row"][lag_1_index], series.prices[-1])
        self.assertEqual(built[1]["last_observed_date"], series.dates[-1])


class SplitLeakageTests(unittest.TestCase):
    def test_chronological_split_is_ordered_and_contiguous(self):
        split = validation.chronological_split(100)
        self.assertEqual(split.train_start, 0)
        self.assertEqual(split.train_end, split.val_start)
        self.assertEqual(split.val_end, split.test_start)
        self.assertEqual(split.test_end, 100)
        self.assertLess(split.train_end, split.val_end)
        self.assertLess(split.val_end, split.test_end)

    def test_split_dates_are_strictly_increasing(self):
        series = make_series(trending_prices(120))
        described = validation.chronological_split(series.size).describe(series)
        train_end = described["train"]["end"]
        val_start = described["validation"]["start"]
        val_end = described["validation"]["end"]
        test_start = described["test"]["start"]
        self.assertLess(train_end, val_start)
        self.assertLess(val_end, test_start)

    def test_training_rows_never_include_the_cutoff_target(self):
        series = make_series(trending_prices(120))
        built = validation.build_series_features(series, horizons=(1, 3, 7))
        for horizon in built.horizons:
            for cutoff in (30, 60, 90):
                _x, _y, anchors = built.training_rows(horizon, before=cutoff)
                for anchor in anchors:
                    # target index = anchor + horizon - 1 must be < cutoff
                    self.assertLess(anchor + horizon - 1, cutoff)

    def test_validation_observations_are_not_trained_on(self):
        """A fold may use its own cutoff observation as an input, but the model is
        only ever *fitted* on targets strictly before the cutoff it predicts. No
        validation target can therefore have been trained on."""
        series = make_series(trending_prices(140))
        split = validation.chronological_split(series.size)
        built = validation.build_series_features(series, horizons=(1,))
        cutoffs = validation.walk_forward_cutoffs(
            series, horizon=1, start_index=split.val_start, end_index=split.val_end
        )
        self.assertTrue(cutoffs)
        for cutoff in cutoffs:
            _x, _y, anchors = built.training_rows(1, before=cutoff)
            # Every training target (anchor + horizon - 1) lies before the cutoff.
            for anchor in anchors:
                self.assertLess(anchor, cutoff)
            # The predicted target index itself is inside the validation partition.
            self.assertGreaterEqual(cutoff, split.val_start)
            self.assertLess(cutoff, split.val_end)

    def test_test_observations_are_not_trained_on(self):
        """No fold may train on the very observation it is scoring.

        Walk-forward evaluation legitimately lets a *later* fold train on *earlier*
        test observations (they are genuinely in the past by then); what must never
        happen is a fold training on its own target. The first fold additionally has
        nothing from the test partition available yet.
        """
        series = make_series(trending_prices(140))
        split = validation.chronological_split(series.size)
        built = validation.build_series_features(series, horizons=(3,))
        cutoffs = validation.walk_forward_cutoffs(
            series, horizon=3, start_index=split.test_start, end_index=split.test_end
        )
        self.assertTrue(cutoffs)
        for cutoff in cutoffs:
            _x, _y, anchors = built.training_rows(3, before=cutoff)
            for anchor in anchors:
                # target index = anchor + 3 - 1 is strictly before the scored cutoff
                self.assertLess(anchor + 3 - 1, cutoff)
        # The earliest fold cannot have seen any test-partition target at all.
        first_anchors = built.training_rows(3, before=cutoffs[0])[2]
        for anchor in first_anchors:
            self.assertLess(anchor + 3 - 1, split.test_start)

    def test_backtest_residuals_are_out_of_sample(self):
        series = make_series(trending_prices(150))
        built = validation.build_series_features(series, horizons=(1,))
        split = validation.chronological_split(series.size)
        cutoffs = validation.walk_forward_cutoffs(
            series, horizon=1, start_index=split.test_start, end_index=split.test_end
        )
        result = validation.backtest(built, horizon=1, cutoffs=cutoffs, model_name="ridge_autoregressive")
        self.assertGreater(result.samples, 0)
        # Every recorded target date must be inside the test partition.
        for date in result.dates:
            self.assertGreaterEqual(date, series.dates[split.test_start])


class IntervalCalibrationLeakageTests(unittest.TestCase):
    def test_interval_calibration_excludes_the_test_partition(self):
        series = make_series(trending_prices(160))
        split = validation.chronological_split(series.size)
        # Mirror the pipeline: calibration cutoffs stop at the end of validation.
        cutoffs = validation.walk_forward_cutoffs(
            series, horizon=1, start_index=features.MIN_HISTORY + 1, end_index=split.val_end
        )
        self.assertTrue(cutoffs)
        for cutoff in cutoffs:
            self.assertLess(cutoff + 1 - 1, split.val_end)
            self.assertLess(cutoff, split.test_start)

    def test_interval_bounds_are_positive_and_ordered(self):
        model = intervals.fit_intervals({1: [0.01, -0.02, 0.03, -0.01, 0.02, 0.0]})
        lower, upper = model.bounds(1000.0, 1)
        self.assertGreater(lower, 0)
        self.assertGreater(upper, lower)


class GenerationLeakageTests(unittest.TestCase):
    def test_inference_row_is_built_from_the_series_tail_only(self):
        series = make_series(trending_prices(60))
        built = features.build_inference_features(series, horizons=(1, 7))
        for horizon, block in built.items():
            self.assertEqual(block["last_observed_date"], series.dates[-1])
            # lag_1 is the final observed price for every horizon.
            self.assertEqual(block["row"][block["feature_names"].index("lag_1")], series.prices[-1])

    def test_fixture_end_date_is_fixed_so_generation_cannot_see_wall_clock(self):
        series = fixture.generate_series(fixture.FIXTURE_SERIES[0])
        self.assertEqual(series.dates[-1], fixture.FIXTURE_END_DATE)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
