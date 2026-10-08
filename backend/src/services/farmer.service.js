import { pool } from '../db.js';

const COLUMNS = `id, firebase_uid, full_name, phone_number, state, district, village,
  primary_crop, crop_quantity, quantity_unit, preferred_language, created_at, updated_at,
  email, email_verified, phone_verified, registration_completed_at, welcome_email_status`;

// API (camelCase) -> column (snake_case). Only these columns may be written by the farmer.
const WRITABLE_COLUMNS = {
  fullName: 'full_name',
  state: 'state',
  district: 'district',
  village: 'village',
  primaryCrop: 'primary_crop',
  cropQuantity: 'crop_quantity',
  quantityUnit: 'quantity_unit',
  preferredLanguage: 'preferred_language',
};

/** Converts a farmers row into the public API shape (firebase_uid is not exposed). */
export function toFarmerDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    emailVerified: row.email_verified,
    phoneNumber: row.phone_number,
    phoneVerified: row.phone_verified,
    state: row.state,
    district: row.district,
    village: row.village,
    primaryCrop: row.primary_crop,
    cropQuantity: Number(row.crop_quantity),
    quantityUnit: row.quantity_unit,
    preferredLanguage: row.preferred_language,
    registrationCompletedAt: row.registration_completed_at,
    welcomeEmailStatus: row.welcome_email_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findFarmerByUid(uid) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM farmers WHERE firebase_uid = $1`, [uid]);
  return rows[0] || null;
}

/**
 * Inserts a completed farmer profile. Identity fields come only from the
 * verified Firebase token. Returns null if a profile already exists for the UID.
 * Phone/email collisions with another UID surface as 23505 errors.
 */
export async function createFarmer(identity, data) {
  const { rows } = await pool.query(
    `INSERT INTO farmers (firebase_uid, phone_number, phone_verified, email, email_verified,
        full_name, state, district, village, primary_crop, crop_quantity, quantity_unit,
        preferred_language, registration_completed_at, welcome_email_status)
     VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, 'pending')
     ON CONFLICT (firebase_uid) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      identity.uid, identity.phoneNumber, identity.email, identity.emailVerified,
      data.fullName, data.state, data.district, data.village,
      data.primaryCrop, data.cropQuantity, data.quantityUnit, data.preferredLanguage,
    ],
  );
  return rows[0] || null;
}

/**
 * Mirrors verified token claims (email, email_verified, phone) onto the profile
 * so PostgreSQL reflects Firebase as the source of truth. No-op when unchanged.
 */
export async function syncIdentity(identity) {
  const { rows } = await pool.query(
    `UPDATE farmers
        SET email = COALESCE($2, email),
            email_verified = CASE WHEN $2 IS NULL THEN email_verified ELSE $3 END,
            phone_number = COALESCE($4, phone_number),
            phone_verified = phone_verified OR $4 IS NOT NULL
      WHERE firebase_uid = $1
        AND (email IS DISTINCT FROM COALESCE($2, email)
          OR email_verified IS DISTINCT FROM (CASE WHEN $2 IS NULL THEN email_verified ELSE $3 END)
          OR phone_number IS DISTINCT FROM COALESCE($4, phone_number)
          OR (NOT phone_verified AND $4 IS NOT NULL))
      RETURNING ${COLUMNS}`,
    [identity.uid, identity.email, identity.emailVerified, identity.phoneNumber],
  );
  return rows[0] || null;
}

/** Updates whitelisted columns for the farmer owning `uid`. Returns null if no profile exists. */
export async function updateFarmer(uid, data) {
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(WRITABLE_COLUMNS)) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      values.push(data[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findFarmerByUid(uid);

  values.push(uid);
  const { rows } = await pool.query(
    `UPDATE farmers SET ${sets.join(', ')} WHERE firebase_uid = $${values.length} RETURNING ${COLUMNS}`,
    values,
  );
  return rows[0] || null;
}
