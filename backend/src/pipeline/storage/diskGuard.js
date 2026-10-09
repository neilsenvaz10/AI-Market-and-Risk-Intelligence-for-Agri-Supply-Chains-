/**
 * Cross-platform free-space safety for the Phase 5 mandi-data pipeline.
 *
 * Measurement uses `fs.statfs` (available on modern Node, no extra dependency). On
 * Windows a PowerShell fallback exists only for runtimes where `statfs` is missing or
 * fails; if the volume still cannot be measured the guard FAILS CLOSED by throwing,
 * because "unknown free space" must never be treated as "enough free space".
 *
 * HARD FLOOR: the pipeline always stops with at least HARD_FLOOR_GB (10 GB) free.
 * A caller-supplied `minFreeGb` may raise that floor but can never lower it.
 *
 * Every return value carries a `measured` flag: `true` when the numbers came from the
 * filesystem, `false` when they came from `estimateRunBytes`' arithmetic.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const GB = 1024 ** 3;

/** The pipeline must never intentionally run the data drive below this. Not configurable. */
export const HARD_FLOOR_GB = 10;

const execFileAsync = promisify(execFile);

/** Typed failure: low disk, or a volume whose free space could not be determined. */
export class InsufficientDiskSpaceError extends Error {
  constructor(message, { code = 'INSUFFICIENT_DISK_SPACE', path: target = null, freeBytes = null, requiredBytes = null, method = null } = {}) {
    super(message);
    this.name = 'InsufficientDiskSpaceError';
    this.code = code;
    this.path = target;
    this.freeBytes = freeBytes;
    this.requiredBytes = requiredBytes;
    this.method = method;
  }
}

/**
 * Applies the hard floor. `minFreeGb` can only ever raise the 10 GB minimum.
 * @param {number|string} [requestedGb]
 * @returns {number} effective minimum free space in GB, never below 10
 */
export function resolveMinFreeGb(requestedGb = HARD_FLOOR_GB) {
  const requested = Number(requestedGb);
  const safe = Number.isFinite(requested) ? requested : HARD_FLOOR_GB;
  return Math.max(safe, HARD_FLOOR_GB);
}

/** Walks up to the nearest existing ancestor so a not-yet-created data dir can be probed. */
function nearestExisting(target) {
  let probe = path.resolve(target);
  for (;;) {
    if (fs.existsSync(probe)) return probe;
    const parent = path.dirname(probe);
    if (parent === probe) return probe;
    probe = parent;
  }
}

/** Last-resort Windows measurement; only reached when `fs.statfs` is unusable. */
async function powershellFreeBytes(probe) {
  const root = path.parse(path.resolve(probe)).root.replace(/[\\/]+$/, '');
  if (!root) throw new Error(`cannot derive a volume root from ${probe}`);
  const script = `$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${root}'" | Select-Object -First 1; if ($d) { $d.FreeSpace; $d.Size }`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 15000,
  });
  const [free, total] = String(stdout).trim().split(/\s+/).map(Number);
  if (!Number.isFinite(free)) throw new Error(`PowerShell returned no free-space value for ${root}`);
  return { freeBytes: free, totalBytes: Number.isFinite(total) ? total : null, method: 'powershell' };
}

function normalizeStatfs(stats) {
  if (stats && stats.freeBytes !== undefined && stats.freeBytes !== null) {
    return { freeBytes: Number(stats.freeBytes), totalBytes: stats.totalBytes === undefined ? null : Number(stats.totalBytes), method: 'statfs' };
  }
  return {
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
    totalBytes: stats.blocks === undefined ? null : Number(stats.blocks) * Number(stats.bsize),
    method: 'statfs',
  };
}

