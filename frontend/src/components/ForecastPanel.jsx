import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';
import { getForecast } from '../services/api';
import { formatReportDate } from '../utils/mandiFeed';

/**
 * Phase 4 — price forecast panel for one commodity/mandi pair.
 *
 * Renders the forecast returned by GET /api/forecast/:commodity/:mandi and keeps
 * the four Phase 4 UI states explicit:
 *   loading      -> "Loading forecast..."
 *   empty        -> "No forecast available yet."            (available: false, NO_FORECAST)
 *   insufficient -> "Not enough historical market data..."  (INSUFFICIENT_HISTORY / NO_MARKET_DATA)
 *   error        -> "Forecast unavailable."                 (request failed)
 *
 * A forecast is never rendered as an observed price: the observed price is shown
 * from the API's last_observed_price and every projection is labelled "Forecast"
 * with its prediction interval.
 */

const REASON_TO_KEY = {
  NO_MARKET_DATA: 'forecast.noMarketData',
  INSUFFICIENT_HISTORY: 'forecast.insufficient',
  NO_FORECAST: 'forecast.noForecast',
  NO_FORECAST_FOR_FILTER: 'forecast.filtered',
};

const formatRupees = (value) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const horizonLabel = (forecast, language) =>
  Number(forecast.horizon_days) === 1
    ? t(language, 'forecast.tomorrow')
    : t(language, 'forecast.day', { day: Number(forecast.horizon_days) });

