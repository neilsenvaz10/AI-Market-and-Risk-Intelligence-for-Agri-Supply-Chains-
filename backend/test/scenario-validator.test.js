import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSimulationPayload } from '../src/validators/scenario.validator.js';

test('Scenario Validator — Input Validation', async (t) => {
  await t.test('accepts valid single-mandi payload with kg and converts to quintals', () => {
    const result = validateSimulationPayload({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityKg: 1000,
      holdDays: 2,
      includeRisk: true,
    });

    assert.equal(result.errors, undefined);
    assert.equal(result.value.commodity, 'ONION');
    assert.equal(result.value.mandiId, 'MH_PUNE_APMC');
    assert.equal(result.value.quantityQuintals, 10);
    assert.equal(result.value.holdDays, 2);
    assert.equal(result.value.includeRisk, true);
  });

  await t.test('accepts valid holdDays 0 (Sell Today)', () => {
    const result = validateSimulationPayload({
      commodity: 'TOMATO',
      mandiId: 22,
      quantityQuintals: 15,
      holdDays: 0,
    });

    assert.equal(result.errors, undefined);
    assert.equal(result.value.holdDays, 0);
    assert.equal(result.value.quantityQuintals, 15);
  });

  await t.test('rejects holdDays outside 0..7', () => {
    const resultNegative = validateSimulationPayload({ holdDays: -1 });
    assert.ok(resultNegative.errors);
    assert.ok(resultNegative.errors.some((e) => e.field === 'holdDays'));

    const resultHigh = validateSimulationPayload({ holdDays: 8 });
    assert.ok(resultHigh.errors);
    assert.ok(resultHigh.errors.some((e) => e.field === 'holdDays'));
  });

  await t.test('rejects negative or invalid quantity', () => {
    const result = validateSimulationPayload({ quantityQuintals: -5 });
    assert.ok(result.errors);
    assert.ok(result.errors.some((e) => e.field === 'quantityQuintals'));
  });

  await t.test('validates multi-mandi allocations with kg conversion', () => {
    const result = validateSimulationPayload({
      commodity: 'ONION',
      holdDays: 3,
      allocations: [
        { mandiId: 'MH_PUNE_APMC', quantityKg: 600 },
        { mandiId: 'MH_NSK_MAIN', quantityQuintals: 4 },
      ],
    });

    assert.equal(result.errors, undefined);
    assert.equal(result.value.allocations.length, 2);
    assert.equal(result.value.allocations[0].quantityQuintals, 6);
    assert.equal(result.value.allocations[1].quantityQuintals, 4);
  });

  await t.test('accepts documented storage cost per day', () => {
    const result = validateSimulationPayload({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      holdDays: 2,
      documentedStorageCostPerDay: 5.5,
    });

    assert.equal(result.errors, undefined);
    assert.equal(result.value.documentedStorageCostPerDay, 5.5);
  });
});
