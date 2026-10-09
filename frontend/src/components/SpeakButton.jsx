import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';
import { serviceErrorKey } from '../utils/speech';
import { speakText } from '../voice/speak';

/**
 * "Listen" button: Sarvam AI text-to-speech in the active language, through the shared audio
 * player (so it can never overlap a conversation reply). `getToken` can be injected to reuse
 * the button outside the Ask AI page.
 */
export default function SpeakButton({ text, language = 'en', disabled = false, className = '', getToken }) {
  const { user } = useAuth();
  const tokenRef = useRef(null);
  useEffect(() => { tokenRef.current = getToken || (() => user.getIdToken()); }, [getToken, user]);
  const [state, setState] = useState('idle'); // idle | loading | playing
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.stop();
    };
  }, []);

  const stop = () => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    setState('idle');
  };

  const play = async () => {
    setError(null);
    setState('loading');
    const controller = speakText({ text, language, getToken: () => tokenRef.current() });
    controllerRef.current = controller;
    // The first audio is ready (or failing) quickly; "playing" starts once synthesis has had a moment.
    const playingTimer = setTimeout(() => mounted.current && controllerRef.current === controller && setState('playing'), 250);
    try {
      await controller.done;
    } catch (err) {
      if (mounted.current && controllerRef.current === controller) setError(err?.name === 'NotAllowedError' ? 'generic' : serviceErrorKey(err));
    } finally {
      clearTimeout(playingTimer);
      if (mounted.current && controllerRef.current === controller) {
        controllerRef.current = null;
        setState('idle');
      }
    }
  };

  const label = state === 'playing' ? t(language, 'voice.stopSpeaking') : state === 'loading' ? t(language, 'voice.loadingAudio') : t(language, 'voice.speak');
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => (state === 'idle' ? play() : stop())}
        className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-container-high text-on-surface-variant active:scale-95 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          {state === 'playing' ? 'stop_circle' : state === 'loading' ? 'hourglass_top' : 'volume_up'}
        </span>
      </button>
      <span role="status" aria-live="polite" className={error ? 'text-body-sm text-on-surface-variant' : 'sr-only'}>
        {error ? t(language, `voice.error.${error}`) : ''}
      </span>
    </span>
  );
}
