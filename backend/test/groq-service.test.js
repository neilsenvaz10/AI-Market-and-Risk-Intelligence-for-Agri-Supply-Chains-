import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroqService, GroqError, GROQ_MODEL_PREFERENCE, cleanModelText, modelRequestParams, parseDurationMs } from '../src/services/groq.service.js';

const json = (data, status = 200, headers = {}) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  json: async () => data,
});
const completion = (content, model) => json({ model, choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { total_tokens: 35 } });
const missing = (model) => json({ error: { message: `The model \`${model}\` does not exist or you do not have access to it.`, code: 'model_not_found' } }, 404);

test('groq service: reports unconfigured when key is missing or blank', async () => {
  const service = new GroqService({ apiKey: '' });
  assert.equal(service.isConfigured(), false);
  await assert.rejects(
    () => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof GroqError && err.code === 'GROQ_NOT_CONFIGURED'
  );
});

test('groq service: reads the key lazily so import order cannot leave it unset', () => {
  const before = process.env.GROQ_API_KEY;
  try {
    process.env.GROQ_API_KEY = 'gsk_late_key_123';
    assert.equal(new GroqService().isConfigured(), true);
    delete process.env.GROQ_API_KEY;
    assert.equal(new GroqService().isConfigured(), false);
  } finally {
    if (before === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = before;
  }
});

test('groq service: calls the chat endpoint with Bearer auth and the preferred model by default', async () => {
  const seen = [];
  const fakeFetch = async (url, options) => {
    seen.push({ url, options, body: JSON.parse(options.body) });
    return completion('Onion in Nashik is ₹1,600/quintal.', 'qwen/qwen3.8-27b');
  };
  const service = new GroqService({ apiKey: 'gsk_test_key_123', fetchFn: fakeFetch, model: GROQ_MODEL_PREFERENCE[0] });
  const result = await service.generateChatCompletion({ messages: [{ role: 'user', content: 'What is onion price?' }] });

  assert.match(seen[0].url, /\/chat\/completions$/);
  assert.equal(seen[0].options.headers.Authorization, 'Bearer gsk_test_key_123');
  assert.equal(seen[0].body.model, 'qwen/qwen3.8-27b');
  assert.equal(seen[0].body.reasoning_effort, 'none', 'reasoning is switched off for qwen so it never leaks into the answer');
  assert.equal(result.content, 'Onion in Nashik is ₹1,600/quintal.');
  assert.equal(result.usage.total_tokens, 35);
  assert.equal(service.getModel(), 'qwen/qwen3.8-27b');
});

test('groq service: a retired model is skipped and the next available model answers (the bug that made the chat canned)', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    return model === 'llama-3.3-70b-versatile' ? missing(model) : completion('Hello from the fallback model.', model);
  };
  const service = new GroqService({ apiKey: 'gsk_test_key_123', model: 'llama-3.3-70b-versatile', fetchFn: fakeFetch });
  const first = await service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(first.content, 'Hello from the fallback model.');
  assert.deepEqual(calls, ['llama-3.3-70b-versatile', GROQ_MODEL_PREFERENCE[0]]);
  assert.equal(service.getModel(), GROQ_MODEL_PREFERENCE[0]);

  // The retired model is remembered: the next request goes straight to a working model.
  calls.length = 0;
  await service.generateChatCompletion({ messages: [{ role: 'user', content: 'again' }] });
  assert.deepEqual(calls, [GROQ_MODEL_PREFERENCE[0]]);
});

test('groq service: when none of the known models exist it asks Groq which models are available', async () => {
  const fakeFetch = async (url, options) => {
    if (url.endsWith('/models')) {
      return json({ data: [
        { id: 'whisper-large-v3', active: true, context_window: 448 },
        { id: 'meta-llama/llama-prompt-guard-2-22m', active: true, context_window: 512 },
        { id: 'brand-new/chat-model', active: true, context_window: 131072 },
        { id: 'small/chat-model', active: true, context_window: 8192 },
      ] });
    }
    const model = JSON.parse(options.body).model;
    return model === 'brand-new/chat-model' ? completion('Found you.', model) : missing(model);
  };
  const service = new GroqService({ apiKey: 'gsk_test_key_123', fetchFn: fakeFetch });
  const result = await service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.content, 'Found you.');
  assert.equal(service.getModel(), 'brand-new/chat-model');
});

test('groq service: reports GROQ_MODEL_NOT_FOUND when the account has no usable chat model', async () => {
  const fakeFetch = async (url) => (url.endsWith('/models') ? json({ data: [{ id: 'whisper-large-v3', active: true }] }) : missing('x'));
  const service = new GroqService({ apiKey: 'gsk_test_key_123', fetchFn: fakeFetch });
  await assert.rejects(
    () => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof GroqError && err.code === 'GROQ_MODEL_NOT_FOUND'
  );
});

