import mandiService from '../services/mandi.service.js';
import mandiPipeline from '../pipeline/index.js';

/**
 * Controller: GET /api/mandi/mandis
 */
export async function getMandis(req, res, next) {
  try {
    const { state, district, search } = req.query;
    const mandis = await mandiService.listMandis({ state, district, search });
    res.status(200).json({
      status: 'success',
      count: mandis.length,
      data: mandis,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: GET /api/mandi/mandis/:id
 */
export async function getMandiDetails(req, res, next) {
  try {
    const mandi = await mandiService.getMandiById(req.params.id);
    if (!mandi) {
      return res.status(404).json({
        status: 'error',
        message: `Mandi with ID ${req.params.id} not found`,
      });
    }
    res.status(200).json({
      status: 'success',
      data: mandi,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: GET /api/mandi/prices/latest
 */
export async function getLatestPrices(req, res, next) {
  try {
    const { commodity, mandiId, district, state, limit } = req.query;
    const prices = await mandiService.getLatestPrices({ commodity, mandiId, district, state, limit });
    res.status(200).json({
      status: 'success',
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: GET /api/mandi/prices/history
 */
export async function getPriceHistory(req, res, next) {
  try {
    const { commodity, mandiId, startDate, endDate, limit } = req.query;
    const history = await mandiService.getPriceHistory({ commodity, mandiId, startDate, endDate, limit });
    res.status(200).json({
      status: 'success',
      count: history.length,
      data: history,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: GET /api/mandi/commodities
 */
export async function getCommodities(req, res, next) {
  try {
    const commodities = await mandiService.getCommodities();
    res.status(200).json({
      status: 'success',
      count: commodities.length,
      data: commodities,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: POST /api/mandi/sync
 * Manually or programmatically triggers pipeline ingestion run
 */
export async function triggerSync(req, res, next) {
  try {
    const {
      provider,
      state,
      commodity,
      days,
      limit,
      fromDate,
      toDate,
      maxRecords,
      crossSource,
    } = req.body || {};

    const result = await mandiPipeline.runPipeline({
      provider,
      state,
      commodity,
      days,
      limit,
      fromDate,
      toDate,
      maxRecords,
      crossSource,
    });

    res.status(200).json({
      status: 'success',
      message: 'Mandi pipeline execution completed',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: GET /api/mandi/sync/status
 */
export async function getSyncStatus(req, res, next) {
  try {
    const status = await mandiService.getPipelineStatus();
    res.status(200).json({
      status: 'success',
      data: status,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: GET /api/mandi/quality/report
 * Returns dataset quality audit, source coverage, integrity status, and storage metrics
 */
export async function getDataQualityReport(req, res, next) {
  try {
    const report = await mandiService.getDataQualityReport();
    res.status(200).json({
      status: 'success',
      data: report,
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getMandis,
  getMandiDetails,
  getLatestPrices,
  getPriceHistory,
  getCommodities,
  triggerSync,
  getSyncStatus,
  getDataQualityReport,
};
