/**
 * Pure unit tests for the Phase 5 market service helpers. No database contact:
 * the service module is imported only for its exported pure functions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE_AFTER_DAYS, redactSecrets, staleDays, summariseCanonical } from '../src/services/market.service.js';

const row = (overrides = {}) => ({
  source: 'DATA_GOV_IN',
  source_label: 'data.gov.in (Agmarknet daily mandi prices)',
  reported_date: '2026-09-01',
  fetched_at: new Date('2026-09-01T06:00:00Z'),
  is_sample_data: false,
  ...overrides,
});

test('summariseCanonical separates genuine from sample and names the newest of each', () => {
  const meta = summariseCanonical([
    row({ reported_date: '2026-09-01', fetched_at: new Date('2026-09-01T06:00:00Z') }),
    row({ reported_date: '2026-09-05', fetched_at: new Date('2026-09-05T07:00:00Z') }),
    row({ reported_date: '2026-09-09', is_sample_data: true, source: 'MOCK_PROVIDER', source_label: 'Synthetic sample data (not real market prices)' }),
  ]);
  assert.equal(meta.genuine_rows, 2);
  assert.equal(meta.sample_rows, 1);
  assert.equal(meta.latest_genuine_reporting_date, '2026-09-05');
  assert.equal(meta.latest_sample_reporting_date, '2026-09-09');
  assert.equal(meta.latest_genuine_fetched_at, '2026-09-05T07:00:00.000Z');
  assert.deepEqual(meta.sources.map((s) => s.code).sort(), ['DATA_GOV_IN', 'MOCK_PROVIDER']);
});

test('summariseCanonical is PAGE-SCOPED: it only sees the rows it is handed', () => {
  const whole = summariseCanonical([row({ reported_date: '2026-09-01' }), row({ reported_date: '2026-09-05' })]);
  const page = summariseCanonical([row({ reported_date: '2026-09-05' })]);
  assert.equal(whole.genuine_rows, 2);
  assert.equal(page.genuine_rows, 1);
  assert.equal(page.latest_genuine_reporting_date, '2026-09-05');
});

test('summariseCanonical never claims genuine freshness from sample rows', () => {
  const meta = summariseCanonical([row({ is_sample_data: true })]);
  assert.equal(meta.genuine_rows, 0);
  assert.equal(meta.latest_genuine_reporting_date, null);
  assert.equal(meta.latest_genuine_fetched_at, null);
  assert.equal(meta.stale_days, null);
  assert.deepEqual(Object.keys(meta), [
    'genuine_rows', 'sample_rows', 'latest_genuine_reporting_date',
    'latest_sample_reporting_date', 'latest_genuine_fetched_at', 'sources', 'stale_days',
  ]);
});

test('summariseCanonical on an empty page reports nothing rather than guessing', () => {
  const meta = summariseCanonical([]);
  assert.deepEqual(meta, {
    genuine_rows: 0,
    sample_rows: 0,
    latest_genuine_reporting_date: null,
    latest_sample_reporting_date: null,
    latest_genuine_fetched_at: null,
    sources: [],
    stale_days: null,
  });
});

test('staleDays counts whole days and is never negative', () => {
  const now = new Date('2026-09-10T23:30:00Z');
  assert.equal(staleDays('2026-09-10', now), 0);
  assert.equal(staleDays('2026-09-09', now), 1);
  assert.equal(staleDays('2026-09-01', now), 9);
  assert.equal(staleDays('2026-09-30', now), 0, 'a future date is 0 days stale, not negative');
  assert.equal(staleDays(null, now), null);
  assert.equal(staleDays('not-a-date', now), null);
  assert.equal(STALE_AFTER_DAYS, 3);
});

test('redactSecrets removes credential-shaped values and truncates long text', () => {
  assert.equal(
    redactSecrets('GET https://api.data.gov.in/resource/x?api-key=SECRET123&format=json failed'),
    'GET https://api.data.gov.in/resource/x?api-key=[REDACTED]&format=json failed'
  );
  assert.equal(redactSecrets('{"apiKey":"s3cr3t"}'), '{"apiKey":"[REDACTED]"}');
  assert.equal(redactSecrets('token=abcdef; password: hunter2'), 'token=[REDACTED]; password: [REDACTED]');
  assert.equal(redactSecrets('a plain provider timeout'), 'a plain provider timeout');
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), null);
  assert.ok(redactSecrets('x'.repeat(1000), { maxLength: 10 }).length <= 11);
});
