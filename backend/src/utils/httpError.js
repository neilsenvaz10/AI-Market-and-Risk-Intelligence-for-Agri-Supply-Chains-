/**
 * Error carrying an HTTP status and a stable machine-readable code.
 * Messages on HttpError are safe to show to clients.
 */
export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '3D000', // invalid_catalog_name (database missing)
  '28P01', // invalid_password
]);

/** Maps low-level PostgreSQL / driver errors to safe HttpErrors. */
export function mapDatabaseError(err) {
  if (err instanceof HttpError) return err;
  if (DB_UNAVAILABLE_CODES.has(err.code) || /timeout|terminated/i.test(err.message || '')) {
    return new HttpError(503, 'DATABASE_UNAVAILABLE', 'The database is temporarily unavailable. Please try again shortly.');
  }
  if (err.code === '42P01') {
    return new HttpError(503, 'DATABASE_NOT_MIGRATED', 'The database schema is not up to date. Run the Phase 2 migration.');
  }
  if (err.code === '23514' || err.code === '22P02' || err.code === '22001' || err.code === '22003') {
    return new HttpError(400, 'VALIDATION_ERROR', 'One or more fields are invalid.');
  }
  return err;
}
