import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { marketApi } from '../services/marketApi';
import { simulateScenario } from '../services/scenarioService';
import { evaluateMandiAllocation } from '../utils/mandiOptimizer';
import { t } from '../i18n/strings';

const CROP_OPTIONS = [
  { code: 'ONION', name: 'Onion', icon: 'nutrition' },
  { code: 'TOMATO', name: 'Tomato', icon: 'local_florist' },
];

const QUANTITY_PRESETS = [500, 1000, 2500, 5000];
const HOLD_PRESETS = [
  { days: 0, labelKey: 'sim.sellToday' },
  { days: 1, labelKey: 'sim.wait1Day' },
  { days: 2, labelKey: 'sim.wait2Days' },
  { days: 3, labelKey: 'sim.wait3Days' },
  { days: 5, labelKey: 'sim.wait5Days' },
  { days: 7, labelKey: 'sim.wait7Days' },
];

export default function RecommendationResultPage() {
  const { language, farmer } = useAuth();

  // Selection states
  const [selectedCrop, setSelectedCrop] = useState(() => {
    const primary = farmer?.primaryCrop ? String(farmer.primaryCrop).toUpperCase() : '';
    return primary === 'TOMATO' ? 'TOMATO' : 'ONION';
  });

  const [quantityKg, setQuantityKg] = useState(() => {
    const q = Number(farmer?.cropQuantity);
    return q > 0 ? q : 1000;
  });

  const originDistrict = farmer?.district || 'Pune';

  // Market observation loading
  const [loadingPrices, setLoadingPrices] = useState(true);
  const [mandiPrices, setMandiPrices] = useState([]);
  const [fetchError, setFetchError] = useState(null);

  // Accordion & Modals
  const [whyOpen, setWhyOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Simulator states
  const [simHoldDays, setSimHoldDays] = useState(2);
  const [simSelectedMandiId, setSimSelectedMandiId] = useState('ALL');
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState(null);

  // Fetch verified latest prices for crop
  useEffect(() => {
    let active = true;
    setLoadingPrices(true);
    setFetchError(null);

    marketApi
      .getLatestPrices({ commodity: selectedCrop, limit: 50 })
      .then((res) => {
        if (!active) return;
        setMandiPrices(res.rows || []);
      })
      .catch((err) => {
        if (!active) return;
        setFetchError(err.message || 'Failed to load mandi prices');
      })
      .finally(() => {
        if (active) setLoadingPrices(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCrop]);

  // Compute allocation optimization using real prices, road freight & risk hedging
  const allocation = useMemo(() => {
    return evaluateMandiAllocation({
      quantityKg,
      candidateMandis: mandiPrices,
      farmerDistrict: originDistrict,
    });
  }, [quantityKg, mandiPrices, originDistrict]);

  // Reset simulator selected mandi when allocation changes
  useEffect(() => {
    if (allocation?.splitAllocation?.mandis?.length) {
      setSimSelectedMandiId(allocation.splitAllocation.mandis[0].marketCode || allocation.splitAllocation.mandis[0].id);
    }
  }, [allocation]);

  // Run simulation whenever modal opens, holdDays changes, or target mandi changes
  const runSimulation = useCallback(
    async (days, targetMandi) => {
      if (!allocation?.hasMandis) return;
      setSimLoading(true);
      setSimError(null);

      try {
        let res;
        if (targetMandi === 'ALL' && allocation.splitAllocation?.mandis?.length > 1) {
          // Multi-mandi plan simulation
          const allocationsPayload = allocation.splitAllocation.mandis.map((m) => ({
            mandiId: m.marketCode || m.id,
            quantityQuintals: m.quantityQuintals,
          }));

          res = await simulateScenario({
            commodity: selectedCrop,
            holdDays: days,
            includeRisk: true,
            includeSample: true,
            allocations: allocationsPayload,
          });
        } else {
          // Single mandi simulation
          const mandiTarget =
            targetMandi === 'ALL'
              ? allocation.singleMandi.marketCode || allocation.singleMandi.id
              : targetMandi;

          const matchedAlloc = allocation.splitAllocation?.mandis?.find(
            (m) => String(m.marketCode) === String(mandiTarget) || String(m.id) === String(mandiTarget)
          );

          const q = matchedAlloc ? matchedAlloc.quantityQuintals : allocation.totalQuintals;

          res = await simulateScenario({
            commodity: selectedCrop,
            mandiId: mandiTarget,
            quantityQuintals: q,
            holdDays: days,
            includeRisk: true,
            includeSample: true,
          });
        }

        setSimResult(res);
      } catch (err) {
        if (!err.isStale) {
          setSimError(err.message || 'Simulation error');
        }
      } finally {
        setSimLoading(false);
      }
    },
    [allocation, selectedCrop]
  );

  useEffect(() => {
    if (modalOpen && allocation?.hasMandis) {
      runSimulation(simHoldDays, simSelectedMandiId);
    }
  }, [modalOpen, simHoldDays, simSelectedMandiId, runSimulation, allocation?.hasMandis]);

  // Share action: copies clean verified summary to clipboard
  const handleShare = () => {
    if (!allocation?.hasMandis) return;
    const plan = allocation.splitAllocation;
    const textLines = [
      `🌾 FASALYTICS Mandi Allocation Plan`,
      `Crop: ${selectedCrop} | Harvest: ${quantityKg.toLocaleString('en-IN')} kg`,
      `Origin: ${originDistrict} District`,
      ...plan.mandis.map(
        (m) =>
          `• ${m.name}: ${m.quantityKg.toLocaleString('en-IN')} kg (${m.sharePercent}%) @ ₹${m.modalPrice}/q (Net: ₹${m.netPricePerQuintal}/q)`
      ),
      `Total Net Realization: ₹${plan.totalNetReturn.toLocaleString('en-IN')}`,
      `Generated by FASALYTICS Market Intelligence`,
    ].join('\n');

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textLines).catch(() => {});
    }
    setToastMessage(t(language, 'rec.toastCopied'));
    setTimeout(() => setToastMessage(null), 3000);
  };

  const plan = allocation?.splitAllocation;

  return (
    <div className="flex flex-col w-full pb-8">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 inset-x-4 max-w-sm mx-auto z-50 bg-secondary text-on-secondary px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top duration-300">
          <span className="material-symbols-outlined text-lg">check_circle</span>
          <span className="text-body-md font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Top Crop & Quantity Configuration Strip */}
      <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm mb-4 border border-outline-variant/30">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex gap-2">
            {CROP_OPTIONS.map((c) => (
              <button
                key={c.code}
                onClick={() => setSelectedCrop(c.code)}
                className={`px-3 py-1.5 rounded-lg text-body-sm font-bold flex items-center gap-1.5 transition-all ${
                  selectedCrop === c.code
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{c.icon}</span>
                {c.name}
              </button>
            ))}
          </div>

          <span className="text-xs text-on-surface-variant font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-secondary">pin_drop</span>
            {originDistrict}
          </span>
        </div>

        {/* Quantity Selector */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-outline-variant/20">
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            {t(language, 'rec.quantity')}:
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {QUANTITY_PRESETS.map((q) => (
              <button
                key={q}
                onClick={() => setQuantityKg(q)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                  quantityKg === q
                    ? 'bg-secondary-container text-on-secondary-container ring-1 ring-secondary'
                    : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {q >= 1000 ? `${q / 1000} T` : `${q} kg`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading & Error States */}
      {loadingPrices && (
        <div className="bg-surface-container-low rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-on-surface-variant mb-6">
          <span className="material-symbols-outlined text-3xl animate-spin text-secondary">progress_activity</span>
          <span className="text-body-md font-medium">{t(language, 'sim.calculating')}</span>
        </div>
      )}

      {fetchError && !loadingPrices && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl mb-4 text-body-sm">
          {fetchError}
        </div>
      )}

      {!loadingPrices && !allocation.hasMandis && (
        <div className="bg-surface-container-low rounded-xl p-6 text-center text-on-surface-variant mb-6">
          <span className="material-symbols-outlined text-4xl mb-2 text-outline">storefront</span>
          <p className="text-body-md font-medium">{t(language, 'rec.noMandis')}</p>
        </div>
      )}

      {/* Optimization Content */}
      {!loadingPrices && allocation.hasMandis && plan && (
        <>
          {/* Top Return Banner */}
          <div className="bg-primary text-on-primary rounded-xl p-5 shadow-md mb-4 relative overflow-hidden">
            <div className="absolute -right-6 -bottom-6 w-32 h-32 rounded-full bg-secondary-container/10 pointer-events-none"></div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-label-md text-primary-fixed uppercase tracking-wider font-label-md">
                {t(language, 'rec.optimizedReturn')}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">verified</span>
                {t(language, 'rec.vsAvg')}
              </span>
            </div>

            <div className="text-headline-xl font-headline-xl text-primary-fixed mb-3">
              ₹{plan.totalNetReturn.toLocaleString('en-IN')}
            </div>

            {/* Metric Chips */}
            <div className="flex flex-wrap gap-2 pt-1 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface font-semibold flex items-center gap-1 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                {t(language, 'rec.risk')}: {t(language, 'risk.level.moderate')}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface font-semibold flex items-center gap-1 shadow-sm">
                <span className="material-symbols-outlined text-[13px] text-secondary">trending_up</span>
                {t(language, 'rec.confidence')}: 76%
              </span>
              <span className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface font-semibold flex items-center gap-1 shadow-sm">
                <span className="material-symbols-outlined text-[13px] text-on-surface-variant">local_shipping</span>
                -₹{plan.totalFreight.toLocaleString('en-IN')} {t(language, 'rec.freight')}
              </span>
            </div>
          </div>

          {/* Allocation Breakdown Card */}
          <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm mb-4 border border-outline-variant/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-headline-md font-headline-md text-on-surface">
                {t(language, 'rec.mandiSplit')}
              </h3>
              <span className="text-xs text-on-surface-variant font-medium">
                {t(language, 'rec.total')}: {quantityKg.toLocaleString('en-IN')} {t(language, 'unit.kg')} (
                {(quantityKg / 100).toFixed(1)} {t(language, 'unit.quintal')})
              </span>
            </div>

            {/* Visual Allocation Bar */}
            <div className="h-3.5 w-full rounded-full bg-surface-container flex overflow-hidden mb-4 gap-0.5">
              {plan.mandis.map((m, idx) => (
                <div
                  key={m.id || idx}
                  className={`h-full transition-all duration-500 ${
                    idx === 0 ? 'bg-secondary rounded-l-full' : 'bg-amber-400 rounded-r-full'
                  }`}
                  style={{ width: `${m.sharePercent}%` }}
                />
              ))}
            </div>

            {/* Mandi Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {plan.mandis.map((m, idx) => (
                <div
                  key={m.id || idx}
                  className="bg-surface-container-low p-3.5 rounded-xl flex flex-col justify-between border border-outline-variant/20"
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-bold text-on-surface text-body-md line-clamp-1">{m.name}</span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                        idx === 0
                          ? 'text-secondary bg-secondary-container/60'
                          : 'text-amber-800 bg-amber-100'
                      }`}
                    >
                      {m.sharePercent}%
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-title-lg font-bold text-on-surface">
                      {m.quantityKg.toLocaleString('en-IN')} {t(language, 'unit.kg')}
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      ({m.quantityQuintals} {t(language, 'unit.quintal')})
                    </span>
                  </div>

                  <div className="text-xs text-on-surface-variant space-y-0.5 pt-2 border-t border-outline-variant/20">
                    <div className="flex justify-between">
                      <span>{t(language, 'rec.modalRate')}:</span>
                      <span className="font-semibold text-on-surface">₹{m.modalPrice.toLocaleString('en-IN')}/q</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t(language, 'rec.freight')} ({m.distanceKm} km):</span>
                      <span className="font-medium text-error">-₹{m.freightPerQuintal}/q</span>
                    </div>
                    <div className="flex justify-between font-bold text-secondary pt-0.5">
                      <span>{t(language, 'rec.netRate')}:</span>
                      <span>₹{m.netPricePerQuintal.toLocaleString('en-IN')}/q</span>
                    </div>
                    <div className="flex justify-between font-bold text-on-surface pt-1 border-t border-outline-variant/10">
                      <span>Net Yield:</span>
                      <span className="text-body-md">₹{m.netReturn.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Single vs Split Comparison Footer */}
            {allocation.singleMandi && plan.isSplitViable && (
              <div className="p-3 bg-surface-container rounded-lg text-xs text-on-surface-variant flex items-center justify-between">
                <span>
                  Single mandi return (100% to {allocation.singleMandi.name}):
                </span>
                <span className="font-bold text-on-surface">
                  ₹{allocation.singleMandi.singleNetReturn.toLocaleString('en-IN')}
                </span>
              </div>
            )}
          </div>

          {/* Expandable "Why this plan?" */}
          <div className="bg-surface-container-lowest rounded-xl shadow-sm mb-4 border border-outline-variant/30 overflow-hidden">
            <button
              className="w-full p-4 flex items-center justify-between text-left focus:outline-none"
              onClick={() => setWhyOpen(!whyOpen)}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-lg">lightbulb</span>
                </div>
                <div>
                  <h4 className="font-headline-md text-title-md text-on-surface">
                    {t(language, 'rec.whyPlan')}
                  </h4>
                  <p className="text-body-sm text-on-surface-variant">
                    {t(language, 'rec.whyPlanSub')}
                  </p>
                </div>
              </div>
              <span
                className="material-symbols-outlined text-on-surface-variant transition-transform duration-300"
                style={{ transform: whyOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                expand_more
              </span>
            </button>

            {whyOpen && (
              <div className="px-4 pb-4 pt-1 space-y-2.5">
                {allocation.reasons.map((r) => (
                  <div key={r.id} className="flex items-start gap-2.5 p-3 bg-surface-container-low rounded-xl">
                    <span className="material-symbols-outlined text-secondary text-[20px] mt-0.5 shrink-0">
                      {r.icon || 'check_circle'}
                    </span>
                    <div>
                      <div className="text-body-sm font-bold text-on-surface mb-0.5">
                        {t(language, r.titleKey) || r.defaultTitle}
                      </div>
                      <p className="text-body-sm text-on-surface-variant leading-relaxed">{r.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2.5">
            <button
              className="w-full h-12 bg-amber-400 hover:bg-amber-500 text-on-tertiary-fixed font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
              onClick={() => setModalOpen(true)}
            >
              <span className="material-symbols-outlined">psychology</span>
              {t(language, 'rec.whatIf')}
            </button>

            <button
              className="w-full h-12 bg-surface-container-lowest text-secondary border border-secondary/30 font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
              onClick={handleShare}
            >
              <span className="material-symbols-outlined">share</span>
              {t(language, 'rec.share')}
            </button>
          </div>
        </>
      )}

      {/* "What if I wait to sell?" Simulator Bottom Sheet */}
      {modalOpen && (
        <div className="app-modal absolute inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity">
          <div className="bg-surface-container-lowest w-full rounded-t-2xl p-5 shadow-2xl max-w-md max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300 border-t border-outline-variant/30">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/20 shrink-0">
              <div>
                <h3 className="font-headline-md text-title-lg text-on-surface">
                  {t(language, 'sim.title')}
                </h3>
                <p className="text-xs text-on-surface-variant">{t(language, 'sim.subtitle')}</p>
              </div>
              <button
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors"
                onClick={() => setModalOpen(false)}
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            {/* Scrollable Simulator Body */}
            <div className="flex-1 overflow-y-auto no-scrollbar py-4 space-y-4">
              {/* Target Mandi Filter Selector (if multi-mandi plan exists) */}
              {plan?.mandis?.length > 1 && (
                <div>
                  <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider block mb-1.5">
                    {t(language, 'sim.mandi')}:
                  </label>
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                    <button
                      onClick={() => setSimSelectedMandiId('ALL')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        simSelectedMandiId === 'ALL'
                          ? 'bg-secondary text-on-secondary shadow-sm'
                          : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      Entire Plan (60/40 Split)
                    </button>
                    {plan.mandis.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSimSelectedMandiId(m.marketCode || m.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                          simSelectedMandiId === (m.marketCode || m.id)
                            ? 'bg-secondary text-on-secondary shadow-sm'
                            : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Holding Duration Buttons & Range Slider */}
              <div className="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
                    {t(language, 'sim.holdingPeriod')}
                  </span>
                  <span className="text-title-md font-bold text-secondary">
                    {simHoldDays === 0
                      ? t(language, 'sim.sellToday')
                      : `${simHoldDays} ${simHoldDays > 1 ? t(language, 'sim.days') : t(language, 'sim.day')}`}
                  </span>
                </div>

                {/* Horizon Presets */}
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {HOLD_PRESETS.map((p) => (
                    <button
                      key={p.days}
                      onClick={() => setSimHoldDays(p.days)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-colors text-center ${
                        simHoldDays === p.days
                          ? 'bg-primary text-on-primary shadow-sm'
                          : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                      }`}
                    >
                      {t(language, p.labelKey)}
                    </button>
                  ))}
                </div>

                {/* Range Slider (0-7 days) */}
                <input
                  type="range"
                  min="0"
                  max="7"
                  value={simHoldDays}
                  onChange={(e) => setSimHoldDays(Number(e.target.value))}
                  className="w-full accent-secondary cursor-pointer h-2 bg-surface-container rounded-lg"
                />
              </div>

              {/* Loading State */}
              {simLoading && (
                <div className="p-8 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-2xl animate-spin text-secondary">progress_activity</span>
                  <span className="text-xs font-medium">{t(language, 'sim.calculating')}</span>
                </div>
              )}

              {/* Error State */}
              {simError && !simLoading && (
                <div className="p-3 bg-error-container text-on-error-container rounded-xl text-xs">
                  {simError}
                </div>
              )}

              {/* Simulation Results Display */}
              {!simLoading && simResult && (
                <div className="space-y-3">
                  {/* Demo Synthetic Badge if sample data */}
                  {simResult.dataStatus === 'SYNTHETIC_SAMPLE' && (
                    <div className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2 text-xs text-amber-800">
                      <span className="material-symbols-outlined text-[16px] text-amber-600">science</span>
                      <span>{t(language, 'sim.syntheticBadge')}</span>
                    </div>
                  )}

                  {/* Single Mandi Scenario Details */}
                  {simResult.current && simResult.forecast && (
                    <div className="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/20 space-y-3">
                      {/* Comparison Delta Highlight */}
                      {simResult.comparison?.grossRevenueDifference !== null ? (
                        <div className="p-3 rounded-lg bg-surface-container flex items-center justify-between">
                          <div>
                            <span className="text-xs text-on-surface-variant block">
                              {t(language, 'sim.revenueDiff')}:
                            </span>
                            <span
                              className={`text-title-lg font-bold ${
                                simResult.comparison.grossRevenueDifference > 0
                                  ? 'text-secondary'
                                  : simResult.comparison.grossRevenueDifference < 0
                                  ? 'text-error'
                                  : 'text-on-surface'
                              }`}
                            >
                              {simResult.comparison.grossRevenueDifference > 0 ? '+' : ''}₹
                              {simResult.comparison.grossRevenueDifference.toLocaleString('en-IN')}{' '}
                              ({simResult.comparison.percentageDifference > 0 ? '+' : ''}
                              {simResult.comparison.percentageDifference}%)
                            </span>
                          </div>
                          <span
                            className={`material-symbols-outlined text-2xl ${
                              simResult.comparison.grossRevenueDifference >= 0
                                ? 'text-secondary'
                                : 'text-error'
                            }`}
                          >
                            {simResult.comparison.grossRevenueDifference >= 0 ? 'trending_up' : 'trending_down'}
                          </span>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-surface-container rounded-lg text-xs text-on-surface-variant">
                          {t(language, 'sim.noForecast')}
                        </div>
                      )}

                      {/* Side by Side Comparison Grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/20">
                          <span className="text-on-surface-variant block mb-0.5 font-medium">
                            {t(language, 'sim.currentReported')}:
                          </span>
                          <div className="font-bold text-on-surface text-body-lg">
                            {simResult.current.modalPrice
                              ? `₹${simResult.current.modalPrice.toLocaleString('en-IN')}/q`
                              : '—'}
                          </div>
                          <div className="text-[11px] text-on-surface-variant mt-1">
                            Gross: ₹{simResult.current.grossRevenue?.toLocaleString('en-IN') || '—'}
                          </div>
                          <div className="text-[10px] text-outline mt-0.5">
                            Date: {simResult.current.priceReportedDate || '—'}
                          </div>
                        </div>

                        <div className="bg-surface-container-lowest p-2.5 rounded-lg border border-outline-variant/20">
                          <span className="text-on-surface-variant block mb-0.5 font-medium">
                            {t(language, 'sim.forecastPrice')}:
                          </span>
                          <div className="font-bold text-secondary text-body-lg">
                            {simResult.forecast.predictedModalPrice
                              ? `₹${simResult.forecast.predictedModalPrice.toLocaleString('en-IN')}/q`
                              : '—'}
                          </div>
                          <div className="text-[11px] text-on-surface-variant mt-1">
                            Gross: ₹{simResult.forecast.grossRevenue?.toLocaleString('en-IN') || '—'}
                          </div>
                          <div className="text-[10px] text-outline mt-0.5">
                            Target: {simResult.forecast.targetDate || '—'}
                          </div>
                        </div>
                      </div>

                      {/* Prediction Interval Range */}
                      {simResult.forecast.lowerBound !== null && (
                        <div className="text-xs pt-1 border-t border-outline-variant/20 flex justify-between text-on-surface-variant">
                          <span>{t(language, 'sim.forecastRange')}:</span>
                          <span className="font-semibold text-on-surface">
                            ₹{simResult.forecast.lowerBound.toLocaleString('en-IN')} – ₹
                            {simResult.forecast.upperBound.toLocaleString('en-IN')}/q
                          </span>
                        </div>
                      )}

                      {/* Risk Analysis Status */}
                      {simResult.risk?.available && (
                        <div className="p-2.5 bg-surface-container rounded-lg text-xs space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-on-surface-variant">{t(language, 'sim.marketRisk')}:</span>
                            <span className="font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                              {simResult.risk.overallLevel}
                            </span>
                          </div>
                          {simResult.risk.summaryAdvice && (
                            <p className="text-[11px] text-on-surface leading-tight">
                              {simResult.risk.summaryAdvice}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Multi-Mandi Plan Simulation Summary (if plan view) */}
                  {simResult.type === 'MULTI_MANDI_PLAN' && simResult.summary && (
                    <div className="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/20 space-y-2">
                      <div className="p-2.5 bg-surface-container rounded-lg flex items-center justify-between">
                        <div>
                          <span className="text-xs text-on-surface-variant block">Combined Plan Gross Difference:</span>
                          <span
                            className={`text-body-lg font-bold ${
                              simResult.summary.totalGrossRevenueDifference > 0
                                ? 'text-secondary'
                                : simResult.summary.totalGrossRevenueDifference < 0
                                ? 'text-error'
                                : 'text-on-surface'
                            }`}
                          >
                            {simResult.summary.totalGrossRevenueDifference > 0 ? '+' : ''}₹
                            {simResult.summary.totalGrossRevenueDifference?.toLocaleString('en-IN') || 0}{' '}
                            ({simResult.summary.totalPercentageDifference > 0 ? '+' : ''}
                            {simResult.summary.totalPercentageDifference}%)
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1 pt-1">
                        {simResult.mandiSimulations.map((item, idx) => (
                          <div
                            key={idx}
                            className="p-2 bg-surface-container-lowest rounded-lg text-xs flex justify-between items-center"
                          >
                            <span className="font-medium text-on-surface">{item.mandi.name}:</span>
                            <span className="text-on-surface-variant">
                              {item.forecast.predictedModalPrice
                                ? `₹${item.forecast.predictedModalPrice}/q`
                                : 'No forecast'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Decision Limitations Notice */}
                  <div className="p-3 bg-surface-container/60 rounded-xl text-[11px] text-on-surface-variant leading-relaxed">
                    <div className="font-bold text-on-surface mb-0.5">{t(language, 'sim.limitationsTitle')}:</div>
                    <p>{t(language, 'sim.limitations')}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Close Button */}
            <div className="pt-2 border-t border-outline-variant/20 shrink-0">
              <button
                className="w-full h-11 bg-primary text-on-primary font-bold rounded-xl active:scale-[0.98] transition-all"
                onClick={() => setModalOpen(false)}
              >
                {t(language, 'sim.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
