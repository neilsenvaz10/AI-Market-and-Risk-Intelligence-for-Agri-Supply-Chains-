/**
 * Working-data budget accounting.
 *
 * The pipeline may not grow `backend/data/` past a configurable budget (default
 * 10 GB) and may not fill the drive below the diskGuard floor (10 GB, not
 * configurable downwards). Usage is MEASURED by walking the directory tree — never
 * inferred from a counter — and every value is labelled `measured: true`.
 *
 * Both the filesystem reader and the free-space reader are injectable so tests use a
 * temp tree and a fake volume.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { GB, HARD_FLOOR_GB, InsufficientDiskSpaceError, availableBytes, resolveMinFreeGb } from './diskGuard.js';

export const DEFAULT_BUDGET_GB = 10;

export const BUDGET_REASONS = {
  OK: 'OK',
  WORKING_BUDGET_EXCEEDED: 'WORKING_BUDGET_EXCEEDED',
  BELOW_DISK_FLOOR: 'BELOW_DISK_FLOOR',
  WOULD_BREACH_DISK_FLOOR: 'WOULD_BREACH_DISK_FLOOR',
};

export class BudgetExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BudgetExceededError';
    this.code = 'WORKING_BUDGET_EXCEEDED';
    this.details = details;
  }
}

/**
 * Recursively measures a directory tree.
 * @returns {Promise<{path: string, exists: boolean, bytes: number, files: number, directories: number,
 *   byDataset: Record<string, {bytes: number, files: number}>, measured: true, at: string}>}
 * `byDataset` keys are the first path segment under `dir` (`(root)` for loose files).
 * Symbolic links are never followed, so the walk cannot loop.
 */
export async function measureDirectory(dir, { fsImpl = fsp } = {}) {
  if (!dir) throw new TypeError('measureDirectory(dir) requires a path');
  const root = path.resolve(dir);
  const result = {
    path: root,
    exists: false,
    bytes: 0,
    files: 0,
    directories: 0,
    byDataset: {},
    measured: true,
    at: new Date().toISOString(),
  };

  let rootStat;
  try {
    rootStat = await fsImpl.stat(root);
  } catch (err) {
    if (err.code === 'ENOENT') return result;
    throw err;
  }
  result.exists = true;
  if (!rootStat.isDirectory()) {
    result.bytes = rootStat.size;
    result.files = 1;
    result.byDataset['(root)'] = { bytes: rootStat.size, files: 1 };
    return result;
  }

  const stack = [{ dir: root, dataset: '(root)' }];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsImpl.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current.dir, entry.name);
      const isRootChild = current.dir === root;
      if (entry.isDirectory()) {
        result.directories += 1;
        stack.push({ dir: full, dataset: isRootChild ? entry.name : current.dataset });
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try {
        stat = await fsImpl.stat(full);
      } catch {
        continue;
      }
      const dataset = isRootChild ? '(root)' : current.dataset;
      result.files += 1;
      result.bytes += stat.size;
      const bucket = (result.byDataset[dataset] ??= { bytes: 0, files: 0 });
      bucket.bytes += stat.size;
      bucket.files += 1;
    }
  }
  return result;
}

/**
 * @param {object} options
 * @param {string} options.dir data directory to account for
 * @param {number} [options.budgetGb=10]
 * @param {number} [options.minFreeGb] disk floor request; the 10 GB hard floor always applies
 * @param {Function} [options.statfsImpl] injectable free-space reader
 * @param {Function} [options.freeBytesImpl] injectable free-space reader returning a number
 * @param {object} [options.fsImpl]
 */
