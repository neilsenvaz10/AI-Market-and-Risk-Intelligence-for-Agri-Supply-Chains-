/**
 * Prepares text for Sarvam text-to-speech.
 *
 * Measured against the live API (speech -> speech-to-text round trip): raw symbols are read
 * badly. "₹1,400/quintal" was spoken "one thousand four hundred rupees BY quintal", a range
 * "₹1,000 - ₹1,600" lost its "to", and "+3.5%" became "plus three point five per cent" only
 * after a detour. Written-out text ("1400 rupees per quintal", "1000 to 1600 rupees",
 * "8 October 2026") is spoken correctly in English, Hindi and Marathi, so the text is
 * rewritten before it is sent.
 */
import { formatDate } from './copilot/deterministicAnswers.js';

export const MAX_SPOKEN_CHARS = 1000;

const WORDS = {
  en: { rupees: 'rupees', perQuintal: 'per quintal', to: 'to', percent: 'percent', plus: 'plus', minus: 'minus' },
  hi: { rupees: 'रुपये', perQuintal: 'प्रति क्विंटल', to: 'से', percent: 'प्रतिशत', plus: 'प्लस', minus: 'माइनस' },
  mr: { rupees: 'रुपये', perQuintal: 'प्रति क्विंटल', to: 'ते', percent: 'टक्के', plus: 'प्लस', minus: 'वजा' },
};

const AMOUNT = '(\\d+(?:,\\d+)*(?:\\.\\d+)?)';
const CURRENCY = '(?:₹|Rs\\.?|INR)';

const plainNumber = (text) => text.replace(/,/g, '');

/** @param {string} text @param {'en'|'hi'|'mr'} language */
export function prepareSpeechText(text, language = 'en') {
  const w = WORDS[language] || WORDS.en;
  let out = String(text ?? '');

  // Markup and symbols that should never be read out.
  out = out
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[*_`#>•]+/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ');

  // ISO dates -> "8 October 2026" in the farmer's language.
  out = out.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => formatDate(iso, language));

  // Price ranges: "₹1,000 - ₹1,600" -> "1000 to 1600 rupees".
  out = out.replace(new RegExp(`${CURRENCY}\\s?${AMOUNT}\\s*(?:-|–|—|to)\\s*${CURRENCY}?\\s?${AMOUNT}`, 'gi'),
    (_, a, b) => `${plainNumber(a)} ${w.to} ${plainNumber(b)} ${w.rupees}`);
  // Single amounts: "₹1,400" -> "1400 rupees".
  out = out.replace(new RegExp(`${CURRENCY}\\s?${AMOUNT}`, 'gi'), (_, a) => `${plainNumber(a)} ${w.rupees}`);

  // Units: "/quintal", "/क्विंटल", "per quintal" all read as "per quintal".
  out = out
    .replace(/\s*\/\s*(?:quintal|qtl|क्विंटल)(?![\p{L}\p{M}])/giu, ` ${w.perQuintal}`)
    .replace(/\bINR\s*per\s*quintal\b/gi, `${w.rupees} ${w.perQuintal}`);
  if (language === 'en') out = out.replace(/\bper\s+quintal\b/gi, w.perQuintal);

  // Signed numbers and percentages: "+3.5%" -> "plus 3.5 percent".
  out = out
    .replace(/(^|[\s(])\+\s?(?=\d)/g, `$1${w.plus} `)
    .replace(/(^|[\s(])[-−]\s?(?=\d)/g, `$1${w.minus} `)
    .replace(/(\d)\s?%/g, `$1 ${w.percent}`);

  // Thousands separators in any remaining number: "1,00,000" -> "100000".
  out = out.replace(/\d[\d,]*\d/g, (n) => (/^\d{1,3}(?:,\d{2})*,\d{3}$/.test(n) ? n.replace(/,/g, '') : n));

  out = out.replace(/\s+/g, ' ').replace(/\s+([,.;:!?।])/g, '$1').trim();
  return out.length > MAX_SPOKEN_CHARS ? `${out.slice(0, MAX_SPOKEN_CHARS - 1).replace(/\s+\S*$/, '')}…` : out;
}
