import express from 'express';
import { createRiskController } from '../controllers/risk.controller.js';

/**
 * Phase 6 Agricultural Risk Intelligence Routes
 *
 *   GET /api/risk/mandi/:commodity/:mandi
 *       ?includeSample=false   (default false, excludes synthetic fixtures)
 *       ?referenceDate=YYYY-MM-DD
 *
 *   GET /api/risk/summary
 *       ?includeSample=false
 *       ?referenceDate=YYYY-MM-DD
 *       ?limit=20
 */
export function createRiskRoutes({ controller = createRiskController() } = {}) {
  const router = express.Router();
  router.get('/mandi/:commodity/:mandi', controller.getMandiRisk);
  router.get('/summary', controller.getRiskSummary);
  return router;
}

export default createRiskRoutes;
