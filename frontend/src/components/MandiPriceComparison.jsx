import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { translateCrop } from '../constants/profile';
import { t } from '../i18n/strings';
import { marketApi } from '../services/marketApi';
import { formatReportDate, sourceLabel } from '../utils/mandiFeed';
import { buildComparison } from '../utils/priceComparison';

/**
 * Mandi Price Comparison: the latest verified modal price each mandi has reported for one crop.
 *
 * It shows reported prices only. There is no transport cost, profit or return figure here; those
 * belong to the Phase 5 recommendation service, which a future version can plug in beside this card.
 * Prices come from GET /api/mandis/prices/latest via marketApi, are never defaulted, and sample data is
 * never displayed as a price. There is no "Live" label: each row says whether it is a verified or a
 * historical observation, judged from its reporting date (see utils/priceComparison.js).
 */
const CROPS = [
  { name: 'Onion', code: 'ONION' },
  { name: 'Tomato', code: 'TOMATO' },
  { name: 'Potato', code: 'POTATO' },
  { name: 'Wheat', code: 'WHEAT' },
  { name: 'Soybean', code: 'SOYBEAN' },
];

const BADGE_STYLE = {
  verified: 'bg-secondary text-on-secondary',
  historical: 'bg-primary-container text-primary-fixed',
  sample: 'bg-amber-100 text-amber-800',
  unavailable: 'bg-primary-container text-primary-fixed-dim',
};

function Badge({ kind, language }) {
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap ${BADGE_STYLE[kind]}`}>
      {t(language, `mpc.${kind}`)}
    </span>
  );
}

export default function MandiPriceComparison({ farmer, language, now }) {
  const [crop, setCrop] = useState(() => CROPS.find((c) => c.name === farmer?.primaryCrop)?.name || 'Onion');
  // Keyed by crop so a stale response for another crop can never be displayed.
  const [result, setResult] = useState({ crop: null, rows: [], error: false });

  useEffect(() => {
    const controller = new AbortController();
    const code = CROPS.find((c) => c.name === crop).code;
    marketApi.getLatestPrices({ commodityCode: code, limit: 50 }, { signal: controller.signal })
      .then((res) => setResult({ crop, rows: res.rows, error: false }))
      .catch((err) => {
        if (err?.name !== 'AbortError') setResult({ crop, rows: [], error: true });
      });
    return () => controller.abort();
  }, [crop]);

  const loading = result.crop !== crop;
  const [clock] = useState(() => now || new Date());
  const comparison = useMemo(() => buildComparison(result.rows, clock), [result.rows, clock]);
  const cropLabel = translateCrop(crop, language);

  return (
    <section className="bg-primary text-on-primary rounded-2xl p-4 sm:p-5 mb-4 shadow-md relative overflow-hidden" aria-labelledby="mpc-title">
      <div className="absolute -right-12 -bottom-12 w-44 h-44 bg-secondary/15 rounded-full blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-on-secondary shadow-sm">
            <span className="material-symbols-outlined text-[18px]">compare_arrows</span>
          </div>
          <div>
            <h2 id="mpc-title" className="font-headline-md text-base sm:text-lg text-on-primary leading-tight">
              {t(language, 'mpc.title')}
            </h2>
            <p className="font-body-sm text-xs text-primary-fixed-dim">{t(language, 'mpc.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
        {CROPS.map((c) => (
          <button
            key={c.code}
            type="button"
            aria-pressed={crop === c.name}
            onClick={() => setCrop(c.name)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              crop === c.name ? 'bg-secondary text-on-secondary shadow-sm scale-105' : 'bg-primary-container/80 text-primary-fixed hover:bg-primary-container'
            }`}
          >
            {translateCrop(c.name, language)}
          </button>
        ))}
      </div>

      {loading && <p role="status" className="text-xs text-primary-fixed-dim py-3">{t(language, 'mpc.loading')}</p>}

      {!loading && comparison.status === 'empty' && (
        <div className="bg-primary-container/40 rounded-xl p-3 mb-2 flex flex-col gap-2" role="status">
          <div className="flex items-center gap-2">
            <Badge kind="unavailable" language={language} />
            <span className="text-[11px] text-primary-fixed-dim">{cropLabel}</span>
          </div>
          {result.error && <p className="text-xs text-primary-fixed-dim">{t(language, 'mpc.error')}</p>}
          <p className="text-xs text-white">{t(language, 'mpc.empty')}</p>
          {comparison.sampleOnly && (
            <p className="text-[11px] text-primary-fixed-dim flex items-center gap-1.5">
              <Badge kind="sample" language={language} />
              {t(language, 'mpc.sampleOnly')}
            </p>
          )}
        </div>
      )}

      {!loading && comparison.status === 'ok' && (
        <div className="space-y-2 mb-2">
          {comparison.entries.map(({ key, row, label }) => {
            const isTop = key === comparison.topId;
            return (
              <div
                key={key}
                data-testid="mpc-row"
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl ${
                  isTop ? 'bg-secondary-container/20 border border-secondary/40' : 'bg-primary-container/40 border border-primary-container/20'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {row.mandi.name ?? row.mandi.code}{row.mandi.district ? ` (${row.mandi.district})` : ''}
                  </p>
                  <p className="text-[10px] text-primary-fixed-dim">
                    {t(language, 'mandiFeed.reported', { date: formatReportDate(row.reportedDate, language) })}
                    {' · '}
                    {t(language, 'mandiFeed.source', { source: sourceLabel(row.raw, language) })}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge kind={label} language={language} />
                    {isTop && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-secondary/50 text-emerald-200">
                        {t(language, 'mpc.highest')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs font-bold block ${isTop ? 'text-tertiary-fixed' : 'text-white'}`}>
                    ₹{row.prices.modal.toLocaleString('en-IN')} / {t(language, 'mpc.perQuintal')}
                  </span>
                  <span className="text-[9px] text-primary-fixed-dim block">{t(language, 'home.mandiPrices.modal')}</span>
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-primary-fixed-dim">
            {comparison.comparable ? t(language, 'mpc.notProfit') : t(language, 'mpc.notComparable')}
          </p>
        </div>
      )}

      <div className="pt-2 border-t border-primary-container/40 flex justify-end text-[11px]">
        <Link to="/mandis" className="text-tertiary-fixed font-bold hover:underline">
          {t(language, 'mpc.allMandis')} →
        </Link>
      </div>
    </section>
  );
}
