import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { ScenarioService } from '../src/services/scenario.service.js';
import { createScenarioController } from '../src/controllers/scenario.controller.js';
import { createScenarioRoutes } from '../src/routes/scenario.routes.js';
import { createOptionalAuth } from '../src/middleware/optionalAuth.js';

test('Scenario API — HTTP Endpoints', async (t) => {
  const fakeCommodity = { id: 1, code: 'ONION', name: 'Onion', category: 'Vegetables' };
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
              predicted_price: 2150,
              lower_bound: 2050,
              upper_bound: 2250,
              confidence: 78,
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
    async getMandiRisk() {
      return {
        overallLevel: 'LOW',
        summaryAdvice: 'Stable risk environment.',
        warnings: [],
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
              source: 'CEDA',
              is_sample_data: false,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const scenarioService = new ScenarioService({
    pool: fakePool,
    forecastService: fakeForecastService,
    riskService: fakeRiskService,
  });

  const scenarioController = createScenarioController({ scenarioService });
  const scenarioRoutes = createScenarioRoutes({
    controller: scenarioController,
    optionalAuth: createOptionalAuth(() => Promise.reject(new Error('no auth in test'))),
  });

  const app = createApp({
    scenarioRoutesOptions: {
      controller: scenarioController,
      optionalAuth: createOptionalAuth(() => Promise.reject(new Error('no auth'))),
    },
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test('POST /api/scenarios/simulate calculates 2-day holding projection', async () => {
    const res = await fetch(`${baseUrl}/api/scenarios/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commodity: 'ONION',
        mandiId: 'MH_PUNE_APMC',
        quantityQuintals: 10,
        holdDays: 2,
        includeRisk: true,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'success');
    assert.equal(body.data.commodity.code, 'ONION');
    assert.equal(body.data.mandi.code, 'MH_PUNE_APMC');
    assert.equal(body.data.current.modalPrice, 2000);
    assert.equal(body.data.current.grossRevenue, 20000);
    assert.equal(body.data.forecast.predictedModalPrice, 2150);
    assert.equal(body.data.forecast.grossRevenue, 21500);
    assert.equal(body.data.comparison.grossRevenueDifference, 1500);
    assert.equal(body.data.comparison.percentageDifference, 7.5);
    assert.equal(body.data.risk.overallLevel, 'LOW');
    assert.equal(body.data.dataStatus, 'VERIFIED_OBSERVATION');
  });

  await t.test('POST /api/scenarios/simulate rejects holdDays > 7 with 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${baseUrl}/api/scenarios/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commodity: 'ONION',
        mandiId: 'MH_PUNE_APMC',
        holdDays: 10,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'VALIDATION_ERROR');
  });

  await t.test('POST /api/scenarios/simulate returns 404 for unknown commodity', async () => {
    const res = await fetch(`${baseUrl}/api/scenarios/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commodity: 'NONEXISTENT_CROP',
        mandiId: 'MH_PUNE_APMC',
        holdDays: 2,
      }),
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'COMMODITY_NOT_FOUND');
  });
});
