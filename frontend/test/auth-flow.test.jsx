// @vitest-environment jsdom
// Exercise the real forms, provider, API client and router. Only Firebase and
// fetch are replaced; no test connects to an account, database or market feed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { t } from '../src/i18n/strings';

const identity = vi.hoisted(() => ({ auth: { currentUser: null }, listeners: new Set() }));

vi.mock('../src/config/firebase', () => ({
  auth: identity.auth, isFirebaseConfigured: true, firebaseConfigError: null,
  firebaseProjectId: 'demo-fasalytics', isUsingAuthEmulator: false,
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
vi.mock('../src/services/authService', async (original) => ({
  ...await original(),
  completeGoogleRedirect: vi.fn().mockResolvedValue(null),
  loginWithEmail: vi.fn(async () => {
    identity.auth.currentUser = user;
    identity.listeners.forEach((callback) => callback(user));
    return user;
  }),
  logout: vi.fn(async () => {
    identity.auth.currentUser = null;
    identity.listeners.forEach((callback) => callback(null));
  }),
}));

const user = {
  uid: 'unit-test-farmer', email: 'farmer@example.test', emailVerified: true,
  phoneNumber: '+919000000001', displayName: 'Test Farmer',
  providerData: [{ providerId: 'password' }],
  getIdToken: vi.fn().mockResolvedValue('unit-test-token'),
};
const profile = {
  id: 'unit-profile', fullName: 'Test Farmer', phoneNumber: user.phoneNumber,
  email: user.email, state: 'Maharashtra', district: 'Nashik', village: null,
  primaryCrop: 'Onion', cropQuantity: 25, quantityUnit: 'quintal', preferredLanguage: 'en',
};
let savedProfile;
let saveFailure;
let sessionFailure;
let request;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/register');
  identity.auth.currentUser = user;
  savedProfile = null;
  saveFailure = null;
  sessionFailure = null;
  request = vi.fn(async (url, options = {}) => {
    const path = new URL(url, 'http://localhost:5173').pathname;
    if (path === '/locations/487.json') return json({ stateCode: '27', districtCode: '487', names: ['Lasalgaon', 'Nashik'] });
    if (path === '/api/health') return json({ status: 'ok' });
    if (path === '/api/mandi/prices/latest') return json({ data: [], meta: null });
    if (path === '/api/auth/session') {
      if (sessionFailure) return json(sessionFailure, 503);
      return json({ farmer: savedProfile, profileComplete: Boolean(savedProfile) });
    }
    if (path === '/api/farmers/me') {
      expect(options.headers.Authorization).toBe('Bearer unit-test-token');
      if (saveFailure) return json(saveFailure, 400);
      savedProfile = { ...profile, ...savedProfile, ...JSON.parse(options.body) };
      return json({ farmer: savedProfile }, options.method === 'POST' ? 201 : 200);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', request);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  expect(identity.listeners.size).toBe(0);
});

async function fillProfile(language = 'en') {
  await screen.findByRole('heading', { name: t(language, 'registerTitle') });
  for (const [field, value] of Object.entries({
    state: 'Maharashtra', district: 'Nashik', primaryCrop: 'Onion', cropQuantity: '25',
  })) {
    fireEvent.change(screen.getByLabelText(t(language, `profile.form.${field}`)), { target: { value } });
  }
}

const submit = (language = 'en') => fireEvent.click(screen.getByRole('button', {
  name: new RegExp(t(language, 'saveProfile')),
}));
const profileWrites = () => request.mock.calls.filter(([url, options]) =>
  url.endsWith('/api/farmers/me') && options.method === 'POST');

describe('registration and dashboard regression', () => {
  it('shows invalid fields without crashing or saving', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Complete your profile' });
    submit();
    expect(screen.getByText('Please select your state')).toBeTruthy();
    expect(screen.getByText('Quantity is required')).toBeTruthy();
    expect(profileWrites()).toHaveLength(0);
    expect(window.location.pathname).toBe('/register');
  });

  it.each(['en', 'hi', 'mr'])('saves a new profile and renders the dashboard in %s', async (language) => {
    localStorage.setItem('fasalytics.language', language);
    render(<App />);
    await fillProfile(language);
    submit(language);
    await screen.findByRole('heading', { name: t(language, 'greeting', { name: 'Test' }) });
    expect(window.location.pathname).toBe('/');
    expect(profileWrites()).toHaveLength(1);
    expect(savedProfile).toMatchObject({ cropQuantity: 25, preferredLanguage: language });
    expect(screen.queryByRole('heading', { name: t(language, 'registerTitle') })).toBeNull();
  });

  it('keeps failed saves on the form, shows server errors, and allows retry', async () => {
    saveFailure = { code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields.', details: { district: 'Enter a valid district name' } };
    render(<App />);
    await fillProfile();
    submit();
    await screen.findByText('Please correct the highlighted fields.');
    expect(screen.getByText('Enter a valid district name')).toBeTruthy();
    expect(window.location.pathname).toBe('/register');
    expect(screen.getByLabelText('Crop Quantity').value).toBe('25');
    saveFailure = null;
    submit();
    await screen.findByRole('heading', { name: 'Hello, Test' });
  });

  it('shows a network save failure without leaving registration', async () => {
    const original = request.getMockImplementation();
    request.mockImplementation((url, options) => url.endsWith('/api/farmers/me')
      ? Promise.reject(new TypeError('Offline')) : original(url, options));
    render(<App />);
    await fillProfile();
    submit();
    await screen.findByText(/Cannot reach the FASALYTICS server/);
    expect(window.location.pathname).toBe('/register');
    expect(screen.getByRole('button', { name: /Save & Continue/ }).disabled).toBe(false);
  });

  it('rejects an unlisted village and saves a matching village in the same form', async () => {
    render(<App />);
    await fillProfile();
    await waitFor(() => expect(screen.getByLabelText(/Village \/ Town/).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(/Village \/ Town/), { target: { value: 'Panaji' } });
    submit();
    await screen.findByText(t('en', 'location.invalidVillage'));
    expect(profileWrites()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Village \/ Town/), { target: { value: 'Lasalgaon' } });
    submit();
    await screen.findByRole('heading', { name: 'Hello, Test' });
    expect(savedProfile.village).toBe('Lasalgaon');
  });

  it('redirects unauthenticated root visitors to the landing page', async () => {
    identity.auth.currentUser = null;
    window.history.replaceState({}, '', '/');
    render(<App />);
    await screen.findByRole('heading', { name: /Sell Smarter\. Earn Better\./i });
    expect(window.location.pathname).toBe('/landing');
  });

  it('logs in a returning farmer and restores the dashboard after remount', async () => {
    savedProfile = profile;
    identity.auth.currentUser = null;
    window.history.replaceState({}, '', '/login');
    const view = render(<App />);
    await screen.findByRole('heading', { name: 'Log in to your account' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-only-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Log In/ }));
    await screen.findByRole('heading', { name: 'Hello, Test' });
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Hello, Test' });
    expect(profileWrites()).toHaveLength(0);
  });

  it('takes a new farmer from login through profile completion to the dashboard', async () => {
    identity.auth.currentUser = null;
    window.history.replaceState({}, '', '/login');
    render(<App />);
    await screen.findByRole('heading', { name: 'Log in to your account' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-only-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Log In/ }));
    await fillProfile();
    expect(window.location.pathname).toBe('/register');
    submit();
    await screen.findByRole('heading', { name: 'Hello, Test' });
    expect(window.location.pathname).toBe('/');
    expect(profileWrites()).toHaveLength(1);
  });

  it('restores a protected deep link and redirects completed registration away from the form', async () => {
    savedProfile = profile;
    window.history.replaceState({}, '', '/profile');
    const view = render(<App />);
    await screen.findByText(profile.fullName);
    expect(window.location.pathname).toBe('/profile');
    view.unmount();
    window.history.replaceState({}, '', '/register');
    render(<App />);
    await screen.findByRole('heading', { name: 'Hello, Test' });
    expect(window.location.pathname).toBe('/');
  });

  it('shows a retry screen for profile lookup failures instead of registration', async () => {
    savedProfile = profile;
    sessionFailure = { code: 'DB_UNAVAILABLE', message: 'Profile service unavailable' };
    render(<App />);
    await screen.findByText('Profile service unavailable');
    expect(screen.queryByRole('heading', { name: 'Complete your profile' })).toBeNull();
    sessionFailure = null;
    fireEvent.click(screen.getByRole('button', { name: t('en', 'auth.status.tryAgain') }));
    await screen.findByRole('heading', { name: 'Hello, Test' });
  });

  it('changes language on the dashboard and preserves the translated page', async () => {
    savedProfile = profile;
    render(<App />);
    await screen.findByRole('heading', { name: 'Hello, Test' });
    for (const [language, label] of [['hi', 'हिं'], ['mr', 'मराठी'], ['en', 'EN']]) {
      fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
      await screen.findByRole('heading', { name: t(language, 'greeting', { name: 'Test' }) });
      await waitFor(() => expect(savedProfile.preferredLanguage).toBe(language));
      expect(document.documentElement.lang).toBe(language);
    }
  });

  it('keeps unverified email accounts in the required verification step', async () => {
    identity.auth.currentUser = { ...user, emailVerified: false };
    render(<App />);
    await screen.findByRole('heading', { name: 'Verify your email' });
    expect(window.location.pathname).toBe('/verify-email');
    expect(profileWrites()).toHaveLength(0);
  });

  it('allows accounts without phone to proceed to dashboard without OTP', async () => {
    savedProfile = profile;
    identity.auth.currentUser = { ...user, phoneNumber: null };
    render(<App />);
    await screen.findByRole('heading', { name: 'Hello, Test' });
    expect(window.location.pathname).toBe('/');
  });

  it('navigates to the landing page when a logged-in farmer logs out', async () => {
    savedProfile = profile;
    window.history.replaceState({}, '', '/profile');
    render(<App />);
    await screen.findByText(profile.fullName);
    const logoutBtn = await screen.findByRole('button', { name: /Log Out/i });
    fireEvent.click(logoutBtn);
    await screen.findByRole('heading', { name: /Sell Smarter\. Earn Better\./i });
    expect(window.location.pathname).toBe('/landing');
  });
});