export default function ForecastPanel({ commodity, mandi, title }) {
  const { language } = useAuth();
  // `result` holds only a COMPLETED fetch, so "loading" is derived (result === null)
  // instead of being written by the effect.
  const [result, setResult] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Without both identifiers there is nothing to request: derive that during render
  // rather than setting state from an effect.
  const isIdentified = Boolean(commodity && mandi);

  useEffect(() => {
    if (!isIdentified) return undefined;
    let isMounted = true;
    getForecast(commodity, mandi)
      .then((res) => {
        if (!isMounted) return;
        if (res?.available && Array.isArray(res.data) && res.data.length > 0) {
          setResult({ status: 'ready', payload: res, reason: null });
        } else {
          // A valid response with no forecast: show the reason, never a fake price.
          setResult({ status: 'empty', payload: res ?? null, reason: res?.reason ?? { code: 'NO_FORECAST' } });
        }
      })
      .catch(() => {
        if (isMounted) setResult({ status: 'error', payload: null, reason: null });
      });
    return () => {
      isMounted = false;
    };
  }, [commodity, mandi, isIdentified, reloadKey]);

  // Retrying is an event, so the loading state is reset here rather than in an effect.
  const retry = () => {
    setResult(null);
    setReloadKey((key) => key + 1);
  };

  const effective = !isIdentified
    ? { status: 'empty', payload: null, reason: { code: 'NO_FORECAST' } }
    : (result ?? { status: 'loading', payload: null, reason: null });

  const shell = (children, { tone = 'default' } = {}) => (
    <section
      className={`bg-surface-container-lowest p-4 rounded-xl shadow-sm border ${
        tone === 'error' ? 'border-error/40' : 'border-outline-variant/30'
      } flex flex-col gap-2`}
      aria-label={t(language, 'forecast.title')}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-headline-sm text-headline-sm text-primary uppercase">
            {title ?? t(language, 'forecast.title')}
          </h3>
          <p className="text-xs text-on-surface-variant">{t(language, 'forecast.subtitle')}</p>
        </div>
        <span className="px-2 py-0.5 bg-secondary-container text-on-secondary-container text-[10px] font-bold rounded-full shrink-0">
          {t(language, 'forecast.badge')}
        </span>
      </div>
      {children}
    </section>
  );

  if (effective.status === 'loading') {
    return shell(
      <div className="flex items-center gap-2 py-3 text-on-surface-variant" role="status">
        <span className="material-symbols-outlined animate-spin text-secondary text-[20px]">progress_activity</span>
        <p className="text-body-sm">{t(language, 'forecast.loading')}</p>
      </div>
    );
  }

  if (effective.status === 'error') {
    return shell(
      <div className="flex items-start gap-2 py-2 text-on-error-container" role="alert">
        <span className="material-symbols-outlined text-error text-[20px]">error</span>
        <div className="flex-1">
          <p className="text-body-sm">{t(language, 'forecast.error')}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-bold shadow-sm active:scale-95 transition-transform"
          >
            {t(language, 'forecast.retry')}
          </button>
        </div>
      </div>,
      { tone: 'error' }
    );
  }

  if (effective.status === 'empty') {
    const key = REASON_TO_KEY[effective.reason?.code] || 'forecast.noForecast';
    const history = effective.payload?.history;
    return shell(
      <div className="flex items-start gap-2 py-2 text-on-surface-variant" role="status">
        <span className="material-symbols-outlined text-[20px]">info</span>
        <div className="flex-1">
          <p className="text-body-sm">{t(language, key)}</p>
          {history && history.observations > 0 && (
            <p className="text-xs mt-1">
              {t(language, 'forecast.freshness', {
                date: formatReportDate(history.end_date, language) || '—',
              })}
              {' · '}
              {history.observations}
            </p>
          )}
          <button
            type="button"
            onClick={retry}
            className="mt-2 px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface text-xs font-bold shadow-sm active:scale-95 transition-transform"
          >
            {t(language, 'forecast.retry')}
          </button>
        </div>
      </div>
    );
  }

  const { data, meta, mandi: mandiInfo } = effective.payload;
  const isFixture = Boolean(meta?.is_sample_data);

  return shell(
    <div className="flex flex-col gap-3">
      {/* Observed price — clearly separated from every projection below. */}
      <div className="bg-surface-container-low rounded-lg p-3">
        <span className="text-xs font-bold text-on-surface-variant uppercase">
          {t(language, 'forecast.observedTitle')}
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-headline-md text-headline-md text-primary">
            {meta?.last_observed_price != null ? `${formatRupees(meta.last_observed_price)} / ${t(language, 'unit.quintal')}` : '—'}
          </span>
          <span className="text-xs text-on-surface-variant">
            {t(language, 'forecast.observedPrice')}
            {meta?.last_observed_date
              ? ` · ${t(language, 'forecast.observedOn', { date: formatReportDate(meta.last_observed_date, language) })}`
              : ''}
          </span>
        </div>
        {mandiInfo?.name && <p className="text-xs text-on-surface-variant">{mandiInfo.name}</p>}
      </div>

      <div>
        <span className="text-xs font-bold text-on-surface-variant uppercase">
          {t(language, 'forecast.predictedTitle')}
        </span>
        <ul className="mt-1 flex flex-col divide-y divide-outline-variant/20">
          {data.map((forecast) => (
            <li key={`${forecast.forecast_date}-${forecast.horizon_days}`} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <span className="block text-body-sm text-on-surface font-medium">{horizonLabel(forecast, language)}</span>
                <span className="block text-[11px] text-on-surface-variant">
                  {formatReportDate(forecast.forecast_date, language)}
                </span>
              </div>
              <div className="text-right shrink-0">
                <span className="block text-body-sm font-bold text-on-surface">
                  {formatRupees(forecast.lower_bound)} – {formatRupees(forecast.upper_bound)}
                </span>
                <span className="block text-[11px] text-secondary">
                  {t(language, 'forecast.confidence', { percent: Math.round(Number(forecast.confidence)) })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-on-surface-variant">{t(language, 'forecast.intervalNote')}</p>

      {isFixture && (
        <p className="text-[11px] font-bold text-amber-800 bg-amber-100 rounded px-2 py-1">
          {t(language, 'forecast.sampleBadge')} — {t(language, 'forecast.sampleNote')}
        </p>
      )}

      {/* Freshness and model provenance. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-on-surface-variant border-t border-outline-variant/30 pt-2">
        {meta?.model_version && <span>{t(language, 'forecast.model', { model: meta.model_version })}</span>}
        {meta?.training_data_end_date && (
          <span>{t(language, 'forecast.trainedThrough', { date: formatReportDate(meta.training_data_end_date, language) })}</span>
        )}
        {meta?.generated_at && (
          <span>{t(language, 'forecast.generatedAt', { date: formatReportDate(meta.generated_at, language) })}</span>
        )}
      </div>
    </div>
  );
}
