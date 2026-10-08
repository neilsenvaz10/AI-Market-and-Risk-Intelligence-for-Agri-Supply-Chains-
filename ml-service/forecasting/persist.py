"""Model artefact persistence and forecast-row construction.

Artefacts live under ``ml-service/artifacts/forecasting/<model_version>/<mandi>__<commodity>.json``
and are plain JSON wherever possible, so a model can be inspected and diffed
without special tooling. Gradient-boosting ensembles are the one exception: their
estimator state is stored next to the JSON through ``joblib`` (both files are
written together and the JSON records the companion file name), which keeps the
design extensible to future model families.

Every artefact carries its **model version**, the **training-data end date**, the
**generation timestamp** of the training run, the feature list and the interval
calibration, so a persisted forecast can always be traced back to what produced it.
"""

from __future__ import annotations

import datetime as _dt
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .config import DEFAULT_ARTIFACT_DIR
from .data import PriceSeries
from .intervals import IntervalModel, fit_intervals
from .models import HorizonModel, HorizonModelSet, build_model

ARTIFACT_SCHEMA_VERSION = 1


def artifact_dir(model_version: str, *, root: Path | None = None) -> Path:
    base = Path(root) if root else DEFAULT_ARTIFACT_DIR
    return base / model_version


def artifact_path(mandi_code: str, commodity_code: str, model_version: str, *, root: Path | None = None) -> Path:
    safe = f"{_slug(mandi_code)}__{_slug(commodity_code)}.json"
    return artifact_dir(model_version, root=root) / safe


def _slug(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (value or "unknown")).upper()


@dataclass
class TrainingArtifact:
    """Everything needed to regenerate forecasts for one series without retraining."""

    model_version: str
    model_name: str
    mandi_id: int
    commodity_id: int
    mandi_code: str
    mandi_name: str
    commodity_code: str
    commodity_name: str
    unit: str = "INR/quintal"
    unit_label: str = "INR/quintal"
    horizon_max: int = 7
    feature_names: list[str] = field(default_factory=list)
    includes_arrivals: bool = False
    arrival_feature_reason: str = ""
    training_data_end_date: str = ""
    history_start_date: str = ""
    observations_used: int = 0
    data_source: str = "DATABASE"
    is_sample_data: bool = False
    trained_at: str = ""
    split: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    per_horizon: dict = field(default_factory=dict)
    interval: dict = field(default_factory=dict)
    baselines: dict = field(default_factory=dict)
    limiting_factors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "schema_version": ARTIFACT_SCHEMA_VERSION,
            "model_version": self.model_version,
            "model_name": self.model_name,
            "mandi": {"id": self.mandi_id, "code": self.mandi_code, "name": self.mandi_name},
            "commodity": {"id": self.commodity_id, "code": self.commodity_code, "name": self.commodity_name},
            "unit": self.unit,
            "unit_label": self.unit_label,
            "horizon_max": self.horizon_max,
            "features": {
                "names": list(self.feature_names),
                "count": len(self.feature_names),
                "includes_arrivals": self.includes_arrivals,
                "arrival_decision": self.arrival_feature_reason,
            },
            "training_data_end_date": self.training_data_end_date,
            "history_start_date": self.history_start_date,
            "observations_used": self.observations_used,
            "data_source": self.data_source,
            "is_sample_data": self.is_sample_data,
            "trained_at": self.trained_at,
            "split": self.split,
            "metrics": self.metrics,
            "per_horizon": self.per_horizon,
            "interval": self.interval,
            "baselines": self.baselines,
            "limiting_factors": list(self.limiting_factors),
        }

    @classmethod
    def from_dict(cls, payload: dict) -> "TrainingArtifact":
        mandi = payload.get("mandi", {})
        commodity = payload.get("commodity", {})
        features = payload.get("features", {})
        return cls(
            model_version=payload["model_version"],
            model_name=payload.get("model_name", ""),
            mandi_id=int(mandi.get("id", 0)),
            commodity_id=int(commodity.get("id", 0)),
            mandi_code=mandi.get("code", ""),
            mandi_name=mandi.get("name", ""),
            commodity_code=commodity.get("code", ""),
            commodity_name=commodity.get("name", ""),
            unit=payload.get("unit", "INR/quintal"),
            unit_label=payload.get("unit_label", "INR/quintal"),
            horizon_max=int(payload.get("horizon_max", 7)),
            feature_names=list(features.get("names", [])),
            includes_arrivals=bool(features.get("includes_arrivals", False)),
            arrival_feature_reason=features.get("arrival_decision", ""),
            training_data_end_date=payload.get("training_data_end_date", ""),
            history_start_date=payload.get("history_start_date", ""),
            observations_used=int(payload.get("observations_used", 0)),
            data_source=payload.get("data_source", "DATABASE"),
            is_sample_data=bool(payload.get("is_sample_data", False)),
            trained_at=payload.get("trained_at", ""),
            split=payload.get("split", {}),
            metrics=payload.get("metrics", {}),
            per_horizon=payload.get("per_horizon", {}),
            interval=payload.get("interval", {}),
            baselines=payload.get("baselines", {}),
            limiting_factors=list(payload.get("limiting_factors", [])),
        )


