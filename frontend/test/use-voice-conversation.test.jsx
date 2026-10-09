// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import useVoiceConversation from '../src/hooks/useVoiceConversation';
import { SAMPLE_MS, fakeMonitorFactory, installFakeMedia, repeat } from './helpers/fakeMedia';
import { speechStub } from './helpers/fakeSpeech';

// jsdom cannot play audio; the real player is covered in voice-playback.test.js.
vi.mock('../src/voice/audioPlayer', () => ({
  unlockAudio: vi.fn(),
  stopAudio: vi.fn(),
  isAudioPlaying: vi.fn(() => false),
  playAudioUrl: vi.fn(),
  audioUrlFromBase64: vi.fn(),
}));

let media;

beforeEach(() => {
  media = installFakeMedia();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  media.uninstall();
});

const dedupe = (list) => list.filter((value, index) => index === 0 || value !== list[index - 1]);

// Real requests take time; without this, React batches the instant mocks and some phases are never rendered.
const tick = () => new Promise((resolve) => { setTimeout(resolve, 5); });

function setup({ reply = 'Onion is 1400 rupees per quintal.', transcript = 'onion price', ...overrides } = {}) {
  const phases = [];
  const { speak, controllers } = speechStub();
  const sendUtterance = vi.fn(async () => { await tick(); return reply; });
  const transcribe = vi.fn(async () => { await tick(); return { transcript }; });
  const onHandsFreeStop = vi.fn();
  const hook = renderHook(() => {
    const voice = useVoiceConversation({
      language: 'en',
      getToken: async () => 'tok',
      sendUtterance,
      transcribe,
      speak,
      onHandsFreeStop,
      resumeDelayMs: 0,
      recorderOptions: { monitorFactory: () => null },
      ...overrides,
    });
    phases.push(voice.phase);
    return voice;
  });
  return { ...hook, phases, speak, controllers, sendUtterance, transcribe, onHandsFreeStop };
}

const tapMic = (t) => act(async () => { await t.result.current.start(); });
const tapStop = (t) => act(async () => { t.result.current.stopListening(); });

