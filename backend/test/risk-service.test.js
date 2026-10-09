import test from 'node:test';
import assert from 'node:assert/strict';
import { RiskService } from '../src/services/risk.service.js';

test('Risk Service — Mock Database Integration', async (t) => {
  const mockCommodity = { id: 1, code: 'ONION', name: 'Onion' };
  const mockMandi = { id: 10, code: 'MH_NSK_MAIN', name: 'Nashik APMC' };

  await t.test('throws 404 when commodity is not found', async () => {
    const fakePool = {
      async query(sql, params) {
        if (sql.includes('FROM commodities')) return { rows: [] };
        if (sql.includes('FROM mandis')) return { rows: [mockMandi] };
        return { rows: [] };
      },
    };
    const service = new RiskService({ pool: fakePool });
    await assert.rejects(
      async () => service.getMandiRisk({ commodity: 'UNKNOWN_CROP', mandi: 'MH_NSK_MAIN' }),
      (err) => err.code === 'COMMODITY_NOT_FOUND' && err.statusCode === 404
    );
  });

  await t.test('throws 404 when mandi is not found', async () => {
    const fakePool = {
      async query(sql, params) {
        if (sql.includes('FROM commodities')) return { rows: [mockCommodity] };
        if (sql.includes('FROM mandis')) return { rows: [] };
        return { rows: [] };
      },
    };
    const service = new RiskService({ pool: fakePool });
    await assert.rejects(
      async () => service.getMandiRisk({ commodity: 'ONION', mandi: 'UNKNOWN_MANDI' }),
      (err) => err.code === 'MANDI_NOT_FOUND' && err.statusCode === 404
    );
  });

  await t.test('queries genuine prices and forecasts and returns complete risk profile', async () => {
    const fakePrices = [
      { price_date: '2026-10-01', modal_price: 2000, arrivals_quantity: 100, is_sample_data: false, source: 'CEDA' },
      { price_date: '2026-10-02', modal_price: 2020, arrivals_quantity: 105, is_sample_data: false, source: 'CEDA' },
      { price_date: '2026-10-03', modal_price: 2010, arrivals_quantity: 98, is_sample_data: false, source: 'CEDA' },
      { price_date: '2026-10-04', modal_price: 2005, arrivals_quantity: 102, is_sample_data: false, source: 'CEDA' },
      { price_date: '2026-10-05', modal_price: 2000, arrivals_quantity: 100, is_sample_data: false, source: 'CEDA' },
    ];
    const fakeForecasts = [
      { horizon_days: 1, predicted_price: 2010, lower_bound: 1960, upper_bound: 2060, confidence: 85, is_sample_data: false, data_source: 'DATABASE' },
      { horizon_days: 2, predicted_price: 2025, lower_bound: 1970, upper_bound: 2080, confidence: 82, is_sample_data: false, data_source: 'DATABASE' },
    ];

    const fakePool = {
      async query(sql, params) {
        if (sql.includes('FROM commodities')) return { rows: [mockCommodity] };
        if (sql.includes('FROM mandis')) return { rows: [mockMandi] };
        if (sql.includes('FROM mandi_prices')) {
          // Assert that sample data and MOCK_PROVIDER are excluded by default
          assert.ok(sql.includes("is_sample_data = FALSE AND source != 'MOCK_PROVIDER'"));
          return { rows: fakePrices };
        }
        if (sql.includes('FROM forecasts')) {
          assert.ok(sql.includes("f.is_sample_data = FALSE AND f.data_source != 'FIXTURE'"));
          return { rows: fakeForecasts };
        }
        return { rows: [] };
      },
    };

    const service = new RiskService({ pool: fakePool });
    const result = await service.getMandiRisk({
      commodity: 'ONION',
      mandi: 'MH_NSK_MAIN',
      referenceDate: '2026-10-06',
    });

    assert.equal(result.commodity.code, 'ONION');
    assert.equal(result.mandi.code, 'MH_NSK_MAIN');
    assert.equal(result.overallLevel, 'LOW');
    assert.equal(result.breakdown.priceDecline.level, 'LOW');
    assert.equal(result.breakdown.volatility.level, 'LOW');
    assert.equal(result.breakdown.arrivalSurge.level, 'LOW');
    assert.equal(result.breakdown.forecastUncertainty.level, 'LOW');
    assert.equal(result.breakdown.dataFreshness.level, 'LOW');
    assert.equal(result.meta.dataFilteredForGenuine, true);
  });
});
