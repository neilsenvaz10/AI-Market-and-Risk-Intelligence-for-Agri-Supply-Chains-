/**
 * FASALYTICS - Groq LLM client (OpenAI-compatible chat completions).
 *
 * Two problems make a hard-wired single model fragile, and this client handles both:
 *
 *  1. Groq retires models. A model name that disappears made every call fail and the Copilot
 *     silently fell back to canned text. Models that are "not found" are skipped (and
 *     remembered), and if none of the preferred ones exist the account's model list is
 *     queried (GET /models) to find any usable chat model.
 *  2. Free-tier limits are per model (about 8,000 tokens a minute). A model that answers 429 is
 *     put on a short cooldown and the next model is tried immediately, so a conversation keeps
 *     flowing instead of stalling.
 *
 * Each model family also gets the request parameters it needs so hidden reasoning never ends
 * up in the reply. The API key is only ever sent as a Bearer header and never put in errors.
 */

/** Best first. Chosen for fast, grounded, multilingual (English / Hindi / Marathi) answers. */
export const GROQ_MODEL_PREFERENCE = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

// Models that are not text chat models (speech, safety classifiers, TTS, tiny context).
const NOT_CHAT_MODEL = /whisper|orpheus|guard|safeguard|embed|tts|allam/i;
const DEFAULT_COOLDOWN_MS = 20_000;

export class GroqError extends Error {
  constructor(message, { statusCode = 502, code = 'GROQ_ERROR', details = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'GroqError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
    this.expose = true;
  }
}

/** Extra request parameters per model family (keeps hidden reasoning out of the reply). */
export function modelRequestParams(model = '') {
  if (/^openai\/gpt-oss/.test(model)) return { reasoning_effort: 'low' };
  if (/^qwen\//.test(model)) return { reasoning_effort: 'none' };
  return {};
}

/** Removes reasoning blocks some models emit inline. */
export function cleanModelText(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '') // an unterminated block means the reply was cut off while "thinking"
    .trim();
}

/** "24.342s", "11m31.2s", "697ms" -> milliseconds (null when unreadable). */
export function parseDurationMs(text) {
  if (!text) return null;
  let total = 0;
  let matched = false;
  for (const [, value, unit] of String(text).matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    total += Number(value) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]);
  }
  return matched ? total : null;
}

const isModelMissing = (status, body) => {
  const code = body?.error?.code || '';
  const message = body?.error?.message || '';
  return status === 404
    || /model_not_found|model_decommissioned/i.test(code)
    || /model.*(does not exist|not found|decommission|deprecated|no longer supported)/i.test(message);
};

export class GroqService {
  constructor({
    apiKey, // undefined -> read GROQ_API_KEY lazily, so module import order / dotenv timing cannot leave it unset
    model = process.env.GROQ_MODEL || process.env.GROQ_CHAT_MODEL || GROQ_MODEL_PREFERENCE[0],
    baseUrl = 'https://api.groq.com/openai/v1',
    timeoutMs = 12000,
    maxRetries = 1,
    modelCacheMs = 6 * 60 * 60 * 1000,
    totalBudgetMs = 25000,
    fetchFn = globalThis.fetch,
  } = {}) {
    this._apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.modelCacheMs = modelCacheMs;
    this.totalBudgetMs = totalBudgetMs;
    this.fetchFn = fetchFn;
    this.lastModel = null; // the model that answered most recently
    this.cooldownUntil = new Map(); // model -> time until which it is rate limited
    this.unavailableUntil = new Map(); // model -> time until which it is known not to exist for this key
  }

  get apiKey() {
    const raw = this._apiKey !== undefined ? this._apiKey : process.env.GROQ_API_KEY;
    return raw ? String(raw).trim() : null;
  }

  isConfigured() {
    const key = this.apiKey;
    return Boolean(key && key.length > 5);
  }

  /** The model the next request will try first. */
  getModel() {
    return this.#candidates()[0] || this.lastModel || this.model;
  }

