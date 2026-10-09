/**
 * FASALYTICS Phase 8 — Farmer Alert History Page
 * Full record of triggered price alerts with genuine observation provenance.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePhase8Api } from '../utils/usePhase8Api';
import { getCommodities, getMandis } from '../services/api';
import { t } from '../i18n/strings';

export default function FarmerHistoryPage() {
  const { language } = useAuth();
  const lang = language || 'en';
  const { getAlertHistory } = usePhase8Api();

  const [history, setHistory] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ commodityId: '', mandiId: '', fromDate: '' });
  const [allCommodities, setAllCommodities] = useState([]);
  const [allMandis, setAllMandis] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);

  const load = useCallback(async (page = 1) => {
    setStatus('loading');
    setError(null);
    try {
      const [histRes, commRes, mandiRes] = await Promise.all([
        getAlertHistory({
          page,
          limit: 10,
          commodityId: filters.commodityId || undefined,
          mandiId: filters.mandiId || undefined,
          fromDate: filters.fromDate || undefined,
        }),
        getCommodities().catch(() => ({ data: [] })),
        getMandis().catch(() => ({ data: [] })),
      ]);
      setHistory(histRes.history || []);
      setPagination(histRes.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 });
      setAllCommodities(Array.isArray(commRes.data) ? commRes.data : []);
      setAllMandis(Array.isArray(mandiRes.data) ? mandiRes.data : []);
      setStatus('ready');
    } catch (err) {
      setError(err.message || t(lang, 'p8.history.error'));
      setStatus('error');
    }
  }, [getAlertHistory, filters, lang]);

  useEffect(() => { load(1); }, [load]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearFilters = () => {
    setFilters({ commodityId: '', mandiId: '', fromDate: '' });
  };

  return (
    <div className="phase8-page">
      <header className="phase8-page__header">
        <div>
          <h1 className="phase8-page__title">{t(lang, 'p8.history.title')}</h1>
          <p className="phase8-page__subtitle">{t(lang, 'p8.history.subtitle')}</p>
        </div>
      </header>

      {/* Quick Navigation */}
      <nav className="phase8-quick-nav">
        <Link to="/farmer/dashboard" className="phase8-quick-nav__item">📊 {t(lang, 'p8.nav.dashboard')}</Link>
        <Link to="/farmer/favorites" className="phase8-quick-nav__item">⭐ {t(lang, 'p8.nav.favorites')}</Link>
        <Link to="/farmer/alerts" className="phase8-quick-nav__item">🔔 {t(lang, 'p8.nav.alertMgmt')}</Link>
        <Link to="/farmer/history" className="phase8-quick-nav__item phase8-quick-nav__item--active">📋 {t(lang, 'p8.nav.history')}</Link>
        <Link to="/farmer/preferences" className="phase8-quick-nav__item">⚙️ {t(lang, 'p8.nav.preferences')}</Link>
      </nav>

      {/* Filters Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-grow sm:flex-grow-0 sm:w-48">
          <label className="text-xs font-semibold text-on-surface-variant">{t(lang, 'p8.history.filterCommodity')}</label>
          <select
            className="phase8-select text-xs"
            value={filters.commodityId}
            onChange={(e) => handleFilterChange('commodityId', e.target.value)}
          >
            <option value="">All Crops</option>
            {allCommodities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-grow sm:flex-grow-0 sm:w-48">
          <label className="text-xs font-semibold text-on-surface-variant">{t(lang, 'p8.history.filterMandi')}</label>
          <select
            className="phase8-select text-xs"
            value={filters.mandiId}
            onChange={(e) => handleFilterChange('mandiId', e.target.value)}
          >
            <option value="">All Mandis</option>
            {allMandis.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-grow sm:flex-grow-0 sm:w-40">
          <label className="text-xs font-semibold text-on-surface-variant">{t(lang, 'p8.history.filterFrom')}</label>
          <input
            type="date"
            className="phase8-input text-xs"
            value={filters.fromDate}
            onChange={(e) => handleFilterChange('fromDate', e.target.value)}
          />
        </div>

        {(filters.commodityId || filters.mandiId || filters.fromDate) && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="phase8-btn phase8-btn--outline phase8-btn--sm"
          >
            {t(lang, 'p8.history.clearFilters')}
          </button>
        )}
      </div>

      {error && (
        <div className="phase8-data-note phase8-badge--alert">
          <span>{error}</span>
        </div>
      )}

      {status === 'loading' ? (
        <div className="phase8-page--loading">
          <div className="phase8-spinner" />
          <p>{t(lang, 'p8.history.loading')}</p>
        </div>
      ) : history.length === 0 ? (
        <div className="phase8-empty">
          <p>{t(lang, 'p8.history.empty')}</p>
          <Link to="/farmer/alerts" className="phase8-btn phase8-btn--sm">
            {t(lang, 'p8.alerts.create')}
          </Link>
        </div>
      ) : (
        <div className="phase8-trigger-list">
          {history.map((item) => {
            const condKey = item.condition === 'gte' ? 'p8.history.condition.gte' : 'p8.history.condition.lte';
            return (
              <div key={item.id} className="phase8-trigger-card">
                <div className="phase8-trigger-card__header flex justify-between items-baseline">
                  <div>
                    <strong className="text-base text-on-surface">{item.commodity?.name}</strong>
                    <span className="text-sm text-on-surface-variant"> — {item.mandi?.name}, {item.mandi?.state}</span>
                  </div>
                  <span className="text-xs text-on-surface-variant">
                    {t(lang, 'p8.history.triggeredAt', { date: new Date(item.triggeredAt).toLocaleDateString(lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN') })}
                  </span>
                </div>

                <div className="phase8-trigger-card__prices my-1">
                  <span>{t(lang, 'p8.history.targetPrice', { price: Number(item.targetPrice).toLocaleString('en-IN') })}</span>
                  <span className="font-bold text-primary">
                    {t(lang, 'p8.history.actualPrice', { price: Number(item.actualPrice).toLocaleString('en-IN') })}
                  </span>
                </div>

                <div className="phase8-trigger-card__meta">
                  <span className="phase8-badge phase8-badge--neutral">{t(lang, condKey)}</span>
                  <span>{t(lang, 'p8.history.observedOn', { date: item.observationDate })}</span>
                  <span>{t(lang, 'p8.history.source', { source: item.observationSource })}</span>
                </div>
              </div>
            );
          })}

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-between items-center pt-4">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => load(pagination.page - 1)}
                className="phase8-btn phase8-btn--outline phase8-btn--sm"
              >
                ← Prev
              </button>
              <span className="text-sm text-on-surface-variant">
                {t(lang, 'p8.history.pagination', { page: pagination.page, total: pagination.totalPages })}
              </span>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => load(pagination.page + 1)}
                className="phase8-btn phase8-btn--outline phase8-btn--sm"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
