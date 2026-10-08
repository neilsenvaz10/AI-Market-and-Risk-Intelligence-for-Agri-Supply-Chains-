import { Router } from 'express';
import { getSession } from '../controllers/farmer.controller.js';

export default function createAuthRoutes(requireAuth) {
  const router = Router();

  router.get('/session', requireAuth, getSession);

  return router;
}
