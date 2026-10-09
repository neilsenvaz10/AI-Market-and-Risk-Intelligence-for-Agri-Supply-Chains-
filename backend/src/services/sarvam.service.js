/**
 * Sarvam AI client (speech-to-text and text-to-speech) over plain HTTPS.
 * Contract taken from the official `sarvamai` SDK (v0.1.36) and checked against the live API:
 *   POST /speech-to-text   multipart: file, model, mode, language_code, [keyterms]   -> { transcript }
 *   POST /text-to-speech   json: text, language_code, model, output_audio_codec, ... -> { audios: [base64] }
 * Auth header: `api-subscription-key`. The key is read from configuration and is never logged,
 * returned to clients or included in error messages; upstream error text is kept off the
 * response (`upstream`, not `details`). Every call has a hard timeout that also covers the body.
 *
 * Speech-to-text defaults to saaras:v4, the only model that accepts domain `keyterms` (crop and
 * market names), and falls back to saaras:v3 if v4 rejects the request. Text-to-speech uses mp3:
 * about 2.7x smaller than WAV at the same latency, which matters on mobile data.
 */
import { prepareSpeechText } from './speechText.js';

export const SPEECH_LANGUAGES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
export const MAX_TTS_CHARS = 1000;
const MAX_KEYTERMS = 50;
const MAX_KEYTERM_CHARS = 64;

/** Words speech recognition often gets wrong, per app language (crops, markets, trade terms). */
const COMMON_TERMS = ['quintal', 'mandi', 'modal price', 'APMC', 'Fasalytics'];
const MARKETS = ['Lasalgaon', 'Nashik', 'Pune', 'Azadpur', 'Mumbai', 'Nagpur', 'Solapur', 'Kolhapur', 'Ahmednagar', 'Baramati', 'Indore', 'Rajkot'];
export const KEYTERMS = {
  en: [...COMMON_TERMS, 'onion', 'tomato', 'potato', 'wheat', 'soybean', 'cotton', 'garlic', 'maize', ...MARKETS],
  hi: [...COMMON_TERMS, 'प्याज', 'टमाटर', 'आलू', 'गेहूं', 'सोयाबीन', 'कपास', 'लहसुन', 'मक्का', 'मंडी', 'क्विंटल', 'भाव', 'मोडल भाव', 'लासलगाँव', 'नासिक', 'पुणे', 'आज़ादपुर', 'मुंबई', 'नागपुर'],
  mr: [...COMMON_TERMS, 'कांदा', 'टोमॅटो', 'बटाटा', 'गहू', 'सोयाबीन', 'कापूस', 'लसूण', 'मका', 'बाजार समिती', 'क्विंटल', 'भाव', 'मोडल भाव', 'लासलगाव', 'नाशिक', 'पुणे', 'मुंबई', 'नागपूर', 'सोलापूर', 'कोल्हापूर'],
};

export function keytermsFor(language = 'en') {
  return (KEYTERMS[language] || KEYTERMS.en).map((t) => t.slice(0, MAX_KEYTERM_CHARS)).slice(0, MAX_KEYTERMS);
}

export class SarvamError extends Error {
  constructor(code, message, status = 502, upstream = null) {
    super(message);
    this.name = 'SarvamError';
    this.code = code;
    this.statusCode = status;
    this.upstream = upstream; // server-side diagnostics only: never sent to clients
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
  sttModel = 'saaras:v4',
  sttFallbackModel = 'saaras:v3',
  ttsModel = 'bulbul:v3',
  ttsCodec = 'mp3',
  ttsSpeaker,
  fetchImpl = globalThis.fetch,
} = {}) {
  const isConfigured = () => Boolean(apiKey);

  async function call(path, init, label) {
    if (!isConfigured()) throw new SarvamError('SARVAM_NOT_CONFIGURED', 'The voice service is not configured on the server.', 503);
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
      let upstream = null;
      try {
        upstream = String(JSON.parse(text)?.error?.message || '').replace(apiKey, '[key]').slice(0, 200);
      } catch {
        upstream = null;
      }
      throw new SarvamError(code, `${label} failed (HTTP ${response.status}).`, status, upstream);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new SarvamError('SARVAM_BAD_RESPONSE', `${label} returned an unreadable response.`, 502);
    }
  }

  async function transcribeWith(model, { audio, mimeType, language, keyterms }) {
    const form = new FormData();
    const extension = (mimeType.split('/')[1] || 'webm').split(';')[0];
    form.append('file', new Blob([audio], { type: mimeType.split(';')[0] }), `speech.${extension}`);
    form.append('model', model);
    form.append('mode', 'transcribe');
    form.append('language_code', SPEECH_LANGUAGES[language] || SPEECH_LANGUAGES.en);
    if (keyterms?.length && model === 'saaras:v4') form.append('keyterms', JSON.stringify(keyterms));
    return call('/speech-to-text', { method: 'POST', body: form }, 'Speech recognition');
  }

  return {
    isConfigured,

    async transcribe({ audio, mimeType = 'audio/webm', language = 'en', keyterms = keytermsFor(language) }) {
      let data;
      try {
        data = await transcribeWith(sttModel, { audio, mimeType, language, keyterms });
      } catch (err) {
        // v4 rejecting the request (e.g. a model or keyterm problem) should not break the conversation.
        const retryable = err instanceof SarvamError && err.code === 'SARVAM_BAD_REQUEST' && sttFallbackModel && sttFallbackModel !== sttModel;
        if (!retryable) throw err;
        data = await transcribeWith(sttFallbackModel, { audio, mimeType, language });
      }
      return { transcript: String(data.transcript ?? '').trim(), detectedLanguage: data.language_code ?? null };
    },

    async synthesize({ text, language = 'en' }) {
      const spoken = prepareSpeechText(text, language);
      if (!spoken) throw new SarvamError('NOTHING_TO_SPEAK', 'There is no speakable text.', 400);
      const data = await call('/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: spoken.slice(0, MAX_TTS_CHARS),
          language_code: SPEECH_LANGUAGES[language] || SPEECH_LANGUAGES.en,
          model: ttsModel,
          output_audio_codec: ttsCodec,
          ...(ttsSpeaker ? { speaker: ttsSpeaker } : {}),
        }),
      }, 'Speech synthesis');
      const audio = Array.isArray(data.audios) ? data.audios[0] : null;
      if (!audio) throw new SarvamError('SARVAM_BAD_RESPONSE', 'Speech synthesis returned no audio.', 502);
      return { audioBase64: audio, mimeType: ttsCodec === 'mp3' ? 'audio/mpeg' : 'audio/wav', spokenText: spoken };
    },
  };
}