  #candidates(extra = []) {
    const now = Date.now();
    const unique = [...new Set([this.lastModel, this.model, ...GROQ_MODEL_PREFERENCE, ...extra].filter(Boolean))];
    const usable = unique.filter((m) => !(this.unavailableUntil.get(m) > now));
    const ready = usable.filter((m) => !(this.cooldownUntil.get(m) > now));
    return ready.length ? ready : usable;
  }

  /** Lists chat models the account can use. */
  async listModels() {
    const res = await this.#request('/models', { method: 'GET' });
    if (!res.ok) {
      throw new GroqError(res.status === 401 ? 'Groq authentication failed. Please verify API key.' : `Groq model list failed (HTTP ${res.status}).`, {
        statusCode: 502, code: res.status === 401 ? 'GROQ_UNAUTHORIZED' : 'GROQ_API_ERROR',
      });
    }
    const data = await res.json();
    return (data?.data || [])
      .filter((m) => m?.id && m.active !== false && !NOT_CHAT_MODEL.test(m.id))
      .map((m) => ({ id: m.id, contextWindow: m.context_window || 0 }));
  }

  async generateChatCompletion({ messages, temperature = 0.3, maxTokens = 400, signal } = {}) {
    if (!this.isConfigured()) {
      throw new GroqError('Groq API key is not configured on the server.', { statusCode: 503, code: 'GROQ_NOT_CONFIGURED' });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new GroqError('Messages array must not be empty.', { statusCode: 400, code: 'INVALID_MESSAGES' });
    }
    const options = {
      temperature: Math.max(0, Math.min(1, Number(temperature) || 0.3)),
      max_tokens: Math.max(16, Math.min(2048, Number(maxTokens) || 400)),
    };

    const started = Date.now();
    const tried = new Set();
    let lastError = null;
    let discovered = false;
    let discoveredIds = [];

    for (;;) {
      const candidate = this.#candidates(discoveredIds).find((m) => !tried.has(m));
      if (!candidate) {
        // Every known model failed. If they were missing, ask Groq what exists and try those once.
        if (!discovered && lastError?.code === 'GROQ_MODEL_NOT_FOUND') {
          discovered = true;
          discoveredIds = (await this.listModels()).sort((a, b) => b.contextWindow - a.contextWindow).map((m) => m.id);
          for (const id of discoveredIds) this.unavailableUntil.delete(id);
          if (discoveredIds.some((id) => !tried.has(id))) continue;
        }
        throw lastError || new GroqError('No usable Groq chat model is available for this API key.', { statusCode: 502, code: 'GROQ_MODEL_NOT_FOUND' });
      }
      tried.add(candidate);

      try {
        const result = await this.#complete(candidate, messages, options, signal);
        this.lastModel = candidate;
        return result;
      } catch (err) {
        if (!(err instanceof GroqError)) throw err;
        lastError = err;
        if (err.code === 'GROQ_RATE_LIMITED') {
          this.cooldownUntil.set(candidate, Date.now() + (err.retryAfterMs || DEFAULT_COOLDOWN_MS));
        } else if (err.code === 'GROQ_MODEL_NOT_FOUND') {
          this.unavailableUntil.set(candidate, Date.now() + this.modelCacheMs);
        } else {
          // Another model can help with timeouts, network trouble and upstream 5xx errors; not with auth or a bad request.
          const failover = ['GROQ_TIMEOUT', 'GROQ_NETWORK_ERROR'].includes(err.code) || (err.code === 'GROQ_API_ERROR' && err.statusCode >= 500);
          if (!failover) throw err;
        }
        if (Date.now() - started > this.totalBudgetMs) throw err;
      }
    }
  }

  async #complete(model, messages, options, signal) {
    const base = { model, messages, ...options };
    try {
      return await this.#post({ ...base, ...modelRequestParams(model) }, signal);
    } catch (err) {
      // A model that rejects our reasoning parameter still works without it.
      if (err instanceof GroqError && err.code === 'GROQ_API_ERROR' && /reasoning/i.test(err.details || err.message)) {
        return this.#post(base, signal);
      }
      throw err;
    }
  }

  async #request(path, init, signal) {
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onCallerAbort);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(this.baseUrl + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, ...init.headers },
        signal: controller.signal,
      });
    } catch (err) {
      if (signal?.aborted) throw new GroqError('Request cancelled by client.', { statusCode: 499, code: 'REQUEST_CANCELLED' });
      if (controller.signal.aborted || err.name === 'AbortError') throw new GroqError('Groq request timed out.', { statusCode: 504, code: 'GROQ_TIMEOUT' });
      throw new GroqError(err.message || 'Failed to reach Groq API.', { statusCode: 502, code: 'GROQ_NETWORK_ERROR' });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }

  async #post(payload, signal) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const res = await this.#request('/chat/completions', { method: 'POST', body: JSON.stringify(payload) }, signal);

      if (res.ok) {
        const data = await res.json();
        const choice = data?.choices?.[0];
        return {
          content: cleanModelText(choice?.message?.content),
          model: data?.model || payload.model,
          usage: data?.usage || null,
          finishReason: choice?.finish_reason || 'stop',
        };
      }

      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const errMsg = body?.error?.message || `Groq API responded with HTTP ${res.status}`;

      if (res.status === 429) {
        // Not retried on the same model: the caller moves on to the next model straight away.
        const header = res.headers?.get?.bind(res.headers);
        const retryAfterMs = (Number(header?.('retry-after')) * 1000)
          || parseDurationMs(header?.('x-ratelimit-reset-tokens'))
          || DEFAULT_COOLDOWN_MS;
        throw new GroqError('Groq rate limit exceeded. Please try again shortly.', {
          statusCode: 429, code: 'GROQ_RATE_LIMITED', details: errMsg, retryAfterMs: Math.min(Math.max(retryAfterMs, 2000), 60_000),
        });
      }
      if (res.status === 401) {
        throw new GroqError('Groq authentication failed. Please verify API key.', { statusCode: 502, code: 'GROQ_UNAUTHORIZED' });
      }
      if (res.status >= 500 && attempt <= this.maxRetries) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      if (isModelMissing(res.status, body)) {
        throw new GroqError(errMsg, { statusCode: 502, code: 'GROQ_MODEL_NOT_FOUND', details: errMsg });
      }
      throw new GroqError(errMsg, { statusCode: res.status >= 500 ? 502 : 400, code: 'GROQ_API_ERROR', details: errMsg });
    }
  }
}

export const defaultGroqService = new GroqService();
