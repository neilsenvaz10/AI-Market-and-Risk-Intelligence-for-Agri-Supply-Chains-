import express from 'express';
import { createMarketController } from '../controllers/market.controller.js';

/**
 * Phase 5 read-only market API (public, no authentication, no writes).
 *
 * Mounted by app.js at `/api`, so these router paths resolve exactly to the
 * canonical Phase 5 URLs without touching the Phase 3 `/api/mandi/*` mount:
 *
 *   GET /api/commodities
 *       ?category ?search ?limit=1..1000(500) ?offset
 *   GET /api/mandis
 *       ?state ?district ?search ?commodity ?limit=1..1000(500) ?offset
 *   GET /api/mandis/prices/latest
 *       ?commodity ?commodityCategory ?variety ?state ?district ?mandi ?marketCode
 *       ?source ?qualityStatus=VALID|FLAGGED|REJECTED ?includeSample=true|false( true)
 *       ?limit=1..200(50) ?offset
 *   GET /api/mandis/prices/history
 *       (latest filters) ?startDate=YYYY-MM-DD ?endDate=YYYY-MM-DD ?order=ASC|DESC(ASC)
 *       ?limit=1..1000(100) ?offset
 *   GET /api/mandis/data-status
 *       no parameters (anything else is a 400)
 *
 * Every read goes through the canonical view. 400 invalid parameters,
 * 503 DATABASE_NOT_MIGRATED when the view/table is absent, 200 with `data: []`
 * when nothing matches — never a 404 and never a fabricated observation.
 * `meta` on the price endpoints is PAGE-SCOPED (see market.service.js).
 */
export function createMarketRoutes({ controller = createMarketController() } = {}) {
  const router = express.Router();

  router.get('/commodities', controller.getCommodities);
  router.get('/mandis', controller.getMandis);
  router.get('/mandis/prices/latest', controller.getLatestPrices);
  router.get('/mandis/prices/history', controller.getPriceHistory);
  router.get('/mandis/data-status', controller.getDataStatus);

  return router;
}

export default createMarketRoutes;
