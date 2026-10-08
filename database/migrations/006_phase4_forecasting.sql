-- =====================================================================
-- FASALYTICS MIGRATION 006 - PHASE 4: PRICE FORECASTING PERSISTENCE
--
-- Stores the 1-7 day mandi price forecasts produced by the Phase 4
-- forecasting subsystem (ml-service/forecasting) so the read-only backend
-- API and the existing UI can serve them without retraining.
--
-- Guarantees:
--   * additive only: no Phase 1-3 table, column, constraint or row is
--     modified, renamed or dropped;
--   * price history stays read-only for this subsystem (forecasts are a
--     derived artefact kept in their own tables);
--   * every row records its model version, the training-data end date and
--     the generation timestamp, so a forecast can always be traced back to
--     the exact model and data window that produced it;
--   * is_sample_data flags a forecast produced from synthetic/sample input,
--     so fixture-derived output can never be mistaken for a real forecast;
--   * a forecast is never a guaranteed price: predicted_price is the model's
--     point estimate and lower_bound/upper_bound are the (1 - alpha)
--     prediction interval computed from out-of-fold residuals.
--
-- Idempotent: safe to re-run on a fresh database or on one already at 006.
-- Runs inside the migration runner's transaction.
-- =====================================================================

-- 1. One row per forecast generation run ---------------------------------
--    Groups the 1..7 day rows produced by a single `forecast:generate`
--    invocation and holds the aggregate evaluation numbers of the run.
CREATE TABLE IF NOT EXISTS forecast_runs (
    id SERIAL PRIMARY KEY,
    model_version VARCHAR(64) NOT NULL,
    commodity_id INTEGER NOT NULL REFERENCES commodities(id) ON DELETE RESTRICT,
    mandi_id INTEGER NOT NULL REFERENCES mandis(id) ON DELETE RESTRICT,
    -- Last date of the history the model was trained on, and the last date
    -- genuinely observed when the forecast was generated.
    training_data_end_date DATE NOT NULL,
    history_start_date DATE,
    observations_used INTEGER NOT NULL DEFAULT 0,
    horizon_max SMALLINT NOT NULL DEFAULT 7,
    is_sample_data BOOLEAN NOT NULL DEFAULT FALSE,
    data_source VARCHAR(32) NOT NULL DEFAULT 'DATABASE',
    metrics JSONB,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT forecast_runs_horizon_max_valid CHECK (horizon_max BETWEEN 1 AND 7),
    CONSTRAINT forecast_runs_observations_valid CHECK (observations_used >= 0),
    CONSTRAINT forecast_runs_data_source_valid CHECK (data_source IN ('DATABASE', 'FIXTURE')),
    -- Synthetic input may not be recorded as a genuine run and vice versa.
    CONSTRAINT forecast_runs_sample_flag_consistent
        CHECK (is_sample_data = (data_source = 'FIXTURE'))
);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_lookup
    ON forecast_runs (commodity_id, mandi_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_runs_model
    ON forecast_runs (model_version, generated_at DESC);

-- 2. The forecasts themselves --------------------------------------------
CREATE TABLE IF NOT EXISTS forecasts (
    id BIGSERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
    commodity_id INTEGER NOT NULL REFERENCES commodities(id) ON DELETE RESTRICT,
    mandi_id INTEGER NOT NULL REFERENCES mandis(id) ON DELETE RESTRICT,
    forecast_date DATE NOT NULL,
    horizon_days SMALLINT NOT NULL,
    predicted_price NUMERIC(12, 2) NOT NULL,
    lower_bound NUMERIC(12, 2) NOT NULL,
    upper_bound NUMERIC(12, 2) NOT NULL,
    -- Interval level used for lower/upper bound, e.g. 0.8 for an 80% interval.
    interval_level NUMERIC(4, 3) NOT NULL DEFAULT 0.800,
    -- Derived confidence score in [0, 100] (never a probability guarantee).
    confidence NUMERIC(5, 2) NOT NULL,
    unit VARCHAR(32) NOT NULL DEFAULT 'INR/quintal',
    model_version VARCHAR(64) NOT NULL,
    training_data_end_date DATE NOT NULL,
    -- Price the interval is anchored on (last observed modal price), so the
    -- UI can show the observed baseline next to the forecast.
    last_observed_price NUMERIC(12, 2),
    last_observed_date DATE,
    is_sample_data BOOLEAN NOT NULL DEFAULT FALSE,
    data_source VARCHAR(32) NOT NULL DEFAULT 'DATABASE',
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT forecasts_horizon_valid CHECK (horizon_days BETWEEN 1 AND 7),
    CONSTRAINT forecasts_predicted_positive CHECK (predicted_price > 0),
    CONSTRAINT forecasts_lower_positive CHECK (lower_bound > 0),
    CONSTRAINT forecasts_bounds_ordered CHECK (lower_bound <= predicted_price AND predicted_price <= upper_bound),
    CONSTRAINT forecasts_confidence_range CHECK (confidence >= 0 AND confidence <= 100),
    CONSTRAINT forecasts_interval_level_valid CHECK (interval_level > 0 AND interval_level < 1),
    CONSTRAINT forecasts_unit_valid CHECK (unit = 'INR/quintal'),
    CONSTRAINT forecasts_data_source_valid CHECK (data_source IN ('DATABASE', 'FIXTURE')),
    CONSTRAINT forecasts_sample_flag_consistent
        CHECK (is_sample_data = (data_source = 'FIXTURE')),
    -- One forecast per market, commodity, target date, horizon and model
    -- version: re-generating with the same model overwrites instead of
    -- duplicating, while a new model version keeps its own rows.
    CONSTRAINT uq_forecasts_market_target_model
        UNIQUE (commodity_id, mandi_id, forecast_date, horizon_days, model_version)
);

-- Read path for GET /api/forecast/:commodity/:mandi (latest generated run).
CREATE INDEX IF NOT EXISTS idx_forecasts_lookup
    ON forecasts (commodity_id, mandi_id, model_version, generated_at DESC, horizon_days);
CREATE INDEX IF NOT EXISTS idx_forecasts_run ON forecasts (run_id, horizon_days);
CREATE INDEX IF NOT EXISTS idx_forecasts_date ON forecasts (forecast_date DESC);
