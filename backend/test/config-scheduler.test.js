import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMandiConfig, parseProvider, parseSyncInterval } from '../src/config/mandiConfig.js';
import { createMandiSyncScheduler, describeSchedulerConfig } from '../src/pipeline/scheduler.js';
import { planIncrementalWindow } from '../src/pipeline/index.js';

test('interval: 0, unset and invalid values disable the scheduler', () => {
  assert.equal(parseSyncInterval('0').enabled, false);
  assert.equal(parseSyncInterval(undefined).enabled, false);
  assert.equal(parseSyncInterval('').enabled, false);
  for (const bad of ['abc', '5abc', '-5', '1.5', '60 ']) {
    const parsed = parseSyncInterval(bad);
    if (bad === '60 ') assert.equal(parsed.enabled, true); // surrounding whitespace is tolerated
    else assert.equal(parsed.enabled, false, `"${bad}" must not enable the scheduler`);
  }
});

test('interval: values below 15 minutes never start a rapid job', () => {
  for (const fast of ['1', '5', '14']) assert.equal(parseSyncInterval(fast).enabled, false);
  assert.deepEqual(parseSyncInterval('15'), { enabled: true, minutes: 15, reason: null });
  assert.equal(parseSyncInterval('999999').enabled, false);
});

test('provider: unset means none; AGMARKNET maps to DATA_GOV_IN; unknown is rejected', () => {
  assert.equal(parseProvider('').provider, null);
  assert.equal(parseProvider(undefined).provider, null);
  assert.equal(parseProvider('agmarknet').provider, 'DATA_GOV_IN');
  assert.match(parseProvider('agmarknet').warning, /deprecated/);
  assert.equal(parseProvider('scraper').provider, null);
});

test('defaults are safe: no provider, scheduler off, sample writes off', () => {
  const cfg = parseMandiConfig({});
  assert.equal(cfg.provider, null);
  assert.equal(cfg.sync.enabled, false);
  assert.equal(cfg.allowSampleData, false);
  assert.equal(parseMandiConfig({ MANDI_ALLOW_SAMPLE_DATA: 'true', NODE_ENV: 'production' }).allowSampleData, false);
  assert.equal(parseMandiConfig({ CEDA_API_KEY: 'your_ceda_api_key_here' }).cedaApiKey, '', 'template placeholder is not a key');
});

test('scheduler: only DATA_GOV_IN can be scheduled; MOCK and CEDA never are', () => {
  const base = parseMandiConfig({ MANDI_SYNC_INTERVAL_MINUTES: '60' });
  assert.equal(describeSchedulerConfig({ ...base, provider: null }).enabled, false);
  assert.equal(describeSchedulerConfig({ ...base, provider: 'MOCK' }).enabled, false);
  assert.equal(describeSchedulerConfig({ ...base, provider: 'CEDA' }).enabled, false);
  assert.equal(describeSchedulerConfig({ ...base, provider: 'DATA_GOV_IN' }).enabled, true);
  assert.equal(describeSchedulerConfig(parseMandiConfig({ MANDI_SYNC_INTERVAL_MINUTES: '0', MANDI_DATA_PROVIDER: 'DATA_GOV_IN' })).enabled, false);
});

test('scheduler: disabled config never creates a timer', () => {
  let timers = 0;
  const scheduler = createMandiSyncScheduler({
    mandiConfig: parseMandiConfig({ MANDI_SYNC_INTERVAL_MINUTES: '0' }),
    pipeline: { runPipeline: async () => assert.fail('must not run') },
    setIntervalFn: () => { timers += 1; },
    log: {},
  });
  assert.equal(scheduler.start(), false);
  assert.equal(timers, 0);
});

test('scheduler: overlapping ticks are skipped and failures are reported', async () => {
  let release;
  const calls = [];
  const pipeline = {
    runPipeline: (options) => {
      calls.push(options);
      return new Promise((resolve) => { release = () => resolve({ status: 'FAILED', error_code: 'NETWORK_ERROR', error_details: 'down', source: 'DATA_GOV_IN' }); });
    },
  };
  const errors = [];
  const scheduler = createMandiSyncScheduler({
    mandiConfig: { ...parseMandiConfig({ MANDI_SYNC_INTERVAL_MINUTES: '30', MANDI_DATA_PROVIDER: 'DATA_GOV_IN' }) },
    pipeline,
    setIntervalFn: () => ({ unref() {} }),
    log: { log() {}, warn() {}, error: (m) => errors.push(m) },
  });
  assert.equal(scheduler.start(), true);
  const first = scheduler.tick();
  assert.equal(await scheduler.tick(), null, 'second tick while running is skipped');
  release();
  await first;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'DATA_GOV_IN');
  assert.ok(calls[0].signal instanceof AbortSignal, 'each run gets an abort signal for the job timeout');
  assert.equal(scheduler.state.skippedOverlaps, 1);
  assert.equal(scheduler.state.lastError, 'down');
  assert.match(errors[0], /FAILED/);
});

test('incremental window: lookback for late reports, resumes after gaps, capped', () => {
  assert.deepEqual(planIncrementalWindow({ today: '2026-10-08', lookbackDays: 3 }), { fromDate: '2026-10-06', toDate: '2026-10-08' });
  assert.deepEqual(planIncrementalWindow({ today: '2026-10-08', lookbackDays: 3, lastWindowTo: '2026-10-01' }),
    { fromDate: '2026-09-29', toDate: '2026-10-08' });
  assert.deepEqual(planIncrementalWindow({ today: '2026-10-08', lookbackDays: 3, lastWindowTo: '2025-01-01', maxDays: 30 }),
    { fromDate: '2026-09-09', toDate: '2026-10-08' });
});
