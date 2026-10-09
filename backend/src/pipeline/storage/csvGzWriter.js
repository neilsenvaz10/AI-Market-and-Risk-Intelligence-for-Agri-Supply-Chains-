/**
 * Streaming gzip CSV writer.
 *
 * Rows are serialised with a caller-supplied, deterministic column order and
 * RFC4180-style quoting, then compressed on the fly with `node:zlib` (no extra
 * dependency). A streaming sha256 is computed over the UNCOMPRESSED csv bytes, so the
 * digest identifies the logical table rather than this particular gzip encoding.
 *
 * `null` / `undefined` always render as an EMPTY field — never `0`, never "null".
 * With `atomic: true` (default) the gzip stream lands in a sibling temp file and is
 * renamed into place on close(), so the final path never holds a partial file.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';

/** Serialises a single CSV field. Nullish -> empty; quotes only when required. */
export function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (value instanceof Date) text = value.toISOString();
  else if (Array.isArray(value)) text = value.join('|');
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds the CSV body for one row without the trailing newline (exported for tests/tools). */
export function formatCsvRow(columns, row) {
  return columns.map((column) => escapeCsvField(row?.[column])).join(',');
}

/**
 * @param {object} options
 * @param {string} options.filePath final path of the .csv.gz file
 * @param {string[]} options.columns column order (deterministic, caller-supplied)
 * @param {boolean} [options.atomic=true] write to a sibling temp file, rename on close
 * @param {object} [options.gzipOptions]
 * @param {boolean} [options.header=true]
 */
export function createCsvGzWriter({ filePath, columns, atomic = true, gzipOptions = {}, header = true } = {}) {
  if (!filePath) throw new TypeError('createCsvGzWriter requires filePath');
  if (!Array.isArray(columns) || columns.length === 0) throw new TypeError('createCsvGzWriter requires a non-empty columns array');
  if (columns.some((column) => typeof column !== 'string' || column === '')) throw new TypeError('columns must be non-empty strings');

  const target = path.resolve(filePath);
  const temp = atomic
    ? path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`)
    : target;

  const gzipStream = zlib.createGzip({ level: 6, ...gzipOptions });
  const out = fs.createWriteStream(temp);
  const hash = crypto.createHash('sha256');
  let failure = null;
  const fail = (err) => { if (!failure) failure = err; };
  gzipStream.on('error', fail);
  out.on('error', fail);
  gzipStream.pipe(out);

  const headerLine = header ? `${columns.join(',')}\n` : '';
  let headerWritten = !header;
  let rows = 0;
  let uncompressedBytes = 0;
  let compressedBytes = 0;
  let closed = false;
  let summaryResult = null;

  gzipStream.on('data', (chunk) => { compressedBytes += chunk.length; });

  async function writeChunk(buffer) {
    hash.update(buffer);
    uncompressedBytes += buffer.length;
    if (!gzipStream.write(buffer)) await once(gzipStream, 'drain');
  }

  async function ensureHeader() {
    if (headerWritten) return;
    headerWritten = true;
    if (headerLine) await writeChunk(Buffer.from(headerLine, 'utf8'));
  }

  async function writeRow(row = {}) {
    if (closed) throw new Error('createCsvGzWriter: writeRow() called after close()');
    if (failure) throw failure;
    await ensureHeader();
    await writeChunk(Buffer.from(`${formatCsvRow(columns, row)}\n`, 'utf8'));
    if (failure) throw failure;
    rows += 1;
    return rows;
  }

  async function writeRows(iterable) {
    let count = 0;
    for await (const row of iterable) { await writeRow(row); count += 1; }
    return count;
  }

  /** sha256 (hex) of the uncompressed CSV bytes; available once close() has resolved. */
  function digest() {
    if (!summaryResult) throw new Error('createCsvGzWriter: digest() is only available after close()');
    return summaryResult.sha256;
  }

  /** Full close() result; available once close() has resolved. */
  function summary() {
    if (!summaryResult) throw new Error('createCsvGzWriter: summary() is only available after close()');
    return summaryResult;
  }

  async function close() {
    if (closed && summaryResult) return summaryResult;
    if (closed) throw failure || new Error('createCsvGzWriter: close() failed');
    closed = true;
    try {
      if (failure) throw failure;
      await ensureHeader();
      gzipStream.end();
      await finished(out);
      if (failure) throw failure;
      if (atomic) await fsp.rename(temp, target);
      summaryResult = {
        path: target,
        rows,
        uncompressedBytes,
        compressedBytes,
        sha256: hash.digest('hex'),
        atomic,
        measured: true,
      };
      return summaryResult;
    } catch (err) {
      gzipStream.destroy();
      out.destroy();
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw err;
    }
  }

  return {
    path: target,
    columns: [...columns],
    atomic,
    get rows() { return rows; },
    get uncompressedBytes() { return uncompressedBytes; },
    get compressedBytes() { return compressedBytes; },
    get closed() { return Boolean(summaryResult); },
    writeRow,
    writeRows,
    close,
    digest,
    summary,
  };
}

export default { createCsvGzWriter, escapeCsvField, formatCsvRow };
