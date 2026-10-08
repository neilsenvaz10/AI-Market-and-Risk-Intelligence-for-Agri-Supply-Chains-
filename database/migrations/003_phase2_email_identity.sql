-- =====================================================================
-- FASALYTICS MIGRATION 003 - PHASE 2 (AUTH ENHANCEMENT)
-- Email identity, verification flags, registration completion and
-- idempotent welcome-email delivery tracking.
--
-- Incremental and idempotent: only ADDs columns/indexes to `farmers`.
-- Firebase UID remains the identity link. No passwords, OTP codes or
-- private credentials are stored. Verification flags mirror the claims
-- of the verified Firebase ID token and are refreshed on each session.
-- =====================================================================

ALTER TABLE farmers ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS registration_completed_at TIMESTAMP WITH TIME ZONE;

-- Welcome email delivery state machine:
--   pending -> sending -> sent
--                     \-> failed          (retried later)
--   not_configured    (no email provider; retried once configured)
--   skipped           (profiles created before email registration existed)
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS welcome_email_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS welcome_email_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS welcome_email_claimed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS welcome_email_provider_id VARCHAR(128);
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS welcome_email_last_error VARCHAR(500);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'farmers_welcome_email_status_valid') THEN
        ALTER TABLE farmers ADD CONSTRAINT farmers_welcome_email_status_valid
            CHECK (welcome_email_status IN ('pending', 'sending', 'sent', 'failed', 'not_configured', 'skipped'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'farmers_email_format') THEN
        ALTER TABLE farmers ADD CONSTRAINT farmers_email_format
            CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
    END IF;
END $$;

-- One profile per email address (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS farmers_email_lower_key ON farmers (lower(email)) WHERE email IS NOT NULL;
-- Retry worker scans undelivered welcome emails.
CREATE INDEX IF NOT EXISTS idx_farmers_welcome_email_pending
    ON farmers (welcome_email_status)
    WHERE welcome_email_status IN ('pending', 'sending', 'failed', 'not_configured');

-- Backfill rows created by migration 002 (phone-OTP registrations):
-- their phone was verified by Firebase; they registered before welcome emails existed.
UPDATE farmers
SET phone_verified = TRUE,
    registration_completed_at = COALESCE(registration_completed_at, created_at),
    welcome_email_status = 'skipped'
WHERE registration_completed_at IS NULL;
