/**
 * FASALYTICS Phase 8 — Farmer Dashboard Page
 *
 * Personalized dashboard showing saved crops, mandis, genuine prices,
 * active alerts, recent triggers, and notifications.
 * Optional Phase 5-7 integrations shown as 'coming soon' placeholders.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePhase8Api } from '../utils/usePhase8Api';
import { t } from '../i18n/strings';

function PriceCard({ price, language }) {
  return (
    <div className="phase8-price-card">
      <div className="phase8-price-card__header">
        <span className="phase8-price-card__commodity">{price.commodity?.name}</span>
        <span className="phase8-price-card__mandi">{price.mandi?.name}</span>
      </div>
      <div className="phase8-price-card__price">
        ₹{Number(price.modalPrice).toLocaleString('en-IN')}<span className="phase8-price-card__unit">/quintal</span>
      </div>
      <div className="phase8-price-card__meta">
        {t(language, 'p8.dashboard.priceReported', { date: price.priceDate, source: price.sourceLabel || price.source })}
      </div>
    </div>
  );
}

function AlertCard({ alert, language }) {
  const condKey = alert.condition === 'gte' ? 'p8.alerts.condition.gte' : 'p8.alerts.condition.lte';
  return (
    <div className="phase8-alert-card">
      <div className="phase8-alert-card__row">
        <span className="phase8-alert-card__commodity">{alert.commodity?.name}</span>
        <span className="phase8-alert-card__mandi">{alert.mandi?.name}</span>
      </div>
      <div className="phase8-alert-card__detail">
        <span>{t(language, condKey)}</span>
        <span className="phase8-alert-card__price">₹{Number(alert.targetPrice).toLocaleString('en-IN')}/quintal</span>
      </div>
      {alert.lastTriggeredAt && (
        <div className="phase8-alert-card__triggered">
          {t(language, 'p8.alerts.lastTriggered', { date: new Date(alert.lastTriggeredAt).toLocaleDateString('en-IN') })}
        </div>
      )}
    </div>
  );
}

function TriggerCard({ trigger, language }) {
  const condKey = trigger.condition === 'gte' ? 'p8.history.condition.gte' : 'p8.history.condition.lte';
  return (
    <div className="phase8-trigger-card">
      <div className="phase8-trigger-card__header">
        <strong>{trigger.commodityName}</strong> — {trigger.mandiName}
      </div>
      <div className="phase8-trigger-card__prices">
        <span>{t(language, 'p8.history.targetPrice', { price: Number(trigger.targetPrice).toLocaleString('en-IN') })}</span>
        <span>{t(language, 'p8.history.actualPrice', { price: Number(trigger.actualPrice).toLocaleString('en-IN') })}</span>
      </div>
      <div className="phase8-trigger-card__meta">
        <span>{t(language, condKey)}</span>
        <span>{t(language, 'p8.history.observedOn', { date: trigger.observationDate })}</span>
        <span>{t(language, 'p8.history.source', { source: trigger.observationSource })}</span>
      </div>
    </div>
  );
}

function PhaseComingSoon({ label }) {
  return (
    <div className="phase8-coming-soon">
      <span className="phase8-coming-soon__icon">🔜</span>
      <span>{label}</span>
    </div>
  );
}

export default function FarmerDashboardPage() {
  const { farmer, language } = useAuth();
  const { getDashboard } = usePhase8Api();
  const [dashboard, setDashboard] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await getDashboard();
      setDashboard(res.dashboard);
      setStatus('ok');
    } catch (err) {
      setError(err.message || t(language, 'p8.dashboard.error'));
      setStatus('error');
    }
  }, [getDashboard, language]);

  useEffect(() => { load(); }, [load]);

  const lang = language || 'en';

  if (status === 'loading') {
    return (
      <div className="phase8-page phase8-page--loading">
        <div className="phase8-spinner" />
        <p>{t(lang, 'p8.dashboard.loading')}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="phase8-page phase8-page--error">
        <p>{error}</p>
        <button className="phase8-btn" onClick={load}>Retry</button>
      </div>
    );
  }

  const { favoriteCommodities, favoriteMandis, latestPrices, activeAlerts, recentTriggers, notifications, unreadCount } = dashboard;

  return (
    <div className="phase8-page phase8-dashboard">
      <header className="phase8-page__header">
        <div>
          <h1 className="phase8-page__title">{t(lang, 'p8.dashboard.title')}</h1>
          <p className="phase8-page__subtitle">{t(lang, 'p8.dashboard.subtitle')}</p>
          {farmer?.fullName && (
            <p className="phase8-dashboard__welcome">{t(lang, 'p8.dashboard.welcome', { name: farmer.fullName })}</p>
          )}
        </div>
        {unreadCount > 0 && (
          <Link to="/farmer/notifications" className="phase8-badge phase8-badge--alert">
            🔔 {t(lang, 'p8.dashboard.unreadNotifications', { count: unreadCount })}
          </Link>
        )}
      </header>

      {/* Quick Navigation */}
      <nav className="phase8-quick-nav">
        <Link to="/farmer/favorites" className="phase8-quick-nav__item">⭐ {t(lang, 'p8.nav.favorites')}</Link>
        <Link to="/farmer/alerts" className="phase8-quick-nav__item">🔔 {t(lang, 'p8.nav.alertMgmt')}</Link>
        <Link to="/farmer/history" className="phase8-quick-nav__item">📋 {t(lang, 'p8.nav.history')}</Link>
        <Link to="/farmer/preferences" className="phase8-quick-nav__item">⚙️ {t(lang, 'p8.nav.preferences')}</Link>
      </nav>

      {/* Genuine Data Note */}
      <div className="phase8-data-note">
        <span className="phase8-data-note__icon">✓</span>
        {t(lang, 'p8.dashboard.genuineDataNote')}
      </div>

      {/* Saved Commodities */}
      <section className="phase8-section">
        <h2 className="phase8-section__title">{t(lang, 'p8.dashboard.favCommodities')}</h2>
        {favoriteCommodities.length === 0 ? (
          <div className="phase8-empty">
            <p>{t(lang, 'p8.dashboard.noFavCommodities')}</p>
            <Link to="/farmer/favorites" className="phase8-btn phase8-btn--sm">{t(lang, 'p8.favorites.addCommodity')}</Link>
          </div>
        ) : (
          <div className="phase8-chips">
            {favoriteCommodities.map((fc) => (
              <span key={fc.id} className={`phase8-chip${fc.isDefault ? ' phase8-chip--default' : ''}`}>
                {fc.commodity.name}{fc.isDefault && ` (${t(lang, 'p8.favorites.default')})`}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Saved Mandis */}
      <section className="phase8-section">
        <h2 className="phase8-section__title">{t(lang, 'p8.dashboard.favMandis')}</h2>
        {favoriteMandis.length === 0 ? (
          <div className="phase8-empty">
            <p>{t(lang, 'p8.dashboard.noFavMandis')}</p>
            <Link to="/farmer/favorites" className="phase8-btn phase8-btn--sm">{t(lang, 'p8.favorites.addMandi')}</Link>
          </div>
        ) : (
          <div className="phase8-chips">
            {favoriteMandis.map((fm) => (
              <span key={fm.id} className={`phase8-chip${fm.isDefault ? ' phase8-chip--default' : ''}`}>
                {fm.mandi.name}, {fm.mandi.state}{fm.isDefault && ` (${t(lang, 'p8.favorites.default')})`}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Latest Reported Prices */}
      <section className="phase8-section">
        <h2 className="phase8-section__title">{t(lang, 'p8.dashboard.latestPrices')}</h2>
        {latestPrices.length === 0 ? (
          <div className="phase8-empty">
            <p>{t(lang, 'p8.dashboard.noLatestPrices')}</p>
          </div>
        ) : (
          <div className="phase8-price-grid">
            {latestPrices.map((p, i) => <PriceCard key={i} price={p} language={lang} />)}
          </div>
        )}
      </section>

      {/* Active Alerts */}
      <section className="phase8-section">
        <h2 className="phase8-section__title">{t(lang, 'p8.dashboard.activeAlerts')}</h2>
        {activeAlerts.length === 0 ? (
          <div className="phase8-empty">
            <p>{t(lang, 'p8.dashboard.noActiveAlerts')}</p>
            <Link to="/farmer/alerts" className="phase8-btn phase8-btn--sm">{t(lang, 'p8.alerts.create')}</Link>
          </div>
        ) : (
          <div className="phase8-alert-grid">
            {activeAlerts.map((a) => <AlertCard key={a.id} alert={a} language={lang} />)}
            <Link to="/farmer/alerts" className="phase8-link">View all alerts →</Link>
          </div>
        )}
      </section>

      {/* Recently Triggered */}
      <section className="phase8-section">
        <h2 className="phase8-section__title">{t(lang, 'p8.dashboard.recentTriggers')}</h2>
        {recentTriggers.length === 0 ? (
          <div className="phase8-empty"><p>{t(lang, 'p8.dashboard.noRecentTriggers')}</p></div>
        ) : (
          <div className="phase8-trigger-list">
            {recentTriggers.map((tr) => <TriggerCard key={tr.id} trigger={tr} language={lang} />)}
            <Link to="/farmer/history" className="phase8-link">View full history →</Link>
          </div>
        )}
      </section>

      {/* Optional Phase 5-7 placeholders */}
      <section className="phase8-section phase8-section--future">
        <h2 className="phase8-section__title">Coming Soon</h2>
        <PhaseComingSoon label={t(lang, 'p8.dashboard.phase5Unavailable')} />
        <PhaseComingSoon label={t(lang, 'p8.dashboard.phase6Unavailable')} />
        <PhaseComingSoon label={t(lang, 'p8.dashboard.phase7Unavailable')} />
      </section>

      {/* Recent Notifications */}
      {notifications.length > 0 && (
        <section className="phase8-section">
          <h2 className="phase8-section__title">{t(lang, 'p8.notifications.title')}</h2>
          <div className="phase8-notif-list">
            {notifications.slice(0, 5).map((n) => (
              <div key={n.id} className={`phase8-notif${n.isRead ? '' : ' phase8-notif--unread'}`}>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                <span className="phase8-notif__time">{new Date(n.createdAt).toLocaleString('en-IN')}</span>
              </div>
            ))}
            <Link to="/farmer/notifications" className="phase8-link">View all notifications →</Link>
          </div>
        </section>
      )}

      <footer className="phase8-page__footer">
        {t(lang, 'p8.dashboard.generatedAt', { time: new Date(dashboard.generatedAt).toLocaleTimeString('en-IN') })}
      </footer>
    </div>
  );
}
