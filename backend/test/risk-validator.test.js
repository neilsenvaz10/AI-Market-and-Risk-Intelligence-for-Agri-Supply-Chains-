import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRiskPath,
  validateRiskQuery,
  validateRiskSummaryQuery,
} from '../src/validators/risk.validator.js';

test('Risk Validator — validateRiskPath', async (t) => {
  await t.test('accepts valid commodity and mandi identifiers', () => {
    const res = validateRiskPath({ commodity: 'ONION', mandi: 'MH_NSK_MAIN' });
    assert.ok(!res.errors);
    assert.equal(res.value.commodity, 'ONION');
    assert.equal(res.value.mandi, 'MH_NSK_MAIN');
  });

  await t.test('accepts unicode and localized names', () => {
    const res = validateRiskPath({ commodity: 'प्याज', mandi: 'नाशिक एपीएमसी' });
    assert.ok(!res.errors);
    assert.equal(res.value.commodity, 'प्याज');
  });

  await t.test('rejects missing commodity or mandi', () => {
    const missingMandi = validateRiskPath({ commodity: 'ONION' });
    assert.ok(missingMandi.errors);
    assert.ok(missingMandi.errors.some((e) => e.field === 'mandi'));

    const missingCrop = validateRiskPath({ mandi: 'MH_NSK_MAIN' });
    assert.ok(missingCrop.errors);
    assert.ok(missingCrop.errors.some((e) => e.field === 'commodity'));
  });

  await t.test('rejects malicious characters', () => {
    const sqlInjection = validateRiskPath({ commodity: "ONION'; DROP TABLE mandis;--", mandi: 'MH_NSK_MAIN' });
    assert.ok(sqlInjection.errors);
  });
});

test('Risk Validator — validateRiskQuery', async (t) => {
  await t.test('defaults includeSample to false for genuine risk analytics', () => {
    const res = validateRiskQuery({});
    assert.ok(!res.errors);
    assert.equal(res.value.includeSample, false);
  });

  await t.test('parses includeSample boolean correctly', () => {
    const resTrue = validateRiskQuery({ includeSample: 'true' });
    assert.equal(resTrue.value.includeSample, true);

    const resFalse = validateRiskQuery({ includeSample: 'false' });
    assert.equal(resFalse.value.includeSample, false);
  });

  await t.test('validates referenceDate format', () => {
    const valid = validateRiskQuery({ referenceDate: '2026-10-09' });
    assert.ok(!valid.errors);
    assert.equal(valid.value.referenceDate, '2026-10-09');

    const invalid = validateRiskQuery({ referenceDate: '09-10-2026' });
    assert.ok(invalid.errors);
  });
});

test('Risk Validator — validateRiskSummaryQuery', async (t) => {
  await t.test('applies defaults correctly', () => {
    const res = validateRiskSummaryQuery({});
    assert.ok(!res.errors);
    assert.equal(res.value.limit, 20);
    assert.equal(res.value.includeSample, false);
  });

  await t.test('enforces limit bounds', () => {
    const bounded = validateRiskSummaryQuery({ limit: '50' });
    assert.equal(bounded.value.limit, 50);

    const outOfBounds = validateRiskSummaryQuery({ limit: '500' });
    assert.ok(outOfBounds.errors);
  });
});