def save_artifact(
    artifact: TrainingArtifact,
    models: HorizonModelSet,
    *,
    root: Path | None = None,
) -> Path:
    """Writes the JSON manifest plus any companion estimator files."""
    directory = artifact_dir(artifact.model_version, root=root)
    directory.mkdir(parents=True, exist_ok=True)
    path = artifact_path(artifact.mandi_code, artifact.commodity_code, artifact.model_version, root=root)

    payload = artifact.to_dict()
    payload["estimators"] = {}
    for horizon, model in sorted(models.models.items()):
        if model.name == "ridge_autoregressive":
            payload["estimators"][str(horizon)] = {"kind": "inline", "state": model.to_dict()}
        else:
            import joblib

            companion = f"{path.stem}__h{horizon}.joblib"
            joblib.dump(model, directory / companion)
            payload["estimators"][str(horizon)] = {"kind": "joblib", "file": companion}

    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def load_artifact(mandi_code: str, commodity_code: str, model_version: str, *, root: Path | None = None) -> dict:
    path = artifact_path(mandi_code, commodity_code, model_version, root=root)
    if not path.exists():
        raise FileNotFoundError(
            f"no trained artefact for {mandi_code}/{commodity_code} at model version {model_version} ({path})"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def load_models(payload: dict, *, root: Path | None = None) -> HorizonModelSet:
    """Rebuilds the per-horizon estimators recorded in an artefact."""
    directory = artifact_dir(payload["model_version"], root=root)
    model_set = HorizonModelSet(feature_names=list(payload.get("features", {}).get("names", [])))
    for horizon_key, entry in (payload.get("estimators") or {}).items():
        horizon = int(horizon_key)
        if entry.get("kind") == "inline":
            model = _model_from_state(entry["state"])
        else:
            import joblib

            model = joblib.load(directory / entry["file"])
        model_set.add(horizon, model)
    if not model_set.models:
        raise ValueError("artefact contains no estimators")
    return model_set


def _model_from_state(state: dict) -> HorizonModel:
    kind = state.get("kind")
    if kind == "ridge":
        from .models import RidgePriceModel

        return RidgePriceModel.from_dict(state)
    raise ValueError(f"unsupported inline estimator kind '{kind}'")


def load_interval(payload: dict) -> IntervalModel:
    return IntervalModel.from_dict(payload.get("interval") or {})


def build_interval(residuals_by_horizon: dict[int, list[float]]) -> IntervalModel:
    return fit_intervals(residuals_by_horizon)


def list_artifacts(*, root: Path | None = None) -> list[dict]:
    """All trained series artefacts, for reporting and for `forecast:generate --all`."""
    base = Path(root) if root else DEFAULT_ARTIFACT_DIR
    if not base.exists():
        return []
    found: list[dict] = []
    for path in sorted(base.glob("*/*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        found.append(
            {
                "path": str(path),
                "model_version": payload.get("model_version"),
                "model_name": payload.get("model_name"),
                "mandi_code": payload.get("mandi", {}).get("code"),
                "commodity_code": payload.get("commodity", {}).get("code"),
                "training_data_end_date": payload.get("training_data_end_date"),
                "trained_at": payload.get("trained_at"),
                "data_source": payload.get("data_source"),
                "is_sample_data": payload.get("is_sample_data"),
            }
        )
    return found


def build_forecast_rows(
    *,
    artifact: TrainingArtifact,
    interval: IntervalModel,
    predictions: dict[int, float],
    last_observed_price: float,
    last_observed_date: _dt.date,
    generated_at: _dt.datetime,
    run_id: Optional[int] = None,
) -> list[dict]:
    """Turns per-horizon point forecasts into persistable rows with intervals.

    The first forecast date is the calendar day after the last observation and each
    horizon advances by one day, so horizon ``h`` always lands on ``last + h``.
    """
    rows: list[dict] = []
    for horizon in sorted(predictions):
        predicted = float(predictions[horizon])
        lower, upper = interval.bounds(predicted, horizon)
        confidence = interval.confidence(predicted, lower, upper, horizon)
        rows.append(
            {
                "run_id": run_id,
                "commodity_id": artifact.commodity_id,
                "mandi_id": artifact.mandi_id,
                "forecast_date": last_observed_date + _dt.timedelta(days=horizon),
                "horizon_days": horizon,
                "predicted_price": round(predicted, 2),
                "lower_bound": lower,
                "upper_bound": upper,
                "interval_level": interval.level,
                "confidence": confidence,
                "unit": artifact.unit or "INR/quintal",
                "model_version": artifact.model_version,
                "training_data_end_date": artifact.training_data_end_date,
                "last_observed_price": round(float(last_observed_price), 2),
                "last_observed_date": last_observed_date,
                "is_sample_data": artifact.is_sample_data,
                "data_source": artifact.data_source,
                "generated_at": generated_at,
            }
        )
    return rows


def staleness_days(artifact: TrainingArtifact, last_observed_date: _dt.date) -> int:
    """How many days of newer observations exist beyond the artefact's training end."""
    if not artifact.training_data_end_date:
        return 0
    trained_end = _dt.date.fromisoformat(artifact.training_data_end_date)
    return max(0, (last_observed_date - trained_end).days)


__all__ = [
    "ARTIFACT_SCHEMA_VERSION",
    "TrainingArtifact",
    "artifact_dir",
    "artifact_path",
    "build_forecast_rows",
    "build_interval",
    "list_artifacts",
    "load_artifact",
    "load_interval",
    "load_models",
    "save_artifact",
    "staleness_days",
]
