/**
 * Dedicated Groq LLM Service (Phase 7 - AI Farmer Copilot).
 *
 * Uses Groq cloud inference API (OpenAI-compatible chat completions).
 * Requests originate exclusively from Express backend.
 * Credentials are read strictly from process.env and never logged or sent to the client.
 */

export class GroqError extends Error {
  constructor(message, { statusCode = 500, code = 'GROQ_ERROR', details = null } = {}) {
    super(message);
    this.name = 'GroqError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class GroqService {
  constructor({
    apiKey = process.env.GROQ_API_KEY,
    model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    baseUrl = 'https://api.groq.com/openai/v1',
    timeoutMs = 15000,
    maxRetries = 1,
    fetchFn = globalThis.fetch,
  } = {}) {
    this.apiKey = apiKey ? String(apiKey).trim() : null;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetchFn = fetchFn;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  getModel() {
    return this.model;
  }

  async generateChatCompletion({
    messages,
    temperature = 0.2,
    maxTokens = 1024,
    signal,
  } = {}) {
    if (!this.isConfigured()) {
      throw new GroqError('Groq API key is not configured on the server.', {
        statusCode: 503,
        code: 'GROQ_NOT_CONFIGURED',
      });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new GroqError('Messages array must not be empty.', {
        statusCode: 400,
        code: 'INVALID_MESSAGES',
      });
    }

    const payload = {
      model: this.model,
      messages,
      temperature: Math.max(0, Math.min(1, Number(temperature) || 0.2)),
      max_tokens: Math.max(16, Math.min(2048, Number(maxTokens) || 1024)),
    };

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      attempt += 1;
      const controller = new AbortController();
      let timer = null;

      const onCallerAbort = () => controller.abort();
      if (signal) signal.addEventListener('abort', onCallerAbort);

      try {
        timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const authHeader = 'Bearer ' + this.apiKey;
        const res = await this.fetchFn(this.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          let errBody = null;
          try {
            errBody = await res.json();
          } catch {
            errBody = null;
          }

          const errMsg = errBody?.error?.message || `Groq API responded with HTTP ${res.status}`;

          // Handle 429 Rate Limit
          if (res.status === 429) {
            if (attempt <= this.maxRetries) {
              const retryAfter = Number(res.headers?.get?.('retry-after')) || 1;
              await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 3000)));
              continue;
            }
            throw new GroqError('Groq rate limit exceeded. Please try again shortly.', {
              statusCode: 429,
              code: 'GROQ_RATE_LIMITED',
              details: errMsg,
            });
          }

          // Handle 401 Unauthorized
          if (res.status === 401) {
            throw new GroqError('Groq authentication failed. Please verify API key.', {
              statusCode: 502,
              code: 'GROQ_UNAUTHORIZED',
            });
          }

          // Handle 503 / 5xx Server Error
          if (res.status >= 500 && attempt <= this.maxRetries) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }

          throw new GroqError(errMsg, {
            statusCode: res.status >= 500 ? 502 : 400,
            code: res.status === 404 ? 'GROQ_MODEL_NOT_FOUND' : 'GROQ_API_ERROR',
            details: errMsg,
          });
        }

        const data = await res.json();
        const choice = data?.choices?.[0];
        const content = choice?.message?.content || '';

        return {
          content,
          model: data?.model || this.model,
          usage: data?.usage || null,
          finishReason: choice?.finish_reason || 'stop',
        };
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onCallerAbort);

        if (err instanceof GroqError) throw err;

        if (controller.signal.aborted || err.name === 'AbortError') {
          if (signal?.aborted) {
            throw new GroqError('Request cancelled by client.', {
              statusCode: 499,
              code: 'REQUEST_CANCELLED',
            });
          }
          if (attempt <= this.maxRetries) {
            continue;
          }
          throw new GroqError('Groq request timed out.', {
            statusCode: 504,
            code: 'GROQ_TIMEOUT',
          });
        }

        if (attempt <= this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        throw new GroqError(err.message || 'Failed to reach Groq API.', {
          statusCode: 502,
          code: 'GROQ_NETWORK_ERROR',
        });
      } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }
}

export const defaultGroqService = new GroqService();
