/**
 * Phase 6 — Agricultural Market Risk Intelligence Engine
 *
 * Implements transparent, explainable risk calculations across five dimensions:
 *   1. Price Decline Risk       (projected price drops over 1-7 days vs latest genuine price)
 *   2. Historical Volatility    (daily price swings, standard deviation, coefficient of variation)
 *   3. Market Arrival Surge     (recent arrival quantity vs trailing baseline)
 *   4. Forecast Uncertainty     (relative width of 80% prediction intervals, model dispersion)
 *   5. Data Freshness           (latency of market reporting date vs current calendar)
 *
 * Overall Risk Classification:
 *   LOW, MODERATE, HIGH, UNKNOWN
 *
 * Principles:
 *   - Genuine observations only (synthetic fixtures and sample data excluded).
 *   - Transparent, explainable evidence for every risk factor.
 *   - Never classify missing information as LOW risk.
 *   - Return UNKNOWN when evidence is insufficient.
 *   - Never claim guaranteed future prices.
 */

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  UNKNOWN: 'UNKNOWN',
});

export const DEFAULT_CONFIG = Object.freeze({
  priceDecline: {
    highDropPercent: 10.0,
    highWorstCaseDropPercent: 18.0,
    moderateDropPercent: 4.0,
    moderateWorstCaseDropPercent: 10.0,
  },
  volatility: {
    minObservations: 5,
    highCvPercent: 15.0,
    highDailySwingPercent: 8.0,
    highDailyStdPercent: 4.0,
    moderateCvPercent: 7.0,
    moderateDailySwingPercent: 4.0,
    moderateDailyStdPercent: 2.0,
  },
  arrivalSurge: {
    minArrivalObservations: 4,
    highSurgeRatio: 1.40,
    moderateSurgeRatio: 1.15,
  },
  forecastUncertainty: {
    highIntervalWidthPercent: 22.0,
    highConfidenceThreshold: 60.0,
    moderateIntervalWidthPercent: 12.0,
    moderateConfidenceThreshold: 78.0,
  },
  dataFreshness: {
    freshMaxDays: 3,
    agingMaxDays: 7,
  },
});

const toNumber = (val) => (val === null || val === undefined || isNaN(Number(val)) ? null : Number(val));

/**
 * 1. Price Decline Risk
 */
export function calculatePriceDeclineRisk({
  latestPrice,
  latestPriceDate,
  forecasts = [],
  config = DEFAULT_CONFIG.priceDecline,
} = {}) {
  const currentPrice = toNumber(latestPrice);
  if (currentPrice === null || currentPrice <= 0) {
    return {
      level: RISK_LEVELS.UNKNOWN,
      reason: 'NO_GENUINE_PRICE',
      explanation: 'No current market price available to assess price decline risk.',
      evidence: { latestPrice: null, latestPriceDate: null },
    };
  }

  const validForecasts = (forecasts || [])
    .filter((f) => toNumber(f.predicted_price) !== null && toNumber(f.predicted_price) > 0)
    .sort((a, b) => Number(a.horizon_days) - Number(b.horizon_days));

  if (validForecasts.length === 0) {
    return {
      level: RISK_LEVELS.UNKNOWN,
      reason: 'NO_GENUINE_FORECAST',
      explanation: 'No genuine price forecasts available for future horizons.',
      evidence: { latestPrice: currentPrice, latestPriceDate },
    };
  }

  let maxDropPercent = 0;
  let maxWorstCaseDropPercent = 0;
  let worstHorizon = null;
  let worstPredictedPrice = null;
  const horizonBreakdown = [];

  for (const f of validForecasts) {
    const predPrice = toNumber(f.predicted_price);
    const lowerBound = toNumber(f.lower_bound) ?? predPrice;
    const horizon = Number(f.horizon_days);

    const dropPercent = Number((((currentPrice - predPrice) / currentPrice) * 100).toFixed(2));
    const worstCaseDropPercent = Number((((currentPrice - lowerBound) / currentPrice) * 100).toFixed(2));

    horizonBreakdown.push({
      horizonDays: horizon,
      forecastDate: f.forecast_date,
      predictedPrice: predPrice,
      lowerBound,
      upperBound: toNumber(f.upper_bound),
      projectedDropPercent: dropPercent,
      worstCaseDropPercent,
    });

    if (dropPercent > maxDropPercent) {
      maxDropPercent = dropPercent;
      worstHorizon = horizon;
      worstPredictedPrice = predPrice;
    }
    if (worstCaseDropPercent > maxWorstCaseDropPercent) {
      maxWorstCaseDropPercent = worstCaseDropPercent;
    }
  }

  let level = RISK_LEVELS.LOW;
  let explanation = 'Forecast indicates price stability or appreciation over the next 1–7 days.';

  if (maxDropPercent >= config.highDropPercent || maxWorstCaseDropPercent >= config.highWorstCaseDropPercent) {
    level = RISK_LEVELS.HIGH;
    explanation = `Severe price decline projected: prices may drop by up to ${maxDropPercent > 0 ? maxDropPercent.toFixed(1) : '0'}% (worst-case ${maxWorstCaseDropPercent.toFixed(1)}%) within ${worstHorizon || 7} days.`;
  } else if (maxDropPercent >= config.moderateDropPercent || maxWorstCaseDropPercent >= config.moderateWorstCaseDropPercent) {
    level = RISK_LEVELS.MODERATE;
    explanation = `Moderate price decrease anticipated: projected decline of ${maxDropPercent.toFixed(1)}% within ${worstHorizon || 7} days.`;
  }

  return {
    level,
    reason: level === RISK_LEVELS.LOW ? 'STABLE_OR_RISING' : 'PROJECTED_DROP',
    explanation,
    evidence: {
      latestPrice: currentPrice,
      latestPriceDate,
      maxDropPercent: Math.max(0, maxDropPercent),
      maxWorstCaseDropPercent: Math.max(0, maxWorstCaseDropPercent),
      worstHorizonDays: worstHorizon,
      worstPredictedPrice,
      horizonBreakdown,
    },
  };
}

