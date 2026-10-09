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

/** Plain text suitable for speaking: no markup or URLs, bounded length. (The server normalises prices and dates.) */
export function toSpokenText(text) {
  const plain = String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[*_`#>•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > MAX_SPOKEN_CHARS ? `${plain.slice(0, MAX_SPOKEN_CHARS - 1)}…` : plain;
}

/**
 * Splits a reply into chunks of whole sentences so the first chunk can start playing while the
 * rest is still being synthesised (a long answer would otherwise stay silent for several seconds).
 */
export function splitSpeechChunks(text, maxChars = 240) {
  // A sentence ends at . ! ? । ॥ followed by white space (so "3.5 percent" stays in one piece), or at a line break.
  const sentences = (String(text ?? '').match(/[\s\S]*?(?:[.!?।॥]+(?=\s|$)|\n|$)/g) || []).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  // A single very long sentence is cut at a space rather than mid-word.
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars * 1.5) return [chunk];
    const parts = [];
    let rest = chunk;
    while (rest.length > maxChars * 1.5) {
      const cut = rest.lastIndexOf(' ', maxChars);
      const at = cut > 40 ? cut : maxChars;
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    return [...parts, rest];
  });
}

// ---------------------------------------------------------------------------------------------
// Voice activity detection: ends a recording when the farmer stops talking, so a conversation
// does not need a second tap, and drops recordings in which nobody spoke.
// ---------------------------------------------------------------------------------------------

export const VAD_DEFAULTS = {
  sampleMs: 80, // how often the microphone level is sampled
  calibrateMs: 320, // the quietest part of this window sets the background-noise floor
  minThreshold: 0.01,  // RMS (0..1) below which sound is never treated as speech
  maxThreshold: 0.06,
  startThreshold: 0.03, // used until the noise floor is known
  thresholdFactor: 3, // speech must be this many times louder than the background
  speechMinMs: 200, // how much voiced sound counts as "the farmer started speaking"
  silenceMs: 1300, // silence after speech that ends the turn
  noSpeechMs: 8000, // give up if nobody speaks for this long
  maxMs: MAX_RECORD_MS,
};

/**
 * Feed it microphone levels; it says when to stop.
 * @returns {{ push(rms: number, now: number): null | 'speech-ended' | 'no-speech' | 'max-duration', readonly heardSpeech: boolean, readonly threshold: number }}
 */
export function createSilenceDetector(options = {}) {
  const o = { ...VAD_DEFAULTS, ...options };
  let startedAt = null;
  let threshold = o.startThreshold;
  let calibrated = false;
  const calibration = []; // levels heard while the background-noise floor is being measured
  let voicedMs = 0;
  let lastVoiceAt = null;
  let heardSpeech = false;

  // Voiced sound builds up "speech" time and silence drains it, so a few isolated clicks or
  // coughs never add up to speech, while syllables with tiny gaps between them do.
  const consider = (rms, now) => {
    if (rms > threshold) {
      voicedMs += o.sampleMs;
      lastVoiceAt = now;
      if (voicedMs >= o.speechMinMs) heardSpeech = true;
    } else {
      voicedMs = Math.max(0, voicedMs - o.sampleMs);
    }
  };

  return {
    get heardSpeech() { return heardSpeech; },
    get threshold() { return threshold; },
    push(rms, now) {
      if (startedAt === null) startedAt = now;
      const elapsed = now - startedAt;
      if (elapsed >= o.maxMs) return 'max-duration';

      if (!calibrated) {
        calibration.push({ rms, now });
        if (elapsed < o.calibrateMs) return null;
        // The 20th percentile ignores the first syllables if the farmer starts talking at once.
        const sorted = calibration.map((c) => c.rms).sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
        threshold = Math.min(o.maxThreshold, Math.max(o.minThreshold, floor * o.thresholdFactor));
        calibrated = true;
        // Judge the calibration window with the final threshold, so speech that began at once still counts
        // and steady background noise does not.
        calibration.forEach((c) => consider(c.rms, c.now));
      } else {
        consider(rms, now);
      }

      if (heardSpeech && lastVoiceAt !== null && now - lastVoiceAt >= o.silenceMs) return 'speech-ended';
      if (!heardSpeech && elapsed >= o.noSpeechMs) return 'no-speech';
      return null;
    },
  };
}

/** Root-mean-square level (0..1) of a block of audio samples. */
export function rmsOf(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Samples the microphone level with the Web Audio API. Returns null when the browser has no
 * Web Audio (recording then falls back to manual stop plus the maximum duration).
 */
export function createLevelMonitor(stream, { onSample, sampleMs = VAD_DEFAULTS.sampleMs, AudioContextCtor = typeof window === 'undefined' ? undefined : window.AudioContext || window.webkitAudioContext } = {}) {
  if (!AudioContextCtor || !stream) return null;
  try {
    const context = new AudioContextCtor();
    context.resume?.();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      onSample(rmsOf(buffer));
    }, sampleMs);
    return {
      stop() {
        clearInterval(timer);
        try {
          source.disconnect();
          context.close?.();
        } catch {
          /* already closed */
        }
      },
    };
  } catch {
    return null;
  }
}
