import { pool } from '../../db.js';
import { buildWelcomeEmail } from './welcomeEmail.template.js';

const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 10;

/**
 * Idempotent welcome-email workflow.
 *
 * A row is "claimed" with a single atomic UPDATE (status -> 'sending'), so
 * concurrent requests, retries or multiple server instances can never send the
 * same farmer two welcome emails. Delivery failures never touch the profile
 * itself — they are recorded on the row and retried later.
 *
 * @param {{ provider: object, dashboardUrl?: string, logger?: Console }} deps
 */
export function createWelcomeEmailService({ provider, dashboardUrl, logger = console }) {
  async function claim(uid) {
    const { rows } = await pool.query(
      `UPDATE farmers
          SET welcome_email_status = 'sending',
              welcome_email_claimed_at = CURRENT_TIMESTAMP,
              welcome_email_attempts = welcome_email_attempts + 1
        WHERE firebase_uid = $1
          AND registration_completed_at IS NOT NULL
          AND email IS NOT NULL
          AND email_verified = TRUE
          AND welcome_email_attempts < $2
          AND (
                welcome_email_status IN ('pending', 'failed', 'not_configured')
             OR (welcome_email_status = 'sending'
                 AND welcome_email_claimed_at < CURRENT_TIMESTAMP - make_interval(mins => $3))
          )
        RETURNING id, full_name, email, phone_number`,
      [uid, MAX_ATTEMPTS, STALE_CLAIM_MINUTES],
    );
    return rows[0] || null;
  }

  async function record(id, status, { providerMessageId = null, error = null } = {}) {
    await pool.query(
      `UPDATE farmers
          SET welcome_email_status = $2::varchar,
              welcome_email_sent_at = CASE WHEN $2::varchar = 'sent' THEN CURRENT_TIMESTAMP ELSE welcome_email_sent_at END,
              welcome_email_provider_id = COALESCE($3::varchar, welcome_email_provider_id),
              welcome_email_last_error = $4::varchar,
              -- not_configured is not a delivery attempt; keep the retry budget for real sends
              welcome_email_attempts = CASE WHEN $2::varchar = 'not_configured' THEN welcome_email_attempts - 1 ELSE welcome_email_attempts END
        WHERE id = $1`,
      [id, status, providerMessageId, error ? String(error).slice(0, 500) : null],
    );
  }

  /**
   * Sends the welcome email for a farmer at most once.
   * @returns {Promise<'sent'|'failed'|'not_configured'|'skipped'>} 'skipped' = not eligible or already handled
   */
  async function sendWelcomeEmailOnce(uid) {
    const farmer = await claim(uid);
    if (!farmer) return 'skipped';

    if (!provider.configured) {
      await record(farmer.id, 'not_configured', { error: provider.reason });
      logger.warn(`[WelcomeEmail] Not sent to farmer ${farmer.id}: email provider not configured (${provider.reason}).`);
      return 'not_configured';
    }

    const message = buildWelcomeEmail({
      fullName: farmer.full_name,
      email: farmer.email,
      phoneNumber: farmer.phone_number,
      dashboardUrl,
    });

    try {
      const { providerMessageId } = await provider.send({
        to: farmer.email,
        ...message,
        idempotencyKey: `fasalytics-welcome-${farmer.id}`,
      });
      await record(farmer.id, 'sent', { providerMessageId });
      logger.log(`[WelcomeEmail] Sent to farmer ${farmer.id} via ${provider.name}.`);
      return 'sent';
    } catch (err) {
      await record(farmer.id, 'failed', { error: err.message });
      logger.error(`[WelcomeEmail] Delivery failed for farmer ${farmer.id}: ${err.message}`);
      return 'failed';
    }
  }

  /** Retries undelivered welcome emails (startup + periodic). */
  async function retryPending(limit = 50) {
    if (!provider.configured) return { attempted: 0 };
    const { rows } = await pool.query(
      `SELECT firebase_uid FROM farmers
        WHERE welcome_email_status IN ('pending', 'failed', 'not_configured', 'sending')
          AND registration_completed_at IS NOT NULL
          AND email_verified = TRUE
          AND welcome_email_attempts < $1
        ORDER BY registration_completed_at
        LIMIT $2`,
      [MAX_ATTEMPTS, limit],
    );
    const results = [];
    for (const { firebase_uid: uid } of rows) {
      results.push(await sendWelcomeEmailOnce(uid));
    }
    return { attempted: rows.length, results };
  }

  /** Fire-and-forget wrapper for request handlers: never throws, never delays the response. */
  function queueWelcomeEmail(uid) {
    sendWelcomeEmailOnce(uid).catch((err) => logger.error('[WelcomeEmail] Unexpected error:', err.message));
  }

  return { sendWelcomeEmailOnce, retryPending, queueWelcomeEmail, providerName: provider.name, isConfigured: provider.configured };
}
