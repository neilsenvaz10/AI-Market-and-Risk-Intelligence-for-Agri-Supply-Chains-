/**
 * CEDA historical export: CSV/gzip, manifest checkpoints, resume, disk guard.
 * Uses a fake CEDA HTTP client (synthetic responses, no network, no database).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CedaClient, CedaProvider } from '../src/pipeline/providers/ceda.provider.js';
import { runCedaExport } from '../src/pipeline/historical/ceda-export.js';
import { readCsvGz } from '../src/pipeline/historical/storage.js';

function fakeHttp() {
  const counts = { prices: 0, quantities: 0 };
  return {
    counts,
    async requestJson(url, { method, body }) {
      const route = `${method} ${new URL(url).pathname.replace('/v1', '')}`;
      if (route === 'GET /agmarknet/commodities') return { data: { commodities: [{ id: 3, name: 'Onion' }] } };
      if (route === 'GET /agmarknet/geographies') return { data: { geographies: [{ state_id: 27, state_name: 'Maharashtra', districts: [{ district_id: 516, district_name: 'Nashik' }] }] } };
      if (route === 'POST /agmarknet/markets') return { data: { data: [{ market_id: 901, market_name: 'Lasalgaon' }] } };
      if (route === 'POST /agmarknet/prices') {
        counts.prices += 1;
        return { data: { data: [
          { date: body.from_date, commodity_id: 3, census_state_id: 27, census_district_id: 516, market_id: 901, min_price: 1000, max_price: 1600, modal_price: 1400 },
          { date: body.from_date, commodity_id: 3, census_state_id: 27, census_district_id: 516, market_id: 901, min_price: 2000, max_price: 1600, modal_price: 1400 },
        ] } };
      }
      if (route === 'POST /agmarknet/quantities') {
        counts.quantities += 1;
        return { data: { data: [{ date: body.from_date, market_id: 901, quantity: 55.5 }] } };
      }
      throw new Error(`unexpected ${route}`);
    },
  };
}

const roomyDisk = { assertSpace: async () => 500 * 1024 ** 3, addBytes() {}, bytesWritten: 0 };
const quiet = { log() {}, error() {} };

test('export writes gzip CSV + raw JSON + manifest, then resumes without refetching', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-ceda-'));
  try {
    const http = fakeHttp();
    const provider = new CedaProvider({ client: new CedaClient({ apiKey: 'k', http }) });
    const options = { provider, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik', fromDate: '2026-09-01', toDate: '2026-09-30',
      windowDays: 10, outDir: dir, log: quiet, guard: roomyDisk };
    const first = await runCedaExport(options);
    assert.equal(first.tasksPlanned, 3);
    assert.equal(first.tasksCompleted, 3);
    assert.equal(first.rowsValid, 3);
    assert.equal(first.rowsRejected, 3, 'min > max rows are written as rejected, not dropped silently');
    assert.equal(http.counts.prices, 3);

    const manifest = JSON.parse(await fs.readFile(first.manifestPath, 'utf8'));
    const task = Object.values(manifest.tasks)[0];
    assert.equal(task.status, 'done');
    assert.match(task.csvSha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.attribution, /CEDA, Ashoka University/);
    const rows = [];
    for await (const row of readCsvGz(path.join(dir, task.csvFile))) rows.push(row);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].validation_status, 'valid');
    assert.equal(rows[0].source, 'CEDA');
    assert.equal(rows[0].price_unit, 'INR/quintal');
    assert.equal(rows[0].arrivals_quantity, '55.5');
    assert.equal(rows[1].rejection_codes, 'MIN_ABOVE_MAX|MODAL_OUTSIDE_RANGE');
    await fs.access(path.join(dir, task.rawFile));

    const resumed = await runCedaExport(options);
    assert.equal(resumed.tasksSkipped, 3);
    assert.equal(http.counts.prices, 3, 'completed windows are not fetched again');

    // A damaged file is detected (size/checksum) and that window is fetched again.
    await fs.writeFile(path.join(dir, task.csvFile), 'corrupted');
    const repaired = await runCedaExport(options);
    assert.equal(repaired.tasksCompleted, 1);
    assert.equal(http.counts.prices, 4);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('export stops cleanly when the disk guard trips, leaving the manifest consistent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fasalytics-ceda-'));
  try {
    let checks = 0;
    const guard = {
      bytesWritten: 0,
      addBytes() {},
      async assertSpace(stage) {
        checks += 1;
        if (checks > 2) throw Object.assign(new Error(`low disk (${stage})`), { code: 'LOW_DISK_SPACE' });
      },
    };
    const provider = new CedaProvider({ client: new CedaClient({ apiKey: 'k', http: fakeHttp() }) });
    const summary = await runCedaExport({ provider, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik',
      fromDate: '2026-09-01', toDate: '2026-09-30', windowDays: 10, outDir: dir, log: quiet, guard });
    assert.match(summary.stoppedReason, /low disk/);
    const manifest = JSON.parse(await fs.readFile(summary.manifestPath, 'utf8'));
    const statuses = Object.values(manifest.tasks).map((t) => t.status);
    assert.deepEqual(statuses, ['done', 'failed']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('export refuses dates outside the 2021-10-01..2026-09-30 historical window', async () => {
  const provider = new CedaProvider({ client: new CedaClient({ apiKey: 'k', http: fakeHttp() }) });
  await assert.rejects(runCedaExport({ provider, commodity: 'Onion', state: 'Maharashtra', district: 'Nashik',
    fromDate: '2026-09-01', toDate: '2026-10-08', outDir: os.tmpdir(), guard: roomyDisk, log: quiet }), /must lie within/);
});
