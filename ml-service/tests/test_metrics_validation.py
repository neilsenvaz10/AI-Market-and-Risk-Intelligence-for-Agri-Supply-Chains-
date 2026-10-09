"""Metrics and chronological validation tests."""

from __future__ import annotations

import math
import unittest

from tests import make_series, trending_prices

from forecasting import baselines, metrics, validation


class MetricTests(unittest.TestCase):
    def test_mae_and_rmse_on_a_known_example(self):
        actual = [100.0, 200.0, 300.0]
        predicted = [110.0, 180.0, 330.0]
        self.assertAlmostEqual(metrics.mae(actual, predicted), (10 + 20 + 30) / 3, places=9)
        expected_rmse = math.sqrt((100 + 400 + 900) / 3)
        self.assertAlmostEqual(metrics.rmse(actual, predicted), expected_rmse, places=9)

    def test_perfect_prediction_gives_zero_error(self):
        values = [100.0, 200.0, 300.0]
        self.assertEqual(metrics.mae(values, values), 0.0)
        self.assertEqual(metrics.rmse(values, values), 0.0)
        self.assertEqual(metrics.mape(values, values), 0.0)

    def test_mape_is_none_when_it_is_not_defined(self):
        self.assertIsNone(metrics.mape([0.0, 100.0], [10.0, 110.0]))
        self.assertIsNone(metrics.mape([-5.0, 100.0], [10.0, 110.0]))

    def test_smape_is_defined_for_small_values(self):
        value = metrics.smape([1.0, 100.0], [2.0, 110.0])
        self.assertIsNotNone(value)
        self.assertGreater(value, 0)

    def test_directional_accuracy_counts_matching_directions(self):
        actual = [100.0, 110.0, 105.0]
        predicted = [100.0, 120.0, 100.0]
        # step 1: both up -> hit; step 2: both down -> hit
        self.assertEqual(metrics.directional_accuracy(actual, predicted), 100.0)

    def test_directional_accuracy_ignores_flat_steps(self):
        actual = [100.0, 100.0, 110.0]
        predicted = [100.0, 105.0, 120.0]
        value = metrics.directional_accuracy(actual, predicted)
        self.assertIsNotNone(value)
        self.assertEqual(value, 100.0)

    def test_shape_mismatch_is_rejected(self):
        with self.assertRaises(ValueError):
            metrics.mae([1.0, 2.0], [1.0])

    def test_summarise_reports_bias_and_samples(self):
        summary = metrics.summarise("m", 1, [100.0, 200.0], [110.0, 190.0])
        self.assertEqual(summary.samples, 2)
        self.assertEqual(summary.model, "m")
        self.assertEqual(summary.horizon, 1)
        self.assertAlmostEqual(summary.bias, 0.0, places=9)

    def test_compare_models_picks_the_lower_mae(self):
        good = metrics.summarise("good", 1, [100.0, 200.0], [101.0, 201.0])
        bad = metrics.summarise("bad", 1, [100.0, 200.0], [130.0, 260.0])
        comparison = metrics.compare_models([good, bad])
        self.assertEqual(comparison["winners_by_horizon"][1], "good")


class BaselineTests(unittest.TestCase):
    def test_last_value_repeats_the_final_price(self):
        forecast = baselines.last_value_forecast([10.0, 20.0, 30.0], 7)
        self.assertEqual(forecast, [30.0] * 7)

    def test_moving_average_uses_only_the_window_it_is_given(self):
        history = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]  # mean 4.0
        forecast = baselines.moving_average_forecast(history, 3)
        self.assertEqual(forecast, [4.0] * 3)
        # A later observation must not influence a forecast made earlier: the
        # pipeline truncates history at each cutoff for exactly this reason.
        extended = history + [100.0]
        self.assertEqual(baselines.moving_average_forecast(extended, 2), [18.142857142857142] * 2)
        self.assertEqual(baselines.moving_average_forecast(history, 2), [4.0] * 2)

    def test_moving_average_needs_a_full_window(self):
        with self.assertRaises(ValueError):
            baselines.moving_average_forecast([1.0, 2.0], 2, window=7)

    def test_last_value_needs_one_observation(self):
        with self.assertRaises(ValueError):
            baselines.last_value_forecast([], 7)

    def test_baseline_forecasts_omit_impossible_baselines(self):
        forecasts = baselines.baseline_forecasts([1.0, 2.0, 3.0], 2)
        self.assertIn("last_value", forecasts)
        self.assertNotIn("moving_average_7", forecasts)