export function createBudget({ dir, budgetGb = DEFAULT_BUDGET_GB, minFreeGb = HARD_FLOOR_GB, statfsImpl, freeBytesImpl, fsImpl = fsp } = {}) {
  if (!dir) throw new TypeError('createBudget requires dir');
  const requestedBudgetGb = Number(budgetGb);
  if (!Number.isFinite(requestedBudgetGb) || requestedBudgetGb < 0) throw new TypeError('budgetGb must be a non-negative number');

  const root = path.resolve(dir);
  const budgetBytes = Math.round(requestedBudgetGb * GB);
  const floorGb = resolveMinFreeGb(minFreeGb);
  const floorBytes = Math.ceil(floorGb * GB);

  const usage = () => measureDirectory(root, { fsImpl });
  const free = () => availableBytes(root, { statfsImpl, freeBytesImpl });

  /** Measured usage + free space + remaining budget. */
  async function report() {
    const [measured, freeSpace] = await Promise.all([usage(), free()]);
    const remainingBytes = Math.max(0, budgetBytes - measured.bytes);
    const datasets = Object.entries(measured.byDataset)
      .map(([dataset, value]) => ({
        dataset,
        bytes: value.bytes,
        files: value.files,
        measured: true,
        shareOfBudget: budgetBytes > 0 ? value.bytes / budgetBytes : null,
      }))
      .sort((a, b) => b.bytes - a.bytes || a.dataset.localeCompare(b.dataset));
    return {
      dir: root,
      measuredAt: new Date().toISOString(),
      measured: true,
      budget: { gb: requestedBudgetGb, bytes: budgetBytes, source: 'config' },
      floor: { gb: floorGb, bytes: floorBytes, hardFloorGb: HARD_FLOOR_GB, source: 'hard-floor' },
      usage: measured,
      free: freeSpace,
      freeGb: freeSpace.freeBytes / GB,
      usedGb: measured.bytes / GB,
      remainingBytes,
      remainingGb: remainingBytes / GB,
      floorSatisfied: freeSpace.freeBytes >= floorBytes,
      budgetSatisfied: measured.bytes <= budgetBytes,
      datasets,
    };
  }

  /** Full decision record: why a write of `bytes` is or is not allowed. */
  async function explainWrite(bytes = 0) {
    const requestedBytes = Number(bytes);
    if (!Number.isFinite(requestedBytes) || requestedBytes < 0) throw new TypeError('bytes must be a non-negative number');
    const [measured, freeSpace] = await Promise.all([usage(), free()]);
    const remainingBytes = Math.max(0, budgetBytes - measured.bytes);

    let reason = BUDGET_REASONS.OK;
    if (measured.bytes + requestedBytes > budgetBytes) reason = BUDGET_REASONS.WORKING_BUDGET_EXCEEDED;
    else if (freeSpace.freeBytes < floorBytes) reason = BUDGET_REASONS.BELOW_DISK_FLOOR;
    else if (freeSpace.freeBytes - requestedBytes < floorBytes) reason = BUDGET_REASONS.WOULD_BREACH_DISK_FLOOR;

    return {
      allowed: reason === BUDGET_REASONS.OK,
      reason,
      requestedBytes,
      usedBytes: measured.bytes,
      remainingBytes,
      budgetGb: requestedBudgetGb,
      budgetBytes,
      freeBytes: freeSpace.freeBytes,
      floorGb,
      floorBytes,
      measured: true,
      at: new Date().toISOString(),
    };
  }

  /** Predicate form: true only when both the budget and the disk floor allow the write. */
  async function canWrite(bytes = 0) {
    return (await explainWrite(bytes)).allowed;
  }

  /** Throws BudgetExceededError / InsufficientDiskSpaceError instead of returning false. */
  async function assertCanWrite(bytes = 0) {
    const decision = await explainWrite(bytes);
    if (decision.allowed) return decision;
    if (decision.reason === BUDGET_REASONS.WORKING_BUDGET_EXCEEDED) {
      throw new BudgetExceededError(
        `Refusing to write ${bytes} bytes: working-data budget of ${requestedBudgetGb} GB would be exceeded ` +
          `(${decision.usedBytes} used + ${decision.requestedBytes} requested > ${budgetBytes})`,
        decision
      );
    }
    throw new InsufficientDiskSpaceError(
      `Refusing to write ${bytes} bytes: ${decision.reason} (${(decision.freeBytes / GB).toFixed(2)} GB free, floor ${floorGb} GB)`,
      {
        code: decision.reason,
        path: root,
        freeBytes: decision.freeBytes,
        requiredBytes: floorBytes,
        method: 'budget',
      }
    );
  }

  return {
    dir: root,
    budgetGb: requestedBudgetGb,
    budgetBytes,
    floorGb,
    floorBytes,
    usage,
    free,
    report,
    explainWrite,
    canWrite,
    assertCanWrite,
  };
}

export default { createBudget, measureDirectory, BudgetExceededError, BUDGET_REASONS, DEFAULT_BUDGET_GB };
