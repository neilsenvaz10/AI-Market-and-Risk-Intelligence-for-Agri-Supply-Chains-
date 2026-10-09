/**
 * Sarvam AI client (speech-to-text and text-to-speech) over plain HTTPS.
 * Contract taken from the official `sarvamai` SDK (v0.1.36):
 *   POST /speech-to-text         multipart: file, model, mode, language_code      -> { transcript }
 *   POST /text-to-speech         json: text, language_code, model, ...            -> { audios: [base64 wav] }
 * Auth header: `api-subscription-key`. The key is read once from configuration and is never
 * logged, returned to clients or included in error messages. Every call has a hard timeout
 * that also covers reading the response body.
 */

export const SPEECH_LANGUAGES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
export const MAX_TTS_CHARS = 1000;

export class SarvamError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'SarvamError';
    this.code = code;
    this.statusCode = status;
    this.expose = true;
  }
}

const STATUS_MAP = {
  400: ['SARVAM_BAD_REQUEST', 502],
  401: ['SARVAM_AUTH_FAILED', 502],
  403: ['SARVAM_AUTH_FAILED', 502],
  422: ['SARVAM_BAD_REQUEST', 502],
  429: ['SARVAM_QUOTA_EXCEEDED', 503],
};

export function createSarvamClient({
  apiKey,
  baseUrl = 'https://api.sarvam.ai',
  timeoutMs = 20000,
  sttModel = 'saaras:v3',
  ttsModel = 'bulbul:v3',
  fetchImpl = globalThis.fetch,
} = {}) {
  const isConfigured = () => Boolean(apiKey);

  async function call(path, init, label) {
    if (!isConfigured()) throw new SarvamError('SARVAM_NOT_CONFIGURED', 'The voice and chat service is not configured on the server.', 503);
    let response;
    let text;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, 'api-subscription-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs), // also aborts a stalled response body
      });
      text = await response.text();
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new SarvamError(timedOut ? 'SARVAM_TIMEOUT' : 'SARVAM_UNREACHABLE',
        timedOut ? `${label} timed out.` : `${label} could not be reached.`, timedOut ? 504 : 502);
    }
    if (!response.ok) {
      const [code, status] = STATUS_MAP[response.status] || ['SARVAM_UPSTREAM_ERROR', 502];
      throw new SarvamError(code, `${label} failed (HTTP ${response.status}).`, status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new SarvamError('SARVAM_BAD_RESPONSE', `${label} returned an unreadable response.`, 502);
    }
  }

  return {
    isConfigured,

    async transcribe({ audio, mimeType = 'audio/webm', language = 'en' }) {
      const form = new FormData();
      const extension = (mimeType.split('/')[1] || 'webm').split(';')[0];
      form.append('file', new Blob([audio], { type: mimeType.split(';')[0] }), `speech.${extension}`);
      form.append('model', sttModel);
      form.append('mode', 'transcribe');
      form.append('language_code', SPEECH_LANGUAGES[language] || SPEECH_LANGUAGES.en);
      const data = await call('/speech-to-text', { method: 'POST', body: form }, 'Speech recognition');
      return { transcript: String(data.transcript ?? '').trim(), detectedLanguage: data.language_code ?? null };
    },

    async synthesize({ text, language = 'en' }) {
      const data = await call('/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.slice(0, MAX_TTS_CHARS),
          language_code: SPEECH_LANGUAGES[language] || SPEECH_LANGUAGES.en,
          model: ttsModel,
        }),
      }, 'Speech synthesis');
      const audio = Array.isArray(data.audios) ? data.audios[0] : null;
      if (!audio) throw new SarvamError('SARVAM_BAD_RESPONSE', 'Speech synthesis returned no audio.', 502);
      return { audioBase64: audio, mimeType: 'audio/wav' };
    },
  };
}
