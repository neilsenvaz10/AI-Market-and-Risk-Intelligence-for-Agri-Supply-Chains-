import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCopilotChatPayload } from '../src/validators/copilot.validator.js';

test('copilot validator: accepts valid input in supported languages', () => {
  const en = validateCopilotChatPayload({ message: 'What is the onion price in Nashik?', language: 'en' });
  assert.equal(en.errors, null);
  assert.equal(en.data.language, 'en');
  assert.equal(en.data.message, 'What is the onion price in Nashik?');

  const hi = validateCopilotChatPayload({ message: 'नासिक में प्याज का भाव क्या है?', language: 'hi' });
  assert.equal(hi.errors, null);
  assert.equal(hi.data.language, 'hi');

  const mr = validateCopilotChatPayload({ message: 'नाशिकमध्ये कांद्याचा भाव काय आहे?', language: 'mr' });
  assert.equal(mr.errors, null);
  assert.equal(mr.data.language, 'mr');
});

test('copilot validator: rejects missing or blank message', () => {
  const empty = validateCopilotChatPayload({ message: '' });
  assert.ok(empty.errors?.message);

  const missing = validateCopilotChatPayload({});
  assert.ok(missing.errors?.message);

  const spaces = validateCopilotChatPayload({ message: '    ' });
  assert.ok(spaces.errors?.message);
});

test('copilot validator: rejects message exceeding 500 characters', () => {
  const longMsg = 'a'.repeat(501);
  const res = validateCopilotChatPayload({ message: longMsg });
  assert.ok(res.errors?.message);
});

test('copilot validator: rejects unsupported languages', () => {
  const res = validateCopilotChatPayload({ message: 'Price please', language: 'fr' });
  assert.ok(res.errors?.language);
});

test('copilot validator: validates context and conversation history bounds', () => {
  const valid = validateCopilotChatPayload({
    message: 'What about tomorrow?',
    context: { commodity: 'Onion', mandi: 'Nashik', horizon: 1 },
    conversationHistory: [
      { role: 'user', content: 'What is the onion price in Nashik?' },
      { role: 'assistant', content: 'The latest price is ₹1,500/quintal.' },
    ],
  });
  assert.equal(valid.errors, null);
  assert.equal(valid.data.context.commodity, 'Onion');
  assert.equal(valid.data.context.horizon, 1);
  assert.equal(valid.data.conversationHistory.length, 2);

  // History overflow
  const tooLong = Array.from({ length: 11 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
  const invalidHistory = validateCopilotChatPayload({ message: 'test', conversationHistory: tooLong });
  assert.ok(invalidHistory.errors?.conversationHistory);

  // Invalid role
  const badRole = validateCopilotChatPayload({
    message: 'test',
    conversationHistory: [{ role: 'system', content: 'hack' }],
  });
  assert.ok(badRole.errors?.['conversationHistory[0].role']);
});
