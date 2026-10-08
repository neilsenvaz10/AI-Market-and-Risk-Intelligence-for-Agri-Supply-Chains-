import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, hasStoredLanguage } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function SplashOnboardingPage() {
  const { language, setLanguage, isAuthenticated } = useAuth();
  // Pre-select Marathi for first-time visitors; afterwards show the saved choice.
  const [selectedLang, setSelectedLang] = useState(() => (hasStoredLanguage() ? language : 'mr'));
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const navigate = useNavigate();

  // Translate using the *selected* language (preview before confirming)
  const ts = (key) => t(selectedLang, key);

  const handleGetStarted = async () => {
    setLoading(true);
    setSaveError(null);
    try {
      // Saved locally, and to the farmer profile in PostgreSQL when logged in
      await setLanguage(selectedLang);
      navigate(isAuthenticated ? '/' : '/login');
    } catch (err) {
      setSaveError(err.message || 'Could not save your language. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full min-h-[80vh] justify-between py-space-md">
      {/* Top decorative branding & welcoming moment */}
      <div className="flex flex-col items-center text-center px-gutter pt-space-lg">
        <div className="w-20 h-20 rounded-full bg-secondary-container flex items-center justify-center shadow-md mb-space-md relative overflow-hidden animate-pulse">
          <span
            className="material-symbols-outlined text-on-secondary-container text-[40px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            eco
          </span>
          <div className="absolute inset-0 bg-gradient-to-tr from-secondary/20 to-transparent"></div>
        </div>
        <span className="text-headline-xl font-headline-xl tracking-tight text-on-surface uppercase mb-space-xs">
          Fasalytics
        </span>
        {/* Tagline shown in the selected language — no bilingual mixing */}
        <p className="text-body-lg font-body-lg text-on-surface-variant max-w-xs">
          {ts('onboarding.tagline')}
        </p>
      </div>

      {/* Interactive Language & Region Selection Cards */}
      <div className="flex flex-col gap-space-sm px-gutter my-space-lg">
        <span className="text-label-md font-label-md text-on-surface-variant uppercase tracking-wider text-center mb-1">
          {ts('onboarding.selectLanguage')}
        </span>

        {/* English Option */}
        <div
          className={`language-card flex items-center justify-between p-space-md rounded-xl shadow-sm cursor-pointer transition-all border-2 ${
            selectedLang === 'en'
              ? 'bg-secondary-container text-on-secondary-container shadow-md border-secondary'
              : 'bg-surface-container-low border-transparent hover:border-secondary'
          }`}
          onClick={() => setSelectedLang('en')}
        >
          <div className="flex items-center gap-space-md">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                selectedLang === 'en'
                  ? 'bg-secondary text-on-secondary'
                  : 'bg-surface-container-highest text-primary'
              }`}
            >
              EN
            </div>
            <div>
              {/* Language option labels are always shown in their own language — intentional */}
              <h4 className="text-label-lg font-label-lg text-on-surface">{t('en', 'onboarding.en.label')}</h4>
              <p className="text-body-sm text-on-surface-variant">{t('en', 'onboarding.en.description')}</p>
            </div>
          </div>
          <span
            className={`material-symbols-outlined check-icon ${
              selectedLang === 'en'
                ? 'text-on-secondary-container opacity-100'
                : 'text-secondary opacity-0'
            }`}
            style={selectedLang === 'en' ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            check_circle
          </span>
        </div>

        {/* Hindi Option */}
        <div
          className={`language-card flex items-center justify-between p-space-md rounded-xl shadow-sm cursor-pointer transition-all border-2 ${
            selectedLang === 'hi'
              ? 'bg-secondary-container text-on-secondary-container shadow-md border-secondary'
              : 'bg-surface-container-low border-transparent hover:border-secondary'
          }`}
          onClick={() => setSelectedLang('hi')}
        >
          <div className="flex items-center gap-space-md">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                selectedLang === 'hi'
                  ? 'bg-secondary text-on-secondary'
                  : 'bg-surface-container-highest text-primary'
              }`}
            >
              हि
            </div>
            <div>
              <h4 className="text-label-lg font-label-lg text-on-surface">{t('hi', 'onboarding.hi.label')}</h4>
              <p className="text-body-sm text-on-surface-variant">{t('hi', 'onboarding.hi.description')}</p>
            </div>
          </div>
          <span
            className={`material-symbols-outlined check-icon ${
              selectedLang === 'hi'
                ? 'text-on-secondary-container opacity-100'
                : 'text-secondary opacity-0'
            }`}
            style={selectedLang === 'hi' ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            check_circle
          </span>
        </div>

        {/* Marathi Option (Pre-selected) */}
        <div
          className={`language-card flex items-center justify-between p-space-md rounded-xl shadow-md cursor-pointer transition-all border-2 ${
            selectedLang === 'mr'
              ? 'bg-secondary-container text-on-secondary-container border-secondary'
              : 'bg-surface-container-low border-transparent hover:border-secondary'
          }`}
          onClick={() => setSelectedLang('mr')}
        >
          <div className="flex items-center gap-space-md">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                selectedLang === 'mr'
                  ? 'bg-secondary text-on-secondary'
                  : 'bg-surface-container-highest text-primary'
              }`}
            >
              म
            </div>
            <div>
              <h4 className="text-label-lg font-label-lg">{t('mr', 'onboarding.mr.label')}</h4>
              <p className="text-body-sm opacity-80">{t('mr', 'onboarding.mr.description')}</p>
            </div>
          </div>
          <span
            className={`material-symbols-outlined check-icon ${
              selectedLang === 'mr'
                ? 'text-on-secondary-container opacity-100'
                : 'text-secondary opacity-0'
            }`}
            style={selectedLang === 'mr' ? { fontVariationSettings: "'FILL' 1" } : {}}
          >
            check_circle
          </span>
        </div>
      </div>

      {/* Bottom CTA Action Area */}
      <div className="flex flex-col gap-space-sm px-gutter">
        <button
          className="w-full py-4 rounded-xl bg-secondary text-on-secondary font-headline-md text-headline-md shadow-lg flex items-center justify-center gap-space-sm active:scale-95 transition-transform"
          onClick={handleGetStarted}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>{ts('onboarding.loading')}</span>
            </>
          ) : (
            <>
              <span>{ts('onboarding.getStarted')}</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </>
          )}
        </button>
        {saveError && (
          <p className="text-body-sm text-center text-error" role="alert">{saveError}</p>
        )}
        <p className="text-body-sm text-center text-on-surface-variant mt-2">
          {ts('onboarding.consent')}
        </p>
      </div>
    </div>
  );
}
