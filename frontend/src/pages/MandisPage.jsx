import React from 'react';
import { Link } from 'react-router-dom';

export default function MandisPage() {
  const mandis = [
    { name: 'Pune APMC (Gultekdi)', distance: '12 km', price: '₹2,050 / qtl', trend: '+4.2%', volume: 'High' },
    { name: 'Ahmednagar Mandi', distance: '45 km', price: '₹1,920 / qtl', trend: '-1.5%', volume: 'Medium' },
    { name: 'Nashik Market Yard', distance: '88 km', price: '₹2,110 / qtl', trend: '+6.1%', volume: 'Very High' },
    { name: 'Baramati APMC', distance: '72 km', price: '₹1,880 / qtl', trend: '+0.5%', volume: 'Moderate' },
  ];

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">Mandi Intelligence</h2>
          <p className="text-body-sm text-on-surface-variant">Live Mandi prices & proximity comparator</p>
        </div>
        <span className="px-3 py-1 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-full">
          4 Nearby
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
                <span className="text-body-sm text-on-surface-variant">Modal Price</span>
                <div className="font-headline-md text-headline-md text-primary">{mandi.price}</div>
              </div>
              <div className="text-right">
                <span className="text-body-sm text-on-surface-variant">Distance: {mandi.distance}</span>
                <span className="block text-xs font-medium text-secondary">Arrival: {mandi.volume}</span>
              </div>
            </div>
            <Link
              to="/recommendation"
              className="mt-2 w-full py-2 bg-surface-container-low hover:bg-surface-container text-primary text-center font-bold text-body-sm rounded-lg transition-colors flex items-center justify-center gap-1"
            >
              <span>View Route & Profit Forecast</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
