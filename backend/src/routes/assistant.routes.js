import express from 'express';
import { config } from '../config/index.js';
import { createSarvamClient, MAX_TTS_CHARS, SarvamError } from '../services/sarvam.service.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Voice endpoints (Sarvam AI speech-to-text and text-to-speech), behind Firebase authentication:
 *   GET  /api/assistant/capabilities            what is configured (never exposes the key)
 *   POST /api/assistant/transcribe?language=    raw audio body (audio/*, <= 2 MB) -> { transcript }
 *   POST /api/assistant/speak                   { text, language } -> { audioBase64, mimeType }
 * Audio is forwarded to Sarvam and discarded; nothing is stored. The chatbot itself is the
 * Copilot (POST /api/copilot/chat): this router only turns speech into text and text into speech.
 */
export const LANGUAGES = ['en', 'hi', 'mr'];
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

const fail = (field, message) => new HttpError(400, 'VALIDATION_ERROR', message, [{ field, message }]);
const language = (value) => {
  if (value === undefined || value === null || value === '') return 'en';
  if (!LANGUAGES.includes(value)) throw fail('language', `language must be one of ${LANGUAGES.join(', ')}`);
  return value;
};
const cleanText = (value, field, max) => {
  if (typeof value !== 'string') throw fail(field, `${field} must be text`);
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) throw fail(field, `${field} is required`);
  if (text.length > max) throw fail(field, `${field} must be at most ${max} characters`);
  return text;
};

export function createAssistantRoutes({
  requireAuth,
  sarvam = createSarvamClient(config.sarvam),
  limiter = createRateLimiter({ windowMs: 60_000, max: 60, keyFn: (req) => req.auth?.uid || req.ip, code: 'ASSISTANT_RATE_LIMITED' }),
} = {}) {
  if (typeof requireAuth !== 'function') throw new Error('createAssistantRoutes requires requireAuth middleware');
  const router = express.Router();
  router.use(requireAuth, limiter);

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.get('/capabilities', (req, res) => {
    const speech = sarvam.isConfigured();
    res.json({
      status: 'success',
      data: {
        speechToText: speech,
        textToSpeech: speech,
        languages: LANGUAGES,
        limits: { maxAudioBytes: MAX_AUDIO_BYTES, maxSpeechChars: MAX_TTS_CHARS },
      },
    });
  });

  router.post('/transcribe', express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }), handle(async (req, res) => {
    const lang = language(req.query.language);
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!/^(audio|video)\/[a-z0-9.+-]+$/.test(mimeType)) throw fail('content-type', 'Send the recording with an audio/* content type');
    if (!Buffer.isBuffer(req.body) || req.body.length < 200) throw fail('audio', 'The recording is empty');
    const { transcript } = await sarvam.transcribe({ audio: req.body, mimeType: req.headers['content-type'], language: lang });
    if (!transcript) throw new HttpError(422, 'NO_SPEECH_DETECTED', 'No speech was detected in the recording.');
    res.json({ status: 'success', data: { transcript, language: lang } });
  }));

  router.post('/speak', handle(async (req, res) => {
    const lang = language(req.body?.language);
    const text = cleanText(req.body?.text, 'text', MAX_TTS_CHARS);
    try {
      const { audioBase64, mimeType } = await sarvam.synthesize({ text, language: lang });
      res.json({ status: 'success', data: { audioBase64, mimeType, language: lang } });
    } catch (err) {
      if (err instanceof SarvamError && err.code === 'NOTHING_TO_SPEAK') throw fail('text', 'There is nothing to speak in this text');
      throw err;
    }
  }));

  return router;
}

export default createAssistantRoutes;
