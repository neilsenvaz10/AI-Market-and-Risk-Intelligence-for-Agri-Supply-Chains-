-- =====================================================================
-- FASALYTICS MIGRATION 004 - PHASE 3: MANDI DATA PIPELINE (BASE TABLES)
--
-- Replaces the former 003_mandi_data_pipeline.sql, which:
--   * shared the 003 prefix with 003_phase2_email_identity.sql and sorted first;
--   * required the Phase 1 system_metadata table, so it failed on databases
--     created by the migration runner and blocked the Phase 2 email migration;
--   * seeded fixture mandis/commodities used by the MOCK provider into the
--     production tables;
--   * deleted price history through ON DELETE CASCADE.
--
-- Idempotent: safe on fresh databases, on databases created from
-- database/schema.sql and on databases where the old 003_mandi file ran.
-- Existing rows are never modified here; 005 applies the integrity upgrade.
-- =====================================================================

CREATE TABLE IF NOT EXISTS mandis (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    hindi_name VARCHAR(128),
    marathi_name VARCHAR(128),
    state VARCHAR(64) NOT NULL,
    district VARCHAR(64) NOT NULL,
    market_center VARCHAR(128),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commodities (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    hindi_name VARCHAR(128),
    marathi_name VARCHAR(128),
    category VARCHAR(64),
    standard_unit VARCHAR(32) DEFAULT 'quintal',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mandi_prices (
    id SERIAL PRIMARY KEY,
    mandi_id INTEGER NOT NULL,
    commodity_id INTEGER NOT NULL,
    price_date DATE NOT NULL,
    min_price NUMERIC(10, 2) CHECK (min_price >= 0),
    max_price NUMERIC(10, 2) CHECK (max_price >= min_price),
    modal_price NUMERIC(10, 2) NOT NULL CHECK (modal_price >= min_price AND modal_price <= max_price),
    arrivals_quantity NUMERIC(12, 2) CHECK (arrivals_quantity >= 0),
    unit VARCHAR(32),
    variety VARCHAR(64),
    grade VARCHAR(32),
    source VARCHAR(64) NOT NULL,
    is_sample_data BOOLEAN DEFAULT FALSE,
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mandi_prices_mandi_fk FOREIGN KEY (mandi_id) REFERENCES mandis(id) ON DELETE RESTRICT,
    CONSTRAINT mandi_prices_commodity_fk FOREIGN KEY (commodity_id) REFERENCES commodities(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pipeline_sync_logs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    records_fetched INTEGER DEFAULT 0,
    records_valid INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_rejected INTEGER DEFAULT 0,
    error_details TEXT,
    execution_time_ms INTEGER DEFAULT 0,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mandi_prices_date ON mandi_prices(price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_mandi_id ON mandi_prices(mandi_id);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_commodity_id ON mandi_prices(commodity_id);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_lookup ON mandi_prices(commodity_id, mandi_id, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandis_location ON mandis(state, district);
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_synced_at ON pipeline_sync_logs(synced_at DESC);
