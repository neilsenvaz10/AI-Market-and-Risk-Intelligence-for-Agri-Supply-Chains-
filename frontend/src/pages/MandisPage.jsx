import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { translateLocation } from '../constants/profile';
import { t } from '../i18n/strings';
import { getLatestMandiPrices } from '../services/api';

// Translated names for the seeded mandis; other mandis use the name from the API
const MANDI_NAME_KEYS = {
  MH_PUNE_APMC: 'mandis.puneName',
  MH_AHM_APMC: 'mandis.ahmednagarName',
  MH_NSK_MAIN: 'mandis.nashikName',
  MH_BAR_APMC: 'mandis.baramatiName',
};

const SOURCE_LABELS = {
  DATA_GOV_IN: 'AGMARKNET / data.gov.in',
  AGMARKNET: 'AGMARKNET / data.gov.in',
  CEDA: 'CEDA (Ashoka University)',
};

const DATE_LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

const TREND_CHIP_STYLES = {
  up: 'bg-secondary-container text-on-secondary-container',
  down: 'bg-error-container text-error',
  stable: 'bg-surface-container-high text-on-surface-variant',
};

const formatReportDate = (value, language) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(DATE_LOCALES[language] || 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Arrivals are optional in source feeds (stored as 0 when missing), so 0 means "not reported"
const arrivalKey = (quantity) => {
  const value = Number(quantity);
  if (!(value > 0)) return 'mandiFeed.notReported';
  if (value > 600) return 'mandis.volume.veryHigh';
  if (value > 350) return 'mandis.volume.high';
  if (value > 200) return 'mandis.volume.moderate';
  return 'mandis.volume.medium';
};

export default function MandisPage() {
  const { language } = useAuth();
  const [feed, setFeed] = useState({ status: 'loading', rows: [] }); // 'loading' | 'ready' | 'error'
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    getLatestMandiPrices({ commodity: 'ONION' })
      .then((res) => {
        if (isMounted) setFeed({ status: 'ready', rows: Array.isArray(res?.data) ? res.data : [] });
      })
      .catch(() => {
        // No fallback prices: surface the failure instead of showing stale numbers
        if (isMounted) setFeed({ status: 'error', rows: [] });
      });

    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  const retry = () => {
    setFeed({ status: 'loading', rows: [] });
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
            {hasSampleData && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                {t(language, 'mandiFeed.sampleBadge')}
              </span>
            )}
          </div>
        </div>
        {feed.status === 'ready' && (
          <span className="px-3 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-full">
            {feed.rows.length} {t(language, 'mandis.nearby')}
          </span>
        )}
      </div>

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
          const trendPercent = Number(mandi.trend_percent) || 0;
          const source = mandi.is_sample_data
            ? t(language, 'mandiFeed.sampleSource')
            : SOURCE_LABELS[mandi.source] || mandi.source;

          return (
            <div key={mandi.id} className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-on-surface text-body-lg">
                  {nameKey ? t(language, nameKey) : mandi.mandi_name}
                </span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${TREND_CHIP_STYLES[mandi.trend_direction] || TREND_CHIP_STYLES.stable}`}>
                  {trendPercent > 0 ? '+' : ''}{trendPercent}% {t(language, 'mandiFeed.vsPrevious')}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-body-sm text-on-surface-variant">{t(language, 'mandis.modalPrice')}</span>
                  <div className="font-headline-md text-headline-md text-primary">
                    ₹{Number(mandi.modal_price).toLocaleString('en-IN')} / {t(language, mandi.unit === 'kg' ? 'unit.kg' : 'unit.quintal')}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-body-sm text-on-surface-variant flex items-center justify-end gap-0.5">
                    <span className="material-symbols-outlined text-[14px]">location_on</span>
                    {translateLocation(`${mandi.district}, ${mandi.state}`, language)}
                  </span>
                  <span className="block text-xs font-medium text-secondary">
                    {t(language, 'mandis.arrival')}: {t(language, arrivalKey(mandi.arrivals_quantity))}
                  </span>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant">
                {t(language, 'mandiFeed.reported', { date: formatReportDate(mandi.price_date, language) })}
                {' · '}
                {t(language, 'mandiFeed.source', { source })}
              </p>
              <Link
                to="/recommendation"
                className="mt-2 w-full py-2 bg-surface-container-low hover:bg-surface-container text-primary text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <span>{t(language, 'mandis.viewRoute')}</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
