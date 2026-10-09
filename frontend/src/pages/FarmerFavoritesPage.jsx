/**
 * FASALYTICS Phase 8 — Farmer Favorites Page
 * Manage favorite commodities and mandis for personalized tracking.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePhase8Api } from '../utils/usePhase8Api';
import { getCommodities, getMandis } from '../services/api';
import { t } from '../i18n/strings';

export default function FarmerFavoritesPage() {
  const { language } = useAuth();
  const lang = language || 'en';
  const { getFavorites, addFavorite, removeFavorite, setDefault } = usePhase8Api();

  const [favCommodities, setFavCommodities] = useState([]);
  const [favMandis, setFavMandis] = useState([]);
  const [allCommodities, setAllCommodities] = useState([]);
  const [allMandis, setAllMandis] = useState([]);

  const [selectedCommodityId, setSelectedCommodityId] = useState('');
  const [selectedMandiId, setSelectedMandiId] = useState('');
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [actionMsg, setActionMsg] = useState(null); // { type: 'success'|'error', text: string }

  const load = useCallback(async () => {
    setStatus('loading');
    setActionMsg(null);
    try {
      const [favRes, commRes, mandiRes] = await Promise.all([
        getFavorites(),
        getCommodities().catch(() => ({ data: [] })),
        getMandis().catch(() => ({ data: [] })),
      ]);
      setFavCommodities(favRes.favoriteCommodities || []);
      setFavMandis(favRes.favoriteMandis || []);
      setAllCommodities(Array.isArray(commRes.data) ? commRes.data : []);
      setAllMandis(Array.isArray(mandiRes.data) ? mandiRes.data : []);
      setStatus('ready');
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || t(lang, 'p8.favorites.error') });
      setStatus('error');
    }
  }, [getFavorites, lang]);

  useEffect(() => { load(); }, [load]);

  const handleAddCommodity = async (e) => {
    e.preventDefault();
    if (!selectedCommodityId) return;
    try {
      await addFavorite('commodity', Number(selectedCommodityId));
      setSelectedCommodityId('');
      setActionMsg({ type: 'success', text: t(lang, 'p8.favorites.commodities') + ' updated' });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  const handleAddMandi = async (e) => {
    e.preventDefault();
    if (!selectedMandiId) return;
    try {
      await addFavorite('mandi', Number(selectedMandiId));
      setSelectedMandiId('');
      setActionMsg({ type: 'success', text: t(lang, 'p8.favorites.mandis') + ' updated' });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  const handleRemove = async (type, id) => {
    try {
      await removeFavorite(id, type);
      setActionMsg({ type: 'success', text: t(lang, 'p8.favorites.remove') + ' success' });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  const handleSetDefault = async (type, id) => {
    try {
      await setDefault(type, id);
      setActionMsg({ type: 'success', text: t(lang, 'p8.favorites.setDefault') + ' success' });
      load();
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    }
  };

  return (
    <div className="phase8-page">
      <header className="phase8-page__header">
        <div>
          <h1 className="phase8-page__title">{t(lang, 'p8.favorites.title')}</h1>
          <p className="phase8-page__subtitle">{t(lang, 'p8.favorites.subtitle')}</p>
        </div>
        <Link to="/farmer/dashboard" className="phase8-btn phase8-btn--outline phase8-btn--sm">
          ← {t(lang, 'p8.nav.dashboard')}
        </Link>
      </header>

      {/* Quick Navigation */}
      <nav className="phase8-quick-nav">
        <Link to="/farmer/dashboard" className="phase8-quick-nav__item">📊 {t(lang, 'p8.nav.dashboard')}</Link>
        <Link to="/farmer/favorites" className="phase8-quick-nav__item phase8-quick-nav__item--active">⭐ {t(lang, 'p8.nav.favorites')}</Link>
        <Link to="/farmer/alerts" className="phase8-quick-nav__item">🔔 {t(lang, 'p8.nav.alertMgmt')}</Link>
        <Link to="/farmer/history" className="phase8-quick-nav__item">📋 {t(lang, 'p8.nav.history')}</Link>
        <Link to="/farmer/preferences" className="phase8-quick-nav__item">⚙️ {t(lang, 'p8.nav.preferences')}</Link>
      </nav>

      {actionMsg && (
        <div className={`phase8-data-note ${actionMsg.type === 'error' ? 'phase8-badge--alert' : ''}`}>
          <span>{actionMsg.text}</span>
        </div>
      )}

      {status === 'loading' ? (
        <div className="phase8-page--loading">
          <div className="phase8-spinner" />
          <p>{t(lang, 'p8.favorites.loading')}</p>
        </div>
      ) : (
        <>
          {/* Favorite Commodities Section */}
          <section className="phase8-section">
            <h2 className="phase8-section__title">{t(lang, 'p8.favorites.commodities')}</h2>

            {/* Add Commodity Form */}
            <form onSubmit={handleAddCommodity} className="flex gap-2 items-center flex-wrap">
              <select
                className="phase8-select flex-grow"
                value={selectedCommodityId}
                onChange={(e) => setSelectedCommodityId(e.target.value)}
              >
                <option value="">{t(lang, 'p8.favorites.searchCommodity') || 'Select crop...'}</option>
                {allCommodities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.hindi_name ? `(${c.hindi_name})` : ''}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!selectedCommodityId} className="phase8-btn phase8-btn--sm">
                + {t(lang, 'p8.favorites.addCommodity')}
              </button>
            </form>

            {favCommodities.length === 0 ? (
              <div className="phase8-empty">
                <p>{t(lang, 'p8.dashboard.noFavCommodities')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {favCommodities.map((fc) => (
                  <div key={fc.id} className="phase8-card flex flex-row items-center justify-between p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-on-surface">{fc.commodity.name}</span>
                      {fc.commodity.hindiName && (
                        <span className="text-xs text-on-surface-variant">({fc.commodity.hindiName})</span>
                      )}
                      {fc.isDefault && (
                        <span className="phase8-badge phase8-badge--success">{t(lang, 'p8.favorites.default')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!fc.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault('commodity', fc.commodityId)}
                          className="phase8-btn phase8-btn--outline phase8-btn--sm"
                        >
                          {t(lang, 'p8.favorites.setDefault')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove('commodity', fc.id)}
                        className="phase8-btn phase8-btn--danger phase8-btn--sm"
                      >
                        {t(lang, 'p8.favorites.remove')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Favorite Mandis Section */}
          <section className="phase8-section">
            <h2 className="phase8-section__title">{t(lang, 'p8.favorites.mandis')}</h2>

            {/* Add Mandi Form */}
            <form onSubmit={handleAddMandi} className="flex gap-2 items-center flex-wrap">
              <select
                className="phase8-select flex-grow"
                value={selectedMandiId}
                onChange={(e) => setSelectedMandiId(e.target.value)}
              >
                <option value="">{t(lang, 'p8.favorites.searchMandi') || 'Select mandi...'}</option>
                {allMandis.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}, {m.district || m.state}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!selectedMandiId} className="phase8-btn phase8-btn--sm">
                + {t(lang, 'p8.favorites.addMandi')}
              </button>
            </form>

            {favMandis.length === 0 ? (
              <div className="phase8-empty">
                <p>{t(lang, 'p8.dashboard.noFavMandis')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {favMandis.map((fm) => (
                  <div key={fm.id} className="phase8-card flex flex-row items-center justify-between p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-on-surface">{fm.mandi.name}</span>
                      <span className="text-xs text-on-surface-variant">({fm.mandi.state})</span>
                      {fm.isDefault && (
                        <span className="phase8-badge phase8-badge--success">{t(lang, 'p8.favorites.default')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!fm.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault('mandi', fm.mandiId)}
                          className="phase8-btn phase8-btn--outline phase8-btn--sm"
                        >
                          {t(lang, 'p8.favorites.setDefault')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove('mandi', fm.id)}
                        className="phase8-btn phase8-btn--danger phase8-btn--sm"
                      >
                        {t(lang, 'p8.favorites.remove')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
