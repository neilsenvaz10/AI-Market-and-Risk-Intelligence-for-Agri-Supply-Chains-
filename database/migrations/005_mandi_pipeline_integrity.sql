-- =====================================================================
-- FASALYTICS MIGRATION 005 - PHASE 3: MANDI DATA INTEGRITY
--
-- * missing prices / arrivals / variety / grade stay NULL (no invented defaults)
-- * source identity, original names and identifiers are kept on every row
-- * explicit price and arrival units (INR/quintal, tonne)
-- * sample (MOCK) rows can never be labelled as genuine source data
-- * price history is protected (ON DELETE RESTRICT)
-- * one row per source observation; other sources keep their own rows
-- * revisions and conflicts are recorded instead of being overwritten/discarded
-- * per-source sync state and a resolved view that never double-counts
--
-- Idempotent and non-destructive: no table, column or row is dropped.
-- Runs in one transaction (migration runner), so a failure changes nothing.
-- =====================================================================

-- The view (section 8) depends on column types changed below; it is recreated at the end.
DROP VIEW IF EXISTS mandi_prices_resolved;

-- 1. Source registry -----------------------------------------------------
CREATE TABLE IF NOT EXISTS mandi_sources (
    code VARCHAR(32) PRIMARY KEY,
    label VARCHAR(160) NOT NULL,
    publisher VARCHAR(300),
    access_method VARCHAR(300),
    precedence SMALLINT NOT NULL,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE,
    terms TEXT
);

INSERT INTO mandi_sources (code, label, publisher, access_method, precedence, is_sample, terms) VALUES
    ('DATA_GOV_IN', 'data.gov.in (Agmarknet daily mandi prices)',
     'Directorate of Marketing and Inspection, Ministry of Agriculture and Farmers Welfare; generated through the AGMARKNET portal and published on the Open Government Data Platform India',
     'OGD API resource 9ef84268-d588-465a-a308-a864a43d0070 (api.data.gov.in)', 40, FALSE,
     'Government Open Data License - India'),
    ('CEDA', 'CEDA, Ashoka University (Agmarknet data)',
     'Centre for Economic Data and Analysis, Ashoka University (compiled from AGMARKNET)',
     'CEDA API v1 /agmarknet (api.ceda.ashoka.edu.in)', 30, FALSE,
     'Non-commercial use with attribution to CEDA, Ashoka University'),
    ('MOCK_PROVIDER', 'Synthetic sample data (not real market prices)', NULL,
     'Generated locally for isolated tests only', 0, TRUE, NULL)
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label, publisher = EXCLUDED.publisher, access_method = EXCLUDED.access_method,
    precedence = EXCLUDED.precedence, is_sample = EXCLUDED.is_sample, terms = EXCLUDED.terms;

-- 2. mandi_prices: no invented values ------------------------------------
ALTER TABLE mandi_prices ALTER COLUMN min_price DROP NOT NULL;
ALTER TABLE mandi_prices ALTER COLUMN max_price DROP NOT NULL;
ALTER TABLE mandi_prices ALTER COLUMN arrivals_quantity DROP DEFAULT;
ALTER TABLE mandi_prices ALTER COLUMN variety DROP DEFAULT;
ALTER TABLE mandi_prices ALTER COLUMN grade DROP DEFAULT;
ALTER TABLE mandi_prices ALTER COLUMN unit DROP DEFAULT;
ALTER TABLE mandi_prices ALTER COLUMN variety TYPE VARCHAR(200);
ALTER TABLE mandi_prices ALTER COLUMN grade TYPE VARCHAR(100);
ALTER TABLE mandi_prices ALTER COLUMN min_price TYPE NUMERIC(12, 2);
ALTER TABLE mandi_prices ALTER COLUMN max_price TYPE NUMERIC(12, 2);
ALTER TABLE mandi_prices ALTER COLUMN modal_price TYPE NUMERIC(12, 2);
ALTER TABLE mandi_prices ALTER COLUMN arrivals_quantity TYPE NUMERIC(14, 3);
ALTER TABLE commodities ALTER COLUMN category DROP DEFAULT;

ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS price_unit VARCHAR(32);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS arrival_unit VARCHAR(16);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_record_key VARCHAR(200);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_market_id VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_commodity_id VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_state_id VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_district_id VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_market_name VARCHAR(200);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_commodity_name VARCHAR(200);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_state_name VARCHAR(100);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_district_name VARCHAR(100);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_variety VARCHAR(200);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_grade VARCHAR(100);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS quality_flags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS ingestion_run_id INTEGER;

-- Legacy rows (old 003 / schema.sql): keep values, make their state explicit.
UPDATE mandi_prices SET is_sample_data = (source = 'MOCK_PROVIDER') WHERE is_sample_data IS NULL;
UPDATE mandi_prices SET price_unit = 'INR/quintal' WHERE price_unit IS NULL AND unit = 'quintal';
UPDATE mandi_prices
SET quality_flags = array_append(quality_flags, 'LEGACY_ARRIVAL_UNIT_UNKNOWN')
WHERE arrival_unit IS NULL AND arrivals_quantity IS NOT NULL
  AND NOT ('LEGACY_ARRIVAL_UNIT_UNKNOWN' = ANY (quality_flags));
