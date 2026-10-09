/**
 * FASALYTICS Phase 8 — Admin Routes for Alert Evaluation
 *
 * Protected by requireAuth + ingestionAuth (admin claim required).
 * POST /api/admin/alerts/evaluate
 * POST /api/admin/alerts/evaluate/market
 */
import { Router } from 'express';
import { evaluateAll, evaluateMarket } from '../admin/alertEvaluation.admin.js';

export default function createAdminPhase8Routes(requireAuth, requireIngestionAuth) {
  const router = Router();

  // Both middlewares required: Firebase token + admin claim
  router.use(requireAuth);
  router.use(requireIngestionAuth);

  router.post('/alerts/evaluate', evaluateAll);
  router.post('/alerts/evaluate/market', evaluateMarket);

  return router;
}
