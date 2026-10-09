/**
 * FASALYTICS Phase 8 — Farmer Price Alerts Management Page
 * Create, edit, toggle and delete target price alerts.
 * Strictly evaluated against genuine reported observations.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePhase8Api } from '../utils/usePhase8Api';
import { getCommodities, getMandis } from '../services/api';
import { t } from '../i18n/strings';

export default function FarmerAlertsPage() {
  const { language } = useAuth();
  const lang = language || 'en';
  const { getAlerts, createAlert, updateAlert, deleteAlert } = usePhase8Api();

  const [alerts, setAlerts] = useState([]);
  const [allCommodities, setAllCommodities] = useState([]);
  const [allMandis, setAllMandis] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [actionMsg, setActionMsg] = useState(null);

  // Create form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    commodityId: '',
    mandiId: '',
    targetPrice: '',
    condition: 'gte',
    freshnessHours: '48',
  });
  const [formErrors, setFormErrors] = useState({});

  const load = useCallback(async () => {
    setStatus('loading');
    setActionMsg(null);
    try {
      const [alertRes, commRes, mandiRes] = await Promise.all([
        getAlerts(),
        getCommodities().catch(() => ({ data: [] })),
        getMandis().catch(() => ({ data: [] })),
      ]);
      setAlerts(alertRes.alerts || []);
      setAllCommodities(Array.isArray(commRes.data) ? commRes.data : []);
      setAllMandis(Array.isArray(mandiRes.data) ? mandiRes.data : []);
      setStatus('ready');
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || t(lang, 'p8.alerts.error') });
      setStatus('error');
    }
  }, [getAlerts, lang]);

  useEffect(() => { load(); }, [load]);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!formData.commodityId) errors.commodityId = t(lang, 'p8.alerts.validationCommodity');
    if (!formData.mandiId) errors.mandiId = t(lang, 'p8.alerts.validationMandi');
    const priceNum = Number(formData.targetPrice);
    if (!priceNum || priceNum <= 0) errors.targetPrice = t(lang, 'p8.alerts.validationTargetPrice');

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    try {
      await createAlert({
        commodityId: Number(formData.commodityId),
        mandiId: Number(formData.mandiId),
        targetPrice: priceNum,
        condition: formData.condition,
        freshnessHours: Number(formData.freshnessHours) || 48,
      });
      setShowCreateModal(false);
      setFormData({ commodityId: '', mandiId: '', targetPrice: '', condition: 'gte', freshnessHours: '48' });
      setFormErrors({});
      setActionMsg({ type: 'success', text: t(lang, 'p8.alerts.created') });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  const handleToggleActive = async (alert) => {
    try {
      await updateAlert(alert.id, { isActive: !alert.isActive });
      setActionMsg({ type: 'success', text: t(lang, 'p8.alerts.updated') });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  const handleDelete = async (alertId) => {
    if (!window.confirm(t(lang, 'p8.alerts.confirmDelete'))) return;
    try {
      await deleteAlert(alertId);
      setActionMsg({ type: 'success', text: t(lang, 'p8.alerts.deleted') });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  return (
    <div className="phase8-page">
      <header className="phase8-page__header">
        <div>
          <h1 className="phase8-page__title">{t(lang, 'p8.alerts.title')}</h1>
          <p className="phase8-page__subtitle">{t(lang, 'p8.alerts.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="phase8-btn phase8-btn--sm"
          >
            + {t(lang, 'p8.alerts.create')}
          </button>
        </div>
      </header>

      {/* Quick Navigation */}
      <nav className="phase8-quick-nav">
        <Link to="/farmer/dashboard" className="phase8-quick-nav__item">📊 {t(lang, 'p8.nav.dashboard')}</Link>
        <Link to="/farmer/favorites" className="phase8-quick-nav__item">⭐ {t(lang, 'p8.nav.favorites')}</Link>
        <Link to="/farmer/alerts" className="phase8-quick-nav__item phase8-quick-nav__item--active">🔔 {t(lang, 'p8.nav.alertMgmt')}</Link>
        <Link to="/farmer/history" className="phase8-quick-nav__item">📋 {t(lang, 'p8.nav.history')}</Link>
        <Link to="/farmer/preferences" className="phase8-quick-nav__item">⚙️ {t(lang, 'p8.nav.preferences')}</Link>
      </nav>

      {/* Genuine Data Safety Guarantee */}
      <div className="phase8-data-note">
        <span className="phase8-data-note__icon">✓</span>
        <span>{t(lang, 'p8.alerts.evalNote')}</span>
      </div>

      {actionMsg && (
        <div className={`phase8-data-note ${actionMsg.type === 'error' ? 'phase8-badge--alert' : ''}`}>
          <span>{actionMsg.text}</span>
        </div>
      )}

      {status === 'loading' ? (
        <div className="phase8-page--loading">
          <div className="phase8-spinner" />
          <p>{t(lang, 'p8.alerts.loading')}</p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="phase8-empty">
          <p>{t(lang, 'p8.alerts.empty')}</p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="phase8-btn"
          >
            + {t(lang, 'p8.alerts.create')}
          </button>
        </div>
      ) : (
        <div className="phase8-alert-grid">
          {alerts.map((alert) => {
            const condKey = alert.condition === 'gte' ? 'p8.alerts.condition.gte' : 'p8.alerts.condition.lte';
            return (
              <div key={alert.id} className="phase8-alert-card">
                <div className="phase8-alert-card__row">
                  <span className="phase8-alert-card__commodity">{alert.commodity?.name}</span>
                  <span className={`phase8-badge ${alert.isActive ? 'phase8-badge--success' : 'phase8-badge--neutral'}`}>
                    {alert.isActive ? t(lang, 'p8.alerts.active') : t(lang, 'p8.alerts.inactive')}
                  </span>
                </div>
                <div className="text-sm text-on-surface-variant">
                  {alert.mandi?.name}, {alert.mandi?.district || alert.mandi?.state}
                </div>
                <div className="phase8-alert-card__detail">
                  <span className="text-xs text-on-surface-variant">{t(lang, condKey)}</span>
                  <span className="phase8-alert-card__price">
                    ₹{Number(alert.targetPrice).toLocaleString('en-IN')}/{alert.priceUnit || 'quintal'}
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant">
                  {t(lang, 'p8.alerts.freshnessHours')}: {alert.freshnessHours}h
                </div>
                {alert.lastTriggeredAt ? (
                  <div className="phase8-alert-card__triggered">
                    {t(lang, 'p8.alerts.lastTriggered', { date: new Date(alert.lastTriggeredAt).toLocaleDateString('en-IN') })}
                  </div>
                ) : (
                  <div className="phase8-alert-card__triggered">
                    {t(lang, 'p8.alerts.neverTriggered')}
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-surface-container mt-2">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(alert)}
                    className="phase8-btn phase8-btn--outline phase8-btn--sm"
                  >
                    {alert.isActive ? t(lang, 'p8.alerts.disable') : t(lang, 'p8.alerts.enable')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(alert.id)}
                    className="phase8-btn phase8-btn--danger phase8-btn--sm"
                  >
                    {t(lang, 'p8.alerts.delete')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Alert Modal Dialog */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface p-6 rounded-2xl max-w-md w-full shadow-xl border border-outline-variant/30 flex flex-col gap-4">
            <h3 className="text-lg font-bold text-on-surface">{t(lang, 'p8.alerts.create')}</h3>
            <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
              <div className="phase8-form-group">
                <label className="phase8-label">{t(lang, 'p8.alerts.commodity')}</label>
                <select
                  className="phase8-select"
                  value={formData.commodityId}
                  onChange={(e) => setFormData({ ...formData, commodityId: e.target.value })}
                >
                  <option value="">{t(lang, 'p8.favorites.searchCommodity') || 'Select crop...'}</option>
                  {allCommodities.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} {c.hindi_name ? `(${c.hindi_name})` : ''}</option>
                  ))}
                </select>
                {formErrors.commodityId && <span className="text-xs text-error">{formErrors.commodityId}</span>}
              </div>

              <div className="phase8-form-group">
                <label className="phase8-label">{t(lang, 'p8.alerts.mandi')}</label>
                <select
                  className="phase8-select"
                  value={formData.mandiId}
                  onChange={(e) => setFormData({ ...formData, mandiId: e.target.value })}
                >
                  <option value="">{t(lang, 'p8.favorites.searchMandi') || 'Select mandi...'}</option>
                  {allMandis.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}, {m.district || m.state}</option>
                  ))}
                </select>
                {formErrors.mandiId && <span className="text-xs text-error">{formErrors.mandiId}</span>}
              </div>

              <div className="phase8-form-group">
                <label className="phase8-label">{t(lang, 'p8.alerts.targetPrice')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  placeholder="e.g. 2500"
                  className="phase8-input"
                  value={formData.targetPrice}
                  onChange={(e) => setFormData({ ...formData, targetPrice: e.target.value })}
                />
                {formErrors.targetPrice && <span className="text-xs text-error">{formErrors.targetPrice}</span>}
              </div>

              <div className="phase8-form-group">
                <label className="phase8-label">{t(lang, 'p8.alerts.condition')}</label>
                <select
                  className="phase8-select"
                  value={formData.condition}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                >
                  <option value="gte">{t(lang, 'p8.alerts.condition.gte')}</option>
                  <option value="lte">{t(lang, 'p8.alerts.condition.lte')}</option>
                </select>
              </div>

              <div className="phase8-form-group">
                <label className="phase8-label">{t(lang, 'p8.alerts.freshnessHours')}</label>
                <input
                  type="number"
                  min="1"
                  max="720"
                  className="phase8-input"
                  value={formData.freshnessHours}
                  onChange={(e) => setFormData({ ...formData, freshnessHours: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="phase8-btn phase8-btn--outline"
                >
                  Cancel
                </button>
                <button type="submit" className="phase8-btn">
                  {t(lang, 'p8.alerts.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
