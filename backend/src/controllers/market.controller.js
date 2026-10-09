import defaultMarketService from '../services/market.service.js';
import { HttpError, mapDatabaseError } from '../utils/httpError.js';
import {
  validateCommodityListQuery,
  validateDataStatusQuery,
  validateHistoryQuery,
  validateLatestQuery,
  validateMandiListQuery,
} from '../validators/market.validator.js';

const invalid = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'One or more request parameters are invalid.', errors);

function parse(validator, input) {
  const result = validator(input);
  if (result.errors) throw invalid(result.errors);
  return result.value;
}

/**
 * Read-only Phase 5 market controller.
 *
 * Like the mandi controller it wraps every handler in `handle()`, so a failed
 * query becomes `mapDatabaseError(err)` — notably a missing view (42P01) surfaces
 * as the existing 503 DATABASE_NOT_MIGRATED with no special-casing here.
 * Validation failures become a single 400 VALIDATION_ERROR, and an empty result
 * is always 200 with `data: []` — never a 404 and never a fabricated row.
 */
export function createMarketController({ marketService = defaultMarketService } = {}) {
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(mapDatabaseError(err));
    }
  };

  return {
    getCommodities: handle(async (req, res) => {
      const filters = parse(validateCommodityListQuery, req.query);
      const { rows, total } = await marketService.listCommodities(filters);
      res.status(200).json({
        status: 'success', count: rows.length, total,
        limit: filters.limit, offset: filters.offset, data: rows,
      });
    }),

    getMandis: handle(async (req, res) => {
      const filters = parse(validateMandiListQuery, req.query);
      const { rows, total } = await marketService.listMandis(filters);
      res.status(200).json({
        status: 'success', count: rows.length, total,
        limit: filters.limit, offset: filters.offset, data: rows,
      });
    }),

    getLatestPrices: handle(async (req, res) => {
      const filters = parse(validateLatestQuery, req.query);
      const { rows, total, meta } = await marketService.getLatestPrices(filters);
      res.status(200).json({
        status: 'success', count: rows.length, total,
        limit: filters.limit, offset: filters.offset, meta, data: rows,
      });
    }),

    getPriceHistory: handle(async (req, res) => {
      const filters = parse(validateHistoryQuery, req.query);
      const { rows, total, meta } = await marketService.getPriceHistory(filters);
      res.status(200).json({
        status: 'success', count: rows.length, total,
        limit: filters.limit, offset: filters.offset, order: filters.order, meta, data: rows,
      });
    }),

    getDataStatus: handle(async (req, res) => {
      parse(validateDataStatusQuery, req.query);
      res.status(200).json({ status: 'success', data: await marketService.getDataStatus() });
    }),
  };
}

export default createMarketController();
