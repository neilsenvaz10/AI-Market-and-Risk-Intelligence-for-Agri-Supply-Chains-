/**
 * FASALYTICS - API Service
 * Centralized API client for communicating with the Node.js Express backend.
 */

let resolvedApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';

async function fetchWithFallback(endpoint, options = {}) {
  try {
    const res = await fetch(`${resolvedApiUrl}${endpoint}`, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // If on default port 5000 and connection failed, try 5001 fallback on Windows
    if (resolvedApiUrl.includes(':5000')) {
      try {
        const fallbackUrl = resolvedApiUrl.replace(':5000', ':5001');
        const fallbackRes = await fetch(`${fallbackUrl}${endpoint}`, options);
        if (fallbackRes.ok) {
          resolvedApiUrl = fallbackUrl;
          return await fallbackRes.json();
        }
      } catch {
        // Fall through to initial error
      }
    }
    throw err;
  }
}

/**
 * Error raised for failed API calls. `code` mirrors the backend's JSON error
 * code (e.g. TOKEN_EXPIRED, PROFILE_NOT_FOUND) or NETWORK_ERROR.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isJsonResponse = (res) => (res.headers.get('content-type') || '').includes('application/json');

async function sendRequest(baseUrl, endpoint, options) {
  const res = await fetch(`${baseUrl}${endpoint}`, options);
  // A non-JSON reply means another process owns the port (e.g. Windows on :5000).
  if (!isJsonResponse(res)) throw new TypeError(`Unexpected response from ${baseUrl}`);
  return res;
}

/**
 * JSON request to the Express backend. Never treats a failed request as success:
 * non-2xx responses throw ApiError with the backend's code and message.
 *
 * @param {string} endpoint e.g. '/api/farmers/me'
 * @param {{ method?: string, body?: object, token?: string }} options
 */
export async function apiRequest(endpoint, { method = 'GET', body, token } = {}) {
  const options = {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  };

  let res;
  try {
    res = await sendRequest(resolvedApiUrl, endpoint, options);
  } catch {
    if (!resolvedApiUrl.includes(':5000')) {
      throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the FASALYTICS server. Check your internet connection.');
    }
    // Same Windows :5000 -> :5001 fallback used by the health checks
    const fallbackUrl = resolvedApiUrl.replace(':5000', ':5001');
    try {
      res = await sendRequest(fallbackUrl, endpoint, options);
      resolvedApiUrl = fallbackUrl;
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the FASALYTICS server. Check your internet connection.');
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.code || `HTTP_${res.status}`, data.message || `Request failed (HTTP ${res.status})`, data.details);
  }
  return data;
}

export async function checkBackendHealth() {
  try {
    return await fetchWithFallback('/api/health');
  } catch (err) {
    return {
      status: 'error',
      service: 'backend',
      message: err.message || 'Cannot connect to Express backend',
    };
  }
}

export async function checkDatabaseHealth() {
  try {
    return await fetchWithFallback('/api/health/database');
  } catch (err) {
    return {
      status: 'error',
      service: 'database',
      message: err.message || 'Cannot reach database health endpoint',
    };
  }
}

export async function checkMlHealth() {
  try {
    return await fetchWithFallback('/api/health/ml');
  } catch (err) {
    return {
      status: 'error',
      service: 'ml-service',
      message: err.message || 'Cannot reach ML service health endpoint',
    };
  }
}

/**
 * Mandi Data Pipeline API Client Methods (Phase 3)
 */

export async function getMandis(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  const endpoint = `/api/mandi/mandis${query ? `?${query}` : ''}`;
  return await fetchWithFallback(endpoint);
}

export async function getMandiDetails(id) {
  return await fetchWithFallback(`/api/mandi/mandis/${id}`);
}

export async function getLatestMandiPrices(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  const endpoint = `/api/mandi/prices/latest${query ? `?${query}` : ''}`;
  return await fetchWithFallback(endpoint);
}

export async function getMandiPriceHistory(options = {}) {
  const query = new URLSearchParams(options).toString();
  const endpoint = `/api/mandi/prices/history${query ? `?${query}` : ''}`;
  return await fetchWithFallback(endpoint);
}

export async function getCommodities() {
  return await fetchWithFallback('/api/mandi/commodities');
}

export async function getCommodityDailyReports(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  const endpoint = `/api/mandi/reports/daily${query ? `?${query}` : ''}`;
  return await fetchWithFallback(endpoint);
}

export async function getPipelineStatus() {
  return await fetchWithFallback('/api/mandi/sync/status');
}

export async function triggerMandiSync(params = {}) {
  return await fetchWithFallback('/api/mandi/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function getMandiQualityReport() {
  return await fetchWithFallback('/api/mandi/quality/report');
}

/**
 * Phase 4 — Price forecasting API client.
 *
 * `getForecast` resolves the commodity/mandi pair server-side (code, exact name or
 * id). A 200 response with `available: false` is a valid, non-error outcome: it
 * carries a `reason.code` (NO_MARKET_DATA | INSUFFICIENT_HISTORY | NO_FORECAST |
 * NO_FORECAST_FOR_FILTER) so the UI can show the right empty state instead of a
 * fabricated price. Genuine failures still throw ApiError.
 */
export async function getForecast(commodity, mandi, options = {}) {
  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });
  const query = params.toString();
  const endpoint = `/api/forecast/${encodeURIComponent(commodity)}/${encodeURIComponent(mandi)}${query ? `?${query}` : ''}`;
  return await fetchWithFallback(endpoint);
}

export default {
  checkBackendHealth,
  checkDatabaseHealth,
  checkMlHealth,
  getMandis,
  getMandiDetails,
  getLatestMandiPrices,
  getMandiPriceHistory,
  getCommodities,
  getCommodityDailyReports,
  getPipelineStatus,
  triggerMandiSync,
  getMandiQualityReport,
  getForecast,
  getBaseUrl: () => resolvedApiUrl,
};
