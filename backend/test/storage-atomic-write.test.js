/**
 * storage/atomicWrite.js: temp file + rename, no partial file at the final path,
 * no temp files left behind, streams supported. No network, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { appendJsonlLine, writeFileAtomic, writeJsonAtomic } from '../src/pipeline/storage/atomicWrite.js';

async function tempDir(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

const exists = async (filePath) => {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
};

test('writeFileAtomic: writes content, hashes it and leaves no temp files', async (t) => {
  const dir = await tempDir(t, 'atomic-');
  const target = path.join(dir, 'nested', 'file.txt');
  const result = await writeFileAtomic(target, 'hello world');
  assert.equal(result.path, target);
  assert.equal(result.atomic, true);
  assert.equal(result.bytes, 11);
  assert.equal(result.sha256, crypto.createHash('sha256').update('hello world').digest('hex'));
  assert.equal(await fsp.readFile(target, 'utf8'), 'hello world');
  assert.deepEqual(await fsp.readdir(path.dirname(target)), ['file.txt']);
});

test('writeFileAtomic: Buffer and Uint8Array payloads', async (t) => {
  const dir = await tempDir(t, 'atomic-buf-');
  const target = path.join(dir, 'bytes.bin');
  await writeFileAtomic(target, Buffer.from([1, 2, 3]));
  assert.deepEqual([...await fsp.readFile(target)], [1, 2, 3]);
  await writeFileAtomic(target, new Uint8Array([9, 8]));
  assert.deepEqual([...await fsp.readFile(target)], [9, 8]);
});

test('writeFileAtomic: the final path stays absent until the stream completes', async (t) => {
  const dir = await tempDir(t, 'atomic-stream-');
  const target = path.join(dir, 'streamed.txt');
  const input = new PassThrough();
  const pending = writeFileAtomic(target, input);
  input.write('partial-');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await exists(target), false, 'no partial file under the final name');
  input.end('tail');
  const result = await pending;
  assert.equal(await fsp.readFile(target, 'utf8'), 'partial-tail');
  assert.equal(result.bytes, 'partial-tail'.length);
  assert.deepEqual(await fsp.readdir(dir), ['streamed.txt']);
});

test('writeFileAtomic: a failing stream leaves the previous file intact and no temp behind', async (t) => {
  const dir = await tempDir(t, 'atomic-fail-');
  const target = path.join(dir, 'kept.txt');
  await fsp.writeFile(target, 'previous');
  async function* failing() {
    yield 'abc';
    throw new Error('stream boom');
  }
  await assert.rejects(writeFileAtomic(target, Readable.from(failing())), /stream boom/);
  assert.equal(await fsp.readFile(target, 'utf8'), 'previous', 'previous file is untouched');
  assert.deepEqual(await fsp.readdir(dir), ['kept.txt'], 'no .tmp file left behind');
});

test('writeFileAtomic: a fresh target stays absent when the stream fails', async (t) => {
  const dir = await tempDir(t, 'atomic-fail-new-');
  const target = path.join(dir, 'never.txt');
  await assert.rejects(writeFileAtomic(target, Readable.from((async function* () { throw new Error('nope'); })())), /nope/);
  assert.equal(await exists(target), false);
  assert.deepEqual(await fsp.readdir(dir), []);
  await assert.rejects(writeFileAtomic(target, 42), TypeError);
});

test('writeJsonAtomic / appendJsonlLine', async (t) => {
  const dir = await tempDir(t, 'atomic-json-');
  const target = path.join(dir, 'manifest.json');
  await writeJsonAtomic(target, { a: 1, nested: { b: [1, 2] } });
  assert.deepEqual(JSON.parse(await fsp.readFile(target, 'utf8')), { a: 1, nested: { b: [1, 2] } });
  assert.ok((await fsp.readFile(target, 'utf8')).endsWith('\n'));

  const jsonl = path.join(dir, 'run.jsonl');
  await appendJsonlLine(jsonl, { step: 1 });
  await appendJsonlLine(jsonl, { step: 2 });
  const lines = (await fsp.readFile(jsonl, 'utf8')).trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => JSON.parse(line).step), [1, 2]);
});
