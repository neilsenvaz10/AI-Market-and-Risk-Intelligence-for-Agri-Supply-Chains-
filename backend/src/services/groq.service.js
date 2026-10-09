/**
 * Groq chat client (OpenAI-compatible API): POST {baseUrl}/chat/completions with a Bearer key.
 * The key is read once from configuration; it is never logged, returned to clients or put in
 * error messages. The timeout also covers reading the response body.
 */
export class GroqError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'GroqError';
    this.code = code;
    this.statusCode = status;
    this.expose = true;
  }
}

const STATUS_MAP = {
  400: ['GROQ_BAD_REQUEST', 502],
  401: ['GROQ_AUTH_FAILED', 502],
  403: ['GROQ_AUTH_FAILED', 502],
  404: ['GROQ_MODEL_UNAVAILABLE', 502],
  429: ['GROQ_QUOTA_EXCEEDED', 503],
};

export function createGroqClient({
  apiKey,
  baseUrl = 'https://api.groq.com/openai/v1',
  model = 'llama-3.3-70b-versatile',
  timeoutMs = 20000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const isConfigured = () => Boolean(apiKey);

  return {
    isConfigured,

    async chat({ messages, maxTokens = 600 }) {
      if (!isConfigured()) throw new GroqError('GROQ_NOT_CONFIGURED', 'The chat service is not configured on the server.', 503);
      let response;
      let text;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        text = await response.text();
      } catch (err) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        throw new GroqError(timedOut ? 'GROQ_TIMEOUT' : 'GROQ_UNREACHABLE', timedOut ? 'Chat timed out.' : 'Chat could not be reached.', timedOut ? 504 : 502);
      }
      if (!response.ok) {
        const [code, status] = STATUS_MAP[response.status] || ['GROQ_UPSTREAM_ERROR', 502];
        throw new GroqError(code, `Chat failed (HTTP ${response.status}).`, status);
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new GroqError('GROQ_BAD_RESPONSE', 'Chat returned an unreadable response.', 502);
      }
      const reply = String(data?.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      if (!reply) throw new GroqError('GROQ_BAD_RESPONSE', 'Chat returned an empty reply.', 502);
      return { reply };
    },
  };
}
