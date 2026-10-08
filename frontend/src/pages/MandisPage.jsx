import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';
import { getLatestMandiPrices } from '../services/api';

const DEFAULT_MANDIS = [
  { name: 'Pune APMC (Gultekdi)', distance: '12 km', price: '₹2,050 / qtl', trend: '+4.2%', volumeKey: 'mandis.volume.high' },
  { name: 'Ahmednagar Mandi', distance: '45 km', price: '₹1,920 / qtl', trend: '-1.5%', volumeKey: 'mandis.volume.medium' },
  { name: 'Nashik Market Yard', distance: '88 km', price: '₹2,110 / qtl', trend: '+6.1%', volumeKey: 'mandis.volume.veryHigh' },
  { name: 'Baramati APMC', distance: '72 km', price: '₹1,880 / qtl', trend: '+0.5%', volumeKey: 'mandis.volume.moderate' },
];

const DISTANCE_LOOKUP = {
  'MH_PUNE_APMC': '12 km',
  'MH_AHM_APMC': '45 km',
  'MH_NSK_MAIN': '88 km',
  'MH_BAR_APMC': '72 km',
  'MH_MUM_VASHI': '145 km',
  'MH_NSK_LASALGAON': '112 km',
};

export default function MandisPage() {
  const { language } = useAuth();
  const [mandis, setMandis] = useState(DEFAULT_MANDIS);
  const [isSampleData, setIsSampleData] = useState(false);
  const [dataSource, setDataSource] = useState('');

  useEffect(() => {
    let isMounted = true;
    getLatestMandiPrices({ commodity: 'ONION' })
      .then((res) => {
        if (!isMounted || !res || !res.data || res.data.length === 0) return;

        const mapped = res.data.map((item) => ({
          name: item.mandi_name,
          distance: DISTANCE_LOOKUP[item.mandi_code] || 'Nearby',
          price: `₹${Number(item.modal_price).toLocaleString('en-IN')} / qtl`,
          trend: `${item.trend_percent >= 0 ? '+' : ''}${item.trend_percent}%`,
          volumeKey:
            Number(item.arrivals_quantity) > 600
              ? 'mandis.volume.veryHigh'
              : Number(item.arrivals_quantity) > 350
              ? 'mandis.volume.high'
              : Number(item.arrivals_quantity) > 200
              ? 'mandis.volume.moderate'
              : 'mandis.volume.medium',
        }));

        setMandis(mapped);
        setIsSampleData(Boolean(res.data[0]?.is_sample_data));
        setDataSource(res.data[0]?.source || 'LIVE');
      })
      .catch(() => {
        // Fall back gracefully to default reference data
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">
            {t(language, 'mandis.title')}
          </h2>
          <div className="flex items-center gap-1.5">
            <p className="text-body-sm text-on-surface-variant">
              {t(language, 'mandis.subtitle')}
            </p>
            {isSampleData && (
              <span
                title={`Data Source: ${dataSource}`}
                className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded"
              >
                Sample Feed
              </span>
            )}
          </div>
        </div>
        <span className="px-3 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-full">
          {mandis.length} {t(language, 'mandis.nearby')}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {mandis.map((mandi, idx) => (
          <div key={idx} className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface text-body-lg">{mandi.name}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${mandi.trend.startsWith('+') ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-error'}`}>
                {mandi.trend}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-body-sm text-on-surface-variant">{t(language, 'mandis.modalPrice')}</span>
                <div className="font-headline-md text-headline-md text-primary">{mandi.price}</div>
              </div>
              <div className="text-right">
                <span className="text-body-sm text-on-surface-variant">
                  {t(language, 'mandis.distance')}: {mandi.distance}
                </span>
                <span className="block text-xs font-medium text-secondary">
                  {t(language, 'mandis.arrival')}: {t(language, mandi.volumeKey)}
                </span>
              </div>
            </div>
            <Link
              to="/recommendation"
              className="mt-2 w-full py-2 bg-surface-container-low hover:bg-surface-container text-primary text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1"
            >
              <span>{t(language, 'mandis.viewRoute')}</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
