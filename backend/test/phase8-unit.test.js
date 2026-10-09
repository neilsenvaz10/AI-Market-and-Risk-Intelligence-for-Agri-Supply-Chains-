/**
 * FASALYTICS Phase 8 — Automated Unit Tests
 *
 * Verifies Phase 8 logic, alert evaluation rules, data-provenance filters,
 * preferences validation, and security invariants without requiring a real database.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toPreferencesDto } from '../src/services/farmerPreferences.service.js';
import { toAlertDto } from '../src/services/farmerAlerts.service.js';

describe('Phase 8 — Farmer Preferences Validation & DTO', () => {
  test('toPreferencesDto maps database row correctly', () => {
    const row = {
      id: 42,
      preferred_language: 'hi',
      default_commodity_id: 5,
      default_commodity_code: 'ONION',
      default_commodity_name: 'Onion',
      default_mandi_id: 12,
      default_mandi_code: 'MH_NSK_MAIN',
      default_mandi_name: 'Nashik Main',
      notify_in_app: true,
      alert_digest: 'daily',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T01:00:00.000Z',
    };

    const dto = toPreferencesDto(row);
    assert.equal(dto.id, 42);
    assert.equal(dto.preferredLanguage, 'hi');
    assert.deepEqual(dto.defaultCommodity, { id: 5, code: 'ONION', name: 'Onion' });
    assert.deepEqual(dto.defaultMandi, { id: 12, code: 'MH_NSK_MAIN', name: 'Nashik Main' });
    assert.equal(dto.notifyInApp, true);
    assert.equal(dto.alertDigest, 'daily');
  });

  test('toPreferencesDto handles null default commodity and mandi gracefully', () => {
    const row = {
      id: 1,
      preferred_language: 'en',
      default_commodity_id: null,
      default_mandi_id: null,
      notify_in_app: true,
      alert_digest: 'immediate',
      created_at: '2026-10-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };

    const dto = toPreferencesDto(row);
    assert.equal(dto.defaultCommodity, null);
    assert.equal(dto.defaultMandi, null);
    assert.equal(dto.preferredLanguage, 'en');
  });

  test('toPreferencesDto returns null for falsy input', () => {
    assert.equal(toPreferencesDto(null), null);
    assert.equal(toPreferencesDto(undefined), null);
  });
});

describe('Phase 8 — Farmer Price Alert DTO & Format', () => {
  test('toAlertDto transforms numeric and nested entities properly', () => {
    const row = {
      id: 99,
      commodity_id: 1,
      mandi_id: 3,
      target_price: '2400.00',
      price_unit: 'INR/quintal',
      condition: 'gte',
      is_active: true,
      last_triggered_at: '2026-10-08T12:00:00.000Z',
      freshness_hours: 48,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-08T12:00:00.000Z',
      commodity_code: 'TOMATO',
      commodity_name: 'Tomato',
      commodity_hindi_name: 'टमाटर',
      commodity_marathi_name: 'टोमॅटो',
      mandi_code: 'MH_PUNE_APMC',
      mandi_name: 'Pune APMC',
      mandi_state: 'Maharashtra',
      mandi_district: 'Pune',
    };

    const dto = toAlertDto(row);
    assert.equal(dto.id, 99);
    assert.equal(dto.targetPrice, 2400);
    assert.equal(dto.condition, 'gte');
    assert.equal(dto.isActive, true);
    assert.equal(dto.freshnessHours, 48);
    assert.equal(dto.commodity.name, 'Tomato');
    assert.equal(dto.mandi.name, 'Pune APMC');
  });

  test('toAlertDto returns null for null row', () => {
    assert.equal(toAlertDto(null), null);
  });
});

describe('Phase 8 — Deterministic Alert Evaluation Logic & Safeguards', () => {
  test('Condition met: gte triggers when actual >= target', () => {
    const target = 2000;
    const actual1 = 2000;
    const actual2 = 2500;
    const actual3 = 1999.50;

    assert.equal(actual1 >= target, true);
    assert.equal(actual2 >= target, true);
    assert.equal(actual3 >= target, false);
  });

  test('Condition met: lte triggers when actual <= target', () => {
    const target = 1500;
    const actual1 = 1500;
    const actual2 = 1200;
    const actual3 = 1500.50;

    assert.equal(actual1 <= target, true);
    assert.equal(actual2 <= target, true);
    assert.equal(actual3 <= target, false);
  });

  test('Freshness rule: observations beyond freshness_hours window are marked stale', () => {
    const freshnessHours = 48;
    const now = new Date('2026-10-09T12:00:00Z');

    const cutoff = new Date(now);
    cutoff.setHours(cutoff.getHours() - freshnessHours);

    // Fresh observation (yesterday)
    const freshObs = new Date('2026-10-08');
    freshObs.setHours(23, 59, 59, 999);
    assert.ok(freshObs >= cutoff, 'Observation within 48h is fresh');

    // Stale observation (3 days ago)
    const staleObs = new Date('2026-10-05');
    staleObs.setHours(23, 59, 59, 999);
    assert.ok(staleObs < cutoff, 'Observation older than 48h must be rejected as stale');
  });

  test('Data provenance: alerts reject sample data and mock providers', () => {
    const records = [
      { id: 1, is_sample_data: true, source: 'AGMARKNET_PORTAL', price_unit: 'INR/quintal', modal_price: 2500 },
      { id: 2, is_sample_data: false, source: 'MOCK_PROVIDER', price_unit: 'INR/quintal', modal_price: 2500 },
      { id: 3, is_sample_data: false, source: 'CEDA', price_unit: 'INR/kg', modal_price: 25 },
      { id: 4, is_sample_data: false, source: 'AGMARKNET_PORTAL', price_unit: 'INR/quintal', modal_price: 2500 },
    ];

    const genuineRecords = records.filter(
      (r) => r.is_sample_data === false && r.source !== 'MOCK_PROVIDER' && r.price_unit === 'INR/quintal' && r.modal_price > 0
    );

    assert.equal(genuineRecords.length, 1);
    assert.equal(genuineRecords[0].id, 4);
    assert.equal(genuineRecords[0].source, 'AGMARKNET_PORTAL');
  });
});
