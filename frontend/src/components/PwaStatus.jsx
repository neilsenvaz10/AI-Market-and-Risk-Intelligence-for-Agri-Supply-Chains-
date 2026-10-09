import { useEffect, useRef, useState } from 'react';
import useOnlineStatus from '../hooks/useOnlineStatus';
import usePwaInstall from '../hooks/usePwaInstall';
import { SW_UPDATE_EVENT, applyServiceWorkerUpdate } from '../pwa/registerServiceWorker';
import { t } from '../i18n/strings';

/**
 * Connection, install and update notices (Stitch colours). Offline, the banner says plainly
 * that market prices and forecasts are not shown, because the app never serves saved prices
 * as if they were current.
 */
export default function PwaStatus({ language = 'en' }) {
  const online = useOnlineStatus();
  const { canInstall, showIosHint, install, dismiss } = usePwaInstall();
  const [registration, setRegistration] = useState(null);
  const [backOnline, setBackOnline] = useState(false);
  const sawOffline = useRef(false);

  useEffect(() => {
    const onUpdate = (event) => setRegistration(event.detail);
    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
  }, []);

  // "Back online" is announced from the connectivity events themselves, not derived in an effect.
  useEffect(() => {
    let timer;
    if (!navigator.onLine) sawOffline.current = true;
    const onOffline = () => {
      sawOffline.current = true;
      setBackOnline(false);
    };
    const onOnline = () => {
      if (!sawOffline.current) return;
      setBackOnline(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBackOnline(false), 4000);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const bar = 'w-full rounded-xl px-4 py-3 mb-3 text-body-sm flex items-center justify-between gap-3';
  const button = 'shrink-0 rounded-lg px-3 py-1.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

  return (
    <div className="w-full">
      <div role="status" aria-live="polite">
        {!online && (
          <div className={`${bar} bg-amber-100 text-amber-900`}>
            <span><strong>{t(language, 'pwa.offlineTitle')}</strong> {t(language, 'pwa.offlineBody')}</span>
          </div>
        )}
        {online && backOnline && (
          <div className={`${bar} bg-secondary-container text-on-secondary-container`}>{t(language, 'pwa.backOnline')}</div>
        )}
      </div>
      {registration && (
        <div className={`${bar} bg-surface-container-high text-on-surface`}>
          <span>{t(language, 'pwa.updateAvailable')}</span>
          <button type="button" className={`${button} bg-primary text-on-primary`} onClick={() => applyServiceWorkerUpdate(registration)}>
            {t(language, 'pwa.refresh')}
          </button>
        </div>
      )}
      {(canInstall || showIosHint) && (
        <div className={`${bar} bg-surface-container-high text-on-surface`}>
          <span>{canInstall ? t(language, 'pwa.installPrompt') : t(language, 'pwa.iosHint')}</span>
          <span className="flex gap-2">
            {canInstall && (
              <button type="button" className={`${button} bg-primary text-on-primary`} onClick={install}>{t(language, 'pwa.install')}</button>
            )}
            <button type="button" className={`${button} bg-surface-container-lowest text-on-surface`} onClick={dismiss}>{t(language, 'pwa.notNow')}</button>
          </span>
        </div>
      )}
    </div>
  );
}
