/**
 * Validation for Phase 4 / Phase 6 Scenario Simulation endpoints.
 * Returns { value } or { errors: [{ field, message }] } and never throws.
 */

const TEXT_PATTERN = /^[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}\s.,'()&/_-]*$/u;

function text(raw, field, errors, { max = 100, required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    errors.push({ field, message: `${field} must be text` });
    return undefined;
  }
  const value = String(raw).normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!value) {
    if (required) errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (value.length > max || !TEXT_PATTERN.test(value)) {
    errors.push({ field, message: `${field} contains unsupported characters or is too long` });
    return undefined;
  }
  return value;
}

function integer(raw, field, errors, { min = 0, max = 7, fallback = 1 } = {}) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const textValue = String(raw).trim();
  if (!/^\d+$/.test(textValue)) {
    errors.push({ field, message: `${field} must be a whole number` });
    return undefined;
  }
  const value = Number(textValue);
  if (value < min || value > max) {
    errors.push({ field, message: `${field} must be between ${min} and ${max}` });
    return undefined;
  }
  return value;
}

function positiveNumber(raw, field, errors, { min = 0.01, max = 100000, fallback = 10 } = {}) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (Number.isNaN(num) || num < min || num > max) {
    errors.push({ field, message: `${field} must be a positive number between ${min} and ${max}` });
    return undefined;
  }
  return Math.round(num * 100) / 100;
}

function boolean(raw, field, errors, fallback = true) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  errors.push({ field, message: `${field} must be true or false` });
  return fallback;
}

/**
 * Validates payload for POST /api/scenarios/simulate
 */
export function validateSimulationPayload(body = {}) {
  const errors = [];

  const commodity = text(body.commodity, 'commodity', errors, { required: false });
  const mandiId = text(body.mandiId ?? body.mandi, 'mandiId', errors, { required: false });

  // Quantity in quintals: if quantityKg provided, convert kg to quintals (1 quintal = 100 kg)
  let quantityQuintals;
  if (body.quantityKg !== undefined && body.quantityKg !== null && body.quantityQuintals === undefined) {
    const kg = positiveNumber(body.quantityKg, 'quantityKg', errors, { min: 1, max: 10000000, fallback: 1000 });
    quantityQuintals = kg !== undefined ? Math.round((kg / 100) * 100) / 100 : undefined;
  } else {
    quantityQuintals = positiveNumber(body.quantityQuintals, 'quantityQuintals', errors, { min: 0.1, max: 100000, fallback: 10 });
  }

  const holdDays = integer(body.holdDays, 'holdDays', errors, { min: 0, max: 7, fallback: 1 });
  const includeRisk = boolean(body.includeRisk, 'includeRisk', errors, true);
  const includeSample = boolean(body.includeSample, 'includeSample', errors, true);

  let documentedStorageCostPerDay = 0;
  if (body.documentedStorageCostPerDay !== undefined && body.documentedStorageCostPerDay !== null) {
    const cost = Number(body.documentedStorageCostPerDay);
    if (Number.isNaN(cost) || cost < 0) {
      errors.push({ field: 'documentedStorageCostPerDay', message: 'documentedStorageCostPerDay must be a non-negative number' });
    } else {
      documentedStorageCostPerDay = Math.round(cost * 100) / 100;
    }
  }

  // Multi-mandi allocations support
  let allocations = null;
  if (Array.isArray(body.allocations) && body.allocations.length > 0) {
    allocations = [];
    for (let i = 0; i < body.allocations.length; i += 1) {
      const item = body.allocations[i];
      const allocMandi = text(item.mandiId ?? item.mandi, `allocations[${i}].mandiId`, errors, { required: true });
      let allocQ = 0;
      if (item.quantityKg !== undefined && item.quantityQuintals === undefined) {
        const kg = positiveNumber(item.quantityKg, `allocations[${i}].quantityKg`, errors, { min: 1, max: 10000000 });
        allocQ = kg !== undefined ? Math.round((kg / 100) * 100) / 100 : 0;
      } else {
        allocQ = positiveNumber(item.quantityQuintals, `allocations[${i}].quantityQuintals`, errors, { min: 0.1, max: 100000 });
      }
      if (allocMandi && allocQ > 0) {
        allocations.push({ mandiId: allocMandi, quantityQuintals: allocQ });
      }
    }
  }

  if (errors.length > 0) return { errors };

  return {
    value: {
      commodity,
      mandiId,
      quantityQuintals,
      holdDays,
      includeRisk,
      includeSample,
      documentedStorageCostPerDay,
      allocations,
    },
  };
}