/**
 * 2. Historical Price Volatility
 */
export function calculateHistoricalVolatility({
  prices = [],
  config = DEFAULT_CONFIG.volatility,
} = {}) {
  const validPrices = (prices || [])
    .map((p) => ({
      date: p.price_date,
      modalPrice: toNumber(p.modal_price),
    }))
    .filter((p) => p.modalPrice !== null && p.modalPrice > 0);

  if (validPrices.length < config.minObservations) {
    return {
      level: RISK_LEVELS.UNKNOWN,
      reason: 'INSUFFICIENT_HISTORY',
      explanation: `Insufficient historical price observations (has ${validPrices.length}, requires ${config.minObservations}).`,
      evidence: { observations: validPrices.length, minRequired: config.minObservations },
    };
  }

  const values = validPrices.map((p) => p.modalPrice);
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1 || 1);
  const std = Math.sqrt(variance);
  const cvPercent = Number(((std / mean) * 100).toFixed(2));

  const dailyReturns = [];
  let maxDailySwingPercent = 0;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    const returnPct = ((curr - prev) / prev) * 100;
    dailyReturns.push(returnPct);
    const absReturn = Math.abs(returnPct);
    if (absReturn > maxDailySwingPercent) {
      maxDailySwingPercent = absReturn;
    }
  }

  const meanReturn = dailyReturns.length ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const dailyStd = dailyReturns.length
    ? Math.sqrt(dailyReturns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / (dailyReturns.length - 1 || 1))
    : 0;

  let level = RISK_LEVELS.LOW;
  let explanation = 'Historical prices show strong stability with low day-to-day volatility.';

  if (
    cvPercent >= config.highCvPercent ||
    maxDailySwingPercent >= config.highDailySwingPercent ||
    dailyStd >= config.highDailyStdPercent
  ) {
    level = RISK_LEVELS.HIGH;
    explanation = `High historical price volatility: standard variation is ${cvPercent}%, with daily swings up to ${maxDailySwingPercent.toFixed(1)}%.`;
  } else if (
    cvPercent >= config.moderateCvPercent ||
    maxDailySwingPercent >= config.moderateDailySwingPercent ||
    dailyStd >= config.moderateDailyStdPercent
  ) {
    level = RISK_LEVELS.MODERATE;
    explanation = `Moderate historical price fluctuations: variation of ${cvPercent}%, daily swing ${maxDailySwingPercent.toFixed(1)}%.`;
  }

  return {
    level,
    reason: level,
    explanation,
    evidence: {
      observations: n,
      meanPrice: Number(mean.toFixed(2)),
      minPrice: Math.min(...values),
      maxPrice: Math.max(...values),
      cvPercent,
      dailyStdPercent: Number(dailyStd.toFixed(2)),
      maxDailySwingPercent: Number(maxDailySwingPercent.toFixed(2)),
    },
  };
}

