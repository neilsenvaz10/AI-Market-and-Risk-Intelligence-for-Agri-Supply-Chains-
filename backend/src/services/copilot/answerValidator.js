/**
 * Numeric-fidelity check for model answers.
 *
 * The language model may phrase things freely, but every market number it states (a price, a
 * range, a percentage, a quantity, a year) must come from the data we retrieved or from the
 * farmer's own words. An answer that states a number found in neither is rejected: the
 * orchestrator asks the model once more and, if it still invents numbers, falls back to the
 * deterministic answer built straight from the data.
 *
 * Small numbers (up to SMALL_NUMBER_LIMIT) are always allowed because they are day-of-month
 * values, horizons and counts ("3 days", "2 markets") rather than prices.
 */

export const SMALL_NUMBER_LIMIT = 31;
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** "१४००" -> "1400", "1,400" -> "1400". */
export function normalizeDigits(text) {
  return String(text ?? '')
    .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
    .replace(/(\d),(?=\d{2,3}(?!\d))/g, '$1');
}

/** All numbers written in a piece of text (decimal numbers kept whole). */
export function extractNumbers(text) {
  return [...normalizeDigits(text).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter(Number.isFinite);
}

/** Every number present anywhere in the retrieved payload (values, numeric strings, date parts). */
export function collectAllowedNumbers(payload, extraTexts = []) {
  const allowed = new Set();
  const visit = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        allowed.add(value);
        allowed.add(Math.round(value));
        allowed.add(Math.abs(value));
      }
    } else if (typeof value === 'string') {
      extractNumbers(value).forEach((n) => allowed.add(n));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(payload);
  extraTexts.forEach((text) => extractNumbers(text).forEach((n) => allowed.add(n)));
  return allowed;
}

const matchesAllowed = (n, allowed) => {
  if (n <= SMALL_NUMBER_LIMIT) return true;
  const tolerance = Math.max(1, n * 0.005); // "about 1650" for 1649.5 is rounding, not invention
  for (const a of allowed) {
    if (Math.abs(a - n) <= tolerance) return true;
  }
  return false;
};

/**
 * @returns {{ valid: boolean, offending: number[] }}
 */
export function validateGroundedAnswer(answer, payload, { extraTexts = [] } = {}) {
  const allowed = collectAllowedNumbers(payload, extraTexts);
  const offending = [...new Set(extractNumbers(answer).filter((n) => !matchesAllowed(n, allowed)))];
  return { valid: offending.length === 0, offending };
}
