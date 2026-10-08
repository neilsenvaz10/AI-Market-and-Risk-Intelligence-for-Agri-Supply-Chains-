/**
 * Supported app languages. Codes match farmers.preferred_language in PostgreSQL.
 * `pill` labels match the existing Stitch header language switcher.
 */
export const LANGUAGES = [
  { code: 'en', pill: 'EN', label: 'English' },
  { code: 'hi', pill: 'हिं', label: 'हिन्दी (Hindi)' },
  { code: 'mr', pill: 'मराठी', label: 'मराठी (Marathi)' },
];

export const DEFAULT_LANGUAGE = 'en';

export const isSupportedLanguage = (code) => LANGUAGES.some((l) => l.code === code);

export const languageLabel = (code) => LANGUAGES.find((l) => l.code === code)?.label || code;
