/**
 * FASALYTICS Phase 8 — Farmer Preferences Page
 * Manage language, default crops/mandis, in-app notifications and alert digest settings.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePhase8Api } from '../utils/usePhase8Api';
import { getCommodities, getMandis } from '../services/api';
import { LANGUAGES } from '../i18n/languages';
import { t } from '../i18n/strings';

export default function FarmerPreferencesPage() {
  const { language, setLanguage } = useAuth();
  const lang = language || 'en';
  const { getPreferences, updatePreferences } = usePhase8Api();

  const [prefs, setPrefs] = useState({
    preferredLanguage: 'en',
    defaultCommodityId: null,
    defaultMandiId: null,
    notifyInApp: true,
    alertDigest: 'immediate',
  });
  const [allCommodities, setAllCommodities] = useState([]);
  const [allMandis, setAllMandis] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [actionMsg, setActionMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setActionMsg(null);
    try {
      const [prefRes, commRes, mandiRes] = await Promise.all([
        getPreferences(),
        getCommodities().catch(() => ({ data: [] })),
        getMandis().catch(() => ({ data: [] })),
      ]);
      const p = prefRes.preferences;
      if (p) {
        setPrefs({
          preferredLanguage: p.preferredLanguage || 'en',
          defaultCommodityId: p.defaultCommodity?.id || null,
          defaultMandiId: p.defaultMandi?.id || null,
          notifyInApp: p.notifyInApp ?? true,
          alertDigest: p.alertDigest || 'immediate',
        });
      }
      setAllCommodities(Array.isArray(commRes.data) ? commRes.data : []);
      setAllMandis(Array.isArray(mandiRes.data) ? mandiRes.data : []);
      setStatus('ready');
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || t(lang, 'p8.prefs.error') });
      setStatus('error');
    }
  }, [getPreferences, lang]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setActionMsg(null);
    try {
      await updatePreferences({
        preferredLanguage: prefs.preferredLanguage,
        defaultCommodityId: prefs.defaultCommodityId ? Number(prefs.defaultCommodityId) : null,
        defaultMandiId: prefs.defaultMandiId ? Number(prefs.defaultMandiId) : null,
        notifyInApp: prefs.notifyInApp,
        alertDigest: prefs.alertDigest,
      });

      // Synchronize frontend language if changed
      if (prefs.preferredLanguage !== language) {
        await setLanguage(prefs.preferredLanguage).catch(() => {});
      }

      setActionMsg({ type: 'success', text: t(prefs.preferredLanguage, 'p8.prefs.saved') });
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || t(lang, 'p8.prefs.error') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="phase8-page">
      <header className="phase8-page__header">
        <div>
          <h1 className="phase8-page__title">{t(lang, 'p8.prefs.title')}</h1>
          <p className="phase8-page__subtitle">{t(lang, 'p8.prefs.subtitle')}</p>
        </div>
      </header>

      {/* Quick Navigation */}
      <nav className="phase8-quick-nav">
        <Link to="/farmer/dashboard" className="phase8-quick-nav__item">📊 {t(lang, 'p8.nav.dashboard')}</Link>
        <Link to="/farmer/favorites" className="phase8-quick-nav__item">⭐ {t(lang, 'p8.nav.favorites')}</Link>
        <Link to="/farmer/alerts" className="phase8-quick-nav__item">🔔 {t(lang, 'p8.nav.alertMgmt')}</Link>
        <Link to="/farmer/history" className="phase8-quick-nav__item">📋 {t(lang, 'p8.nav.history')}</Link>
        <Link to="/farmer/preferences" className="phase8-quick-nav__item phase8-quick-nav__item--active">⚙️ {t(lang, 'p8.nav.preferences')}</Link>
      </nav>

      {actionMsg && (
        <div className={`phase8-data-note ${actionMsg.type === 'error' ? 'phase8-badge--alert' : ''}`}>
          <span>{actionMsg.text}</span>
        </div>
      )}

      {status === 'loading' ? (
        <div className="phase8-page--loading">
          <div className="phase8-spinner" />
          <p>{t(lang, 'p8.prefs.loading')}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-surface p-6 rounded-2xl shadow-sm border border-outline-variant/30 flex flex-col gap-5">
          {/* Preferred Language */}
          <div className="phase8-form-group">
            <label className="phase8-label">{t(lang, 'p8.prefs.language')}</label>
            <div className="flex gap-3 flex-wrap">
              {LANGUAGES.map((l) => (
                <label
                  key={l.code}
                  className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${
                    prefs.preferredLanguage === l.code
                      ? 'border-primary bg-primary-container/20 font-bold text-primary'
                      : 'border-outline-variant/50 hover:bg-surface-container-low text-on-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="preferredLanguage"
                    value={l.code}
                    checked={prefs.preferredLanguage === l.code}
                    onChange={(e) => setPrefs({ ...prefs, preferredLanguage: e.target.value })}
                    className="w-4 h-4 text-primary"
                  />
                  <span>{l.label} ({l.nativeLabel})</span>
                </label>
              ))}
            </div>
          </div>

          {/* Default Crop */}
          <div className="phase8-form-group">
            <label className="phase8-label">{t(lang, 'p8.prefs.defaultCommodity')}</label>
            <select
              className="phase8-select"
              value={prefs.defaultCommodityId || ''}
              onChange={(e) => setPrefs({ ...prefs, defaultCommodityId: e.target.value || null })}
            >
              <option value="">{t(lang, 'p8.prefs.noCommodityDefault')}</option>
              {allCommodities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Default Mandi */}
          <div className="phase8-form-group">
            <label className="phase8-label">{t(lang, 'p8.prefs.defaultMandi')}</label>
            <select
              className="phase8-select"
              value={prefs.defaultMandiId || ''}
              onChange={(e) => setPrefs({ ...prefs, defaultMandiId: e.target.value || null })}
            >
              <option value="">{t(lang, 'p8.prefs.noMandiDefault')}</option>
              {allMandis.map((m) => (
                <option key={m.id} value={m.id}>{m.name}, {m.district || m.state}</option>
              ))}
            </select>
          </div>

          {/* In-App Notifications */}
          <div className="flex items-center justify-between py-2 border-t border-b border-surface-container">
            <div>
              <span className="font-semibold text-on-surface text-sm block">{t(lang, 'p8.prefs.notifyInApp')}</span>
              <span className="text-xs text-on-surface-variant">Receive in-app alerts when price conditions are met</span>
            </div>
            <input
              type="checkbox"
              checked={prefs.notifyInApp}
              onChange={(e) => setPrefs({ ...prefs, notifyInApp: e.target.checked })}
              className="w-5 h-5 text-primary rounded"
            />
          </div>

          {/* Alert Digest */}
          <div className="phase8-form-group">
            <label className="phase8-label">{t(lang, 'p8.prefs.alertDigest')}</label>
            <select
              className="phase8-select"
              value={prefs.alertDigest}
              onChange={(e) => setPrefs({ ...prefs, alertDigest: e.target.value })}
            >
              <option value="immediate">{t(lang, 'p8.prefs.alertDigest.immediate')}</option>
              <option value="daily">{t(lang, 'p8.prefs.alertDigest.daily')}</option>
              <option value="off">{t(lang, 'p8.prefs.alertDigest.off')}</option>
            </select>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="phase8-btn w-full sm:w-auto"
            >
              {saving ? 'Saving...' : t(lang, 'p8.prefs.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
