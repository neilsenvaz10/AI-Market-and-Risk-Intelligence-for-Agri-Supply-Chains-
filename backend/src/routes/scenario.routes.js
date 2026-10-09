import express from 'express';
import { createScenarioController } from '../controllers/scenario.controller.js';
import { createOptionalAuth } from '../middleware/optionalAuth.js';

/**
 * Phase 4 + Phase 6 Selling Decision Scenario Routes
 *
 *   POST /api/scenarios/simulate
 *   Body: { commodity, mandiId, quantityQuintals, holdDays, includeRisk, includeSample }
 */
export function createScenarioRoutes({
  controller = createScenarioController(),
  optionalAuth = createOptionalAuth(),
} = {}) {
  const router = express.Router();
  router.post('/simulate', optionalAuth, controller.simulate);
  return router;
}

export default createScenarioRoutes;
