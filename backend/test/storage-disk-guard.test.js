/**
 * storage/diskGuard.js: measured free space, the non-configurable 10 GB floor,
 * estimateRunBytes arithmetic and the measured/estimated flag. Free space is injected
 * so no test ever depends on the real volume being nearly full. No network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GB,
  HARD_FLOOR_GB,
  InsufficientDiskSpaceError,
  assertMinimumFree,
  availableBytes,
  estimateRunBytes,
  resolveMinFreeGb,
} from '../src/pipeline/storage/diskGuard.js';

async function tempDir(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Fake volume: a fixed number of free bytes. */
const fakeStatfs = (freeBytes) => async () => ({ bavail: freeBytes, bsize: 1 });

test('estimateRunBytes: arithmetic is labeled estimated, never measured', () => {
  const plain = estimateRunBytes({ perRecordBytes: 250, records: 400 });
  assert.equal(plain.estimatedBytes, 100_000);
  assert.equal(plain.payloadBytes, 100_000);
  assert.equal(plain.measured, false);
  assert.equal(plain.basis, 'estimate');

  const withOverhead = estimateRunBytes({ perRecordBytes: 250, records: 400, overheadBytes: 500 });
  assert.equal(withOverhead.estimatedBytes, 100_500);

  const compressed = estimateRunBytes({ perRecordBytes: 1000, records: 10, compressionRatio: 0.4, overheadBytes: 100 });
  assert.equal(compressed.estimatedBytes, 4100);

  const rounded = estimateRunBytes({ perRecordBytes: 1.5, records: 3 });
  assert.equal(rounded.estimatedBytes, 5);

  assert.throws(() => estimateRunBytes({ perRecordBytes: -1, records: 10 }), TypeError);
  assert.throws(() => estimateRunBytes({ perRecordBytes: 1, records: Number.NaN }), TypeError);
  assert.throws(() => estimateRunBytes({ perRecordBytes: 1, records: 1, overheadBytes: -5 }), TypeError);
  assert.throws(() => estimateRunBytes({ perRecordBytes: 1, records: 1, compressionRatio: 0 }), TypeError);
});

test('resolveMinFreeGb: the 10 GB floor can never be lowered', () => {
  assert.equal(HARD_FLOOR_GB, 10);
  assert.equal(resolveMinFreeGb(1), 10);
  assert.equal(resolveMinFreeGb(0), 10);
  assert.equal(resolveMinFreeGb(-250), 10);
  assert.equal(resolveMinFreeGb(undefined), 10);
  assert.equal(resolveMinFreeGb('nonsense'), 10);
  assert.equal(resolveMinFreeGb(25), 25);
  assert.equal(resolveMinFreeGb('15'), 15);
});

test('availableBytes: returns measured free space with its method and probe path', async (t) => {
  const dir = await tempDir(t, 'diskguard-ok-');
  const info = await availableBytes(dir, { statfsImpl: fakeStatfs(123 * GB) });
  assert.equal(info.freeBytes, 123 * GB);
  assert.equal(info.measured, true);
  assert.equal(info.method, 'statfs');
  assert.equal(info.path, dir);
  assert.ok(Date.parse(info.at));

  const injected = await availableBytes(dir, { freeBytesImpl: async () => 7 * GB });
  assert.equal(injected.freeBytes, 7 * GB);
  assert.equal(injected.method, 'injected');

  // Probing a not-yet-created data directory walks up to an existing ancestor.
  const nested = await availableBytes(path.join(dir, 'not', 'created', 'yet'), { statfsImpl: fakeStatfs(5 * GB) });
  assert.equal(nested.path, dir);
  assert.equal(nested.requestedPath, path.join(dir, 'not', 'created', 'yet'));
});

test('availableBytes: a real volume can be measured', async () => {
  const info = await availableBytes(os.tmpdir());
  assert.equal(info.measured, true);
  assert.ok(info.freeBytes > 0, `expected measurable free space, got ${info.freeBytes}`);
});

test('assertMinimumFree: throws a typed error below the threshold and names the floor', async (t) => {
  const dir = await tempDir(t, 'diskguard-low-');
  await assert.rejects(
    assertMinimumFree(dir, 1, { statfsImpl: fakeStatfs(5 * GB) }),
    (err) => {
      assert.ok(err instanceof InsufficientDiskSpaceError);
      assert.equal(err.code, 'INSUFFICIENT_DISK_SPACE');
      assert.equal(err.freeBytes, 5 * GB);
      assert.equal(err.requiredBytes, 10 * GB);
      assert.match(err.message, /10 GB minimum/);
      assert.match(err.message, /hard floor 10 GB/);
      return true;
    }
  );
  // Requesting 1 GB cannot lower the floor: 9.99 GB still fails, 10.5 GB passes.
  await assert.rejects(assertMinimumFree(dir, 1, { statfsImpl: fakeStatfs(9.99 * GB) }), InsufficientDiskSpaceError);
  await assert.rejects(assertMinimumFree(dir, 0, { statfsImpl: fakeStatfs(9.99 * GB) }), InsufficientDiskSpaceError);
  await assert.rejects(assertMinimumFree(dir, -100, { statfsImpl: fakeStatfs(9.99 * GB) }), InsufficientDiskSpaceError);

  const ok = await assertMinimumFree(dir, 0, { statfsImpl: fakeStatfs(10.5 * GB) });
  assert.equal(ok.ok, true);
  assert.equal(ok.measured, true);
  assert.equal(ok.requestedMinFreeGb, 0);
  assert.equal(ok.effectiveMinFreeGb, 10);
  assert.equal(ok.floorGb, 10);
  assert.equal(ok.minFreeBytes, 10 * GB);
});

test('assertMinimumFree: a caller may only raise the floor', async (t) => {
  const dir = await tempDir(t, 'diskguard-raise-');
  await assert.rejects(assertMinimumFree(dir, 20, { statfsImpl: fakeStatfs(11 * GB) }), (err) => {
    assert.equal(err.code, 'INSUFFICIENT_DISK_SPACE');
    assert.equal(err.requiredBytes, 20 * GB);
    assert.match(err.message, /20 GB minimum/);
    return true;
  });
  const ok = await assertMinimumFree(dir, 20, { statfsImpl: fakeStatfs(21 * GB) });
  assert.equal(ok.effectiveMinFreeGb, 20);
  assert.equal(ok.floorGb, 10);
});
