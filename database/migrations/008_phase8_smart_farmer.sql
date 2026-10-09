-- =====================================================================
-- FASALYTICS MIGRATION 008 - PHASE 8: SMART FARMER FEATURES
--
-- Adds personalized farmer features:
--   * farmer_preferences           – per-farmer UI/notification settings
--   * farmer_favorite_commodities  – saved commodities per farmer
--   * farmer_favorite_mandis       – saved mandis per farmer
--   * farmer_price_alerts          – target-price alert rules
--   * farmer_alert_evaluations     – immutable trigger history
--   * farmer_notifications         – in-app notification inbox
--
-- Design guarantees:
--   * Additive only: no Phase 1-7 table, column or row is modified.
--   * Farmer identity is the firebase_uid from the farmers table (Phase 2).
--   * Alert evaluation uses only genuine mandi_prices rows
--     (is_sample_data = FALSE, source NOT IN ('MOCK_PROVIDER'),
--      price_unit = 'INR/quintal').
--   * Duplicate trigger prevention enforced at DB level (unique constraint
--     on alert_id + price_id in farmer_alert_evaluations).
--   * All prices stored as NUMERIC(12,2) INR/quintal.
--   * All timestamps are timezone-aware.
--   * Safe to re-run: uses IF NOT EXISTS throughout.
-- =====================================================================

-- 1. Farmer preferences --------------------------------------------------
CREATE TABLE IF NOT EXISTS farmer_preferences (
    id                      SERIAL PRIMARY KEY,
    firebase_uid            VARCHAR(128) NOT NULL UNIQUE
                                REFERENCES farmers(firebase_uid) ON DELETE CASCADE,
    preferred_language      VARCHAR(8)  NOT NULL DEFAULT 'en'
                                CHECK (preferred_language IN ('en', 'hi', 'mr')),
    default_commodity_id    INTEGER REFERENCES commodities(id) ON DELETE SET NULL,
    default_mandi_id        INTEGER REFERENCES mandis(id) ON DELETE SET NULL,
    notify_in_app           BOOLEAN NOT NULL DEFAULT TRUE,
    alert_digest            VARCHAR(16) NOT NULL DEFAULT 'immediate'
                                CHECK (alert_digest IN ('immediate', 'daily', 'off')),
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farmer_prefs_uid
    ON farmer_preferences (firebase_uid);

-- 2. Favourite commodities -----------------------------------------------
CREATE TABLE IF NOT EXISTS farmer_favorite_commodities (
    id              BIGSERIAL PRIMARY KEY,
    firebase_uid    VARCHAR(128) NOT NULL
                        REFERENCES farmers(firebase_uid) ON DELETE CASCADE,
    commodity_id    INTEGER NOT NULL
                        REFERENCES commodities(id) ON DELETE RESTRICT,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_farmer_fav_commodity UNIQUE (firebase_uid, commodity_id)
);

CREATE INDEX IF NOT EXISTS idx_fav_commodity_uid
    ON farmer_favorite_commodities (firebase_uid, created_at DESC);

-- 3. Favourite mandis ----------------------------------------------------
CREATE TABLE IF NOT EXISTS farmer_favorite_mandis (
    id              BIGSERIAL PRIMARY KEY,
    firebase_uid    VARCHAR(128) NOT NULL
                        REFERENCES farmers(firebase_uid) ON DELETE CASCADE,
    mandi_id        INTEGER NOT NULL
                        REFERENCES mandis(id) ON DELETE RESTRICT,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_farmer_fav_mandi UNIQUE (firebase_uid, mandi_id)
);

CREATE INDEX IF NOT EXISTS idx_fav_mandi_uid
    ON farmer_favorite_mandis (firebase_uid, created_at DESC);

-- 4. Price-alert rules ---------------------------------------------------
CREATE TABLE IF NOT EXISTS farmer_price_alerts (
    id                  BIGSERIAL PRIMARY KEY,
    firebase_uid        VARCHAR(128) NOT NULL
                            REFERENCES farmers(firebase_uid) ON DELETE CASCADE,
    commodity_id        INTEGER NOT NULL
                            REFERENCES commodities(id) ON DELETE RESTRICT,
    mandi_id            INTEGER NOT NULL
                            REFERENCES mandis(id) ON DELETE RESTRICT,
    target_price        NUMERIC(12, 2) NOT NULL
                            CHECK (target_price > 0),
    price_unit          VARCHAR(32) NOT NULL DEFAULT 'INR/quintal'
                            CHECK (price_unit = 'INR/quintal'),
    condition           VARCHAR(8) NOT NULL
                            CHECK (condition IN ('gte', 'lte')),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at   TIMESTAMP WITH TIME ZONE,
    freshness_hours     SMALLINT NOT NULL DEFAULT 48
                            CHECK (freshness_hours BETWEEN 1 AND 720),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_farmer_alert UNIQUE (firebase_uid, commodity_id, mandi_id, condition)
);

CREATE INDEX IF NOT EXISTS idx_price_alert_uid
    ON farmer_price_alerts (firebase_uid, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alert_eval
    ON farmer_price_alerts (is_active, commodity_id, mandi_id);

-- 5. Alert evaluation / trigger history ----------------------------------
CREATE TABLE IF NOT EXISTS farmer_alert_evaluations (
    id                      BIGSERIAL PRIMARY KEY,
    alert_id                BIGINT NOT NULL
                                REFERENCES farmer_price_alerts(id) ON DELETE CASCADE,
    price_id                INTEGER NOT NULL
                                REFERENCES mandi_prices(id) ON DELETE RESTRICT,
    firebase_uid            VARCHAR(128) NOT NULL
                                REFERENCES farmers(firebase_uid) ON DELETE CASCADE,
    commodity_id            INTEGER NOT NULL,
    mandi_id                INTEGER NOT NULL,
    target_price            NUMERIC(12, 2) NOT NULL,
    condition               VARCHAR(8) NOT NULL,
    actual_price            NUMERIC(12, 2) NOT NULL,
    price_unit              VARCHAR(32) NOT NULL DEFAULT 'INR/quintal',
    observation_date        DATE NOT NULL,
    observation_source      VARCHAR(64) NOT NULL,
    evaluated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    triggered_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_alert_evaluation UNIQUE (alert_id, price_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_eval_uid
    ON farmer_alert_evaluations (firebase_uid, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_eval_alert
    ON farmer_alert_evaluations (alert_id, triggered_at DESC);

-- 6. In-app notifications ------------------------------------------------
CREATE TABLE IF NOT EXISTS farmer_notifications (
    id              BIGSERIAL PRIMARY KEY,
    firebase_uid    VARCHAR(128) NOT NULL
                        REFERENCES farmers(firebase_uid) ON DELETE CASCADE,
    evaluation_id   BIGINT REFERENCES farmer_alert_evaluations(id) ON DELETE CASCADE,
    notification_type VARCHAR(32) NOT NULL DEFAULT 'alert_triggered'
                        CHECK (notification_type IN ('alert_triggered', 'system')),
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_uid
    ON farmer_notifications (firebase_uid, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_eval
    ON farmer_notifications (evaluation_id);