ALTER TABLE mandi_prices ALTER COLUMN is_sample_data SET DEFAULT FALSE;
ALTER TABLE mandi_prices ALTER COLUMN is_sample_data SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mandi_prices_modal_positive') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT mandi_prices_modal_positive CHECK (modal_price > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mandi_prices_price_unit_valid') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT mandi_prices_price_unit_valid
            CHECK (price_unit IS NULL OR price_unit = 'INR/quintal');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mandi_prices_arrival_unit_valid') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT mandi_prices_arrival_unit_valid
            CHECK (arrival_unit IS NULL OR arrival_unit = 'tonne');
    END IF;
    -- Synthetic rows can never carry a genuine source, and MOCK rows are always flagged.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mandi_prices_sample_flag_consistent') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT mandi_prices_sample_flag_consistent
            CHECK (NOT (is_sample_data AND source IN ('DATA_GOV_IN', 'CEDA'))
                   AND (source <> 'MOCK_PROVIDER' OR is_sample_data));
    END IF;
END $$;

-- 3. Protect price history: CASCADE -> RESTRICT ----------------------------
DO $$
DECLARE
    fk RECORD;
BEGIN
    FOR fk IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'mandi_prices'::regclass AND c.contype = 'f'
          AND c.conname NOT IN ('mandi_prices_mandi_fk', 'mandi_prices_commodity_fk')
    LOOP
        EXECUTE format('ALTER TABLE mandi_prices DROP CONSTRAINT %I', fk.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mandi_prices_mandi_fk') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT mandi_prices_mandi_fk
            FOREIGN KEY (mandi_id) REFERENCES mandis(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mandi_prices_commodity_fk') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT mandi_prices_commodity_fk
            FOREIGN KEY (commodity_id) REFERENCES commodities(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- 4. One row per source observation (grade included; NULLs compare equal) ---
ALTER TABLE mandi_prices DROP CONSTRAINT IF EXISTS uq_mandi_commodity_date_variety_source;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mandi_prices_observation') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT uq_mandi_prices_observation
            UNIQUE NULLS NOT DISTINCT (source, mandi_id, commodity_id, price_date, variety, grade);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mandi_prices_market_day ON mandi_prices (mandi_id, commodity_id, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_source_date ON mandi_prices (source, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_mandi_prices_run ON mandi_prices (ingestion_run_id);

-- 5. Audit trail: revisions of an observation by its own source ------------
CREATE TABLE IF NOT EXISTS mandi_price_revisions (
    id BIGSERIAL PRIMARY KEY,
    price_id INTEGER NOT NULL REFERENCES mandi_prices(id) ON DELETE RESTRICT,
    ingestion_run_id INTEGER,
    previous_values JSONB NOT NULL,
    new_values JSONB NOT NULL,
    revised_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mandi_price_revisions_price ON mandi_price_revisions (price_id);

-- 6. Conflicts kept for review (never silently discarded) ------------------
CREATE TABLE IF NOT EXISTS mandi_price_conflicts (
    id BIGSERIAL PRIMARY KEY,
    conflict_key VARCHAR(400) NOT NULL UNIQUE,
    conflict_type VARCHAR(40) NOT NULL
        CHECK (conflict_type IN ('SAME_SOURCE_CONFLICT', 'CROSS_SOURCE_CONFLICT')),
    mandi_id INTEGER REFERENCES mandis(id) ON DELETE RESTRICT,
    commodity_id INTEGER REFERENCES commodities(id) ON DELETE RESTRICT,
    price_date DATE,
    price_id_a INTEGER REFERENCES mandi_prices(id) ON DELETE RESTRICT,
    price_id_b INTEGER REFERENCES mandi_prices(id) ON DELETE RESTRICT,
    source_a VARCHAR(64),
    source_b VARCHAR(64),
    modal_price_a NUMERIC(12, 2),
    modal_price_b NUMERIC(12, 2),
    details JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    ingestion_run_id INTEGER,
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mandi_price_conflicts_open ON mandi_price_conflicts (status, detected_at DESC);

-- 7. Run log and per-source sync state ------------------------------------
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS mode VARCHAR(16);
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS window_from DATE;
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS window_to DATE;
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS records_unchanged INTEGER DEFAULT 0;
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS records_failed INTEGER DEFAULT 0;
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS conflicts_detected INTEGER DEFAULT 0;
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS is_sample_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(64);
ALTER TABLE pipeline_sync_logs ADD COLUMN IF NOT EXISTS rejection_summary JSONB;

CREATE TABLE IF NOT EXISTS mandi_source_sync_state (
    source VARCHAR(32) PRIMARY KEY REFERENCES mandi_sources(code) ON DELETE RESTRICT,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    last_success_at TIMESTAMP WITH TIME ZONE,
    last_status VARCHAR(32),
    last_error TEXT,
    last_run_id INTEGER,
    last_window_from DATE,
    last_window_to DATE,
    latest_reporting_date DATE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. Resolved view: for each market, commodity and day only the highest-precedence
--    source is returned (all of its varieties), so sources are never summed together.
CREATE OR REPLACE VIEW mandi_prices_resolved AS
SELECT ranked.*
FROM (
    SELECT mp.*,
           COALESCE(s.precedence, 10) AS source_precedence,
           COALESCE(s.label, mp.source) AS source_label,
           DENSE_RANK() OVER (
               PARTITION BY mp.mandi_id, mp.commodity_id, mp.price_date
               ORDER BY COALESCE(s.precedence, 10) DESC, mp.source
           ) AS source_rank,
           COUNT(*) OVER (PARTITION BY mp.mandi_id, mp.commodity_id, mp.price_date) AS rows_for_market_day
    FROM mandi_prices mp
    LEFT JOIN mandi_sources s ON s.code = mp.source
) ranked
WHERE ranked.source_rank = 1;
