import { describe, it, expect } from 'vitest';
import {
  estimateDistanceKm,
  calculateFreightPerQuintal,
  evaluateMandiAllocation,
  generatePlanReasons,
} from '../src/utils/mandiOptimizer';

describe('Mandi Optimizer & Logistics Logic', () => {
  it('estimates local distance as 25 km and inter-district distances correctly', () => {
    expect(estimateDistanceKm('Pune', 'Pune')).toBe(25);
    expect(estimateDistanceKm('Pune', 'Ahmednagar')).toBe(122);
    expect(estimateDistanceKm('Pune', 'Nashik')).toBe(212);
    expect(estimateDistanceKm('Pune', 'UnknownDistrict')).toBe(140);
  });

  it('calculates freight per quintal with base loading + transit rate', () => {
    // 25 km: 80 + 25 * 1.35 = 113.75
    expect(calculateFreightPerQuintal(25)).toBe(113.75);
    // 122 km: 80 + 122 * 1.35 = 244.7
    expect(calculateFreightPerQuintal(122)).toBe(244.7);
  });

  it('evaluates single mandi vs 60/40 split allocation with verifiable returns', () => {
    const candidates = [
      {
        id: 22,
        market_code: 'MH_PUNE_APMC',
        mandi: 'Pune APMC',
        district: 'Pune',
        modal_price: 2000,
        reported_date: '2026-09-30',
        is_sample_data: false,
      },
      {
        id: 23,
        market_code: 'MH_NSK_MAIN',
        mandi: 'Nashik Market Yard',
        district: 'Nashik',
        modal_price: 2200,
        reported_date: '2026-09-30',
        is_sample_data: false,
      },
    ];

    const result = evaluateMandiAllocation({
      quantityKg: 1000,
      candidateMandis: candidates,
      farmerDistrict: 'Pune',
    });

    expect(result.hasMandis).toBe(true);
    expect(result.totalKg).toBe(1000);
    expect(result.totalQuintals).toBe(10);

    // Pune net: 2000 - 113.75 = 1886.25
    // Nashik net: 2200 - (80 + 212 * 1.35 = 366.2) = 1833.8
    // Pune yields higher net price despite lower nominal modal price!
    expect(result.singleMandi.name).toBe('Pune APMC');
    expect(result.singleMandi.netPricePerQuintal).toBe(1886.25);

    // Split plan: 60% Pune (6 quintals) + 40% Nashik (4 quintals)
    const split = result.splitAllocation;
    expect(split.isSplitViable).toBe(true);
    expect(split.mandis.length).toBe(2);
    expect(split.mandis[0].quantityKg).toBe(600);
    expect(split.mandis[1].quantityKg).toBe(400);

    expect(split.totalGross).toBe(6 * 2000 + 4 * 2200); // 12000 + 8800 = 20800
    expect(split.totalFreight).toBe(Math.round(6 * 113.75) + Math.round(4 * 366.2)); // 683 + 1465 = 2148
  });

  it('generates transparent data-grounded rationale reasons', () => {
    const candidates = [
      {
        id: 22,
        market_code: 'MH_PUNE_APMC',
        mandi: 'Pune APMC',
        district: 'Pune',
        modal_price: 2000,
        reported_date: '2026-09-30',
        is_sample_data: false,
      },
      {
        id: 23,
        market_code: 'MH_NSK_MAIN',
        mandi: 'Nashik Market Yard',
        district: 'Nashik',
        modal_price: 1900,
        reported_date: '2026-09-30',
        is_sample_data: false,
      },
    ];

    const result = evaluateMandiAllocation({
      quantityKg: 1000,
      candidateMandis: candidates,
      farmerDistrict: 'Pune',
    });

    const reasons = generatePlanReasons({
      bestSingle: result.singleMandi,
      splitPlan: result.splitAllocation,
      totalKg: 1000,
      farmerDistrict: 'Pune',
    });

    expect(reasons.length).toBeGreaterThanOrEqual(3);
    expect(reasons[0].text).toContain('Pune APMC');
    expect(reasons[0].text).toContain('net yield');
    expect(reasons.some((r) => r.id === 'risk_hedging')).toBe(true);
  });
});
