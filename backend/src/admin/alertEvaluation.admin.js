/**
 * FASALYTICS Phase 8 — Admin Alert Evaluation Controller
 *
 * Protected by ingestionAuth middleware (same as mandi sync endpoints).
 * POST /api/admin/alerts/evaluate   – evaluate all active alerts
 * POST /api/admin/alerts/evaluate/market – evaluate alerts for a specific market
 */
import { mapDatabaseError } from '../utils/httpError.js';
import { evaluateAllAlerts, evaluateAlertsForMarket } from '../services/alertEvaluation.service.js';

export async function evaluateAll(req, res, next) {
  try {
    const result = await evaluateAllAlerts();
    res.json({ status: 'ok', evaluation: result });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function evaluateMarket(req, res, next) {
  try {
    const { commodityId, mandiId } = req.body;
    const numCommodity = Number(commodityId);
    const numMandi = Number(mandiId);

    if (!numCommodity || !Number.isInteger(numCommodity) || numCommodity <= 0) {
      return res.status(400).json({ status: 'error', code: 'VALIDATION_ERROR', message: 'commodityId must be a positive integer.' });
    }
    if (!numMandi || !Number.isInteger(numMandi) || numMandi <= 0) {
      return res.status(400).json({ status: 'error', code: 'VALIDATION_ERROR', message: 'mandiId must be a positive integer.' });
    }

    const result = await evaluateAlertsForMarket(numCommodity, numMandi);
    res.json({ status: 'ok', evaluation: result });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}
