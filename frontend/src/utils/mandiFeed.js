import { t } from '../i18n/strings';

/**
 * Display helpers for mandi price rows returned by /api/mandi/prices/*.
 * Reporting dates (price_date) are calendar days ("YYYY-MM-DD"); fetch times
 * (fetched_at) are instants. They are formatted differently so a reporting date
 * never shifts to the previous day in timezones behind UTC.
 */

const DATE_LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
const locale = (language) => DATE_LOCALES[language] || 'en-IN';

/** Formats a reporting day such as "2026-10-07" as "7 Oct 2026" (no timezone shift). */
export function formatReportDate(value, language, { year = true } = {}) {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale(language), {
    day: 'numeric', month: 'short', ...(year && { year: 'numeric' }), timeZone: 'UTC',
  });
}

/** Formats a fetch timestamp in the viewer's local time. */
export function formatFetchedAt(value, language) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale(language), { day: 'numeric', month: 'short' });
}

/** Source attribution: the label comes from the API's source registry. */
export function sourceLabel(row, language) {
  if (row.is_sample_data) return t(language, 'mandiFeed.sampleSource');
  return row.source_label || row.source;
}

/** True when the API could compare with an earlier report of the same source. */
export const hasTrend = (row) => ['up', 'down', 'stable'].includes(row.trend_direction) && row.trend_percent !== null;

export function formatTrend(row) {
  const value = Number(row.trend_percent);
  return `${value > 0 ? '+' : ''}${value}%`;
}