/**
 * 3. Market Arrival Surge Risk
 */
export function calculateArrivalSurgeRisk({
  prices = [],
  config = DEFAULT_CONFIG.arrivalSurge,
} = {}) {
  const arrivalRecords = (prices || [])
    .map((p) => ({
      date: p.price_date,
      arrival: toNumber(p.arrivals_quantity),
      unit: p.arrival_unit || 'tonnes',
    }))
    .filter((p) => p.arrival !== null && p.arrival > 0);

  if (arrivalRecords.length < config.minArrivalObservations) {
    return {
      level: RISK_LEVELS.UNKNOWN,
      reason: 'INSUFFICIENT_ARRIVAL_DATA',
      explanation: `Insufficient arrival records to detect supply surges (has ${arrivalRecords.length}, requires ${config.minArrivalObservations}).`,
      evidence: { arrivalRecords: arrivalRecords.length, minRequired: config.minArrivalObservations },
    };
  }

  const latestRecord = arrivalRecords[arrivalRecords.length - 1];
  const baselineRecords = arrivalRecords.slice(0, arrivalRecords.length - 1);
  const baselineArrival =
    baselineRecords.reduce((sum, r) => sum + r.arrival, 0) / baselineRecords.length;

  if (baselineArrival <= 0) {
    return {
      level: RISK_LEVELS.UNKNOWN,
      reason: 'INVALID_BASELINE',
      explanation: 'Unable to establish historical arrival baseline.',
      evidence: { latestArrival: latestRecord.arrival, baselineArrival: 0 },
    };
  }

  const surgeRatio = Number((latestRecord.arrival / baselineArrival).toFixed(2));
  const surgePercent = Number(((surgeRatio - 1) * 100).toFixed(1));

  let level = RISK_LEVELS.LOW;
  let explanation = `Arrival volume (${latestRecord.arrival} ${latestRecord.unit}) is within normal seasonal bounds.`;

  if (surgeRatio >= config.highSurgeRatio) {
    level = RISK_LEVELS.HIGH;
    explanation = `Arrival volume spiked to ${latestRecord.arrival} ${latestRecord.unit} (${surgePercent}% above baseline), exerting heavy downward pressure on mandi prices.`;
  } else if (surgeRatio >= config.moderateSurgeRatio) {
    level = RISK_LEVELS.MODERATE;
    explanation = `Arrival volume is elevated at ${latestRecord.arrival} ${latestRecord.unit} (${surgePercent}% above baseline), indicating rising supply.`;
  }

  return {
    level,
    reason: level,
    explanation,
    evidence: {
      latestArrival: latestRecord.arrival,
      latestArrivalDate: latestRecord.date,
      baselineArrival: Number(baselineArrival.toFixed(1)),
      surgeRatio,
      surgePercent,
      arrivalUnit: latestRecord.unit,
      baselineSamples: baselineRecords.length,
    },
  };
}

/**
 * 4. Forecast Uncertainty
 */
