import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';
import { getMandiRisk, getRiskSummary, getMandis, getCommodities } from '../services/api';
import RiskBadge from '../components/RiskBadge';
import RiskCard from '../components/RiskCard';

export default function RiskDashboardPage() {
  const { language } = useAuth();

  // Selection state
  const [commodities, setCommodities] = useState([]);
  const [mandis, setMandis] = useState([]);
  const [selectedCrop, setSelectedCrop] = useState('ONION');
  const [selectedMandi, setSelectedMandi] = useState('MH_NSK_MAIN');

  // Risk data states
  const [riskData, setRiskData] = useState(null);
  const [riskSummary, setRiskSummary] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [reloadKey, setReloadKey] = useState(0);

  // Load dropdown lists (commodities and active mandis)
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      getCommodities().catch(() => ({ data: [] })),
      getMandis({ limit: 50 }).catch(() => ({ data: [] })),
    ]).then(([cropRes, mandiRes]) => {
      if (!isMounted) return;
      const cropList = cropRes?.data || [];
      const mandiList = mandiRes?.data || [];
      setCommodities(cropList);
      setMandis(mandiList);

      if (cropList.length && !cropList.some((c) => c.code === selectedCrop)) {
        setSelectedCrop(cropList[0].code);
      }
      if (mandiList.length && !mandiList.some((m) => m.code === selectedMandi)) {
        setSelectedMandi(mandiList[0].code);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch detailed risk and summary
  useEffect(() => {
    if (!selectedCrop || !selectedMandi) return;
    let isMounted = true;
    setStatus('loading');

    Promise.all([
      getMandiRisk(selectedCrop, selectedMandi),
      getRiskSummary({ limit: 10 }).catch(() => null),
    ])
      .then(([detail, summary]) => {
        if (!isMounted) return;
        setRiskData(detail);
        if (summary) setRiskSummary(summary);
        setStatus('ready');
      })
      .catch(() => {
        if (isMounted) setStatus('error');
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCrop, selectedMandi, reloadKey]);

  const retry = () => setReloadKey((k) => k + 1);

  const breakdown = riskData?.breakdown || {};
  const warnings = riskData?.warnings || [];

  return (
    <div className="flex flex-col gap-5 pb-24 max-w-4xl mx-auto px-4 pt-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[28px]">
            shield_with_heart
          </span>
          <h1 className="font-headline-md text-headline-md text-primary">
            {t(language, 'risk.title')}
          </h1>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          {t(language, 'risk.subtitle')}
        </p>
      </div>

      {/* Selectors Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-on-surface-variant uppercase mb-1">
            {t(language, 'risk.selectCrop')}
          </label>
          <select
            value={selectedCrop}
            onChange={(e) => setSelectedCrop(e.target.value)}
            className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-body-sm text-on-surface font-medium focus:ring-2 focus:ring-primary focus:outline-none"
          >
            {commodities.map((c) => (
              <option key={c.id || c.code} value={c.code}>
                {language === 'hi' && c.hindi_name
                  ? c.hindi_name
                  : language === 'mr' && c.marathi_name
                  ? c.marathi_name
                  : c.name} ({c.code})
              </option>
            ))}
            {commodities.length === 0 && (
              <>
                <option value="ONION">Onion (ONION)</option>
                <option value="TOMATO">Tomato (TOMATO)</option>
                <option value="POTATO">Potato (POTATO)</option>
              </>
            )}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-on-surface-variant uppercase mb-1">
            {t(language, 'risk.selectMandi')}
          </label>
          <select
            value={selectedMandi}
            onChange={(e) => setSelectedMandi(e.target.value)}
            className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 text-body-sm text-on-surface font-medium focus:ring-2 focus:ring-primary focus:outline-none"
          >
            {mandis.map((m) => (
              <option key={m.id || m.code} value={m.code}>
                {language === 'hi' && m.hindi_name
                  ? m.hindi_name
                  : language === 'mr' && m.marathi_name
                  ? m.marathi_name
                  : m.name} ({m.district || m.state})
              </option>
            ))}
            {mandis.length === 0 && (
              <>
                <option value="MH_NSK_MAIN">Nashik APMC (MH)</option>
                <option value="MH_PUNE_APMC">Pune APMC (MH)</option>
                <option value="MH_MUMBAI">Mumbai APMC (MH)</option>
              </>
            )}
          </select>
        </div>
      </div>

      {/* Loading State */}
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-on-surface-variant" role="status">
          <span className="material-symbols-outlined animate-spin text-primary text-[32px]">
            progress_activity
          </span>
          <p className="text-body-sm font-medium">{t(language, 'risk.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {status === 'error' && (
        <div className="bg-error-container text-on-error-container p-4 rounded-xl shadow-sm flex items-start gap-3" role="alert">
          <span className="material-symbols-outlined text-error text-[24px]">error</span>
          <div className="flex-1">
            <p className="font-bold text-body-sm">{t(language, 'risk.error')}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold shadow-sm active:scale-95 transition-transform"
            >
              {t(language, 'risk.retry')}
            </button>
          </div>
        </div>
      )}

      {/* Ready State */}
      {status === 'ready' && riskData && (
        <>
          {/* Overall Risk Card */}
          <section
            aria-label={t(language, 'risk.overallRisk')}
            className="bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/30 shadow-sm flex flex-col gap-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs uppercase font-bold text-on-surface-variant tracking-wider">
                  {riskData.commodity?.name} @ {riskData.mandi?.name}
                </span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface mt-0.5">
                  {t(language, 'risk.overallRisk')}
                </h2>
              </div>
              <div>
                <RiskBadge level={riskData.overallLevel} size="default" />
              </div>
            </div>

            <div className="bg-surface-container-low p-4 rounded-xl flex items-start gap-3">
              <span className="material-symbols-outlined text-primary text-[22px] shrink-0 mt-0.5">
                psychology_alt
              </span>
              <div>
                <span className="font-bold text-xs uppercase text-primary block">
                  {t(language, 'risk.recommendation')}
                </span>
                <p className="text-body-sm text-on-surface font-medium mt-0.5">
                  {riskData.summaryAdvice}
                </p>
              </div>
            </div>

            {/* Price & Reporting Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
              <div>
                <span className="text-on-surface-variant block">Latest Mandi Price</span>
                <span className="font-bold text-on-surface text-body-md">
                  {riskData.latestPrice !== null
                    ? `₹${Number(riskData.latestPrice).toLocaleString('en-IN')}`
                    : 'Not Reported'}
                </span>
              </div>
              <div>
                <span className="text-on-surface-variant block">Report Date</span>
                <span className="font-bold text-on-surface">
                  {riskData.latestPriceDate || 'N/A'}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-on-surface-variant block">Evaluated At</span>
                <span className="text-on-surface font-mono text-[11px]">
                  {new Date(riskData.evaluatedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
          </section>

          {/* Actionable Warnings */}
          {warnings.length > 0 && (
            <div className="flex flex-col gap-2">
              {warnings.map((w, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                    w.severity === 'HIGH'
                      ? 'bg-error-container text-on-error-container border-error/30'
                      : 'bg-amber-500/10 text-amber-900 dark:text-amber-200 border-amber-500/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">
                    {w.severity === 'HIGH' ? 'report' : 'notification_important'}
                  </span>
                  <div className="text-xs">
                    <span className="font-bold uppercase tracking-wider block text-[10px]">
                      {w.code}
                    </span>
                    <p className="font-medium mt-0.5">{w.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 5 Risk Factors Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Price Decline Risk */}
            <RiskCard
              titleKey="risk.priceDecline"
              icon="trending_down"
              factor={breakdown.priceDecline}
              metrics={[
                {
                  label: 'Projected Drop',
                  value: `${breakdown.priceDecline?.evidence?.maxDropPercent || 0}%`,
                },
                {
                  label: 'Worst Horizon',
                  value: breakdown.priceDecline?.evidence?.worstHorizonDays
                    ? `Day ${breakdown.priceDecline.evidence.worstHorizonDays}`
                    : 'N/A',
                },
              ]}
            />

            {/* 2. Historical Volatility */}
            <RiskCard
              titleKey="risk.volatility"
              icon="analytics"
              factor={breakdown.volatility}
              metrics={[
                {
                  label: 'Variation (CV)',
                  value: `${breakdown.volatility?.evidence?.cvPercent || 0}%`,
                },
                {
                  label: 'Max Daily Swing',
                  value: `${breakdown.volatility?.evidence?.maxDailySwingPercent || 0}%`,
                },
              ]}
            />

            {/* 3. Market Arrival Surge */}
            <RiskCard
              titleKey="risk.arrivalSurge"
              icon="warehouse"
              factor={breakdown.arrivalSurge}
              metrics={[
                {
                  label: 'Recent Arrival',
                  value: breakdown.arrivalSurge?.evidence?.latestArrival
                    ? `${breakdown.arrivalSurge.evidence.latestArrival} ${breakdown.arrivalSurge.evidence.arrivalUnit}`
                    : 'N/A',
                },
                {
                  label: 'Surge Ratio',
                  value: breakdown.arrivalSurge?.evidence?.surgeRatio
                    ? `${breakdown.arrivalSurge.evidence.surgeRatio}x`
                    : 'N/A',
                },
              ]}
            />

            {/* 4. Forecast Uncertainty */}
            <RiskCard
              titleKey="risk.forecastUncertainty"
              icon="speed"
              factor={breakdown.forecastUncertainty}
              metrics={[
                {
                  label: 'Interval Spread',
                  value: breakdown.forecastUncertainty?.evidence?.avgIntervalWidthPercent
                    ? `±${(breakdown.forecastUncertainty.evidence.avgIntervalWidthPercent / 2).toFixed(1)}%`
                    : 'N/A',
                },
                {
                  label: 'Confidence',
                  value: breakdown.forecastUncertainty?.evidence?.modelConfidenceScore
                    ? `${breakdown.forecastUncertainty.evidence.modelConfidenceScore}/100`
                    : 'N/A',
                },
              ]}
            />

            {/* 5. Data Freshness */}
            <div className="md:col-span-2">
              <RiskCard
                titleKey="risk.dataFreshness"
                icon="update"
                factor={breakdown.dataFreshness}
                metrics={[
                  {
                    label: 'Last Reported',
                    value: breakdown.dataFreshness?.evidence?.latestReportDate || 'N/A',
                  },
                  {
                    label: 'Latency',
                    value: breakdown.dataFreshness?.evidence?.daysSinceLastReport !== null
                      ? `${breakdown.dataFreshness.evidence.daysSinceLastReport} days ago`
                      : 'Unknown',
                  },
                ]}
              />
            </div>
          </div>

          {/* Monitored Markets Summary Table */}
          {riskSummary && riskSummary.series && riskSummary.series.length > 0 && (
            <section
              aria-label={t(language, 'risk.summaryTitle')}
              className="bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/30 shadow-sm flex flex-col gap-3 mt-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-headline-sm text-headline-sm text-primary">
                  {t(language, 'risk.summaryTitle')}
                </h3>
                <div className="flex gap-1.5">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-error/15 text-error">
                    {riskSummary.counts?.HIGH || 0} High
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700">
                    {riskSummary.counts?.MODERATE || 0} Mod
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700">
                    {riskSummary.counts?.LOW || 0} Low
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-outline-variant/30 text-on-surface-variant uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-2 font-bold">Commodity</th>
                      <th className="py-2 px-2 font-bold">Mandi</th>
                      <th className="py-2 px-2 font-bold">Latest Price</th>
                      <th className="py-2 px-2 font-bold">Risk Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {riskSummary.series.map((item, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-surface-container-low transition-colors cursor-pointer"
                        onClick={() => {
                          setSelectedCrop(item.commodity.code);
                          setSelectedMandi(item.mandi.code);
                        }}
                      >
                        <td className="py-2.5 px-2 font-semibold text-on-surface">
                          {item.commodity.name}
                        </td>
                        <td className="py-2.5 px-2 text-on-surface-variant">
                          {item.mandi.name}
                        </td>
                        <td className="py-2.5 px-2 font-medium">
                          {item.latestPrice ? `₹${Number(item.latestPrice).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-2.5 px-2">
                          <RiskBadge level={item.overallLevel} size="sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
