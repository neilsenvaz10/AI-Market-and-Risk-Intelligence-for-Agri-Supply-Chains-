/**
 * FASALYTICS Phase 8 — Price Alert Service
 *
 * Manages farmer_price_alerts CRUD.
 * Identity always comes from req.auth.uid (server-derived).
 */
import { pool } from '../db.js';

const ALERT_COLS = `
  a.id, a.firebase_uid, a.commodity_id, a.mandi_id,
  a.target_price, a.price_unit, a.condition, a.is_active,
  a.last_triggered_at, a.freshness_hours, a.created_at, a.updated_at,
  c.code AS commodity_code, c.name AS commodity_name,
  c.hindi_name AS commodity_hindi_name, c.marathi_name AS commodity_marathi_name,
  m.code AS mandi_code, m.name AS mandi_name, m.state AS mandi_state,
  m.district AS mandi_district`;

export function toAlertDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    commodityId: row.commodity_id,
    mandiId: row.mandi_id,
    targetPrice: Number(row.target_price),
    priceUnit: row.price_unit,
    condition: row.condition,
    isActive: row.is_active,
    lastTriggeredAt: row.last_triggered_at,
    freshnessHours: row.freshness_hours,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commodity: {
      id: row.commodity_id,
      code: row.commodity_code,
      name: row.commodity_name,
      hindiName: row.commodity_hindi_name,
      marathiName: row.commodity_marathi_name,
    },
    mandi: {
      id: row.mandi_id,
      code: row.mandi_code,
      name: row.mandi_name,
      state: row.mandi_state,
      district: row.mandi_district,
    },
  };
}

const ALERT_JOIN = `
  FROM farmer_price_alerts a
  JOIN commodities c ON c.id = a.commodity_id
  JOIN mandis m ON m.id = a.mandi_id`;

export async function getAlerts(uid) {
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLS} ${ALERT_JOIN}
      WHERE a.firebase_uid = $1
      ORDER BY a.is_active DESC, a.created_at DESC`,
    [uid],
  );
  return rows.map(toAlertDto);
}

export async function getAlertById(uid, alertId) {
  const { rows } = await pool.query(
    `SELECT ${ALERT_COLS} ${ALERT_JOIN}
      WHERE a.id = $1 AND a.firebase_uid = $2`,
    [alertId, uid],
  );
  return rows[0] ? toAlertDto(rows[0]) : null;
}

export async function createAlert(uid, data) {
  const { commodityId, mandiId, targetPrice, condition, freshnessHours } = data;

  // Verify commodity exists
  const { rows: comm } = await pool.query('SELECT id FROM commodities WHERE id = $1', [commodityId]);
  if (!comm[0]) return { error: 'COMMODITY_NOT_FOUND', message: 'Commodity not found.' };

  // Verify mandi exists
  const { rows: mandi } = await pool.query('SELECT id FROM mandis WHERE id = $1', [mandiId]);
  if (!mandi[0]) return { error: 'MANDI_NOT_FOUND', message: 'Mandi not found.' };

  const { rows } = await pool.query(
    `INSERT INTO farmer_price_alerts
       (firebase_uid, commodity_id, mandi_id, target_price, condition, freshness_hours)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (firebase_uid, commodity_id, mandi_id, condition) DO NOTHING
     RETURNING id`,
    [uid, commodityId, mandiId, targetPrice, condition, freshnessHours || 48],
  );

  if (!rows[0]) return { error: 'ALERT_EXISTS', message: 'An alert with the same commodity, mandi and condition already exists.' };

  return getAlertById(uid, rows[0].id);
}

export async function updateAlert(uid, alertId, data) {
  const sets = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(data, 'targetPrice')) {
    if (typeof data.targetPrice !== 'number' || data.targetPrice <= 0) {
      return { error: 'INVALID_TARGET_PRICE', message: 'Target price must be a positive number.' };
    }
    values.push(data.targetPrice);
    sets.push(`target_price = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'condition')) {
    if (!['gte', 'lte'].includes(data.condition)) {
      return { error: 'INVALID_CONDITION', message: 'Condition must be gte or lte.' };
    }
    values.push(data.condition);
    sets.push(`condition = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'isActive')) {
    if (typeof data.isActive !== 'boolean') {
      return { error: 'INVALID_IS_ACTIVE', message: 'isActive must be a boolean.' };
    }
    values.push(data.isActive);
    sets.push(`is_active = $${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'freshnessHours')) {
    const fh = Number(data.freshnessHours);
    if (!Number.isInteger(fh) || fh < 1 || fh > 720) {
      return { error: 'INVALID_FRESHNESS', message: 'freshnessHours must be between 1 and 720.' };
    }
    values.push(fh);
    sets.push(`freshness_hours = $${values.length}`);
  }

  if (sets.length === 0) return getAlertById(uid, alertId);

  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(alertId, uid);

  const { rowCount } = await pool.query(
    `UPDATE farmer_price_alerts SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND firebase_uid = $${values.length}`,
    values,
  );
  if (!rowCount) return { error: 'NOT_FOUND', message: 'Alert not found.' };
  return getAlertById(uid, alertId);
}

export async function deleteAlert(uid, alertId) {
  const { rowCount } = await pool.query(
    `DELETE FROM farmer_price_alerts WHERE id = $1 AND firebase_uid = $2`,
    [alertId, uid],
  );
  return rowCount > 0;
}
