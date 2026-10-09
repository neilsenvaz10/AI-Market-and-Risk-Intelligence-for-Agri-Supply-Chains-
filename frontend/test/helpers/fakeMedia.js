// A fake microphone and MediaRecorder: jsdom has neither. Install BEFORE rendering anything that
// calls detectRecordingSupport(), and always call uninstall() afterwards.
import { vi } from 'vitest';

export function installFakeMedia({ getUserMedia, recordedBytes = 400 } = {}) {
  const tracks = [];
  const recorders = [];

  const defaultGetUserMedia = vi.fn(async () => {
    const track = { stop: vi.fn() };
    tracks.push(track);
    return { getTracks: () => [track] };
  });
  const media = getUserMedia || defaultGetUserMedia;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: media } });

  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor() {
      this.state = 'inactive';
      this.mimeType = 'audio/webm';
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      if (recordedBytes > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(recordedBytes)]), size: recordedBytes });
      this.onstop?.();
    }
  }
  globalThis.MediaRecorder = FakeRecorder;
  window.MediaRecorder = FakeRecorder;

  return {
    tracks,
    recorders,
    getUserMedia: media,
    uninstall() {
      delete globalThis.MediaRecorder;
      delete window.MediaRecorder;
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    },
  };
}

/** Stands in for the Web Audio level monitor; tests push microphone levels through `monitors[i].onSample`. */
export function fakeMonitorFactory() {
  const monitors = [];
  const factory = vi.fn((stream, { onSample }) => {
    const monitor = { onSample, stopped: false, stop() { this.stopped = true; } };
    monitors.push(monitor);
    return monitor;
  });
  factory.monitors = monitors;
  return factory;
}

export const SAMPLE_MS = 80;
export const repeat = (value, ms) => Array(Math.round(ms / SAMPLE_MS)).fill(value);
