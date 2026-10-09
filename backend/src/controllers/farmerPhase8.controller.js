/**
 * FASALYTICS Phase 8 — Farmer Dashboard, Favorites, Alerts,
 * Notifications and Preferences Controller
 */
import { HttpError, mapDatabaseError } from '../utils/httpError.js';
import { getFarmerDashboard } from '../services/farmerDashboard.service.js';
import {
  getFavoriteCommodities, addFavoriteCommodity, removeFavoriteCommodity, setDefaultCommodity,
  getFavoriteMandis, addFavoriteMandi, removeFavoriteMandi, setDefaultMandi,
} from '../services/farmerFavorites.service.js';
import { getAlerts, createAlert, updateAlert, deleteAlert } from '../services/farmerAlerts.service.js';
import { getAlertHistory, getNotifications, markNotificationRead, markAllNotificationsRead } from '../services/farmerNotifications.service.js';
import { getOrCreatePreferences, toPreferencesDto, updatePreferences } from '../services/farmerPreferences.service.js';

// ─── Dashboard ─────────────────────────────────────────────────────────────

export async function getDashboard(req, res, next) {
  try {
    const data = await getFarmerDashboard(req.auth.uid);
    res.json({ status: 'ok', dashboard: data });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

// ─── Favorites ─────────────────────────────────────────────────────────────

export async function listFavorites(req, res, next) {
  try {
    const [commodities, mandis] = await Promise.all([
      getFavoriteCommodities(req.auth.uid),
      getFavoriteMandis(req.auth.uid),
    ]);
    res.json({ status: 'ok', favoriteCommodities: commodities, favoriteMandis: mandis });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function addFavorite(req, res, next) {
  try {
    const { type, id } = req.body;
    if (!type || !['commodity', 'mandi'].includes(type)) {
      throw new HttpError(400, 'VALIDATION_ERROR', "type must be 'commodity' or 'mandi'.");
    }
    const numId = Number(id);
    if (!numId || !Number.isInteger(numId) || numId <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'id must be a positive integer.');
    }

    const result = type === 'commodity'
      ? await addFavoriteCommodity(req.auth.uid, numId)
      : await addFavoriteMandi(req.auth.uid, numId);

    if (result.error) {
      const status = result.error === 'ALREADY_FAVORITE' ? 409 : 404;
      throw new HttpError(status, result.error, result.message);
    }
    res.status(201).json({ status: 'ok', favorite: result.favorite });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function removeFavorite(req, res, next) {
  try {
    const { type } = req.query;
    const numId = Number(req.params.id);
    if (!numId || !Number.isInteger(numId) || numId <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'id must be a positive integer.');
    }
    if (!type || !['commodity', 'mandi'].includes(type)) {
      throw new HttpError(400, 'VALIDATION_ERROR', "type query param must be 'commodity' or 'mandi'.");
    }

    const deleted = type === 'commodity'
      ? await removeFavoriteCommodity(req.auth.uid, numId)
      : await removeFavoriteMandi(req.auth.uid, numId);

    if (!deleted) throw new HttpError(404, 'FAVORITE_NOT_FOUND', 'Favorite not found or already removed.');
    res.json({ status: 'ok' });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function setDefault(req, res, next) {
  try {
    const { type, id } = req.body;
    if (!type || !['commodity', 'mandi'].includes(type)) {
      throw new HttpError(400, 'VALIDATION_ERROR', "type must be 'commodity' or 'mandi'.");
    }
    const numId = Number(id);
    if (!numId || !Number.isInteger(numId) || numId <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'id must be a positive integer.');
    }
    const updated = type === 'commodity'
      ? await setDefaultCommodity(req.auth.uid, numId)
      : await setDefaultMandi(req.auth.uid, numId);
    if (!updated) throw new HttpError(404, 'FAVORITE_NOT_FOUND', 'This item is not in your favorites.');
    res.json({ status: 'ok' });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

// ─── Alerts ────────────────────────────────────────────────────────────────

export async function listAlerts(req, res, next) {
  try {
    const alerts = await getAlerts(req.auth.uid);
    res.json({ status: 'ok', alerts });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function createAlertHandler(req, res, next) {
  try {
    const { commodityId, mandiId, targetPrice, condition, freshnessHours } = req.body;

    const errors = {};
    const numCommodity = Number(commodityId);
    const numMandi = Number(mandiId);
    const numTarget = Number(targetPrice);
    const numFreshness = freshnessHours !== undefined ? Number(freshnessHours) : undefined;

    if (!numCommodity || !Number.isInteger(numCommodity) || numCommodity <= 0) errors.commodityId = 'Required positive integer.';
    if (!numMandi || !Number.isInteger(numMandi) || numMandi <= 0) errors.mandiId = 'Required positive integer.';
    if (!numTarget || numTarget <= 0) errors.targetPrice = 'Required positive number.';
    if (!condition || !['gte', 'lte'].includes(condition)) errors.condition = "Must be 'gte' or 'lte'.";
    if (numFreshness !== undefined && (!Number.isInteger(numFreshness) || numFreshness < 1 || numFreshness > 720)) {
      errors.freshnessHours = 'Must be between 1 and 720.';
    }

    if (Object.keys(errors).length) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', errors);
    }

    const result = await createAlert(req.auth.uid, {
      commodityId: numCommodity, mandiId: numMandi, targetPrice: numTarget,
      condition, freshnessHours: numFreshness,
    });

    if (result?.error) {
      const status = result.error === 'ALERT_EXISTS' ? 409 : 404;
      throw new HttpError(status, result.error, result.message);
    }

    res.status(201).json({ status: 'ok', alert: result });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function updateAlertHandler(req, res, next) {
  try {
    const numId = Number(req.params.id);
    if (!numId || !Number.isInteger(numId) || numId <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Alert id must be a positive integer.');
    }
    const result = await updateAlert(req.auth.uid, numId, req.body);
    if (result?.error === 'NOT_FOUND') throw new HttpError(404, 'ALERT_NOT_FOUND', 'Alert not found.');
    if (result?.error) throw new HttpError(400, result.error, result.message);
    res.json({ status: 'ok', alert: result });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function deleteAlertHandler(req, res, next) {
  try {
    const numId = Number(req.params.id);
    if (!numId || !Number.isInteger(numId) || numId <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Alert id must be a positive integer.');
    }
    const deleted = await deleteAlert(req.auth.uid, numId);
    if (!deleted) throw new HttpError(404, 'ALERT_NOT_FOUND', 'Alert not found.');
    res.json({ status: 'ok' });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function getAlertHistoryHandler(req, res, next) {
  try {
    const { page, limit, commodityId, mandiId, fromDate } = req.query;
    const result = await getAlertHistory(req.auth.uid, {
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      commodityId: commodityId ? Number(commodityId) : undefined,
      mandiId: mandiId ? Number(mandiId) : undefined,
      fromDate: fromDate || undefined,
    });
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

// ─── Notifications ─────────────────────────────────────────────────────────

export async function listNotifications(req, res, next) {
  try {
    const { unreadOnly, limit } = req.query;
    const result = await getNotifications(req.auth.uid, {
      unreadOnly: unreadOnly === 'true',
      limit: Number(limit) || 50,
    });
    res.json({ status: 'ok', ...result });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function markNotificationReadHandler(req, res, next) {
  try {
    const numId = Number(req.params.id);
    if (!numId || !Number.isInteger(numId) || numId <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Notification id must be a positive integer.');
    }
    const updated = await markNotificationRead(req.auth.uid, numId);
    if (!updated) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found or already read.');
    res.json({ status: 'ok' });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function markAllReadHandler(req, res, next) {
  try {
    const count = await markAllNotificationsRead(req.auth.uid);
    res.json({ status: 'ok', markedRead: count });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

// ─── Preferences ───────────────────────────────────────────────────────────

export async function getPreferences(req, res, next) {
  try {
    const row = await getOrCreatePreferences(req.auth.uid);
    res.json({ status: 'ok', preferences: toPreferencesDto(row) });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

export async function updatePreferencesHandler(req, res, next) {
  try {
    const result = await updatePreferences(req.auth.uid, req.body);
    if (result.errors) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', result.errors);
    }
    res.json({ status: 'ok', preferences: result.preferences });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}
