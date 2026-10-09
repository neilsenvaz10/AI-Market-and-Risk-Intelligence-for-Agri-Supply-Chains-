import defaultMandiService from '../services/mandi.service.js';
import defaultPipeline from '../pipeline/index.js';
import { HttpError, mapDatabaseError } from '../utils/httpError.js';
import {
  validateHistoryQuery,
  validateLatestQuery,
  validateMandiId,
  validateMandiListQuery,
  validateSyncRequest,
} from '../validators/mandi.validator.js';

const invalid = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'One or more request parameters are invalid.', errors);

function parse(validator, input) {
  const result = validator(input);
  if (result.errors) throw invalid(result.errors);
  return result.value;
}

// Pipeline outcomes that are not a successful ingestion map to explicit HTTP statuses.
const RUN_STATUS_HTTP = { SKIPPED: 409, REFUSED: 403 };
const RUN_ERROR_HTTP = { SOURCE_NOT_CONFIGURED: 503, NO_PROVIDER: 400, UNAUTHORIZED: 502, RATE_LIMITED: 503, NETWORK_ERROR: 502, TIMEOUT: 504, ALL_RECORDS_REJECTED: 422, NOTHING_PERSISTED: 502 };

/** Builds the mandi controller; service and pipeline are injectable for tests. */
export function createMandiController({ mandiService = defaultMandiService, pipeline = defaultPipeline } = {}) {
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(mapDatabaseError(err));
    }
  };

  return {
    getMandis: handle(async (req, res) => {
      const filters = parse(validateMandiListQuery, req.query);
      const { rows, total } = await mandiService.listMandis(filters);
      res.status(200).json({ status: 'success', count: rows.length, total, limit: filters.limit, offset: filters.offset, data: rows });
    }),

    getMandiDetails: handle(async (req, res) => {
      const id = parse(validateMandiId, req.params.id);
      const mandi = await mandiService.getMandiById(id);
      if (!mandi) throw new HttpError(404, 'MANDI_NOT_FOUND', `Mandi with ID ${id} not found`);
      res.status(200).json({ status: 'success', data: mandi });
    }),

    getLatestPrices: handle(async (req, res) => {
      const filters = parse(validateLatestQuery, req.query);
      const { rows, total, meta } = await mandiService.getLatestPrices(filters);
      res.status(200).json({ status: 'success', count: rows.length, total, limit: filters.limit, offset: filters.offset, meta, data: rows });
    }),

    getPriceHistory: handle(async (req, res) => {
      const filters = parse(validateHistoryQuery, req.query);
      const { rows, total, meta } = await mandiService.getPriceHistory(filters);
      res.status(200).json({
        status: 'success', count: rows.length, total, limit: filters.limit, offset: filters.offset,
        order: filters.order, meta, data: rows,
      });
    }),

    getCommodities: handle(async (req, res) => {
      const commodities = await mandiService.getCommodities();
      res.status(200).json({ status: 'success', count: commodities.length, data: commodities });
    }),

    getCommodityReports: handle(async (req, res) => {
      const filters = {
        commodity: req.query.commodity,
        group: req.query.group,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        source: req.query.source,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 100,
        offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
      };
      const { rows, total, meta } = await mandiService.getCommodityDailyReports(filters);
      res.status(200).json({
        status: 'success',
        count: rows.length,
        total,
        limit: filters.limit,
        offset: filters.offset,
        meta,
        data: rows,
      });
    }),

    getSyncStatus: handle(async (req, res) => {
      res.status(200).json({ status: 'success', data: await mandiService.getPipelineStatus() });
    }),

    getDataQualityReport: handle(async (req, res) => {
      res.status(200).json({ status: 'success', data: await mandiService.getDataQualityReport() });
    }),

    /** POST /api/mandi/sync — reached only after rate limit, authentication and authorisation. */
    triggerSync: handle(async (req, res) => {
      const options = parse(validateSyncRequest, req.body ?? {});
      const result = await pipeline.runPipeline({ ...options, triggeredBy: `user:${req.auth?.uid ?? 'unknown'}` });
      const httpStatus = RUN_STATUS_HTTP[result.status] || (result.status === 'FAILED' ? RUN_ERROR_HTTP[result.error_code] || 502 : 200);
      res.status(httpStatus).json({
        status: httpStatus === 200 ? 'success' : 'error',
        message: `Mandi pipeline run ${result.status}`,
        ...(httpStatus !== 200 && { code: result.error_code }),
        data: result,
      });
    }),
  };
}

export default createMandiController();
