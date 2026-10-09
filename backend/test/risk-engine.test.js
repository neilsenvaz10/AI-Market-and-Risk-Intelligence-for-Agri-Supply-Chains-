import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RISK_LEVELS,
  DEFAULT_CONFIG,
  calculatePriceDeclineRisk,
  calculateHistoricalVolatility,
  calculateArrivalSurgeRisk,
  calculateForecastUncertainty,
  calculateDataFreshness,
  classifyOverallRisk,
  calculateRiskProfile,
} from '../src/services/risk.engine.js';

test('Risk Engine — Price Decline Risk', async (t) => {
  await t.test('returns UNKNOWN when latest price is missing or non-positive', () => {
    const resNull = calculatePriceDeclineRisk({ latestPrice: null, latestPriceDate: '2026-10-01' });
    assert.equal(resNull.level, RISK_LEVELS.UNKNOWN);
    assert.equal(resNull.reason, 'NO_GENUINE_PRICE');

    const resZero = calculatePriceDeclineRisk({ latestPrice: 0, latestPriceDate: '2026-10-01' });
    assert.equal(resZero.level, RISK_LEVELS.UNKNOWN);
  });

  await t.test('returns UNKNOWN when no valid forecasts are available', () => {
    const res = calculatePriceDeclineRisk({ latestPrice: 2000, latestPriceDate: '2026-10-01', forecasts: [] });
    assert.equal(res.level, RISK_LEVELS.UNKNOWN);
    assert.equal(res.reason, 'NO_GENUINE_FORECAST');
  });

  await t.test('detects LOW risk when forecasted prices are stable or increasing', () => {
    const forecasts = [
      { horizon_days: 1, forecast_date: '2026-10-02', predicted_price: 2050, lower_bound: 1980, upper_bound: 2120 },
      { horizon_days: 2, forecast_date: '2026-10-03', predicted_price: 2100, lower_bound: 2000, upper_bound: 2200 },
    ];
    const res = calculatePriceDeclineRisk({ latestPrice: 2000, latestPriceDate: '2026-10-01', forecasts });
    assert.equal(res.level, RISK_LEVELS.LOW);
    assert.equal(res.reason, 'STABLE_OR_RISING');
    assert.equal(res.evidence.maxDropPercent, 0);
  });

  await t.test('detects MODERATE risk on moderate price decrease (5% drop)', () => {
    const forecasts = [
      { horizon_days: 1, forecast_date: '2026-10-02', predicted_price: 1980, lower_bound: 1900, upper_bound: 2060 },
      { horizon_days: 2, forecast_date: '2026-10-03', predicted_price: 1900, lower_bound: 1820, upper_bound: 1980 },
    ];
    const res = calculatePriceDeclineRisk({ latestPrice: 2000, latestPriceDate: '2026-10-01', forecasts });
    assert.equal(res.level, RISK_LEVELS.MODERATE);
    assert.equal(res.evidence.maxDropPercent, 5.0);
    assert.equal(res.evidence.worstHorizonDays, 2);
  });

  await t.test('detects HIGH risk on severe price drop (12% drop)', () => {
    const forecasts = [
      { horizon_days: 1, forecast_date: '2026-10-02', predicted_price: 1900, lower_bound: 1800, upper_bound: 2000 },
      { horizon_days: 3, forecast_date: '2026-10-04', predicted_price: 1760, lower_bound: 1600, upper_bound: 1900 },
    ];
    const res = calculatePriceDeclineRisk({ latestPrice: 2000, latestPriceDate: '2026-10-01', forecasts });
    assert.equal(res.level, RISK_LEVELS.HIGH);
    assert.equal(res.evidence.maxDropPercent, 12.0);
    assert.equal(res.evidence.worstHorizonDays, 3);
  });
});

