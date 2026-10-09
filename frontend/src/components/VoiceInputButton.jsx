import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import useVoiceRecorder from '../hooks/useVoiceRecorder';
import { transcribeAudio } from '../services/assistantApi';
import { t } from '../i18n/strings';
import { serviceErrorKey } from '../utils/speech';

/**
 * Microphone button (Stitch mic styling). Tap to record, tap again to stop; the recording is
 * transcribed by Sarvam AI through the backend and the text is passed to `onTranscript`.
 * Unsupported browsers or an unconfigured service keep a visible, disabled button with an
 * explanation instead of failing silently.
 */
export default function VoiceInputButton({ language = 'en', onTranscript, disabled = false, className = '', getToken }) {
  const { user } = useAuth();
  // `getToken` can be injected to reuse this button outside the Ask AI page.
  const tokenOfRef = useRef(null);
  useEffect(() => { tokenOfRef.current = getToken || (() => user.getIdToken()); }, [getToken, user]);
  const [busy, setBusy] = useState(false);
  const [serviceError, setServiceError] = useState(null);

  const handleAudio = useCallback(async (blob) => {
    setBusy(true);
    setServiceError(null);
    try {
      const { transcript } = await transcribeAudio(blob, language, await tokenOfRef.current());
      if (transcript) onTranscript?.(transcript);
    } catch (err) {
      setServiceError(serviceErrorKey(err));
    } finally {
      setBusy(false);
    }
  }, [language, onTranscript]);

  const { supported, reason, recording, error, start, stop, clearError } = useVoiceRecorder({ onAudio: handleAudio });

  const problem = !supported ? (reason === 'insecure' ? 'insecure' : 'unsupported') : error || serviceError;
  const message = problem
    ? t(language, `voice.error.${problem}`)
    : recording ? t(language, 'voice.listening') : busy ? t(language, 'voice.transcribing') : '';
  const label = recording ? t(language, 'voice.stop') : t(language, 'voice.start');
  const unavailable = disabled || !supported;

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={recording}
        title={unavailable && message ? message : label}
        disabled={unavailable || busy}
        onClick={() => {
          if (recording) stop();
          else {
            clearError();
            setServiceError(null);
            start();
          }
        }}
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 disabled:cursor-not-allowed ${
          recording ? 'bg-primary text-on-primary animate-pulse' : 'bg-secondary-container text-on-secondary-container'
        }`}
      >
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>
          {busy ? 'hourglass_top' : unavailable ? 'mic_off' : 'mic'}
        </span>
      </button>
      <span
        role="status"
        aria-live="polite"
        className={message ? 'absolute bottom-full left-0 mb-2 w-max max-w-[16rem] rounded-lg bg-surface-container-high px-2 py-1 text-body-sm text-on-surface shadow' : 'sr-only'}
      >
        {message}
      </span>
    </span>
  );
}
