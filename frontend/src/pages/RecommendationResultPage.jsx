import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function RecommendationResultPage() {
  const { language } = useAuth();
  const [whyOpen, setWhyOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [holdDays, setHoldDays] = useState(1);
  const [sharedToast, setSharedToast] = useState(false);

  const handleShareOnWhatsApp = () => {
    setSharedToast(true);
    setTimeout(() => setSharedToast(false), 3000);
  };

  return (
    <div className="flex flex-col w-full pb-8">
      {/* Top Summary Banner */}
      <div className="bg-primary text-on-primary rounded-xl p-6 shadow-md mb-6 relative overflow-hidden">
        <div className="absolute -right-6 -bottom-6 w-32 h-32 rounded-full bg-secondary-container/10 pointer-events-none"></div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-label-md text-primary-fixed uppercase tracking-wider font-label-md">
            {t(language, 'rec.optimizedReturn')}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-body-sm font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">trending_up</span> {t(language, 'rec.vsAvg')}
          </span>
        </div>
        <div className="text-headline-xl font-headline-xl text-primary-fixed mb-4">₹19,800</div>
        {/* Chips Row */}
        <div className="flex flex-wrap gap-2 pt-2">
          <span className="px-3 py-1 rounded-full bg-surface-container-low text-on-surface text-body-sm font-medium flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            {t(language, 'rec.risk')}: {t(language, 'rec.riskLevel')}
          </span>
          <span className="px-3 py-1 rounded-full bg-surface-container-low text-on-surface text-body-sm font-medium flex items-center gap-1.5 shadow-sm">
            <span className="material-symbols-outlined text-[14px] text-secondary">verified</span>
            {t(language, 'rec.confidence')}: 78%
          </span>
          <span className="px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-body-sm font-bold flex items-center gap-1.5 shadow-sm">
            <span className="material-symbols-outlined text-[14px]">schedule</span>
            {t(language, 'rec.sellTomorrow')}
          </span>
        </div>
      </div>

      {/* Allocation Card */}
      <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-headline-md font-headline-md text-on-surface">
            {t(language, 'rec.mandiSplit')}
          </h3>
          <span className="text-body-sm text-on-surface-variant">
            {t(language, 'rec.total')}: 1,000 {t(language, 'unit.kg')}
          </span>
        </div>
        {/* Visual Bar */}
        <div className="h-4 w-full rounded-full bg-surface-container flex overflow-hidden mb-5 gap-1">
          <div className="bg-secondary h-full rounded-l-full transition-all duration-500" style={{ width: '60%' }}></div>
          <div className="bg-amber-400 h-full rounded-r-full transition-all duration-500" style={{ width: '40%' }}></div>
        </div>
        {/* Allocation Details */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-container-low p-4 rounded-xl flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface text-body-lg">{t(language, 'rec.puneMandi')}</span>
              <span className="text-xs font-bold text-secondary bg-secondary-container/50 px-2 py-0.5 rounded-full">60%</span>
            </div>
            <div className="text-headline-md font-headline-md text-secondary">600 {t(language, 'unit.kg')}</div>
            <span className="text-body-sm text-on-surface-variant">
              {t(language, 'rec.expected')}: ₹2,050 / {t(language, 'unit.quintal')}
            </span>
          </div>
          <div className="bg-surface-container-low p-4 rounded-xl flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface text-body-lg">{t(language, 'rec.ahmednagarMandi')}</span>
              <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">40%</span>
            </div>
            <div className="text-headline-md font-headline-md text-amber-700">400 {t(language, 'unit.kg')}</div>
            <span className="text-body-sm text-on-surface-variant">
              {t(language, 'rec.expected')}: ₹1,920 / {t(language, 'unit.quintal')}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable "Why this plan?" */}
      <div className="bg-surface-container-lowest rounded-xl shadow-sm mb-6 overflow-hidden">
        <button
          className="w-full p-5 flex items-center justify-between text-left focus:outline-none"
          onClick={() => setWhyOpen(!whyOpen)}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center">
              <span className="material-symbols-outlined">lightbulb</span>
            </div>
            <div>
              <h4 className="font-headline-md text-headline-md text-on-surface">
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
          <div className="px-5 pb-5 pt-1 space-y-3">
            <div className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span className="material-symbols-outlined text-secondary mt-0.5">check_circle</span>
              <p className="text-body-md text-on-surface">{t(language, 'rec.reason1')}</p>
            </div>
            <div className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span className="material-symbols-outlined text-secondary mt-0.5">check_circle</span>
              <p className="text-body-md text-on-surface">{t(language, 'rec.reason2')}</p>
            </div>
            <div className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
              <span className="material-symbols-outlined text-secondary mt-0.5">check_circle</span>
              <p className="text-body-md text-on-surface">{t(language, 'rec.reason3')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3">
        <button
          className="w-full h-12 bg-amber-400 hover:bg-amber-500 text-on-tertiary-fixed font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
          onClick={() => setModalOpen(true)}
        >
          <span className="material-symbols-outlined">psychology</span>
          {t(language, 'rec.whatIf')}
        </button>
        <button
          className="w-full h-12 bg-surface-container-lowest text-secondary border border-secondary/30 font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
          onClick={handleShareOnWhatsApp}
        >
          <span className="material-symbols-outlined">share</span>
          {t(language, 'rec.share')}
        </button>
      </div>

      {/* Toast Notification */}
      {sharedToast && (
        <div className="fixed top-20 inset-x-4 max-w-sm mx-auto z-50 bg-secondary text-on-secondary px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-bounce">
          <span className="material-symbols-outlined">check_circle</span>
          <span className="text-body-md font-medium">{t(language, 'rec.toastShared')}</span>
        </div>
      )}

      {/* "What if?" Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-end justify-center transition-opacity">
          <div className="bg-surface-container-lowest w-full rounded-t-2xl p-6 shadow-xl max-w-md animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline-md text-headline-md text-on-surface">
                {t(language, 'rec.simulator.title')}
              </h3>
              <button
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface"
                onClick={() => setModalOpen(false)}
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <p className="text-body-md text-on-surface-variant mb-4">
              {t(language, 'rec.simulator.subtitle')}
            </p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-body-sm font-bold text-on-surface flex justify-between mb-1">
                  <span>{t(language, 'rec.simulator.holdDuration')}</span>
                  <span className="text-secondary font-bold">
                    {holdDays} {holdDays > 1
                      ? t(language, 'rec.simulator.daysExtra')
                      : t(language, 'rec.simulator.dayExtra')}
                  </span>
                </label>
                <input
                  className="w-full accent-secondary"
                  max="5"
                  min="1"
                  type="range"
                  value={holdDays}
                  onChange={(e) => setHoldDays(Number(e.target.value))}
                />
              </div>
              <div className="p-3 bg-surface-container-low rounded-xl flex items-center justify-between">
                <span className="text-body-md text-on-surface">
                  {t(language, 'rec.simulator.riskShift')}
                </span>
                <span className="text-body-md font-bold text-error">
                  {holdDays === 1
                    ? t(language, 'rec.simulator.riskHigh')
                    : t(language, 'rec.simulator.riskVeryHigh', { percent: holdDays * 14 })}
                </span>
              </div>
            </div>
            <button
              className="w-full h-12 bg-primary text-on-primary font-bold rounded-xl active:scale-[0.98]"
              onClick={() => setModalOpen(false)}
            >
              {t(language, 'rec.simulator.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
