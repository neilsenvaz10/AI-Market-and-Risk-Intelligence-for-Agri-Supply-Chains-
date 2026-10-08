"""Artefact persistence and end-to-end pipeline tests (no database required).

These cover the training/generation contract: deterministic training, the shape of
the forecast rows, 1-day and 7-day forecasts, uncertainty bounds, confidence and
model versioning.
"""

from __future__ import annotations

import datetime as _dt
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from tests import make_series, trending_prices

from forecasting import features, persist
from forecasting.pipeline import (
    InsufficientHistoryError,
    default_model_version,
    train_series,
)

TRAIN_ROWS = 140


class PersistTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="phase4-artifacts-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _train(self):
        series = make_series(trending_prices(TRAIN_ROWS))
        artifact, models, report = train_series(
            series,
            model_version="test-v1",
            artifact_root=self.root,
            candidates=("ridge_autoregressive",),
        )
        return series, artifact, models, report

    def test_artifact_is_written_and_reloadable(self):
        series, artifact, models, _report = self._train()
        path = persist.artifact_path(series.mandi_code, series.commodity_code, "test-v1", root=self.root)
        self.assertTrue(path.exists())
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(payload["model_version"], "test-v1")
        self.assertEqual(payload["training_data_end_date"], series.end_date.isoformat())
        self.assertEqual(payload["features"]["count"], len(artifact.feature_names))
        restored = persist.load_models(payload, root=self.root)
        self.assertEqual(restored.horizons(), models.horizons())

    def test_round_trip_predictions_match(self):
        series, _artifact, models, _report = self._train()
        payload = persist.load_artifact(series.mandi_code, series.commodity_code, "test-v1", root=self.root)
        restored = persist.load_models(payload, root=self.root)
        built = features.build_inference_features(series, horizons=restored.horizons())
        for horizon in restored.horizons():
            row = built[horizon]["row"]
            self.assertAlmostEqual(
                restored.models[horizon].predict_price(row),
                models.models[horizon].predict_price(row),
                places=6,
            )

    def test_missing_artifact_raises_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            persist.load_artifact("NOPE", "NOPE", "test-v1", root=self.root)

    def test_build_forecast_rows_shape_and_constraints(self):
        _series, artifact, _models, _report = self._train()
        interval = persist.load_interval({"interval": artifact.interval})
        rows = persist.build_forecast_rows(
            artifact=artifact,
            interval=interval,
            predictions={1: 1000.0, 7: 1100.0},
            last_observed_price=980.0,
            last_observed_date=_dt.date(2026, 9, 30),
            generated_at=_dt.datetime(2026, 10, 1, tzinfo=_dt.timezone.utc),
        )
        self.assertEqual(len(rows), 2)
        first, last = rows
        self.assertEqual(first["horizon_days"], 1)
        self.assertEqual(first["forecast_date"], _dt.date(2026, 10, 1))
        self.assertEqual(last["horizon_days"], 7)
        self.assertEqual(last["forecast_date"], _dt.date(2026, 10, 7))
        for row in rows:
            self.assertGreater(row["predicted_price"], 0)
            self.assertGreater(row["lower_bound"], 0)
            self.assertLessEqual(row["lower_bound"], row["predicted_price"])
            self.assertLessEqual(row["predicted_price"], row["upper_bound"])
            self.assertGreaterEqual(row["confidence"], 0)
            self.assertLessEqual(row["confidence"], 100)
            self.assertEqual(row["model_version"], "test-v1")
            self.assertEqual(row["training_data_end_date"], _series.end_date.isoformat())
            self.assertEqual(row["unit"], "INR/quintal")

    def test_staleness_is_measured_against_the_training_end(self):
        _series, artifact, _models, _report = self._train()
        trained_end = _dt.date.fromisoformat(artifact.training_data_end_date)
        self.assertEqual(persist.staleness_days(artifact, trained_end), 0)
        self.assertEqual(persist.staleness_days(artifact, trained_end + _dt.timedelta(days=5)), 5)


class TrainSeriesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="phase4-train-"))
        cls.series = make_series(trending_prices(TRAIN_ROWS))
        cls.artifact, cls.models, cls.report = train_series(
            cls.series,
            model_version="test-v1",
            artifact_root=cls.root,
            candidates=("ridge_autoregressive",),
        )

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_training_is_deterministic(self):
        again = train_series(
            self.series,
            model_version="test-v2",
            artifact_root=self.root,
            candidates=("ridge_autoregressive",),
        )[1]
        built = features.build_inference_features(self.series, horizons=again.horizons())
        for horizon in again.horizons():
            row = built[horizon]["row"]
            self.assertAlmostEqual(
                again.models[horizon].predict_price(row),
                self.models.models[horizon].predict_price(row),
                places=9,
            )

    def test_all_seven_horizons_are_trained(self):
        self.assertEqual(self.models.horizons(), [1, 2, 3, 4, 5, 6, 7])

    def test_artifact_records_model_version_and_training_end(self):
        self.assertEqual(self.artifact.model_version, "test-v1")
        self.assertEqual(self.artifact.training_data_end_date, self.series.end_date.isoformat())
        self.assertTrue(self.artifact.trained_at)
        self.assertEqual(self.artifact.horizon_max, 7)

    def test_report_contains_test_metrics_and_baselines(self):
        self.assertTrue(self.report["test_metrics"])
        self.assertTrue(self.report["baseline_metrics"])
        models_seen = {row["model"] for row in self.report["test_metrics"]}
        self.assertIn(self.artifact.model_name, models_seen)
        baseline_names = {row["model"] for row in self.report["baseline_metrics"]}
        self.assertIn("baseline_last_value", baseline_names)
        self.assertIn("baseline_moving_average_7", baseline_names)

    def test_intervals_are_calibrated_from_walk_forward_residuals(self):
        self.assertEqual(self.artifact.interval["method"], "walk_forward_residuals")
        self.assertEqual(sorted(int(h) for h in self.artifact.interval["quantiles"]), list(range(1, 8)))

    def test_insufficient_history_is_rejected(self):
        tiny = make_series(trending_prices(10))
        with self.assertRaises(InsufficientHistoryError) as ctx:
            train_series(tiny, model_version="tiny-v1", artifact_root=self.root)
        self.assertEqual(ctx.exception.code, "INSUFFICIENT_HISTORY")
        self.assertGreater(ctx.exception.required, ctx.exception.available)

    def test_horizon_above_seven_is_rejected(self):
        with self.assertRaises(ValueError):
            train_series(self.series, model_version="bad-v1", horizons=(8,), artifact_root=self.root)

    def test_default_model_version_is_stable_and_descriptive(self):
        moment = _dt.datetime(2026, 4, 1, tzinfo=_dt.timezone.utc)
        self.assertEqual(default_model_version(fixture=True, trained_at=moment), "phase4-fixture-v1-20260401")
        self.assertEqual(default_model_version(fixture=False, trained_at=moment), "phase4-data-v1-20260401")


class GenerationTests(unittest.TestCase):
    """Generation without a database (persist=False) exercises the forecast path."""

    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="phase4-gen-"))
        cls.series = make_series(trending_prices(TRAIN_ROWS))
        train_series(
            cls.series,
            model_version="gen-v1",
            artifact_root=cls.root,
            candidates=("ridge_autoregressive",),
        )

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_one_day_and_seven_day_forecasts_are_produced(self):
        built = features.build_inference_features(self.series, horizons=(1, 7))
        payload = persist.load_artifact("TEST_MANDI", "TEST_CROP", "gen-v1", root=self.root)
        models = persist.load_models(payload, root=self.root)
        interval = persist.load_interval(payload)
        artifact = persist.TrainingArtifact.from_dict(payload)
        rows = persist.build_forecast_rows(
            artifact=artifact,
            interval=interval,
            predictions={h: models.models[h].predict_price(built[h]["row"]) for h in (1, 7)},
            last_observed_price=self.series.prices[-1],
            last_observed_date=self.series.dates[-1],
            generated_at=_dt.datetime.now(_dt.timezone.utc),
        )
        self.assertEqual([row["horizon_days"] for row in rows], [1, 7])
        self.assertTrue(all(row["confidence"] > 0 for row in rows))
        self.assertTrue(all(row["lower_bound"] < row["upper_bound"] for row in rows))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
