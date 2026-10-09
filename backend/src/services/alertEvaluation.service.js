/**
 * FASALYTICS Phase 8 — Alert Evaluation Engine
 *
 * Deterministic, idempotent evaluation of active price alerts against
 * genuine mandi_prices observations.
 *
 * ELIGIBILITY RULES (never relaxed without explicit documented policy):
 *  1. Alert must be active (is_active = TRUE).
 *  2. Observation must be genuine: is_sample_data = FALSE and
 *     source NOT IN ('MOCK_PROVIDER').
 *  3. Observation must have a confirmed INR/quintal price unit.
 *  4. Observation must be within the alert's freshness_hours window.
 *  5. Observation must be the LATEST for the exact commodity + mandi.
 *  6. The (alert_id, price_id) pair must not already exist in
 *     farmer_alert_evaluations (enforced at DB level by unique constraint).
 *
 * The engine does NOT auto-schedule itself. Call evaluateAllAlerts() from
 * an administrative endpoint after confirmed successful data ingestion.
 */
import { pool } from '../db.js';

/**
 * Evaluates all active alerts and creates trigger + notification records.
 * Returns { evaluated, triggered, skipped, errors }.
 *
 * @param {object} client - optional pg client (for testing)
 */
export async function evaluateAllAlerts(pgPool = pool) {
  const client = await pgPool.connect();
  let evaluated = 0;
  let triggered = 0;
  let skipped = 0;
  const errors = [];

  try {
    // Fetch all active alerts with their freshness threshold
    const { rows: alerts } = await client.query(`
      SELECT a.id, a.firebase_uid, a.commodity_id, a.mandi_id,
             a.target_price, a.condition, a.freshness_hours
        FROM farmer_price_alerts a
       WHERE a.is_active = TRUE
       ORDER BY a.id
    `);

    for (const alert of alerts) {
      evaluated += 1;
      try {
        const result = await evaluateSingleAlert(client, alert);
        if (result === 'triggered') triggered += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        errors.push({ alertId: alert.id, error: err.message });
      }
    }

    return { evaluated, triggered, skipped, errors };
  } finally {
    client.release();
  }
}

/**
 * Evaluates a single alert within the given pg client.
 * Returns 'triggered' | 'no_observation' | 'stale' | 'condition_not_met' | 'duplicate'.
 */
async function evaluateSingleAlert(client, alert) {
  // Find the latest genuine observation for this commodity+mandi
  const { rows: obs } = await client.query(`
    SELECT mp.id, mp.modal_price, mp.price_date, mp.source,
           mp.price_unit, mp.fetched_at
      FROM mandi_prices mp
      JOIN mandi_sources ms ON ms.code = mp.source
     WHERE mp.commodity_id = $1
       AND mp.mandi_id = $2
       AND mp.is_sample_data = FALSE
       AND ms.is_sample = FALSE
       AND mp.price_unit = 'INR/quintal'
       AND mp.modal_price IS NOT NULL
       AND mp.modal_price > 0
     ORDER BY mp.price_date DESC, mp.fetched_at DESC NULLS LAST
     LIMIT 1
  `, [alert.commodity_id, alert.mandi_id]);

  if (!obs[0]) return 'no_observation';

  const observation = obs[0];

  // Check freshness: price_date must be within freshness_hours of now
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - alert.freshness_hours);
  const obsDate = new Date(observation.price_date);
  // price_date is a calendar DATE (YYYY-MM-DD). Compare end-of-day.
  obsDate.setHours(23, 59, 59, 999);
  if (obsDate < cutoff) return 'stale';

  // Evaluate condition
  const actual = Number(observation.modal_price);
  const target = Number(alert.target_price);
  const conditionMet = alert.condition === 'gte' ? actual >= target : actual <= target;
  if (!conditionMet) return 'condition_not_met';

  // Insert evaluation record inside a savepoint to handle concurrent duplicates
  try {
    await client.query('SAVEPOINT sp_eval');

    const { rows: evalRows } = await client.query(`
      INSERT INTO farmer_alert_evaluations
        (alert_id, price_id, firebase_uid, commodity_id, mandi_id,
         target_price, condition, actual_price, price_unit,
         observation_date, observation_source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      alert.id, observation.id, alert.firebase_uid,
      alert.commodity_id, alert.mandi_id,
      alert.target_price, alert.condition,
      actual, 'INR/quintal',
      observation.price_date, observation.source,
    ]);

    // Update alert's last_triggered_at
    await client.query(
      `UPDATE farmer_price_alerts SET last_triggered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [alert.id],
    );

    // Create in-app notification
    const condLabel = alert.condition === 'gte' ? '≥' : '≤';
    await client.query(`
      INSERT INTO farmer_notifications
        (firebase_uid, evaluation_id, notification_type, title, body)
      VALUES ($1, $2, 'alert_triggered', $3, $4)
    `, [
      alert.firebase_uid,
      evalRows[0].id,
      'Price Alert Triggered',
      `Your price alert condition was met: reported price ₹${actual.toLocaleString('en-IN')}/quintal ${condLabel} target ₹${target.toLocaleString('en-IN')}/quintal (${observation.price_date}, source: ${observation.source}).`,
    ]);

    await client.query('RELEASE SAVEPOINT sp_eval');
    return 'triggered';
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sp_eval');
    if (err.code === '23505') return 'duplicate'; // unique constraint: already triggered
    throw err;
  }
}

/**
 * Evaluates only the alerts that match a specific commodity + mandi.
 * Used by the admin endpoint after targeted ingestion.
 */
export async function evaluateAlertsForMarket(commodityId, mandiId, pgPool = pool) {
  const client = await pgPool.connect();
  let evaluated = 0;
  let triggered = 0;
  let skipped = 0;
  const errors = [];

  try {
    const { rows: alerts } = await client.query(`
      SELECT a.id, a.firebase_uid, a.commodity_id, a.mandi_id,
             a.target_price, a.condition, a.freshness_hours
        FROM farmer_price_alerts a
       WHERE a.is_active = TRUE
         AND a.commodity_id = $1
         AND a.mandi_id = $2
       ORDER BY a.id
    `, [commodityId, mandiId]);

    for (const alert of alerts) {
      evaluated += 1;
      try {
        const result = await evaluateSingleAlert(client, alert);
        if (result === 'triggered') triggered += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        errors.push({ alertId: alert.id, error: err.message });
      }
    }

    return { evaluated, triggered, skipped, errors };
  } finally {
    client.release();
  }
}
