/**
 * FASALYTICS Phase 8 — Farmer Preferences Service
 *
 * Reads and writes farmer_preferences rows.
 * Identity always comes from req.auth.uid (server-derived), never from the body.
 */
import { pool } from '../db.js';

const PREF_COLS = `fp.id, fp.firebase_uid, fp.preferred_language,
  fp.default_commodity_id, fp.default_mandi_id,
  fp.notify_in_app, fp.alert_digest,
  fp.created_at, fp.updated_at,
  c.code AS default_commodity_code, c.name AS default_commodity_name,
  m.code AS default_mandi_code, m.name AS default_mandi_name`;

export function toPreferencesDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    preferredLanguage: row.preferred_language,
    defaultCommodity: row.default_commodity_id
      ? { id: row.default_commodity_id, code: row.default_commodity_code, name: row.default_commodity_name }
      : null,
    defaultMandi: row.default_mandi_id
      ? { id: row.default_mandi_id, code: row.default_mandi_code, name: row.default_mandi_name }
      : null,
    notifyInApp: row.notify_in_app,
    alertDigest: row.alert_digest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrCreatePreferences(uid) {
  // Try to get existing preferences
  const { rows } = await pool.query(
    `SELECT ${PREF_COLS}
       FROM farmer_preferences fp
       LEFT JOIN commodities c ON c.id = fp.default_commodity_id
       LEFT JOIN mandis m ON m.id = fp.default_mandi_id
      WHERE fp.firebase_uid = $1`,
    [uid],
  );
  if (rows[0]) return rows[0];

  // Auto-create with defaults
  const { rows: created } = await pool.query(
    `INSERT INTO farmer_preferences (firebase_uid)
     VALUES ($1)
     ON CONFLICT (firebase_uid) DO NOTHING
     RETURNING id, firebase_uid, preferred_language, default_commodity_id, default_mandi_id,
               notify_in_app, alert_digest, created_at, updated_at`,
    [uid],
  );
  // Fetch with JOINs if just created
  if (created[0]) {
    const { rows: full } = await pool.query(
      `SELECT ${PREF_COLS}
         FROM farmer_preferences fp
         LEFT JOIN commodities c ON c.id = fp.default_commodity_id
         LEFT JOIN mandis m ON m.id = fp.default_mandi_id
        WHERE fp.firebase_uid = $1`,
      [uid],
    );
    return full[0] || null;
  }
  return null;
}

const ALLOWED_PREFS = {
  preferredLanguage: { col: 'preferred_language', validate: (v) => ['en', 'hi', 'mr'].includes(v) },
  defaultCommodityId: { col: 'default_commodity_id', validate: (v) => v === null || (Number.isInteger(Number(v)) && Number(v) > 0) },
  defaultMandiId: { col: 'default_mandi_id', validate: (v) => v === null || (Number.isInteger(Number(v)) && Number(v) > 0) },
  notifyInApp: { col: 'notify_in_app', validate: (v) => typeof v === 'boolean' },
  alertDigest: { col: 'alert_digest', validate: (v) => ['immediate', 'daily', 'off'].includes(v) },
};

export async function updatePreferences(uid, data) {
  const sets = [];
  const values = [];
  const errors = {};

  for (const [key, def] of Object.entries(ALLOWED_PREFS)) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    if (!def.validate(data[key])) {
      errors[key] = `Invalid value for ${key}`;
      continue;
    }
    values.push(data[key] === null ? null : data[key]);
    sets.push(`${def.col} = $${values.length}`);
  }

  if (Object.keys(errors).length) return { errors };
  if (sets.length === 0) {
    const row = await getOrCreatePreferences(uid);
    return { preferences: toPreferencesDto(row) };
  }

  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(uid);

  const { rows } = await pool.query(
    `UPDATE farmer_preferences SET ${sets.join(', ')} WHERE firebase_uid = $${values.length}
     RETURNING id, firebase_uid, preferred_language, default_commodity_id, default_mandi_id,
               notify_in_app, alert_digest, created_at, updated_at`,
    values,
  );
  if (!rows[0]) {
    // Preferences row didn't exist yet
    await getOrCreatePreferences(uid);
    return updatePreferences(uid, data);
  }
  const { rows: full } = await pool.query(
    `SELECT ${PREF_COLS}
       FROM farmer_preferences fp
       LEFT JOIN commodities c ON c.id = fp.default_commodity_id
       LEFT JOIN mandis m ON m.id = fp.default_mandi_id
      WHERE fp.firebase_uid = $1`,
    [uid],
  );
  return { preferences: toPreferencesDto(full[0]) };
}
