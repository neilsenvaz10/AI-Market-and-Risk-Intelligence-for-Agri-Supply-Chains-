import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatQuantity } from '../constants/profile';
import { t } from '../i18n/strings';
import { getLatestMandiPrices } from '../services/api';

const DEFAULT_ONION_PRICES = [
  { code: 'NSK', name: 'Nashik APMC', modal: '₹2,350 / quintal', rawModal: '₹2,350', trend: '-1.2% today', isUp: false },
  { code: 'PUN', name: 'Pune Market Yard', modal: '₹2,450 / quintal', rawModal: '₹2,450', trend: '+2.4% today', isUp: true },
  { code: 'AHM', name: 'Ahmednagar Mandi', modal: '₹2,380 / quintal', rawModal: '₹2,380', trend: '+0.8% today', isUp: true },
];

export default function HomePage() {
  const { farmer, language } = useAuth();
  const firstName = farmer?.fullName?.split(' ')[0] || '';
  const [onionPrices, setOnionPrices] = useState(DEFAULT_ONION_PRICES);

  useEffect(() => {
    let isMounted = true;
    getLatestMandiPrices({ commodity: 'ONION' })
      .then((res) => {
        if (!isMounted || !res || !res.data || res.data.length === 0) return;

        // Map live records for the three primary mandis
        const codeMap = {
          'MH_NSK_MAIN': 'NSK',
          'MH_PUNE_APMC': 'PUN',
          'MH_AHM_APMC': 'AHM',
        };

        const targetRecords = res.data.filter((r) => codeMap[r.mandi_code]);
        if (targetRecords.length > 0) {
          const mapped = targetRecords.map((r) => ({
            code: codeMap[r.mandi_code] || r.mandi_code.slice(0, 3),
            name: r.mandi_name,
            modal: `₹${Number(r.modal_price).toLocaleString('en-IN')} / ${t(language, 'home.mandiPrices.quintal')}`,
            rawModal: `₹${Number(r.modal_price).toLocaleString('en-IN')}`,
            trend: `${r.trend_percent >= 0 ? '+' : ''}${r.trend_percent}% ${t(language, 'home.mandiPrices.today')}`,
            isUp: r.trend_direction !== 'down',
          }));
          setOnionPrices(mapped);
        }
      })
      .catch(() => {
        // Retain default values
      });

    return () => {
      isMounted = false;
    };
  }, [language]);

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
              {farmer.primaryCrop} • {formatQuantity(farmer.cropQuantity, farmer.quantityUnit)}
            </p>
          )}
        </div>
        <div className="bg-surface-container-high px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm shrink-0 max-w-[45%]">
          <span className="w-2 h-2 rounded-full bg-secondary shrink-0"></span>
          <span className="font-label-md text-xs text-on-surface font-medium truncate">
            {farmer?.district ? `${farmer.district}, ${farmer.state}` : t(language, 'home.locationFallback')}
          </span>
        </div>
      </div>

      {/* Hero Decision Card */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="bg-tertiary-container text-on-tertiary-container px-2.5 py-0.5 rounded-full font-label-md text-xs font-bold uppercase tracking-wider">
            {t(language, 'home.badge.optimalWindow')}
          </span>
          <span className="font-body-sm text-xs text-on-surface-variant flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-secondary">update</span>
            {t(language, 'home.updatedAgo')}
          </span>
        </div>

        <h2 className="font-headline-lg text-primary text-xl mb-1">
          {t(language, 'home.hero.title')}
        </h2>
        <p className="font-body-md text-on-surface-variant text-sm mb-4">
          {t(language, 'home.hero.reasoning')}
        </p>

        {/* Expected Net Return Callout */}
        <div className="bg-surface-container-lowest rounded-xl p-3 mb-4 border border-outline-variant/20">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="font-body-sm text-xs text-on-surface-variant block">
                {t(language, 'home.hero.expectedReturn')}
              </span>
              <span className="font-headline-lg text-2xl font-bold text-on-surface">
                {t(language, 'home.hero.returnValue')}
              </span>
            </div>
            <div className="text-right">
              <span className="font-label-lg text-xs font-bold text-secondary flex items-center justify-end gap-0.5">
                <span className="material-symbols-outlined text-[14px]">trending_up</span>
                {t(language, 'home.hero.gainVsLocal')}
              </span>
              <span className="text-[10px] text-on-surface-variant">
                {t(language, 'home.hero.gainSubtext')}
              </span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <Link
          to="/recommendation"
          className="w-full bg-primary hover:bg-primary/90 text-on-primary py-3 rounded-xl font-label-lg font-bold text-center block shadow-sm active:scale-[0.99] transition-transform"
        >
          {t(language, 'home.hero.viewPlan')}
        </Link>
      </div>

      {/* Proactive Alert Banner */}
      <div className="bg-error-container/40 border border-error/20 rounded-xl p-3 mb-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-error text-[20px] mt-0.5 shrink-0">
          warning
        </span>
        <div className="flex-1">
          <p className="font-label-lg text-xs font-bold text-on-error-container">
            {t(language, 'home.alert.title')}
          </p>
          <p className="font-body-sm text-xs text-on-error-container/80 mt-0.5">
            {t(language, 'home.alert.body')}
          </p>
        </div>
        <Link
          to="/alerts"
          className="font-label-md text-xs font-bold text-error self-center underline shrink-0"
        >
          {t(language, 'home.alert.link')}
        </Link>
      </div>

      {/* Risk / Confidence Tiles Strip */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        {/* Volatility */}
        <div className="bg-surface-container-low p-2.5 rounded-xl border border-outline-variant/20">
          <span className="font-body-sm text-[11px] text-on-surface-variant block truncate">
            {t(language, 'home.tile.volatility')}
          </span>
          <span className="font-label-lg text-xs font-bold text-on-tertiary-container bg-tertiary-container/50 px-1.5 py-0.5 rounded inline-block my-1">
            {t(language, 'home.tile.volatilityLevel')}
          </span>
          <p className="font-body-sm text-[10px] text-on-surface-variant truncate">
            {t(language, 'home.tile.volatilitySubtext')}
          </p>
        </div>

        {/* Confidence */}
        <div className="bg-surface-container-low p-2.5 rounded-xl border border-outline-variant/20">
          <span className="font-body-sm text-[11px] text-on-surface-variant block truncate">
            {t(language, 'home.tile.modelAccuracy')}
          </span>
          <span className="font-headline-md text-lg text-on-surface font-bold my-0.5 block">
            {t(language, 'home.tile.accuracyValue')}
          </span>
          <p className="font-body-sm text-[10px] text-secondary font-medium truncate">
            {t(language, 'home.tile.accuracySubtext')}
          </p>
        </div>

        {/* Data Freshness */}
        <div className="bg-surface-container-low p-2.5 rounded-xl border border-outline-variant/20">
          <span className="font-body-sm text-[11px] text-on-surface-variant block truncate">
            {t(language, 'home.tile.freshness')}
          </span>
          <div className="my-0.5 flex items-baseline">
            <span className="font-headline-md text-lg text-on-surface font-bold">2h</span>
            <span className="text-[10px] text-on-surface-variant"> {t(language, 'home.tile.freshnessUnit')}</span>
          </div>
          <p className="font-body-sm text-[10px] text-secondary font-medium truncate">
            {t(language, 'home.tile.freshnessSubtext')}
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

      {/* Today's Mandi Prices Section */}
      <div className="bg-surface-container-lowest rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-headline-md text-on-surface text-base">
            {t(language, 'home.mandiPrices.title')}
          </h3>
          <Link to="/mandis" className="font-label-md text-xs text-secondary font-medium">
            {t(language, 'home.mandiPrices.viewAll')}
          </Link>
        </div>
        <div className="space-y-3">
          {onionPrices.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low">
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                    item.code === 'PUN'
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'bg-surface-container-high text-on-surface'
                  }`}
                >
                  {item.code}
                </div>
                <div>
                  <p className="font-label-lg text-sm font-bold text-on-surface">{item.name}</p>
                  <p className="font-body-sm text-xs text-on-surface-variant">
                    {t(language, 'home.mandiPrices.modal')}: {item.modal}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span
                  className={`font-label-lg text-sm font-bold flex items-center justify-end gap-0.5 ${
                    item.isUp ? 'text-secondary' : 'text-error'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {item.isUp ? 'trending_up' : 'trending_down'}
                  </span>{' '}
                  {item.rawModal}
                </span>
                <span className={`text-[10px] font-medium ${item.isUp ? 'text-secondary' : 'text-error'}`}>
                  {item.trend}
                </span>
              </div>
            </div>
          ))}
        </div>
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
