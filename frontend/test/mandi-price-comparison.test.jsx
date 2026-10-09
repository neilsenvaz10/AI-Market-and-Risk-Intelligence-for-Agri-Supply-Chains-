// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import MandiPriceComparison from '../src/components/MandiPriceComparison';
import { buildComparison, labelFor } from '../src/utils/priceComparison';
import { shapePriceRow, marketApi } from '../src/services/marketApi';
import { t } from '../src/i18n/strings';

vi.mock('../src/services/marketApi', async (original) => {
  const actual = await original();
  return { ...actual, marketApi: { ...actual.marketApi, getLatestPrices: vi.fn() } };
});

const NOW = new Date('2026-10-09T06:00:00Z');
let n = 0;
const raw = (over = {}) => ({
  observation_id: ++n, commodity_id: 1, commodity_code: 'ONION', commodity: 'Onion', mandi_id: n, market_code: `M${n}`,
  mandi: `Mandi ${n}`, district: 'Nashik', state: 'Maharashtra', variety: 'Red', grade: 'FAQ', reported_date: '2026-10-08',
  minimum_price: '1000', modal_price: '1500', maximum_price: '1800', normalized_price_unit: 'INR/quintal', original_price_unit: 'Rs./Quintal',
  source: 'AGMARKNET', source_label: 'Agmarknet', is_sample_data: false, quality_status: 'VALID', ...over,
});
const row = (over) => shapePriceRow(raw(over));
const feed = (...rows) => marketApi.getLatestPrices.mockResolvedValue({ rows: rows.map((r) => (r.raw ? r : shapePriceRow(r))), meta: null });
const show = (props = {}) => render(<MemoryRouter><MandiPriceComparison language="en" now={NOW} {...props} /></MemoryRouter>);
const EMPTY = 'No verified mandi prices are currently available for this crop.';

beforeEach(() => { n = 0; marketApi.getLatestPrices.mockReset(); });
afterEach(cleanup);

