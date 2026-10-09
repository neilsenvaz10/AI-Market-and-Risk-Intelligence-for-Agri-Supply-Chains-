/**
 * Storage-efficiency toolkit for the Phase 5 mandi-data pipeline.
 * Barrel module: import from here or from the individual files.
 */
export {
  GB, HARD_FLOOR_GB, InsufficientDiskSpaceError,
  availableBytes, assertMinimumFree, estimateRunBytes, resolveMinFreeGb,
} from './diskGuard.js';
export { writeFileAtomic, writeJsonAtomic, appendJsonlLine } from './atomicWrite.js';
export { createCsvGzWriter, escapeCsvField, formatCsvRow } from './csvGzWriter.js';
export {
  parseDate, formatDate, daysInMonth, monthBounds, partitionSegment, partitionPath, monthsBetween, totalDays,
} from './partition.js';
export {
  MANIFEST_VERSION, ManifestError, createManifest, loadManifest, saveManifest,
  markWindowComplete, markWindowFailed, isWindowComplete, pendingWindows, windowKey, windowStatus, verifyWindowFile,
} from './manifest.js';
export {
  DEFAULT_BUDGET_GB, BUDGET_REASONS, BudgetExceededError, createBudget, measureDirectory,
} from './budget.js';
