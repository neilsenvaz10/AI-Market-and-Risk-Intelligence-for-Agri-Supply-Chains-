/**
 * FASALYTICS Phase 8 — Farmer Smart Features API Client
 *
 * All calls require a Firebase ID token (passed as Bearer in Authorization header).
 */
import { apiRequest } from './api';

// ── Dashboard ──────────────────────────────────────────────────────────────

export const getDashboard = (token) =>
  apiRequest('/api/farmer/dashboard', { token });

// ── Favorites ──────────────────────────────────────────────────────────────

export const getFavorites = (token) =>
  apiRequest('/api/farmer/favorites', { token });

export const addFavorite = (token, type, id) =>
  apiRequest('/api/farmer/favorites', { method: 'POST', token, body: { type, id } });

export const removeFavorite = (token, id, type) =>
  apiRequest(`/api/farmer/favorites/${id}?type=${type}`, { method: 'DELETE', token });

export const setDefault = (token, type, id) =>
  apiRequest('/api/farmer/favorites/default', { method: 'PATCH', token, body: { type, id } });

// ── Alerts ─────────────────────────────────────────────────────────────────

export const getAlerts = (token) =>
  apiRequest('/api/farmer/alerts', { token });

export const createAlert = (token, data) =>
  apiRequest('/api/farmer/alerts', { method: 'POST', token, body: data });

export const updateAlert = (token, id, data) =>
  apiRequest(`/api/farmer/alerts/${id}`, { method: 'PATCH', token, body: data });

export const deleteAlert = (token, id) =>
  apiRequest(`/api/farmer/alerts/${id}`, { method: 'DELETE', token });

export const getAlertHistory = (token, params = {}) => {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  ).toString();
  return apiRequest(`/api/farmer/alerts/history${query ? `?${query}` : ''}`, { token });
};

// ── Notifications ──────────────────────────────────────────────────────────

export const getNotifications = (token, params = {}) => {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
  ).toString();
  return apiRequest(`/api/farmer/notifications${query ? `?${query}` : ''}`, { token });
};

export const markNotificationRead = (token, id) =>
  apiRequest(`/api/farmer/notifications/${id}/read`, { method: 'PATCH', token });

export const markAllNotificationsRead = (token) =>
  apiRequest('/api/farmer/notifications/read-all', { method: 'PATCH', token });

// ── Preferences ────────────────────────────────────────────────────────────

export const getPreferences = (token) =>
  apiRequest('/api/farmer/preferences', { token });

export const updatePreferences = (token, data) =>
  apiRequest('/api/farmer/preferences', { method: 'PATCH', token, body: data });
