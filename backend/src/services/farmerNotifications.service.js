/**
 * FASALYTICS Phase 8 — Alert History & Notifications Service
 *
 * Reads farmer_alert_evaluations and farmer_notifications.
 * All queries are keyed by firebase_uid from the verified token.
 */
import { pool } from '../db.js';

// ─── Alert History ────────────────────────────────────────────────────────────

export async function getAlertHistory(uid, { page = 1, limit = 20, commodityId, mandiId, fromDate } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const conditions = ['ae.firebase_uid = $1'];
  const values = [uid];

  if (commodityId) {
    values.push(commodityId);
    conditions.push(`ae.commodity_id = $${values.length}`);
  }
  if (mandiId) {
    values.push(mandiId);
    conditions.push(`ae.mandi_id = $${values.length}`);
  }
  if (fromDate) {
    values.push(fromDate);
    conditions.push(`ae.triggered_at >= $${values.length}`);
  }

  const where = conditions.join(' AND ');

  const { rows } = await pool.query(
    `SELECT ae.id, ae.alert_id, ae.commodity_id, ae.mandi_id,
            ae.target_price, ae.condition, ae.actual_price, ae.price_unit,
            ae.observation_date, ae.observation_source,
            ae.evaluated_at, ae.triggered_at,
            c.code AS commodity_code, c.name AS commodity_name,
            c.hindi_name AS commodity_hindi_name, c.marathi_name AS commodity_marathi_name,
            m.code AS mandi_code, m.name AS mandi_name, m.state AS mandi_state,
            m.district AS mandi_district,
            a.is_active AS alert_is_active
       FROM farmer_alert_evaluations ae
       JOIN commodities c ON c.id = ae.commodity_id
       JOIN mandis m ON m.id = ae.mandi_id
       LEFT JOIN farmer_price_alerts a ON a.id = ae.alert_id
      WHERE ${where}
      ORDER BY ae.triggered_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, safeLimit, offset],
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS total FROM farmer_alert_evaluations ae WHERE ${where}`,
    values,
  );

  const total = Number(countRows[0]?.total || 0);

  return {
    history: rows.map((r) => ({
      id: r.id,
      alertId: r.alert_id,
      commodity: { id: r.commodity_id, code: r.commodity_code, name: r.commodity_name, hindiName: r.commodity_hindi_name, marathiName: r.commodity_marathi_name },
      mandi: { id: r.mandi_id, code: r.mandi_code, name: r.mandi_name, state: r.mandi_state, district: r.mandi_district },
      targetPrice: Number(r.target_price),
      condition: r.condition,
      actualPrice: Number(r.actual_price),
      priceUnit: r.price_unit,
      observationDate: r.observation_date,
      observationSource: r.observation_source,
      evaluatedAt: r.evaluated_at,
      triggeredAt: r.triggered_at,
      alertIsActive: r.alert_is_active,
    })),
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
  };
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(uid, { unreadOnly = false, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const conditions = ['firebase_uid = $1'];
  const values = [uid];

  if (unreadOnly) conditions.push('is_read = FALSE');

  const { rows } = await pool.query(
    `SELECT id, evaluation_id, notification_type, title, body, is_read, read_at, created_at
       FROM farmer_notifications
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1}`,
    [...values, safeLimit],
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS unread FROM farmer_notifications WHERE firebase_uid = $1 AND is_read = FALSE`,
    [uid],
  );

  return {
    notifications: rows.map((r) => ({
      id: r.id,
      evaluationId: r.evaluation_id,
      type: r.notification_type,
      title: r.title,
      body: r.body,
      isRead: r.is_read,
      readAt: r.read_at,
      createdAt: r.created_at,
    })),
    unreadCount: Number(countRows[0]?.unread || 0),
  };
}

export async function markNotificationRead(uid, notificationId) {
  const { rowCount } = await pool.query(
    `UPDATE farmer_notifications
        SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND firebase_uid = $2 AND is_read = FALSE`,
    [notificationId, uid],
  );
  return rowCount > 0;
}

export async function markAllNotificationsRead(uid) {
  const { rowCount } = await pool.query(
    `UPDATE farmer_notifications
        SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
      WHERE firebase_uid = $1 AND is_read = FALSE`,
    [uid],
  );
  return rowCount;
}
