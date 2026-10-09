import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useVoiceRecorder from './useVoiceRecorder';
import { transcribeAudio } from '../services/assistantApi';
import { serviceErrorKey } from '../utils/speech';
import { stopAudio, unlockAudio } from '../voice/audioPlayer';
import { speakText } from '../voice/speak';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Voice conversation turn-taking:
 *
 *   idle -> listening -> transcribing -> thinking -> speaking -> (idle | listening again)
 *
 * - listening:    the microphone is recording; it stops by itself when the farmer stops talking.
 * - transcribing: Sarvam speech-to-text (through the backend).
 * - thinking:     `sendUtterance(text)` asks the chatbot; it resolves to the reply text.
 * - speaking:     Sarvam text-to-speech reads the reply aloud.
 * With `handsFree` the microphone re-opens after each spoken reply, so the farmer can keep
 * talking without touching the screen; it switches itself off after repeated silence, on any
 * error, or when the page is hidden.
 *
 * Every asynchronous step re-checks a session number, so cancelling (or starting a new turn,
 * for example to interrupt the spoken reply) can never be undone by a late response.
 */
export default function useVoiceConversation({
  language = 'en',
  getToken,
  sendUtterance,
  handsFree = false,
  onHandsFreeStop,
  resumeDelayMs = 450,
  maxEmptyTurns = 2,
  transcribe = transcribeAudio,
  speak = speakText,
  recorderOptions,
} = {}) {
  const [phase, setPhase] = useState('idle');
  const [ownError, setOwnError] = useState(null);
  const sessionRef = useRef(0);
  const emptyTurnsRef = useRef(0);
  const speechRef = useRef(null);
  const recorderRef = useRef(null);
  const latest = useRef({});
  // Asynchronous steps read the newest options from here (the layout effect runs before any of them can resume).
  useLayoutEffect(() => {
    latest.current = { language, getToken, sendUtterance, handsFree, onHandsFreeStop, resumeDelayMs, maxEmptyTurns, transcribe, speak };
  });

  const stale = useCallback((id) => sessionRef.current !== id, []);
  const stopHandsFree = useCallback(() => latest.current.onHandsFreeStop?.(), []);

  const fail = useCallback((key) => {
    setOwnError(key);
    setPhase('idle');
    if (latest.current.handsFree) stopHandsFree();
  }, [stopHandsFree]);

  /** Opens the microphone (stopping anything being spoken first). Resolves to whether it is recording. */
  const listen = useCallback(async () => {
    speechRef.current?.stop();
    speechRef.current = null;
    stopAudio();
    setOwnError(null);
    const started = await recorderRef.current.start();
    if (started) {
      setPhase('listening');
    } else {
      setPhase('idle');
      if (latest.current.handsFree) stopHandsFree();
    }
    return started;
  }, [stopHandsFree]);

  /** @returns {Promise<string|null>} how the speech ended ('ended' | 'interrupted' | 'empty'), or null if it failed */
  const speakInternal = useCallback(async (text, id) => {
    setPhase('speaking');
    const controller = latest.current.speak({ text, language: latest.current.language, getToken: latest.current.getToken });
    speechRef.current = controller;
    try {
      return await controller.done;
    } catch (err) {
      if (!stale(id)) setOwnError(serviceErrorKey(err)); // a voice problem does not hide the written answer
      return null;
    } finally {
      if (speechRef.current === controller) speechRef.current = null;
    }
  }, [stale]);

  const resumeOrFinish = useCallback(async (id) => {
    if (stale(id)) return;
    if (latest.current.handsFree) {
      await sleep(latest.current.resumeDelayMs);
      if (!stale(id)) await listen();
    } else {
      setPhase('idle');
    }
  }, [stale, listen]);

  const handleNoSpeech = useCallback(async (id) => {
    emptyTurnsRef.current += 1;
    if (latest.current.handsFree && emptyTurnsRef.current < latest.current.maxEmptyTurns) {
      setOwnError(null);
      await resumeOrFinish(id);
      return;
    }
    setPhase('idle');
    if (latest.current.handsFree) {
      setOwnError('noSpeechStop');
      stopHandsFree();
    } else {
      setOwnError('noSpeech');
    }
  }, [resumeOrFinish, stopHandsFree]);

  const handleAudio = useCallback(async (blob) => {
    const id = sessionRef.current;
    setPhase('transcribing');
    let text;
    try {
      const result = await latest.current.transcribe(blob, latest.current.language, await latest.current.getToken());
      text = String(result?.transcript || '').trim();
    } catch (err) {
      if (stale(id)) return;
      // "No speech" from the speech service is an empty turn (it can be retried), not a failure.
      if (err?.code === 'NO_SPEECH_DETECTED') await handleNoSpeech(id);
      else fail(serviceErrorKey(err));
      return;
    }
    if (stale(id)) return;
    if (!text) {
      await handleNoSpeech(id);
      return;
    }
    emptyTurnsRef.current = 0;

    setPhase('thinking');
    let reply = null;
    try {
      reply = await latest.current.sendUtterance(text);
    } catch {
      reply = null;
    }
    if (stale(id)) return;
    if (reply === null || reply === undefined) {
      fail('chatFailed'); // the page shows the chat error itself; here we just stop the loop
      return;
    }
    if (String(reply).trim()) {
      const outcome = await speakInternal(String(reply), id);
      // The reply could not be spoken, or something else took over the speakers (for example a
      // "Listen" button): do not open the microphone again on our own.
      if (!stale(id) && (outcome === null || outcome === 'interrupted')) {
        setPhase('idle');
        if (latest.current.handsFree) stopHandsFree();
        return;
      }
    }
    await resumeOrFinish(id);
  }, [stale, fail, handleNoSpeech, resumeOrFinish, speakInternal, stopHandsFree]);

  const recorder = useVoiceRecorder({
    autoStop: true,
    onAudio: handleAudio,
    onNoSpeech: () => handleNoSpeech(sessionRef.current),
    onError: fail, // the browser's recorder failed: never leave the screen saying "listening"
    ...recorderOptions,
  });
  useLayoutEffect(() => {
    recorderRef.current = recorder;
  });

  /** Start a voice turn. Call it from the tap itself so the browser lets us record and play audio. */
  const start = useCallback(async () => {
    unlockAudio();
    sessionRef.current += 1; // interrupts a reply that is still being spoken (barge-in)
    emptyTurnsRef.current = 0;
    return listen();
  }, [listen]);

  /** End the recording now (the audio is still sent). */
  const stopListening = useCallback(() => recorderRef.current.stop(), []);

  /** Abandon everything in progress: recording, requests, speech. */
  const cancel = useCallback(() => {
    sessionRef.current += 1;
    recorderRef.current.cancel();
    speechRef.current?.stop();
    speechRef.current = null;
    stopAudio();
    setPhase('idle');
  }, []);

  /** Read a (typed-chat) reply aloud. */
  const speakReply = useCallback(async (text) => {
    const id = sessionRef.current + 1;
    sessionRef.current = id;
    setOwnError(null);
    await speakInternal(text, id);
    if (!stale(id)) setPhase('idle');
  }, [speakInternal, stale]);

  // A microphone must never stay open in a hidden tab.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cancel();
        if (latest.current.handsFree) stopHandsFree();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [cancel, stopHandsFree]);

  useEffect(() => () => {
    sessionRef.current += 1;
    speechRef.current?.stop();
    stopAudio();
  }, []);

  return {
    supported: recorder.supported,
    reason: recorder.reason,
    phase,
    heardSpeech: recorder.heardSpeech,
    error: ownError ?? recorder.error,
    clearError: () => { setOwnError(null); recorder.clearError(); },
    start,
    stopListening,
    cancel,
    speakReply,
  };
}
