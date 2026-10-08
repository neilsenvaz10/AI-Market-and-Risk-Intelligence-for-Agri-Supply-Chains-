import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { once } from 'node:events';

/**
 * Storage helpers for historical exports: disk-space guard, download budget,
 * streaming gzip CSV writer/reader and an atomically written checkpoint manifest.
 */

export class DiskGuardError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const GB = 1024 ** 3;

/** Free bytes on the volume holding `dir` (nearest existing ancestor). */
export async function freeBytes(dir) {
  let probe = path.resolve(dir);
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const stats = await fsp.statfs(probe);
  return Number(stats.bavail) * Number(stats.bsize);
}

/**
 * Tracks bytes written by a job and checks free disk space.
 * `statfsImpl` is injectable so tests can simulate a nearly full disk.
 */
export function createDiskGuard({ dir, minFreeGb, budgetMb, freeBytesImpl = freeBytes }) {
  let written = 0;
  const budgetBytes = budgetMb * 1024 * 1024;
  return {
    get bytesWritten() {
      return written;
    },
    async assertSpace(stage) {
      const free = await freeBytesImpl(dir);
      if (free < minFreeGb * GB) {
        throw new DiskGuardError(
          `Stopped (${stage}): ${(free / GB).toFixed(1)} GB free is below the ${minFreeGb} GB minimum`, 'LOW_DISK_SPACE');
      }
      return free;
    },
    addBytes(bytes) {
      written += bytes;
      if (written > budgetBytes) {
        throw new DiskGuardError(`Stopped: download budget of ${budgetMb} MB exceeded`, 'DOWNLOAD_BUDGET_EXCEEDED');
      }
    },
  };
}

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('|') : value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Streams rows into <file>.partial through gzip, then renames it into place, so a
 * crash never leaves a truncated file under the final name.
 * Returns { rows, bytes, sha256 }.
 */
export async function writeCsvGz(filePath, columns, rows, { guard, checkEvery = 5000 } = {}) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const partial = `${filePath}.partial`;
  const gzip = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(partial);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  gzip.on('data', (chunk) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  gzip.pipe(out);
  const write = async (line) => {
    if (!gzip.write(line)) await once(gzip, 'drain');
  };
  try {
    await write(`${columns.join(',')}\n`);
    let count = 0;
    for (const row of rows) {
      await write(`${columns.map((c) => csvCell(row[c])).join(',')}\n`);
      count += 1;
      if (guard && count % checkEvery === 0) await guard.assertSpace('during write');
    }
    gzip.end();
    await once(out, 'finish');
    guard?.addBytes(bytes);
    await fsp.rename(partial, filePath);
    return { rows: count, bytes, sha256: hash.digest('hex') };
  } catch (err) {
    gzip.destroy();
    out.destroy();
    await fsp.rm(partial, { force: true });
    throw err;
  }
}

/** Parses one CSV line written by writeCsvGz (RFC 4180 quoting). */
export function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

/** Async iterator over rows (objects keyed by header) of a gzip CSV file. */
export async function* readCsvGz(filePath) {
  const lines = readline.createInterface({ input: fs.createReadStream(filePath).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (!header) { header = cells; continue; }
    yield Object.fromEntries(header.map((name, i) => [name, cells[i] === '' ? null : cells[i]]));
  }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

/** Checkpoint manifest, written atomically (temp file + rename) after every task. */
export class Manifest {
  constructor(filePath, data) {
    this.filePath = filePath;
    this.data = data;
  }

  static async load(filePath, defaults) {
    try {
      return new Manifest(filePath, JSON.parse(await fsp.readFile(filePath, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return new Manifest(filePath, { version: 1, createdAt: new Date().toISOString(), tasks: {}, ...defaults });
    }
  }

  task(id) {
    return this.data.tasks[id] || null;
  }

  async update(id, patch) {
    this.data.tasks[id] = { ...this.data.tasks[id], ...patch, updatedAt: new Date().toISOString() };
    await this.save();
  }

  async save() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    this.data.updatedAt = new Date().toISOString();
    const tmp = `${this.filePath}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    await fsp.rename(tmp, this.filePath);
  }
}
