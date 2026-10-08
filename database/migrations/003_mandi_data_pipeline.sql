-- =====================================================================
-- FASALYTICS DATABASE MIGRATION - PHASE 3: MANDI DATA PIPELINE
-- Creates mandis, commodities, mandi_prices, and pipeline_sync_logs
-- =====================================================================

-- 1. Mandi / Market Identity Table
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

-- 2. Commodities / Crops Table
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

-- 3. Mandi Daily Prices & Arrivals Table (Core Historical & Real-Time Storage)
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

-- 4. Pipeline Sync Audit & Quality Logs Table
CREATE TABLE IF NOT EXISTS pipeline_sync_logs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL, -- 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED'
    records_fetched INTEGER DEFAULT 0,
    records_valid INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_rejected INTEGER DEFAULT 0,
    error_details TEXT,
    execution_time_ms INTEGER DEFAULT 0,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Indexes for High-Performance Querying & Forecasting Retrieval
CREATE INDEX IF NOT EXISTS idx_mandi_prices_date ON mandi_prices(price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_mandi_id ON mandi_prices(mandi_id);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_commodity_id ON mandi_prices(commodity_id);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_lookup ON mandi_prices(commodity_id, mandi_id, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandis_location ON mandis(state, district);
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_synced_at ON pipeline_sync_logs(synced_at DESC);

-- 6. Initial Master Data Seeding (Idempotent)
INSERT INTO commodities (code, name, hindi_name, marathi_name, category, standard_unit)
VALUES
    ('ONION', 'Onion', 'प्याज', 'कांदा', 'Vegetables', 'quintal'),
    ('TOMATO', 'Tomato', 'टमाटर', 'टोमॅटो', 'Vegetables', 'quintal'),
    ('POTATO', 'Potato', 'आलू', 'बटाटा', 'Vegetables', 'quintal'),
    ('SOYBEAN', 'Soybean', 'सोयाबीन', 'सोयाबीन', 'Oilseeds', 'quintal'),
    ('WHEAT', 'Wheat', 'गेहूं', 'गहू', 'Grains', 'quintal'),
    ('COTTON', 'Cotton', 'कपास', 'कापूस', 'Fibers', 'quintal')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, hindi_name = EXCLUDED.hindi_name, marathi_name = EXCLUDED.marathi_name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO mandis (code, name, hindi_name, marathi_name, state, district, market_center, latitude, longitude)
VALUES
    ('MH_PUNE_APMC', 'Pune APMC (Gultekdi)', 'पुणे एपीएमसी', 'पुणे एपीएमसी (गुलटेकडी)', 'Maharashtra', 'Pune', 'Gultekdi', 18.4967, 73.8647),
    ('MH_NSK_MAIN', 'Nashik Market Yard', 'नासिक मार्केट यार्ड', 'नाशिक मार्केट यार्ड', 'Maharashtra', 'Nashik', 'Panchavati', 19.9975, 73.7898),
    ('MH_AHM_APMC', 'Ahmednagar Mandi', 'अहमदनगर मंडी', 'अहमदनगर कृषी उत्पन्न बाजार', 'Maharashtra', 'Ahmednagar', 'Market Yard', 19.0952, 74.7480),
    ('MH_BAR_APMC', 'Baramati APMC', 'बारामती एपीएमसी', 'बारामती कृषी उत्पन्न बाजार', 'Maharashtra', 'Pune', 'Baramati', 18.1519, 74.5772),
    ('MH_MUM_VASHI', 'Mumbai APMC (Vashi)', 'मुंबई एपीएमसी (वाशी)', 'मुंबई एपीएमसी (वाशी)', 'Maharashtra', 'Thane', 'Vashi', 19.0771, 72.9986),
    ('MH_NSK_LASALGAON', 'Lasalgaon APMC', 'लासलगांव एपीएमसी', 'लासलगाव कांदा मार्केट', 'Maharashtra', 'Nashik', 'Lasalgaon', 20.1472, 74.2289)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, hindi_name = EXCLUDED.hindi_name, marathi_name = EXCLUDED.marathi_name, updated_at = CURRENT_TIMESTAMP;

-- Update system metadata to reflect Phase 3 migration
INSERT INTO system_metadata (key, value)
VALUES ('phase_3_mandi_pipeline', 'MIGRATED')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
