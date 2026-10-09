import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { synthesizeSpeech } from '../services/assistantApi';
import { t } from '../i18n/strings';
import { serviceErrorKey, toSpokenText } from '../utils/speech';

const audioCache = new Map(); // in-memory only: cleared on reload, never written to storage

function toObjectUrl(base64, mimeType) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/** "Listen" button: Sarvam AI text-to-speech in the active language. */
export default function SpeakButton({ text, language = 'en', disabled = false, className = '', getToken }) {
  const { user } = useAuth();
  const tokenOf = getToken || (() => user.getIdToken()); // override to reuse outside the Ask AI page
  const [state, setState] = useState('idle'); // idle | loading | playing
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setState('idle');
  };
  useEffect(() => () => audioRef.current?.pause(), []);

  const play = async () => {
    const spoken = toSpokenText(text);
    if (!spoken) return;
    setError(null);
    setState('loading');
    try {
      const key = `${language}:${spoken}`;
      let url = audioCache.get(key);
      if (!url) {
        const { audioBase64, mimeType } = await synthesizeSpeech(spoken, language, await tokenOf());
        url = toObjectUrl(audioBase64, mimeType || 'audio/wav');
        audioCache.set(key, url);
      }
      const audio = new Audio(url);
      audio.onended = () => setState('idle');
      audio.onerror = () => {
        setError('generic');
        setState('idle');
      };
      audioRef.current = audio;
      await audio.play();
      setState('playing');
    } catch (err) {
      setError(err?.name === 'NotAllowedError' ? 'generic' : serviceErrorKey(err));
      setState('idle');
    }
  };

  const label = state === 'playing' ? t(language, 'voice.stopSpeaking') : state === 'loading' ? t(language, 'voice.loadingAudio') : t(language, 'voice.speak');
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={state === 'playing'}
        title={label}
        disabled={disabled || state === 'loading'}
        onClick={() => (state === 'playing' ? stop() : play())}
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
