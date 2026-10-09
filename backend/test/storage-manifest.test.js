/**
 * storage/manifest.js: checkpoint mark/complete/pending logic, atomic persistence and
 * detection of a truncated or tampered manifest. No network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ManifestError,
  createManifest,
  isWindowComplete,
  loadManifest,
  markWindowComplete,
  markWindowFailed,
  pendingWindows,
  saveManifest,
  verifyWindowFile,
  windowKey,
  windowStatus,
} from '../src/pipeline/storage/manifest.js';

async function tempDir(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('loadManifest: missing file yields a fresh manifest seeded with defaults', async (t) => {
  const dir = await tempDir(t, 'manifest-new-');
  const manifest = await loadManifest(path.join(dir, 'manifest.json'), { dataset: 'prices', source: 'CEDA' });
  assert.equal(manifest.dataset, 'prices');
  assert.equal(manifest.source, 'CEDA');
  assert.deepEqual(manifest.windows, {});
  assert.ok(manifest.createdAt);
});

test('manifest: mark complete -> save -> load round-trips record count, bytes, sha and timestamps', async (t) => {
  const dir = await tempDir(t, 'manifest-roundtrip-');
  const file = path.join(dir, 'manifest.json');
  const manifest = createManifest({ dataset: 'prices', source: 'CEDA' });
  const key = '2021-10-01_2021-12-31';
  markWindowComplete(manifest, key, { recordCount: 42, bytes: 2048, sha256: 'a'.repeat(64), file: 'out.csv.gz' });
  await saveManifest(file, manifest);

  const reloaded = await loadManifest(file);
  assert.equal(reloaded.dataset, 'prices');
  assert.equal(reloaded.source, 'CEDA');
  const entry = reloaded.windows[key];
  assert.equal(entry.status, 'complete');
  assert.equal(entry.recordCount, 42);
  assert.equal(entry.bytes, 2048);
  assert.equal(entry.sha256, 'a'.repeat(64));
  assert.equal(entry.file, 'out.csv.gz');
  assert.ok(Date.parse(entry.completedAt));
  assert.ok(Date.parse(entry.updatedAt));
  assert.equal(entry.error, null);
  assert.equal(isWindowComplete(reloaded, key), true);
  assert.deepEqual(await fsp.readdir(dir), ['manifest.json'], 'atomic save leaves no temp file');

  const doc = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.deepEqual(doc.integrity.algorithm, 'sha256');
  assert.equal(doc.integrity.complete, true);
  assert.equal(doc.integrity.hash.length, 64);
});

test('manifest: failed windows are recorded, never complete, and stay pending', () => {
  const manifest = createManifest({ dataset: 'prices' });
  const error = Object.assign(new Error('CEDA returned HTTP 500'), { code: 'HTTP_ERROR' });
  markWindowFailed(manifest, '2022-01-01_2022-03-31', error);
  markWindowComplete(manifest, '2022-04-01_2022-06-30', { recordCount: 5, bytes: 10, sha256: 'b'.repeat(64) });

  assert.equal(windowStatus(manifest, '2022-01-01_2022-03-31'), 'failed');
  assert.equal(isWindowComplete(manifest, '2022-01-01_2022-03-31'), false);
  assert.equal(manifest.windows['2022-01-01_2022-03-31'].error, 'CEDA returned HTTP 500');
  assert.equal(manifest.windows['2022-01-01_2022-03-31'].errorCode, 'HTTP_ERROR');
  assert.equal(manifest.windows['2022-01-01_2022-03-31'].completedAt, null);
  assert.equal(windowStatus(manifest, '2099-01-01_2099-01-31'), 'missing');
});

test('manifest: pendingWindows accepts string, {from,to} and {year,month} descriptors', () => {
  const manifest = createManifest({ dataset: 'prices' });
  markWindowComplete(manifest, '2021-10', { recordCount: 1 });
  markWindowComplete(manifest, '2022-01-01_2022-03-31', { recordCount: 1 });
  const all = ['2021-10', { year: '2021', month: '11' }, { from: '2022-01-01', to: '2022-03-31' }, { key: '2022-04-01_2022-06-30' }];
  assert.deepEqual(pendingWindows(manifest, all), [{ year: '2021', month: '11' }, { key: '2022-04-01_2022-06-30' }]);
  assert.equal(windowKey('abc'), 'abc');
  assert.equal(windowKey({ from: '2020-01-01', to: '2020-01-31' }), '2020-01-01_2020-01-31');
  assert.equal(windowKey({ year: '2020', month: '02' }), '2020-02');
  assert.throws(() => windowKey({ nothing: true }), TypeError);
});

test('manifest: error messages are redacted before being persisted', () => {
  const manifest = createManifest({ dataset: 'prices' });
  const secret = 'SUPERSECRETKEY123';
  markWindowFailed(manifest, 'w1', new Error(`request failed with api-key=${secret} at https://example.test`), { secrets: [secret] });
  const entry = manifest.windows.w1;
  assert.ok(!entry.error.includes(secret), `secret leaked into manifest: ${entry.error}`);
  assert.match(entry.error, /REDACTED/);
});

test('manifest: a truncated file is detected, never treated as valid', async (t) => {
  const dir = await tempDir(t, 'manifest-truncated-');
  const file = path.join(dir, 'manifest.json');
  const manifest = createManifest({ dataset: 'prices' });
  markWindowComplete(manifest, 'w1', { recordCount: 1, bytes: 2, sha256: 'c'.repeat(64) });
  markWindowComplete(manifest, 'w2', { recordCount: 3, bytes: 4, sha256: 'd'.repeat(64) });
  await saveManifest(file, manifest);

  const full = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, full.slice(0, Math.floor(full.length / 2)));
  await assert.rejects(loadManifest(file), (err) => {
    assert.ok(err instanceof ManifestError);
    assert.equal(err.code, 'MANIFEST_TRUNCATED');
    assert.match(err.message, /truncated or corrupt/);
    return true;
  });

  await fsp.writeFile(file, '');
  await assert.rejects(loadManifest(file), (err) => err.code === 'MANIFEST_TRUNCATED');
});

test('manifest: tampering or a missing integrity block is rejected', async (t) => {
  const dir = await tempDir(t, 'manifest-tamper-');
  const file = path.join(dir, 'manifest.json');
  const manifest = createManifest({ dataset: 'prices' });
  markWindowComplete(manifest, 'w1', { recordCount: 1, bytes: 2, sha256: 'e'.repeat(64) });
  await saveManifest(file, manifest);

  const doc = JSON.parse(await fsp.readFile(file, 'utf8'));
  doc.windows.w1.recordCount = 9999;
  await fsp.writeFile(file, JSON.stringify(doc, null, 2));
  await assert.rejects(loadManifest(file), (err) => {
    assert.equal(err.code, 'MANIFEST_CORRUPT');
    return true;
  });

  delete doc.integrity;
  await fsp.writeFile(file, JSON.stringify(doc, null, 2));
  await assert.rejects(loadManifest(file), (err) => err.code === 'MANIFEST_INCOMPLETE');
});

test('manifest: verifyWindowFile checks size and sha256 of the recorded artefact', async (t) => {
  const dir = await tempDir(t, 'manifest-verify-');
  const artefact = path.join(dir, 'out.csv.gz');
  const body = 'a,b\n1,2\n';
  await fsp.writeFile(artefact, body);
  const manifest = createManifest({ dataset: 'prices' });
  markWindowComplete(manifest, 'w1', {
    recordCount: 1,
    bytes: Buffer.byteLength(body),
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    file: 'out.csv.gz',
  });

  assert.equal(await verifyWindowFile(manifest, 'w1', { baseDir: dir }), true);
  await fsp.writeFile(artefact, 'a,b\n9,9\n');
  assert.equal(await verifyWindowFile(manifest, 'w1', { baseDir: dir }), false);
  assert.equal(await verifyWindowFile(manifest, 'missing', { baseDir: dir }), false);
});
