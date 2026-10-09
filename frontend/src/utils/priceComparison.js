/**
 * Pure helpers for the Mandi Price Comparison card.
 *
 * Only reported modal prices are handled here. There is deliberately no transport cost, profit or
 * return calculation: those need the Phase 5 recommendation service, which does not exist yet.
 *
 * Observation labels (never "Live"; fetching from an API says nothing about how recent a price is):
 *   verified    genuine observation whose reporting date is at most FRESH_DAYS old
 *   historical  genuine observation reported more than FRESH_DAYS ago
 *   sample      synthetic / fixture / mock / benchmark data (never shown as a market price)
 */
export const CANONICAL_UNIT = 'INR/quintal';
/** A genuine price is "verified observation" for this many days after its reporting date. */
export const FRESH_DAYS = 3;
export const MAX_ROWS = 6;

const SAMPLE_SOURCE = /MOCK|FIXTURE|SAMPLE|SYNTHETIC|BENCHMARK|NATIONAL/i;
const DAY_MS = 86_400_000;

export function isSampleRow(row) {
  return row?.isSampleData === true
    || SAMPLE_SOURCE.test(String(row?.source?.code || ''))
    || SAMPLE_SOURCE.test(String(row?.source?.label || ''));
}

function dayNumber(isoDay) {
  if (typeof isoDay !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(isoDay)) return null;
  const t = Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

export function ageInDays(reportedDate, now = new Date()) {
  const reported = dayNumber(reportedDate);
  if (reported === null) return null;
  return Math.max(0, Math.floor(now.getTime() / DAY_MS) - reported);
}

/** A genuine row must carry every field the card displays; nothing is defaulted. */
export function isDisplayable(row) {
  return Boolean(row)
    && Number.isFinite(row.prices?.modal) && row.prices.modal > 0
    && row.prices.unit === CANONICAL_UNIT
    && dayNumber(row.reportedDate) !== null
    && Boolean(row.mandi?.name || row.mandi?.code)
    && Boolean(row.source?.label || row.source?.code)
    && row.qualityStatus !== 'REJECTED';
}

export function labelFor(row, now) {
  if (isSampleRow(row)) return 'sample';
  const age = ageInDays(row.reportedDate, now);
  return age !== null && age <= FRESH_DAYS ? 'verified' : 'historical';
}

const sameValue = (rows, pick) => new Set(rows.map(pick)).size === 1;

/**
 * @param {object[]} rows shaped price rows (marketApi.shapePriceRow)
 * @returns {{ status: 'ok'|'empty', entries: object[], comparable: boolean, topId: string|null, sampleOnly: boolean }}
 */
export function buildComparison(rows, now = new Date()) {
  const all = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const sampleCount = all.filter(isSampleRow).length;
  const genuine = all.filter((r) => !isSampleRow(r) && isDisplayable(r));
  if (genuine.length === 0) {
    return { status: 'empty', entries: [], comparable: false, topId: null, sampleOnly: sampleCount > 0 };
  }

  const comparable = genuine.length >= 2
    && sameValue(genuine, (r) => r.commodity?.code ?? r.commodity?.name)
    && sameValue(genuine, (r) => r.variety ?? '')
    && sameValue(genuine, (r) => r.grade ?? '')
    && sameValue(genuine, (r) => r.prices.unit)
    && sameValue(genuine, (r) => r.reportedDate.slice(0, 10));

  const key = (r) => String(r.id ?? `${r.mandi.code ?? r.mandi.name}|${r.variety ?? ''}|${r.grade ?? ''}`);
  const entries = [...genuine]
    .sort(comparable
      ? (a, b) => b.prices.modal - a.prices.modal
      // Not comparable: no price ordering, so nothing reads as a ranking (newest report first, then name).
      : (a, b) => b.reportedDate.localeCompare(a.reportedDate) || String(a.mandi.name).localeCompare(String(b.mandi.name)))
    .slice(0, MAX_ROWS)
    .map((r) => ({ key: key(r), row: r, label: labelFor(r, now) }));

  // Ties are not "the highest": only a strictly higher modal price earns the label.
  const topId = comparable && entries[0].row.prices.modal > entries[1].row.prices.modal ? entries[0].key : null;
  return { status: 'ok', entries, comparable, topId, sampleOnly: false };
}
