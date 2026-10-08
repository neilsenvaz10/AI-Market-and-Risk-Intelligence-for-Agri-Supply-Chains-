import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHistoryQuery,
  validateLatestQuery,
  validateMandiId,
  validateSyncRequest,
} from '../src/validators/mandi.validator.js';

test('history query: defaults, valid filters and descriptive errors', () => {
  assert.deepEqual(validateHistoryQuery({}).value.limit, 100);
  assert.equal(validateHistoryQuery({}).value.order, 'ASC');
  assert.equal(validateHistoryQuery({ startDate: 'not-a-date' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ startDate: '2026-02-31' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ limit: '-5' }).errors[0].field, 'limit');
  assert.equal(validateHistoryQuery({ limit: 'abc' }).errors[0].field, 'limit');
  assert.equal(validateHistoryQuery({ startDate: '2026-09-10', endDate: '2026-09-01' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ order: 'sideways' }).errors[0].field, 'order');
});

test('latest query: rejects unsupported characters, unknown sources and bad booleans', () => {
  assert.ok(validateLatestQuery({ commodity: "Onion'; DROP TABLE x;--" }).errors);
  assert.ok(validateLatestQuery({ source: 'SCRAPER' }).errors);
  assert.ok(validateLatestQuery({ includeSample: 'maybe' }).errors);
  assert.equal(validateLatestQuery({ includeSample: 'false' }).value.includeSample, false);
  assert.equal(validateLatestQuery({ commodity: 'Onion', state: 'Maharashtra' }).value.commodity, 'Onion');
});

test('mandi id must be a positive integer', () => {
  assert.equal(validateMandiId('12').value, 12);
  assert.ok(validateMandiId('abc').errors);
  assert.ok(validateMandiId('0').errors);
});

test('sync request: provider required, bounded ranges, CEDA needs a full scope', () => {
  assert.ok(validateSyncRequest({}).errors.some((e) => e.field === 'provider'));
  assert.ok(validateSyncRequest({ provider: 'DATA_GOV_IN', fromDate: '2026-01-01', toDate: '2026-03-01' }).errors);
  assert.ok(validateSyncRequest({ provider: 'CEDA', commodity: 'Onion' }).errors);
  assert.ok(validateSyncRequest({ provider: 'DATA_GOV_IN', maxRecords: 999999 }).errors);
  assert.ok(validateSyncRequest({ provider: 'DATA_GOV_IN', apiKey: 'x' }).errors, 'unknown fields are rejected');
  assert.deepEqual(validateSyncRequest({ provider: 'data_gov_in', days: 3 }).value.provider, 'DATA_GOV_IN');
});
