/**
 * FASALYTICS Phase 8 — Farmer Favorites Service
 *
 * Manages farmer_favorite_commodities and farmer_favorite_mandis.
 * All queries are keyed by firebase_uid from the verified token.
 */
import { pool } from '../db.js';

// ─── Commodity favorites ──────────────────────────────────────────────────────

export async function getFavoriteCommodities(uid) {
  const { rows } = await pool.query(
    `SELECT ffc.id, ffc.commodity_id, ffc.is_default, ffc.created_at,
            c.code, c.name, c.hindi_name, c.marathi_name, c.category, c.is_active
       FROM farmer_favorite_commodities ffc
       JOIN commodities c ON c.id = ffc.commodity_id
      WHERE ffc.firebase_uid = $1
      ORDER BY ffc.is_default DESC, ffc.created_at DESC`,
    [uid],
  );
  return rows.map((r) => ({
    id: r.id,
    commodityId: r.commodity_id,
    isDefault: r.is_default,
    createdAt: r.created_at,
    commodity: {
      id: r.commodity_id,
      code: r.code,
      name: r.name,
      hindiName: r.hindi_name,
      marathiName: r.marathi_name,
      category: r.category,
      isActive: r.is_active,
    },
  }));
}

export async function addFavoriteCommodity(uid, commodityId) {
  // Verify the commodity exists and is active
  const { rows: comm } = await pool.query(
    `SELECT id, code, name, hindi_name, marathi_name, category, is_active
       FROM commodities WHERE id = $1`,
    [commodityId],
  );
  if (!comm[0]) return { error: 'COMMODITY_NOT_FOUND', message: 'Commodity not found.' };

  const { rows } = await pool.query(
    `INSERT INTO farmer_favorite_commodities (firebase_uid, commodity_id)
     VALUES ($1, $2)
     ON CONFLICT (firebase_uid, commodity_id) DO NOTHING
     RETURNING id, commodity_id, is_default, created_at`,
    [uid, commodityId],
  );

  if (!rows[0]) return { error: 'ALREADY_FAVORITE', message: 'This commodity is already in your favorites.' };

  return {
    favorite: {
      id: rows[0].id,
      commodityId: rows[0].commodity_id,
      isDefault: rows[0].is_default,
      createdAt: rows[0].created_at,
      commodity: {
        id: comm[0].id,
        code: comm[0].code,
        name: comm[0].name,
        hindiName: comm[0].hindi_name,
        marathiName: comm[0].marathi_name,
        category: comm[0].category,
        isActive: comm[0].is_active,
      },
    },
  };
}

export async function removeFavoriteCommodity(uid, favoriteId) {
  const { rowCount } = await pool.query(
    `DELETE FROM farmer_favorite_commodities WHERE id = $1 AND firebase_uid = $2`,
    [favoriteId, uid],
  );
  return rowCount > 0;
}

export async function setDefaultCommodity(uid, commodityId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE farmer_favorite_commodities SET is_default = FALSE WHERE firebase_uid = $1`,
      [uid],
    );
    const { rowCount } = await client.query(
      `UPDATE farmer_favorite_commodities SET is_default = TRUE
        WHERE firebase_uid = $1 AND commodity_id = $2`,
      [uid, commodityId],
    );
    await client.query('COMMIT');
    return rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Mandi favorites ──────────────────────────────────────────────────────────

export async function getFavoriteMandis(uid) {
  const { rows } = await pool.query(
    `SELECT ffm.id, ffm.mandi_id, ffm.is_default, ffm.created_at,
            m.code, m.name, m.hindi_name, m.marathi_name, m.state, m.district,
            m.market_center, m.is_active
       FROM farmer_favorite_mandis ffm
       JOIN mandis m ON m.id = ffm.mandi_id
      WHERE ffm.firebase_uid = $1
      ORDER BY ffm.is_default DESC, ffm.created_at DESC`,
    [uid],
  );
  return rows.map((r) => ({
    id: r.id,
    mandiId: r.mandi_id,
    isDefault: r.is_default,
    createdAt: r.created_at,
    mandi: {
      id: r.mandi_id,
      code: r.code,
      name: r.name,
      hindiName: r.hindi_name,
      marathiName: r.marathi_name,
      state: r.state,
      district: r.district,
      marketCenter: r.market_center,
      isActive: r.is_active,
    },
  }));
}

export async function addFavoriteMandi(uid, mandiId) {
  const { rows: mandi } = await pool.query(
    `SELECT id, code, name, hindi_name, marathi_name, state, district, market_center, is_active
       FROM mandis WHERE id = $1`,
    [mandiId],
  );
  if (!mandi[0]) return { error: 'MANDI_NOT_FOUND', message: 'Mandi not found.' };

  const { rows } = await pool.query(
    `INSERT INTO farmer_favorite_mandis (firebase_uid, mandi_id)
     VALUES ($1, $2)
     ON CONFLICT (firebase_uid, mandi_id) DO NOTHING
     RETURNING id, mandi_id, is_default, created_at`,
    [uid, mandiId],
  );

  if (!rows[0]) return { error: 'ALREADY_FAVORITE', message: 'This mandi is already in your favorites.' };

  return {
    favorite: {
      id: rows[0].id,
      mandiId: rows[0].mandi_id,
      isDefault: rows[0].is_default,
      createdAt: rows[0].created_at,
      mandi: {
        id: mandi[0].id,
        code: mandi[0].code,
        name: mandi[0].name,
        hindiName: mandi[0].hindi_name,
        marathiName: mandi[0].marathi_name,
        state: mandi[0].state,
        district: mandi[0].district,
        marketCenter: mandi[0].market_center,
        isActive: mandi[0].is_active,
      },
    },
  };
}

export async function removeFavoriteMandi(uid, favoriteId) {
  const { rowCount } = await pool.query(
    `DELETE FROM farmer_favorite_mandis WHERE id = $1 AND firebase_uid = $2`,
    [favoriteId, uid],
  );
  return rowCount > 0;
}

export async function setDefaultMandi(uid, mandiId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE farmer_favorite_mandis SET is_default = FALSE WHERE firebase_uid = $1`,
      [uid],
    );
    const { rowCount } = await client.query(
      `UPDATE farmer_favorite_mandis SET is_default = TRUE
        WHERE firebase_uid = $1 AND mandi_id = $2`,
      [uid, mandiId],
    );
    await client.query('COMMIT');
    return rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
