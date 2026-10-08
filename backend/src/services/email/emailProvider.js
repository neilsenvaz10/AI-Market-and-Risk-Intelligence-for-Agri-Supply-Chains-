/**
 * Transactional email providers over HTTPS (no SDK dependency).
 * API keys are read from backend environment variables only.
 *
 * EMAIL_PROVIDER=resend    -> https://resend.com      (EMAIL_API_KEY = re_...)
 * EMAIL_PROVIDER=sendgrid  -> https://sendgrid.com    (EMAIL_API_KEY = SG....)
 * unset / anything else    -> not configured (nothing is sent)
 */

class EmailProviderError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

async function postJson(fetchImpl, url, headers, body, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // 4xx (except 429) are configuration/content problems — retrying will not help.
      const retryable = res.status === 429 || res.status >= 500;
      throw new EmailProviderError(`HTTP ${res.status}: ${text.slice(0, 200)}`, { retryable });
    }
    return { res, text };
  } catch (err) {
    if (err instanceof EmailProviderError) throw err;
    throw new EmailProviderError(err.name === 'AbortError' ? 'Request timed out' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

function resendProvider({ apiKey, from, replyTo }, fetchImpl) {
  return {
    name: 'resend',
    configured: true,
    async send({ to, subject, html, text, idempotencyKey }) {
      const { text: body } = await postJson(
        fetchImpl,
        'https://api.resend.com/emails',
        { Authorization: `Bearer ${apiKey}`, ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }) },
        { from, to: [to], subject, html, text, ...(replyTo && { reply_to: replyTo }) },
      );
      return { providerMessageId: JSON.parse(body || '{}').id || null };
    },
  };
}

function sendgridProvider({ apiKey, from, replyTo }, fetchImpl) {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const fromObj = match ? { name: match[1], email: match[2] } : { email: from };
  return {
    name: 'sendgrid',
    configured: true,
    async send({ to, subject, html, text, idempotencyKey }) {
      const { res } = await postJson(
        fetchImpl,
        'https://api.sendgrid.com/v3/mail/send',
        { Authorization: `Bearer ${apiKey}` },
        {
          personalizations: [{ to: [{ email: to }], custom_args: idempotencyKey ? { idempotency_key: idempotencyKey } : undefined }],
          from: fromObj,
          ...(replyTo && { reply_to: { email: replyTo } }),
          subject,
          content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
        },
      );
      return { providerMessageId: res.headers.get('x-message-id') };
    },
  };
}

const notConfigured = (reason) => ({ name: 'none', configured: false, reason });

/** Builds the provider from config.email. Never throws for missing config. */
export function createEmailProvider(emailConfig, fetchImpl = globalThis.fetch) {
  const { provider, apiKey, from, replyTo } = emailConfig || {};
  if (!provider) return notConfigured('EMAIL_PROVIDER is not set');
  if (!apiKey) return notConfigured('EMAIL_API_KEY is not set');
  if (!from) return notConfigured('EMAIL_FROM is not set');

  switch (provider.toLowerCase()) {
    case 'resend':
      return resendProvider({ apiKey, from, replyTo }, fetchImpl);
    case 'sendgrid':
      return sendgridProvider({ apiKey, from, replyTo }, fetchImpl);
    default:
      return notConfigured(`Unsupported EMAIL_PROVIDER "${provider}" (use resend or sendgrid)`);
  }
}

export { EmailProviderError };
