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

export default {
  checkBackendHealth,
  checkDatabaseHealth,
  checkMlHealth,
  getBaseUrl: () => resolvedApiUrl,
};
