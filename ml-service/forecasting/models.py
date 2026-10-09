"""Forecasting models for Phase 4.

Both models predict the **log** modal price and are trained on one horizon at a
time (a direct multi-horizon strategy). Predicting one target per horizon keeps
the feature matrix identical across horizons and avoids the error accumulation of
a recursive multi-step forecast.

Choosing log price means the fitted value is always positive after
``exp`` — a forecast can never be a negative price — and the additive error in log
space corresponds to a multiplicative error on price, which matches how
percentage error (MAPE) is evaluated.

Determinism: every estimator is seeded, single-threaded, and repeatedly trained on
the same input produces byte-identical predictions (see ``tests/test_model.py``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

RIDGE_MODEL_NAME = "ridge_autoregressive"
RIDGE_MODEL_VERSION = "ridge-autoregressive-v1"
GBM_MODEL_NAME = "gradient_boosting"
GBM_MODEL_VERSION = "gradient-boosting-v1"

SUPPORTED_MODEL_NAMES = (RIDGE_MODEL_NAME, GBM_MODEL_NAME)


class ModelError(Exception):
    """Raised when a model cannot be fitted (e.g. not enough training rows)."""


def _to_log(prices: Sequence[float]) -> np.ndarray:
    values = np.asarray(prices, dtype=float)
    if np.any(values <= 0):
        raise ModelError("prices must be strictly positive; missing prices are never coerced to zero")
    return np.log(values)


@dataclass
class Standardizer:
    """Zero-mean / unit-variance feature scaling, stored alongside the model."""

    mean: np.ndarray | None = None
    scale: np.ndarray | None = None

    def fit(self, x: np.ndarray) -> "Standardizer":
        self.mean = x.mean(axis=0)
        scale = x.std(axis=0)
        scale[scale == 0] = 1.0  # a constant feature carries no information
        self.scale = scale
        return self

    def transform(self, x: np.ndarray) -> np.ndarray:
        if self.mean is None or self.scale is None:
            raise ModelError("standardizer has not been fitted")
        return (x - self.mean) / self.scale

    def to_dict(self) -> dict:
        return {
            "mean": [float(v) for v in (self.mean if self.mean is not None else [])],
            "scale": [float(v) for v in (self.scale if self.scale is not None else [])],
        }

    @classmethod
    def from_dict(cls, payload: dict) -> "Standardizer":
        return cls(
            mean=np.asarray(payload.get("mean", []), dtype=float),
            scale=np.asarray(payload.get("scale", []), dtype=float),
        )


class HorizonModel:
    """Base class: fit on a feature matrix, predict a log price."""

    name = "base"
    version = "base-v1"

    def fit(self, x: np.ndarray, y: np.ndarray) -> "HorizonModel":  # pragma: no cover - interface
        raise NotImplementedError

    def predict(self, x: np.ndarray) -> np.ndarray:  # pragma: no cover - interface
        raise NotImplementedError

    def predict_price(self, feature_row: Sequence[float]) -> float:
        row = np.asarray(feature_row, dtype=float).reshape(1, -1)
        log_price = float(self.predict(row)[0])
        price = math.exp(log_price)
        if not math.isfinite(price) or price <= 0:
            raise ModelError("model produced a non-positive price")
        return price

    def to_dict(self) -> dict:  # pragma: no cover - interface
        raise NotImplementedError

    def metadata(self) -> dict:
        return {"name": self.name, "version": self.version}


class RidgePriceModel(HorizonModel):
    """Closed-form ridge regression on standardized features, fitted in log space.

    Solved with the normal equations ``(XᵀX + λI)β = Xᵀy`` (features are already
    standardized and an explicit intercept column is prepended, which is left
    unpenalized). For the small, strongly collinear feature blocks typical here a
    ridge penalty is what keeps the solution stable.
    """

    name = RIDGE_MODEL_NAME
    version = RIDGE_MODEL_VERSION

    def __init__(self, alpha: float = 1.0):
        if alpha < 0:
            raise ValueError("alpha must be >= 0")
        self.alpha = float(alpha)
        self.standardizer = Standardizer()
        self.coefficients: np.ndarray | None = None
        self.training_rows = 0

    def fit(self, x: np.ndarray, y: np.ndarray) -> "RidgePriceModel":
        if x.ndim != 2 or x.shape[0] != y.shape[0]:
            raise ModelError("feature matrix and target must have matching row counts")
        if x.shape[0] < 2:
            raise ModelError(f"at least 2 training rows are required, received {x.shape[0]}")
        if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
            raise ModelError("training data contains non-finite values")
        self.training_rows = int(x.shape[0])
        self.standardizer.fit(x)
        design = np.hstack([np.ones((x.shape[0], 1)), self.standardizer.transform(x)])
        penalty = self.alpha * np.eye(design.shape[1])
        penalty[0, 0] = 0.0  # never penalize the intercept
        gram = design.T @ design + penalty
        try:
            self.coefficients = np.linalg.solve(gram, design.T @ y)
        except np.linalg.LinAlgError as exc:  # pragma: no cover - defensive
            raise ModelError(f"ridge system is singular: {exc}") from exc
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        if self.coefficients is None:
            raise ModelError("model has not been fitted")
        design = np.hstack([np.ones((x.shape[0], 1)), self.standardizer.transform(x)])
        return design @ self.coefficients

    def to_dict(self) -> dict:
        return {
            "kind": "ridge",
            "name": self.name,
            "version": self.version,
            "params": {"alpha": self.alpha},
            "standardizer": self.standardizer.to_dict(),
            "coefficients": [float(c) for c in (self.coefficients if self.coefficients is not None else [])],
            "training_rows": self.training_rows,
        }

    @classmethod
    def from_dict(cls, payload: dict) -> "RidgePriceModel":
        model = cls(alpha=float(payload.get("params", {}).get("alpha", 1.0)))
        model.standardizer = Standardizer.from_dict(payload.get("standardizer", {}))
        coefficients = payload.get("coefficients") or []
        model.coefficients = np.asarray(coefficients, dtype=float) if coefficients else None
        model.training_rows = int(payload.get("training_rows", 0))
        return model


class GradientBoostingPriceModel(HorizonModel):
    """Histogram gradient boosting on standardized features, fitted in log space.

    Histogram-based boosting is used rather than a neural sequence model: it is
    deterministic under a fixed seed and single thread, trains in milliseconds on
    the few hundred rows a mandi series provides, and needs no GPU. It is kept
    deliberately conservative (shallow trees, large leaves) because these series
    are short.
    """

    name = GBM_MODEL_NAME
    version = GBM_MODEL_VERSION

    def __init__(
        self,
        *,
        max_iter: int = 80,
        learning_rate: float = 0.06,
        max_depth: int = 3,
        min_samples_leaf: int = 5,
        l2_regularization: float = 1.0,
        random_state: int = 20260401,
    ):
        self.params = {
            "max_iter": int(max_iter),
            "learning_rate": float(learning_rate),
            "max_depth": int(max_depth),
            "min_samples_leaf": int(min_samples_leaf),
            "l2_regularization": float(l2_regularization),
            "random_state": int(random_state),
        }
        self.standardizer = Standardizer()
        self.estimator = None
        self.training_rows = 0

    def fit(self, x: np.ndarray, y: np.ndarray) -> "GradientBoostingPriceModel":
        if x.ndim != 2 or x.shape[0] != y.shape[0]:
            raise ModelError("feature matrix and target must have matching row counts")
        if x.shape[0] < 10:
            raise ModelError(f"gradient boosting needs at least 10 training rows, received {x.shape[0]}")
        if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
            raise ModelError("training data contains non-finite values")
        from sklearn.ensemble import HistGradientBoostingRegressor

        self.training_rows = int(x.shape[0])
        self.standardizer.fit(x)
        self.estimator = HistGradientBoostingRegressor(
            **self.params,
            # Deterministic and reproducible: fixed seed (in params) and no
            # early stopping, which would make the fit depend on a random split.
            early_stopping=False,
        )
        self.estimator.fit(self.standardizer.transform(x), y)
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        if self.estimator is None:
            raise ModelError("model has not been fitted")
        return self.estimator.predict(self.standardizer.transform(x))

    def to_dict(self) -> dict:
        raise ModelError(
            "gradient boosting models are persisted through joblib, not JSON; "
            "use persist.save_artifact for the ensemble"
        )

    def metadata(self) -> dict:
        return {"name": self.name, "version": self.version, "params": dict(self.params)}


def build_model(name: str, *, alpha: float = 1.0) -> HorizonModel:
    """Factory used by training so the model can be selected from the CLI."""
    normalized = (name or "").strip().lower()
    if normalized in (RIDGE_MODEL_NAME, "ridge"):
        return RidgePriceModel(alpha=alpha)
    if normalized in (GBM_MODEL_NAME, "gbm", "gradient_boosting"):
        return GradientBoostingPriceModel()
    raise ModelError(f"unknown model '{name}'; supported: {', '.join(SUPPORTED_MODEL_NAMES)}")


@dataclass
class HorizonModelSet:
    """One fitted model per horizon (1..N) for a single series."""

    models: dict[int, HorizonModel] = field(default_factory=dict)
    feature_names: list[str] = field(default_factory=list)

    def add(self, horizon: int, model: HorizonModel) -> None:
        self.models[horizon] = model

    def horizons(self) -> list[int]:
        return sorted(self.models)

    def predict_prices(self, feature_row: Sequence[float]) -> dict[int, float]:
        return {h: self.models[h].predict_price(feature_row) for h in self.horizons()}

    def metadata(self) -> dict:
        first: Optional[HorizonModel] = self.models[self.horizons()[0]] if self.models else None
        return {
            "horizons": self.horizons(),
            "feature_names": list(self.feature_names),
            "model_name": first.name if first else None,
            "model_version": first.version if first else None,
            "training_rows_per_horizon": {
                h: getattr(self.models[h], "training_rows", 0) for h in self.horizons()
            },
        }


__all__ = [
    "GBM_MODEL_NAME",
    "GBM_MODEL_VERSION",
    "GradientBoostingPriceModel",
    "HorizonModel",
    "HorizonModelSet",
    "ModelError",
    "RIDGE_MODEL_NAME",
    "RIDGE_MODEL_VERSION",
    "RidgePriceModel",
    "SUPPORTED_MODEL_NAMES",
    "Standardizer",
    "build_model",
]
