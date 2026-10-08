-- =====================================================================
-- FASALYTICS MIGRATION 002 - PHASE 2
-- Farmer profiles linked to Firebase Authentication users
--
-- Incremental and idempotent: safe to run against an existing Phase 1
-- database. Does not modify or drop any Phase 1 tables.
-- No OTP codes, passwords or auth secrets are stored here — Firebase
-- owns authentication; this table only holds the verified UID/phone.
-- =====================================================================

-- gen_random_uuid() is built into PostgreSQL 13+; pgcrypto covers older servers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS farmers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid       VARCHAR(128) NOT NULL,
    full_name          VARCHAR(100) NOT NULL,
    phone_number       VARCHAR(16),
    state              VARCHAR(64)  NOT NULL,
    district           VARCHAR(64)  NOT NULL,
    village            VARCHAR(100),
    primary_crop       VARCHAR(64)  NOT NULL,
    crop_quantity      NUMERIC(12, 2) NOT NULL,
    quantity_unit      VARCHAR(10)  NOT NULL DEFAULT 'quintal',
    preferred_language VARCHAR(2)   NOT NULL DEFAULT 'en',
    created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT farmers_firebase_uid_key UNIQUE (firebase_uid),
    CONSTRAINT farmers_phone_number_key UNIQUE (phone_number),
    CONSTRAINT farmers_full_name_not_blank CHECK (char_length(btrim(full_name)) >= 2),
    CONSTRAINT farmers_phone_e164 CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT farmers_state_not_blank CHECK (char_length(btrim(state)) > 0),
    CONSTRAINT farmers_district_not_blank CHECK (char_length(btrim(district)) > 0),
    CONSTRAINT farmers_primary_crop_not_blank CHECK (char_length(btrim(primary_crop)) > 0),
    CONSTRAINT farmers_crop_quantity_positive CHECK (crop_quantity > 0),
    CONSTRAINT farmers_quantity_unit_valid CHECK (quantity_unit IN ('kg', 'quintal')),
    CONSTRAINT farmers_preferred_language_valid CHECK (preferred_language IN ('en', 'hi', 'mr'))
);

-- firebase_uid and phone_number are already indexed by their UNIQUE constraints.
-- Regional lookups (mandi matching, alerts) will filter by state/district.
CREATE INDEX IF NOT EXISTS idx_farmers_state_district ON farmers (state, district);
CREATE INDEX IF NOT EXISTS idx_farmers_primary_crop ON farmers (primary_crop);

-- Keep updated_at current on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_farmers_updated_at ON farmers;
CREATE TRIGGER trg_farmers_updated_at
    BEFORE UPDATE ON farmers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