class ChronologicalSplitTests(unittest.TestCase):
    def test_split_sizes_are_contiguous_and_complete(self):
        split = validation.chronological_split(90)
        self.assertEqual(split.train_size + split.val_size + split.test_size, 90)
        self.assertEqual((split.train_size, split.val_size, split.test_size), (54, 18, 18))

    def test_rejects_too_few_observations(self):
        with self.assertRaises(ValueError):
            validation.chronological_split(2)

    def test_rejects_fractions_that_do_not_sum_to_one(self):
        with self.assertRaises(ValueError):
            validation.chronological_split(100, fractions=(0.5, 0.2, 0.2))

    def test_min_train_is_enforced(self):
        with self.assertRaises(ValueError):
            validation.chronological_split(30, fractions=(0.2, 0.4, 0.4), min_train=50)


class WalkForwardTests(unittest.TestCase):
    def test_cutoffs_are_increasing_and_bounded(self):
        series = make_series(trending_prices(80))
        cutoffs = validation.walk_forward_cutoffs(series, horizon=2, start_index=40, end_index=60)
        self.assertEqual(cutoffs, sorted(cutoffs))
        for cutoff in cutoffs:
            self.assertGreaterEqual(cutoff + 2 - 1, 40)
            self.assertLess(cutoff + 2 - 1, 60)

    def test_backtest_skips_when_training_history_is_insufficient(self):
        series = make_series(trending_prices(30))
        built = validation.build_series_features(series, horizons=(1,))
        result = validation.backtest(built, horizon=1, cutoffs=[0, 1, 2], model_name="ridge_autoregressive")
        self.assertEqual(result.samples, 0)
        self.assertGreater(result.skipped, 0)

    def test_backtest_stride_reduces_the_sample(self):
        series = make_series(trending_prices(150))
        built = validation.build_series_features(series, horizons=(1,))
        cutoffs = validation.walk_forward_cutoffs(series, horizon=1, start_index=100, end_index=140)
        full = validation.backtest(built, horizon=1, cutoffs=cutoffs, model_name="ridge_autoregressive")
        sampled = validation.backtest(
            built, horizon=1, cutoffs=cutoffs, model_name="ridge_autoregressive", stride=4
        )
        self.assertGreater(full.samples, sampled.samples)
        self.assertEqual(sampled.samples, len(cutoffs[::4]))

    def test_summarise_backtest_includes_the_naive_reference(self):
        series = make_series(trending_prices(150))
        built = validation.build_series_features(series, horizons=(1,))
        cutoffs = validation.walk_forward_cutoffs(series, horizon=1, start_index=100, end_index=140)
        result = validation.backtest(built, horizon=1, cutoffs=cutoffs, model_name="ridge_autoregressive")
        models = {summary.model for summary in validation.summarise_backtest(result, "ridge_autoregressive")}
        self.assertIn("ridge_autoregressive", models)
        self.assertIn("baseline_last_value", models)

    def test_select_model_ranks_candidates_and_reports_a_winner(self):
        series = make_series(trending_prices(160))
        built = validation.build_series_features(series, horizons=(1, 2))
        split = validation.chronological_split(series.size)
        selection = validation.select_model(
            built,
            candidate_names=["ridge_autoregressive", "gradient_boosting"],
            start_index=split.val_start,
            end_index=split.val_end,
            horizons=(1, 2),
        )
        self.assertIn(selection["selected"], {"ridge_autoregressive", "gradient_boosting"})
        self.assertTrue(selection["mae_by_horizon"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
