import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { translateLocation } from '../constants/profile';
import { t } from '../i18n/strings';
import { getLatestMandiPrices, getCommodityDailyReports } from '../services/api';
import { formatReportDate, formatTrend, hasTrend, sourceLabel } from '../utils/mandiFeed';
import ForecastPanel from '../components/ForecastPanel';

// Translated names for the seeded mandis; other mandis use the name from the API
const MANDI_NAME_KEYS = {
  MH_PUNE_APMC: 'mandis.puneName',
  MH_AHM_APMC: 'mandis.ahmednagarName',
  MH_NSK_MAIN: 'mandis.nashikName',
  MH_BAR_APMC: 'mandis.baramatiName',
};

const TREND_CHIP_STYLES = {
  up: 'bg-secondary-container text-on-secondary-container',
  down: 'bg-error-container text-error',
  stable: 'bg-surface-container-high text-on-surface-variant',
};

// Arrivals are shown as reported (tonnes); missing arrivals are null and shown as "not reported".
const formatArrivals = (row, language) =>
  row.arrivals_quantity === null || row.arrivals_quantity === undefined
    ? t(language, 'mandiFeed.notReported')
    : `${Number(row.arrivals_quantity).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${t(language, 'unit.tonne')}`;

export default function MandisPage() {
  const { language } = useAuth();
  const [activeTab, setActiveTab] = useState('mandis'); // 'mandis' | 'national'
  const [feed, setFeed] = useState({ status: 'loading', rows: [] }); // 'loading' | 'ready' | 'error'
  const [nationalFeed, setNationalFeed] = useState({ status: 'loading', rows: [], meta: null });
  const [reloadKey, setReloadKey] = useState(0);
  // Phase 4: which mandi's price forecast is expanded (one at a time, fetched on demand).
  const [forecastMandiId, setForecastMandiId] = useState(null);

  useEffect(() => {
    let isMounted = true;
    getLatestMandiPrices({ commodity: 'ONION' })
      .then((res) => {
        if (isMounted) setFeed({ status: 'ready', rows: Array.isArray(res?.data) ? res.data : [] });
      })
      .catch(() => {
        if (isMounted) setFeed({ status: 'error', rows: [] });
      });

    getCommodityDailyReports({ limit: 16 })
      .then((res) => {
        if (isMounted) setNationalFeed({ status: 'ready', rows: Array.isArray(res?.data) ? res.data : [], meta: res?.meta || null });
      })
      .catch(() => {
        if (isMounted) setNationalFeed({ status: 'error', rows: [], meta: null });
      });

    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  const retry = () => {
    setFeed({ status: 'loading', rows: [] });
    setNationalFeed({ status: 'loading', rows: [], meta: null });
    setReloadKey((key) => key + 1);
  };

  const hasSampleData = feed.rows.some((row) => row.is_sample_data);

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">
            {t(language, 'mandis.title')}
          </h2>
          <div className="flex items-center gap-1.5">
            <p className="text-body-sm text-on-surface-variant">
              {t(language, 'mandis.subtitle')}
            </p>
            {activeTab === 'mandis' && hasSampleData && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                {t(language, 'mandiFeed.sampleBadge')}
              </span>
            )}
          </div>
        </div>
        {activeTab === 'mandis' && feed.status === 'ready' && (
          <span className="px-3 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-full">
            {feed.rows.length} {t(language, 'mandis.nearby')}
          </span>
        )}
        {activeTab === 'national' && nationalFeed.status === 'ready' && (
          <span className="px-3 py-1 bg-primary-container text-on-primary-container text-xs font-bold rounded-full">
            {nationalFeed.rows.length} Benchmarks
          </span>
        )}
      </div>

      {/* Scope / Granularity Switcher */}
      <div className="flex bg-surface-container-high p-1 rounded-xl mb-4 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('mandis')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'mandis'
              ? 'bg-surface text-primary shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">storefront</span>
          <span>Local APMC Mandis</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('national')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'national'
              ? 'bg-surface text-primary shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">public</span>
          <span>National Benchmarks (AGMARKNET)</span>
        </button>
      </div>

      {/* Local Mandis Tab */}
      {activeTab === 'mandis' && (
        <>
          {feed.status === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-on-surface-variant" role="status">
              <span className="material-symbols-outlined animate-spin text-secondary text-[24px]">progress_activity</span>
              <p className="text-body-sm">{t(language, 'mandiFeed.loading')}</p>
            </div>
          )}

          {feed.status === 'error' && (
            <div className="bg-error-container text-on-error-container p-4 rounded-xl shadow-sm flex items-start gap-3" role="alert">
              <span className="material-symbols-outlined text-error text-[22px]">error</span>
              <div className="flex-1">
                <p className="font-body-sm text-xs">{t(language, 'mandiFeed.error')}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-bold shadow-sm active:scale-95 transition-transform"
                >
                  {t(language, 'mandiFeed.retry')}
                </button>
              </div>
            </div>
          )}

          {feed.status === 'ready' && feed.rows.length === 0 && (
            <p className="bg-surface-container-lowest p-4 rounded-xl text-body-sm text-on-surface-variant">
              {t(language, 'mandiFeed.empty')}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {feed.rows.map((mandi) => {
              const nameKey = MANDI_NAME_KEYS[mandi.mandi_code];

              return (
                <div key={mandi.id} className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-on-surface text-body-lg">
                      {nameKey ? t(language, nameKey) : mandi.mandi_name}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${hasTrend(mandi) ? TREND_CHIP_STYLES[mandi.trend_direction] : TREND_CHIP_STYLES.stable}`}>
                      {hasTrend(mandi) ? `${formatTrend(mandi)} ${t(language, 'mandiFeed.vsPrevious')}` : t(language, 'mandiFeed.noEarlierReport')}
                    </span>
                  </div>
                  {(mandi.variety || mandi.grade) && (
                    <span className="text-xs text-on-surface-variant -mt-1">
                      {[mandi.variety, mandi.grade].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-body-sm text-on-surface-variant">{t(language, 'mandis.modalPrice')}</span>
                      <div className="font-headline-md text-headline-md text-primary">
                        ₹{Number(mandi.modal_price).toLocaleString('en-IN')} / {t(language, 'unit.quintal')}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-body-sm text-on-surface-variant flex items-center justify-end gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">location_on</span>
                        {translateLocation(`${mandi.district}, ${mandi.state}`, language)}
                      </span>
                      <span className="block text-xs font-medium text-secondary">
                        {t(language, 'mandis.arrival')}: {formatArrivals(mandi, language)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    {t(language, 'mandiFeed.reported', { date: formatReportDate(mandi.price_date, language) })}
                    {' · '}
                    {t(language, 'mandiFeed.source', { source: sourceLabel(mandi, language) })}
                  </p>
                  {/* Phase 4: 1-7 day price forecast for this mandi and crop, fetched on demand. */}
                  <button
                    type="button"
                    onClick={() => setForecastMandiId((current) => (current === mandi.mandi_id ? null : mandi.mandi_id))}
                    aria-expanded={forecastMandiId === mandi.mandi_id}
                    className="mt-2 w-full py-2 bg-secondary-container hover:bg-surface-container text-on-secondary-container text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">trending_up</span>
                    <span>
                      {forecastMandiId === mandi.mandi_id
                        ? t(language, 'forecast.hide')
                        : t(language, 'forecast.show')}
                    </span>
                  </button>
                  {forecastMandiId === mandi.mandi_id && (
                    <ForecastPanel commodity={mandi.commodity_code} mandi={mandi.mandi_code} />
                  )}
                  <Link
                    to="/recommendation"
                    className="mt-2 w-full py-2 bg-surface-container-low hover:bg-surface-container text-primary text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1"
                  >
                    <span>{t(language, 'mandis.viewRoute')}</span>
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </Link>
                  <Link
                    to="/risk"
                    className="mt-2 w-full py-2 bg-primary/10 hover:bg-primary/20 text-primary text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">shield_with_heart</span>
                    <span>{t(language, 'risk.title')}</span>
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* National Commodity Benchmarks Tab (AGMARKNET) */}
      {activeTab === 'national' && (
        <>
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mb-3 flex items-start gap-2.5">
            <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">info</span>
            <div className="text-xs text-on-surface">
              <span className="font-bold">Official All-India Macro Data: </span>
              Aggregated daily price & arrival figures reported directly through AGMARKNET (DMI). These represent national benchmarks across all reporting markets, distinct from individual local mandis.
            </div>
          </div>

          {nationalFeed.status === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-on-surface-variant" role="status">
              <span className="material-symbols-outlined animate-spin text-primary text-[24px]">progress_activity</span>
              <p className="text-body-sm">{t(language, 'mandiFeed.loading')}</p>
            </div>
          )}

          {nationalFeed.status === 'error' && (
            <div className="bg-error-container text-on-error-container p-4 rounded-xl shadow-sm flex items-start gap-3" role="alert">
              <span className="material-symbols-outlined text-error text-[22px]">error</span>
              <div className="flex-1">
                <p className="font-body-sm text-xs">Failed to load national commodity benchmarks.</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold shadow-sm active:scale-95 transition-transform"
                >
                  {t(language, 'mandiFeed.retry')}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {nationalFeed.rows.map((report) => {
              const diffMsp = report.msp && report.modal_price
                ? Number((((report.modal_price - report.msp) / report.msp) * 100).toFixed(1))
                : null;

              return (
                <div key={report.id} className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-on-surface text-body-lg">
                        {report.commodity_name}
                      </span>
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-surface-container text-on-surface-variant rounded-md">
                        {report.commodity_group}
                      </span>
                    </div>
                    {report.trend_percent !== null && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${TREND_CHIP_STYLES[report.trend_direction] || TREND_CHIP_STYLES.stable}`}>
                        {report.trend_percent > 0 ? `+${report.trend_percent}%` : `${report.trend_percent}%`} {t(language, 'mandiFeed.vsPrevious')}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline justify-between mt-1">
                    <div>
                      <span className="text-xs text-on-surface-variant block">National Modal Price</span>
                      <div className="font-headline-md text-headline-md text-primary">
                        {report.modal_price !== null
                          ? `₹${Number(report.modal_price).toLocaleString('en-IN')} / ${t(language, 'unit.quintal')}`
                          : <span className="text-on-surface-variant text-body-md font-normal">Not Reported</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      {report.msp !== null && (
                        <div>
                          <span className="text-xs text-on-surface-variant block">Govt. MSP ({report.msp_season})</span>
                          <span className="font-bold text-sm text-on-surface">
                            ₹{Number(report.msp).toLocaleString('en-IN')}
                          </span>
                          {diffMsp !== null && (
                            <span className={`block text-[11px] font-bold ${diffMsp >= 0 ? 'text-secondary' : 'text-error'}`}>
                              {diffMsp >= 0 ? `+${diffMsp}% vs MSP` : `${diffMsp}% vs MSP`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20 text-xs text-on-surface-variant">
                    <span>
                      Total Arrivals: {report.arrivals_quantity !== null
                        ? `${Number(report.arrivals_quantity).toLocaleString('en-IN')} tonnes`
                        : 'Not Reported'}
                    </span>
                    <span className="font-medium text-primary">
                      {formatReportDate(report.report_date, language)}
                    </span>
                  </div>

                  <div className="text-[10px] text-on-surface-variant/80 flex items-center justify-between">
                    <span>Source: {report.source_label || report.source}</span>
                    <span className="px-1.5 py-0.2 rounded bg-surface-container text-on-surface-variant font-mono">
                      {report.geographic_level}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