test('Risk Engine — Historical Price Volatility', async (t) => {
  await t.test('returns UNKNOWN when observations are fewer than required threshold', () => {
    const fewPrices = [
      { price_date: '2026-10-01', modal_price: 2000 },
      { price_date: '2026-10-02', modal_price: 2050 },
    ];
    const res = calculateHistoricalVolatility({ prices: fewPrices });
    assert.equal(res.level, RISK_LEVELS.UNKNOWN);
    assert.equal(res.reason, 'INSUFFICIENT_HISTORY');
    assert.equal(res.evidence.observations, 2);
    assert.equal(res.evidence.minRequired, 5);
  });

  await t.test('detects LOW volatility on stationary, stable prices', () => {
    const stablePrices = [
      { price_date: '2026-10-01', modal_price: 2000 },
      { price_date: '2026-10-02', modal_price: 2010 },
      { price_date: '2026-10-03', modal_price: 1995 },
      { price_date: '2026-10-04', modal_price: 2005 },
      { price_date: '2026-10-05', modal_price: 2000 },
      { price_date: '2026-10-06', modal_price: 2015 },
    ];
    const res = calculateHistoricalVolatility({ prices: stablePrices });
    assert.equal(res.level, RISK_LEVELS.LOW);
    assert.ok(res.evidence.cvPercent < 3.0);
  });

  await t.test('detects HIGH volatility on sharp swings (> 8% single-day swing)', () => {
    const volatilePrices = [
      { price_date: '2026-10-01', modal_price: 2000 },
      { price_date: '2026-10-02', modal_price: 2250 }, // +12.5%
      { price_date: '2026-10-03', modal_price: 1950 }, // -13.3%
      { price_date: '2026-10-04', modal_price: 2300 },
      { price_date: '2026-10-05', modal_price: 2100 },
    ];
    const res = calculateHistoricalVolatility({ prices: volatilePrices });
    assert.equal(res.level, RISK_LEVELS.HIGH);
    assert.ok(res.evidence.maxDailySwingPercent >= 10.0);
  });
});

test('Risk Engine — Market Arrival Surge', async (t) => {
  await t.test('returns UNKNOWN when arrival records are insufficient', () => {
    const fewArrivals = [
      { price_date: '2026-10-01', modal_price: 2000, arrivals_quantity: 100 },
      { price_date: '2026-10-02', modal_price: 2050, arrivals_quantity: 110 },
    ];
    const res = calculateArrivalSurgeRisk({ prices: fewArrivals });
    assert.equal(res.level, RISK_LEVELS.UNKNOWN);
    assert.equal(res.reason, 'INSUFFICIENT_ARRIVAL_DATA');
  });

  await t.test('detects LOW surge risk when arrivals are in normal range', () => {
    const normalArrivals = [
      { price_date: '2026-10-01', modal_price: 2000, arrivals_quantity: 100 },
      { price_date: '2026-10-02', modal_price: 2000, arrivals_quantity: 105 },
      { price_date: '2026-10-03', modal_price: 2000, arrivals_quantity: 95 },
      { price_date: '2026-10-04', modal_price: 2000, arrivals_quantity: 102 },
      { price_date: '2026-10-05', modal_price: 2000, arrivals_quantity: 100 },
    ];
    const res = calculateArrivalSurgeRisk({ prices: normalArrivals });
    assert.equal(res.level, RISK_LEVELS.LOW);
    assert.ok(res.evidence.surgeRatio < 1.15);
  });

  await t.test('detects HIGH surge risk when arrivals spike by 50%', () => {
    const surgeArrivals = [
      { price_date: '2026-10-01', modal_price: 2000, arrivals_quantity: 100 },
      { price_date: '2026-10-02', modal_price: 2000, arrivals_quantity: 100 },
      { price_date: '2026-10-03', modal_price: 2000, arrivals_quantity: 100 },
      { price_date: '2026-10-04', modal_price: 2000, arrivals_quantity: 100 },
      { price_date: '2026-10-05', modal_price: 1800, arrivals_quantity: 160 }, // 1.6x surge
    ];
    const res = calculateArrivalSurgeRisk({ prices: surgeArrivals });
    assert.equal(res.level, RISK_LEVELS.HIGH);
    assert.equal(res.evidence.surgeRatio, 1.6);
    assert.equal(res.evidence.surgePercent, 60.0);
  });
});

