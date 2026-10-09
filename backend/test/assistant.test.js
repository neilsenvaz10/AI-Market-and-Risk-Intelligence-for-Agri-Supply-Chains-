/** Voice endpoints (Sarvam speech-to-text / text-to-speech): auth, validation, contract, key safety. No network, no database. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createRequireAuth } from '../src/middleware/auth.js';
import { createRateLimiter } from '../src/middleware/rateLimit.js';
import { KEYTERMS, createSarvamClient, keytermsFor, SarvamError } from '../src/services/sarvam.service.js';

const SECRET = 'sk_test_SECRET_DO_NOT_LEAK';
const verify = async (token) => {
  if (token !== 'valid') throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
  return { uid: 'farmer-1', email: 'f@example.in', email_verified: true, firebase: { sign_in_provider: 'password' } };
};
const fakeSarvam = (over = {}) => ({
  isConfigured: () => true,
  transcribeCalls: [],
  async transcribe(args) { this.transcribeCalls.push(args); return { transcript: 'onion price' }; },
  async synthesize() { return { audioBase64: 'SUQz', mimeType: 'audio/mpeg' }; },
  ...over,
});

const servers = [];
async function start(options = {}) {
  const app = createApp({ requireAuth: createRequireAuth(verify), welcomeEmail: { queueWelcomeEmail() {} }, assistantRoutesOptions: options });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  return (method, path, { token = 'valid', body, raw, type } = {}) => fetch(base + path, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(type && { 'Content-Type': type }) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}
after(async () => { for (const s of servers) await new Promise((r) => s.close(r)); });

test('every voice route requires authentication', async () => {
  const call = await start({ sarvam: fakeSarvam() });
  for (const [m, p] of [['GET', '/api/assistant/capabilities'], ['POST', '/api/assistant/speak'], ['POST', '/api/assistant/transcribe']]) {
    assert.equal((await call(m, p, { token: null })).status, 401, p);
  }
});

test('the duplicate Sarvam/Groq chat route is gone: the Copilot is the only chatbot', async () => {
  const call = await start({ sarvam: fakeSarvam() });
  assert.equal((await call('POST', '/api/assistant/chat', { body: { message: 'hi' } })).status, 404);
});

test('capabilities report truthfully and never expose the key', async () => {
  const on = await (await start({ sarvam: fakeSarvam() }))('GET', '/api/assistant/capabilities');
  assert.equal(on.body.data.speechToText, true);
  assert.equal(on.body.data.textToSpeech, true);
  assert.equal('chat' in on.body.data, false);
  const off = await (await start({ sarvam: createSarvamClient({ apiKey: undefined }) }))('GET', '/api/assistant/capabilities');
  assert.equal(off.body.data.speechToText, false);
  assert.equal(off.body.data.textToSpeech, false);
  assert.ok(!JSON.stringify(off.body).toLowerCase().includes('key'));
});

test('input validation: speak text, language and audio', async () => {
  const call = await start({ sarvam: fakeSarvam() });
  assert.equal((await call('POST', '/api/assistant/speak', { body: { text: '' } })).status, 400);
  assert.equal((await call('POST', '/api/assistant/speak', { body: { text: 'x'.repeat(1001) } })).status, 400);
  assert.equal((await call('POST', '/api/assistant/speak', { body: { text: 'hi', language: 'fr' } })).status, 400);
  assert.equal((await call('POST', '/api/assistant/transcribe?language=fr', { raw: Buffer.alloc(500), type: 'audio/webm' })).status, 400);
  assert.equal((await call('POST', '/api/assistant/transcribe', { raw: Buffer.alloc(10), type: 'audio/webm' })).status, 400);
  assert.equal((await call('POST', '/api/assistant/transcribe', { raw: Buffer.alloc(500), type: 'text/plain' })).status, 400);
});

test('transcribe passes the recording, its type and the language to Sarvam; speak returns playable audio', async () => {
  const sarvam = fakeSarvam();
  const call = await start({ sarvam });
  const t = await call('POST', '/api/assistant/transcribe?language=hi', { raw: Buffer.alloc(600, 1), type: 'audio/webm;codecs=opus' });
  assert.equal(t.status, 200);
  assert.equal(t.body.data.transcript, 'onion price');
  assert.equal(t.body.data.language, 'hi');
  assert.equal(sarvam.transcribeCalls[0].language, 'hi');
  assert.equal(sarvam.transcribeCalls[0].mimeType, 'audio/webm;codecs=opus');
  assert.equal(sarvam.transcribeCalls[0].audio.length, 600);

  const s = await call('POST', '/api/assistant/speak', { body: { text: 'Hello', language: 'mr' } });
  assert.equal(s.body.data.mimeType, 'audio/mpeg');
  assert.ok(s.body.data.audioBase64);
});

test('provider failures map to safe errors and never leak upstream text', async () => {
  const quota = fakeSarvam({
    synthesize: async () => { throw new SarvamError('SARVAM_QUOTA_EXCEEDED', 'Speech synthesis failed (HTTP 429).', 503, `quota for key ${SECRET}`); },
  });
  const r = await (await start({ sarvam: quota }))('POST', '/api/assistant/speak', { body: { text: 'Hello' } });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'SARVAM_QUOTA_EXCEEDED');
  assert.ok(!JSON.stringify(r.body).includes(SECRET), 'upstream diagnostics stay on the server');

  const empty = await (await start({ sarvam: fakeSarvam({ transcribe: async () => ({ transcript: '' }) }) }))('POST', '/api/assistant/transcribe', { raw: Buffer.alloc(600, 1), type: 'audio/webm' });
  assert.equal(empty.status, 422);
  assert.equal(empty.body.code, 'NO_SPEECH_DETECTED');

  const nothing = await (await start({ sarvam: fakeSarvam({ synthesize: async () => { throw new SarvamError('NOTHING_TO_SPEAK', 'x', 400); } }) }))('POST', '/api/assistant/speak', { body: { text: '***' } });
  assert.equal(nothing.status, 400);
});

test('an unconfigured voice service reports a controlled 503, not a crash', async () => {
  const call = await start({ sarvam: createSarvamClient({ apiKey: undefined }) });
  const s = await call('POST', '/api/assistant/speak', { body: { text: 'Hello' } });
  assert.equal(s.status, 503);
  assert.equal(s.body.code, 'SARVAM_NOT_CONFIGURED');
  const t = await call('POST', '/api/assistant/transcribe', { raw: Buffer.alloc(600, 1), type: 'audio/webm' });
  assert.equal(t.status, 503);
});

test('voice routes are rate limited per user', async () => {
  const call = await start({ sarvam: fakeSarvam(), limiter: createRateLimiter({ windowMs: 60_000, max: 2, keyFn: (req) => req.auth.uid }) });
  await call('GET', '/api/assistant/capabilities');
  await call('GET', '/api/assistant/capabilities');
  assert.equal((await call('GET', '/api/assistant/capabilities')).status, 429);
});

// ---------------------------------------------------------------- Sarvam client contract

const json = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
const mk = (handler, options = {}) => {
  const seen = [];
  const client = createSarvamClient({ apiKey: SECRET, timeoutMs: 80, ...options, fetchImpl: async (url, init) => { seen.push({ url, init }); return handler(url, init, seen.length); } });
  return { client, seen };
};

test('Sarvam STT: saaras:v4 with domain keyterms, the right language code and audio file', async () => {
  const { client, seen } = mk(() => json({ transcript: ' नमस्ते ', language_code: 'hi-IN' }));
  const result = await client.transcribe({ audio: Buffer.alloc(300), mimeType: 'audio/webm;codecs=opus', language: 'hi' });
  assert.equal(result.transcript, 'नमस्ते');
  assert.equal(seen[0].url, 'https://api.sarvam.ai/speech-to-text');
  assert.equal(seen[0].init.headers['api-subscription-key'], SECRET);
  const form = seen[0].init.body;
  assert.equal(form.get('model'), 'saaras:v4');
  assert.equal(form.get('mode'), 'transcribe');
  assert.equal(form.get('language_code'), 'hi-IN');
  assert.equal(form.get('file').name, 'speech.webm');
  assert.equal(form.get('file').type, 'audio/webm');
  const keyterms = JSON.parse(form.get('keyterms'));
  assert.ok(keyterms.includes('प्याज') && keyterms.includes('quintal'));
  assert.ok(keyterms.length <= 50 && keyterms.every((k) => k.length <= 64));
});

test('Sarvam STT: if v4 rejects the request it falls back to v3 without keyterms', async () => {
  const { client, seen } = mk((url, init, n) => (n === 1 ? json({ error: { message: 'model saaras:v4 is unavailable' } }, 400) : json({ transcript: 'recovered' })));
  const result = await client.transcribe({ audio: Buffer.alloc(300), mimeType: 'audio/mp4', language: 'en' });
  assert.equal(result.transcript, 'recovered');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].init.body.get('model'), 'saaras:v3');
  assert.equal(seen[1].init.body.get('keyterms'), null, 'v3 rejects keyterms, so they are not sent');
  assert.equal(seen[1].init.body.get('file').name, 'speech.mp4');
});

test('Sarvam STT: auth and quota errors are not retried on another model', async () => {
  for (const [status, code] of [[401, 'SARVAM_AUTH_FAILED'], [429, 'SARVAM_QUOTA_EXCEEDED'], [500, 'SARVAM_UPSTREAM_ERROR']]) {
    const { client, seen } = mk(() => json({ error: { message: `problem ${SECRET}` } }, status));
    await assert.rejects(client.transcribe({ audio: Buffer.alloc(300), language: 'en' }), (e) => e.code === code && !e.message.includes(SECRET) && !String(e.upstream).includes(SECRET));
    assert.equal(seen.length, 1);
  }
});

test('Sarvam keyterms: per language, within the API limits, crops and markets included', () => {
  for (const lang of ['en', 'hi', 'mr']) {
    const terms = keytermsFor(lang);
    assert.ok(terms.length > 10 && terms.length <= 50, lang);
    assert.ok(terms.every((t) => t.length <= 64));
  }
  assert.ok(KEYTERMS.en.includes('Lasalgaon') && KEYTERMS.en.includes('onion'));
  assert.ok(KEYTERMS.mr.includes('कांदा') && KEYTERMS.hi.includes('प्याज'));
});

test('Sarvam TTS: mp3 output, language code, and prices/dates rewritten so they are spoken correctly', async () => {
  const { client, seen } = mk(() => json({ audios: ['QUJD'] }));
  const result = await client.synthesize({ text: 'Onion at Lasalgaon: ₹1,400/quintal (₹1,000 - ₹1,600), reported 2026-10-08.', language: 'en' });
  assert.equal(result.audioBase64, 'QUJD');
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(seen[0].url, 'https://api.sarvam.ai/text-to-speech');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.language_code, 'en-IN');
  assert.equal(body.model, 'bulbul:v3');
  assert.equal(body.output_audio_codec, 'mp3');
  assert.equal(body.text, 'Onion at Lasalgaon: 1400 rupees per quintal (1000 to 1600 rupees), reported 8 October 2026.');
  assert.equal('speaker' in body, false, 'the API default voice is used unless one is configured');

  const withVoice = mk(() => json({ audios: ['QUJD'] }), { ttsSpeaker: 'ritu' });
  await withVoice.client.synthesize({ text: 'Hello', language: 'hi' });
  assert.equal(JSON.parse(withVoice.seen[0].init.body).speaker, 'ritu');
});

test('Sarvam TTS: nothing speakable, missing audio and timeouts are controlled errors', async () => {
  await assert.rejects(mk(() => json({ audios: ['x'] })).client.synthesize({ text: ' ** ', language: 'en' }), { code: 'NOTHING_TO_SPEAK' });
  await assert.rejects(mk(() => json({ audios: [] })).client.synthesize({ text: 'Hello' }), { code: 'SARVAM_BAD_RESPONSE' });
  const stalled = mk((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'TimeoutError' })))));
  await assert.rejects(stalled.client.synthesize({ text: 'Hello' }), { code: 'SARVAM_TIMEOUT' });
  await assert.rejects(createSarvamClient({ apiKey: '' }).synthesize({ text: 'Hello' }), { code: 'SARVAM_NOT_CONFIGURED' });
});
