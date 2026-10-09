// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import RiskBadge from '../src/components/RiskBadge';
import RiskCard from '../src/components/RiskCard';
import RiskDashboardPage from '../src/pages/RiskDashboardPage';
import * as api from '../src/services/api';

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ language: 'en' }),
}));

vi.mock('../src/services/api', () => ({
  getMandis: vi.fn(),
  getCommodities: vi.fn(),
  getMandiRisk: vi.fn(),
  getRiskSummary: vi.fn(),
}));

describe('Phase 6 — Agricultural Risk Intelligence Frontend', () => {
  afterEach(cleanup);

  it('renders RiskBadge with appropriate labels and visual styles', () => {
    const { rerender } = render(<RiskBadge level="LOW" />);
    expect(screen.getByText('Low Risk')).toBeTruthy();

    rerender(<RiskBadge level="MODERATE" />);
    expect(screen.getByText('Moderate Risk')).toBeTruthy();

    rerender(<RiskBadge level="HIGH" />);
    expect(screen.getByText('High Risk')).toBeTruthy();

    rerender(<RiskBadge level="UNKNOWN" />);
    expect(screen.getByText('Unknown Risk')).toBeTruthy();
  });

  it('renders RiskCard with factor explanation and metric chips', () => {
    const factor = {
      level: 'MODERATE',
      explanation: 'Prices expected to decline moderately by 5%.',
      evidence: { drop: '5%', worstHorizon: 2 },
    };
    render(
      <RiskCard
        titleKey="risk.priceDecline"
        icon="trending_down"
        factor={factor}
        metrics={[{ label: 'Projected Drop', value: '5%' }]}
      />
    );

    expect(screen.getByText('Price Decline Risk')).toBeTruthy();
    expect(screen.getByText('Moderate Risk')).toBeTruthy();
    expect(screen.getByText('Prices expected to decline moderately by 5%.')).toBeTruthy();
    expect(screen.getByText('Projected Drop')).toBeTruthy();
    expect(screen.getByText('5%')).toBeTruthy();
  });

  it('renders complete RiskDashboardPage with overall assessment and factor cards', async () => {
    api.getCommodities.mockResolvedValue({
      data: [{ id: 1, code: 'ONION', name: 'Onion' }],
    });
    api.getMandis.mockResolvedValue({
      data: [{ id: 10, code: 'MH_NSK_MAIN', name: 'Nashik APMC', district: 'Nashik' }],
    });

    api.getMandiRisk.mockResolvedValue({
      commodity: { id: 1, code: 'ONION', name: 'Onion' },
      mandi: { id: 10, code: 'MH_NSK_MAIN', name: 'Nashik APMC' },
      overallLevel: 'HIGH',
      summaryAdvice: 'Elevated market risk: adverse price pressures or large incoming arrivals detected.',
      latestPrice: 1850,
      latestPriceDate: '2026-10-09',
      evaluatedAt: '2026-10-09T07:00:00.000Z',
      warnings: [
        { code: 'PRICE_DROP_ALERT', severity: 'HIGH', message: 'Predicted multi-day price decline.' },
      ],
      breakdown: {
        priceDecline: {
          level: 'HIGH',
          explanation: 'Severe price drop projected.',
          evidence: { maxDropPercent: 12.5, worstHorizonDays: 3 },
        },
        volatility: {
          level: 'MODERATE',
          explanation: 'Moderate historical volatility.',
          evidence: { cvPercent: 8.2 },
        },
        arrivalSurge: {
          level: 'LOW',
          explanation: 'Arrival volume is normal.',
          evidence: { surgeRatio: 1.05 },
        },
        forecastUncertainty: {
          level: 'LOW',
          explanation: 'Narrow prediction intervals.',
          evidence: { avgIntervalWidthPercent: 8.5 },
        },
        dataFreshness: {
          level: 'LOW',
          isStale: false,
          explanation: 'Data is fresh.',
          evidence: { daysSinceLastReport: 0 },
        },
      },
    });

    api.getRiskSummary.mockResolvedValue({
      counts: { HIGH: 1, MODERATE: 0, LOW: 0, UNKNOWN: 0 },
      series: [
        {
          commodity: { code: 'ONION', name: 'Onion' },
          mandi: { code: 'MH_NSK_MAIN', name: 'Nashik APMC' },
          overallLevel: 'HIGH',
          latestPrice: 1850,
        },
      ],
    });

    render(<RiskDashboardPage />);

    // Wait for data load
    await waitFor(() => {
      expect(screen.getByText('Elevated market risk: adverse price pressures or large incoming arrivals detected.')).toBeTruthy();
    });

    // Check overall risk card
    expect(screen.getAllByText('High Risk').length).toBeGreaterThan(0);
    expect(screen.getByText('Predicted multi-day price decline.')).toBeTruthy();

    // Check factor titles
    expect(screen.getByText('Price Decline Risk')).toBeTruthy();
    expect(screen.getByText('Historical Volatility')).toBeTruthy();
    expect(screen.getByText('Market Arrival Surge')).toBeTruthy();
    expect(screen.getByText('Forecast Uncertainty')).toBeTruthy();
    expect(screen.getByText('Data Freshness')).toBeTruthy();
  });
});