describe('MandiPriceComparison component', () => {
  it('shows the new heading and no profit wording at all', async () => {
    feed(raw({ modal_price: '1650' }), raw({ modal_price: '1600' }));
    const { container } = show();
    await screen.findAllByTestId('mpc-row');
    expect(screen.getByRole('heading', { name: 'Mandi Price Comparison' })).toBeTruthy();
    const text = container.textContent;
    for (const banned of [/net profit/i, /net return/i, /expected (net )?(profit|return)/i, /top profit/i, /\+₹[\d,]+ higher profit/i, /\bLive\b/, /Trans:/i, /Harvest Quantity/i]) {
      expect(text).not.toMatch(banned);
    }
  });

  it('displays real price, unit, reported date and source from the feed', async () => {
    feed(raw({ mandi: 'Lasalgaon APMC', modal_price: '1650', reported_date: '2026-10-08', source_label: 'Agmarknet' }));
    show();
    const r = await screen.findByTestId('mpc-row');
    expect(within(r).getByText(/Lasalgaon APMC/)).toBeTruthy();
    expect(within(r).getByText('₹1,650 / quintal')).toBeTruthy();
    expect(within(r).getByText(/Reported 8 Oct 2026/)).toBeTruthy();
    expect(within(r).getByText(/Source: Agmarknet/)).toBeTruthy();
    expect(within(r).getByText('Verified observation')).toBeTruthy();
    expect(marketApi.getLatestPrices).toHaveBeenCalledWith(expect.objectContaining({ commodityCode: 'ONION' }), expect.anything());
  });

  it('shows the honest empty state when there are no prices, and never invents any', async () => {
    feed();
    const { container } = show();
    await screen.findByText(EMPTY);
    expect(screen.getByText('Data unavailable')).toBeTruthy();
    expect(screen.queryAllByTestId('mpc-row')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/₹/);
  });

  it('request failure also shows the empty state, not fallback prices', async () => {
    marketApi.getLatestPrices.mockRejectedValue(new Error('down'));
    const { container } = show();
    await screen.findByText(EMPTY);
    expect(container.textContent).toContain(t('en', 'mpc.error'));
    expect(container.textContent).not.toMatch(/₹/);
  });

  it('former hardcoded prices (e.g. Soybean 4650) never appear when the feed is empty', async () => {
    feed();
    const { container } = show({ farmer: { primaryCrop: 'Soybean' } });
    await screen.findByText(EMPTY);
    expect(container.textContent).not.toMatch(/4,?650|4,?580|4,?520|2,?450|2,?000/);
    expect(marketApi.getLatestPrices).toHaveBeenCalledWith(expect.objectContaining({ commodityCode: 'SOYBEAN' }), expect.anything());
  });

  it('a row with a missing modal price is dropped, never turned into 2000', async () => {
    feed(raw({ modal_price: null }), raw({ modal_price: '0' }));
    const { container } = show();
    await screen.findByText(EMPTY);
    expect(container.textContent).not.toMatch(/2,?000/);
  });

  it('sample/synthetic/fixture/mock rows are never shown as prices or called verified', async () => {
    feed(raw({ is_sample_data: true, modal_price: '7777' }), raw({ source: 'FIXTURE_PROVIDER', source_label: 'Fixture', modal_price: '8888' }), raw({ source: 'MOCK', source_label: 'Mock', modal_price: '9999' }));
    const { container } = show();
    await screen.findByText(EMPTY);
    expect(container.textContent).not.toMatch(/7,?777|8,?888|9,?999/);
    expect(screen.queryByText('Verified observation')).toBeNull();
    expect(screen.getByText('Sample data')).toBeTruthy();
  });

  it('a row without a source, date or the canonical unit is not displayed', async () => {
    feed(raw({ source: null, source_label: null }), raw({ reported_date: null }), raw({ normalized_price_unit: 'INR/kg' }));
    show();
    await screen.findByText(EMPTY);
  });

  it('old genuine observations are labelled historical, not verified or live', async () => {
    feed(raw({ reported_date: '2026-09-01' }));
    show();
    const r = await screen.findByTestId('mpc-row');
    expect(within(r).getByText('Historical observation')).toBeTruthy();
    expect(within(r).queryByText('Verified observation')).toBeNull();
  });

  it('comparable observations are ranked by price, the top one is labelled without claiming profit', async () => {
    feed(raw({ mandi: 'Low', modal_price: '1500' }), raw({ mandi: 'High', modal_price: '1700' }), raw({ mandi: 'Mid', modal_price: '1600' }));
    const { container } = show();
    const rows = await screen.findAllByTestId('mpc-row');
    expect(rows.map((r) => r.textContent.match(/High|Mid|Low/)[0])).toEqual(['High', 'Mid', 'Low']);
    expect(within(rows[0]).getByText('Highest reported modal price')).toBeTruthy();
    expect(screen.getAllByText('Highest reported modal price')).toHaveLength(1);
    expect(container.textContent).toContain(t('en', 'mpc.notProfit'));
    expect(container.textContent).not.toMatch(/most profitable|best profit|recommend/i);
  });

  it('differing grades/varieties/dates are listed without a ranking or a top label', async () => {
    feed(raw({ mandi: 'A', modal_price: '1000', grade: 'FAQ' }), raw({ mandi: 'B', modal_price: '2000', grade: 'A' }), raw({ mandi: 'C', modal_price: '3000', reported_date: '2026-10-07' }));
    const { container } = show();
    const rows = await screen.findAllByTestId('mpc-row');
    expect(rows).toHaveLength(3);
    expect(screen.queryByText('Highest reported modal price')).toBeNull();
    expect(container.textContent).toContain(t('en', 'mpc.notComparable'));
    // order is by report date then name, not by price
    expect(rows.map((r) => r.textContent.match(/\b[ABC]\b/)[0])).toEqual(['A', 'B', 'C']);
  });

  it('a tie for the highest price gets no top label', async () => {
    feed(raw({ modal_price: '1700' }), raw({ modal_price: '1700' }));
    show();
    await screen.findAllByTestId('mpc-row');
    expect(screen.queryByText('Highest reported modal price')).toBeNull();
  });

  it('switching crop requests that crop and ignores nothing else', async () => {
    feed();
    show();
    await screen.findByText(EMPTY);
    fireEvent.click(screen.getByRole('button', { name: 'Tomato' }));
    await waitFor(() => expect(marketApi.getLatestPrices).toHaveBeenLastCalledWith(expect.objectContaining({ commodityCode: 'TOMATO' }), expect.anything()));
  });

  it('is localised', async () => {
    feed();
    show({ language: 'hi' });
    await screen.findByText(t('hi', 'mpc.empty'));
    expect(screen.getByRole('heading', { name: t('hi', 'mpc.title') })).toBeTruthy();
  });
});

describe('priceComparison helpers', () => {
  it('label rules: sample > verified (<=3 days) > historical', () => {
    expect(labelFor(row({ is_sample_data: true }), NOW)).toBe('sample');
    expect(labelFor(row({ reported_date: '2026-10-06' }), NOW)).toBe('verified');
    expect(labelFor(row({ reported_date: '2026-10-05' }), NOW)).toBe('historical');
  });
  it('rejected-quality rows are excluded', () => {
    expect(buildComparison([row({ quality_status: 'REJECTED' })], NOW).status).toBe('empty');
  });
  it('reports sample-only so the UI can say so without showing prices', () => {
    const c = buildComparison([row({ is_sample_data: true })], NOW);
    expect(c.status).toBe('empty');
    expect(c.sampleOnly).toBe(true);
    expect(c.entries).toEqual([]);
  });
});

describe('source hygiene', () => {
  it('the old analyzer is gone and the new files contain no hardcoded prices, rates or fallbacks', () => {
    expect(fs.existsSync(new URL('../src/components/NetProfitAnalyzer.jsx', import.meta.url))).toBe(false);
    for (const f of ['../src/components/MandiPriceComparison.jsx', '../src/utils/priceComparison.js']) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).not.toMatch(/\|\|\s*2000|MARKET_TRANSPORT_RATES|fallbackPrices|netProfit|transportCost|price:\s*\d{3,}/);
    }
  });
});
