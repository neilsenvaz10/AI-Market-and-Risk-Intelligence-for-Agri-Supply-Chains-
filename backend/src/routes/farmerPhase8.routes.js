/**
 * FASALYTICS Phase 8 — Farmer Smart Features Routes
 *
 * All routes are protected by requireAuth (Firebase ID token).
 * Routes:
 *   GET    /api/farmer/dashboard
 *   GET    /api/farmer/favorites
 *   POST   /api/farmer/favorites
 *   DELETE /api/farmer/favorites/:id
 *   PATCH  /api/farmer/favorites/default
 *   GET    /api/farmer/alerts
 *   POST   /api/farmer/alerts
 *   PATCH  /api/farmer/alerts/:id
 *   DELETE /api/farmer/alerts/:id
 *   GET    /api/farmer/alerts/history
 *   GET    /api/farmer/notifications
 *   PATCH  /api/farmer/notifications/:id/read
 *   PATCH  /api/farmer/notifications/read-all
 *   GET    /api/farmer/preferences
 *   PATCH  /api/farmer/preferences
 */
import { Router } from 'express';
import { createRateLimiter } from '../middleware/rateLimit.js';
import {
  getDashboard,
  listFavorites, addFavorite, removeFavorite, setDefault,
  listAlerts, createAlertHandler, updateAlertHandler, deleteAlertHandler, getAlertHistoryHandler,
  listNotifications, markNotificationReadHandler, markAllReadHandler,
  getPreferences, updatePreferencesHandler,
} from '../controllers/farmerPhase8.controller.js';

/** @param {Function} requireAuth - injectable for tests */
export default function createFarmerPhase8Routes(requireAuth) {
  const router = Router();

  // Apply auth to all routes in this router
  router.use(requireAuth);

  // Rate limiter for write operations (alert creation / favorites)
  const writeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60, code: 'PHASE8_RATE_LIMITED' });

  // ── Dashboard ──────────────────────────────────────────────────────────────
  router.get('/dashboard', getDashboard);

  // ── Favorites ──────────────────────────────────────────────────────────────
  router.get('/favorites', listFavorites);
  router.post('/favorites', writeLimiter, addFavorite);
  router.delete('/favorites/:id', writeLimiter, removeFavorite);
  router.patch('/favorites/default', writeLimiter, setDefault);

  // ── Alerts ─────────────────────────────────────────────────────────────────
  router.get('/alerts', listAlerts);
  router.post('/alerts', writeLimiter, createAlertHandler);
  router.patch('/alerts/:id', writeLimiter, updateAlertHandler);
  router.delete('/alerts/:id', writeLimiter, deleteAlertHandler);
  router.get('/alerts/history', getAlertHistoryHandler);

  // ── Notifications ──────────────────────────────────────────────────────────
  router.get('/notifications', listNotifications);
  router.patch('/notifications/read-all', markAllReadHandler);
  router.patch('/notifications/:id/read', markNotificationReadHandler);

  // ── Preferences ────────────────────────────────────────────────────────────
  router.get('/preferences', getPreferences);
  router.patch('/preferences', writeLimiter, updatePreferencesHandler);

  return router;
}
