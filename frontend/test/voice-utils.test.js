import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLevelMonitor, createSilenceDetector, rmsOf, splitSpeechChunks } from '../src/utils/speech';
import { formatReportDate, formatRupees } from '../src/utils/dates';

const SAMPLE_MS = 80;
const repeat = (value, ms) => Array(Math.round(ms / SAMPLE_MS)).fill(value);

/** Feeds levels to a detector at 80 ms intervals; returns each verdict. */
function run(detector, levels) {
  let now = 1_000_000;
  return levels.map((rms) => {
    const verdict = detector.push(rms, now);
    now += SAMPLE_MS;
    return verdict;
  });
}
const firstVerdict = (verdicts) => {
  const index = verdicts.findIndex(Boolean);
  return { index, verdict: index === -1 ? null : verdicts[index] };
};

describe('createSilenceDetector (ends a turn when the farmer stops talking)', () => {
  it('ends the turn about 1.3 s after speech stops', () => {
    const detector = createSilenceDetector();
    const verdicts = run(detector, [...repeat(0.005, 400), ...repeat(0.2, 800), ...repeat(0.004, 2400)]);
    const { index, verdict } = firstVerdict(verdicts);
    expect(verdict).toBe('speech-ended');
    expect(detector.heardSpeech).toBe(true);
    // 5 quiet + 10 loud samples, then 1300 ms of silence = 17 more samples
    expect(index).toBeGreaterThanOrEqual(28);
    expect(index).toBeLessThanOrEqual(34);
  });

  it('does not end the turn during a short pause inside a sentence', () => {
    const detector = createSilenceDetector();
    const verdicts = run(detector, [...repeat(0.005, 400), ...repeat(0.2, 800), ...repeat(0.004, 800), ...repeat(0.2, 800)]);
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it('gives up with no-speech when nobody talks', () => {
    const detector = createSilenceDetector();
    const { verdict, index } = firstVerdict(run(detector, repeat(0.004, 9000)));
    expect(verdict).toBe('no-speech');
    expect(index).toBeGreaterThanOrEqual(99);
    expect(detector.heardSpeech).toBe(false);
  });

  it('a single click or bump is not speech', () => {
    const detector = createSilenceDetector();
    const { verdict } = firstVerdict(run(detector, [...repeat(0.004, 400), 0.5, ...repeat(0.004, 9000)]));
    expect(verdict).toBe('no-speech');
    expect(detector.heardSpeech).toBe(false);
  });

  it('stops at the maximum duration even if the farmer never pauses', () => {
    const detector = createSilenceDetector();
    const { verdict } = firstVerdict(run(detector, repeat(0.3, 30_000)));
    expect(verdict).toBe('max-duration');
  });

  it('adapts to steady background noise instead of treating it as speech', () => {
    const detector = createSilenceDetector();
    const { verdict } = firstVerdict(run(detector, repeat(0.04, 9000)));
    expect(verdict).toBe('no-speech');
    expect(detector.threshold).toBeCloseTo(0.06, 5);
  });

  it('still hears speech that starts immediately', () => {
    const detector = createSilenceDetector();
    run(detector, repeat(0.2, 1000));
    expect(detector.heardSpeech).toBe(true);
  });
});

describe('splitSpeechChunks (speak the first sentences while the rest is prepared)', () => {
  it('keeps short text in one piece', () => {
    expect(splitSpeechChunks('One. Two. Three.')).toEqual(['One. Two. Three.']);
  });

  it('breaks between sentences once a chunk is full', () => {
    expect(splitSpeechChunks('Alpha beta. Gamma delta. Epsilon.', 10)).toEqual(['Alpha beta.', 'Gamma delta.', 'Epsilon.']);
  });

  it('never splits a decimal number', () => {
    expect(splitSpeechChunks('The price rose 3.5 percent. It may fall.', 30)).toEqual(['The price rose 3.5 percent.', 'It may fall.']);
  });

  it('understands the Devanagari danda', () => {
    const chunks = splitSpeechChunks('प्याज का भाव 1400 रुपये है। यह पुराना है।', 30);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].endsWith('है।')).toBe(true);
  });

  it('cuts one very long sentence at a space, never inside a word', () => {
    const text = 'word '.repeat(100).trim();
    const chunks = splitSpeechChunks(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 75)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });

  it('treats a line break as a boundary and ignores empty text', () => {
    expect(splitSpeechChunks('Line one\nLine two', 10)).toEqual(['Line one', 'Line two']);
    expect(splitSpeechChunks('   ')).toEqual([]);
    expect(splitSpeechChunks(undefined)).toEqual([]);
  });
});

describe('rmsOf', () => {
  it('measures loudness of a block of samples', () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf([1, -1, 1, -1])).toBe(1);
    expect(rmsOf(new Float32Array([0.5, 0.5]))).toBeCloseTo(0.5, 5);
  });
});

describe('createLevelMonitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  class FakeContext {
    static level = 0.25;
    constructor() { this.closed = false; FakeContext.last = this; }
    resume() {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: (buffer) => buffer.fill(FakeContext.level) }; }
    close() { this.closed = true; }
  }

  it('reports the microphone level on a timer and cleans up on stop', () => {
    const onSample = vi.fn();
    const monitor = createLevelMonitor({}, { onSample, sampleMs: 80, AudioContextCtor: FakeContext });
    vi.advanceTimersByTime(240);
    expect(onSample).toHaveBeenCalledTimes(3);
    expect(onSample.mock.calls[0][0]).toBeCloseTo(0.25, 5);

    monitor.stop();
    vi.advanceTimersByTime(400);
    expect(onSample).toHaveBeenCalledTimes(3);
    expect(FakeContext.last.closed).toBe(true);
  });

  it('returns null without Web Audio, so recording falls back to manual stop', () => {
    expect(createLevelMonitor({}, { onSample() {}, AudioContextCtor: null })).toBeNull();
  });

  it('returns null if the audio graph cannot be built', () => {
    class Broken { constructor() { throw new Error('no audio'); } }
    expect(createLevelMonitor({}, { onSample() {}, AudioContextCtor: Broken })).toBeNull();
  });
});

describe('report formatting', () => {
  it('writes dates the same way the Copilot does, in each language', () => {
    expect(formatReportDate('2026-10-08', 'en')).toBe('8 October 2026');
    expect(formatReportDate('2026-10-08', 'hi')).toBe('8 अक्टूबर 2026');
    expect(formatReportDate('2026-10-08T00:00:00.000Z', 'mr')).toBe('8 ऑक्टोबर 2026');
    expect(formatReportDate('not a date', 'en')).toBe('not a date');
    expect(formatReportDate('2026-13-01', 'en')).toBe('2026-13-01');
    expect(formatReportDate(null)).toBe('');
  });

  it('groups prices the Indian way and never prints NaN', () => {
    expect(formatRupees(1650)).toBe('1,650');
    expect(formatRupees(125000)).toBe('1,25,000');
    expect(formatRupees(1650.5)).toBe('1,650.5');
    expect(formatRupees(null)).toBe('–');
    expect(formatRupees('abc')).toBe('–');
  });
});
