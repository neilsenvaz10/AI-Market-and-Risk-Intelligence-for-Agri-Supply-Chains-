import { validateCopilotChatPayload } from '../validators/copilot.validator.js';
import { defaultCopilotOrchestrator } from '../services/copilot/copilotOrchestrator.service.js';
import { HttpError } from '../utils/httpError.js';

export function createCopilotController({ orchestrator = defaultCopilotOrchestrator } = {}) {
  return {
    chat: async (req, res, next) => {
      try {
        const { data, errors } = validateCopilotChatPayload(req.body);
        if (errors) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', errors);
        }

        const userId = req.auth?.uid || null;
        const result = await orchestrator.processMessage({
          message: data.message,
          language: data.language,
          context: data.context,
          conversationHistory: data.conversationHistory,
          userId,
        });

        res.json({
          status: 'ok',
          ...result,
        });
      } catch (err) {
        next(err);
      }
    },

    getCapabilities: async (req, res, next) => {
      try {
        res.json({
          status: 'ok',
          capabilities: {
            groqConfigured: orchestrator.groqService.isConfigured(),
            groqModel: orchestrator.groqService.getModel(),
            supportedLanguages: ['en', 'hi', 'mr'],
            supportedIntents: [
              'LATEST_PRICE',
              'PRICE_HISTORY',
              'FORECAST',
              'FORECAST_UNCERTAINTY',
              'MARKET_EDUCATION',
              'RECOMMENDATION_EXPLANATION',
              'RISK_EXPLANATION',
            ],
            integrations: {
              phase3MarketData: true,
              phase4Forecasting: true,
              phase5Recommendations: false,
              phase6RiskIntelligence: false,
              phase8FarmerPersonalization: true,
            },
          },
        });
      } catch (err) {
        next(err);
      }
    },
  };
}

export const copilotController = createCopilotController();
