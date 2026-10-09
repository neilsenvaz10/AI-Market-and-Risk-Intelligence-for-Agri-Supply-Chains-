import defaultScenarioService from '../services/scenario.service.js';
import { validateSimulationPayload } from '../validators/scenario.validator.js';
import { HttpError, mapDatabaseError } from '../utils/httpError.js';

const invalid = (errors) =>
  new HttpError(400, 'VALIDATION_ERROR', 'One or more scenario simulation parameters are invalid.', errors);

export function createScenarioController({ scenarioService = defaultScenarioService } = {}) {
  return {
    async simulate(req, res, next) {
      try {
        const validated = validateSimulationPayload(req.body);
        if (validated.errors) {
          throw invalid(validated.errors);
        }

        const data = await scenarioService.simulate(validated.value, req.auth || null);
        res.json({
          status: 'success',
          data,
        });
      } catch (err) {
        next(mapDatabaseError(err));
      }
    },
  };
}

export default createScenarioController();
