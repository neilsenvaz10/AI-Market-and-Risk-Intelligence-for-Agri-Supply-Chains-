// Same month names the Copilot uses in its written and spoken answers, so a card and the
// sentence above it never disagree about a date.
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
  mr: ['जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून', 'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर'],
};

/** "2026-10-08" -> "8 October 2026" / "8 अक्टूबर 2026". A calendar day, so no time zone shift. */
export function formatReportDate(iso, language = 'en') {
  const match = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(iso ?? '');
  const month = (MONTHS[language] || MONTHS.en)[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : `${match[1]}-${match[2]}-${match[3]}`;
}

/** 1650 -> "1,650" (Indian digit grouping). */
export const formatRupees = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? '–'
  : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
