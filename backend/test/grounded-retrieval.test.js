import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, extractEntities, INTENTS } from '../src/services/copilot/intentClassifier.js';
import { GroundedRetrievalService, AGRICULTURAL_TERMS } from '../src/services/copilot/groundedRetrieval.service.js';
import { Phase5RecommendationAdapter, Phase6RiskAdapter, Phase8FarmerAdapter } from '../src/services/copilot/adapters.js';

test('intent classification: identifies multilingual intents', () => {
  // English
  assert.equal(classifyIntent('What is the onion price in Nashik?'), INTENTS.LATEST_PRICE);
  assert.equal(classifyIntent('How have prices changed over last week?'), INTENTS.PRICE_HISTORY);
  assert.equal(classifyIntent('What does the forecast say for tomorrow?'), INTENTS.FORECAST);
  assert.equal(classifyIntent('Is this prediction reliable?'), INTENTS.FORECAST_UNCERTAINTY);
  assert.equal(classifyIntent('Which mandi should I sell at?'), INTENTS.RECOMMENDATION_EXPLANATION);
  assert.equal(classifyIntent('What risks should I consider?'), INTENTS.RISK_EXPLANATION);
  assert.equal(classifyIntent('What is modal price?'), INTENTS.MARKET_EDUCATION);
  assert.equal(classifyIntent('Hello'), INTENTS.GENERAL_GREETING);

  // Hindi
  assert.equal(classifyIntent('नासिक में प्याज का क्या रेट है?'), INTENTS.LATEST_PRICE);
  assert.equal(classifyIntent('कल का भाव क्या रहेगा?'), INTENTS.FORECAST);
  assert.equal(classifyIntent('मोडल भाव क्या होता है?'), INTENTS.MARKET_EDUCATION);
  assert.equal(classifyIntent('नमस्ते'), INTENTS.GENERAL_GREETING);

  // Marathi
  assert.equal(classifyIntent('नाशिकमध्ये कांद्याचा दर काय आहे?'), INTENTS.LATEST_PRICE);
  assert.equal(classifyIntent('उद्याचा अंदाज काय आहे?'), INTENTS.FORECAST);
  assert.equal(classifyIntent('एपीएमसी म्हणजे काय?'), INTENTS.MARKET_EDUCATION);
  assert.equal(classifyIntent('नमस्कार'), INTENTS.GENERAL_GREETING);
});

test('entity extraction: resolves commodity, mandi and horizon, with context inheritance', () => {
  const e1 = extractEntities('What is the onion price in Nashik?');
  assert.equal(e1.commodity, 'Onion');
  assert.equal(e1.mandi, 'Nashik');

  const e2 = extractEntities('टोमॅटोचे भाव काय आहेत पुण्यात?');
  assert.equal(e2.commodity, 'Tomato');
  assert.equal(e2.mandi, 'Pune');

  // Follow-up inheriting context
  const followUp = extractEntities('What about tomorrow?', { commodity: 'Onion', mandi: 'Nashik' });
  assert.equal(followUp.commodity, 'Onion');
  assert.equal(followUp.mandi, 'Nashik');
  assert.equal(followUp.horizon, 1);

  const sevenDay = extractEntities('7 day prediction for onion', { mandi: 'Nashik' });
  assert.equal(sevenDay.commodity, 'Onion');
  assert.equal(sevenDay.mandi, 'Nashik');
  assert.equal(sevenDay.horizon, 7);
});

test('agricultural terms: returns educational concepts in all three languages', () => {
  const service = new GroundedRetrievalService({ pool: null });
  const modal = service.getEducationalConcept('what is modal price?');
  assert.ok(modal);
  assert.equal(modal.term, 'Modal Price');
  assert.ok(modal.definition);
  assert.ok(modal.definitionHi);
  assert.ok(modal.definitionMr);

  const apmc = service.getEducationalConcept('APMC म्हणजे काय?');
  assert.ok(apmc);
  assert.equal(apmc.term, 'APMC Mandi');

  const interval = service.getEducationalConcept('explain prediction interval');
  assert.ok(interval);
  assert.equal(interval.term, 'Prediction Interval');
});

test('optional adapters: report honest unavailable status without throwing', async () => {
  const p5 = new Phase5RecommendationAdapter();
  assert.equal(p5.isAvailable(), false);
  const r5 = await p5.getRecommendation({ commodity: 'Onion', mandi: 'Nashik' });
  assert.equal(r5.available, false);
  assert.match(r5.reason, /Phase 5/);

  const p6 = new Phase6RiskAdapter();
  assert.equal(p6.isAvailable(), false);
  const r6 = await p6.getRiskIndicators({ commodity: 'Onion', mandi: 'Nashik' });
  assert.equal(r6.available, false);
  assert.match(r6.reason, /Phase 6/);
  assert.ok(r6.generalRiskFactors.length > 0);

  const p8 = new Phase8FarmerAdapter();
  const r8 = await p8.getFarmerContext(null);
  assert.equal(r8, null);
});
