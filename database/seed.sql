-- =====================================================================
-- FASALYTICS SEED DATA - PHASE 1 & PHASE 3
-- Initial verification and baseline master records
-- =====================================================================

INSERT INTO system_metadata (key, value)
VALUES
    ('app_name', 'FASALYTICS'),
    ('phase', '3'),
    ('architecture', 'React + Express + PostgreSQL + FastAPI'),
    ('initialized_at', CURRENT_TIMESTAMP::text)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO health_check_audit (service_name, status, latency_ms)
VALUES
    ('express-backend', 'INITIALIZED', 0),
    ('postgresql', 'CONNECTED', 1);

INSERT INTO commodities (code, name, hindi_name, marathi_name, category, standard_unit)
VALUES
    ('ONION', 'Onion', 'à¤ªà¥à¤¯à¤¾à¤œ', 'à¤•à¤¾à¤‚à¤¦à¤¾', 'Vegetables', 'quintal'),
    ('TOMATO', 'Tomato', 'à¤Ÿà¤®à¤¾à¤Ÿà¤°', 'à¤Ÿà¥‹à¤®à¥…à¤Ÿà¥‹', 'Vegetables', 'quintal'),
    ('POTATO', 'Potato', 'à¤†à¤²à¥‚', 'à¤¬à¤Ÿà¤¾à¤Ÿà¤¾', 'Vegetables', 'quintal'),
    ('SOYBEAN', 'Soybean', 'à¤¸à¥‹à¤¯à¤¾à¤¬à¥€à¤¨', 'à¤¸à¥‹à¤¯à¤¾à¤¬à¥€à¤¨', 'Oilseeds', 'quintal'),
    ('WHEAT', 'Wheat', 'à¤—à¥‡à¤¹à¥‚à¤‚', 'à¤—à¤¹à¥‚', 'Grains', 'quintal'),
    ('COTTON', 'Cotton', 'à¤•à¤ªà¤¾à¤¸', 'à¤•à¤¾à¤ªà¥‚à¤¸', 'Fibers', 'quintal')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, hindi_name = EXCLUDED.hindi_name, marathi_name = EXCLUDED.marathi_name, updated_at = CURRENT_TIMESTAMP;

INSERT INTO mandis (code, name, hindi_name, marathi_name, state, district, market_center, latitude, longitude)
VALUES
    ('MH_PUNE_APMC', 'Pune APMC (Gultekdi)', 'à¤ªà¥à¤£à¥‡ à¤à¤ªà¥€à¤à¤®à¤¸à¥€', 'à¤ªà¥à¤£à¥‡ à¤à¤ªà¥€à¤à¤®à¤¸à¥€ (à¤—à¥à¤²à¤Ÿà¥‡à¤•à¤¡à¥€)', 'Maharashtra', 'Pune', 'Gultekdi', 18.4967, 73.8647),
    ('MH_NSK_MAIN', 'Nashik Market Yard', 'à¤¨à¤¾à¤¸à¤¿à¤• à¤®à¤¾à¤°à¥à¤•à¥‡à¤Ÿ à¤¯à¤¾à¤°à¥à¤¡', 'à¤¨à¤¾à¤¶à¤¿à¤• à¤®à¤¾à¤°à¥à¤•à¥‡à¤Ÿ à¤¯à¤¾à¤°à¥à¤¡', 'Maharashtra', 'Nashik', 'Panchavati', 19.9975, 73.7898),
    ('MH_AHM_APMC', 'Ahmednagar Mandi', 'à¤…à¤¹à¤®à¤¦à¤¨à¤—à¤° à¤®à¤‚à¤¡à¥€', 'à¤…à¤¹à¤®à¤¦à¤¨à¤—à¤° à¤•à¥ƒà¤·à¥€ à¤‰à¤¤à¥à¤ªà¤¨à¥à¤¨ à¤¬à¤¾à¤œà¤¾à¤°', 'Maharashtra', 'Ahmednagar', 'Market Yard', 19.0952, 74.7480),
    ('MH_BAR_APMC', 'Baramati APMC', 'à¤¬à¤¾à¤°à¤¾à¤®à¤¤à¥€ à¤à¤ªà¥€à¤à¤®à¤¸à¥€', 'à¤¬à¤¾à¤°à¤¾à¤®à¤¤à¥€ à¤•à¥ƒà¤·à¥€ à¤‰à¤¤à¥à¤ªà¤¨à¥à¤¨ à¤¬à¤¾à¤œà¤¾à¤°', 'Maharashtra', 'Pune', 'Baramati', 18.1519, 74.5772),
    ('MH_MUM_VASHI', 'Mumbai APMC (Vashi)', 'à¤®à¥à¤‚à¤¬à¤ˆ à¤à¤ªà¥€à¤à¤®à¤¸à¥€ (à¤µà¤¾à¤¶à¥€)', 'à¤®à¥à¤‚à¤¬à¤ˆ à¤à¤ªà¥€à¤à¤®à¤¸à¥€ (à¤µà¤¾à¤¶à¥€)', 'Maharashtra', 'Thane', 'Vashi', 19.0771, 72.9986),
    ('MH_NSK_LASALGAON', 'Lasalgaon APMC', 'à¤²à¤¾à¤¸à¤²à¤—à¤¾à¤‚à¤µ à¤à¤ªà¥€à¤à¤®à¤¸à¥€', 'à¤²à¤¾à¤¸à¤²à¤—à¤¾à¤µ à¤•à¤¾à¤‚à¤¦à¤¾ à¤®à¤¾à¤°à¥à¤•à¥‡à¤Ÿ', 'Maharashtra', 'Nashik', 'Lasalgaon', 20.1472, 74.2289)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, hindi_name = EXCLUDED.hindi_name, marathi_name = EXCLUDED.marathi_name, updated_at = CURRENT_TIMESTAMP;
