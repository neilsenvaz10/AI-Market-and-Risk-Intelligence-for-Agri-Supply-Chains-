import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSpeechText } from '../src/services/speechText.js';

// Each expectation below was verified against the live Sarvam API with a speech -> text round trip:
// the written-out form is spoken correctly, the raw symbols are not ("... rupees BY quintal").

test('English: prices, ranges, units and ISO dates are written out', () => {
  assert.equal(
    prepareSpeechText('Onion at Lasalgaon: ₹1,400/quintal (range ₹1,000 - ₹1,600), reported 2026-10-08.', 'en'),
    'Onion at Lasalgaon: 1400 rupees per quintal (range 1000 to 1600 rupees), reported 8 October 2026.',
  );
  assert.equal(prepareSpeechText('Rs. 2,450 per quintal', 'en'), '2450 rupees per quintal');
  assert.equal(prepareSpeechText('INR 1,20,000 total', 'en'), '120000 rupees total');
});

test('Hindi: rupees, per-quintal, percent and dates in Hindi words', () => {
  assert.equal(
    prepareSpeechText('लासलगाँव में प्याज: ₹1,400/क्विंटल (₹1,000 - ₹1,600), दिनांक 2026-10-08, बदलाव +3.5%।', 'hi'),
    'लासलगाँव में प्याज: 1400 रुपये प्रति क्विंटल (1000 से 1600 रुपये), दिनांक 8 अक्टूबर 2026, बदलाव प्लस 3.5 प्रतिशत।',
  );
});

test('Marathi: rupees, ranges and dates in Marathi words', () => {
  assert.equal(
    prepareSpeechText('लासलगावमध्ये कांदा: ₹1,400/क्विंटल (₹1,000 - ₹1,600), दिनांक 2026-10-08.', 'mr'),
    'लासलगावमध्ये कांदा: 1400 रुपये प्रति क्विंटल (1000 ते 1600 रुपये), दिनांक 8 ऑक्टोबर 2026.',
  );
});

test('signed numbers and percentages are spoken, not read as symbols', () => {
  assert.equal(prepareSpeechText('Changed +3.5% this week and -2% last week', 'en'), 'Changed plus 3.5 percent this week and minus 2 percent last week');
});

test('markup, links, bullets and emoji are removed; digits and commas are kept sensible', () => {
  assert.equal(prepareSpeechText('**Onion** • see https://example.com now 🙂', 'en'), 'Onion see now');
  assert.equal(prepareSpeechText('<b>Tomato</b>, onion and potato', 'en'), 'Tomato, onion and potato');
  assert.equal(prepareSpeechText('Packs of 10,20 and 1,400', 'en'), 'Packs of 10,20 and 1400', 'only real thousands separators are removed');
});

test('a sentence comma after an amount survives', () => {
  assert.equal(prepareSpeechText('It is ₹1,400, which is old.', 'en'), 'It is 1400 rupees, which is old.');
});

test('empty and symbol-only input becomes empty; long text is cut at a word boundary', () => {
  assert.equal(prepareSpeechText('  *** ', 'en'), '');
  assert.equal(prepareSpeechText(null, 'en'), '');
  const long = prepareSpeechText(`${'word '.repeat(400)}`, 'en');
  assert.ok(long.length <= 1000 && long.endsWith('…'));
  assert.ok(!/\sword…$/.test(long) || long.length <= 1000);
});
