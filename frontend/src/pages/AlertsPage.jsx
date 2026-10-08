import React from 'react';

export default function AlertsPage() {
  const alerts = [
    { title: 'Tomato Price Surge', mandi: 'Pune APMC', text: 'Modal prices jumped by ₹140/qtl due to weekend demand spikes.', time: '20 mins ago', type: 'positive' },
    { title: 'Heavy Rainfall Warning', mandi: 'Nashik Route', text: 'Monsoon showers may delay transport on NH-60 tomorrow morning.', time: '2 hours ago', type: 'warning' },
    { title: 'Glut Arrival Risk', mandi: 'Ahmednagar', text: 'Surplus tomato arrivals registered (+22%), prices may soften.', time: '5 hours ago', type: 'caution' },
  ];

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary uppercase">Market Risk Alerts</h2>
          <p className="text-body-sm text-on-surface-variant">Real-time alerts for your crops and mandis</p>
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
                {alert.title}
              </span>
              <span className="text-xs text-on-surface-variant">{alert.time}</span>
            </div>
            <p className="text-body-md text-on-surface">{alert.text}</p>
            <div className="flex justify-between items-center text-xs text-on-surface-variant pt-1 border-t border-surface-container">
              <span>Mandi: {alert.mandi}</span>
              <span className="text-secondary font-medium">Auto-monitored</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
