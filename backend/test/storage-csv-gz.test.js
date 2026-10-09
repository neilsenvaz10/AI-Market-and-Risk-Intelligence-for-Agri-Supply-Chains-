/**
 * storage/csvGzWriter.js: RFC4180-ish escaping, null -> empty field, deterministic
 * column order, streaming sha256 of the UNCOMPRESSED bytes and atomic close.
 * No network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createCsvGzWriter, escapeCsvField } from '../src/pipeline/storage/csvGzWriter.js';

async function tempDir(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

const gunzipText = (buffer) => zlib.gunzipSync(buffer).toString('utf8');

test('escapeCsvField: quoting rules and nullish handling', () => {
  assert.equal(escapeCsvField(null), '');
  assert.equal(escapeCsvField(undefined), '');
  assert.equal(escapeCsvField(0), '0');
  assert.equal(escapeCsvField(false), 'false');
  assert.equal(escapeCsvField('plain'), 'plain');
  assert.equal(escapeCsvField('a,b'), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField('two\nlines'), '"two\nlines"');
  assert.equal(escapeCsvField('carriage\rreturn'), '"carriage\rreturn"');
  assert.equal(escapeCsvField(new Date(Date.UTC(2021, 9, 1))), '2021-10-01T00:00:00.000Z');
  assert.equal(escapeCsvField(['a', 'b']), 'a|b');
});

test('csv.gz: escaping, null -> empty (never 0 or "null") and round-trip', async (t) => {
  const dir = await tempDir(t, 'csvgz-');
  const target = path.join(dir, 'prices.csv.gz');
  const columns = ['a', 'b', 'c'];
  const rows = [
    { a: null, b: 0, c: 'x,y' },
    { a: undefined, b: 'q"q', c: 'line\n2' },
    { a: 'plain', b: true, c: 3.5 },
  ];
  const writer = createCsvGzWriter({ filePath: target, columns });
  for (const row of rows) await writer.writeRow(row);
  const summary = await writer.close();

  const expected = 'a,b,c\n' + ',0,"x,y"\n' + ',"q""q","line\n2"\n' + 'plain,true,3.5\n';
  const raw = gunzipText(await fsp.readFile(target));
  assert.equal(raw, expected, 'decompressed CSV equals the written bytes');
  assert.equal(summary.rows, 3);
  assert.equal(summary.uncompressedBytes, Buffer.byteLength(expected));
  assert.ok(summary.compressedBytes > 0);

  // null renders as an empty field: the first column is empty, not 0 and not "null".
  const dataLines = raw.split('\n').slice(1).filter(Boolean);
  assert.equal(dataLines[0].split(',')[0], '');
  assert.ok(!raw.includes('null'));
  assert.ok(!raw.includes('undefined'));
});

test('csv.gz: sha256 digests the uncompressed CSV and matches a direct hash', async (t) => {
  const dir = await tempDir(t, 'csvgz-hash-');
  const target = path.join(dir, 'out.csv.gz');
  const writer = createCsvGzWriter({ filePath: target, columns: ['x'] });
  await writer.writeRow({ x: 'alpha' });
  await writer.writeRow({ x: 'beta,gamma' });
  await assert.rejects(async () => writer.digest(), /after close/);
  const summary = await writer.close();

  const expectedCsv = 'x\nalpha\n"beta,gamma"\n';
  const direct = crypto.createHash('sha256').update(expectedCsv).digest('hex');
  assert.equal(gunzipText(await fsp.readFile(target)), expectedCsv);
  assert.equal(summary.sha256, direct);
  assert.equal(writer.digest(), direct);
  assert.equal(writer.summary().sha256, direct);
});

test('csv.gz: caller-supplied column order is deterministic', async (t) => {
  const dir = await tempDir(t, 'csvgz-order-');
  const target = path.join(dir, 'ordered.csv.gz');
  const writer = createCsvGzWriter({ filePath: target, columns: ['b', 'a'] });
  await writer.writeRow({ a: '1', b: '2' });
  await writer.close();
  assert.equal(gunzipText(await fsp.readFile(target)), 'b,a\n2,1\n');
});

test('csv.gz: atomic writer leaves no partial file at the final path or in the directory', async (t) => {
  const dir = await tempDir(t, 'csvgz-atomic-');
  const target = path.join(dir, 'atomic.csv.gz');
  const writer = createCsvGzWriter({ filePath: target, columns: ['v'] });
  await writer.writeRow({ v: 'row' });
  await assert.rejects(fsp.access(target), 'final path must not exist before close()');
  const summary = await writer.close();
  assert.equal(summary.path, target);
  const leftovers = await fsp.readdir(dir);
  assert.deepEqual(leftovers, ['atomic.csv.gz']);
  await assert.rejects(writer.writeRow({ v: 'late' }), /after close/);
});

test('csv.gz: header-only file when no rows are written, and non-atomic mode', async (t) => {
  const dir = await tempDir(t, 'csvgz-empty-');
  const empty = path.join(dir, 'empty.csv.gz');
  const writer = createCsvGzWriter({ filePath: empty, columns: ['a', 'b'] });
  const summary = await writer.close();
  assert.equal(summary.rows, 0);
  assert.equal(gunzipText(await fsp.readFile(empty)), 'a,b\n');

  const direct = path.join(dir, 'direct.csv.gz');
  const directWriter = createCsvGzWriter({ filePath: direct, columns: ['a'], atomic: false });
  await directWriter.writeRow({ a: 'kept' });
  const directSummary = await directWriter.close();
  assert.equal(directSummary.atomic, false);
  assert.equal(gunzipText(await fsp.readFile(direct)), 'a\nkept\n');
});

test('csv.gz: backpressure holds for many rows and every row survives', async (t) => {
  const dir = await tempDir(t, 'csvgz-bulk-');
  const target = path.join(dir, 'bulk.csv.gz');
  const writer = createCsvGzWriter({ filePath: target, columns: ['id', 'payload'] });
  const payload = 'x'.repeat(512);
  const count = 3000;
  for (let i = 0; i < count; i += 1) await writer.writeRow({ id: i, payload });
  const summary = await writer.close();
  assert.equal(summary.rows, count);
  const lines = gunzipText(await fsp.readFile(target)).trimEnd().split('\n');
  assert.equal(lines.length, count + 1);
  assert.equal(lines[1], `0,${payload}`);
  assert.equal(lines.at(-1), `${count - 1},${payload}`);
  assert.ok(summary.compressedBytes < summary.uncompressedBytes, 'gzip actually compresses');
});
