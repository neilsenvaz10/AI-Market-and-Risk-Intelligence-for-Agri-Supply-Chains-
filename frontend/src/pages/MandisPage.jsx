import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { translateLocation } from '../constants/profile';
import { t } from '../i18n/strings';
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
 * Mandi Intelligence — driven entirely by the Phase 5 read API.
 *
 *   GET /api/commodities          crop filter options
 *   GET /api/mandis               market list -> state/district/market cascade
 *   GET /api/mandis/prices/latest the price rows themselves
 *   GET /api/mandis/data-status   dataset-wide freshness (the stale verdict)
 *
 * Honesty rules kept from Phase 3:
 *  - A failed request renders an error with the backend's own message and a
 *    retry. It is never replaced by hardcoded prices.
 *  - An empty result renders an explicit "no prices for this filter" state.
 *  - Staleness is the BACKEND's verdict (`meta.stale_days` for this page,
 *    `overall.stale` for the whole dataset). No threshold is computed here.
 *  - Rows flagged `is_sample_data` are labelled as sample, never as market data.
 */

// Translated names for the seeded markets; every other market uses the name the
// API returned. A Map (not an object literal) so a market code that happens to
// collide with an Object.prototype key can never resolve to a function.
const MANDI_NAME_KEYS = new Map([
  ['MH_PUNE_APMC', 'mandis.puneName'],
  ['MH_AHM_APMC', 'mandis.ahmednagarName'],
  ['MH_NSK_MAIN', 'mandis.nashikName'],
  ['MH_BAR_APMC', 'mandis.baramatiName'],
]);

const EMPTY_FILTERS = {
  commodityCode: '',
  commodityName: '',
  variety: '',
  state: '',
  district: '',
  mandiId: '',
};

const FILTER_LABEL_KEYS = {
  commodity: 'profile.form.primaryCrop',
  variety: 'common.optional',
  state: 'profile.form.state',
  district: 'profile.form.district',
  mandi: 'alerts.mandiLabel',
};

const SELECT_WRAP =
  'flex items-center gap-1 bg-surface-container-lowest p-1.5 rounded-lg shadow-sm border border-outline-variant/30 focus-within:border-secondary';
const SELECT_CLASS =
  'flex-grow min-w-0 bg-transparent text-body-sm text-on-surface outline-none appearance-none cursor-pointer';

const rupees = (value) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const arrivalsText = (row, language) =>
  row.arrivals.quantity === null
    ? t(language, 'mandiFeed.notReported')
    : `${Number(row.arrivals.quantity).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${row.arrivals.unit || t(language, 'unit.tonne')}`;

const sampleChip = (language) => (
  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
    {t(language, 'mandiFeed.sampleBadge')}
  </span>
);

function FilterSelect({ id, labelKey, value, options, onChange, language }) {
  const label = t(language, labelKey);
  return (
    <div className="flex flex-col min-w-0">
      <label htmlFor={id} className="text-[10px] font-bold text-on-surface-variant uppercase mb-1 truncate">
        {label}
      </label>
      <div className={SELECT_WRAP}>
        <select
          id={id}
          className={SELECT_CLASS}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{label}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="material-symbols-outlined text-on-surface-variant text-[16px] pointer-events-none">expand_more</span>
      </div>
    </div>
  );
}

export default function MandisPage() {
  const { language } = useAuth();
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

  /* Dataset-wide freshness. A failure here only means "unknown", never "fresh". */
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

  /* Variety options for the chosen crop, probed separately from the price list. */
  useEffect(() => {
    if (!filters.commodityCode) return undefined;
    let isMounted = true;
    const controller = new AbortController();
    marketApi.getLatestPrices({ commodityCode: filters.commodityCode, limit: 200 }, { signal: controller.signal })
      .then((res) => { if (isMounted) setVarietyRows(res.rows); })
      .catch((err) => { if (isMounted && err.name !== 'AbortError') setVarietyRows([]); });
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [filters.commodityCode, varietyKey]);

  /* The price feed. */
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    marketApi.getLatestPrices(filters, { signal: controller.signal })
      .then((res) => {
        if (!isMounted) return;
        setFeed({ status: 'ready', rows: res.rows, meta: res.meta, total: res.total, error: null });
      })
      .catch((err) => {
        if (!isMounted || err.name === 'AbortError') return;
        setFeed({ status: 'error', rows: [], meta: null, total: 0, error: err });
      });
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [filters, reloadKey]);

  const status = feed?.status ?? 'loading';
  const rows = feed?.rows ?? EMPTY_ROWS;
  const freshness = useMemo(
    () => deriveFreshness(feed?.meta ?? null, dataStatus),
    [feed?.meta, dataStatus],
  );
  const error = describeError(feed?.error);

  const cascade = useMemo(
    () => cascadeLocations(options.mandis, {
      state: filters.state,
      district: filters.district,
      mandiId: filters.mandiId,
    }),
    [options.mandis, filters.state, filters.district, filters.mandiId],
  );

  const varietyOptions = useMemo(
    () => (filters.commodityCode ? deriveVarieties(varietyRows) : []),
    [filters.commodityCode, varietyRows],
  );

  // Changing a filter is an event, so the loading state is reset here rather
  // than written from inside an effect.
  const applyFilters = (next) => {
    setFeed(null);
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
            {hasSampleData && sampleChip(language)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {status === 'ready' && (
            <span className="px-3 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-full">
              {rows.length === (feed?.total ?? rows.length)
                ? rows.length
                : `${rows.length}/${feed?.total ?? rows.length}`}{' '}
              {t(language, 'mandis.nearby')}
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

              {/* Min / modal / max. The modal is the headline above; the full
                  range is rendered as numbers + currency only, so no untranslated
                  label is needed. */}
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
    </div>
  );
}