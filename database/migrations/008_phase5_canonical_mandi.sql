-- =====================================================================
-- FASALYTICS MIGRATION 008 - PHASE 5: CANONICAL MANDI PRICE MODEL
--
-- Phase 5 needs one canonical mandi-price model shared by every source
-- (CEDA, data.gov.in, AGMARKNET, MOCK) without creating competing tables
-- that would duplicate the same observation.
--
-- Design decisions (deliberate):
--   * ADDITIVE ONLY. `mandi_prices` is the single physical observation table
--     and is extended in place. No Phase 1-4 column is renamed, retyped or
--     dropped, so Phase 3 ingestion and Phase 4 forecasting keep working
--     unchanged. Nothing in `farmers` / authentication is touched.
--   * Canonical field NAMES are exposed by the `mandi_prices_canonical`
--     VIEW rather than by duplicating columns. `reported_date` is
--     `price_date`, `minimum_price` is `min_price`, `original_price_unit`
--     is `unit` (as published by the source) and `normalized_price_unit`
--     is `price_unit` (always INR/quintal). One physical copy, two
--     vocabularies.
--   * Source identifiers are preserved verbatim (`source_record_key`,
--     `source_*_id`, `source_*_name`). New code columns hold the SOURCE's
--     own codes for variety/state/district/market; a missing code stays
--     NULL and is never guessed from a name.
--
-- Idempotent and non-destructive: safe on a fresh database, on a database
-- already at 008, and on one holding Phase 3/4 data.
-- Runs inside the migration runner's transaction.
-- =====================================================================

-- 1. Additive canonical columns ------------------------------------------
-- Source-provided codes. NULL means "the source did not publish one".
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS variety_code VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS state_code VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS district_code VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS market_code VARCHAR(64);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS commodity_category_code VARCHAR(64);

-- Which dataset/resource actually produced the row (e.g. a data.gov.in
-- resource id, or a CEDA endpoint name). Lets one source expose several
-- datasets without losing provenance.
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS source_dataset VARCHAR(120);

-- Row-level integrity: sha256 over the normalised identity+values, so a
-- re-download can be proved byte-identical and drift can be detected.
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- Canonical validity state, derived from the fine-grained quality_flags.
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS quality_status VARCHAR(16) NOT NULL DEFAULT 'VALID';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mandi_prices_quality_status_valid') THEN
        ALTER TABLE mandi_prices ADD CONSTRAINT mandi_prices_quality_status_valid
            CHECK (quality_status IN ('VALID', 'FLAGGED', 'REJECTED'));
    END IF;
END $$;

-- 2. Backfill quality_status from the existing flags ----------------------
-- Rows carrying any flag are at least FLAGGED; the legacy repair flags and
-- outlier flags do not mean the observation is unusable, so they stay
-- FLAGGED rather than REJECTED. REJECTED is reserved for rows a validator
-- explicitly refuses (none exist at migration time).
UPDATE mandi_prices
SET quality_status = CASE
        WHEN quality_flags IS NULL OR cardinality(quality_flags) = 0 THEN 'VALID'
        ELSE 'FLAGGED'
    END
WHERE quality_status IS NULL OR quality_status = 'VALID';

-- 3. Source-record idempotency -------------------------------------------
-- The Phase 3 unique rule (source, mandi, commodity, price_date, variety,
-- grade) makes a re-ingest idempotent by OBSERVATION identity. Phase 5 also
-- needs idempotency by SOURCE record identity, because a source can reissue
-- the same record id with corrected values.
--
-- A duplicate here would mean the same source record is already stored
-- twice, which makes a unique index unsafe. Fail loudly with an actionable
-- message instead of creating a silently lossy index. Verified against the
-- development database (0 duplicates) before this migration was written.
DO $$
DECLARE
    dupes INTEGER;
BEGIN
    SELECT COUNT(*) INTO dupes
    FROM (
        SELECT source, source_record_key
        FROM mandi_prices
        WHERE source_record_key IS NOT NULL AND source_record_key <> ''
        GROUP BY source, source_record_key
        HAVING COUNT(*) > 1
    ) AS d;

    IF dupes > 0 THEN
        RAISE EXCEPTION
            'Cannot add uq_mandi_prices_source_record: % duplicate (source, source_record_key) group(s) exist. Deduplicate before migrating.',
            dupes;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mandi_prices_source_record
    ON mandi_prices (source, source_record_key)
    WHERE source_record_key IS NOT NULL AND source_record_key <> '';

