import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_RECORD_MS, createLevelMonitor, createSilenceDetector, detectRecordingSupport, pickRecorderMime, recordingErrorKey,
} from '../utils/speech';

/**
 * Push-to-talk recorder.
 *   start()    asks for the microphone (permission prompt) and starts recording
 *   stop()     ends the recording and hands the audio to onAudio(blob)
 *   cancel()   ends the recording and throws the audio away
 *
 * With `autoStop` the recording ends by itself when the farmer stops talking (voice activity
 * detection on the microphone level). A recording in which nobody spoke - or that captured
 * nothing at all - is dropped and `onNoSpeech()` is called instead of sending silence for
 * transcription. If the browser's recorder fails, `onError(key)` is called. Without Web Audio the
 * recorder simply waits for stop() (or the maximum duration).
 * The microphone is always released and nothing is kept after the callbacks.
 */
// A microphone that is clearly alive (peak above this) but never crossed the speech threshold is a
// quiet microphone, not silence: that audio is still sent for transcription instead of being dropped.
const QUIET_MIC_PEAK = 0.006;
const LOUD_NOISE_PEAK = 0.03;
// This many consecutive exact-zero level readings mean the browser is not feeding the level meter
// (for example a suspended AudioContext), so automatic stopping cannot be trusted.
const DEAD_METER_SAMPLES = 15;

export default function useVoiceRecorder({ onAudio, onNoSpeech, onError, autoStop = false, detector: detectorOptions, monitorFactory = createLevelMonitor } = {}) {
  const [support] = useState(() => detectRecordingSupport());
  const [recording, setRecording] = useState(false);
  const [heardSpeech, setHeardSpeech] = useState(false);
  const [error, setError] = useState(null); // i18n key suffix
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const monitorRef = useRef(null);
  const startingRef = useRef(false);
  const discardRef = useRef(false);
  const noSpeechRef = useRef(false);
  const levelRef = useRef({ peak: 0, zeros: 0, samples: 0 });
  const onAudioRef = useRef(onAudio);
  const onNoSpeechRef = useRef(onNoSpeech);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onAudioRef.current = onAudio;
    onNoSpeechRef.current = onNoSpeech;
    onErrorRef.current = onError;
  }, [onAudio, onNoSpeech, onError]);

  const release = useCallback(() => {
    clearTimeout(timerRef.current);
    monitorRef.current?.stop();
    monitorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setHeardSpeech(false);
  }, []);

  const finish = useCallback(({ discard = false, noSpeech = false } = {}) => {
    discardRef.current = discard;
    noSpeechRef.current = noSpeech;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const stop = useCallback(() => finish(), [finish]);
  const cancel = useCallback(() => finish({ discard: true }), [finish]);

  const open = useCallback(async () => {
    setError(null);
    discardRef.current = false;
    noSpeechRef.current = false;
    levelRef.current = { peak: 0, zeros: 0, samples: 0 };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (err) {
      setError(recordingErrorKey(err));
      return false;
    }
    try {
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.ondataavailable = (event) => event.data?.size && chunks.push(event.data);
      recorder.onerror = () => {
        setError('generic');
        release();
        onErrorRef.current?.('generic');
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        const discard = discardRef.current;
        const noSpeech = noSpeechRef.current;
        release();
        if (noSpeech) {
          setError('noSpeech');
          onNoSpeechRef.current?.();
        } else if (discard) {
          // cancelled on purpose: the caller already knows
        } else if (blob.size > 0) {
          onAudioRef.current?.(blob);
        } else {
          // A recording that captured nothing (stopped almost at once, or the stream ended) counts as silence.
          setError('noSpeech');
          onNoSpeechRef.current?.();
        }
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      timerRef.current = setTimeout(stop, MAX_RECORD_MS);

      if (autoStop) {
        const detector = createSilenceDetector(detectorOptions);
        monitorRef.current = monitorFactory(stream, {
          onSample: (rms) => {
            const level = levelRef.current;
            level.samples += 1;
            level.peak = Math.max(level.peak, rms);
            level.zeros = rms === 0 ? level.zeros + 1 : 0;
            if (level.zeros >= DEAD_METER_SAMPLES && level.peak === 0) {
              // The level meter never produced a signal: fall back to "tap to stop" rather than judging silence.
              monitorRef.current?.stop();
              monitorRef.current = null;
              return;
            }
            const verdict = detector.push(rms, Date.now());
            if (detector.heardSpeech) setHeardSpeech(true);
            if (verdict === 'speech-ended' || verdict === 'max-duration') finish();
            else if (verdict === 'no-speech') {
              const quietMic = level.peak > QUIET_MIC_PEAK && level.peak < LOUD_NOISE_PEAK;
              finish(quietMic ? {} : { discard: true, noSpeech: true });
            }
          },
        });
      }
      return true;
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setError('generic');
      return false;
    }
  }, [release, stop, finish, autoStop, detectorOptions, monitorFactory]);

  const start = useCallback(async () => {
    if (!support.supported) {
      setError(support.reason);
      return false;
    }
    // Never two recordings at once - including a second tap while the permission prompt is open,
    // which would otherwise leave the first microphone stream running with nothing to stop it.
    if (recorderRef.current || startingRef.current) return false;
    startingRef.current = true;
    try {
      return await open();
    } finally {
      startingRef.current = false;
    }
  }, [support, open]);

  // Release the microphone if the component unmounts mid-recording.
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    release();
  }, [release]);

  return {
    supported: support.supported, reason: support.reason, recording, heardSpeech, error, start, stop, cancel, clearError: () => setError(null),
  };
}
