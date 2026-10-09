import React, { useState } from 'react';
import RiskBadge from './RiskBadge';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function RiskCard({
  titleKey,
  icon,
  factor = {},
  metrics = [],
}) {
  const { language } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const { level = 'UNKNOWN', explanation, evidence = {} } = factor;

  return (
    <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-sm flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="material-symbols-outlined text-primary text-[20px]">
              {icon}
            </span>
          )}
          <h4 className="font-bold text-on-surface text-body-md">
            {t(language, titleKey)}
          </h4>
        </div>
        <RiskBadge level={level} size="sm" />
      </div>

      <p className="text-xs text-on-surface-variant leading-relaxed">
        {explanation || 'Assessment in progress.'}
      </p>

      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-outline-variant/20">
          {metrics.map((m, idx) => (
            <div key={idx} className="bg-surface-container-low p-2 rounded-lg">
              <span className="text-[10px] text-on-surface-variant block uppercase font-medium">
                {m.label}
              </span>
              <span className="text-xs font-bold text-on-surface block mt-0.5">
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {evidence && Object.keys(evidence).length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] font-bold text-primary flex items-center gap-1 hover:underline focus:outline-none"
          >
            <span>{t(language, 'risk.evidence')}</span>
            <span className="material-symbols-outlined text-[14px]">
              {expanded ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          {expanded && (
            <div className="mt-2 p-2.5 bg-surface-container-low rounded-lg text-[11px] text-on-surface-variant font-mono space-y-1 overflow-x-auto">
              {Object.entries(evidence).map(([k, v]) => {
                if (typeof v === 'object' && v !== null) return null;
                return (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-on-surface-variant/80">{k}:</span>
                    <span className="font-semibold text-on-surface">{String(v)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
