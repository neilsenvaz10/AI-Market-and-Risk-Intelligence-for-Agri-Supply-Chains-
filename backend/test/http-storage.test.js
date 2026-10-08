import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSourceHttpClient, redactUrl } from '../src/pipeline/http.js';
import { createDiskGuard, Manifest, readCsvGz, writeCsvGz } from '../src/pipeline/historical/storage.js';
import { clampToHistoricalWindow } from '../src/pipeline/historical/ceda-export.js';

const quietLog = { warn() {} };
const jsonResponse = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test('http: retries 429/5xx with backoff and honours Retry-After', async () => {
  const statuses = [429, 503, 200];
  let calls = 0;
  const client = createSourceHttpClient({
    retries: 3, baseBackoffMs: 1, requestIntervalMs: 0, log: quietLog,
    fetchImpl: async () => {
      const status = statuses[calls++];
      return jsonResponse(status, { ok: status === 200 }, status === 429 ? { 'retry-after': '0' } : {});
    },
  });
  const result = await client.requestJson('https://example.test/x');
  assert.equal(calls, 3);
  assert.deepEqual(result.data, { ok: true });
});

test('http: gives up after the retry budget and does not retry 401', async () => {
  let calls = 0;
  const failing = createSourceHttpClient({ retries: 2, baseBackoffMs: 1, requestIntervalMs: 0, log: quietLog,
    fetchImpl: async () => { calls += 1; return jsonResponse(500, {}); } });
  await assert.rejects(failing.requestJson('https://example.test/x'), { status: 500 });
  assert.equal(calls, 3);

  calls = 0;
  const unauthorized = createSourceHttpClient({ retries: 3, requestIntervalMs: 0, log: quietLog,
    fetchImpl: async () => { calls += 1; return jsonResponse(401, { message: 'no api key passed' }); } });
  await assert.rejects(unauthorized.requestJson('https://example.test/x'), { code: 'UNAUTHORIZED' });
  assert.equal(calls, 1);
});

test('http: times out slow requests', async () => {
  const client = createSourceHttpClient({ timeoutMs: 20, retries: 0, requestIntervalMs: 0, log: quietLog,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(client.requestJson('https://example.test/slow'), { code: 'TIMEOUT' });
});

test('http: errors and logs never contain credentials', async () => {
  const client = createSourceHttpClient({ retries: 0, requestIntervalMs: 0, log: quietLog,
    fetchImpl: async () => jsonResponse(403, { echo: 'api-key=topsecret' }) });
  const error = await client.requestJson('https://api.example.test/r?api-key=topsecret&limit=1').catch((e) => e);
  assert.ok(!JSON.stringify({ message: error.message, url: error.url }).includes('topsecret'));
  assert.equal(redactUrl('https://x.test/?api_key=a&token=b&limit=1'), 'https://x.test/?api_key=REDACTED&token=REDACTED&limit=1');
});

test('storage: gzip CSV round-trips (quotes, commas, nulls) and is written atomically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-csv-'));
  try {
    const file = path.join(dir, 'a', 'b.csv.gz');
    const rows = [{ name: 'Pune(Moshi), "Main"', price: 1500, flags: ['A', 'B'], empty: null }];
    const result = await writeCsvGz(file, ['name', 'price', 'flags', 'empty'], rows);
    assert.equal(result.rows, 1);
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    await assert.rejects(fs.stat(`${file}.partial`), { code: 'ENOENT' });
    const back = [];
    for await (const row of readCsvGz(file)) back.push(row);
    assert.deepEqual(back, [{ name: 'Pune(Moshi), "Main"', price: '1500', flags: 'A|B', empty: null }]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('storage: disk guard stops on low free space and on budget overrun', async () => {
  const lowDisk = createDiskGuard({ dir: '.', minFreeGb: 20, budgetMb: 1, freeBytesImpl: async () => 5 * 1024 ** 3 });
  await assert.rejects(lowDisk.assertSpace('test'), { code: 'LOW_DISK_SPACE' });
  const budget = createDiskGuard({ dir: '.', minFreeGb: 1, budgetMb: 1, freeBytesImpl: async () => 500 * 1024 ** 3 });
  budget.addBytes(512 * 1024);
  assert.throws(() => budget.addBytes(600 * 1024), { code: 'DOWNLOAD_BUDGET_EXCEEDED' });
});

test('storage: manifest checkpoints survive a reload (resume)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-manifest-'));
  try {
    const file = path.join(dir, 'manifest.json');
    const first = await Manifest.load(file, { source: 'CEDA' });
    await first.update('task-1', { status: 'done', rows: 10 });
    const reloaded = await Manifest.load(file, {});
    assert.equal(reloaded.task('task-1').status, 'done');
    assert.equal(reloaded.data.source, 'CEDA');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('historical window: only 2021-10-01..2026-09-30 is accepted', () => {
  assert.deepEqual(clampToHistoricalWindow('2021-10-01', '2026-09-30'), { from: '2021-10-01', to: '2026-09-30' });
  assert.throws(() => clampToHistoricalWindow('2021-09-30', '2021-10-05'));
  assert.throws(() => clampToHistoricalWindow('2026-09-01', '2026-10-01'));
});
