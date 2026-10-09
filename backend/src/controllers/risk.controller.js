import defaultRiskService from '../services/risk.service.js';
import {
  validateRiskPath,
  validateRiskQuery,
  validateRiskSummaryQuery,
} from '../validators/risk.validator.js';

export function createRiskController({ riskService = defaultRiskService } = {}) {
  return {
    async getMandiRisk(req, res, next) {
      try {
        const pathCheck = validateRiskPath(req.params);
        if (pathCheck.errors) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid risk lookup path parameters.',
              details: pathCheck.errors,
            },
          });
        }

        const queryCheck = validateRiskQuery(req.query);
        if (queryCheck.errors) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid risk lookup query parameters.',
              details: queryCheck.errors,
            },
          });
        }

        const risk = await riskService.getMandiRisk({
          commodity: pathCheck.value.commodity,
          mandi: pathCheck.value.mandi,
          includeSample: queryCheck.value.includeSample,
          referenceDate: queryCheck.value.referenceDate,
        });

        return res.json(risk);
      } catch (err) {
        return next(err);
      }
    },

    async getRiskSummary(req, res, next) {
      try {
        const queryCheck = validateRiskSummaryQuery(req.query);
        if (queryCheck.errors) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid risk summary query parameters.',
              details: queryCheck.errors,
            },
          });
        }

        const summary = await riskService.getRiskSummary({
          includeSample: queryCheck.value.includeSample,
          referenceDate: queryCheck.value.referenceDate,
          limit: queryCheck.value.limit,
        });

        return res.json(summary);
      } catch (err) {
        return next(err);
      }
    },
  };
}

export default createRiskController();
