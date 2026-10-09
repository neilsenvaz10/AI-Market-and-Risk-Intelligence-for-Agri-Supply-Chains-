// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecommendationResultPage from '../src/pages/RecommendationResultPage';
import * as marketApiModule from '../src/services/marketApi';
import * as scenarioServiceModule from '../src/services/scenarioService';

// Mock AuthContext
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    language: 'en',
    farmer: {
      fullName: 'Suresh Patil',
      primaryCrop: 'ONION',
      cropQuantity: 1000,
      district: 'Pune',
      state: 'Maharashtra',
    },
  }),
}));

describe('Recommendation & What-If Scenario Simulator UI', () => {
  const fakeLatestPrices = {
    rows: [
      {
        observation_id: 259,
        market_code: 'MH_PUNE_APMC',
        mandi: 'Pune APMC (Gultekdi)',
        district: 'Pune',
        state: 'Maharashtra',
        modal_price: 1829.16,
        reported_date: '2026-09-30',
        arrival_quantity: 910.163,
        is_sample_data: true,
      },
      {
        observation_id: 439,
        market_code: 'MH_NSK_MAIN',
        mandi: 'Nashik Market Yard',
        district: 'Nashik',
        state: 'Maharashtra',
        modal_price: 1613.61,
        reported_date: '2026-09-30',
        arrival_quantity: 1136.919,
        is_sample_data: true,
      },
    ],
  };

  const fakeSimResponseWait2Days = {
    commodity: { id: 1, code: 'ONION', name: 'Onion' },
    mandi: { id: 22, code: 'MH_PUNE_APMC', name: 'Pune APMC (Gultekdi)' },
    quantityQuintals: 10,
    holdDays: 2,
    dataStatus: 'SYNTHETIC_SAMPLE',
    current: {
      modalPrice: 1829.16,
      priceReportedDate: '2026-09-30',
      grossRevenue: 18291.6,
      isSampleData: true,
    },
    forecast: {
      available: true,
      targetDate: '2026-10-02',
      horizonDays: 2,
      predictedModalPrice: 1725.43,
      lowerBound: 1658.68,
      upperBound: 1776.07,
      confidence: 73.34,
      model: 'phase4-fixture-v1',
      source: 'FIXTURE',
      isSampleData: true,
      grossRevenue: 17254.3,
      grossRevenueLower: 16586.8,
      grossRevenueUpper: 17760.7,
    },
    comparison: {
      grossRevenueDifference: -1037.3,
      percentageDifference: -5.67,
      calculationBasis: 'GROSS_REVENUE_ONLY',
      note: 'Gross revenue comparison only.',
    },
    risk: {
      available: true,
      overallLevel: 'MODERATE',
      summaryAdvice: 'Moderate price softening anticipated.',
    },
    warnings: [
      { code: 'SYNTHETIC_SAMPLE_DATA', message: 'Demo simulation — based on synthetic historical data.' },
    ],
  };

  const fakeSimResponseSellToday = {
    commodity: { id: 1, code: 'ONION', name: 'Onion' },
    mandi: { id: 22, code: 'MH_PUNE_APMC', name: 'Pune APMC (Gultekdi)' },
    quantityQuintals: 10,
    holdDays: 0,
    dataStatus: 'SYNTHETIC_SAMPLE',
    current: {
      modalPrice: 1829.16,
      priceReportedDate: '2026-09-30',
      grossRevenue: 18291.6,
    },
    forecast: {
      available: true,
      targetDate: '2026-09-30',
      horizonDays: 0,
      predictedModalPrice: 1829.16,
      lowerBound: 1829.16,
      upperBound: 1829.16,
      confidence: 100,
      grossRevenue: 18291.6,
    },
    comparison: {
      grossRevenueDifference: 0,
      percentageDifference: 0,
    },
    risk: {
      available: true,
      overallLevel: 'MODERATE',
      summaryAdvice: 'Moderate market risk.',
    },
    warnings: [],
  };

  beforeEach(() => {
    vi.spyOn(marketApiModule.marketApi, 'getLatestPrices').mockResolvedValue(fakeLatestPrices);
    vi.spyOn(scenarioServiceModule, 'simulateScenario').mockImplementation(({ holdDays }) => {
      if (holdDays === 0) return Promise.resolve(fakeSimResponseSellToday);
      return Promise.resolve(fakeSimResponseWait2Days);
    });
  });

  it('renders dynamic allocation plan and real modal prices', async () => {
    render(<RecommendationResultPage />);

    // Wait for price loading to complete
    await waitFor(() => {
      expect(screen.getByText(/Pune APMC/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Nashik Market Yard/i)).toBeInTheDocument();
    expect(screen.getByText(/600 kg/i)).toBeInTheDocument();
    expect(screen.getByText(/400 kg/i)).toBeInTheDocument();
  });

  it('opens What-If simulator modal and displays verified forecast data', async () => {
    render(<RecommendationResultPage />);

    await waitFor(() => {
      expect(screen.getByText(/What if\?/i)).toBeInTheDocument();
    });

    // Click "What if?" button
    fireEvent.click(screen.getByText(/What if\?/i));

    // Modal title should appear
    await waitFor(() => {
      expect(screen.getByText(/What if I wait to sell\?/i)).toBeInTheDocument();
    });

    // Verify simulation output
    await waitFor(() => {
      expect(screen.getByText(/2026-10-02/i)).toBeInTheDocument();
      expect(screen.getByText(/1,725.43/i)).toBeInTheDocument();
    });

    // Verify revenue difference display
    expect(screen.getByText(/-1,037/i)).toBeInTheDocument();

    // Verify synthetic demo warning banner is displayed
    expect(screen.getByText(/Demo simulation — based on synthetic historical data/i)).toBeInTheDocument();

    // Verify limitations note
    expect(screen.getByText(/Gross revenue estimates do not include storage costs/i)).toBeInTheDocument();
  });

  it('updates scenario when selecting Sell Today preset', async () => {
    render(<RecommendationResultPage />);

    await waitFor(() => {
      expect(screen.getByText(/What if\?/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/What if\?/i));

    await waitFor(() => {
      expect(screen.getByText(/Sell Today/i)).toBeInTheDocument();
    });

    // Click "Sell Today" button
    fireEvent.click(screen.getByText(/Sell Today/i));

    await waitFor(() => {
      expect(scenarioServiceModule.simulateScenario).toHaveBeenCalledWith(
        expect.objectContaining({ holdDays: 0 })
      );
    });
  });
});
