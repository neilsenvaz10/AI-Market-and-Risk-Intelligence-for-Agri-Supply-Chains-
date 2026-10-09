/**
 * HTTP helper for source adapters: timeout, bounded retries with exponential
 * backoff (honouring Retry-After), request spacing and credential redaction.
 * Errors never contain API keys or Authorization headers.
 */

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SECRET_QUERY_PARAMS = ['api-key', 'api_key', 'apikey', 'key', 'token', 'access_token'];

/**
 * Strips credentials from free text (error messages, log lines) before it is logged,
 * stored in pipeline_sync_logs or printed by a CLI. Two layers:
 *   - exact values: any known secret passed in `secrets` is removed wherever it appears;
 *   - patterns: `api-key=...`, `token=...` style parameters and `Bearer <token>` values.
 */
export function redactText(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join('REDACTED');
  }
  return out
    .replace(/\b(api[-_]?key|apikey|access[-_]?token|token|key)=([^&\s"')]+)/gi, '$1=REDACTED')
    .replace(/(["']?(?:api[-_]?key|apikey|access[-_]?token|token|key)["']?\s*[:=]\s*["'])([^"',\s}]+)(["']?)/gi, '$1REDACTED$3')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer REDACTED');
}

export class SourceHttpError extends Error {
  constructor(message, { status = null, code = 'SOURCE_HTTP_ERROR', retryable = false, url = null } = {}) {
    super(redactText(message));
    this.name = 'SourceHttpError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.url = url;
  }
}

/** Removes credential-bearing query parameters before a URL is logged or stored. */
export function redactUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const name of SECRET_QUERY_PARAMS) {
      if (url.searchParams.has(name)) url.searchParams.set(name, 'REDACTED');
    }
    return url.toString();
  } catch {
    return '[unparseable url]';
  }
}

/**
 * Reads a response body with its own deadline. The request timer only covers the time
 * until headers arrive, so a stalled or slow-drip body would otherwise wait forever.
 * Both the per-request timeout and the caller's abort signal end the read.
 */
async function readBody(response, { timeoutMs, signal, label, url, controller }) {
  let timer;
  let onAbort;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error('body timeout'));
      reject(new SourceHttpError(`${label} response body timed out after ${timeoutMs} ms`, { code: 'TIMEOUT', retryable: true, url }));
    }, timeoutMs);
    onAbort = () => reject(new SourceHttpError(`${label} request aborted`, { code: 'ABORTED', url }));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([response.text(), guard]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    guard.catch(() => {});
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('Aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Aborted'));
    }, { once: true });
  });

function retryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Creates a JSON client that spaces requests by `requestIntervalMs`.
 * `fetchImpl` is injectable so tests never touch the network.
 */
export function createSourceHttpClient({
  timeoutMs = 20000,
  retries = 3,
  requestIntervalMs = 1000,
  baseBackoffMs = 1000,
  maxBackoffMs = 60000,
  fetchImpl = globalThis.fetch,
  log = console,
} = {}) {
  let lastRequestAt = 0;

  async function spaceRequests(signal) {
    const wait = lastRequestAt + requestIntervalMs - Date.now();
    if (wait > 0) await sleep(wait, signal);
    lastRequestAt = Date.now();
  }

  async function requestJson(url, { method = 'GET', headers = {}, body, signal, label = 'source' } = {}) {
    const safeUrl = redactUrl(url);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      await spaceRequests(signal);
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: { Accept: 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) throw new SourceHttpError(`${label} request aborted`, { code: 'ABORTED', url: safeUrl });
        const timedOut = controller.signal.aborted;
        const error = new SourceHttpError(
          timedOut ? `${label} request timed out after ${timeoutMs} ms` : `${label} network error: ${err.cause?.code || err.code || err.message}`,
          { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', retryable: true, url: safeUrl }
        );
        if (attempt > retries) throw error;
        const delay = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
        log.warn?.(`[SourceHttp] ${error.message}; retry ${attempt}/${retries} in ${delay} ms (${safeUrl})`);
        await sleep(delay, signal);
        continue;
      }
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);

      if (response.ok) {
        const text = await readBody(response, { timeoutMs, signal, label, url: safeUrl, controller });
        try {
          return { status: response.status, data: JSON.parse(text), rawText: text, headers: response.headers };
        } catch {
          throw new SourceHttpError(`${label} returned a non-JSON body (HTTP ${response.status})`, {
            status: response.status, code: 'INVALID_JSON', url: safeUrl,
          });
        }
      }

      const retryable = RETRYABLE_STATUS.has(response.status);
      const error = new SourceHttpError(`${label} responded HTTP ${response.status}`, {
        status: response.status,
        code: response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
        retryable,
        url: safeUrl,
      });
      // Body is drained but never echoed: error bodies can reflect submitted credentials.
      await readBody(response, { timeoutMs, signal, label, url: safeUrl, controller }).catch(() => {});
      if (!retryable || attempt > retries) throw error;
      const delay = Math.min(maxBackoffMs, retryAfterMs(response.headers.get('retry-after')) ?? baseBackoffMs * 2 ** (attempt - 1));
      log.warn?.(`[SourceHttp] ${error.message}; retry ${attempt}/${retries} in ${delay} ms (${safeUrl})`);
      await sleep(delay, signal);
    }
  }

  return { requestJson };
}

export default createSourceHttpClient;
