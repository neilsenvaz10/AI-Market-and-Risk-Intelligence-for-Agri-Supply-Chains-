import { useCallback, useEffect, useState } from 'react';

const DISMISS_KEY = 'fasalytics.pwa.installDismissed';

const safeStorage = {
  get: () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } },
  set: () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable */ } },
};

export const isStandalone = () =>
  typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

/** iOS Safari never fires beforeinstallprompt: show "Add to Home Screen" guidance instead. */
export const isIosSafari = (ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) =>
  /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

/**
 * Install support. `canInstall` is true only when the browser offered an install prompt;
 * `showIosHint` when running in iOS Safari outside the installed app. The "not now" choice
 * is remembered (a harmless flag, no personal data).
 */
export default function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(safeStorage.get);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setPromptEvent(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return 'unavailable';
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    setPromptEvent(null);
    return outcome; // 'accepted' | 'dismissed'
  }, [promptEvent]);

  const dismiss = useCallback(() => {
    safeStorage.set();
    setDismissed(true);
  }, []);

  return {
    canInstall: Boolean(promptEvent) && !installed && !dismissed,
    showIosHint: !installed && !dismissed && isIosSafari(),
    installed,
    install,
    dismiss,
  };
}
