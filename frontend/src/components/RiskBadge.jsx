import React from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

const BADGE_CONFIG = {
  LOW: {
    key: 'risk.level.low',
    className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
    icon: 'check_circle',
  },
  MODERATE: {
    key: 'risk.level.moderate',
    className: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
    icon: 'warning',
  },
  HIGH: {
    key: 'risk.level.high',
    className: 'bg-error/10 text-error border-error/30',
    icon: 'error',
  },
  UNKNOWN: {
    key: 'risk.level.unknown',
    className: 'bg-surface-container text-on-surface-variant border-outline-variant/30',
    icon: 'help_outline',
  },
};

export default function RiskBadge({ level = 'UNKNOWN', size = 'default', showIcon = true }) {
  const { language } = useAuth();
  const config = BADGE_CONFIG[level] || BADGE_CONFIG.UNKNOWN;
  const isSm = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded-full border ${
        isSm ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
      } ${config.className}`}
    >
      {showIcon && (
        <span className={`material-symbols-outlined ${isSm ? 'text-[12px]' : 'text-[14px]'}`}>
          {config.icon}
        </span>
      )}
      <span>{t(language, config.key)}</span>
    </span>
  );
}
