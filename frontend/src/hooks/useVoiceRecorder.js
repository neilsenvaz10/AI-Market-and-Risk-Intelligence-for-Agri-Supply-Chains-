import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_RECORD_MS, detectRecordingSupport, pickRecorderMime, recordingErrorKey } from '../utils/speech';

/**
 * Push-to-talk recorder. `start()` asks for the microphone (permission prompt), `stop()` ends
 * the recording and calls `onAudio(blob)`. Recording stops by itself after MAX_RECORD_MS.
 * Nothing is kept after `onAudio`: tracks are released and chunks dropped.
 */
export default function useVoiceRecorder({ onAudio } = {}) {
  const [support] = useState(() => detectRecordingSupport());
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null); // i18n key suffix
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const onAudioRef = useRef(onAudio);
  useEffect(() => { onAudioRef.current = onAudio; }, [onAudio]);

  const release = useCallback(() => {
    clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!support.supported) {
      setError(support.reason);
      return;
    }
    if (recorderRef.current) return;
    setError(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      setError(recordingErrorKey(err));
      return;
    }
    try {
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.ondataavailable = (event) => event.data?.size && chunks.push(event.data);
      recorder.onerror = () => {
        setError('generic');
        release();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        release();
        if (blob.size > 0) onAudioRef.current?.(blob);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      timerRef.current = setTimeout(stop, MAX_RECORD_MS);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setError('generic');
    }
  }, [support, release, stop]);

  // Release the microphone if the component unmounts mid-recording.
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    release();
  }, [release]);

  return { supported: support.supported, reason: support.reason, recording, error, start, stop, clearError: () => setError(null) };
}
