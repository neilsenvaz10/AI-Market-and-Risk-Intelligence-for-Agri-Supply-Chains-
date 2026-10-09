// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useVoiceRecorder from '../src/hooks/useVoiceRecorder';
import { SAMPLE_MS, fakeMonitorFactory, installFakeMedia, repeat } from './helpers/fakeMedia';

let media;

beforeEach(() => {
  media = installFakeMedia();
  vi.useFakeTimers({ toFake: ['Date'] }); // the silence detector reads Date.now(); real timers stay real
  vi.setSystemTime(new Date(1_000_000));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  media.uninstall();
});

/** Pushes microphone levels through the monitor, advancing the clock by one sample each. */
function feed(monitor, levels) {
  for (const level of levels) {
    vi.setSystemTime(new Date(Date.now() + SAMPLE_MS));
    act(() => monitor.onSample(level));
  }
}

const render = (options) => renderHook(() => useVoiceRecorder(options));

describe('useVoiceRecorder', () => {
  it('records until the farmer stops talking, hands over the audio and releases the microphone', async () => {
    const onAudio = vi.fn();
    const onNoSpeech = vi.fn();
    const monitorFactory = fakeMonitorFactory();
    const { result } = render({ onAudio, onNoSpeech, autoStop: true, monitorFactory });
    expect(result.current.supported).toBe(true);

    await act(async () => { await result.current.start(); });
    expect(result.current.recording).toBe(true);
    const monitor = monitorFactory.monitors[0];

    feed(monitor, [...repeat(0.005, 400), ...repeat(0.2, 800)]);
    expect(result.current.heardSpeech).toBe(true);
    expect(onAudio).not.toHaveBeenCalled();

    feed(monitor, repeat(0.004, 1500));
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onAudio.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(onNoSpeech).not.toHaveBeenCalled();
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(monitor.stopped).toBe(true);
    expect(result.current.recording).toBe(false);
  });

  it('drops a recording in which nobody spoke instead of sending silence for transcription', async () => {
    const onAudio = vi.fn();
    const onNoSpeech = vi.fn();
    const monitorFactory = fakeMonitorFactory();
    const { result } = render({ onAudio, onNoSpeech, autoStop: true, monitorFactory });
    await act(async () => { await result.current.start(); });

    feed(monitorFactory.monitors[0], repeat(0.004, 9000));
    expect(onNoSpeech).toHaveBeenCalledTimes(1);
    expect(onAudio).not.toHaveBeenCalled();
    expect(result.current.error).toBe('noSpeech');
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it('a quiet but working microphone is still transcribed instead of being dropped as silence', async () => {
    const onAudio = vi.fn();
    const onNoSpeech = vi.fn();
    const monitorFactory = fakeMonitorFactory();
    const { result } = render({ onAudio, onNoSpeech, autoStop: true, monitorFactory });
    await act(async () => { await result.current.start(); });

    feed(monitorFactory.monitors[0], repeat(0.008, 9000)); // alive (peak 0.008) but never loud enough to count as speech
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onNoSpeech).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it('a level meter that only ever reads zero is abandoned: no silence verdict, the farmer taps to stop', async () => {
    const onAudio = vi.fn();
    const onNoSpeech = vi.fn();
    const monitorFactory = fakeMonitorFactory();
    const { result } = render({ onAudio, onNoSpeech, autoStop: true, monitorFactory });
    await act(async () => { await result.current.start(); });
    const monitor = monitorFactory.monitors[0];

    feed(monitor, repeat(0, 9000));
    expect(monitor.stopped).toBe(true);
    expect(onNoSpeech).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(true);

    act(() => result.current.stop());
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(result.current.recording).toBe(false);
  });

  it('a recording that captured nothing counts as silence, never as a stuck "listening"', async () => {
    media.uninstall();
    media = installFakeMedia({ recordedBytes: 0 });
    const onAudio = vi.fn();
    const onNoSpeech = vi.fn();
    const { result } = render({ onAudio, onNoSpeech, monitorFactory: () => null });
    await act(async () => { await result.current.start(); });

    act(() => result.current.stop());
    expect(onAudio).not.toHaveBeenCalled();
    expect(onNoSpeech).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('noSpeech');
    expect(result.current.recording).toBe(false);
    expect(media.tracks[0].stop).toHaveBeenCalled();
  });

  it('tells the caller when the browser recorder fails, and releases the microphone', async () => {
    const onError = vi.fn();
    const onAudio = vi.fn();
    const { result } = render({ onAudio, onError, monitorFactory: () => null });
    await act(async () => { await result.current.start(); });

    act(() => media.recorders[0].onerror(new Event('error')));
    expect(onError).toHaveBeenCalledWith('generic');
    expect(result.current.error).toBe('generic');
    expect(result.current.recording).toBe(false);
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(onAudio).not.toHaveBeenCalled();
  });

  it('cancel() throws the audio away', async () => {
    const onAudio = vi.fn();
    const monitorFactory = fakeMonitorFactory();
    const { result } = render({ onAudio, autoStop: true, monitorFactory });
    await act(async () => { await result.current.start(); });
    feed(monitorFactory.monitors[0], repeat(0.2, 800));

    act(() => result.current.cancel());
    expect(onAudio).not.toHaveBeenCalled();
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it('without voice detection it waits for stop(), then sends the audio', async () => {
    const onAudio = vi.fn();
    const monitorFactory = fakeMonitorFactory();
    const { result } = render({ onAudio, autoStop: false, monitorFactory });
    await act(async () => { await result.current.start(); });
    expect(monitorFactory).not.toHaveBeenCalled();

    act(() => result.current.stop());
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(media.tracks[0].stop).toHaveBeenCalled();
  });

  it('still records when the browser has no Web Audio (the monitor is null)', async () => {
    const onAudio = vi.fn();
    const { result } = render({ onAudio, autoStop: true, monitorFactory: () => null });
    await act(async () => { await result.current.start(); });
    expect(result.current.recording).toBe(true);
    act(() => result.current.stop());
    expect(onAudio).toHaveBeenCalledTimes(1);
  });

  it('a second tap while the permission prompt is open does not start a second recording', async () => {
    media.uninstall();
    let grant;
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(() => new Promise((resolve) => { grant = () => resolve({ getTracks: () => [track] }); }));
    media = installFakeMedia({ getUserMedia });
    const { result } = render({ onAudio: vi.fn(), monitorFactory: () => null });

    let first;
    let second;
    await act(async () => {
      first = result.current.start();
      second = result.current.start();
    });
    await expect(second).resolves.toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => { grant(); });
    await expect(first).resolves.toBe(true);
    expect(media.recorders).toHaveLength(1);
  });

  it('start() while already recording does nothing', async () => {
    const { result } = render({ onAudio: vi.fn(), monitorFactory: () => null });
    await act(async () => { await result.current.start(); });
    let again;
    await act(async () => { again = await result.current.start(); });
    expect(again).toBe(false);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.recording).toBe(true);
  });

  it('reports a denied microphone permission', async () => {
    media.uninstall();
    media = installFakeMedia({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })) });
    const { result } = render({ onAudio: vi.fn(), monitorFactory: () => null });
    let started;
    await act(async () => { started = await result.current.start(); });
    expect(started).toBe(false);
    expect(result.current.error).toBe('denied');
    expect(media.recorders).toHaveLength(0);
  });

  it('an unsupported browser is reported, not crashed', async () => {
    media.uninstall();
    const { result } = render({ onAudio: vi.fn() });
    expect(result.current.supported).toBe(false);
    let started;
    await act(async () => { started = await result.current.start(); });
    expect(started).toBe(false);
    expect(result.current.error).toBe('unsupported');
  });

  it('releases the microphone if the recorder itself cannot be created', async () => {
    globalThis.MediaRecorder = class { static isTypeSupported() { return true; } constructor() { throw new Error('boom'); } };
    window.MediaRecorder = globalThis.MediaRecorder;
    const { result } = render({ onAudio: vi.fn(), monitorFactory: () => null });
    let started;
    await act(async () => { started = await result.current.start(); });
    expect(started).toBe(false);
    expect(result.current.error).toBe('generic');
    expect(media.tracks[0].stop).toHaveBeenCalled();
  });

  it('leaving the page mid-recording releases the microphone and sends nothing', async () => {
    const onAudio = vi.fn();
    const { result, unmount } = render({ onAudio, monitorFactory: () => null });
    await act(async () => { await result.current.start(); });
    unmount();
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(onAudio).not.toHaveBeenCalled();
  });

  it('stops by itself at the maximum recording length', async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    const onAudio = vi.fn();
    const { result } = render({ onAudio, monitorFactory: () => null });
    await act(async () => { await result.current.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(result.current.recording).toBe(false);
  });
});