describe('useVoiceConversation', () => {
  it('runs a whole turn: listen -> transcribe -> ask -> speak -> idle', async () => {
    const t = setup({ language: 'hi' });
    await tapMic(t);
    expect(t.result.current.phase).toBe('listening');

    await tapStop(t);
    await waitFor(() => expect(t.speak).toHaveBeenCalledTimes(1));
    expect(t.transcribe).toHaveBeenCalledWith(expect.any(Blob), 'hi', 'tok');
    expect(t.sendUtterance).toHaveBeenCalledWith('onion price');
    expect(t.speak).toHaveBeenCalledWith({ text: 'Onion is 1400 rupees per quintal.', language: 'hi', getToken: expect.any(Function) });
    expect(t.result.current.phase).toBe('speaking');

    await act(async () => { t.controllers[0].finish(); });
    await waitFor(() => expect(t.result.current.phase).toBe('idle'));
    expect(dedupe(t.phases)).toEqual(['idle', 'listening', 'transcribing', 'thinking', 'speaking', 'idle']);
    expect(t.result.current.error).toBeNull();
    expect(media.tracks[0].stop).toHaveBeenCalled();
  });

  it('lets the farmer interrupt a spoken reply by talking (barge-in)', async () => {
    const t = setup();
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.phase).toBe('speaking'));

    await tapMic(t);
    expect(t.controllers[0].stop).toHaveBeenCalled();
    expect(t.result.current.phase).toBe('listening');

    // the old reply finishing late changes nothing
    await act(async () => { await Promise.resolve(); });
    expect(t.result.current.phase).toBe('listening');
    expect(t.sendUtterance).toHaveBeenCalledTimes(1);
  });

  it('cancel() during thinking means a late answer is never spoken', async () => {
    let answer;
    const t = setup();
    t.sendUtterance.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.phase).toBe('thinking'));

    act(() => t.result.current.cancel());
    expect(t.result.current.phase).toBe('idle');
    await act(async () => { answer('Late answer.'); });
    expect(t.speak).not.toHaveBeenCalled();
    expect(t.result.current.phase).toBe('idle');
  });

  it('hands-free: opens the microphone again after each spoken reply', async () => {
    const t = setup({ handsFree: true });
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.speak).toHaveBeenCalledTimes(1));

    await act(async () => { t.controllers[0].finish(); });
    await waitFor(() => expect(t.result.current.phase).toBe('listening'));
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(t.onHandsFreeStop).not.toHaveBeenCalled();

    act(() => t.result.current.cancel());
    expect(t.result.current.phase).toBe('idle');
    expect(media.tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it('hands-free: switches itself off after repeated silence', async () => {
    const t = setup({ handsFree: true, transcript: '' });
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(media.getUserMedia).toHaveBeenCalledTimes(2)); // first silent turn: listen again
    expect(t.onHandsFreeStop).not.toHaveBeenCalled();

    await waitFor(() => expect(t.result.current.phase).toBe('listening'));
    await tapStop(t);
    await waitFor(() => expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1));
    expect(t.result.current.error).toBe('noSpeechStop');
    expect(t.result.current.phase).toBe('idle');
    expect(t.sendUtterance).not.toHaveBeenCalled();
  });

  it('"no speech" from the speech service is an empty turn that hands-free retries, then gives up', async () => {
    const t = setup({ handsFree: true });
    t.transcribe.mockRejectedValue(Object.assign(new Error('No speech was detected'), { code: 'NO_SPEECH_DETECTED', status: 422 }));
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(media.getUserMedia).toHaveBeenCalledTimes(2)); // first empty turn: listen again
    expect(t.onHandsFreeStop).not.toHaveBeenCalled();

    await waitFor(() => expect(t.result.current.phase).toBe('listening'));
    await tapStop(t);
    await waitFor(() => expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1));
    expect(t.result.current.error).toBe('noSpeechStop');
    expect(t.result.current.phase).toBe('idle');
  });

  it('a recorder that fails while listening ends the turn instead of leaving "listening" on screen', async () => {
    const t = setup({ handsFree: true });
    await tapMic(t);
    expect(t.result.current.phase).toBe('listening');

    act(() => media.recorders[0].onerror(new Event('error')));
    expect(t.result.current.phase).toBe('idle');
    expect(t.result.current.error).toBe('generic');
    expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1);
  });

  it('a recording that captured nothing is an empty turn too', async () => {
    media.uninstall();
    media = installFakeMedia({ recordedBytes: 0 });
    const t = setup();
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.error).toBe('noSpeech'));
    expect(t.result.current.phase).toBe('idle');
    expect(t.transcribe).not.toHaveBeenCalled();
  });

  it('a silent turn without hands-free just says nothing was heard', async () => {
    const t = setup({ transcript: '   ' });
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.error).toBe('noSpeech'));
    expect(t.result.current.phase).toBe('idle');
    expect(t.sendUtterance).not.toHaveBeenCalled();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('explains a failed transcription and ends the hands-free loop', async () => {
    const t = setup({ handsFree: true });
    t.transcribe.mockRejectedValue(Object.assign(new Error('x'), { code: 'SARVAM_QUOTA_EXCEEDED' }));
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.error).toBe('busy'));
    expect(t.result.current.phase).toBe('idle');
    expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1);
    expect(t.sendUtterance).not.toHaveBeenCalled();
  });

  it('a chat failure speaks nothing and ends the hands-free loop', async () => {
    const t = setup({ handsFree: true });
    t.sendUtterance.mockResolvedValue(null);
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.error).toBe('chatFailed'));
    expect(t.speak).not.toHaveBeenCalled();
    expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1);
    expect(t.result.current.phase).toBe('idle');
  });

  it('a chat request that throws is treated as a failure, not a crash', async () => {
    const t = setup();
    t.sendUtterance.mockRejectedValue(new Error('network'));
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.error).toBe('chatFailed'));
    expect(t.result.current.phase).toBe('idle');
  });

  it('when the reply cannot be spoken the loop stops and the reason stays visible', async () => {
    const t = setup({ handsFree: true });
    t.speak.mockImplementation(() => ({
      done: Promise.reject(Object.assign(new Error('x'), { code: 'SARVAM_NOT_CONFIGURED' })),
      stop: vi.fn(),
    }));
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1));
    expect(t.result.current.error).toBe('unavailable');
    expect(t.result.current.phase).toBe('idle');
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('if something else takes over the speakers (a Listen button) the microphone stays closed', async () => {
    const t = setup({ handsFree: true });
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.speak).toHaveBeenCalledTimes(1));

    await act(async () => { t.controllers[0].finish('interrupted'); });
    await waitFor(() => expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1));
    expect(t.result.current.phase).toBe('idle');
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('an empty reply is simply not spoken', async () => {
    const t = setup({ reply: '   ' });
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.sendUtterance).toHaveBeenCalled());
    await waitFor(() => expect(t.result.current.phase).toBe('idle'));
    expect(t.speak).not.toHaveBeenCalled();
  });

  it('closes the microphone and ends hands-free when the tab is hidden', async () => {
    const t = setup({ handsFree: true });
    await tapMic(t);
    expect(t.result.current.phase).toBe('listening');

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    } finally {
      delete document.hidden;
    }
    expect(t.result.current.phase).toBe('idle');
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1);
  });

  it('speakReply reads a typed answer aloud, then returns to idle', async () => {
    const t = setup();
    let finished;
    await act(async () => { finished = t.result.current.speakReply('Typed answer.'); });
    expect(t.result.current.phase).toBe('speaking');
    expect(t.speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Typed answer.' }));

    await act(async () => { t.controllers[0].finish(); await finished; });
    expect(t.result.current.phase).toBe('idle');
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it('speakReply reports a voice problem without losing the written answer', async () => {
    const t = setup();
    t.speak.mockImplementation(() => ({
      done: Promise.reject(Object.assign(new Error('x'), { status: 429 })),
      stop: vi.fn(),
    }));
    await act(async () => { await t.result.current.speakReply('Typed answer.'); });
    expect(t.result.current.error).toBe('busy');
    expect(t.result.current.phase).toBe('idle');
  });

  it('stops speaking when the page is left', async () => {
    const t = setup();
    await tapMic(t);
    await tapStop(t);
    await waitFor(() => expect(t.result.current.phase).toBe('speaking'));
    t.unmount();
    expect(t.controllers[0].stop).toHaveBeenCalled();
  });

  it('reports a microphone that cannot be opened and stays idle', async () => {
    media.uninstall();
    media = installFakeMedia({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
    const t = setup({ handsFree: true });
    let started;
    await act(async () => { started = await t.result.current.start(); });
    expect(started).toBe(false);
    expect(t.result.current.error).toBe('denied');
    expect(t.result.current.phase).toBe('idle');
    expect(t.onHandsFreeStop).toHaveBeenCalledTimes(1);
  });

  it('ends the turn by itself when the farmer stops talking (voice activity detection)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(1_000_000));
    const monitorFactory = fakeMonitorFactory();
    const t = setup({ recorderOptions: { monitorFactory } });
    await tapMic(t);

    const feed = (levels) => {
      for (const level of levels) {
        vi.setSystemTime(new Date(Date.now() + SAMPLE_MS));
        act(() => monitorFactory.monitors[0].onSample(level));
      }
    };
    feed([...repeat(0.005, 400), ...repeat(0.2, 800)]);
    expect(t.result.current.heardSpeech).toBe(true);
    expect(t.result.current.phase).toBe('listening');
    expect(t.transcribe).not.toHaveBeenCalled();

    feed(repeat(0.004, 1500));
    await waitFor(() => expect(t.speak).toHaveBeenCalledTimes(1));
    expect(t.transcribe).toHaveBeenCalledTimes(1);
    expect(t.sendUtterance).toHaveBeenCalledWith('onion price');
  });
});
