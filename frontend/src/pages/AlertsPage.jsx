import React from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function AlertsPage() {
  const { language } = useAuth();

  // Alert data — titles and body text use translation keys; mandi names are proper nouns
  const alerts = [
    {
      title: 'Tomato Price Surge',
      titleHi: 'टमाटर के भाव में उछाल',
      titleMr: 'टोमॅटोच्या भावात वाढ',
      mandi: 'Pune APMC',
      text: 'Modal prices jumped by ₹140/qtl due to weekend demand spikes.',
      textHi: 'सप्ताहांत की मांग बढ़ने के कारण मोडल भाव ₹140/क्विंटल बढ़ गया।',
      textMr: 'आठवड्याच्या शेवटी मागणी वाढल्याने मोडल भाव ₹140/क्विंटलने वाढला.',
      time: '20 mins ago',
      timeHi: '20 मिनट पहले',
      timeMr: '20 मिनिटांपूर्वी',
      type: 'positive',
    },
    {
      title: 'Heavy Rainfall Warning',
      titleHi: 'भारी बारिश की चेतावनी',
      titleMr: 'मुसळधार पावसाचा इशारा',
      mandi: 'Nashik Route',
      text: 'Monsoon showers may delay transport on NH-60 tomorrow morning.',
      textHi: 'मानसून की बारिश से कल सुबह NH-60 पर परिवहन में देरी हो सकती है।',
      textMr: 'मान्सून पावसामुळे उद्या सकाळी NH-60 वर वाहतुकीला विलंब होऊ शकतो.',
      time: '2 hours ago',
      timeHi: '2 घंटे पहले',
      timeMr: '2 तासांपूर्वी',
      type: 'warning',
    },
    {
      title: 'Glut Arrival Risk',
      titleHi: 'अधिक आवक का जोखिम',
      titleMr: 'जास्त आवक धोका',
      mandi: 'Ahmednagar',
      text: 'Surplus tomato arrivals registered (+22%), prices may soften.',
      textHi: 'टमाटर की अधिक आवक दर्ज (+22%), भाव में नरमी आ सकती है।',
      textMr: 'टोमॅटोची जास्त आवक नोंदली (+22%), भाव कमी होऊ शकतात.',
      time: '5 hours ago',
      timeHi: '5 घंटे पहले',
      timeMr: '5 तासांपूर्वी',
      type: 'caution',
    },
  ];

  const getLocalised = (item, field) => {
    if (language === 'hi' && item[`${field}Hi`]) return item[`${field}Hi`];
    if (language === 'mr' && item[`${field}Mr`]) return item[`${field}Mr`];
    return item[field];
  };

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">
            {t(language, 'alerts.title')}
          </h2>
          <p className="text-body-sm text-on-surface-variant">
            {t(language, 'alerts.subtitle')}
          </p>
        </div>
        <span className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-xs">
          3
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {alerts.map((alert, idx) => (
          <div key={idx} className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface text-body-lg flex items-center gap-1.5">
                <span className={`material-symbols-outlined text-[18px] ${alert.type === 'positive' ? 'text-secondary' : alert.type === 'warning' ? 'text-amber-600' : 'text-error'}`}>
                  {alert.type === 'positive' ? 'trending_up' : alert.type === 'warning' ? 'rainy' : 'warning'}
                </span>
                {getLocalised(alert, 'title')}
              </span>
              <span className="text-xs text-on-surface-variant">{getLocalised(alert, 'time')}</span>
            </div>
            <p className="text-body-md text-on-surface">{getLocalised(alert, 'text')}</p>
            <div className="flex justify-between items-center text-xs text-on-surface-variant pt-1 border-t border-surface-container">
              <span>{t(language, 'alerts.mandiLabel')}: {alert.mandi}</span>
              <span className="text-secondary font-medium">{t(language, 'alerts.autoMonitored')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
