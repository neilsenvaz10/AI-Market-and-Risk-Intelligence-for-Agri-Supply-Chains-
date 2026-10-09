"""FASALYTICS Phase 4 — mandi price forecasting subsystem.

Consumes the Phase 3 PostgreSQL schema (``mandis``, ``commodities``,
``mandi_prices``) and produces 1-7 day price forecasts with prediction intervals,
persisted into the Phase 4 ``forecast_runs`` / ``forecasts`` tables.

Modules
-------
``config``      database/artifact configuration (reads ``backend/.env``)
``data``        read-only historical observations from the Phase 3 schema
``features``    backward-looking feature engineering (lag/rolling/calendar)
``baselines``   naive last-value and 7-day moving-average baselines
``models``      ridge and gradient-boosting horizon models
``validation``  chronological splits and walk-forward backtesting
``metrics``     MAE / RMSE / MAPE / sMAPE / directional accuracy
``intervals``   residual-based prediction intervals and confidence
``persist``     model artefacts and forecast-row construction
``fixture``     deterministic, clearly-synthetic development data
``pipeline``    train + generate orchestration
"""

from __future__ import annotations

MODEL_FAMILY_LABEL = "Phase 4 price forecasting"

__all__ = [
    "MODEL_FAMILY_LABEL",
    "baselines",
    "config",
    "data",
    "features",
    "fixture",
    "intervals",
    "metrics",
    "models",
    "persist",
    "pipeline",
    "validation",
]
