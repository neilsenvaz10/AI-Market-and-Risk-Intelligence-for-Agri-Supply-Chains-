import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { translateLocation } from '../constants/profile';
import { t } from '../i18n/strings';
import { getCommodityDailyReports } from '../services/api';
import {
  cascadeLocations,
  deriveFreshness,
  deriveVarieties,
  describeError,
  EMPTY_ROWS,
  marketApi,
} from '../services/marketApi';
import { formatFetchedAt, formatReportDate, sourceLabel } from '../utils/mandiFeed';
import ForecastPanel from '../components/ForecastPanel';

/**
 * Mandi Intelligence — driven by the Phase 5 read API and AGMARKNET macro benchmarks.
 *
 *   GET /api/commodities          crop filter options
 *   GET /api/mandis               market list -> state/district/market cascade
 *   GET /api/mandis/prices/latest the price rows themselves
 *   GET /api/mandis/data-status   dataset-wide freshness (the stale verdict)
 *   GET /api/mandi/commodity-daily-reports  AGMARKNET macro benchmarks & MSP comparison
 */

const TREND_CHIP_STYLES = {
  up: 'bg-emerald-100 text-emerald-800',
  down: 'bg-rose-100 text-rose-800',
  stable: 'bg-surface-container-high text-on-surface-variant',
};

// Translated names for the seeded markets; every other market uses the name the
// API returned. A Map (not an object literal) so a market code that happens to
// collide with an Object.prototype key can never resolve to a function.
const MANDI_NAME_KEYS = new Map([
  ['MH_PUNE_APMC', 'mandis.puneName'],
  ['MH_AHM_APMC', 'mandis.ahmednagarName'],
  ['MH_NSK_MAIN', 'mandis.nashikName'],
]);

const FILTER_LABEL_KEYS = {
  commodity: 'home.filter.commodity',
  variety: 'home.filter.variety',
  state: 'home.filter.state',
  district: 'home.filter.district',
  mandi: 'home.filter.mandi',
};

const EMPTY_FILTERS = {
  commodityCode: '',
  commodityName: '',
  variety: '',
  state: '',
  district: '',
  mandiId: '',
};

function sampleChip(language) {
  return (
    <span
      className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded"
      title={t(language, 'mandiFeed.sampleNote')}
    >
      {t(language, 'mandiFeed.sampleBadge')}
    </span>
  );
}

