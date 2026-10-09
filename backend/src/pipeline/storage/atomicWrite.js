/**
 * Atomic file writes: data is streamed to a sibling temp file on the SAME volume,
 * flushed, then `rename`d into place. A crash therefore leaves either the previous
 * file or nothing at the final path — never a truncated file. Temp files are always
 * removed on failure.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const isPlainPayload = (data) => typeof data === 'string' || data instanceof Uint8Array;

function tempPathFor(target) {
  const dir = path.dirname(target);
  return path.join(dir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
}

function toBuffer(chunk, encoding) {
  return chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk), encoding);
}

/**
 * Writes `data` (string | Buffer | Uint8Array | AsyncIterable/Readable) to `filePath`.
 * Resolves only after the rename; returns { path, bytes, sha256, atomic: true }.
 */
export async function writeFileAtomic(filePath, data, { encoding = 'utf8', mode = 0o644, fsync = true } = {}) {
  if (!filePath) throw new TypeError('writeFileAtomic(filePath, data) requires a path');
  if (data === undefined) throw new TypeError('writeFileAtomic(filePath, data) requires data');
  const target = path.resolve(filePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });

  const tmp = tempPathFor(target);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let handle = null;
  try {
    handle = await fsp.open(tmp, 'wx', mode);
    if (isPlainPayload(data)) {
      const buffer = toBuffer(data, encoding);
      hash.update(buffer);
      bytes += buffer.length;
      await handle.writeFile(buffer);
    } else if (typeof data?.[Symbol.asyncIterator] === 'function' || typeof data?.pipe === 'function') {
      for await (const chunk of data) {
        if (chunk === null || chunk === undefined) continue;
        const buffer = toBuffer(chunk, encoding);
        hash.update(buffer);
        bytes += buffer.length;
        await handle.writeFile(buffer);
      }
    } else {
      throw new TypeError('writeFileAtomic accepts a string, Buffer, Uint8Array, Readable or async iterable');
    }
    if (fsync) await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(tmp, target);
    return { path: target, bytes, sha256: hash.digest('hex'), atomic: true, measured: true };
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Convenience: atomic JSON document (2-space indent, trailing newline). */
export async function writeJsonAtomic(filePath, value, options = {}) {
  return writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

/**
 * Appends exactly one JSONL line and fsyncs it. Used for append-only run logs where a
 * torn final line is recovered by skipping unparseable trailing lines.
 */
export async function appendJsonlLine(filePath, value, { encoding = 'utf8', fsync = true } = {}) {
  if (!filePath) throw new TypeError('appendJsonlLine(filePath, value) requires a path');
  const target = path.resolve(filePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const line = `${typeof value === 'string' ? value : JSON.stringify(value)}\n`;
  const handle = await fsp.open(target, 'a');
  try {
    await handle.writeFile(line, encoding);
    if (fsync) await handle.sync();
  } finally {
    await handle.close();
  }
  return { path: target, bytes: Buffer.byteLength(line, encoding), atomic: true, measured: true };
}

export default { writeFileAtomic, writeJsonAtomic, appendJsonlLine };
