import test from 'node:test';
import assert from 'node:assert/strict';
import mandiPipeline from '../src/pipeline/index.js';
import mandiService from '../src/services/mandi.service.js';
import { pool } from '../src/db.js';

test('Pipeline & DB Integration: executes full ingestion flow idempotently', async () => {
  const result = await mandiPipeline.runPipeline({ days: 3, limit: 30 });

  assert.equal(result.status, 'SUCCESS');
  assert.ok(result.records_fetched > 0);
  assert.equal(result.records_valid, result.records_fetched);
  assert.equal(result.records_rejected, 0);

  // Verify records in PostgreSQL
  const dbStatus = await mandiService.getPipelineStatus();
  assert.ok(Number(dbStatus.stats.total_price_records) > 0);
  assert.ok(Number(dbStatus.stats.total_mandis) >= 6);
  assert.ok(Number(dbStatus.stats.total_commodities) >= 6);

  // Run pipeline second time to verify deduplication / update idempotency
  const secondResult = await mandiPipeline.runPipeline({ days: 3, limit: 30 });
  assert.equal(secondResult.status, 'SUCCESS');
  assert.equal(secondResult.records_inserted, 0);
  assert.ok(secondResult.records_updated > 0);
});

test('Pipeline & DB Integration: queries latest prices and price trends correctly', async () => {
  const latestOnion = await mandiService.getLatestPrices({ commodity: 'ONION' });

  assert.ok(Array.isArray(latestOnion));
  assert.ok(latestOnion.length > 0);

  const sample = latestOnion[0];
  assert.ok(sample.mandi_name);
  assert.ok(Number(sample.modal_price) > 0);
  assert.ok(sample.price_date);
  assert.ok(sample.trend_direction);
  assert.equal(typeof sample.trend_percent, 'number');
});

test('Pipeline & DB Integration: queries historical price time series for forecasting', async () => {
  const history = await mandiService.getPriceHistory({ commodity: 'ONION', limit: 20 });

  assert.ok(Array.isArray(history));
  assert.ok(history.length > 0);

  // Time series should be in ascending date order
  for (let i = 1; i < history.length; i++) {
    const prevDate = new Date(history[i - 1].price_date).getTime();
    const currDate = new Date(history[i].price_date).getTime();
    assert.ok(currDate >= prevDate);
  }
});
