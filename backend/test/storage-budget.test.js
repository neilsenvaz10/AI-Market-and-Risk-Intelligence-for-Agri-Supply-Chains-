/**
 * storage/budget.js: measured directory accounting, per-dataset usage, the working-data
 * budget and the disk-floor interaction. Uses a temp tree and a fake volume — no network,
 * no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GB, HARD_FLOOR_GB, InsufficientDiskSpaceError } from '../src/pipeline/storage/diskGuard.js';
import { BUDGET_REASONS, BudgetExceededError, createBudget, measureDirectory } from '../src/pipeline/storage/budget.js';

const fakeStatfs = (freeBytes) => async () => ({ bavail: freeBytes, bsize: 1 });

async function tempDir(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function seedTree(t) {
  const dir = await tempDir(t, 'budget-');
  await fsp.mkdir(path.join(dir, 'datasetA'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'datasetB', 'nested'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'datasetA', 'f1.csv.gz'), Buffer.alloc(5000, 1));
  await fsp.writeFile(path.join(dir, 'datasetB', 'nested', 'f2.csv.gz'), Buffer.alloc(3000, 2));
  await fsp.writeFile(path.join(dir, 'manifest.json'), 'abc');
  return dir;
}

test('measureDirectory: measured byte/file totals and per-dataset usage', async (t) => {
  const dir = await seedTree(t);
  const usage = await measureDirectory(dir);
  assert.equal(usage.measured, true);
  assert.equal(usage.exists, true);
  assert.equal(usage.bytes, 8003);
  assert.equal(usage.files, 3);
  assert.equal(usage.directories, 3);
  assert.deepEqual(usage.byDataset.datasetA, { bytes: 5000, files: 1 });
  assert.deepEqual(usage.byDataset.datasetB, { bytes: 3000, files: 1 });
  assert.deepEqual(usage.byDataset['(root)'], { bytes: 3, files: 1 });

  const missing = await measureDirectory(path.join(dir, 'does-not-exist'));
  assert.equal(missing.exists, false);
  assert.equal(missing.bytes, 0);
  assert.equal(missing.measured, true);
});

test('budget: report labels measured usage and sorts datasets by size', async (t) => {
  const dir = await seedTree(t);
  const budget = createBudget({ dir, budgetGb: 10, statfsImpl: fakeStatfs(500 * GB) });
  const report = await budget.report();
  assert.equal(report.measured, true);
  assert.equal(report.usage.measured, true);
  assert.equal(report.free.measured, true);
  assert.equal(report.budget.bytes, 10 * GB);
  assert.equal(report.usage.bytes, 8003);
  assert.equal(report.remainingBytes, 10 * GB - 8003);
  assert.equal(report.floorSatisfied, true);
  assert.deepEqual(report.datasets.map((entry) => entry.dataset), ['datasetA', 'datasetB', '(root)']);
  assert.equal(report.datasets[0].measured, true);
});

test('budget: canWrite is false when the working budget would be exceeded', async (t) => {
  const dir = await seedTree(t);
  const budget = createBudget({ dir, budgetGb: 0.000001, statfsImpl: fakeStatfs(500 * GB) });
  assert.equal(await budget.canWrite(1), false);
  const decision = await budget.explainWrite(1);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, BUDGET_REASONS.WORKING_BUDGET_EXCEEDED);
  assert.equal(decision.usedBytes, 8003);
  assert.ok(decision.budgetBytes < decision.usedBytes + 1);
  await assert.rejects(budget.assertCanWrite(1), BudgetExceededError);

  const roomy = createBudget({ dir, budgetGb: 10, statfsImpl: fakeStatfs(500 * GB) });
  assert.equal(await roomy.canWrite(1024), true);
  assert.equal((await roomy.explainWrite(1024)).reason, BUDGET_REASONS.OK);
});

test('budget: canWrite is false below the disk floor and never lowers the 10 GB floor', async (t) => {
  const dir = await seedTree(t);
  const belowFloor = createBudget({ dir, budgetGb: 10, minFreeGb: 0, statfsImpl: fakeStatfs(5 * GB) });
  assert.equal(belowFloor.floorGb, HARD_FLOOR_GB, 'requesting 0 GB cannot lower the floor');
  assert.equal(belowFloor.floorBytes, 10 * GB);
  assert.equal(await belowFloor.canWrite(1), false);
  assert.equal((await belowFloor.explainWrite(1)).reason, BUDGET_REASONS.BELOW_DISK_FLOOR);
  await assert.rejects(belowFloor.assertCanWrite(1), InsufficientDiskSpaceError);

  const wouldBreach = createBudget({ dir, budgetGb: 10, statfsImpl: fakeStatfs(10 * GB + 1024) });
  assert.equal((await wouldBreach.explainWrite(4096)).reason, BUDGET_REASONS.WOULD_BREACH_DISK_FLOOR);
  assert.equal(await wouldBreach.canWrite(512), true, 'a small write still fits above the floor');

  const raisedFloor = createBudget({ dir, budgetGb: 10, minFreeGb: 25, statfsImpl: fakeStatfs(20 * GB) });
  assert.equal(raisedFloor.floorGb, 25);
  assert.equal(await raisedFloor.canWrite(1), false);
});

test('budget: rejects invalid configuration and invalid byte counts', async (t) => {
  const dir = await seedTree(t);
  assert.throws(() => createBudget({}), TypeError);
  assert.throws(() => createBudget({ dir, budgetGb: -1 }), TypeError);
  const budget = createBudget({ dir, budgetGb: 10, statfsImpl: fakeStatfs(500 * GB) });
  await assert.rejects(budget.explainWrite(-1), TypeError);
  await assert.rejects(budget.explainWrite('many'), TypeError);
});
