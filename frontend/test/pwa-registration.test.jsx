// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import PwaStatus from '../src/components/PwaStatus';
import {
  SW_UPDATE_EVENT, applyServiceWorkerUpdate, canRegisterServiceWorker, registerServiceWorker,
} from '../src/pwa/registerServiceWorker';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const secureWin = (over = {}) => ({ isSecureContext: true, location: { hostname: 'app.example' }, dispatchEvent: vi.fn(), ...over });

describe('service worker registration', () => {
  it('is skipped outside production, without support, or on insecure origins', () => {
    const nav = { serviceWorker: {} };
    expect(canRegisterServiceWorker({ nav, win: secureWin(), isProd: false })).toBe(false);
    expect(canRegisterServiceWorker({ nav: {}, win: secureWin(), isProd: true })).toBe(false);
    expect(canRegisterServiceWorker({ nav, win: secureWin({ isSecureContext: false }), isProd: true })).toBe(false);
    expect(canRegisterServiceWorker({ nav, win: secureWin({ isSecureContext: false, location: { hostname: 'localhost' } }), isProd: true })).toBe(true);
    expect(canRegisterServiceWorker({ nav, win: secureWin(), isProd: true })).toBe(true);
  });

  it('registers /sw.js with root scope in production', async () => {
    const register = vi.fn().mockResolvedValue({ addEventListener: vi.fn() });
    const reg = await registerServiceWorker({ nav: { serviceWorker: { register } }, win: secureWin(), isProd: true });
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(reg).toBeTruthy();
  });

  it('does not register in development', async () => {
    const register = vi.fn();
    expect(await registerServiceWorker({ nav: { serviceWorker: { register } }, win: secureWin(), isProd: false })).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('a failed registration returns null instead of breaking the app', async () => {
    const register = vi.fn().mockRejectedValue(new Error('blocked'));
    const log = { warn: vi.fn() };
    expect(await registerServiceWorker({ nav: { serviceWorker: { register } }, win: secureWin(), isProd: true, log })).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });

  it('announces an update only when a new worker installs while another is in control', async () => {
    const worker = { state: 'installing', listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
    const registration = { installing: worker, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } };
    const win = secureWin();
    const nav = { serviceWorker: { register: vi.fn().mockResolvedValue(registration), controller: {} } };
    await registerServiceWorker({ nav, win, isProd: true });
    registration.listeners.updatefound();
    worker.state = 'installed';
    worker.listeners.statechange();
    expect(win.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(win.dispatchEvent.mock.calls[0][0].type).toBe(SW_UPDATE_EVENT);

    // first install (no controller): no update prompt
    const fresh = { ...nav, serviceWorker: { ...nav.serviceWorker, controller: null } };
    const win2 = secureWin();
    worker.listeners = {};
    registration.listeners = {};
    await registerServiceWorker({ nav: fresh, win: win2, isProd: true });
    registration.listeners.updatefound();
    worker.state = 'installed';
    worker.listeners.statechange();
    expect(win2.dispatchEvent).not.toHaveBeenCalled();
  });

  it('applying an update asks the waiting worker to take over, then reloads once', () => {
    const postMessage = vi.fn();
    const handlers = {};
    const nav = { serviceWorker: { addEventListener: (t, fn) => { handlers[t] = fn; } } };
    const win = { location: { reload: vi.fn() } };
    expect(applyServiceWorkerUpdate({ waiting: null }, { nav, win })).toBe(false);
    expect(applyServiceWorkerUpdate({ waiting: { postMessage } }, { nav, win })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith('SKIP_WAITING');
    handlers.controllerchange();
    handlers.controllerchange();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('offline / online status and install banner', () => {
  beforeEach(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); });

  it('shows an offline notice that says prices are not displayed, then a back-online notice', async () => {
    render(<PwaStatus language="en" />);
    expect(screen.queryByText(/You are offline/)).toBeNull();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText(/You are offline/)).toBeTruthy();
    expect(screen.getByText(/never see old numbers as current/)).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.queryByText(/You are offline/)).toBeNull();
    expect(screen.getByText('You are back online.')).toBeTruthy();
  });

  it('starts in the offline state when the browser is already offline, in Hindi too', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<PwaStatus language="hi" />);
    expect(screen.getByText(/आप ऑफ़लाइन हैं/)).toBeTruthy();
  });

  it('offers install only after the browser fires beforeinstallprompt, and remembers "Not now"', async () => {
    render(<PwaStatus language="en" />);
    expect(screen.queryByText('Install')).toBeNull();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await act(async () => { fireEvent.click(screen.getByText('Install')); });
    expect(prompt).toHaveBeenCalled();
    expect(screen.queryByText('Install')).toBeNull();

    act(() => { window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) })); });
    fireEvent.click(screen.getByText('Not now'));
    expect(localStorage.getItem('fasalytics.pwa.installDismissed')).toBe('1');
    expect(screen.queryByText('Install')).toBeNull();
  });

  it('shows the refresh banner when an update is announced and asks the worker to take over', () => {
    render(<PwaStatus language="en" />);
    const postMessage = vi.fn();
    act(() => { window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT, { detail: { waiting: { postMessage } } })); });
    fireEvent.click(screen.getByText('Refresh'));
    expect(postMessage).toHaveBeenCalledWith('SKIP_WAITING');
  });
});
