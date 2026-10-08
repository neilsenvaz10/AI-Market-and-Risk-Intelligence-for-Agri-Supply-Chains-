-- =====================================================================
-- FASALYTICS DATABASE SCHEMA - PHASE 1
-- Minimal architecture verification schema
-- =====================================================================

-- Ensure database exists (run separately in psql if needed: CREATE DATABASE fasalytics;)

-- Service Heartbeat & Metadata table for Phase 1 architecture verification
CREATE TABLE IF NOT EXISTS system_metadata (
    id SERIAL PRIMARY KEY,
    key VARCHAR(64) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Basic service health audit log
CREATE TABLE IF NOT EXISTS health_check_audit (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    latency_ms INTEGER DEFAULT 0,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
