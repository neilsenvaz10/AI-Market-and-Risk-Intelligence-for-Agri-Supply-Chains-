/**
 * FASALYTICS Phase 8 — Farmer Dashboard Service
 *
 * Aggregates personalized data for the farmer dashboard.
 * Returns only genuine, attributed market data. Optional Phase 5-7
 * integration points are marked clearly and return null when unavailable.
 */
import { pool } from '../db.js';
import { getOrCreatePreferences, toPreferencesDto } from './farmerPreferences.service.js';
import { getFavoriteCommodities, getFavoriteMandis } from './farmerFavorites.service.js';
import { getAlerts } from './farmerAlerts.service.js';
import { getNotifications } from './farmerNotifications.service.js';

/**
 * Returns the latest genuine mandi_prices observation for each
 * (commodity_id, mandi_id) pair in the provided list.
 * Only genuine, INR/quintal observations are returned.
 */
async function getLatestPricesForPairs(pairs) {
  if (!pairs.length) return [];

  // Build parameterized list
  const placeholders = pairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const values = pairs.flatMap(([cid, mid]) => [cid, mid]);

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (mp.commodity_id, mp.mandi_id)
            mp.id, mp.commodity_id, mp.mandi_id, mp.price_date,
            mp.modal_price, mp.min_price, mp.max_price, mp.price_unit,
            mp.source, mp.arrivals_quantity, mp.fetched_at,
            c.code AS commodity_code, c.name AS commodity_name,
            c.hindi_name AS commodity_hindi_name, c.marathi_name AS commodity_marathi_name,
            m.code AS mandi_code, m.name AS mandi_name,
            m.state AS mandi_state, m.district AS mandi_district,
            ms.label AS source_label
       FROM mandi_prices mp
       JOIN commodities c ON c.id = mp.commodity_id
       JOIN mandis m ON m.id = mp.mandi_id
       JOIN mandi_sources ms ON ms.code = mp.source
      WHERE (mp.commodity_id, mp.mandi_id) IN (${placeholders})
        AND mp.is_sample_data = FALSE
        AND ms.is_sample = FALSE
        AND mp.price_unit = 'INR/quintal'
        AND mp.modal_price IS NOT NULL
        AND mp.modal_price > 0
      ORDER BY mp.commodity_id, mp.mandi_id, mp.price_date DESC, mp.fetched_at DESC NULLS LAST`,
    values,
  );

  return rows.map((r) => ({
    commodityId: r.commodity_id,
    mandiId: r.mandi_id,
    priceDate: r.price_date,
    modalPrice: Number(r.modal_price),
    minPrice: r.min_price !== null ? Number(r.min_price) : null,
    maxPrice: r.max_price !== null ? Number(r.max_price) : null,
    priceUnit: r.price_unit,
    source: r.source,
    sourceLabel: r.source_label,
    arrivalsQuantity: r.arrivals_quantity !== null ? Number(r.arrivals_quantity) : null,
    fetchedAt: r.fetched_at,
    commodity: { code: r.commodity_code, name: r.commodity_name, hindiName: r.commodity_hindi_name, marathiName: r.commodity_marathi_name },
    mandi: { code: r.mandi_code, name: r.mandi_name, state: r.mandi_state, district: r.mandi_district },
  }));
}

/**
 * Fetches the most recent triggered alerts for this farmer (last 5).
 */
async function getRecentTriggers(uid) {
  const { rows } = await pool.query(
    `SELECT ae.id, ae.alert_id, ae.commodity_id, ae.mandi_id,
            ae.target_price, ae.condition, ae.actual_price, ae.price_unit,
            ae.observation_date, ae.observation_source, ae.triggered_at,
            c.name AS commodity_name, m.name AS mandi_name
       FROM farmer_alert_evaluations ae
       JOIN commodities c ON c.id = ae.commodity_id
       JOIN mandis m ON m.id = ae.mandi_id
      WHERE ae.firebase_uid = $1
      ORDER BY ae.triggered_at DESC
      LIMIT 5`,
    [uid],
  );
  return rows.map((r) => ({
    id: r.id,
    alertId: r.alert_id,
    commodityName: r.commodity_name,
    mandiName: r.mandi_name,
    targetPrice: Number(r.target_price),
    condition: r.condition,
    actualPrice: Number(r.actual_price),
    priceUnit: r.price_unit,
    observationDate: r.observation_date,
    observationSource: r.observation_source,
    triggeredAt: r.triggered_at,
  }));
}

export async function getFarmerDashboard(uid) {
  // Run independent queries in parallel
  const [preferences, favCommodities, favMandis, alerts, notificationsResult, recentTriggers] =
    await Promise.all([
      getOrCreatePreferences(uid).then(toPreferencesDto),
      getFavoriteCommodities(uid),
      getFavoriteMandis(uid),
      getAlerts(uid),
      getNotifications(uid, { limit: 10 }),
      getRecentTriggers(uid),
    ]);

  // Build pairs for price lookups from favorites
  const pairs = [];
  const seenPairs = new Set();
  for (const fc of favCommodities) {
    for (const fm of favMandis) {
      const key = `${fc.commodityId}:${fm.mandiId}`;
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        pairs.push([fc.commodityId, fm.mandiId]);
      }
    }
  }
  // If no full grid, also include alert pairs
  for (const alert of alerts) {
    const key = `${alert.commodityId}:${alert.mandiId}`;
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      pairs.push([alert.commodityId, alert.mandiId]);
    }
  }

  const latestPrices = pairs.length ? await getLatestPricesForPairs(pairs) : [];

  return {
    preferences,
    favoriteCommodities: favCommodities,
    favoriteMandis: favMandis,
    latestPrices,
    activeAlerts: alerts.filter((a) => a.isActive),
    inactiveAlerts: alerts.filter((a) => !a.isActive),
    recentTriggers,
    notifications: notificationsResult.notifications,
    unreadCount: notificationsResult.unreadCount,
    // Optional future integration points (always null in Phase 8 standalone)
    phase5Recommendations: null,   // Phase 5: Mandi Recommendations
    phase6RiskIndicators: null,    // Phase 6: Risk Intelligence
    phase7Copilot: null,           // Phase 7: AI Farmer Copilot
    generatedAt: new Date().toISOString(),
  };
}
