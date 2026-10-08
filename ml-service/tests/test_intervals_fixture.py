"""Prediction interval, confidence and fixture determinism tests."""

from __future__ import annotations

import unittest

from forecasting import fixture, intervals


class IntervalTests(unittest.TestCase):
    def test_calibrated_from_enough_residuals(self):
        model = intervals.fit_intervals({1: [0.02, -0.01, 0.03, -0.02, 0.01, 0.0, 0.04, -0.03]})
        self.assertTrue(model.calibrated)
        self.assertEqual(model.basis, "walk_forward_residuals")
        self.assertIn(1, model.quantiles)
        self.assertGreaterEqual(model.counts[1], intervals.MIN_RESIDUALS)

    def test_too_few_residuals_stays_uncalibrated(self):
        model = intervals.fit_intervals({1: [0.01, 0.02]})
        self.assertFalse(model.calibrated)
        self.assertEqual(model.basis, "development_fallback")

    def test_bounds_are_positive_and_ordered(self):
        model = intervals.fit_intervals({1: [0.05, -0.04, 0.06, -0.05, 0.03, -0.02, 0.01]})
        lower, upper = model.bounds(1234.56, 1)
        self.assertGreater(lower, 0)
        self.assertGreater(upper, lower)
        self.assertLessEqual(lower, 1234.56)
        self.assertGreaterEqual(upper, 1234.56)

    def test_uncalibrated_horizon_inherits_the_widest_calibrated_band(self):
        residuals = {1: [0.01, -0.01, 0.02, -0.02, 0.015, -0.015], 2: [0.10, -0.09, 0.11, -0.08, 0.05, -0.05]}
        model = intervals.fit_intervals(residuals)
        band_low, band_high = model.band(7)  # 7 has no residuals of its own
        self.assertEqual((band_low, band_high), model.quantiles[2])

    def test_confidence_is_bounded_and_falls_with_wider_intervals(self):
        model = intervals.fit_intervals({1: [0.01, -0.01, 0.02, -0.02, 0.015, -0.015, 0.005]})
        narrow = model.confidence(1000.0, 995.0, 1005.0, 1)
        wide = model.confidence(1000.0, 700.0, 1300.0, 1)
        self.assertGreater(narrow, wide)
        self.assertLessEqual(narrow, intervals.MAX_CONFIDENCE)
        self.assertGreaterEqual(wide, 0.0)

    def test_development_fallback_confidence_is_capped(self):
        model = intervals.IntervalModel()
        self.assertFalse(model.calibrated)
        value = model.confidence(1000.0, 999.0, 1001.0, 1)
        self.assertLessEqual(value, intervals.DEVELOPMENT_MAX_CONFIDENCE)

    def test_confidence_decreases_with_horizon(self):
        model = intervals.fit_intervals({h: [0.01, -0.01, 0.02, -0.02, 0.015, -0.015] for h in range(1, 8)})
        lower, upper = model.bounds(1000.0, 1)
        near = model.confidence(1000.0, lower, upper, 1)
        far = model.confidence(1000.0, lower, upper, 7)
        self.assertGreater(near, far)

    def test_round_trips_through_dict(self):
        model = intervals.fit_intervals({1: [0.01, -0.01, 0.02, -0.02, 0.015, -0.015]})
        restored = intervals.IntervalModel.from_dict(model.to_dict())
        self.assertEqual(restored.basis, model.basis)
        self.assertEqual(restored.bounds(1000.0, 1), model.bounds(1000.0, 1))

    def test_coverage_measures_inside_fraction(self):
        result = intervals.coverage([100.0, 200.0, 300.0], [100.0, 200.0, 300.0], [(90.0, 110.0), (150.0, 250.0), (250.0, 350.0)])
        self.assertEqual(result["coverage"], 1.0)
        self.assertEqual(result["samples"], 3)

    def test_invalid_level_is_rejected(self):
        with self.assertRaises(ValueError):
            intervals.fit_intervals({1: [0.1] * 10}, level=1.5)


class FixtureTests(unittest.TestCase):
    def test_fixture_is_deterministic(self):
        first = fixture.generate_series(fixture.FIXTURE_SERIES[0])
        second = fixture.generate_series(fixture.FIXTURE_SERIES[0])
        self.assertEqual(first.prices, second.prices)
        self.assertEqual(first.dates, second.dates)

    def test_fixture_is_deterministic_across_processes(self):
        """sha256-based noise must not depend on PYTHONHASHSEED (unlike hash())."""
        item = fixture.FIXTURE_SERIES[0]
        a = fixture._stable_noise(fixture.FIXTURE_SEED, item.mandi_code, item.commodity_code, 3)
        b = fixture._stable_noise(fixture.FIXTURE_SEED, item.mandi_code, item.commodity_code, 3)
        self.assertEqual(a, b)

    def test_fixture_is_flagged_as_sample_data(self):
        series = fixture.generate_series(fixture.FIXTURE_SERIES[0])
        self.assertTrue(series.is_sample_data)
        self.assertTrue(all(o.is_sample_data for o in series.observations))
        self.assertTrue(all(o.source == fixture.FIXTURE_SOURCE for o in series.observations))

    def test_fixture_prices_are_positive(self):
        series = fixture.generate_series(fixture.FIXTURE_SERIES[0])
        self.assertTrue(all(p > 0 for p in series.prices))

    def test_fixture_has_weekly_seasonality(self):
        series = fixture.generate_series(fixture.FIXTURE_SERIES[0])
        weekday_means = {}
        for observation in series.observations:
            weekday_means.setdefault(observation.price_date.weekday(), []).append(observation.modal_price)
        averages = {day: sum(values) / len(values) for day, values in weekday_means.items()}
        self.assertEqual(len(averages), 7)
        self.assertGreater(max(averages.values()) - min(averages.values()), 1.0)

    def test_fixture_arrivals_are_partially_present_but_never_invented(self):
        series = fixture.generate_series(fixture.FIXTURE_SERIES[0])
        coverage = series.arrival_coverage()
        self.assertGreater(coverage, 0.0)
        self.assertLess(coverage, 1.0)  # exercises the "arrivals unavailable" path
        for observation in series.observations:
            if observation.arrivals_quantity is None:
                self.assertIsNone(observation.arrival_unit)
            else:
                self.assertGreater(observation.arrivals_quantity, 0)

    def test_generate_all_covers_every_declared_series(self):
        generated = fixture.generate_all()
        self.assertEqual(len(generated), len(fixture.FIXTURE_SERIES))
        for key, series in generated.items():
            self.assertGreater(series.size, 100)
            self.assertIsNotNone(series.start_date)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
