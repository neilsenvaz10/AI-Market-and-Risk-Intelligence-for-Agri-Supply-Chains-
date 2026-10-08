import { checkDatabaseConnection } from '../db.js';
import { config } from '../config/index.js';

/**
 * GET /api/health
 * Returns backend health status
 */
export async function getBackendHealth(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'fasalytics-backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
}

/**
 * GET /api/health/database
 * Checks PostgreSQL connectivity
 */
export async function getDatabaseHealth(req, res) {
  const dbStatus = await checkDatabaseConnection();

  if (dbStatus.ok) {
    return res.status(200).json({
      status: 'ok',
      service: 'postgresql',
      connected: true,
      serverTime: dbStatus.serverTime,
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(503).json({
    status: 'error',
    service: 'postgresql',
    connected: false,
    message: 'Failed to connect to PostgreSQL database',
    details: dbStatus.error,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/health/ml
 * Checks FastAPI ML service health
 */
export async function getMlHealth(req, res) {
  const mlUrl = `${config.mlServiceUrl}/health`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(mlUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return res.status(200).json({
        status: 'ok',
        service: 'fastapi-ml',
        connected: true,
        mlServiceUrl: config.mlServiceUrl,
        mlResponse: data,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(502).json({
      status: 'error',
      service: 'fastapi-ml',
      connected: false,
      statusCode: response.status,
      message: `ML service returned HTTP ${response.status}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      service: 'fastapi-ml',
      connected: false,
      message: 'Failed to connect to ML service',
      details: error.name === 'AbortError' ? 'Connection timed out (3s)' : error.message,
      mlServiceUrl: config.mlServiceUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
