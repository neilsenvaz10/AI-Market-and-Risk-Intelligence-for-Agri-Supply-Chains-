/**
 * FASALYTICS Phase 8 — usePhase8Api hook
 *
 * Wraps Phase 8 API calls with the existing withToken pattern from AuthContext.
 * Exposes helper functions for dashboard, favorites, alerts, notifications, preferences.
 */
import { useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import * as phase8Service from '../services/farmerPhase8Service';

export function usePhase8Api() {
  const { withToken } = useAuth();

  const getDashboard = useCallback(
    () => withToken((token) => phase8Service.getDashboard(token)),
    [withToken],
  );

  const getFavorites = useCallback(
    () => withToken((token) => phase8Service.getFavorites(token)),
    [withToken],
  );

  const addFavorite = useCallback(
    (type, id) => withToken((token) => phase8Service.addFavorite(token, type, id)),
    [withToken],
  );

  const removeFavorite = useCallback(
    (id, type) => withToken((token) => phase8Service.removeFavorite(token, id, type)),
    [withToken],
  );

  const setDefault = useCallback(
    (type, id) => withToken((token) => phase8Service.setDefault(token, type, id)),
    [withToken],
  );

  const getAlerts = useCallback(
    () => withToken((token) => phase8Service.getAlerts(token)),
    [withToken],
  );

  const createAlert = useCallback(
    (data) => withToken((token) => phase8Service.createAlert(token, data)),
    [withToken],
  );

  const updateAlert = useCallback(
    (id, data) => withToken((token) => phase8Service.updateAlert(token, id, data)),
    [withToken],
  );

  const deleteAlert = useCallback(
    (id) => withToken((token) => phase8Service.deleteAlert(token, id)),
    [withToken],
  );

  const getAlertHistory = useCallback(
    (params) => withToken((token) => phase8Service.getAlertHistory(token, params)),
    [withToken],
  );

  const getNotifications = useCallback(
    (params) => withToken((token) => phase8Service.getNotifications(token, params)),
    [withToken],
  );

  const markNotificationRead = useCallback(
    (id) => withToken((token) => phase8Service.markNotificationRead(token, id)),
    [withToken],
  );

  const markAllNotificationsRead = useCallback(
    () => withToken((token) => phase8Service.markAllNotificationsRead(token)),
    [withToken],
  );

  const getPreferences = useCallback(
    () => withToken((token) => phase8Service.getPreferences(token)),
    [withToken],
  );

  const updatePreferences = useCallback(
    (data) => withToken((token) => phase8Service.updatePreferences(token, data)),
    [withToken],
  );

  return useMemo(
    () => ({
      getDashboard,
      getFavorites,
      addFavorite,
      removeFavorite,
      setDefault,
      getAlerts,
      createAlert,
      updateAlert,
      deleteAlert,
      getAlertHistory,
      getNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      getPreferences,
      updatePreferences,
    }),
    [
      getDashboard,
      getFavorites,
      addFavorite,
      removeFavorite,
      setDefault,
      getAlerts,
      createAlert,
      updateAlert,
      deleteAlert,
      getAlertHistory,
      getNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      getPreferences,
      updatePreferences,
    ]
  );
}
