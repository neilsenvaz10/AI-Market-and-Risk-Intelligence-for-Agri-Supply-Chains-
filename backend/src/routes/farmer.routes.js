import { Router } from 'express';
import { createMyProfile, getMyProfile, updateMyProfile } from '../controllers/farmer.controller.js';

/** All routes require a verified Firebase ID token. */
export default function createFarmerRoutes(requireAuth) {
  const router = Router();
  router.use(requireAuth);

  router.get('/me', getMyProfile);
  router.post('/me', createMyProfile);
  router.put('/me', updateMyProfile);

  return router;
}
