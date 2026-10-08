import express from 'express';
import {
  getMandis,
  getMandiDetails,
  getLatestPrices,
  getPriceHistory,
  getCommodities,
  triggerSync,
  getSyncStatus,
  getDataQualityReport,
} from '../controllers/mandi.controller.js';

const router = express.Router();

/**
 * Mandi Intelligence & Data Pipeline Routes
 */

// Mandi directory
router.get('/mandis', getMandis);
router.get('/mandis/:id', getMandiDetails);

// Price queries & analytical retrieval
router.get('/prices/latest', getLatestPrices);
router.get('/prices/history', getPriceHistory);

// Master metadata
router.get('/commodities', getCommodities);

// Data pipeline orchestration & observability
router.post('/sync', triggerSync);
router.get('/sync/status', getSyncStatus);

// Data quality & storage audit report
router.get('/quality/report', getDataQualityReport);

export default router;
