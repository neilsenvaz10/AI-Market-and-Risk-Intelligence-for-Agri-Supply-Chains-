import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatQuantity, translateCrop, translateLocation } from '../constants/profile';
import { t } from '../i18n/strings';

export default function HomePage() {
  const { farmer, language } = useAuth();
  const firstName = farmer?.fullName?.split(' ')[0] || '';

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

      {/* Demo notice */}
      <div className="bg-surface-container-high text-on-surface-variant px-3 py-2 rounded-xl mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-[16px]">info</span>
        <p className="font-body-sm text-[11px]">
          {t(language, 'home.demoNotice')}
        </p>
      </div>

      {/* Dark Green Hero Card */}
      <Link
        to="/recommendation"
        className="block bg-primary text-on-primary rounded-xl p-5 mb-4 shadow-md relative overflow-hidden active:scale-[0.99] transition-transform"
      >
        <div className="absolute -right-10 -bottom-10 w-36 h-36 bg-secondary/10 rounded-full blur-2xl pointer-events-none"></div>
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-body-sm text-primary-fixed-dim uppercase tracking-wider text-[11px] font-semibold">
              {t(language, 'home.hero.expectedReturn')}
            </p>
            <h2 className="font-headline-xl text-on-primary mt-0.5">₹19,800</h2>
          </div>
          <span className="bg-tertiary-fixed text-on-tertiary-fixed px-2.5 py-1 rounded-full font-label-md text-xs font-bold shadow-sm">
            {t(language, 'home.hero.sellTomorrow')}
          </span>
        </div>
        {/* Split bar Pune 60% / Ahmednagar 40% */}
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

      {/* Red Alert Strip */}
      <Link
        to="/alerts"
        className="bg-error-container text-on-error-container p-3 rounded-xl mb-4 flex items-center gap-3 shadow-sm active:scale-[0.99] transition-transform"
      >
        <span className="material-symbols-outlined text-error animate-pulse text-[22px]">warning</span>
        <div className="flex-1">
          <p className="font-label-md text-xs font-bold">{t(language, 'home.alert.title')}</p>
          <p className="font-body-sm text-xs">{t(language, 'home.alert.body')}</p>
        </div>
        <span className="material-symbols-outlined text-[18px] opacity-60">chevron_right</span>
      </Link>

      {/* Three Small Tiles: Risk, Confidence, Data freshness */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Risk Tile */}
        <div className="bg-surface-container-lowest p-3 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-body-sm text-xs">{t(language, 'home.tile.risk')}</span>
            <span className="material-symbols-outlined text-[16px] text-amber-600">shield</span>
          </div>
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 mb-1">
              {t(language, 'home.tile.riskLevel')}
            </span>
            <p className="font-body-sm text-[10px] text-on-surface-variant truncate">
              {t(language, 'home.tile.riskSubtext')}
            </p>
          </div>
        </div>
        {/* Confidence Tile */}
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
          </div>
          <p className="font-body-sm text-[10px] text-on-surface-variant truncate">
            {t(language, 'home.tile.aiConfSubtext')}
          </p>
        </div>
        {/* Data Freshness Tile */}
        <div className="bg-surface-container-lowest p-3 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-body-sm text-xs">{t(language, 'home.tile.freshness')}</span>
            <span className="w-2 h-2 rounded-full bg-secondary"></span>
          </div>
          <div>
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
            {t(language, 'home.mandiPrices.title')}{' '}
            <span className="align-middle text-[10px] font-body-sm font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              {t(language, 'home.demoBadge')}
            </span>
          </h3>
          <Link to="/mandis" className="font-label-md text-xs text-secondary font-medium">
            {t(language, 'home.mandiPrices.viewAll')}
          </Link>
        </div>
        <div className="space-y-3">
          {/* Nashik */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface font-bold text-xs">
                NSK
              </div>
              <div>
                <p className="font-label-lg text-sm font-bold text-on-surface">
                  {t(language, 'home.mandiPrices.nashikName')}
                </p>
                <p className="font-body-sm text-xs text-on-surface-variant">
                  {t(language, 'home.mandiPrices.modal')}: ₹2,350 / {t(language, 'home.mandiPrices.quintal')}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="font-label-lg text-sm font-bold text-error flex items-center justify-end gap-0.5">
                <span className="material-symbols-outlined text-[16px]">trending_down</span> ₹2,350
              </span>
              <span className="text-[10px] text-error font-medium">-1.2% {t(language, 'home.mandiPrices.today')}</span>
            </div>
          </div>
          {/* Pune */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-xs">
                PUN
              </div>
              <div>
                <p className="font-label-lg text-sm font-bold text-on-surface">
                  {t(language, 'home.mandiPrices.puneName')}
                </p>
                <p className="font-body-sm text-xs text-on-surface-variant">
                  {t(language, 'home.mandiPrices.modal')}: ₹2,450 / {t(language, 'home.mandiPrices.quintal')}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="font-label-lg text-sm font-bold text-secondary flex items-center justify-end gap-0.5">
                <span className="material-symbols-outlined text-[16px]">trending_up</span> ₹2,450
              </span>
              <span className="text-[10px] text-secondary font-medium">+2.4% {t(language, 'home.mandiPrices.today')}</span>
            </div>
          </div>
          {/* Ahmednagar */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface font-bold text-xs">
                AHM
              </div>
              <div>
                <p className="font-label-lg text-sm font-bold text-on-surface">
                  {t(language, 'home.mandiPrices.ahmednagarName')}
                </p>
                <p className="font-body-sm text-xs text-on-surface-variant">
                  {t(language, 'home.mandiPrices.modal')}: ₹2,380 / {t(language, 'home.mandiPrices.quintal')}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="font-label-lg text-sm font-bold text-secondary flex items-center justify-end gap-0.5">
                <span className="material-symbols-outlined text-[16px]">trending_up</span> ₹2,380
              </span>
              <span className="text-[10px] text-secondary font-medium">+0.8% {t(language, 'home.mandiPrices.today')}</span>
            </div>
          </div>
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
