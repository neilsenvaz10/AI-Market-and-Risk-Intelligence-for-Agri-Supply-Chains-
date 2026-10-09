import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LANGUAGES } from '../i18n/languages';
import { t } from '../i18n/strings';

/* ─────────────────────────────────────────────────────────────────────────────
   FASALYTICS PUBLIC LANDING PAGE
   Route: /landing  (public — no auth required)
   Images used:
     - /images/market/market1.jpg → Hero section (Indian produce vendor,
       strongest composition for hero — colourful, portrait, well-lit)
     - /images/market/market2.jpg → Farmer story section (Indian vegetable
       mandi with onions — contextual, authentic)
   Images intentionally NOT used:
     - /images/market/market3.jpg → South-East Asian market (wrong region)
   Stats: ALL DEMO / CONFIGURABLE — not verified real-world numbers.
          Replace values in strings.js under 'landing.stats.*' when available.
───────────────────────────────────────────────────────────────────────────── */

const FEATURES = [
  { key: 'f1', icon: 'storefront' },
  { key: 'f2', icon: 'auto_graph' },
  { key: 'f3', icon: 'map' },
  { key: 'f4', icon: 'schedule' },
  { key: 'f5', icon: 'shield' },
  { key: 'f6', icon: 'calculate' },
];

const WHY_POINTS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

const HOW_STEPS = ['step1', 'step2', 'step3', 'step4'];

const AUDIENCE = [
  { key: 'farmers', icon: 'agriculture' },
  { key: 'fpo', icon: 'groups' },
  { key: 'partners', icon: 'handshake' },
];

/* ── STATS — DEMO/CONFIGURABLE ────────────────────────────────────────────── */
const STAT_KEYS = [
  { valueKey: 'landing.stats.cities',     labelKey: 'landing.stats.citiesLabel' },
  { valueKey: 'landing.stats.farmers',    labelKey: 'landing.stats.farmersLabel' },
  { valueKey: 'landing.stats.crops',      labelKey: 'landing.stats.cropsLabel' },
  { valueKey: 'landing.stats.dataPoints', labelKey: 'landing.stats.dataPointsLabel' },
];