export function calculateForecastUncertainty({
  forecasts = [],
  config = DEFAULT_CONFIG.forecastUncertainty,
} = {}) {
  const validForecasts = (forecasts || [])
    .filter(
      (f) =>
        toNumber(f.predicted_price) !== null &&
        toNumber(f.lower_bound) !== null &&
        toNumber(f.upper_bound) !== null
    );

  if (validForecasts.length === 0) {
    return {
      level: RISK_LEVELS.UNKNOWN,
      reason: 'NO_GENUINE_FORECAST',
      explanation: 'No genuine forecast prediction intervals available to evaluate uncertainty.',
      evidence: {},
    };
  }

  const widths = validForecasts.map((f) => {
    const pred = toNumber(f.predicted_price);
    const low = toNumber(f.lower_bound);
    const up = toNumber(f.upper_bound);
    return ((up - low) / (pred || 1)) * 100;
  });

  const avgIntervalWidth = Number((widths.reduce((s, w) => s + w, 0) / widths.length).toFixed(1));
  const confidences = validForecasts
    .map((f) => toNumber(f.confidence))
    .filter((c) => c !== null);
  const avgConfidence = confidences.length
    ? Number((confidences.reduce((s, c) => s + c, 0) / confidences.length).toFixed(1))
    : null;

  let level = RISK_LEVELS.LOW;
  let explanation = 'Forecast prediction intervals are narrow and indicate high model agreement.';

  if (
    avgIntervalWidth >= config.highIntervalWidthPercent ||
    (avgConfidence !== null && avgConfidence < config.highConfidenceThreshold)
  ) {
    level = RISK_LEVELS.HIGH;
    explanation = `High forecast uncertainty: wide prediction spread (±${(avgIntervalWidth / 2).toFixed(1)}%), indicating volatile or unpredictable price trajectory.`;
  } else if (
    avgIntervalWidth >= config.moderateIntervalWidthPercent ||
    (avgConfidence !== null && avgConfidence < config.moderateConfidenceThreshold)
  ) {
    level = RISK_LEVELS.MODERATE;
    explanation = `Moderate forecast uncertainty: prediction band spread is ±${(avgIntervalWidth / 2).toFixed(1)}%.`;
  }

  return {
    level,
    reason: level,
    explanation,
    evidence: {
      horizonsEvaluated: validForecasts.length,
      avgIntervalWidthPercent: avgIntervalWidth,
      modelConfidenceScore: avgConfidence,
      intervalCoverageLevel: validForecasts[0]?.interval_level ?? 0.8,
      note: 'Confidence is a heuristic model dispersion score and not a calibrated probability.',
    },
  };
}

/**
 * 5. Data Freshness
 */
export function calculateDataFreshness({
  latestPriceDate,
  referenceDate = new Date(),
  config = DEFAULT_CONFIG.dataFreshness,
} = {}) {
  if (!latestPriceDate) {
    return {
      level: RISK_LEVELS.UNKNOWN,
      isStale: true,
      daysSinceLastReport: null,
      explanation: 'No reporting date recorded for this mandi.',
      evidence: { latestReportDate: null, referenceDate: referenceDate.toISOString ? referenceDate.toISOString().slice(0, 10) : String(referenceDate) },
    };
  }

  const ref = typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate;
  const rep = new Date(latestPriceDate);
  const diffTime = ref.getTime() - rep.getTime();
  const daysDiff = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  let level = RISK_LEVELS.LOW;
  let isStale = false;
  let explanation = `Market data is fresh: reported ${daysDiff === 0 ? 'today' : `${daysDiff} day(s) ago`} (${latestPriceDate}).`;

  if (daysDiff > config.agingMaxDays) {
    level = RISK_LEVELS.HIGH;
    isStale = true;
    explanation = `Market data is stale: last reported on ${latestPriceDate} (${daysDiff} days ago). Real-time risk may differ significantly.`;
  } else if (daysDiff > config.freshMaxDays) {
    level = RISK_LEVELS.MODERATE;
    isStale = true;
    explanation = `Market data is aging: last reported on ${latestPriceDate} (${daysDiff} days ago).`;
  }

  return {
    level,
    isStale,
    daysSinceLastReport: daysDiff,
    explanation,
    evidence: {
      latestReportDate: latestPriceDate,
      referenceDate: ref.toISOString ? ref.toISOString().slice(0, 10) : String(referenceDate),
      daysSinceLastReport: daysDiff,
    },
  };
}

/**
 * 6. Synthesizes overall risk classification & actionable farmer advisory warnings
 */
