-- =====================================================================
-- FASALYTICS MIGRATION 006 - AGMARKNET COMMODITY-LEVEL DAILY REPORTS
--
-- Stores macro/national aggregated commodity reports (prices, arrivals, MSP)
-- published by AGMARKNET without fabricating mandi identifiers, districts or
-- missing values.
--
-- Idempotent and non-destructive: does not modify or delete any existing
-- mandi_prices, mandis or farmer data.
-- =====================================================================

-- 1. Register AGMARKNET in the source registry -----------------------
INSERT INTO mandi_sources (code, label, publisher, access_method, precedence, is_sample, terms)
VALUES (
    'AGMARKNET',
    'AGMARKNET (Directorate of Marketing & Inspection)',
    'Directorate of Marketing and Inspection (DMI), Ministry of Agriculture and Farmers Welfare, Govt. of India',
    'Official AGMARKNET portal export (agmarknet.gov.in)',
    45,
    FALSE,
    'Government of India open agricultural market reporting with official attribution'
)
ON CONFLICT (code) DO UPDATE SET
    label = EXCLUDED.label,
    publisher = EXCLUDED.publisher,
    access_method = EXCLUDED.access_method,
    precedence = EXCLUDED.precedence,
    is_sample = EXCLUDED.is_sample,
    terms = EXCLUDED.terms;

-- 2. Create aggregated commodity daily reports table -----------------
CREATE TABLE IF NOT EXISTS commodity_daily_reports (
    id SERIAL PRIMARY KEY,
    source VARCHAR(32) NOT NULL DEFAULT 'AGMARKNET' REFERENCES mandi_sources(code) ON DELETE RESTRICT,
    commodity_code VARCHAR(64),
    commodity_name VARCHAR(128) NOT NULL,
    commodity_group VARCHAR(64),
    report_date DATE NOT NULL,
    modal_price NUMERIC(12, 2),
    price_unit VARCHAR(32) NOT NULL DEFAULT 'INR/quintal',
    arrivals_quantity NUMERIC(14, 3),
    arrival_unit VARCHAR(16) NOT NULL DEFAULT 'tonne',
    msp NUMERIC(12, 2),
    msp_season VARCHAR(32) DEFAULT '2026-27',
    geographic_level VARCHAR(32) NOT NULL DEFAULT 'NATIONAL_AGGREGATE',
    raw_payload JSONB,
    source_file VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commodity_daily_reports UNIQUE (source, commodity_name, report_date),
    CONSTRAINT commodity_daily_reports_modal_positive CHECK (modal_price IS NULL OR modal_price > 0),
    CONSTRAINT commodity_daily_reports_price_unit_valid CHECK (price_unit = 'INR/quintal'),
    CONSTRAINT commodity_daily_reports_arrival_unit_valid CHECK (arrival_unit = 'tonne')
);

CREATE INDEX IF NOT EXISTS idx_cdr_commodity_date ON commodity_daily_reports (commodity_name, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_cdr_code_date ON commodity_daily_reports (commodity_code, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_cdr_date ON commodity_daily_reports (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_cdr_group ON commodity_daily_reports (commodity_group);
