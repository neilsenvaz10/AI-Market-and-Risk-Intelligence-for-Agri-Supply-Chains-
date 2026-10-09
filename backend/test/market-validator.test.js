/**
 * Pure unit tests for the Phase 5 market validator. No database, no server:
 * every case is a direct call to a validator function.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_STATUSES,
  validateCommodityListQuery,
  validateDataStatusQuery,
  validateHistoryQuery,
  validateLatestQuery,
  validateMandiListQuery,
} from '../src/validators/market.validator.js';

const INJECTIONS = [
  "Onion'; DROP TABLE mandi_prices;--",
  'Onion" OR 1=1 --',
  'Onion\\',
  "Robert'); DROP TABLE students;--",
  '<script>alert(1)</script>',
];

test('commodities: defaults are limit 500 / offset 0', () => {
  const { value, errors } = validateCommodityListQuery({});
  assert.equal(errors, undefined);
  assert.equal(value.limit, 500);
  assert.equal(value.offset, 0);
  assert.equal(value.category, undefined);
  assert.equal(value.search, undefined);
});

test('commodities: accepts category and search, trims and collapses whitespace', () => {
  const { value, errors } = validateCommodityListQuery({ category: 'Vegetables & Fruits', search: '  Onion  ' });
  assert.equal(errors, undefined);
  assert.equal(value.category, 'Vegetables & Fruits');
  assert.equal(value.search, 'Onion');
});

test('commodities: rejects out-of-range and malformed limit/offset instead of clamping', () => {
  assert.equal(validateCommodityListQuery({ limit: 0 }).errors[0].field, 'limit');
  assert.equal(validateCommodityListQuery({ limit: 1001 }).errors[0].field, 'limit');
  assert.equal(validateCommodityListQuery({ limit: '5000' }).errors[0].field, 'limit');
  assert.equal(validateCommodityListQuery({ limit: 'abc' }).errors[0].field, 'limit');
  assert.equal(validateCommodityListQuery({ limit: '10.5' }).errors[0].field, 'limit');
  assert.equal(validateCommodityListQuery({ offset: -1 }).errors[0].field, 'offset');
  assert.equal(validateCommodityListQuery({ offset: 2_000_000 }).errors[0].field, 'offset');
  assert.equal(validateCommodityListQuery({ limit: 1 }).value.limit, 1);
  assert.equal(validateCommodityListQuery({ limit: 1000 }).value.limit, 1000);
});

test('commodities: rejects injection-shaped and over-long text', () => {
  for (const bad of INJECTIONS) {
    const result = validateCommodityListQuery({ search: bad });
    assert.ok(result.errors, `expected ${bad} to be rejected`);
    assert.equal(result.errors[0].field, 'search');
  }
  assert.ok(validateCommodityListQuery({ category: 'x'.repeat(101) }).errors);
});

test('mandis: defaults, every filter and bounds', () => {
  const { value, errors } = validateMandiListQuery({});
  assert.equal(errors, undefined);
  assert.equal(value.limit, 500);
  assert.equal(value.offset, 0);

  const filtered = validateMandiListQuery({
    state: 'Maharashtra', district: 'Nashik', search: 'Lasalgaon', commodity: 'ONION', limit: '25', offset: '50',
  });
  assert.deepEqual(filtered.errors, undefined);
  assert.deepEqual(
    { state: filtered.value.state, district: filtered.value.district, search: filtered.value.search, commodity: filtered.value.commodity, limit: filtered.value.limit, offset: filtered.value.offset },
    { state: 'Maharashtra', district: 'Nashik', search: 'Lasalgaon', commodity: 'ONION', limit: 25, offset: 50 }
  );

  assert.equal(validateMandiListQuery({ limit: 0 }).errors[0].field, 'limit');
  assert.equal(validateMandiListQuery({ limit: 1001 }).errors[0].field, 'limit');
  assert.equal(validateMandiListQuery({ offset: -5 }).errors[0].field, 'offset');
  assert.ok(validateMandiListQuery({ search: INJECTIONS[0] }).errors);
  assert.ok(validateMandiListQuery({ state: INJECTIONS[1] }).errors);
});

test('latest: defaults are includeSample=true, limit 50, offset 0', () => {
  const { value, errors } = validateLatestQuery({});
  assert.equal(errors, undefined);
  assert.equal(value.includeSample, true);
  assert.equal(value.limit, 50);
  assert.equal(value.offset, 0);
  assert.equal(value.qualityStatus, undefined);
  assert.equal(value.source, undefined);
});

test('latest: accepts every documented filter and normalises case', () => {
  const { value, errors } = validateLatestQuery({
    commodity: 'Onion',
    commodityCategory: 'Vegetables',
    variety: 'Red',
    state: 'Maharashtra',
    district: 'Nashik',
    mandi: 'Lasalgaon',
    marketCode: 'MH_NSK_LASALGAON',
    source: 'data_gov_in',
    qualityStatus: 'flagged',
    includeSample: 'false',
    limit: '200',
    offset: '10',
  });
  assert.equal(errors, undefined);
  assert.equal(value.source, 'DATA_GOV_IN');
  assert.equal(value.qualityStatus, 'FLAGGED');
  assert.equal(value.includeSample, false);
  assert.equal(value.limit, 200);
  assert.equal(value.offset, 10);
});

test('latest: includeSample only accepts true/false', () => {
  assert.equal(validateLatestQuery({ includeSample: 'true' }).value.includeSample, true);
  assert.equal(validateLatestQuery({ includeSample: true }).value.includeSample, true);
  assert.equal(validateLatestQuery({ includeSample: false }).value.includeSample, false);
  assert.equal(validateLatestQuery({ includeSample: 'maybe' }).errors[0].field, 'includeSample');
  assert.equal(validateLatestQuery({ includeSample: '1' }).errors[0].field, 'includeSample');
});

test('latest: qualityStatus is restricted to VALID|FLAGGED|REJECTED', () => {
  assert.deepEqual(QUALITY_STATUSES, ['VALID', 'FLAGGED', 'REJECTED']);
  assert.equal(validateLatestQuery({ qualityStatus: 'valid' }).value.qualityStatus, 'VALID');
  assert.equal(validateLatestQuery({ qualityStatus: 'REJECTED' }).value.qualityStatus, 'REJECTED');
  assert.equal(validateLatestQuery({ qualityStatus: 'MAYBE' }).errors[0].field, 'qualityStatus');
  assert.equal(validateLatestQuery({ qualityStatus: 'VALID; DROP TABLE x' }).errors[0].field, 'qualityStatus');
});

test('latest: source must be a source code, and limit is capped at 200', () => {
  assert.equal(validateLatestQuery({ source: 'MOCK_PROVIDER' }).value.source, 'MOCK_PROVIDER');
  assert.equal(validateLatestQuery({ source: 'DATA_GOV_IN' }).value.source, 'DATA_GOV_IN');
  assert.equal(validateLatestQuery({ source: 'not a source!' }).errors[0].field, 'source');
  assert.equal(validateLatestQuery({ source: "x'--" }).errors[0].field, 'source');
  assert.equal(validateLatestQuery({ source: 'A'.repeat(33) }).errors[0].field, 'source');
  assert.equal(validateLatestQuery({ limit: 201 }).errors[0].field, 'limit');
  assert.equal(validateLatestQuery({ limit: 0 }).errors[0].field, 'limit');
});

test('latest: rejects injection-shaped filter values', () => {
  for (const key of ['commodity', 'commodityCategory', 'variety', 'state', 'district', 'mandi', 'marketCode']) {
    const result = validateLatestQuery({ [key]: INJECTIONS[0] });
    assert.ok(result.errors, `${key} must reject an injection-shaped value`);
    assert.equal(result.errors[0].field, key);
  }
});

test('history: defaults are order ASC, limit 100, offset 0', () => {
  const { value, errors } = validateHistoryQuery({});
  assert.equal(errors, undefined);
  assert.equal(value.order, 'ASC');
  assert.equal(value.limit, 100);
  assert.equal(value.offset, 0);
});

test('history: validates real calendar dates, not just the shape', () => {
  assert.equal(validateHistoryQuery({ startDate: '2026-09-01' }).value.startDate, '2026-09-01');
  assert.equal(validateHistoryQuery({ endDate: '2026-02-28' }).value.endDate, '2026-02-28');
  assert.equal(validateHistoryQuery({ startDate: '2026-02-31' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ startDate: '2026-13-01' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ startDate: '2026-9-1' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ startDate: '01/09/2026' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ startDate: 'not-a-date' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ endDate: '2024-02-30' }).errors[0].field, 'endDate');
  assert.equal(validateHistoryQuery({ endDate: '' }).value.endDate, undefined);
});

test('history: startDate must not be after endDate', () => {
  assert.equal(validateHistoryQuery({ startDate: '2026-09-10', endDate: '2026-09-01' }).errors[0].field, 'startDate');
  assert.equal(validateHistoryQuery({ startDate: '2026-09-01', endDate: '2026-09-01' }).errors, undefined);
  assert.equal(validateHistoryQuery({ startDate: '2026-08-01', endDate: '2026-09-01' }).errors, undefined);
});

test('history: order is restricted to ASC|DESC', () => {
  assert.equal(validateHistoryQuery({ order: 'asc' }).value.order, 'ASC');
  assert.equal(validateHistoryQuery({ order: 'DESC' }).value.order, 'DESC');
  assert.equal(validateHistoryQuery({ order: 'sideways' }).errors[0].field, 'order');
  assert.equal(validateHistoryQuery({ order: 'DESC; --' }).errors[0].field, 'order');
});

test('history: bounds are 1..1000 with limit defaulting to 100', () => {
  assert.equal(validateHistoryQuery({ limit: 1 }).value.limit, 1);
  assert.equal(validateHistoryQuery({ limit: 1000 }).value.limit, 1000);
  assert.equal(validateHistoryQuery({ limit: 1001 }).errors[0].field, 'limit');
  assert.equal(validateHistoryQuery({ limit: '-5' }).errors[0].field, 'limit');
  assert.equal(validateHistoryQuery({ offset: -1 }).errors[0].field, 'offset');
  assert.equal(validateHistoryQuery({ offset: 1_000_001 }).errors[0].field, 'offset');
});

test('history: shares every latest filter and rejects injection-shaped values', () => {
  const { value, errors } = validateHistoryQuery({ commodity: 'Onion', qualityStatus: 'VALID', includeSample: 'false', source: 'CEDA' });
  assert.equal(errors, undefined);
  assert.equal(value.commodity, 'Onion');
  assert.equal(value.qualityStatus, 'VALID');
  assert.equal(value.includeSample, false);
  assert.equal(value.source, 'CEDA');
  assert.ok(validateHistoryQuery({ commodity: INJECTIONS[3] }).errors);
  assert.ok(validateHistoryQuery({ mandi: INJECTIONS[4] }).errors);
});

test('data-status: takes no parameters and says so', () => {
  assert.deepEqual(validateDataStatusQuery({}), { value: {} });
  const { errors } = validateDataStatusQuery({ limit: '10' });
  assert.equal(errors[0].field, 'limit');
  assert.match(errors[0].message, /Unsupported query parameter/);
  assert.ok(validateDataStatusQuery({ "x'; DROP TABLE x;--": '1' }).errors);
});

test('validators never throw, whatever the input shape', () => {
  for (const validator of [validateCommodityListQuery, validateMandiListQuery, validateLatestQuery, validateHistoryQuery, validateDataStatusQuery]) {
    for (const input of [undefined, null, {}, { limit: {} }, { limit: [] }, { limit: NaN }, { search: 42 }, { order: {} }]) {
      const result = validator(input ?? {});
      assert.ok(result.errors || result.value, `${validator.name} must return errors or value`);
    }
  }
});