async function resolveFreeBytes(probe, { statfsImpl, freeBytesImpl } = {}) {
  if (typeof freeBytesImpl === 'function') {
    const value = await freeBytesImpl(probe);
    const freeBytes = typeof value === 'number' ? value : Number(value?.freeBytes);
    if (!Number.isFinite(freeBytes)) throw new TypeError('freeBytesImpl must return a number or { freeBytes }');
    return { freeBytes, totalBytes: typeof value === 'object' ? (value?.totalBytes ?? null) : null, method: 'injected' };
  }
  const impl = statfsImpl || fsp.statfs;
  try {
    return normalizeStatfs(await impl(probe));
  } catch (err) {
    if (process.platform === 'win32') {
      try {
        return await powershellFreeBytes(probe);
      } catch (fallbackError) {
        throw new InsufficientDiskSpaceError(
          `Cannot determine free space for ${probe}: statfs failed (${err.message}); PowerShell fallback failed (${fallbackError.message})`,
          { code: 'DISK_SPACE_UNKNOWN', path: probe, method: 'none' }
        );
      }
    }
    throw new InsufficientDiskSpaceError(`Cannot determine free space for ${probe}: ${err.message}`, {
      code: 'DISK_SPACE_UNKNOWN',
      path: probe,
      method: 'statfs',
    });
  }
}

/**
 * Measured free space on the volume holding `target` (nearest existing ancestor).
 * `statfsImpl` / `freeBytesImpl` are injectable so tests never touch a real volume.
 * @returns {Promise<{path: string, requestedPath: string, freeBytes: number, totalBytes: number|null, method: string, measured: true, at: string}>}
 */
export async function availableBytes(target, options = {}) {
  if (!target) throw new TypeError('availableBytes(target) requires a path');
  const probe = nearestExisting(target);
  const { freeBytes, totalBytes, method } = await resolveFreeBytes(probe, options);
  return {
    path: probe,
    requestedPath: path.resolve(target),
    freeBytes,
    totalBytes,
    method,
    measured: true,
    at: new Date().toISOString(),
  };
}

/**
 * Throws InsufficientDiskSpaceError when the volume has less than the effective
 * (floor-enforced) minimum free; otherwise resolves with the measured values.
 * @param {string} target
 * @param {number} [minFreeGb] requested minimum; the 10 GB floor always applies
 */
export async function assertMinimumFree(target, minFreeGb = HARD_FLOOR_GB, options = {}) {
  const effectiveMinFreeGb = resolveMinFreeGb(minFreeGb);
  const minFreeBytes = Math.ceil(effectiveMinFreeGb * GB);
  const info = await availableBytes(target, options);
  if (info.freeBytes < minFreeBytes) {
    throw new InsufficientDiskSpaceError(
      `Refusing to write to ${target}: ${(info.freeBytes / GB).toFixed(2)} GB free is below the ${effectiveMinFreeGb} GB minimum ` +
        `(hard floor ${HARD_FLOOR_GB} GB)`,
      {
        code: 'INSUFFICIENT_DISK_SPACE',
        path: info.path,
        freeBytes: info.freeBytes,
        requiredBytes: minFreeBytes,
        method: info.method,
      }
    );
  }
  return {
    ...info,
    requestedMinFreeGb: Number(minFreeGb),
    effectiveMinFreeGb,
    floorGb: HARD_FLOOR_GB,
    minFreeBytes,
    ok: true,
  };
}

/**
 * Arithmetic size estimate for a planned run. Always `measured: false` — it is a guess,
 * never a filesystem reading.
 * @param {{perRecordBytes: number, records: number, overheadBytes?: number, compressionRatio?: number}} input
 */
export function estimateRunBytes({ perRecordBytes, records, overheadBytes = 0, compressionRatio = 1 } = {}) {
  const perRecord = Number(perRecordBytes);
  const count = Number(records);
  const overhead = Number(overheadBytes);
  const ratio = Number(compressionRatio);
  if (!Number.isFinite(perRecord) || perRecord < 0) throw new TypeError('perRecordBytes must be a non-negative number');
  if (!Number.isFinite(count) || count < 0) throw new TypeError('records must be a non-negative number');
  if (!Number.isFinite(overhead) || overhead < 0) throw new TypeError('overheadBytes must be a non-negative number');
  if (!Number.isFinite(ratio) || ratio <= 0) throw new TypeError('compressionRatio must be a positive number');
  const payloadBytes = perRecord * count;
  const estimatedBytes = Math.ceil(payloadBytes * ratio + overhead);
  return {
    perRecordBytes: perRecord,
    records: count,
    overheadBytes: overhead,
    compressionRatio: ratio,
    payloadBytes,
    estimatedBytes,
    measured: false,
    basis: 'estimate',
  };
}

export default { availableBytes, assertMinimumFree, estimateRunBytes, resolveMinFreeGb, GB, HARD_FLOOR_GB, InsufficientDiskSpaceError };
