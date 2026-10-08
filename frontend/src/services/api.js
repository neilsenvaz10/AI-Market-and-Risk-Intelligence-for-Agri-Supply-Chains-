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
