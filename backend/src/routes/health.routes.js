import { Router } from 'express';
import {
  getBackendHealth,
  getDatabaseHealth,
  getMlHealth,
} from '../controllers/health.controller.js';

const router = Router();

router.get('/', getBackendHealth);
router.get('/database', getDatabaseHealth);
router.get('/ml', getMlHealth);

export default router;
