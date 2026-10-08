-- =====================================================================
-- FASALYTICS DATABASE SCHEMA - PHASE 1 & PHASE 3
-- Core relational tables supporting Mandi Intelligence & ML Forecasting
--
-- Used by the optional Docker Compose setup only. For local PostgreSQL run
-- `npm run migrate` (backend): migrations 004/005 own the Phase 3 tables and
-- upgrade the definitions below (RESTRICT foreign keys, nullable prices,
-- provenance columns, conflicts/revisions, resolved view).
-- =====================================================================

-- 1. Service Heartbeat & Metadata table
CREATE TABLE IF NOT EXISTS system_metadata (
    id SERIAL PRIMARY KEY,
    key VARCHAR(64) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Basic service health audit log
CREATE TABLE IF NOT EXISTS health_check_audit (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    latency_ms INTEGER DEFAULT 0,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Mandi / Market Identity Table (Phase 3)
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

-- 4. Commodities / Crops Table (Phase 3)
CREATE TABLE IF NOT EXISTS commodities (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    hindi_name VARCHAR(128),
    marathi_name VARCHAR(128),
    category VARCHAR(64) DEFAULT 'Vegetables',
    standard_unit VARCHAR(32) DEFAULT 'quintal',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Mandi Daily Prices & Arrivals Table (Phase 3)
CREATE TABLE IF NOT EXISTS mandi_prices (
    id SERIAL PRIMARY KEY,
    mandi_id INTEGER NOT NULL REFERENCES mandis(id) ON DELETE CASCADE,
    commodity_id INTEGER NOT NULL REFERENCES commodities(id) ON DELETE CASCADE,
    price_date DATE NOT NULL,
    min_price NUMERIC(10, 2) NOT NULL CHECK (min_price >= 0),
    max_price NUMERIC(10, 2) NOT NULL CHECK (max_price >= min_price),
    modal_price NUMERIC(10, 2) NOT NULL CHECK (modal_price >= min_price AND modal_price <= max_price),
    arrivals_quantity NUMERIC(12, 2) DEFAULT 0 CHECK (arrivals_quantity >= 0),
    unit VARCHAR(32) DEFAULT 'quintal',
    variety VARCHAR(64) DEFAULT 'Standard',
    grade VARCHAR(32) DEFAULT 'FAQ',
    source VARCHAR(64) NOT NULL,
    is_sample_data BOOLEAN DEFAULT FALSE,
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_mandi_commodity_date_variety_source UNIQUE (mandi_id, commodity_id, price_date, variety, source)
);

-- 6. Pipeline Sync Audit & Quality Logs Table (Phase 3)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mandi_prices_date ON mandi_prices(price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_mandi_id ON mandi_prices(mandi_id);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_commodity_id ON mandi_prices(commodity_id);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_lookup ON mandi_prices(commodity_id, mandi_id, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandis_location ON mandis(state, district);
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_synced_at ON pipeline_sync_logs(synced_at DESC);
