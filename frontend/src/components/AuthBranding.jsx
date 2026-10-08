/**
 * FASALYTICS brand block for auth screens — same markup as the Stitch
 * Splash / Onboarding header (eco badge, Barlow headline, bilingual tagline).
 */
export default function AuthBranding({ icon = 'eco', title, subtitle }) {
  return (
    <div className="flex flex-col items-center text-center px-gutter pt-space-lg">
      <div className="w-20 h-20 rounded-full bg-secondary-container flex items-center justify-center shadow-md mb-space-md relative overflow-hidden">
        <span
          className="material-symbols-outlined text-on-secondary-container text-[40px]"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
        <div className="absolute inset-0 bg-gradient-to-tr from-secondary/20 to-transparent"></div>
      </div>
      <span className="text-headline-xl font-headline-xl tracking-tight text-on-surface uppercase mb-space-xs">
        Fasalytics
      </span>
      {title && <h1 className="text-headline-md font-headline-md text-on-surface">{title}</h1>}
      {subtitle && <p className="text-body-md font-body-md text-on-surface-variant max-w-xs mt-1">{subtitle}</p>}
    </div>
  );
}

export function AuthAlert({ children, tone = 'error' }) {
  const styles =
    tone === 'error'
      ? 'bg-error-container text-on-error-container'
      : 'bg-amber-100 text-amber-800';
  return (
    <div className={`${styles} p-3 rounded-xl flex items-start gap-3 shadow-sm`} role="alert">
      <span className={`material-symbols-outlined text-[22px] ${tone === 'error' ? 'text-error' : 'text-amber-600'}`}>
        {tone === 'error' ? 'warning' : 'info'}
      </span>
      <p className="font-body-sm text-xs flex-1 pt-0.5">{children}</p>
    </div>
  );
}

export function EmulatorBadge() {
  return (
    <span className="self-center inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-amber-100 text-amber-800">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
      DEV · FIREBASE AUTH EMULATOR (TEST ONLY)
    </span>
  );
}
