import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';
import {
  buildAlerts,
  deriveFreshness,
  describeError,
  EMPTY_ROWS,
  marketApi,
} from '../services/marketApi';
import { formatReportDate, formatTrend } from '../utils/mandiFeed';

/**
 * Market Risk Alerts — built from REAL reported prices.
 *
 *   GET /api/mandis/prices/latest   which (mandi, crop, variety) series exist
 *   GET /api/mandis/prices/history  a small page per series — the observations
 *                                   the movements are derived from
 *   GET /api/mandis/data-status     dataset-wide staleness verdict
 *
 * The Phase 5 price endpoints ship no `trend_percent`/`trend_direction`
 * columns, so every percentage below is computed from two real reporting days of
 * the SAME market + crop + variety via `deriveMovements`. Nothing is invented:
 * with fewer than two reporting days for a series there is simply no alert, and
 * the page says so instead of showing a number.
 *
 * History is read per series (`getAlertHistory`) because `/prices/history` pages
 * GLOBALLY by date: one unfiltered page of the newest 1000 rows is normally a
 * single reporting day, so every series would appear exactly once and the page
 * would be permanently empty. When the per-series cap leaves series unexamined,
 * the coverage line says so instead of implying full coverage.
 */

const ALERT_LIMIT = 5;

const ICON_BY_DIRECTION = {
  up: { icon: 'trending_up', tone: 'text-secondary', chip: 'bg-secondary-container text-on-secondary-container' },
  down: { icon: 'trending_down', tone: 'text-error', chip: 'bg-error-container text-on-error-container' },
  flat: { icon: 'trending_flat', tone: 'text-on-surface-variant', chip: 'bg-surface-container-high text-on-surface-variant' },
};

const rupees = (value) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const tonnes = (value) =>
  value === null || value === undefined
    ? '—'
    : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 });

/** Sample rows are never attributed to a real market source. */
const alertSource = (alert, language) =>
  alert.isSampleData
    ? t(language, 'mandiFeed.sampleSource')
    : (alert.sourceLabel ?? alert.source?.code);

