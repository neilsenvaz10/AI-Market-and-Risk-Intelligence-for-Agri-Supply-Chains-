import express from 'express';
import { requireAuth as defaultRequireAuth } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { copilotController as defaultController } from '../controllers/copilot.controller.js';

export function createCopilotRoutes({
  requireAuth = defaultRequireAuth,
  controller = defaultController,
  rateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, code: 'COPILOT_RATE_LIMITED' }),
} = {}) {
  const router = express.Router();

  router.get('/capabilities', controller.getCapabilities);
  router.post('/chat', rateLimiter, requireAuth, controller.chat);

  return router;
}

export default createCopilotRoutes;
