-- =====================================================================
-- FASALYTICS SEED DATA - PHASE 1
-- Initial verification records
-- =====================================================================

INSERT INTO system_metadata (key, value)
VALUES 
    ('app_name', 'FASALYTICS'),
    ('phase', '1'),
    ('architecture', 'React + Express + PostgreSQL + FastAPI'),
    ('initialized_at', CURRENT_TIMESTAMP::text)
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO health_check_audit (service_name, status, latency_ms)
VALUES 
    ('express-backend', 'INITIALIZED', 0),
    ('postgresql', 'CONNECTED', 1);
