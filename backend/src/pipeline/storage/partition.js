/**
 * Year/month partitioning of historical mandi data.
 *
 * All dates are handled as UTC calendar days ('YYYY-MM-DD'), so a partition never
 * depends on the machine's timezone or on daylight-saving transitions. Paths are
 * `<baseDir>/<source>/<dataset>/<year>/<month>.<ext>`, which keeps monthly files small
 * enough to rewrite atomically and to re-import window by window.
 */
import path from 'node:path';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value) => String(value).padStart(2, '0');

/** Parses a Date | 'YYYY-MM-DD' | ISO string | epoch ms into a UTC midnight Date. */
export function parseDate(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new TypeError('Invalid Date');
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError(`Invalid timestamp: ${input}`);
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid timestamp: ${input}`);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  if (typeof input === 'string') {
    const match = input.trim().match(DATE_ONLY);
    if (match) {
      const [, y, m, d] = match.map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
        throw new RangeError(`Not a real calendar date: ${input}`);
      }
      return date;
    }
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) throw new TypeError(`Unparseable date: ${input}`);
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }
  throw new TypeError(`Unparseable date: ${String(input)}`);
}

/** Formats a Date (or date-like) as 'YYYY-MM-DD' in UTC. */
export function formatDate(input) {
  const date = input instanceof Date ? input : parseDate(input);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Days in a month; leap years come from the Date object, not a table. */
export function daysInMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new RangeError(`Invalid year/month: ${year}/${month}`);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** First and last day of the month containing `date`. */
export function monthBounds(date) {
  const parsed = parseDate(date);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  return {
    year: String(year).padStart(4, '0'),
    month: pad2(month),
    from: `${String(year).padStart(4, '0')}-${pad2(month)}-01`,
    to: `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  };
}

/** `partitionSegment(date)` -> `{ year: '2021', month: '10' }` (both zero-padded strings). */
export function partitionSegment(date) {
  const bounds = monthBounds(date);
  return { year: bounds.year, month: bounds.month };
}

/**
 * `<baseDir>/<source>/<dataset>/<year>/<month>.<ext>`.
 * `source` is optional; `extension` may be given with or without a leading dot.
 */
export function partitionPath({ baseDir, dataset, source = null, date, extension = 'csv.gz' } = {}) {
  if (!baseDir) throw new TypeError('partitionPath requires baseDir');
  if (!dataset) throw new TypeError('partitionPath requires dataset');
  if (date === undefined || date === null) throw new TypeError('partitionPath requires date');
  const { year, month } = partitionSegment(date);
  const ext = String(extension).replace(/^\.+/, '');
  if (!ext) throw new TypeError('partitionPath requires a non-empty extension');
  const parts = [baseDir];
  if (source) parts.push(String(source));
  parts.push(String(dataset), year, `${month}.${ext}`);
  return path.join(...parts);
}

/**
 * Inclusive ordered month segments covering `startDate`..`endDate`, each with the
 * intersected `from`/`to` day so windowed processing resumes exactly where it stopped.
 * Handles a single-day range, Dec->Jan rollover, leap Februaries and multi-year spans.
 *
 * @returns {Array<{year: string, month: string, from: string, to: string}>}
 */
export function monthsBetween(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start.getTime() > end.getTime()) throw new RangeError(`startDate ${formatDate(start)} is after endDate ${formatDate(end)}`);

  const segments = [];
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const bounds = monthBounds(new Date(Date.UTC(year, month - 1, 1)));
    const fromDate = parseDate(bounds.from);
    const toDate = parseDate(bounds.to);
    const segmentFrom = fromDate.getTime() < start.getTime() ? start : fromDate;
    const segmentTo = toDate.getTime() > end.getTime() ? end : toDate;
    segments.push({ year: bounds.year, month: bounds.month, from: formatDate(segmentFrom), to: formatDate(segmentTo) });
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return segments;
}

/** Total number of days covered by a segment list (handy for progress reporting). */
export function totalDays(segments = []) {
  return segments.reduce((sum, segment) => {
    const from = parseDate(segment.from).getTime();
    const to = parseDate(segment.to).getTime();
    return sum + Math.round((to - from) / 86400000) + 1;
  }, 0);
}

export default { parseDate, formatDate, daysInMonth, monthBounds, partitionSegment, partitionPath, monthsBetween, totalDays };
