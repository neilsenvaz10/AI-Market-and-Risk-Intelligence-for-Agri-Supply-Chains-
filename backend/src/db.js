import pg from 'pg';
import { config } from './config/index.js';

const { Pool } = pg;

// PostgreSQL DATE values (e.g. mandi reporting dates) are calendar days, not
// instants. By default node-postgres turns them into local-midnight Date objects,
// which serialise to the previous day in UTC (2026-10-08 -> "2026-10-07T18:30Z" in
// IST). Keep them as the exact 'YYYY-MM-DD' text the database stores.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

const poolConfig = config.database.connectionString
  ? { connectionString: config.database.connectionString }
  : {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
    };

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected client error:', err.message);
});

/**
 * Checks PostgreSQL connectivity by running SELECT 1
 * @returns {Promise<{ ok: boolean, timestamp?: string, error?: string }>}
 */
export async function checkDatabaseConnection() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT 1 AS connected, NOW() AS server_time');
    return {
      ok: true,
      serverTime: result.rows[0].server_time,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

export default pool;