export function classifyOverallRisk({
  priceDecline,
  volatility,
  arrivalSurge,
  forecastUncertainty,
  dataFreshness,
}) {
  const warnings = [];
  const factors = { priceDecline, volatility, arrivalSurge, forecastUncertainty, dataFreshness };

  const knownFactorLevels = Object.values(factors).map((f) => f.level);
  const unknownCount = knownFactorLevels.filter((lvl) => lvl === RISK_LEVELS.UNKNOWN).length;

  if (dataFreshness.level === RISK_LEVELS.HIGH) {
    warnings.push({
      code: 'STALE_DATA',
      severity: 'WARNING',
      message: 'Mandi report is stale (> 7 days old). Exercise caution and verify current spot rates before transport.',
    });
  }

  if (arrivalSurge.level === RISK_LEVELS.HIGH) {
    warnings.push({
      code: 'SUPPLY_GLUT',
      severity: 'HIGH',
      message: 'Significant arrival surge detected. High probability of price softening during daily trading.',
    });
  }

  if (priceDecline.level === RISK_LEVELS.HIGH) {
    warnings.push({
      code: 'PRICE_DROP_ALERT',
      severity: 'HIGH',
      message: 'Predicted multi-day price decline. Consider early harvesting or exploring alternative nearby mandis.',
    });
  }

  if (volatility.level === RISK_LEVELS.HIGH) {
    warnings.push({
      code: 'HIGH_VOLATILITY',
      severity: 'MODERATE',
      message: 'Mandi prices have erratic swings. Staggered selling may hedge against intra-week lows.',
    });
  }

  if (forecastUncertainty.level === RISK_LEVELS.HIGH) {
    warnings.push({
      code: 'HIGH_UNCERTAINTY',
      severity: 'INFO',
      message: 'Wide forecast prediction bands indicate irregular market movements.',
    });
  }

  let overallLevel = RISK_LEVELS.LOW;

  if (
    (priceDecline.level === RISK_LEVELS.UNKNOWN && volatility.level === RISK_LEVELS.UNKNOWN) ||
    unknownCount >= 4
  ) {
    overallLevel = RISK_LEVELS.UNKNOWN;
  } else if (
    priceDecline.level === RISK_LEVELS.HIGH ||
    arrivalSurge.level === RISK_LEVELS.HIGH
  ) {
    overallLevel = RISK_LEVELS.HIGH;
  } else if (
    priceDecline.level === RISK_LEVELS.MODERATE ||
    volatility.level === RISK_LEVELS.HIGH ||
    arrivalSurge.level === RISK_LEVELS.MODERATE ||
    dataFreshness.level === RISK_LEVELS.HIGH
  ) {
    overallLevel = RISK_LEVELS.MODERATE;
  } else if (
    priceDecline.level === RISK_LEVELS.LOW &&
    volatility.level === RISK_LEVELS.LOW &&
    dataFreshness.level === RISK_LEVELS.LOW
  ) {
    overallLevel = RISK_LEVELS.LOW;
  } else {
    overallLevel = unknownCount > 0 ? RISK_LEVELS.MODERATE : RISK_LEVELS.LOW;
  }

  let summaryAdvice = 'Market conditions appear relatively favorable and stable for trading.';
  if (overallLevel === RISK_LEVELS.HIGH) {
    summaryAdvice = 'Elevated market risk: adverse price pressures or large incoming arrivals detected.';
  } else if (overallLevel === RISK_LEVELS.MODERATE) {
    summaryAdvice = 'Moderate market risk: price softening, volatility, or aging data warrants prudent selling.';
  } else if (overallLevel === RISK_LEVELS.UNKNOWN) {
    summaryAdvice = 'Insufficient genuine market evidence to establish a definitive risk classification.';
  }

  return {
    overallLevel,
    summaryAdvice,
    warnings,
    breakdown: factors,
  };
}

/**
 * Complete risk calculation for a series
 */
export function calculateRiskProfile({
  prices = [],
  forecasts = [],
  referenceDate = new Date(),
  config = DEFAULT_CONFIG,
} = {}) {
  const sortedPrices = [...(prices || [])].sort(
    (a, b) => new Date(a.price_date).getTime() - new Date(b.price_date).getTime()
  );

  const latestPriceRecord = sortedPrices.length ? sortedPrices[sortedPrices.length - 1] : null;
  const latestPrice = latestPriceRecord ? toNumber(latestPriceRecord.modal_price) : null;
  const latestPriceDate = latestPriceRecord ? latestPriceRecord.price_date : null;

  const priceDecline = calculatePriceDeclineRisk({
    latestPrice,
    latestPriceDate,
    forecasts,
    config: config.priceDecline,
  });

  const volatility = calculateHistoricalVolatility({
    prices: sortedPrices,
    config: config.volatility,
  });

  const arrivalSurge = calculateArrivalSurgeRisk({
    prices: sortedPrices,
    config: config.arrivalSurge,
  });

  const forecastUncertainty = calculateForecastUncertainty({
    forecasts,
    config: config.forecastUncertainty,
  });

  const dataFreshness = calculateDataFreshness({
    latestPriceDate,
    referenceDate,
    config: config.dataFreshness,
  });

  const classification = classifyOverallRisk({
    priceDecline,
    volatility,
    arrivalSurge,
    forecastUncertainty,
    dataFreshness,
  });

  return {
    ...classification,
    latestPrice,
    latestPriceDate,
    evaluatedAt: new Date().toISOString(),
  };
}
