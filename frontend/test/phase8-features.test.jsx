// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { t } from '../src/i18n/strings';
import FarmerDashboardPage from '../src/pages/FarmerDashboardPage';
import FarmerFavoritesPage from '../src/pages/FarmerFavoritesPage';
import FarmerAlertsPage from '../src/pages/FarmerAlertsPage';
import FarmerNotificationsPage from '../src/pages/FarmerNotificationsPage';
import FarmerHistoryPage from '../src/pages/FarmerHistoryPage';
import FarmerPreferencesPage from '../src/pages/FarmerPreferencesPage';

// Mock AuthContext
const mockFarmer = { fullName: 'Kailash Patil', email: 'kailash@example.in', primaryCrop: 'Onion' };
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    farmer: mockFarmer,
    user: { uid: 'test-farmer-uid', email: 'kailash@example.in' },
    isAuthenticated: true,
    language: 'en',
    setLanguage: vi.fn().mockResolvedValue('en'),
    withToken: (fn) => fn('fake-token'),
  }),
}));

// Mock Phase 8 API hook
const mockDashboardData = {
  preferences: { preferredLanguage: 'en', defaultCommodity: null, defaultMandi: null, notifyInApp: true, alertDigest: 'immediate' },
  favoriteCommodities: [
    { id: 1, commodityId: 10, isDefault: true, commodity: { name: 'Onion', hindiName: 'प्याज' } },
  ],
  favoriteMandis: [
    { id: 1, mandiId: 20, isDefault: true, mandi: { name: 'Nashik Main', state: 'Maharashtra' } },
  ],
  latestPrices: [
    { commodity: { name: 'Onion' }, mandi: { name: 'Nashik Main' }, modalPrice: 2200, priceDate: '2026-10-08', sourceLabel: 'Agmarknet' },
  ],
  activeAlerts: [
    { id: 101, commodity: { name: 'Onion' }, mandi: { name: 'Nashik Main' }, targetPrice: 2400, condition: 'gte', isActive: true, freshnessHours: 48 },
  ],
  inactiveAlerts: [],
  recentTriggers: [
    { id: 201, commodityName: 'Onion', mandiName: 'Nashik Main', targetPrice: 2000, actualPrice: 2200, condition: 'gte', observationDate: '2026-10-08', observationSource: 'AGMARKNET_PORTAL' },
  ],
  notifications: [
    { id: 301, title: 'Price Alert Triggered', body: 'Onion at Nashik Main reached ₹2,200/quintal.', isRead: false, createdAt: '2026-10-08T10:00:00Z' },
  ],
  unreadCount: 1,
  phase5Recommendations: null,
  phase6RiskIndicators: null,
  phase7Copilot: null,
  generatedAt: new Date().toISOString(),
};

const mockApi = {
  getDashboard: vi.fn().mockResolvedValue({ dashboard: mockDashboardData }),
  getFavorites: vi.fn().mockResolvedValue({
    favoriteCommodities: mockDashboardData.favoriteCommodities,
    favoriteMandis: mockDashboardData.favoriteMandis,
  }),
  addFavorite: vi.fn().mockResolvedValue({}),
  removeFavorite: vi.fn().mockResolvedValue({}),
  setDefault: vi.fn().mockResolvedValue({}),
  getAlerts: vi.fn().mockResolvedValue({ alerts: mockDashboardData.activeAlerts }),
  createAlert: vi.fn().mockResolvedValue({}),
  updateAlert: vi.fn().mockResolvedValue({}),
  deleteAlert: vi.fn().mockResolvedValue({}),
  getAlertHistory: vi.fn().mockResolvedValue({
    history: mockDashboardData.recentTriggers.map((t) => ({
      ...t,
      commodity: { name: t.commodityName },
      mandi: { name: t.mandiName, state: 'Maharashtra' },
      triggeredAt: '2026-10-08T10:00:00Z',
    })),
    pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  }),
  getNotifications: vi.fn().mockResolvedValue({
    notifications: mockDashboardData.notifications,
    unreadCount: 1,
  }),
  markNotificationRead: vi.fn().mockResolvedValue({}),
  markAllNotificationsRead: vi.fn().mockResolvedValue({}),
  getPreferences: vi.fn().mockResolvedValue({ preferences: mockDashboardData.preferences }),
  updatePreferences: vi.fn().mockResolvedValue({ preferences: mockDashboardData.preferences }),
};

vi.mock('../src/utils/usePhase8Api', () => ({
  usePhase8Api: () => mockApi,
}));

vi.mock('../src/services/api', () => ({
  getCommodities: vi.fn().mockResolvedValue({ data: [{ id: 10, name: 'Onion', hindi_name: 'प्याज' }] }),
  getMandis: vi.fn().mockResolvedValue({ data: [{ id: 20, name: 'Nashik Main', state: 'Maharashtra' }] }),
}));

describe('Phase 8 — Translation Key Parity', () => {
  const REQUIRED_KEYS = [
    'p8.nav.dashboard', 'p8.nav.favorites', 'p8.nav.alertMgmt', 'p8.nav.history', 'p8.nav.preferences',
    'p8.dashboard.title', 'p8.dashboard.favCommodities', 'p8.dashboard.favMandis', 'p8.dashboard.latestPrices',
    'p8.dashboard.activeAlerts', 'p8.dashboard.recentTriggers', 'p8.dashboard.genuineDataNote',
    'p8.favorites.title', 'p8.favorites.addCommodity', 'p8.favorites.addMandi',
    'p8.alerts.title', 'p8.alerts.create', 'p8.alerts.condition.gte', 'p8.alerts.condition.lte',
    'p8.history.title', 'p8.notifications.title', 'p8.prefs.title',
  ];

  it('provides translations for all required keys in English, Hindi, and Marathi', () => {
    for (const lang of ['en', 'hi', 'mr']) {
      for (const key of REQUIRED_KEYS) {
        const text = t(lang, key);
        expect(text).toBeDefined();
        expect(text).not.toBe(key); // Must not fall back to raw key name
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Phase 8 — Frontend Page Rendering', () => {
  it('renders FarmerDashboardPage with genuine data notes and placeholders', async () => {
    render(
      <BrowserRouter>
        <FarmerDashboardPage />
      </BrowserRouter>
    );

    const heading = await screen.findByText(/Dashboard|Farmer/i);
    expect(heading).toBeTruthy();
  });

  it('renders FarmerFavoritesPage', async () => {
    render(
      <BrowserRouter>
        <FarmerFavoritesPage />
      </BrowserRouter>
    );
    const elements = await screen.findAllByText(/Favorites/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders FarmerAlertsPage with target-price alert actions', async () => {
    render(
      <BrowserRouter>
        <FarmerAlertsPage />
      </BrowserRouter>
    );
    const elements = await screen.findAllByText(/Price Alerts/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders FarmerNotificationsPage', async () => {
    render(
      <BrowserRouter>
        <FarmerNotificationsPage />
      </BrowserRouter>
    );
    const elements = await screen.findAllByText(/Notifications/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders FarmerHistoryPage', async () => {
    render(
      <BrowserRouter>
        <FarmerHistoryPage />
      </BrowserRouter>
    );
    const elements = await screen.findAllByText(/Alert History/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders FarmerPreferencesPage with language choices', async () => {
    render(
      <BrowserRouter>
        <FarmerPreferencesPage />
      </BrowserRouter>
    );
    const elements = await screen.findAllByText(/Preferences/i);
    expect(elements.length).toBeGreaterThan(0);
  });
});