export default function AlertsPage() {
  const { language } = useAuth();
  // A completed fetch only; `null` is the loading state (derived, not written).
  const [feed, setFeed] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    marketApi.getAlertHistory({}, { signal: controller.signal })
      .then((res) => {
        if (!isMounted) return;
        setFeed({ status: 'ready', rows: res.rows, meta: res.meta, coverage: res.coverage, error: null });
      })
      .catch((err) => {
        if (!isMounted || err.name === 'AbortError') return;
        setFeed({ status: 'error', rows: [], meta: null, coverage: null, error: err });
      });
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    marketApi.getDataStatus({ signal: controller.signal })
      .then((status) => { if (isMounted) setDataStatus(status); })
      .catch(() => { if (isMounted) setDataStatus(null); });
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const retry = () => {
    setFeed(null);
    setReloadKey((key) => key + 1);
  };

  const status = feed?.status ?? 'loading';
  const rows = feed?.rows ?? EMPTY_ROWS;
  const error = describeError(feed?.error);
  const coverage = feed?.coverage ?? null;

  const alerts = useMemo(() => buildAlerts(deriveMovements(rows), { limit: ALERT_LIMIT }), [rows]);
  const freshness = useMemo(
    () => deriveFreshness(feed?.meta ?? null, dataStatus),
    [feed?.meta, dataStatus],
  );

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="flex items-start justify-between mb-4 gap-2">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">
            {t(language, 'alerts.title')}
          </h2>
          <p className="text-body-sm text-on-surface-variant">
            {t(language, 'alerts.subtitle')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {status === 'ready' && (
            <span className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-xs">
              {alerts.length}
            </span>
          )}
          {freshness.pageAgeDays !== null && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-0.5 ${
                freshness.isStale === true
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-surface-container-high text-on-surface-variant'
              }`}
              title={t(language, 'home.tile.freshness')}
            >
              <span className="material-symbols-outlined text-[12px]">
                {freshness.isStale === true ? 'warning' : 'info'}
              </span>
              {freshness.pageAgeDays} {t(language, 'home.tile.freshnessUnit')}
            </span>
          )}
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-8 text-on-surface-variant" role="status">
          <span className="material-symbols-outlined animate-spin text-secondary text-[24px]">progress_activity</span>
          <p className="text-body-sm">{t(language, 'mandiFeed.loading')}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-error-container text-on-error-container p-4 rounded-xl shadow-sm flex items-start gap-3" role="alert">
          <span className="material-symbols-outlined text-error text-[22px]">error</span>
          <div className="flex-1">
            <p className="font-body-sm text-xs">{t(language, 'mandiFeed.error')}</p>
            {error?.message && (
              <p className="font-body-sm text-[11px] opacity-80 mt-1">
                {error.code ? `${error.code}: ` : ''}{error.message}
              </p>
            )}
            {error?.details?.length > 0 && (
              <ul className="font-body-sm text-[11px] opacity-80 mt-1 list-disc pl-4">
                {error.details.map((detail) => (
                  <li key={`${detail.field}-${detail.message}`}>{detail.field}: {detail.message}</li>
                ))}
              </ul>
            )}
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

      {status === 'ready' && rows.length === 0 && (
        <p className="bg-surface-container-lowest p-4 rounded-xl text-body-sm text-on-surface-variant">
          {t(language, 'forecast.noMarketData')}
        </p>
      )}

      {status === 'ready' && rows.length > 0 && alerts.length === 0 && (
        <p className="bg-surface-container-lowest p-4 rounded-xl text-body-sm text-on-surface-variant">
          {t(language, 'forecast.insufficient')}
        </p>
      )}

      {status === 'ready' && coverage?.truncated && (
        <div
          className="bg-amber-100 text-amber-800 p-3 rounded-xl text-[11px] font-bold flex items-center gap-1.5"
          role="status"
        >
          <span className="material-symbols-outlined text-[14px] shrink-0">warning</span>
          <span className="shrink-0 tabular-nums">
            {coverage.seriesComparable}/{coverage.seriesTotal}
          </span>
          <Link to="/mandis" className="ml-auto shrink-0 underline font-medium">
            {t(language, 'home.mandiPrices.viewAll')}
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {alerts.map((alert) => {
          const tone = ICON_BY_DIRECTION[alert.direction] ?? ICON_BY_DIRECTION.flat;
          const marketName = alert.mandi.name ?? alert.mandi.code ?? '—';
          const cropName = alert.commodity.name ?? alert.commodity.code ?? '—';
          const byArrivals = alert.driver === 'arrivals';
          const movement = byArrivals ? alert.arrivals : alert.price;

          return (
            <div key={alert.id} className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-bold text-on-surface text-body-lg flex items-center gap-1.5 min-w-0">
                  <span className={`material-symbols-outlined text-[18px] ${tone.tone}`}>{tone.icon}</span>
                  <span className="truncate">{cropName} · {marketName}</span>
                </span>
                <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${tone.chip}`}>
                  {formatTrend({ trend_percent: alert.percent })} {t(language, 'mandiFeed.vsPrevious')}
                </span>
              </div>

              {byArrivals && alert.direction === 'up' && (
                <span className="self-start px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                  {t(language, 'alerts.glut.title')}
                </span>
              )}

              <p className="text-body-md text-on-surface">
                {byArrivals ? (
                  <>
                    {t(language, 'mandis.arrival')}: {tonnes(movement.previous)} → {tonnes(movement.current)}{' '}
                    {alert.units?.arrivals || t(language, 'unit.tonne')}
                  </>
                ) : (
                  <>
                    {t(language, 'mandis.modalPrice')}: {rupees(movement.previous)} → {rupees(movement.current)}{' '}
                    {t(language, 'unit.quintal')}
                  </>
                )}
                {alert.variety && <span className="text-on-surface-variant"> · {alert.variety}</span>}
              </p>

              <div className="flex justify-between items-center text-xs text-on-surface-variant pt-1 border-t border-surface-container">
                <span className="truncate">
                  {t(language, 'alerts.mandiLabel')}: {marketName}
                </span>
                <span className="text-secondary font-medium shrink-0 ml-2">
                  {t(language, 'alerts.autoMonitored')}
                </span>
              </div>

              <p className="text-[11px] text-on-surface-variant">
                {t(language, 'mandiFeed.reported', {
                  date: formatReportDate(alert.previousReportedDate, language) || '—',
                })}
                {' → '}
                {formatReportDate(alert.reportedDate, language) || '—'}
                {' · '}
                {t(language, 'mandiFeed.source', { source: alertSource(alert, language) })}
              </p>

              {alert.isSampleData && (
                <p className="text-[11px] font-bold text-amber-800 bg-amber-100 rounded px-2 py-1 self-start">
                  {t(language, 'mandiFeed.sampleBadge')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {status === 'ready' && alerts.length > 0 && (
        <Link
          to="/mandis"
          className="mt-3 w-full py-2 bg-surface-container-low hover:bg-surface-container text-primary text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">storefront</span>
          <span>{t(language, 'home.chip.bestMandi')}</span>
        </Link>
      )}
    </div>
  );
}