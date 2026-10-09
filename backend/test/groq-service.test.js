import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroqService, GroqError } from '../src/services/groq.service.js';

test('groq service: reports unconfigured when key is missing or blank', () => {
  const service = new GroqService({ apiKey: '' });
  assert.equal(service.isConfigured(), false);
  assert.rejects(
    () => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof GroqError && err.code === 'GROQ_NOT_CONFIGURED'
  );
});

test('groq service: successfully calls mock api and returns generated content', async () => {
  const fakeFetch = async (url, options) => {
    assert.match(url, /\/chat\/completions$/);
    assert.equal(options.headers.Authorization, 'Bearer gsk_test_key_123');
    const parsed = JSON.parse(options.body);
    assert.equal(parsed.model, 'llama-3.3-70b-versatile');
    assert.equal(parsed.messages.length, 1);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-123',
        model: 'llama-3.3-70b-versatile',
        choices: [
          {
            message: { role: 'assistant', content: 'Onion in Nashik is ₹1,600/quintal.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
      }),
    };
  };

  const service = new GroqService({
    apiKey: 'gsk_test_key_123',
    fetchFn: fakeFetch,
  });

  assert.equal(service.isConfigured(), true);
  const result = await service.generateChatCompletion({
    messages: [{ role: 'user', content: 'What is onion price?' }],
  });

  assert.equal(result.content, 'Onion in Nashik is ₹1,600/quintal.');
  assert.equal(result.usage.total_tokens, 35);
  assert.equal(result.finishReason, 'stop');
});

test('groq service: retries on 429 and throws GROQ_RATE_LIMITED after budget exhaustion', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '0' }),
      json: async () => ({ error: { message: 'Rate limit reached' } }),
    };
  };

  const service = new GroqService({
    apiKey: 'gsk_test_key_123',
    maxRetries: 1,
    fetchFn: fakeFetch,
  });

  await assert.rejects(
    () => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof GroqError && err.code === 'GROQ_RATE_LIMITED' && err.statusCode === 429
  );
  assert.equal(calls, 2); // 1 initial + 1 retry
});

test('groq service: handles 500 server error and maps to 502 with message', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: 'Overloaded' } }),
  });

  const service = new GroqService({
    apiKey: 'gsk_test_key_123',
    maxRetries: 0,
    fetchFn: fakeFetch,
  });

  await assert.rejects(
    () => service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    (err) => err instanceof GroqError && err.statusCode === 502
  );
});

test('groq service: error messages never leak the api key', async () => {
  const secretKey = 'gsk_super_secret_never_leak_this';
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Invalid payload' } }),
  });

  const service = new GroqService({
    apiKey: secretKey,
    maxRetries: 0,
    fetchFn: fakeFetch,
  });

  try {
    await service.generateChatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.equal(err.message.includes(secretKey), false);
    assert.equal(JSON.stringify(err).includes(secretKey), false);
  }
});
