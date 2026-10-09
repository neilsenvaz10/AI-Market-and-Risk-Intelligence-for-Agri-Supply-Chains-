// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { t } from '../src/i18n/strings';

const identity = vi.hoisted(() => ({ auth: { currentUser: null }, listeners: new Set() }));

vi.mock('../src/config/firebase', () => ({
  auth: identity.auth,
  isFirebaseConfigured: true,
  firebaseConfigError: null,
  firebaseProjectId: 'demo-fasalytics',
  isUsingAuthEmulator: false,
}));

vi.mock('firebase/auth', async (original) => ({
  ...await original(),
  onIdTokenChanged: (_auth, callback) => {
    identity.listeners.add(callback);
    queueMicrotask(() => {
      if (identity.listeners.has(callback)) callback(identity.auth.currentUser);
    });
    return () => identity.listeners.delete(callback);
  },
}));

const user = {
  uid: 'unit-farmer-1',
  email: 'farmer@example.test',
  emailVerified: true,
  phoneNumber: '+919000000001',
  displayName: 'Ramesh Patil',
  providerData: [{ providerId: 'password' }],
  getIdToken: vi.fn().mockResolvedValue('unit-test-token'),
};

const profile = {
  id: 'unit-profile',
  fullName: 'Ramesh Patil',
  phoneNumber: user.phoneNumber,
  email: user.email,
  state: 'Maharashtra',
  district: 'Nashik',
  village: 'Lasalgaon',
  primaryCrop: 'Onion',
  cropQuantity: 25,
  quantityUnit: 'quintal',
  preferredLanguage: 'en',
};

let request;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/ask-ai');
  identity.auth.currentUser = user;

  request = vi.fn(async (url, options = {}) => {
    const path = new URL(url, 'http://localhost:5173').pathname;
    if (path === '/api/health') return json({ status: 'ok' });
    if (path === '/api/auth/session') {
      return json({ farmer: profile, profileComplete: true });
    }
    if (path === '/api/copilot/capabilities') {
      return json({
        status: 'ok',
        capabilities: {
          groqConfigured: true,
          groqModel: 'llama-3.3-70b-versatile',
          supportedLanguages: ['en', 'hi', 'mr'],
          integrations: {
            phase3MarketData: true,
            phase4Forecasting: true,
            phase5Recommendations: false,
            phase6RiskIntelligence: false,
          },
        },
      });
    }
    if (path === '/api/copilot/chat') {
      const body = JSON.parse(options.body || '{}');
      if (body.message?.includes('error')) {
        return json({ status: 'error', message: 'Failed to process market query' }, 500);
      }
      return json({
        status: 'ok',
        available: true,
        answer: 'The latest modal price for Onion in Nashik is ₹1,650/quintal as of 2026-10-08.',
        language: body.language || 'en',
        intent: 'LATEST_PRICE',
        entity: { commodity: 'Onion', mandi: 'Nashik APMC' },
        sources: [{ type: 'mandi_price', source: 'AGMARKNET', date: '2026-10-08' }],
        marketData: {
          commodityName: 'Onion',
          mandiName: 'Nashik APMC',
          modalPrice: 1650,
          minPrice: 1200,
          maxPrice: 1900,
          priceDate: '2026-10-08',
        },
        forecastData: null,
        limitations: [],
        groqPowered: true,
      });
    }
    return json({ status: 'ok' });
  });
  vi.stubGlobal('fetch', request);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Phase 7 - AI Farmer Copilot UI', () => {
  it('renders the copilot page with header, welcome screen, and suggestion chips', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: t('en', 'copilot.title') });
    expect(screen.getByText(t('en', 'copilot.welcome.title'))).toBeTruthy();
    expect(screen.getByText(t('en', 'copilot.suggest1'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('en', 'copilot.send') })).toBeTruthy();
  });

  it('displays the capabilities badge from server', async () => {
    render(<App />);
    await screen.findByText(t('en', 'copilot.badge.groq'));
    expect(screen.getByText(t('en', 'copilot.badge.verified'))).toBeTruthy();
  });

  it('submits a question and displays user bubble and grounded copilot answer with market card', async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText(t('en', 'copilot.inputPlaceholder'));
    fireEvent.change(input, { target: { value: 'What is the latest onion price in Nashik?' } });

    const sendBtn = screen.getByRole('button', { name: t('en', 'copilot.send') });
    fireEvent.click(sendBtn);

    // Verify user bubble appears
    await screen.findByText('What is the latest onion price in Nashik?');

    // Verify grounded AI response appears
    await screen.findByText(/The latest modal price for Onion in Nashik is ₹1,650\/quintal/);

    // Verify structured market card details appear
    expect(screen.getByText('₹1650/quintal')).toBeTruthy();
    expect(screen.getByText(/AGMARKNET/)).toBeTruthy();
  });

  it('clicking a suggestion chip sends the query automatically', async () => {
    render(<App />);
    const chip = await screen.findByText(t('en', 'copilot.suggest1'));
    fireEvent.click(chip);

    await screen.findByText(t('en', 'copilot.suggest1'));
    await screen.findByText(/The latest modal price for Onion in Nashik is ₹1,650\/quintal/);
  });

  it('displays an error alert when the chat endpoint fails', async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText(t('en', 'copilot.inputPlaceholder'));
    fireEvent.change(input, { target: { value: 'trigger error' } });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'copilot.send') }));

    await screen.findByText(/Failed to process market query/);
  });

  it('supports navigation via /copilot route alias', async () => {
    window.history.replaceState({}, '', '/copilot');
    render(<App />);
    await screen.findByRole('heading', { name: t('en', 'copilot.title') });
  });
});
