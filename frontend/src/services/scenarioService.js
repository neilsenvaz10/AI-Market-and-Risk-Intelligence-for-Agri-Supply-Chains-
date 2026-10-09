/**
 * FASALYTICS — Scenario Simulation Service
 * Connects frontend to the backend selling-decision simulation engine (POST /api/scenarios/simulate).
 */

import { apiRequest } from './api';

let activeRequestId = 0;

/**
 * Simulates selling decision scenarios (Sell Today vs Hold 1..7 Days).
 *
 * @param {object} params
 * @param {string} params.commodity - Commodity code or name (e.g. 'ONION')
 * @param {string|number} [params.mandiId] - Mandi ID or code (e.g. 'MH_PUNE_APMC')
 * @param {number} [params.quantityQuintals] - Quantity in quintals
 * @param {number} [params.quantityKg] - Quantity in kilograms
 * @param {number} [params.holdDays] - Holding duration (0 = Sell Today, 1..7 = Wait N Days)
 * @param {boolean} [params.includeRisk] - Whether to include Phase 6 risk intelligence
 * @param {boolean} [params.includeSample] - Whether to allow sample fixtures (demo mode)
 * @param {Array} [params.allocations] - Optional multi-mandi allocation array
 * @returns {Promise<object>} Simulation response
 */
export async function simulateScenario({
  commodity,
  mandiId,
  quantityQuintals,
  quantityKg,
  holdDays = 1,
  includeRisk = true,
  includeSample = true,
  allocations,
} = {}) {
  const reqId = ++activeRequestId;

  const payload = {
    commodity,
    mandiId,
    quantityQuintals,
    quantityKg,
    holdDays,
    includeRisk,
    includeSample,
    allocations,
  };

  const res = await apiRequest('/api/scenarios/simulate', {
    method: 'POST',
    body: payload,
  });

  // Stale-response guard: ignore if a newer request was dispatched while this was in flight
  if (reqId !== activeRequestId) {
    const error = new Error('STALE_REQUEST');
    error.isStale = true;
    throw error;
  }

  return res.data;
}

export default {
  simulateScenario,
};
