import express from 'express';
import { config } from '../config/index.js';
import defaultMandiService from '../services/mandi.service.js';
import { createSarvamClient, MAX_TTS_CHARS, SarvamError } from '../services/sarvam.service.js';
import { createGroqClient, GroqError } from '../services/groq.service.js';
import { buildFallbackReply, buildMessages, retrieveFacts } from '../services/assistant.service.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { HttpError, mapDatabaseError } from '../utils/httpError.js';

/**
 * Voice (Sarvam AI) and chat (Groq) assistant, all behind Firebase authentication:
 *   GET  /api/assistant/capabilities            what is configured (never exposes the key)
 *   POST /api/assistant/transcribe?language=    raw audio body (audio/*, <= 2 MB) -> { transcript }
 *   POST /api/assistant/speak                   { text, language } -> { audioBase64, mimeType }
 *   POST /api/assistant/chat                    { message, language, history? } -> grounded reply
 * Audio is forwarded to Sarvam and discarded; nothing is stored. Chat answers are grounded in
 * verified mandi price reports; if Groq fails the reply is built deterministically from those
 * same reports, never from model output.
 */
export const LANGUAGES = ['en', 'hi', 'mr'];
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_MESSAGE_CHARS = 500;

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
function cleanHistory(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw fail('history', 'history must be a list of at most 20 messages');
  return raw.slice(-6).map((m) => {
    if (!m || !['user', 'assistant'].includes(m.role)) throw fail('history', 'history roles must be user or assistant');
    return { role: m.role, content: cleanText(m.content, 'history', 1000) };
  });
}

export function createAssistantRoutes({
  requireAuth,
  sarvam = createSarvamClient(config.sarvam),
  groq = createGroqClient(config.groq),
  mandiService = defaultMandiService,
  limiter = createRateLimiter({ windowMs: 60_000, max: 30, keyFn: (req) => req.auth?.uid || req.ip, code: 'ASSISTANT_RATE_LIMITED' }),
} = {}) {
  if (typeof requireAuth !== 'function') throw new Error('createAssistantRoutes requires requireAuth middleware');
  const router = express.Router();
  router.use(requireAuth, limiter);

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err instanceof SarvamError || err instanceof GroqError || err instanceof HttpError ? err : mapDatabaseError(err));
    }
  };

  router.get('/capabilities', (req, res) => {
    const speech = sarvam.isConfigured();
    res.json({
      status: 'success',
      data: {
        speechToText: speech, textToSpeech: speech, chat: groq.isConfigured(), languages: LANGUAGES,
        grounding: 'verified mandi price reports only',
        notAvailable: ['forecast answers', 'risk assessment', 'transport cost', 'mandi recommendations'],
        limits: { maxAudioBytes: MAX_AUDIO_BYTES, maxMessageChars: MAX_MESSAGE_CHARS, maxSpeechChars: MAX_TTS_CHARS },
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
    const { audioBase64, mimeType } = await sarvam.synthesize({ text, language: lang });
    res.json({ status: 'success', data: { audioBase64, mimeType, language: lang } });
  }));

  router.post('/chat', handle(async (req, res) => {
    const lang = language(req.body?.language);
    const message = cleanText(req.body?.message, 'message', MAX_MESSAGE_CHARS);
    const history = cleanHistory(req.body?.history);
    const grounding = await retrieveFacts({ message, history, mandiService });
    const sources = grounding.facts;
    const base = { language: lang, commodity: grounding.commodityName, sources };

    const fallback = () => buildFallbackReply({ language: lang, ...grounding });
    // Without a crop there is nothing to ground: answer deterministically instead of letting a model improvise.
    if (!grounding.commodityCode || !groq.isConfigured()) {
      res.json({ status: 'success', data: { ...base, reply: fallback(), source: 'verified-data', aiUsed: false } });
      return;
    }
    try {
      const { reply } = await groq.chat({ messages: buildMessages({ message, language: lang, history, grounding }) });
      res.json({ status: 'success', data: { ...base, reply, source: 'groq-ai', aiUsed: true } });
    } catch (err) {
      if (!(err instanceof GroqError)) throw err;
      res.json({ status: 'success', data: { ...base, reply: fallback(), source: 'verified-data', aiUsed: false, aiError: err.code } });
    }
  }));

  return router;
}

export default createAssistantRoutes;
