/**
 * FASALYTICS - Farmer profile API calls (all require a Firebase ID token)
 */
import { apiRequest } from './api';

export const getSession = (token) => apiRequest('/api/auth/session', { token });

export const getMyProfile = (token) => apiRequest('/api/farmers/me', { token }).then((r) => r.farmer);

export const createMyProfile = (token, profile) =>
  apiRequest('/api/farmers/me', { method: 'POST', token, body: profile }).then((r) => r.farmer);

export const updateMyProfile = (token, changes) =>
  apiRequest('/api/farmers/me', { method: 'PUT', token, body: changes }).then((r) => r.farmer);
