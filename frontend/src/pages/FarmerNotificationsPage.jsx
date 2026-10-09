/**
 * FASALYTICS Phase 8 — Farmer In-App Notifications Page
 * View price trigger notifications and system alerts with read status management.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePhase8Api } from '../utils/usePhase8Api';
import { t } from '../i18n/strings';

export default function FarmerNotificationsPage() {
  const { language } = useAuth();
  const lang = language || 'en';
  const { getNotifications, markNotificationRead, markAllNotificationsRead } = usePhase8Api();

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [actionMsg, setActionMsg] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setActionMsg(null);
    try {
      const res = await getNotifications({ unreadOnly });
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
      setStatus('ready');
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || t(lang, 'p8.notifications.error') });
      setStatus('error');
    }
  }, [getNotifications, unreadOnly, lang]);

  useEffect(() => { load(); }, [load]);

  const handleMarkRead = async (id) => {
    try {
      await markNotificationRead(id);
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setActionMsg({ type: 'success', text: t(lang, 'p8.notifications.allRead') });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  return (
    <div className="phase8-page">
      <header className="phase8-page__header">
        <div>
          <h1 className="phase8-page__title">{t(lang, 'p8.notifications.title')}</h1>
          <p className="phase8-page__subtitle">{t(lang, 'p8.notifications.subtitle')}</p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="phase8-btn phase8-btn--outline phase8-btn--sm"
          >
            ✓ {t(lang, 'p8.notifications.markAllRead')}
          </button>
        )}
      </header>

      {/* Quick Navigation */}
      <nav className="phase8-quick-nav">
        <Link to="/farmer/dashboard" className="phase8-quick-nav__item">📊 {t(lang, 'p8.nav.dashboard')}</Link>
        <Link to="/farmer/favorites" className="phase8-quick-nav__item">⭐ {t(lang, 'p8.nav.favorites')}</Link>
        <Link to="/farmer/alerts" className="phase8-quick-nav__item">🔔 {t(lang, 'p8.nav.alertMgmt')}</Link>
        <Link to="/farmer/history" className="phase8-quick-nav__item">📋 {t(lang, 'p8.nav.history')}</Link>
        <Link to="/farmer/preferences" className="phase8-quick-nav__item">⚙️ {t(lang, 'p8.nav.preferences')}</Link>
      </nav>

      {/* Filter Bar */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-on-surface">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="w-4 h-4 text-primary"
          />
          {t(lang, 'p8.notifications.unreadFilter')}
        </label>
        {unreadCount > 0 && (
          <span className="phase8-badge phase8-badge--alert">
            {unreadCount} {t(lang, 'p8.notifications.new')}
          </span>
        )}
      </div>

      {actionMsg && (
        <div className={`phase8-data-note ${actionMsg.type === 'error' ? 'phase8-badge--alert' : ''}`}>
          <span>{actionMsg.text}</span>
        </div>
      )}

      {status === 'loading' ? (
        <div className="phase8-page--loading">
          <div className="phase8-spinner" />
          <p>{t(lang, 'p8.notifications.loading')}</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="phase8-empty">
          <p>{t(lang, 'p8.notifications.empty')}</p>
          <Link to="/farmer/dashboard" className="phase8-btn phase8-btn--sm">
            {t(lang, 'p8.nav.dashboard')}
          </Link>
        </div>
      ) : (
        <div className="phase8-notif-list">
          {notifications.map((n) => (
            <div key={n.id} className={`phase8-notif ${n.isRead ? '' : 'phase8-notif--unread'}`}>
              <div className="flex justify-between items-start gap-2">
                <strong className="text-on-surface text-base">{n.title}</strong>
                {!n.isRead && (
                  <button
                    type="button"
                    onClick={() => handleMarkRead(n.id)}
                    className="phase8-btn phase8-btn--outline phase8-btn--sm text-xs"
                    title={t(lang, 'p8.notifications.markRead')}
                  >
                    ✓ {t(lang, 'p8.notifications.markRead')}
                  </button>
                )}
              </div>
              <p className="text-sm text-on-surface-variant my-1">{n.body}</p>
              <span className="phase8-notif__time">
                {new Date(n.createdAt).toLocaleString(lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