function rupees(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

function arrivalsText(row, language) {
  if (row.arrivals.quantity === null) return t(language, 'mandis.notReported');
  const qty = Number(row.arrivals.quantity).toLocaleString('en-IN');
  const unit = row.arrivals.unit ? ` ${row.arrivals.unit}` : '';
  return `${qty}${unit}`;
}

function FilterSelect({ id, labelKey, language, value, options, onChange, disabled }) {
  const label = t(language, labelKey);
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-on-surface-variant font-medium">
      <span>{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className="px-2 py-1.5 bg-surface border border-outline-variant rounded-lg text-on-surface text-xs focus:outline-none focus:border-primary disabled:opacity-50"
      >
        <option value="">{t(language, 'home.filter.all')}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function MandisPage() {
  const { language } = useAuth();
  const [activeTab, setActiveTab] = useState('mandis'); // 'mandis' | 'national'
  const [nationalFeed, setNationalFeed] = useState({ status: 'loading', rows: [], meta: null });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // A completed fetch only. `null` means "in flight", which is how the loading
  // state is derived rather than written by an effect.
  const [feed, setFeed] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [options, setOptions] = useState({ commodities: [], mandis: [] });
  const [dataStatus, setDataStatus] = useState(null);
  const [varietyRows, setVarietyRows] = useState([]);
  const [varietyKey, setVarietyKey] = useState(0);
  const [forecastKey, setForecastKey] = useState(null);

  /* Filter option sources: the crop list and the market list. */
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    Promise.all([
      marketApi.getCommodities({ limit: 1000 }, { signal: controller.signal }),
      marketApi.getMandis({ limit: 1000 }, { signal: controller.signal }),
    ])
      .then(([commodities, mandis]) => {
        if (isMounted) setOptions({ commodities: commodities.rows, mandis: mandis.rows });
      })
      .catch(() => {
        // Filters degrade to "no options"; the price feed reports its own state.
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  /* National macro data feed (AGMARKNET benchmarks) */
  useEffect(() => {
    let isMounted = true;
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

  /* Dataset-wide freshness status: single read per mount. */
  useEffect(() => {
    let isMounted = true;
    marketApi
      .getDataStatus()
      .then((status) => {
        if (isMounted) setDataStatus(status);
      })
      .catch(() => {
        // Non-essential banner: fails silent so the prices feed still renders.
      });
    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  /* Variety options for the chosen crop: fetched from the latest prices
     unfiltered by location so every variety known for that crop is selectable. */
  useEffect(() => {
    if (!filters.commodityCode) {
      setVarietyRows([]);
      return () => {};
    }
    let isMounted = true;
    const controller = new AbortController();
    marketApi
      .getLatestPrices({ commodity: filters.commodityCode, limit: 100 }, { signal: controller.signal })
      .then((res) => {
        if (isMounted) setVarietyRows(res.rows);
      })
      .catch(() => {
        if (isMounted) setVarietyRows([]);
      });
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [filters.commodityCode, varietyKey]);

  /* The price feed itself, driven by the active filter set. */
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    setFeed(null);

    const query = {
      commodity: filters.commodityCode || undefined,
      variety: filters.variety || undefined,
      state: filters.state || undefined,
      district: filters.district || undefined,
      mandiId: filters.mandiId || undefined,
      limit: 100,
    };

    marketApi
      .getLatestPrices(query, { signal: controller.signal })
      .then((res) => {
        if (isMounted) setFeed(res);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (isMounted) setFeed({ error: describeError(err), rows: EMPTY_ROWS, meta: null });
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    filters.commodityCode,
    filters.variety,
    filters.state,
    filters.district,
    filters.mandiId,
    reloadKey,
  ]);

  const cascade = useMemo(
    () => cascadeLocations(options.mandis, { state: filters.state, district: filters.district }),
    [options.mandis, filters.state, filters.district],
  );

  const varietyOptions = useMemo(
    () => deriveVarieties(varietyRows),
    [varietyRows],
  );

  const status = feed === null ? 'loading' : feed.error ? 'error' : 'ready';
  const rows = feed?.rows ?? EMPTY_ROWS;
  const error = feed?.error ?? null;
  const freshness = useMemo(
    () => deriveFreshness(feed?.meta, dataStatus),
    [feed?.meta, dataStatus],
  );

  const applyFilters = (next) => {
    setForecastKey(null);
    setFilters((current) => ({ ...current, ...next }));
  };

  const selectCommodity = (code) => {
    const chosen = options.commodities.find((item) => item.code === code);
    setVarietyRows([]);
    setVarietyKey((key) => key + 1);
    applyFilters({ commodityCode: code, commodityName: chosen?.name ?? '', variety: '' });
  };

  const selectState = (state) => applyFilters({ state, district: '', mandiId: '' });
  const selectDistrict = (district) => applyFilters({ district, mandiId: '' });

  const retry = () => {
    setFeed(null);
    setNationalFeed({ status: 'loading', rows: [], meta: null });
    setReloadKey((key) => key + 1);
  };

  const hasSampleData = rows.some((row) => row.isSampleData);

  const commodityOptions = options.commodities.map((item) => ({
    value: item.code,
    label: item.name || item.code,
  }));
  const stateOptions = cascade.states.map((name) => ({ value: name, label: name }));
  const districtOptions = cascade.districts.map((name) => ({ value: name, label: name }));
  const mandiOptions = cascade.mandis.map((market) => ({
    value: String(market.id ?? ''),
    label: market.name || market.code || String(market.id),
  }));

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="flex items-start justify-between mb-4 gap-2">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">
            {t(language, 'mandis.title')}
          </h2>
          <div className="flex items-center gap-1.5">
            <p className="text-body-sm text-on-surface-variant">
              {t(language, 'mandis.subtitle')}
            </p>
            {activeTab === 'mandis' && hasSampleData && sampleChip(language)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {activeTab === 'mandis' && status === 'ready' && (
            <span className="px-3 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-full">
              {rows.length === (feed?.total ?? rows.length)
                ? rows.length
                : `${rows.length}/${feed?.total ?? rows.length}`}{' '}
              {t(language, 'mandis.nearby')}
            </span>
          )}
          {activeTab === 'national' && nationalFeed.status === 'ready' && (
            <span className="px-3 py-1 bg-primary-container text-on-primary-container text-xs font-bold rounded-full">
              {nationalFeed.rows.length} Benchmarks
            </span>
          )}
          {activeTab === 'mandis' && freshness.pageAgeDays !== null && (
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
          {freshness.isStale && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded-xl text-xs flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-[18px] text-amber-700">warning</span>
              <span>
                {t(language, 'home.tile.staleWarning', {
                  days: freshness.pageAgeDays ?? dataStatus?.staleness?.max_days ?? '—',
                })}
              </span>
            </div>
          )}

          {/* Filters — crop, variety, then the state/district/market cascade. */}
          <div className="bg-surface-container-lowest p-3 rounded-xl shadow-sm border border-outline-variant/30 mb-3 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect
                id="mandi-filter-commodity"
                labelKey={FILTER_LABEL_KEYS.commodity}
                language={language}
                value={filters.commodityCode}
                options={commodityOptions}
                onChange={selectCommodity}
              />
              <FilterSelect
                id="mandi-filter-variety"
                labelKey={FILTER_LABEL_KEYS.variety}
                language={language}
                value={filters.variety}
                options={varietyOptions.map((name) => ({ value: name, label: name }))}
                onChange={(value) => applyFilters({ variety: value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FilterSelect
                id="mandi-filter-state"
                labelKey={FILTER_LABEL_KEYS.state}
                language={language}
                value={filters.state}
                options={stateOptions}
                onChange={selectState}
              />
              <FilterSelect
                id="mandi-filter-district"
                labelKey={FILTER_LABEL_KEYS.district}
                language={language}
                value={filters.district}
                options={districtOptions}
                onChange={selectDistrict}
              />
              <FilterSelect
                id="mandi-filter-mandi"
                labelKey={FILTER_LABEL_KEYS.mandi}
                language={language}
                value={filters.mandiId}
                options={mandiOptions}
                onChange={(value) => applyFilters({ mandiId: value })}
              />
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

          <div className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const nameKey = MANDI_NAME_KEYS.get(row.mandi.code);
              const marketName = nameKey ? t(language, nameKey) : (row.mandi.name ?? row.mandi.code ?? '—');
              const rowKey = String(row.id ?? `${row.mandi.id}-${row.commodity.id}-${row.variety}-${index}`);

              return (
                <div key={rowKey} className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-bold text-on-surface text-body-lg block truncate">{marketName}</span>
                      <span className="text-xs text-on-surface-variant block truncate">
                        {[row.commodity.name ?? row.commodity.code, row.variety, row.grade]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {row.isSampleData && sampleChip(language)}
                      <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant text-[10px] font-bold rounded-full">
                        {t(language, 'mandis.modalPrice')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-headline-md text-headline-md text-primary">
                      {rupees(row.prices.modal)} / {t(language, 'unit.quintal')}
                    </div>
                    <div className="text-right">
                      <span className="text-body-sm text-on-surface-variant flex items-center justify-end gap-0.5">
                        <span className="material-symbols-outlined text-[14px]">location_on</span>
                        {translateLocation(
                          [row.mandi.district, row.mandi.state].filter(Boolean).join(', '),
                          language,
                        )}
                      </span>
                      <span className="block text-xs font-medium text-secondary">
                        {t(language, 'mandis.arrival')}: {arrivalsText(row, language)}
                      </span>
                    </div>
                  </div>

                  {/* Min / modal / max */}
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <span className="font-medium">{rupees(row.prices.min)}</span>
                    <span className="material-symbols-outlined text-[14px]">horizontal_rule</span>
                    <span className="font-medium">{rupees(row.prices.max)}</span>
                    {row.prices.unit && (
                      <span className="text-[10px]">{row.prices.unit}</span>
                    )}
                    {row.prices.originalUnit && row.prices.originalUnit !== row.prices.unit && (
                      <span className="text-[10px]">{row.prices.originalUnit}</span>
                    )}
                    {row.qualityStatus && (
                      <span className="ml-auto px-1.5 py-0.5 bg-surface-container-high rounded text-[10px] font-bold">
                        {row.qualityStatus}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-on-surface-variant">
                    {t(language, 'mandiFeed.reported', { date: formatReportDate(row.reportedDate, language) || '—' })}
                    {' · '}
                    {t(language, 'mandiFeed.source', { source: sourceLabel(row.raw, language) })}
                  </p>
                  <p className="text-[11px] text-on-surface-variant">
                    {row.fetchedAt && t(language, 'home.tile.reportedFetched', { date: formatFetchedAt(row.fetchedAt, language) })}
                  </p>

                  {/* Phase 4: 1-7 day price forecast for this market and crop, fetched on demand. */}
                  <button
                    type="button"
                    onClick={() => setForecastKey((current) => (current === rowKey ? null : rowKey))}
                    aria-expanded={forecastKey === rowKey}
                    disabled={!row.commodity.code || !row.mandi.code}
                    className="mt-2 w-full py-2 bg-secondary-container hover:bg-surface-container text-on-secondary-container text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">trending_up</span>
                    <span>
                      {forecastKey === rowKey
                        ? t(language, 'forecast.hide')
                        : t(language, 'forecast.show')}
                    </span>
                  </button>
                  {forecastKey === rowKey && (
                    <ForecastPanel commodity={row.commodity.code} mandi={row.mandi.code} />
                  )}

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