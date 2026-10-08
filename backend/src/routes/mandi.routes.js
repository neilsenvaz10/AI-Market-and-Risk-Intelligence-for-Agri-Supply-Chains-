import express from 'express';
import { createMandiController } from '../controllers/mandi.controller.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { createRequireAdminClaim } from '../middleware/ingestionAuth.js';

/**
 * Mandi Intelligence & Data Pipeline Routes
 *
 * Read endpoints are public (market prices are public information).
 * POST /sync is protected in this order:
 *   1. rate limit (5 requests / 15 min per IP)  -> 429
 *   2. Firebase ID token (requireAuth)          -> 401
 *   3. Firebase custom claim admin === true     -> 403 (503 if it cannot be verified: fails closed)
 *   4. body validation                          -> 400
 */
export function createMandiRoutes({
  requireAuth,
  authorizeIngestion = createRequireAdminClaim(),
  syncRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, code: 'SYNC_RATE_LIMITED' }),
  controller = createMandiController(),
} = {}) {
  if (typeof requireAuth !== 'function') throw new Error('createMandiRoutes requires requireAuth middleware');
  const router = express.Router();

  router.get('/mandis', controller.getMandis);
  router.get('/mandis/:id', controller.getMandiDetails);
  router.get('/prices/latest', controller.getLatestPrices);
  router.get('/prices/history', controller.getPriceHistory);
  router.get('/commodities', controller.getCommodities);
  router.get('/reports/daily', controller.getCommodityReports || ((req, res) => res.status(200).json({ status: 'success' })));
  router.get('/sync/status', controller.getSyncStatus);
  router.get('/quality/report', controller.getDataQualityReport);

  router.post('/sync', syncRateLimiter, requireAuth, authorizeIngestion, controller.triggerSync);

  return router;
}

export default createMandiRoutes;
