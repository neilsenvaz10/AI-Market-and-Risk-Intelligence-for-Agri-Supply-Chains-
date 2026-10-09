import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatQuantity, translateCrop, translateLocation } from '../constants/profile';
import { t } from '../i18n/strings';
import { deriveFreshness, describeError, EMPTY_ROWS, marketApi } from '../services/marketApi';
import { formatFetchedAt, formatReportDate, sourceLabel } from '../utils/mandiFeed';

/**
 * Dashboard — the "Today's Mandi Prices" card and the data-freshness tile are
 * driven by the Phase 5 read API:
 *
 *   GET /api/mandis/prices/latest  (onion card, real rows + real freshness meta)
 *   GET /api/mandis/data-status    (dataset-wide staleness verdict)
 *
 * Honesty rules:
 *  - No fallback prices. A failed request renders an error with the backend's
 *    real message; an empty result renders an explicit empty state.
 *  - Anything NOT backed by an API call is marked `home.demoBadge` in place.
 *    The hero return figure, the 60/40 allocation bar and the AI-confidence
 *    tile are still illustrative product concepts and are labelled as such.
 */

// Primary markets for the dashboard card, in display order. A Map (not an
// object literal) so a market code can never resolve to an Object.prototype key.
const HOME_MANDIS = new Map([
  ['MH_NSK_MAIN', { badge: 'NSK', nameKey: 'home.mandiPrices.nashikName' }],
  ['MH_PUNE_APMC', { badge: 'PUN', nameKey: 'home.mandiPrices.puneName' }],
  ['MH_AHM_APMC', { badge: 'AHM', nameKey: 'home.mandiPrices.ahmednagarName' }],
]);
const HOME_MANDI_CODES = [...HOME_MANDIS.keys()];

/** The dashboard card is titled "Today's Mandi Prices (Onion)", so it stays onion-scoped. */
const HOME_COMMODITY = 'ONION';

const homeMandiRank = (row) => {
  const index = HOME_MANDI_CODES.indexOf(row.mandi.code);
  return index === -1 ? HOME_MANDI_CODES.length : index;
};

const demoBadge = (language) => (
  <span className="align-middle text-[10px] font-body-sm font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
    {t(language, 'home.demoBadge')}
  </span>
);