test('Risk Engine — Forecast Uncertainty', async (t) => {
  await t.test('detects LOW uncertainty on narrow intervals and good confidence', () => {
    const forecasts = [
      { horizon_days: 1, predicted_price: 2000, lower_bound: 1940, upper_bound: 2060, confidence: 85 }, // 6% width
      { horizon_days: 2, predicted_price: 2020, lower_bound: 1950, upper_bound: 2090, confidence: 82 }, // 6.9% width
    ];
    const res = calculateForecastUncertainty({ forecasts });
    assert.equal(res.level, RISK_LEVELS.LOW);
    assert.ok(res.evidence.note.includes('calibrated'));
  });

  await t.test('detects HIGH uncertainty on wide prediction spread (25% spread)', () => {
    const forecasts = [
      { horizon_days: 1, predicted_price: 2000, lower_bound: 1750, upper_bound: 2250, confidence: 55 },
    ];
    const res = calculateForecastUncertainty({ forecasts });
    assert.equal(res.level, RISK_LEVELS.HIGH);
    assert.ok(res.evidence.avgIntervalWidthPercent >= 22.0);
  });
});

test('Risk Engine — Data Freshness', async (t) => {
  const refDate = '2026-10-10';

  await t.test('identifies fresh data within 3 days', () => {
    const res = calculateDataFreshness({ latestPriceDate: '2026-10-09', referenceDate: refDate });
    assert.equal(res.level, RISK_LEVELS.LOW);
    assert.equal(res.isStale, false);
    assert.equal(res.daysSinceLastReport, 1);
  });

  await t.test('identifies aging data between 4 and 7 days', () => {
    const res = calculateDataFreshness({ latestPriceDate: '2026-10-05', referenceDate: refDate });
    assert.equal(res.level, RISK_LEVELS.MODERATE);
    assert.equal(res.isStale, true);
    assert.equal(res.daysSinceLastReport, 5);
  });

  await t.test('identifies stale data exceeding 7 days', () => {
    const res = calculateDataFreshness({ latestPriceDate: '2026-09-28', referenceDate: refDate });
    assert.equal(res.level, RISK_LEVELS.HIGH);
    assert.equal(res.isStale, true);
    assert.equal(res.daysSinceLastReport, 12);
  });
});

test('Risk Engine — Overall Classification Synthesis', async (t) => {
  await t.test('never classifies missing data as LOW risk', () => {
    const factors = {
      priceDecline: { level: RISK_LEVELS.UNKNOWN },
      volatility: { level: RISK_LEVELS.UNKNOWN },
      arrivalSurge: { level: RISK_LEVELS.UNKNOWN },
      forecastUncertainty: { level: RISK_LEVELS.UNKNOWN },
      dataFreshness: { level: RISK_LEVELS.LOW },
    };
    const res = classifyOverallRisk(factors);
    assert.notEqual(res.overallLevel, RISK_LEVELS.LOW);
    assert.equal(res.overallLevel, RISK_LEVELS.UNKNOWN);
  });

  await t.test('escalates to HIGH when severe price decline is projected', () => {
    const factors = {
      priceDecline: { level: RISK_LEVELS.HIGH },
      volatility: { level: RISK_LEVELS.LOW },
      arrivalSurge: { level: RISK_LEVELS.LOW },
      forecastUncertainty: { level: RISK_LEVELS.LOW },
      dataFreshness: { level: RISK_LEVELS.LOW },
    };
    const res = classifyOverallRisk(factors);
    assert.equal(res.overallLevel, RISK_LEVELS.HIGH);
    assert.ok(res.warnings.some((w) => w.code === 'PRICE_DROP_ALERT'));
  });

  await t.test('escalates to HIGH when supply glut is detected', () => {
    const factors = {
      priceDecline: { level: RISK_LEVELS.LOW },
      volatility: { level: RISK_LEVELS.LOW },
      arrivalSurge: { level: RISK_LEVELS.HIGH },
      forecastUncertainty: { level: RISK_LEVELS.LOW },
      dataFreshness: { level: RISK_LEVELS.LOW },
    };
    const res = classifyOverallRisk(factors);
    assert.equal(res.overallLevel, RISK_LEVELS.HIGH);
    assert.ok(res.warnings.some((w) => w.code === 'SUPPLY_GLUT'));
  });
});