test('groq service: a rate-limited model goes on cooldown and the next model answers immediately', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    return model === GROQ_MODEL_PREFERENCE[0]
      ? json({ error: { message: 'Rate limit reached for tokens per minute' } }, 429, { 'x-ratelimit-reset-tokens': '24.3s' })
      : completion('Answered by the next model.', model);
  };
  const service = new GroqService({ apiKey: 'gsk_test_key_123', fetchFn: fakeFetch });
  const first = await service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(first.content, 'Answered by the next model.');
  assert.deepEqual(calls, [GROQ_MODEL_PREFERENCE[0], GROQ_MODEL_PREFERENCE[1]]);

  calls.length = 0;
  await service.generateChatCompletion({ messages: [{ role: 'user', content: 'next question' }] });
  assert.deepEqual(calls, [GROQ_MODEL_PREFERENCE[1]], 'the cooled-down model is not retried while it is limited');
  assert.ok(service.cooldownUntil.get(GROQ_MODEL_PREFERENCE[0]) - Date.now() > 20_000, 'cooldown follows the reset time Groq reports');
});

test('groq service: throws GROQ_RATE_LIMITED only after every model is rate limited', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return json({ error: { message: 'Rate limit reached' } }, 429, { 'retry-after': '0' });
  };
  const service = new GroqService({ apiKey: 'gsk_test_key_123', fetchFn: fakeFetch });
  await assert.rejects(
    () => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof GroqError && err.code === 'GROQ_RATE_LIMITED' && err.statusCode === 429
  );
  assert.equal(calls, GROQ_MODEL_PREFERENCE.length, 'each model is tried once, none is hammered');
});

test('groq service: a bad request or failed authentication is not retried on other models', async () => {
  let calls = 0;
  const service = new GroqService({
    apiKey: 'gsk_test_key_123',
    fetchFn: async () => { calls += 1; return json({ error: { message: 'Invalid payload' } }, 400); },
  });
  await assert.rejects(() => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }), (err) => err.code === 'GROQ_API_ERROR' && err.statusCode === 400);
  assert.equal(calls, 1);

  calls = 0;
  const unauthorized = new GroqService({ apiKey: 'gsk_test_key_123', fetchFn: async () => { calls += 1; return json({ error: { message: 'Invalid API Key' } }, 401); } });
  await assert.rejects(() => unauthorized.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }), (err) => err.code === 'GROQ_UNAUTHORIZED');
  assert.equal(calls, 1);
});

test('groq service: upstream 503 is retried once, then the next model is tried', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const model = JSON.parse(options.body).model;
    calls.push(model);
    return model === GROQ_MODEL_PREFERENCE[0] ? json({ error: { message: 'Overloaded' } }, 503) : completion('Recovered.', model);
  };
  const service = new GroqService({ apiKey: 'gsk_test_key_123', maxRetries: 1, fetchFn: fakeFetch });
  const result = await service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.content, 'Recovered.');
  assert.deepEqual(calls, [GROQ_MODEL_PREFERENCE[0], GROQ_MODEL_PREFERENCE[0], GROQ_MODEL_PREFERENCE[1]]);
});

test('groq service: retries without the reasoning parameter when a model rejects it', async () => {
  const bodies = [];
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return body.reasoning_effort ? json({ error: { message: "Unsupported value for 'reasoning_effort'" } }, 400) : completion('No reasoning param needed.', body.model);
  };
  const service = new GroqService({ apiKey: 'gsk_test_key_123', fetchFn: fakeFetch });
  const result = await service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.content, 'No reasoning param needed.');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].reasoning_effort, undefined);
});

test('groq service: hidden reasoning never reaches the answer', () => {
  assert.equal(cleanModelText('<think>my notes</think>The price is 1400.'), 'The price is 1400.');
  assert.equal(cleanModelText('<think>cut off while thinking'), '');
  assert.equal(cleanModelText(null), '');
  assert.deepEqual(modelRequestParams('openai/gpt-oss-120b'), { reasoning_effort: 'low' });
  assert.deepEqual(modelRequestParams('qwen/qwen3.8-27b'), { reasoning_effort: 'none' });
  assert.deepEqual(modelRequestParams('some/other-model'), {});
});

test('groq service: parses Groq reset durations', () => {
  assert.equal(parseDurationMs('24.342s'), 24342);
  assert.equal(parseDurationMs('11m31.2s'), 691200);
  assert.equal(parseDurationMs('697ms'), 697);
  assert.equal(parseDurationMs('garbage'), null);
  assert.equal(parseDurationMs(null), null);
});

test('groq service: request timeouts are reported as GROQ_TIMEOUT', async () => {
  const fakeFetch = (url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const service = new GroqService({ apiKey: 'gsk_test_key_123', timeoutMs: 30, totalBudgetMs: 10, fetchFn: fakeFetch });
  await assert.rejects(() => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }), (err) => err.code === 'GROQ_TIMEOUT');
});

test('groq service: error messages never leak the api key', async () => {
  const secretKey = 'gsk_super_secret_never_leak_this';
  const service = new GroqService({
    apiKey: secretKey,
    maxRetries: 0,
    fetchFn: async () => json({ error: { message: 'Invalid payload' } }, 400),
  });

  try {
    await service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.equal(err.message.includes(secretKey), false);
    assert.equal(JSON.stringify(err).includes(secretKey), false);
  }
});
