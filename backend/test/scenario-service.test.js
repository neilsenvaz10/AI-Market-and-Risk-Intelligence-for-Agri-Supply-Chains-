import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioService } from '../src/services/scenario.service.js';

test('Scenario Service — Business Logic & Calculations', async (t) => {
  const fakeCommodity = { id: 1, code: 'ONION', name: 'Onion', hindi_name: 'प्याज', marathi_name: 'कांदा', category: 'Vegetables' };
  const fakeMandi = { id: 22, code: 'MH_PUNE_APMC', name: 'Pune APMC', state: 'Maharashtra', district: 'Pune' };

  const fakeForecastService = {
    async resolveCommodity(code) {
      if (String(code).toUpperCase() === 'ONION') return fakeCommodity;
      return null;
    },
    async resolveMandi(code) {
      if (String(code).toUpperCase() === 'MH_PUNE_APMC' || code === 22) return fakeMandi;
      return null;
    },
    async getForecast({ horizon }) {
      if (horizon === 2) {
        return {
          rows: [
            {
              forecast_date: '2026-10-03',
              horizon_days: 2,
              predicted_price: 2100,
              lower_bound: 2000,
              upper_bound: 2200,
              confidence: 80,
              model_version: 'test-model-v1',
              data_source: 'DATABASE',
              is_sample_data: false,
            },
          ],
        };
      }
      if (horizon === 7) {
        return {
          rows: [
            {
              forecast_date: '2026-10-08',
              horizon_days: 7,
              predicted_price: 2300,
              lower_bound: 2100,
              upper_bound: 2500,
              confidence: 65,
              model_version: 'test-model-v1',
              data_source: 'DATABASE',
              is_sample_data: false,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const fakeRiskService = {
    async getMandiRisk({ commodity, mandi }) {
      return {
        overallLevel: 'LOW',
        summaryAdvice: 'Market conditions are stable with low volatility.',
        warnings: [],
        breakdown: { volatility: { level: 'LOW' } },
      };
    },
  };

  const fakePool = {
    async query(sql) {
      if (sql.includes('FROM mandi_prices_canonical')) {
        return {
          rows: [
            {
              observation_id: 101,
              reported_date: '2026-10-01',
              modal_price: 2000,
              minimum_price: 1900,
              maximum_price: 2100,
              normalized_price_unit: 'INR/quintal',
              source: 'CEDA',
              source_label: 'CEDA, Ashoka University',
              is_sample_data: false,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const service = new ScenarioService({
    pool: fakePool,
    forecastService: fakeForecastService,
    riskService: fakeRiskService,
  });

  await t.test('1. Sell today (holdDays=0) uses current observation price and zero difference', async () => {
    const res = await service.simulate({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityQuintals: 10,
      holdDays: 0,
      includeRisk: true,
    });

    assert.equal(res.current.modalPrice, 2000);
    assert.equal(res.current.grossRevenue, 20000);
    assert.equal(res.forecast.horizonDays, 0);
    assert.equal(res.forecast.predictedModalPrice, 2000);
    assert.equal(res.forecast.grossRevenue, 20000);
    assert.equal(res.comparison.grossRevenueDifference, 0);
    assert.equal(res.comparison.percentageDifference, 0);
    assert.equal(res.dataStatus, 'VERIFIED_OBSERVATION');
  });

  await t.test('2. Wait 2 days uses actual 2-day forecast, computes gross revenue and range', async () => {
    const res = await service.simulate({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityQuintals: 10,
      holdDays: 2,
      includeRisk: true,
    });

    assert.equal(res.current.modalPrice, 2000);
    assert.equal(res.current.grossRevenue, 20000);
    assert.equal(res.forecast.horizonDays, 2);
    assert.equal(res.forecast.targetDate, '2026-10-03');
    assert.equal(res.forecast.predictedModalPrice, 2100);
    assert.equal(res.forecast.lowerBound, 2000);
    assert.equal(res.forecast.upperBound, 2200);
    assert.equal(res.forecast.grossRevenue, 21000);
    assert.equal(res.forecast.grossRevenueLower, 20000);
    assert.equal(res.forecast.grossRevenueUpper, 22000);
    assert.equal(res.comparison.grossRevenueDifference, 1000);
    assert.equal(res.comparison.percentageDifference, 5);
    assert.equal(res.risk.overallLevel, 'LOW');
  });

  await t.test('3. Wait 7 days uses actual 7-day forecast', async () => {
    const res = await service.simulate({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityQuintals: 10,
      holdDays: 7,
      includeRisk: true,
    });

    assert.equal(res.forecast.horizonDays, 7);
    assert.equal(res.forecast.predictedModalPrice, 2300);
    assert.equal(res.forecast.grossRevenue, 23000);
    assert.equal(res.comparison.grossRevenueDifference, 3000);
    assert.equal(res.comparison.percentageDifference, 15);
  });

  await t.test('4. Gracefully handles missing forecast for horizon without fabricating numbers', async () => {
    const res = await service.simulate({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityQuintals: 10,
      holdDays: 5, // Horizon 5 not in fakeForecastService
      includeRisk: true,
    });

    assert.equal(res.forecast.available, false);
    assert.equal(res.forecast.predictedModalPrice, null);
    assert.equal(res.comparison.grossRevenueDifference, null);
    assert.ok(res.warnings.some((w) => w.code === 'NO_FORECAST'));
  });

  await t.test('5. Flags synthetic fixtures with SYNTHETIC_SAMPLE provenance and demo warning', async () => {
    const fixtureForecastService = {
      ...fakeForecastService,
      async getForecast() {
        return {
          rows: [
            {
              forecast_date: '2026-10-03',
              horizon_days: 2,
              predicted_price: 2100,
              confidence: 80,
              data_source: 'FIXTURE',
              is_sample_data: true,
            },
          ],
        };
      },
    };

    const fixtureService = new ScenarioService({
      pool: fakePool,
      forecastService: fixtureForecastService,
      riskService: fakeRiskService,
    });

    const res = await fixtureService.simulate({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityQuintals: 10,
      holdDays: 2,
    });

    assert.equal(res.dataStatus, 'SYNTHETIC_SAMPLE');
    assert.ok(res.warnings.some((w) => w.code === 'SYNTHETIC_SAMPLE_DATA'));
  });

  await t.test('6. Computes documented storage cost assumption if provided', async () => {
    const res = await service.simulate({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityQuintals: 10,
      holdDays: 2,
      documentedStorageCostPerDay: 15, // 15 INR/q/day * 2 days * 10 q = 300 INR
    });

    assert.equal(res.comparison.grossRevenueDifference, 1000);
    assert.equal(res.comparison.documentedStorageCost, 300);
    assert.equal(res.comparison.assumedStorageAdjustedDifference, 700);
  });

  await t.test('7. Handles missing risk service gracefully without throwing', async () => {
    const failingRiskService = {
      async getMandiRisk() {
        throw new Error('Risk model unavailable');
      },
    };

    const safeService = new ScenarioService({
      pool: fakePool,
      forecastService: fakeForecastService,
      riskService: failingRiskService,
    });

    const res = await safeService.simulate({
      commodity: 'ONION',
      mandiId: 'MH_PUNE_APMC',
      quantityQuintals: 10,
      holdDays: 2,
    });

    assert.equal(res.risk.available, false);
    assert.ok(res.risk.explanation.includes('Risk evaluation unavailable'));
  });

  await t.test('8. Evaluates multi-mandi allocation plan', async () => {
    const res = await service.simulate({
      commodity: 'ONION',
      holdDays: 2,
      allocations: [
        { mandiId: 'MH_PUNE_APMC', quantityQuintals: 6 },
        { mandiId: 'MH_PUNE_APMC', quantityQuintals: 4 },
      ],
    });

    assert.equal(res.type, 'MULTI_MANDI_PLAN');
    assert.equal(res.totalQuantityQuintals, 10);
    assert.equal(res.summary.totalCurrentGrossRevenue, 20000);
    assert.equal(res.summary.totalForecastGrossRevenue, 21000);
    assert.equal(res.summary.totalGrossRevenueDifference, 1000);
    assert.equal(res.isPlanComplete, true);
  });
});
