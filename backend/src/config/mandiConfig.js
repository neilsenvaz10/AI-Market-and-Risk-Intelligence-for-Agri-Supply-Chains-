/**
 * Mandi pipeline configuration parsing.
 *
 * Everything here defaults to the SAFE state: no provider, scheduler off,
 * sample (MOCK) data never written unless explicitly allowed outside production.
 * Parsing is strict so a typo can never turn into a rapid or unintended job.
 */

export const MIN_SYNC_INTERVAL_MINUTES = 15;
export const MAX_SYNC_INTERVAL_MINUTES = 7 * 24 * 60; // setInterval supports up to ~24.8 days

// Providers that write genuine source data, plus MOCK for isolated tests only.
export const GENUINE_PROVIDERS = ['DATA_GOV_IN', 'CEDA'];
export const SAMPLE_PROVIDERS = ['MOCK'];

// Older .env files used AGMARKNET for the data.gov.in adapter; the data never came
// from agmarknet.gov.in directly, so the name is mapped to its real source.
const PROVIDER_ALIASES = { AGMARKNET: 'DATA_GOV_IN' };

// Template placeholders copied from .env.example ("your_..._here") count as "not configured".
function secretOrEmpty(raw) {
  const value = String(raw ?? '').trim();
  return /^your[_-]/i.test(value) ? '' : value;
}

function parseStrictInt(raw, { min, max, fallback }) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: fallback, error: null };
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return { value: fallback, error: `invalid value "${text}"` };
  const value = Number(text);
  if (value < min || value > max) return { value: fallback, error: `${value} is outside ${min}..${max}` };
  return { value, error: null };
}

/**
 * MANDI_SYNC_INTERVAL_MINUTES:
 *   unset / 0      -> disabled
 *   non-numeric    -> disabled (reported), never parsed leniently ("5abc" is NOT 5)
 *   1..14          -> disabled (below the minimum safe interval)
 *   15..10080      -> enabled
 */
export function parseSyncInterval(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { enabled: false, minutes: 0, reason: 'MANDI_SYNC_INTERVAL_MINUTES is not set' };
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    return { enabled: false, minutes: 0, reason: `MANDI_SYNC_INTERVAL_MINUTES="${text}" is not a whole number`, invalid: true };
  }
  const minutes = Number(text);
  if (minutes === 0) return { enabled: false, minutes: 0, reason: 'MANDI_SYNC_INTERVAL_MINUTES=0' };
  if (minutes < MIN_SYNC_INTERVAL_MINUTES || minutes > MAX_SYNC_INTERVAL_MINUTES) {
    return {
      enabled: false,
      minutes: 0,
      reason: `MANDI_SYNC_INTERVAL_MINUTES=${minutes} is outside ${MIN_SYNC_INTERVAL_MINUTES}..${MAX_SYNC_INTERVAL_MINUTES}`,
      invalid: true,
    };
  }
  return { enabled: true, minutes, reason: null };
}

/** MANDI_DATA_PROVIDER: '' / NONE -> no provider. Unknown names are rejected, never defaulted. */
export function parseProvider(raw) {
  const text = String(raw ?? '').trim().toUpperCase();
  if (text === '' || text === 'NONE') return { provider: null, warning: null };
  const provider = PROVIDER_ALIASES[text] || text;
  if (![...GENUINE_PROVIDERS, ...SAMPLE_PROVIDERS].includes(provider)) {
    return { provider: null, warning: `MANDI_DATA_PROVIDER="${raw}" is not supported; no provider configured` };
  }
  const warning = PROVIDER_ALIASES[text]
    ? `MANDI_DATA_PROVIDER=${text} is deprecated: that adapter reads data.gov.in, use DATA_GOV_IN`
    : null;
  return { provider, warning };
}

export function parseMandiConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const { provider, warning: providerWarning } = parseProvider(env.MANDI_DATA_PROVIDER);
  const lookback = parseStrictInt(env.MANDI_SYNC_LOOKBACK_DAYS, { min: 1, max: 30, fallback: 3 });
  const timeout = parseStrictInt(env.MANDI_HTTP_TIMEOUT_MS, { min: 1000, max: 120000, fallback: 20000 });
  const retries = parseStrictInt(env.MANDI_HTTP_RETRIES, { min: 0, max: 6, fallback: 3 });
  const requestInterval = parseStrictInt(env.MANDI_REQUEST_INTERVAL_MS, { min: 0, max: 60000, fallback: 1000 });
  const jobTimeout = parseStrictInt(env.MANDI_SYNC_JOB_TIMEOUT_MINUTES, { min: 1, max: 240, fallback: 30 });
  const minFreeDisk = parseStrictInt(env.MANDI_MIN_FREE_DISK_GB, { min: 1, max: 10000, fallback: 20 });
  const downloadBudget = parseStrictInt(env.MANDI_DOWNLOAD_BUDGET_MB, { min: 1, max: 1000000, fallback: 500 });
  const windowDays = parseStrictInt(env.CEDA_REQUEST_WINDOW_DAYS, { min: 1, max: 366, fallback: 92 });

  const warnings = [providerWarning, lookback.error, timeout.error, retries.error, requestInterval.error,
    jobTimeout.error, minFreeDisk.error, downloadBudget.error, windowDays.error].filter(Boolean);

  return {
    provider,
    sync: parseSyncInterval(env.MANDI_SYNC_INTERVAL_MINUTES),
    syncLookbackDays: lookback.value,
    syncJobTimeoutMinutes: jobTimeout.value,
    // Sample (MOCK) rows may only be written when explicitly allowed and never in production.
    allowSampleData: !isProduction && String(env.MANDI_ALLOW_SAMPLE_DATA || '').trim().toLowerCase() === 'true',
    dataGovApiKey: secretOrEmpty(env.DATA_GOV_IN_API_KEY),
    dataGovApiUrl: (env.DATA_GOV_IN_API_URL || 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070').trim(),
    cedaApiKey: secretOrEmpty(env.CEDA_API_KEY),
    cedaApiUrl: (env.CEDA_API_URL || 'https://api.ceda.ashoka.edu.in/v1').trim(),
    http: { timeoutMs: timeout.value, retries: retries.value, requestIntervalMs: requestInterval.value },
    historical: {
      outputDir: (env.MANDI_DATA_DIR || '').trim() || null,
      minFreeDiskGb: minFreeDisk.value,
      downloadBudgetMb: downloadBudget.value,
      windowDays: windowDays.value,
    },
    warnings,
  };
}

export default parseMandiConfig;