export default function LandingPage() {
  const { language, setLanguage, isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const T = (key) => t(language, key);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface overflow-x-hidden font-body-md">
      {/* ── NAVIGATION ──────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-primary text-on-primary shadow-[0_1px_12px_rgba(0,38,13,0.2)]">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <Link to="/landing" className="text-headline-md font-headline-md tracking-tight uppercase shrink-0">
            Fasalytics
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button onClick={() => scrollTo('why')} className="opacity-90 hover:opacity-100 transition-opacity">
              {T('landing.nav.why')}
            </button>
            <button onClick={() => scrollTo('features')} className="opacity-90 hover:opacity-100 transition-opacity">
              {T('landing.nav.features')}
            </button>
            <button onClick={() => scrollTo('how')} className="opacity-90 hover:opacity-100 transition-opacity">
              {T('landing.nav.howItWorks')}
            </button>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 md:gap-3">
            {/* Language switcher */}
            <div className="flex bg-primary-container rounded-full p-0.5 text-xs shrink-0">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  aria-pressed={language === lang.code}
                  title={lang.label}
                  onClick={() => setLanguage(lang.code).catch(() => {})}
                  className={`px-2 py-1 rounded-full transition-colors ${
                    language === lang.code ? 'bg-surface text-primary font-bold' : 'text-on-primary-container'
                  }`}
                >
                  {lang.pill}
                </button>
              ))}
            </div>

            {/* Auth buttons — desktop */}
            <div className="hidden md:flex items-center gap-2">
              <Link
                to="/login"
                className="px-4 py-1.5 rounded-full text-sm font-medium bg-primary-container text-on-primary-container hover:bg-primary-container/80 transition-colors"
              >
                {T('landing.nav.login')}
              </Link>
              <Link
                to={isAuthenticated ? '/' : '/signup'}
                className="px-4 py-1.5 rounded-full text-sm font-bold bg-secondary text-on-secondary hover:bg-secondary/90 transition-colors shadow-sm"
              >
                {T('landing.nav.getStarted')}
              </Link>
            </div>

            {/* Mobile menu toggle */}
            <button
              type="button"
              aria-label={menuOpen ? T('landing.nav.closeMenu') : T('landing.nav.openMenu')}
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-full bg-primary-container text-on-primary-container"
            >
              <span className="material-symbols-outlined text-[22px]">
                {menuOpen ? 'close' : 'menu'}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden bg-primary border-t border-primary-container/30 px-4 py-4 flex flex-col gap-3">
            <button onClick={() => scrollTo('why')} className="text-left text-sm font-medium opacity-90 py-2 border-b border-primary-container/20">
              {T('landing.nav.why')}
            </button>
            <button onClick={() => scrollTo('features')} className="text-left text-sm font-medium opacity-90 py-2 border-b border-primary-container/20">
              {T('landing.nav.features')}
            </button>
            <button onClick={() => scrollTo('how')} className="text-left text-sm font-medium opacity-90 py-2 border-b border-primary-container/20">
              {T('landing.nav.howItWorks')}
            </button>
            <div className="flex gap-3 pt-2">
              <Link
                to="/login"
                onClick={() => setMenuOpen(false)}
                className="flex-1 text-center px-4 py-2.5 rounded-xl text-sm font-medium bg-primary-container text-on-primary-container"
              >
                {T('landing.nav.login')}
              </Link>
              <Link
                to={isAuthenticated ? '/' : '/signup'}
                onClick={() => setMenuOpen(false)}
                className="flex-1 text-center px-4 py-2.5 rounded-xl text-sm font-bold bg-secondary text-on-secondary shadow-sm"
              >
                {T('landing.nav.getStarted')}
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── HERO SECTION ──────────────────────────────────────────────────────
          Image: market1.jpg — Indian produce vendor in blue shirt,
          colourful fruits and vegetables. Best composition of the three.
          market3.jpg not used — South-East Asian context.
      ─────────────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        {/* Hero background image */}
        <div className="absolute inset-0">
          <img
            src="/images/market/market1.jpg"
            alt="Indian APMC market — colourful produce display at a local mandi"
            className="w-full h-full object-cover object-center"
            loading="eager"
          />
          {/* Dark gradient overlay — keeps text readable, preserves image richness */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        </div>

        {/* Hero content */}
        <div className="relative z-10 max-w-6xl mx-auto px-4 py-20 md:py-28 w-full">
          <div className="max-w-2xl">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-secondary/20 border border-secondary/40 text-secondary px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-6 backdrop-blur-sm">
              <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>eco</span>
              AI · Market Intelligence · Indian Agriculture
            </div>

            {/* Headline */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight mb-6 tracking-tight drop-shadow-lg">
              {T('landing.hero.headline')}
            </h1>

            {/* Subtext */}
            <p className="text-white/85 text-base md:text-lg leading-relaxed mb-8 max-w-xl drop-shadow">
              {T('landing.hero.subtext')}
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <Link
                to={isAuthenticated ? '/' : '/signup'}
                id="hero-get-started"
                className="inline-flex items-center gap-2 bg-secondary text-on-secondary px-6 py-3.5 rounded-xl font-bold text-sm shadow-lg hover:bg-secondary/90 active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_forward</span>
                {T('landing.hero.cta.primary')}
              </Link>
              <button
                onClick={() => scrollTo('features')}
                id="hero-explore"
                className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/30 text-white px-6 py-3.5 rounded-xl font-semibold text-sm hover:bg-white/25 active:scale-[0.98] transition-all"
              >
                {T('landing.hero.cta.secondary')}
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom fade to surface */}
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-surface to-transparent pointer-events-none" />
      </section>

      {/* ── STATS SECTION (DEMO/CONFIGURABLE) ──────────────────────────────── */}
      <section className="bg-surface py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4">
          {/* DEMO data notice — visible in code, hidden from UI */}
          {/* NOTE: Replace values in strings.js 'landing.stats.*' with verified numbers when available */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {STAT_KEYS.map(({ valueKey, labelKey }) => (
              <div key={valueKey} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-primary mb-1">
                  {T(valueKey)}
                </div>
                <div className="text-sm text-on-surface-variant font-medium">
                  {T(labelKey)}
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-on-surface-variant/50 mt-6 italic">
            * Demo figures — configurable in i18n/strings.js under 'landing.stats.*'
          </p>
        </div>
      </section>

      {/* ── WHY FASALYTICS SECTION ────────────────────────────────────────── */}
      <section id="why" className="bg-surface-container-low py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 bg-tertiary-container text-on-tertiary-container px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4">
              <span className="material-symbols-outlined text-[14px]">info</span>
              The Challenge
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-on-surface mb-4 leading-tight">
              {T('landing.why.heading')}
            </h2>
            <p className="text-on-surface-variant text-base leading-relaxed">
              {T('landing.why.intro')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {WHY_POINTS.map((p, idx) => (
              <div
                key={p}
                className="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/20 shadow-sm hover:shadow-md hover:border-secondary/30 transition-all"
              >
                <div className="flex items-start gap-3">
                  <span className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="font-bold text-on-surface text-sm mb-1.5">
                      {T(`landing.why.${p}.title`)}
                    </h3>
                    <p className="text-on-surface-variant text-sm leading-relaxed">
                      {T(`landing.why.${p}.body`)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES SECTION ──────────────────────────────────────────────── */}
      <section id="features" className="bg-surface py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4">
              <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
              Features
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-on-surface leading-tight">
              {T('landing.features.heading')}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {FEATURES.map(({ key, icon }) => (
              <div
                key={key}
                className="group bg-surface-container-low rounded-2xl p-6 border border-outline-variant/20 shadow-sm hover:shadow-lg hover:border-secondary/40 hover:-translate-y-0.5 transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {icon}
                  </span>
                </div>
                <h3 className="font-bold text-on-surface text-sm mb-2">
                  {T(`landing.features.${key}.title`)}
                </h3>
                <p className="text-on-surface-variant text-sm leading-relaxed">
                  {T(`landing.features.${key}.body`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS SECTION ──────────────────────────────────────────── */}
      <section id="how" className="bg-primary py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-xl mx-auto mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-on-primary leading-tight">
              {T('landing.how.heading')}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-4">
            {HOW_STEPS.map((step, idx) => (
              <div key={step} className="relative flex flex-col items-center text-center">
                {/* Connector line — desktop only */}
                {idx < HOW_STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-6 left-[calc(50%+2rem)] right-0 h-px bg-primary-container/40" />
                )}
                {/* Step circle */}
                <div className="w-12 h-12 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-bold text-base shadow-md mb-4 shrink-0 z-10">
                  {T(`landing.how.${step}.num`)}
                </div>
                <h3 className="font-bold text-on-primary text-sm mb-2 px-2">
                  {T(`landing.how.${step}.title`)}
                </h3>
                <p className="text-on-primary/70 text-xs leading-relaxed px-2">
                  {T(`landing.how.${step}.body`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FARMER STORY SECTION ──────────────────────────────────────────────
          Image: market2.jpg — Indian vegetable vendor with onions and fresh
          produce. More documentary/authentic than market1.
          Responsible wording: no profit guarantees.
      ─────────────────────────────────────────────────────────────────────── */}
      <section className="bg-surface py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
            {/* Image */}
            <div className="relative rounded-2xl overflow-hidden shadow-lg border border-outline-variant/20 order-2 md:order-1">
              <img
                src="/images/market/market2.jpg"
                alt="Indian vegetable market vendor at a local mandi — onions, bananas and fresh produce"
                className="w-full h-72 md:h-96 object-cover object-center"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
            </div>

            {/* Text */}
            <div className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-5">
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>eco</span>
                Farmer-First
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-on-surface mb-5 leading-tight">
                {T('landing.story.heading')}
              </h2>
              <p className="text-on-surface-variant text-base leading-relaxed mb-8">
                {T('landing.story.body')}
              </p>
              <Link
                to={isAuthenticated ? '/' : '/signup'}
                id="story-cta"
                className="inline-flex items-center gap-2 bg-primary text-on-primary px-6 py-3.5 rounded-xl font-bold text-sm shadow-md hover:bg-primary/90 active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                {T('landing.story.cta')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHO IS IT FOR ─────────────────────────────────────────────────── */}
      <section className="bg-surface-container-low py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-on-surface">
              {T('landing.audience.heading')}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {AUDIENCE.map(({ key, icon }) => (
              <div
                key={key}
                className="bg-surface-container-lowest rounded-2xl p-6 text-center border border-outline-variant/20 shadow-sm hover:shadow-md hover:border-secondary/30 transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center mx-auto mb-4">
                  <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {icon}
                  </span>
                </div>
                <h3 className="font-bold text-on-surface mb-2">
                  {T(`landing.audience.${key}.title`)}
                </h3>
                <p className="text-on-surface-variant text-sm leading-relaxed">
                  {T(`landing.audience.${key}.body`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA SECTION ─────────────────────────────────────────────── */}
      <section className="bg-secondary-container py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-secondary text-on-secondary flex items-center justify-center mx-auto mb-6 shadow-md">
            <span className="material-symbols-outlined text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>trending_up</span>
          </div>
          <h2 className="text-2xl md:text-4xl font-bold text-on-secondary-container mb-4 leading-tight">
            {T('landing.cta.heading')}
          </h2>
          <p className="text-on-secondary-container/80 text-base md:text-lg leading-relaxed mb-10 max-w-xl mx-auto">
            {T('landing.cta.subtext')}
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              to={isAuthenticated ? '/' : '/signup'}
              id="final-get-started"
              className="inline-flex items-center gap-2 bg-primary text-on-primary px-8 py-4 rounded-xl font-bold text-base shadow-lg hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_forward</span>
              {T('landing.cta.primary')}
            </Link>
            <Link
              to="/login"
              id="final-login"
              className="inline-flex items-center gap-2 bg-surface text-primary border border-primary/30 px-8 py-4 rounded-xl font-bold text-base hover:bg-surface-container-low active:scale-[0.98] transition-all"
            >
              {T('landing.cta.secondary')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer className="bg-primary text-on-primary py-8 md:py-10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <span className="font-bold text-lg uppercase tracking-tight block mb-1">Fasalytics</span>
              <span className="text-on-primary/70 text-xs">{T('landing.footer.tagline')}</span>
            </div>
            <div className="text-center md:text-right">
              <p className="text-on-primary/60 text-xs leading-relaxed max-w-sm">
                {T('landing.footer.disclaimer')}
              </p>
              <p className="text-on-primary/50 text-xs mt-2">
                {T('landing.footer.rights')}
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