-- 4. Query indexes for the Phase 5 read paths ----------------------------
-- Dataset-scoped provenance queries and the data-status endpoint.
CREATE INDEX IF NOT EXISTS idx_mandi_prices_source_dataset
    ON mandi_prices (source, source_dataset);
-- Quality reporting / filtering.
CREATE INDEX IF NOT EXISTS idx_mandi_prices_quality
    ON mandi_prices (quality_status);
-- Geographic filtering by source codes.
CREATE INDEX IF NOT EXISTS idx_mandi_prices_geo_codes
    ON mandi_prices (state_code, district_code);
-- Commodity + date range scans used by history queries and coverage reports.
CREATE INDEX IF NOT EXISTS idx_mandi_prices_commodity_date
    ON mandi_prices (commodity_id, price_date DESC);
-- Market + commodity + date is already covered by idx_mandi_prices_market_day.

-- 5. Canonical view ------------------------------------------------------
-- The single documented vocabulary the Phase 5 API and quality report read.
-- `quality_status` ordering is preserved; `is_sample_data` is surfaced so a
-- synthetic row can never be mistaken for a genuine observation.
CREATE OR REPLACE VIEW mandi_prices_canonical AS
SELECT
    mp.id                        AS observation_id,
    mp.source                    AS source,
    mp.source_dataset            AS source_dataset,
    mp.source_record_key         AS source_record_id,
    mp.source_commodity_id       AS source_commodity_id,
    mp.source_market_id          AS source_market_id,
    mp.source_state_id           AS source_state_id,
    mp.source_district_id        AS source_district_id,
    mp.source_commodity_name     AS source_commodity_name,
    mp.source_market_name        AS source_market_name,
    mp.source_state_name         AS source_state_name,
    mp.source_district_name      AS source_district_name,
    c.category                   AS commodity_category,
    mp.commodity_category_code   AS commodity_category_code,
    c.name                       AS commodity,
    c.code                       AS commodity_code,
    mp.source_commodity_name     AS commodity_name_as_published,
    mp.variety                   AS variety,
    mp.variety_code              AS variety_code,
    mp.source_variety            AS variety_as_published,
    mp.grade                     AS grade,
    m.state                      AS state,
    mp.state_code                AS state_code,
    m.district                   AS district,
    mp.district_code             AS district_code,
    m.name                       AS mandi,
    COALESCE(mp.market_code, m.code) AS market_code,
    m.id                         AS mandi_id,
    c.id                         AS commodity_id,
    mp.price_date                AS reported_date,
    mp.min_price                 AS minimum_price,
    mp.max_price                 AS maximum_price,
    mp.modal_price               AS modal_price,
    -- As published by the source, then the canonical normalised unit.
    mp.unit                      AS original_price_unit,
    mp.price_unit                AS normalized_price_unit,
    mp.arrivals_quantity         AS arrival_quantity,
    mp.arrival_unit              AS arrival_unit,
    mp.fetched_at                AS fetched_at,
    mp.created_at                AS created_at,
    mp.updated_at                AS updated_at,
    mp.ingestion_run_id          AS ingestion_run_id,
    mp.quality_status            AS quality_status,
    mp.quality_flags             AS quality_flags,
    mp.content_hash              AS content_hash,
    mp.is_sample_data            AS is_sample_data,
    COALESCE(s.precedence, 10)   AS source_precedence,
    COALESCE(s.label, mp.source) AS source_label
FROM mandi_prices mp
JOIN mandis m       ON m.id = mp.mandi_id
JOIN commodities c  ON c.id = mp.commodity_id
LEFT JOIN mandi_sources s ON s.code = mp.source;

COMMENT ON VIEW mandi_prices_canonical IS
    'Phase 5 canonical mandi-price vocabulary over mandi_prices. reported_date=price_date, minimum_price=min_price, original_price_unit=unit (as published), normalized_price_unit=price_unit (INR/quintal).';