export default function HomePage() {
  const { farmer, language } = useAuth();
  const firstName = farmer?.fullName?.split(' ')[0] || '';
  // A completed fetch only; `null` is the loading state (derived, not written).
  const [feed, setFeed] = useState(null);
  const [dataStatus, setDataStatus] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    marketApi.getLatestPrices({ commodityCode: HOME_COMMODITY, limit: 200 }, { signal: controller.signal })
      .then((res) => {
        if (isMounted) setFeed({ status: 'ready', rows: res.rows, meta: res.meta, error: null });
      })
      .catch((err) => {
        if (!isMounted || err.name === 'AbortError') return;
        setFeed({ status: 'error', rows: [], meta: null, error: err });
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

  const retryPrices = () => {
    setFeed(null);
    setReloadKey((key) => key + 1);
  };

  const status = feed?.status ?? 'loading';
  const rows = feed?.rows ?? EMPTY_ROWS;
  const error = describeError(feed?.error);

  const onionPrices = useMemo(
    () => [...rows].sort((a, b) => homeMandiRank(a) - homeMandiRank(b)).slice(0, 3),
    [rows],
  );
  const hasSampleData = onionPrices.some((row) => row.isSampleData);
  const priceSources = [...new Set(onionPrices.map((row) => sourceLabel(row.raw, language)))];

  // Freshness tile: the latest GENUINE reporting date from the API (never a
  // fetch time, never a fixed claim). Sample-only and unavailable stay explicit.
  const freshness = useMemo(
    () => deriveFreshness(feed?.meta ?? null, dataStatus),
    [feed?.meta, dataStatus],
  );
  const fresh =
    freshness.pageLatestGenuineDate
      ? { kind: 'genuine', reported: freshness.pageLatestGenuineDate, fetched: freshness.pageLatestGenuineFetchedAt }
      : status === 'ready' && freshness.pageSampleRows > 0
        ? { kind: 'sample' }
        : { kind: 'none' };

  const freshnessKind =
    status === 'loading' ? 'loading' : status === 'error' ? 'unavailable' : fresh.kind;

  // Alert strip body: the real market with the largest reported arrivals.
  const arrivalLeader = useMemo(() => {
    const ranked = rows
      .filter((row) => row.arrivals.quantity !== null)
      .sort((a, b) => b.arrivals.quantity - a.arrivals.quantity);
    return ranked[0] ?? null;
  }, [rows]);

  const ageLabel = freshness.pageAgeDays === null
    ? ''
    : `${freshness.pageAgeDays} ${t(language, 'home.tile.freshnessUnit')}`;

  return (
    <div className="flex flex-col w-full pb-8">
      {/* Install Banner */}
      <div className="bg-primary-container text-on-primary-container p-3 rounded-xl mb-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">add_to_home_screen</span>
          </div>
          <div>
            <p className="font-label-lg text-sm font-bold text-on-primary-container">
              {t(language, 'home.installBanner.title')}
            </p>
            <p className="font-body-sm text-xs opacity-90">
              {t(language, 'home.installBanner.description')}
            </p>
          </div>
        </div>
        <Link
          to="/onboarding"
          className="bg-primary text-on-primary px-3 py-1.5 rounded-lg font-label-md text-xs font-medium shadow-sm active:scale-95 transition-transform"
        >
          {t(language, 'home.installBanner.button')}
        </Link>
      </div>

      {/* Greeting & Header info */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-headline-lg text-on-surface">
            {t(language, 'greeting', { name: firstName })}
          </h1>
          <p className="font-body-sm text-on-surface-variant">
            {t(language, 'home.subtitle')}
          </p>
          {farmer && (
            <p className="font-body-sm text-xs text-secondary font-medium mt-0.5 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">eco</span>
              {translateCrop(farmer.primaryCrop, language)} · {formatQuantity(farmer.cropQuantity, farmer.quantityUnit, language)}
            </p>
          )}
        </div>
        <div className="bg-surface-container-high px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm shrink-0 max-w-[45%]">
          <span className="w-2 h-2 rounded-full bg-secondary shrink-0"></span>
          <span className="font-label-md text-xs text-on-surface font-medium truncate">
            {farmer ? translateLocation(`${farmer.district}, ${farmer.state}`, language) : t(language, 'home.regionFallback')}
          </span>
        </div>
      </div>

      {/* Phase 8 — Personalized Farmer Dashboard Banner */}
      <div className="bg-primary text-on-primary p-4 rounded-2xl mb-4 shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-secondary text-on-secondary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">dashboard</span>
          </div>
          <div>
            <p className="font-label-lg text-sm font-bold">
              {t(language, 'p8.nav.dashboard')}
            </p>
            <p className="font-body-sm text-xs opacity-90">
              {t(language, 'p8.dashboard.subtitle')}
            </p>
          </div>
        </div>
        <Link
          to="/farmer/dashboard"
          className="bg-surface text-primary px-3 py-1.5 rounded-lg font-label-md text-xs font-bold shadow-sm active:scale-95 transition-transform whitespace-nowrap"
        >
          View Dashboard →
        </Link>
      </div>

      {/* Dark Green Hero Card — illustrative concept, NOT a live recommendation. */}
      <Link
        to="/recommendation"
        className="block bg-primary text-on-primary rounded-xl p-5 mb-4 shadow-md relative overflow-hidden active:scale-[0.99] transition-transform"
      >
        <div className="absolute -right-10 -bottom-10 w-36 h-36 bg-secondary/10 rounded-full blur-2xl pointer-events-none"></div>
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-body-sm text-primary-fixed-dim uppercase tracking-wider text-[11px] font-semibold flex items-center gap-1.5">
              {t(language, 'home.hero.expectedReturn')}
              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded tracking-normal">
                {t(language, 'home.demoBadge')}
              </span>
            </p>
            <h2 className="font-headline-xl text-on-primary mt-0.5">₹19,800</h2>
          </div>
          <span className="bg-tertiary-fixed text-on-tertiary-fixed px-2.5 py-1 rounded-full font-label-md text-xs font-bold shadow-sm">
            {t(language, 'home.hero.sellTomorrow')}
          </span>
        </div>
        {/* Split bar Pune 60% / Ahmednagar 40% — illustrative split, no API call. */}
        <div className="mt-4 pt-3 border-t border-primary-fixed/10">
          <div className="flex justify-between text-xs font-body-sm text-primary-fixed-dim mb-1.5">
            <span>{t(language, 'home.hero.suggestedAllocation')}</span>
            <span className="font-medium text-on-primary">{t(language, 'home.hero.splitRatio')}</span>
          </div>
          <div className="h-2.5 w-full bg-primary-container rounded-full overflow-hidden flex shadow-inner">
            <div className="bg-secondary-fixed h-full transition-all duration-500" style={{ width: '60%' }}></div>
            <div className="bg-tertiary-fixed h-full transition-all duration-500" style={{ width: '40%' }}></div>
          </div>
          <div className="flex justify-between text-[11px] text-primary-fixed-dim mt-1">
            <span>{t(language, 'home.hero.punePrice')}</span>
            <span>{t(language, 'home.hero.ahmednagarPrice')}</span>
          </div>
        </div>
      </Link>

      {/* Alert Strip — body is the largest REAL reported arrivals, never a mock percentage. */}
      <Link
        to="/alerts"
        className="bg-error-container text-on-error-container p-3 rounded-xl mb-4 flex items-center gap-3 shadow-sm active:scale-[0.99] transition-transform"
      >
        <span className="material-symbols-outlined text-error animate-pulse text-[22px]">warning</span>
        <div className="flex-1 min-w-0">
          <p className="font-label-md text-xs font-bold">{t(language, 'home.alert.title')}</p>
          <p className="font-body-sm text-xs truncate">
            {status === 'loading' && t(language, 'mandiFeed.loading')}
            {status === 'error' && t(language, 'home.tile.feedUnavailable')}
            {status === 'ready' && arrivalLeader && (
              <>
                {arrivalLeader.mandi.name ?? arrivalLeader.mandi.code}
                {' · '}
                {t(language, 'mandis.arrival')} {Number(arrivalLeader.arrivals.quantity).toLocaleString('en-IN', { maximumFractionDigits: 1 })}{' '}
                {arrivalLeader.arrivals.unit || t(language, 'unit.tonne')}
                {arrivalLeader.isSampleData && ` · ${t(language, 'mandiFeed.sampleBadge')}`}
              </>
            )}
            {status === 'ready' && !arrivalLeader && t(language, 'home.tile.noMarketData')}
          </p>
        </div>
        <span className="material-symbols-outlined text-[18px] opacity-60">chevron_right</span>
      </Link>

      {/* Three Small Tiles: Risk, Confidence, Data freshness */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Risk Tile — still a static risk level, marked as demo content */}
        <div className="bg-surface-container-lowest p-3 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-body-sm text-xs">{t(language, 'home.tile.risk')}</span>
            <span className="material-symbols-outlined text-[16px] text-amber-600">shield</span>
          </div>
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 mb-1">
              {t(language, 'home.tile.riskLevel')}
            </span>
            {demoBadge(language)}
            <p className="font-body-sm text-[10px] text-on-surface-variant truncate">
              {t(language, 'home.tile.riskSubtext')}
            </p>
          </div>
        </div>
        {/* Confidence Tile — the 78% figure has no model behind it yet, so it is labelled DEMO */}
        <div className="bg-surface-container-lowest p-3 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-body-sm text-xs">{t(language, 'home.tile.aiConf')}</span>
            <span className="material-symbols-outlined text-[16px] text-secondary">psychology</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-headline-md text-lg text-on-surface font-bold">78%</span>
            <span className="text-[10px] text-secondary font-medium">
              {t(language, 'home.tile.aiConfLevel')}
            </span>
            {demoBadge(language)}
          </div>
          <p className="font-body-sm text-[10px] text-on-surface-variant truncate">
            {t(language, 'home.tile.aiConfSubtext')}
          </p>
        </div>
        {/* Data Freshness Tile — latest market reporting date from the price API */}
        <div className="bg-surface-container-lowest p-3 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-body-sm text-xs">{t(language, 'home.tile.freshness')}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                freshnessKind === 'genuine'
                  ? freshness.isStale === true ? 'bg-amber-600' : 'bg-secondary'
                  : freshnessKind === 'sample' ? 'bg-amber-600' : 'bg-outline'
              }`}
            ></span>
          </div>
          <div>
            <span className="font-headline-md text-lg text-on-surface font-bold">
              {fresh.reported ? formatReportDate(fresh.reported, language, { year: false }) : '—'}
            </span>
          </div>
          <p
            className={`font-body-sm text-[10px] font-medium truncate ${
              freshnessKind === 'genuine'
                ? freshness.isStale === true ? 'text-amber-800' : 'text-secondary'
                : freshnessKind === 'sample' ? 'text-amber-800' : 'text-on-surface-variant'
            }`}
          >
            {freshnessKind === 'genuine' &&
              (ageLabel
                ? `${ageLabel} · ${fresh.fetched
                  ? t(language, 'home.tile.reportedFetched', { date: formatFetchedAt(fresh.fetched, language) })
                  : t(language, 'home.tile.reportedDate')}`
                : t(language, 'home.tile.reportedDate'))}
            {freshnessKind === 'sample' && t(language, 'mandiFeed.sampleBadge')}
            {freshnessKind === 'none' && t(language, 'home.tile.noMarketData')}
            {freshnessKind === 'unavailable' && t(language, 'home.tile.feedUnavailable')}
            {freshnessKind === 'loading' && t(language, 'mandiFeed.loading')}
          </p>
        </div>
      </div>

      {/* Quick Chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 no-scrollbar">
        <Link
          to="/recommendation"
          className="bg-secondary-container text-on-secondary-container px-3.5 py-1.5 rounded-full font-label-md text-xs font-medium whitespace-nowrap shadow-sm active:scale-95 transition-transform flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[14px]">help</span>
          {t(language, 'home.chip.sellToday')}
        </Link>
        <Link
          to="/mandis"
          className="bg-surface-container-high text-on-surface px-3.5 py-1.5 rounded-full font-label-md text-xs font-medium whitespace-nowrap shadow-sm active:scale-95 transition-transform flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[14px]">storefront</span>
          {t(language, 'home.chip.bestMandi')}
        </Link>
        <Link
          to="/ask-ai"
          className="bg-surface-container-high text-on-surface px-3.5 py-1.5 rounded-full font-label-md text-xs font-medium whitespace-nowrap shadow-sm active:scale-95 transition-transform flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[14px]">payments</span>
          {t(language, 'home.chip.fairPrice')}
        </Link>
      </div>

      {/* Today's Mandi Prices Section — latest reported prices from /api/mandis/prices/latest */}
      <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-headline-md text-on-surface text-base">
            {t(language, 'home.mandiPrices.title')}
            {hasSampleData && demoBadge(language)}
          </h3>
          <Link to="/mandis" className="font-label-md text-xs text-secondary font-medium">
            {t(language, 'home.mandiPrices.viewAll')}
          </Link>
        </div>

        {status === 'loading' && (
          <div className="flex items-center gap-2 p-2.5 text-on-surface-variant" role="status">
            <span className="material-symbols-outlined animate-spin text-secondary text-[18px]">progress_activity</span>
            <p className="font-body-sm text-xs">{t(language, 'mandiFeed.loading')}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-error-container text-on-error-container p-3 rounded-lg flex items-start gap-3" role="alert">
            <span className="material-symbols-outlined text-error text-[20px] shrink-0">error</span>
            <div className="flex-1">
              <p className="font-body-sm text-xs">{t(language, 'mandiFeed.error')}</p>
              {error?.message && (
                <p className="font-body-sm text-[10px] opacity-80 mt-0.5">
                  {error.code ? `${error.code}: ` : ''}{error.message}
                </p>
              )}
              <button
                type="button"
                onClick={retryPrices}
                className="font-label-md text-xs font-bold text-error underline shrink-0 mt-1"
              >
                {t(language, 'mandiFeed.retry')}
              </button>
            </div>
          </div>
        )}

        {status === 'ready' && onionPrices.length === 0 && (
          <p className="font-body-sm text-xs text-on-surface-variant p-2.5">{t(language, 'mandiFeed.empty')}</p>
        )}

        {onionPrices.length > 0 && (
          <>
            <div className="space-y-3">
              {onionPrices.map((row, index) => {
                const homeMandi = HOME_MANDIS.get(row.mandi.code);
                const badge = homeMandi?.badge || String(row.mandi.name || '').slice(0, 3).toUpperCase();
                const price = `₹${Number(row.prices.modal).toLocaleString('en-IN')}`;
                // The API stores every price in INR per quintal.
                const unit = t(language, 'home.mandiPrices.quintal');

                return (
                  <div key={String(row.id ?? index)} className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          badge === 'PUN'
                            ? 'bg-secondary-container text-on-secondary-container'
                            : 'bg-surface-container-high text-on-surface'
                        }`}
                      >
                        {badge}
                      </div>
                      <div className="min-w-0">
                        <p className="font-label-lg text-sm font-bold text-on-surface truncate">
                          {homeMandi ? t(language, homeMandi.nameKey) : (row.mandi.name ?? row.mandi.code)}
                          {row.variety && <span className="font-normal text-on-surface-variant"> · {row.variety}</span>}
                        </p>
                        <p className="font-body-sm text-xs text-on-surface-variant">
                          {t(language, 'home.mandiPrices.modal')}: {price} / {unit}
                        </p>
                        <p className="font-body-sm text-[10px] text-on-surface-variant">
                          {t(language, 'mandiFeed.reported', { date: formatReportDate(row.reportedDate, language) || '—' })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-label-lg text-sm font-bold flex items-center justify-end gap-0.5 text-on-surface">
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant">payments</span> {price}
                      </span>
                      <span className="text-[10px] font-medium text-on-surface-variant">
                        {row.isSampleData ? t(language, 'mandiFeed.sampleBadge') : row.commodity.name}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-2.5 border-t border-outline-variant/30 flex items-center justify-between text-xs">
              <span className="text-[11px] text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px] text-primary">public</span>
                National Benchmarks (Wheat, Soybean, Pulses)
              </span>
              <Link to="/mandis" className="text-[11px] font-bold text-primary hover:underline">
                View AGMARKNET →
              </Link>
            </div>
            <p className="font-body-sm text-[10px] text-on-surface-variant mt-2">
              {t(language, 'mandiFeed.source', { source: priceSources.join(', ') })}
            </p>
          </>
        )}
      </div>

      {/* Floating Mic Button to Ask AI */}
      <div className="fixed right-6 bottom-24 z-40">
        <Link
          to="/ask-ai"
          className="w-14 h-14 rounded-full bg-secondary text-on-secondary shadow-lg flex items-center justify-center active:scale-95 transition-transform hover:shadow-xl group"
          title={t(language, 'home.mic.tooltip')}
        >
          <span className="material-symbols-outlined text-[26px] group-hover:scale-110 transition-transform">
            mic
          </span>
        </Link>
      </div>
    </div>
  );
}