/**
 * Helpers for the Sarvam-powered voice features. Recording uses the browser's MediaRecorder;
 * speech-to-text and text-to-speech are performed by the backend (Sarvam AI), never from the
 * browser, so the API key never reaches the client. Audio is not stored by the app.
 */

/** App language code -> BCP-47 tag (matches what the backend sends to Sarvam). */
export const SPEECH_LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
export const speechLocale = (language) => SPEECH_LOCALES[language] || SPEECH_LOCALES.en;

/** Sarvam's REST speech-to-text accepts up to 30 s of audio. */
export const MAX_RECORD_MS = 25_000;
export const MAX_SPOKEN_CHARS = 1000;

const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** First recording format this browser can produce (all are accepted by Sarvam), or '' for the default. */
export function pickRecorderMime(Recorder = typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder) {
  if (!Recorder?.isTypeSupported) return '';
  return MIME_PREFERENCE.find((type) => Recorder.isTypeSupported(type)) || '';
}

export function detectRecordingSupport(win = typeof window === 'undefined' ? undefined : window) {
  if (!win) return { supported: false, reason: 'unsupported' };
  const secure = win.isSecureContext || ['localhost', '127.0.0.1', '[::1]'].includes(win.location?.hostname);
  if (!win.navigator?.mediaDevices?.getUserMedia || typeof win.MediaRecorder !== 'function') return { supported: false, reason: 'unsupported' };
  if (!secure) return { supported: false, reason: 'insecure' };
  return { supported: true, reason: null };
}

/** getUserMedia / MediaRecorder error -> i18n key suffix (voice.error.<suffix>). */
export function recordingErrorKey(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'noMic';
    case 'NotReadableError':
      return 'busyMic';
    default:
      return 'generic';
  }
}

/** Backend error code -> i18n key suffix. */
export function serviceErrorKey(error) {
  const code = error?.code || '';
  if (code === 'NO_SPEECH_DETECTED') return 'noSpeech';
  if (code === 'SARVAM_NOT_CONFIGURED') return 'unavailable';
  if (error?.status === 429 || code.endsWith('RATE_LIMITED') || code === 'SARVAM_QUOTA_EXCEEDED') return 'busy';
  if (code === 'NETWORK_ERROR') return 'network';
  return 'generic';
}

/** Plain text suitable for speaking: no markup or URLs, bounded length. */
export function toSpokenText(text) {
  const plain = String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[*_`#>•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > MAX_SPOKEN_CHARS ? `${plain.slice(0, MAX_SPOKEN_CHARS - 1)}…` : plain;
}
