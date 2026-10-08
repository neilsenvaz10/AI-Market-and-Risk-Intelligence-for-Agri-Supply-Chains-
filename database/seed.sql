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
