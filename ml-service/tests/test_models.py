"""Model tests: determinism, prediction shape, horizons, bounds, versioning."""

from __future__ import annotations

import math
import unittest

import numpy as np

from tests import make_series, trending_prices

from forecasting import features, validation
from forecasting.models import (
    GBM_MODEL_NAME,
    RIDGE_MODEL_NAME,
    GradientBoostingPriceModel,
    HorizonModelSet,
    ModelError,
    RidgePriceModel,
    Standardizer,
    build_model,
)


def _dataset(count: int = 120, horizon: int = 1):
    series = make_series(trending_prices(count))
    matrix = features.build_training_data(series, horizon=horizon)
    x, y = matrix.to_arrays()
    return series, matrix, x, y


class RidgeModelTests(unittest.TestCase):
    def test_predictions_are_deterministic(self):
        _series, _matrix, x, y = _dataset()
        first = RidgePriceModel().fit(x, np.log(y)).predict(x[:5])
        second = RidgePriceModel().fit(x, np.log(y)).predict(x[:5])
        np.testing.assert_array_equal(first, second)

    def test_predicted_price_is_always_positive(self):
        _series, _matrix, x, y = _dataset()
        model = RidgePriceModel().fit(x, np.log(y))
        for row in x[:20]:
            self.assertGreater(model.predict_price(row), 0.0)

    def test_requires_at_least_two_rows(self):
        with self.assertRaises(ModelError):
            RidgePriceModel().fit(np.zeros((1, 3)), np.zeros(1))

    def test_rejects_non_finite_training_data(self):
        with self.assertRaises(ModelError):
            RidgePriceModel().fit(np.array([[1.0, np.nan], [2.0, 3.0]]), np.array([1.0, 2.0]))

    def test_round_trips_through_dict(self):
        _series, _matrix, x, y = _dataset()
        model = RidgePriceModel(alpha=2.5).fit(x, np.log(y))
        restored = RidgePriceModel.from_dict(model.to_dict())
        np.testing.assert_allclose(model.predict(x[:5]), restored.predict(x[:5]), rtol=1e-12)
        self.assertEqual(restored.alpha, 2.5)

    def test_unfitted_model_refuses_to_predict(self):
        with self.assertRaises(ModelError):
            RidgePriceModel().predict(np.zeros((1, 3)))


class GradientBoostingModelTests(unittest.TestCase):
    def test_predictions_are_deterministic(self):
        _series, _matrix, x, y = _dataset()
        first = GradientBoostingPriceModel().fit(x, np.log(y)).predict(x[:5])
        second = GradientBoostingPriceModel().fit(x, np.log(y)).predict(x[:5])
        np.testing.assert_array_equal(first, second)

    def test_needs_at_least_ten_rows(self):
        with self.assertRaises(ModelError):
            GradientBoostingPriceModel().fit(np.zeros((9, 3)), np.zeros(9))

    def test_version_is_reported(self):
        _series, _matrix, x, y = _dataset()
        model = GradientBoostingPriceModel().fit(x, np.log(y))
        self.assertEqual(model.metadata()["name"], GBM_MODEL_NAME)
        self.assertTrue(model.metadata()["version"])


class ModelFactoryTests(unittest.TestCase):
    def test_factory_builds_each_supported_model(self):
        self.assertIsInstance(build_model(RIDGE_MODEL_NAME), RidgePriceModel)
        self.assertIsInstance(build_model(GBM_MODEL_NAME), GradientBoostingPriceModel)

    def test_factory_rejects_unknown_models(self):
        with self.assertRaises(ModelError):
            build_model("lstm-transformer-9000")


class StandardizerTests(unittest.TestCase):
    def test_constant_feature_is_not_divided_by_zero(self):
        x = np.array([[1.0, 5.0], [2.0, 5.0], [3.0, 5.0]])
        scaled = Standardizer().fit(x).transform(x)
        self.assertTrue(np.all(np.isfinite(scaled)))
        self.assertTrue(np.allclose(scaled[:, 1], 0.0))


class HorizonModelSetTests(unittest.TestCase):
    def test_one_day_forecast(self):
        _series, matrix, x, y = _dataset(horizon=1)
        model_set = HorizonModelSet(feature_names=matrix.feature_names)
        model_set.add(1, RidgePriceModel().fit(x, np.log(y)))
        predictions = model_set.predict_prices(x[-1])
        self.assertEqual(list(predictions), [1])
        self.assertGreater(predictions[1], 0)

    def test_seven_day_forecast_produces_every_horizon(self):
        series = make_series(trending_prices(140))
        built = validation.build_series_features(series, horizons=(1, 2, 3, 4, 5, 6, 7))
        model_set = HorizonModelSet(feature_names=built.feature_names)
        for horizon in built.horizons:
            x, y = built.matrix(horizon).to_arrays()
            model_set.add(horizon, RidgePriceModel().fit(x, np.log(y)))
        inference = features.build_inference_features(series, horizons=built.horizons)
        predictions = {h: model_set.models[h].predict_price(inference[h]["row"]) for h in built.horizons}
        self.assertEqual(sorted(predictions), [1, 2, 3, 4, 5, 6, 7])
        for value in predictions.values():
            self.assertGreater(value, 0)

    def test_metadata_reports_version_and_rows(self):
        _series, matrix, x, y = _dataset()
        model_set = HorizonModelSet(feature_names=matrix.feature_names)
        model_set.add(1, RidgePriceModel().fit(x, np.log(y)))
        metadata = model_set.metadata()
        self.assertEqual(metadata["model_version"], "ridge-autoregressive-v1")
        self.assertEqual(metadata["horizons"], [1])
        self.assertGreater(metadata["training_rows_per_horizon"][1], 0)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
