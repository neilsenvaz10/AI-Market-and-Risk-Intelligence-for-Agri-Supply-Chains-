/**
 * Forecast endpoint validation tests (database-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_HORIZON,
  validateForecastPath,
  validateForecastQuery,
} from '../src/validators/forecast.validator.js';

test('forecast path: requires both commodity and mandi', () => {
  assert.equal(validateForecastPath({}).errors.length, 2);
  assert.equal(validateForecastPath({ commodity: 'ONION' }).errors[0].field, 'mandi');
  assert.equal(validateForecastPath({ mandi: 'MH_PUNE_APMC' }).errors[0].field, 'commodity');
  const ok = validateForecastPath({ commodity: 'ONION', mandi: 'MH_PUNE_APMC' });
  assert.equal(ok.errors, undefined);
  assert.equal(ok.value.commodity, 'ONION');
});

test('forecast path: rejects injection-shaped and oversized values', () => {
  assert.ok(validateForecastPath({ commodity: "Onion'; DROP TABLE forecasts;--", mandi: 'X' }).errors);
  assert.ok(validateForecastPath({ commodity: 'A'.repeat(200), mandi: 'X' }).errors);
  assert.ok(validateForecastPath({ commodity: '', mandi: 'X' }).errors);
});

test('forecast path: accepts non-latin commodity and mandi names', () => {
  const result = validateForecastPath({ commodity: 'प्याज', mandi: 'नासिक मार्केट यार्ड' });
  assert.equal(result.errors, undefined);
});

test('forecast query: defaults', () => {
  const { value, errors } = validateForecastQuery({});
  assert.equal(errors, undefined);
  assert.equal(value.horizon, undefined);
  assert.equal(value.order, 'ASC');
  assert.equal(value.includeSample, true);
  assert.equal(value.modelVersion, undefined);
});

test('forecast query: horizon bounds', () => {
  assert.equal(validateForecastQuery({ horizon: '1' }).value.horizon, 1);
  assert.equal(validateForecastQuery({ horizon: String(MAX_HORIZON) }).value.horizon, MAX_HORIZON);
  assert.equal(validateForecastQuery({ horizon: '0' }).errors[0].field, 'horizon');
  assert.equal(validateForecastQuery({ horizon: '8' }).errors[0].field, 'horizon');
  assert.equal(validateForecastQuery({ horizon: '-3' }).errors[0].field, 'horizon');
  assert.equal(validateForecastQuery({ horizon: 'abc' }).errors[0].field, 'horizon');
  assert.equal(validateForecastQuery({ horizon: '2.5' }).errors[0].field, 'horizon');
});

test('forecast query: order, includeSample and modelVersion', () => {
  assert.equal(validateForecastQuery({ order: 'desc' }).value.order, 'DESC');
  assert.equal(validateForecastQuery({ order: 'sideways' }).errors[0].field, 'order');
  assert.equal(validateForecastQuery({ includeSample: 'false' }).value.includeSample, false);
  assert.equal(validateForecastQuery({ includeSample: 'maybe' }).errors[0].field, 'includeSample');
  assert.equal(validateForecastQuery({ modelVersion: 'phase4-fixture-v1' }).value.modelVersion, 'phase4-fixture-v1');
  assert.ok(validateForecastQuery({ modelVersion: 'A'.repeat(80) }).errors);
});
