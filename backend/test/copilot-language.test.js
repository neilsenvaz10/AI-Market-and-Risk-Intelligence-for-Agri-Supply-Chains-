/** Intent and entity understanding (English / Hindi / Marathi), the answer validator and the fallback answers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS, classifyIntent, detectCrop, detectStaticPlace, extractEntities, extractHorizon } from '../src/services/copilot/intentClassifier.js';
import { collectAllowedNumbers, extractNumbers, normalizeDigits, validateGroundedAnswer } from '../src/services/copilot/answerValidator.js';
import { deterministicAnswer, formatDate } from '../src/services/copilot/deterministicAnswers.js';

const I = INTENTS;

test('intents: English, Hindi and Marathi questions go to the right lookup', () => {
  const cases = [
    ['What is the onion price in Nashik?', I.LATEST_PRICE],
    ['hi, what is the onion price in Nashik?', I.LATEST_PRICE],
    ['How much is tomato selling at today', I.LATEST_PRICE],
    ['onions in Pune', I.LATEST_PRICE],
    ['What about Pune?', I.LATEST_PRICE],
    ['how has onion changed last week', I.PRICE_HISTORY],
    ['What does the forecast say for tomorrow?', I.FORECAST],
    ['will onion price go up tomorrow', I.FORECAST],
    ['Is this prediction reliable?', I.FORECAST_UNCERTAINTY],
    ['should I sell my onions now or wait?', I.SELL_TIMING],
    ['is it risky to sell onion', I.RISK_EXPLANATION],
    ['What risks should I consider?', I.RISK_EXPLANATION],
    ['Which mandi should I sell at?', I.RECOMMENDATION_EXPLANATION],
    ['What will the transport cost be?', I.RECOMMENDATION_EXPLANATION],
    ['how much profit will I make', I.RECOMMENDATION_EXPLANATION],
    ['what is modal price?', I.MARKET_EDUCATION],
    ['Hello', I.GENERAL_GREETING],
    ['how are you?', I.GENERAL_GREETING],
    ['thanks!', I.GENERAL_GREETING],
    ['आज प्याज का भाव क्या है?', I.LATEST_PRICE],
    ['नासिक में प्याज का क्या रेट है?', I.LATEST_PRICE],
    ['कल का भाव क्या रहेगा?', I.FORECAST],
    ['गेहूं बेचूं या रुकूं?', I.SELL_TIMING],
    ['मॉडल भाव क्या होता है', I.MARKET_EDUCATION],
    ['नमस्ते', I.GENERAL_GREETING],
    ['कांद्याचा भाव किती आहे', I.LATEST_PRICE],
    ['नाशिकमध्ये कांद्याचा दर काय आहे?', I.LATEST_PRICE],
    ['उद्याचा अंदाज काय आहे?', I.FORECAST],
    ['एपीएमसी म्हणजे काय?', I.MARKET_EDUCATION],
    ['नमस्कार, कसे आहात?', I.GENERAL_GREETING],
  ];
  for (const [text, expected] of cases) assert.equal(classifyIntent(text), expected, text);
});

test('intents: a sentence that merely mentions a crop, or unrelated Devanagari text, is not a price question', () => {
  assert.equal(classifyIntent('my onion leaves are turning yellow, what could be the reason?'), I.CLARIFICATION);
  assert.equal(classifyIntent('my field has pests what should I do'), I.CLARIFICATION);
  assert.equal(classifyIntent('माझ्या आमच्या गावात पाऊस'), I.CLARIFICATION);
  assert.equal(classifyIntent('प्रधानमंत्री योजना'), I.CLARIFICATION);
});

test('crops: names, plurals, Hinglish and inflected Hindi / Marathi forms', () => {
  const crops = {
    'onion': 'Onion', 'Onions': 'Onion', 'kanda': 'Onion', 'प्याज': 'Onion', 'कांद्याचा': 'Onion', 'कांदे': 'Onion',
    'tomatoes': 'Tomato', 'टमाटर': 'Tomato', 'टोमॅटोचे': 'Tomato',
    'potatoes': 'Potato', 'aloo': 'Potato', 'आलू': 'Potato', 'बटाट्याचा': 'Potato',
    'wheat': 'Wheat', 'गेहूं': 'Wheat', 'गव्हाचा': 'Wheat', 'गहू': 'Wheat',
    'soyabean': 'Soybean', 'सोयाबीन': 'Soybean', 'cotton': 'Cotton', 'कापूस': 'Cotton', 'कपास': 'Cotton',
    'rice': 'Rice', 'धान': 'Rice', 'maize': 'Maize', 'मका': 'Maize', 'garlic': 'Garlic', 'लसूण': 'Garlic',
    'cauliflower': 'Cauliflower', 'फुलकोबी': 'Cauliflower', 'cabbage': 'Cabbage', 'sugarcane': 'Sugarcane', 'ऊसाचा': 'Sugarcane',
    'sweet potato': 'Sweet Potato', 'mango': 'Mango', 'आंब्याचा': 'Mango',
  };
  for (const [text, crop] of Object.entries(crops)) assert.equal(detectCrop(`price of ${text}`), crop, text);
});

test('crops: look-alike words do not match', () => {
  for (const text of ['price per kg', 'tell us the price', 'the program ran', 'प्रधानमंत्री', 'आमच्या शेतात', 'turn left', 'what is the price']) {
    assert.equal(detectCrop(text), null, text);
  }
});

test('places: static fallback names in three languages; horizons in days', () => {
  assert.equal(detectStaticPlace('onion in नाशिक'), 'Nashik');
  assert.equal(detectStaticPlace('पुण्यात भाव'), 'Pune');
  assert.equal(detectStaticPlace('Lasalgaon prices'), 'Lasalgaon');
  assert.equal(detectStaticPlace('nothing here'), null);
  assert.equal(extractHorizon('price tomorrow'), 1);
  assert.equal(extractHorizon('day after tomorrow'), 2, 'is not mistaken for "tomorrow"');
  assert.equal(extractHorizon('forecast for onion in 3 days'), 3);
  assert.equal(extractHorizon('उद्याचा अंदाज'), 1);
  assert.equal(extractHorizon('5 दिन का अंदाज'), 5);
  assert.equal(extractHorizon('next week trend'), null, 'week-long questions show every horizon');
  assert.equal(extractHorizon('price of 1400 rupees'), null);
});

test('entities: a follow-up inherits crop and market from context', () => {
  const e = extractEntities('What about tomorrow?', { commodity: 'Onion', mandi: 'Nashik' });
  assert.deepEqual(e, { commodity: 'Onion', mandi: 'Nashik', horizon: 1 });
  assert.equal(extractEntities('tomato price', { commodity: 'Onion' }).commodity, 'Tomato');
});

// ------------------------------------------------------------------ answer validator

test('validator: digits are normalised across scripts and separators', () => {
  assert.equal(normalizeDigits('१४००'), '1400');
  assert.equal(normalizeDigits('₹1,400 and 1,00,000'), '₹1400 and 100000');
  assert.deepEqual(extractNumbers('कांद्याचा भाव १४०० रुपये, ८ ऑक्टोबर २०२६'), [1400, 8, 2026]);
});

test('validator: numbers from the data, the farmer and dates pass; invented prices fail', () => {
  const payload = { today: '9 October 2026', latestPrices: [{ modalPricePerQuintal: 1650, lowestPricePerQuintal: 1200, ageDays: 1, reportedOnText: '8 October 2026' }] };
  assert.equal(validateGroundedAnswer('The modal price is 1650 rupees, range 1200 to 1650, reported 8 October 2026.', payload).valid, true);
  assert.equal(validateGroundedAnswer('भाव १६५० रुपये आहे', payload).valid, true, 'Devanagari digits');
  assert.equal(validateGroundedAnswer('Price is 1,650 rupees', payload).valid, true, 'thousands separator');
  assert.equal(validateGroundedAnswer('About 1652 rupees', payload).valid, true, 'rounding within 0.5 percent');
  assert.deepEqual(validateGroundedAnswer('The price is 1720 rupees.', payload), { valid: false, offending: [1720] });
  assert.deepEqual(validateGroundedAnswer('Expect 2100 or 2200 soon', payload).offending, [2100, 2200]);
  assert.equal(validateGroundedAnswer('Sell within 3 days, about 2 markets', payload).valid, true, 'small counts are fine');
  assert.equal(validateGroundedAnswer('You have 500 quintals', payload, { extraTexts: ['I have 500 quintals'] }).valid, true, 'numbers the farmer said');
  assert.equal(validateGroundedAnswer('You have 500 quintals', payload).valid, false);
});

test('validator: collects numbers from nested data, numeric strings and text', () => {
  const allowed = collectAllowedNumbers({ a: { b: [1400, '1,500'] }, note: 'sold 2,000 quintals' });
  for (const n of [1400, 1500, 2000]) assert.ok(allowed.has(n), String(n));
});

// ------------------------------------------------------------------ deterministic answers

const marketData = (over = {}) => ({
  found: true, priceDate: '2026-10-08', ageDays: 1, isStale: false, modalPrice: 1650, minPrice: 1200, maxPrice: 1900,
  source: 'CEDA', mandiName: 'Nashik APMC', district: 'Nashik', scope: 'mandi', alternatives: [], ...over,
});
const onion = { name: 'Onion', hindi_name: 'प्याज', marathi_name: 'कांदा' };

test('fallback answers: dates are written in the farmer language', () => {
  assert.equal(formatDate('2026-10-08', 'en'), '8 October 2026');
  assert.equal(formatDate('2026-10-08', 'hi'), '8 अक्टूबर 2026');
  assert.equal(formatDate('2026-10-08', 'mr'), '8 ऑक्टोबर 2026');
  assert.equal(formatDate('not-a-date', 'en'), 'not-a-date');
});

test('fallback answers: price, with the crop name and wording of the farmer language', () => {
  const en = deterministicAnswer({ language: 'en', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: marketData() } });
  assert.match(en, /modal price for Onion at Nashik APMC is 1650 rupees per quintal, with a range of 1200 to 1900 rupees, as of 8 October 2026\. Source: CEDA\./);
  const hi = deterministicAnswer({ language: 'hi', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: marketData() } });
  assert.match(hi, /प्याज का ताज़ा दर्ज मोडल भाव 1650 रुपये प्रति क्विंटल/);
  const mr = deterministicAnswer({ language: 'mr', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: marketData() } });
  assert.match(mr, /कांदा चा ताजा नोंदवलेला मोडल भाव 1650 रुपये प्रति क्विंटल/);
});

test('fallback answers: an old report says how old it is', () => {
  const text = deterministicAnswer({ language: 'en', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: marketData({ ageDays: 367, isStale: true, priceDate: '2025-10-07' }) } });
  assert.match(text, /That report is 367 days old, so it may not match today's price\./);
});

test('fallback answers: a district lists its markets instead of picking one', () => {
  const data = marketData({
    scope: 'district', marketCount: 2, mandiName: 'Lasalgaon APMC', modalPrice: 1700,
    alternatives: [marketData({ mandiName: 'Nashik APMC', modalPrice: 1600, priceDate: '2026-10-07' })],
  });
  const text = deterministicAnswer({ language: 'en', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: data, place: { kind: 'district', district: 'Nashik' } } });
  assert.match(text, /Latest reported Onion prices in Nashik: Lasalgaon APMC 1700 rupees per quintal on 8 October 2026; Nashik APMC 1600 rupees per quintal on 7 October 2026\./);
});

test('fallback answers: unsupported crops, unknown markets, nothing found, and no crop named', () => {
  const retrieved = { unsupportedCrop: 'Potato', supportedCommodities: ['Onion', 'Tomato'] };
  assert.equal(deterministicAnswer({ language: 'en', intent: I.LATEST_PRICE, retrieved }), "I don't have price data for Potato yet. I currently have price data for Onion, Tomato.");
  assert.match(deterministicAnswer({ language: 'en', intent: I.LATEST_PRICE, retrieved: { supportedCommodities: ['Onion'] } }), /^Which crop and market would you like to know about\?/);
  assert.match(deterministicAnswer({ language: 'en', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: marketData(), unknownPlace: 'Lasalgaon' } }), /^I don't have a market called Lasalgaon in my list\. /);
  assert.match(deterministicAnswer({ language: 'en', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: { found: false, reason: 'x' }, place: { kind: 'mandi', mandi: { name: 'Nashik APMC' } } } }), /don't have a reported price for Onion in Nashik APMC/);
});

test('fallback answers: forecasts are estimates, "should I sell" is the farmer\'s decision, and unavailable features are said to be unavailable', () => {
  const forecastData = { found: true, mandi: { name: 'Nashik APMC' }, forecasts: [{ forecastDate: '2026-10-10', predictedPrice: 1675, lowerBound: 1600, upperBound: 1750, intervalLevelPercent: 80 }] };
  const f = deterministicAnswer({ language: 'en', intent: I.FORECAST, commodity: onion, retrieved: { forecastData } });
  assert.match(f, /1675 rupees per quintal for 10 October 2026, with a likely range of 1600 to 1750 rupees \(80 percent prediction interval\)\. This is an estimate, not a guaranteed price\./);
  assert.ok(!/confidence/i.test(f));
  const sell = deterministicAnswer({ language: 'en', intent: I.SELL_TIMING, commodity: onion, retrieved: { marketData: marketData() } });
  assert.match(sell, /The decision is yours\.$/);
  assert.match(deterministicAnswer({ language: 'en', intent: I.RECOMMENDATION_EXPLANATION, retrieved: {} }), /don't make up transport costs or profits/);
  assert.match(deterministicAnswer({ language: 'en', intent: I.RISK_EXPLANATION, retrieved: {} }), /risk assessment isn't available/);
  assert.match(deterministicAnswer({ language: 'hi', intent: I.RECOMMENDATION_EXPLANATION, retrieved: {} }), /परिवहन खर्च या मुनाफ़ा अपने मन से नहीं बनाता/);
});

test('fallback answers: the profile assumption is stated', () => {
  const text = deterministicAnswer({
    language: 'en', intent: I.LATEST_PRICE, commodity: onion, retrieved: { marketData: marketData() },
    assumptions: ['commodity_from_profile', 'place_from_profile'], profile: { primaryCrop: 'Onion', district: 'Nashik' },
  });
  assert.match(text, /^I used your profile \(Onion, Nashik\)\. /);
});
