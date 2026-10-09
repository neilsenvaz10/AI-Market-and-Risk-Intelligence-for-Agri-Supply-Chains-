/**
 * Freshness and provenance helpers shared by retrieval, prompts and tests.
 * No database access, so they can be imported anywhere.
 */

/** A price report older than this many days is not "current" and is described as old. */
export const STALE_AFTER_DAYS = 3;

/** Calendar day in India (the mandi reporting calendar) as YYYY-MM-DD. */
export function todayInIndia(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** Genuine = not sample data, not the MOCK provider, not flagged synthetic. */
export function isGenuine(row) {
  if (!row || row.is_sample_data) return false;
  if (/MOCK|FIXTURE|SYNTHETIC/i.test(String(row.source || ''))) return false;
  return !(Array.isArray(row.quality_flags) && row.quality_flags.includes('SYNTHETIC_SAMPLE'));
}

/** CEDA names some markets "Nashik APMC (Market 10121)"; the number means nothing to a farmer. */
export function displayMarketName(name) {
  return String(name ?? '').replace(/\s*\(\s*market\s*\d+\s*\)/gi, '').replace(/\s+/g, ' ').trim();
}
