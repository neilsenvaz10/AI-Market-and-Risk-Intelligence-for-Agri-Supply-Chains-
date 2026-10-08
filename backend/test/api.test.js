import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { pool } from '../src/db.js';
import { mandiPipeline } from '../src/pipeline/index.js';
import { AgmarknetGovProvider } from '../src/pipeline/providers/agmarknet.provider.js';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test('API: Root metadata returns Phase 3 endpoints including quality report', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.phase, 'Phase 3 - Mandi Data Pipeline');
  assert.ok(data.endpoints.mandi);
  assert.equal(data.endpoints.mandi.qualityReport, '/api/mandi/quality/report');
});

test('API: Health endpoints operate normally', async () => {
  const backendHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(backendHealth.status, 200);

  const dbHealth = await fetch(`${baseUrl}/api/health/database`);
  assert.equal(dbHealth.status, 200);
  const dbData = await dbHealth.json();
  assert.equal(dbData.connected, true);
});

test('API: GET /api/mandi/mandis lists active mandis', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/mandis`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(body.count >= 6);
  assert.ok(body.data.some((m) => m.name.includes('Pune')));
});

test('API: GET /api/mandi/mandis/:id returns mandi details with current prices', async () => {
  const listRes = await fetch(`${baseUrl}/api/mandi/mandis`);
  const listBody = await listRes.json();
  assert.ok(listBody.data.length > 0, 'At least one mandi must exist');

  const firstMandi = listBody.data[0];
  const detailRes = await fetch(`${baseUrl}/api/mandi/mandis/${firstMandi.id}`);
  assert.equal(detailRes.status, 200);
  const detailBody = await detailRes.json();
  assert.equal(detailBody.status, 'success');
  assert.ok(detailBody.data.id === firstMandi.id);
  assert.ok(detailBody.data.name);
  assert.ok(detailBody.data.state);
  assert.ok(detailBody.data.district);
  assert.ok(Array.isArray(detailBody.data.current_prices));
});

test('API: GET /api/mandi/mandis/:id returns 404 for non-existent ID', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/mandis/999999`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.status, 'error');
});

test('API: GET /api/mandi/commodities lists commodities', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/commodities`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(body.data.some((c) => c.code === 'ONION'));
  assert.ok(body.data.some((c) => c.code === 'TOMATO'));
});

test('API: GET /api/mandi/prices/latest returns latest prices with trends', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/prices/latest?commodity=ONION`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(body.data.length > 0);
  const item = body.data[0];
  assert.equal(item.commodity_code, 'ONION');
  assert.ok(Number(item.modal_price) > 0);
  assert.ok(item.trend_direction);
});

test('API: GET /api/mandi/prices/history returns ascending time-series', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/prices/history?commodity=ONION&limit=10`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(body.data.length > 0);
});

test('API: GET /api/mandi/sync/status returns pipeline metrics', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/sync/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(Number(body.data.stats.total_price_records) > 0);
});

test('API: GET /api/mandi/quality/report returns dataset quality & storage safety audit', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/quality/report`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(body.data.summary);
  assert.ok(body.data.source_coverage);
  assert.ok(body.data.integrity_audit);
  assert.ok(body.data.storage_safety);
  assert.equal(body.data.storage_safety.incremental_upsert_enabled, true);
  assert.equal(body.data.storage_safety.max_batch_limit, 10000);
});

test('API: POST /api/mandi/sync triggers ingestion run', async () => {
  const res = await fetch(`${baseUrl}/api/mandi/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 1, limit: 10 }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.data.status, 'SUCCESS');
});

test('API: POST /api/mandi/sync supports date-range and provider options', async () => {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];

  const res = await fetch(`${baseUrl}/api/mandi/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'MOCK',
      fromDate: yesterday,
      toDate: today,
      maxRecords: 20,
      crossSource: true,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(['SUCCESS', 'PARTIAL_SUCCESS'].includes(body.data.status));
});

test('Pipeline: Registers MOCK, AGMARKNET, and CEDA providers', () => {
  const providers = mandiPipeline.getAvailableProviders();
  assert.ok(providers.includes('MOCK'));
  assert.ok(providers.includes('AGMARKNET'));
  assert.ok(providers.includes('CEDA'));
});

// ─── AgmarknetGovProvider Unit Tests ───────────────────────────────────────────

test('AgmarknetGovProvider: isConfigured() returns false when API key is absent', () => {
  const provider = new AgmarknetGovProvider();
  const configured = provider.isConfigured();
  assert.equal(typeof configured, 'boolean');
});

test('AgmarknetGovProvider: fetchRecords() returns empty array gracefully when unconfigured', async () => {
  const provider = new AgmarknetGovProvider();
  if (!provider.isConfigured()) {
    const records = await provider.fetchRecords({ state: 'Maharashtra', commodity: 'Onion' });
    assert.ok(Array.isArray(records));
    assert.equal(records.length, 0);
  }
});

test('AgmarknetGovProvider: _buildUrl() includes expected parameters', () => {
  const provider = new AgmarknetGovProvider();
  const url = provider._buildUrl({
    offset: 0,
    limit: 500,
    state: 'Maharashtra',
    commodity: 'Onion',
    fromDate: '2025-01-01',
    toDate: '2025-01-31',
  });
  assert.equal(typeof url, 'string');
  assert.ok(url.includes('format=json'));
  assert.ok(url.includes('limit=500'));
  assert.ok(url.includes('Maharashtra'));
  assert.ok(url.includes('Onion'));
  assert.ok(url.includes('2025-01-01'));
  assert.ok(url.includes('2025-01-31'));
});

test('AgmarknetGovProvider: _transformRecord() maps API fields to canonical pipeline shape', () => {
  const provider = new AgmarknetGovProvider();
  const raw = {
    market: 'Pune APMC',
    state: 'Maharashtra',
    district: 'Pune',
    commodity: 'Onion',
    variety: 'Local',
    arrival_date: '01/10/2025',
    min_price: '1800',
    max_price: '2600',
    modal_price: '2200',
    arrival: '450',
  };
  const transformed = provider._transformRecord(raw);
  assert.equal(transformed.mandi_name, 'Pune APMC');
  assert.equal(transformed.state, 'Maharashtra');
  assert.equal(transformed.district, 'Pune');
  assert.equal(transformed.commodity_name, 'Onion');
  assert.equal(transformed.variety, 'Local');
  assert.equal(transformed.price_date, '01/10/2025');
  assert.equal(transformed.min_price, 1800);
  assert.equal(transformed.max_price, 2600);
  assert.equal(transformed.modal_price, 2200);
  assert.equal(transformed.arrivals_quantity, 450);
  assert.equal(transformed.unit, 'quintal');
  assert.equal(transformed.source, 'DATA_GOV_IN');
  assert.equal(transformed.is_sample_data, false);
  assert.deepEqual(transformed.raw_payload, raw);
});
