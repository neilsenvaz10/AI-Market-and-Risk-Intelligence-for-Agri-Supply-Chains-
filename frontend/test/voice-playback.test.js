// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSpeechCache, speakText } from '../src/voice/speak';

// --- URL.createObjectURL is not implemented by jsdom: hand out unique fake URLs ---------------
let urlCounter = 0;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let revoked;
beforeEach(() => {
  urlCounter = 0;
  revoked = [];
  URL.createObjectURL = vi.fn(() => `blob:clip-${(urlCounter += 1)}`);
  URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
  clearSpeechCache();
  revoked.length = 0;
});
afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('audioPlayer (one shared, unlocked audio output)', () => {
  class FakeAudio {
    static instances = [];
    static playBehaviour = () => Promise.resolve();
    constructor() {
      this.paused = true;
      this.src = '';
      this.played = [];
      FakeAudio.instances.push(this);
    }
    play() { this.played.push(this.src); this.paused = false; return FakeAudio.playBehaviour(); }
    pause() { this.paused = true; }
  }
  let player;

  beforeEach(async () => {
    FakeAudio.instances = [];
    FakeAudio.playBehaviour = () => Promise.resolve();
    vi.stubGlobal('Audio', FakeAudio);
    vi.resetModules();
    player = await import('../src/voice/audioPlayer');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('plays a clip and resolves "ended" when it finishes', async () => {
    const playing = player.playAudioUrl('blob:a');
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe('blob:a');
    expect(player.isAudioPlaying()).toBe(true);
    audio.onended();
    await expect(playing).resolves.toBe('ended');
    expect(player.isAudioPlaying()).toBe(false);
  });

  it('a new clip interrupts the previous one, through a single shared element', async () => {
    const first = player.playAudioUrl('blob:a');
    const second = player.playAudioUrl('blob:b');
    await expect(first).resolves.toBe('interrupted');
    FakeAudio.instances[0].onended();
    await expect(second).resolves.toBe('ended');
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('stopAudio pauses the speaker and interrupts the pending clip', async () => {
    const playing = player.playAudioUrl('blob:a');
    player.stopAudio();
    await expect(playing).resolves.toBe('interrupted');
    expect(FakeAudio.instances[0].paused).toBe(true);
    expect(player.isAudioPlaying()).toBe(false);
  });

  it('unlockAudio plays a silent clip inside the tap, and never disturbs a clip that is playing', async () => {
    player.unlockAudio();
    expect(FakeAudio.instances[0].played[0]).toMatch(/^data:audio\/wav;base64,/);

    const playing = player.playAudioUrl('blob:speech');
    player.unlockAudio();
    expect(FakeAudio.instances[0].src).toBe('blob:speech');
    FakeAudio.instances[0].onended();
    await expect(playing).resolves.toBe('ended');
  });

  it('rejects when the browser refuses to play (autoplay policy)', async () => {
    FakeAudio.playBehaviour = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    await expect(player.playAudioUrl('blob:a')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(player.isAudioPlaying()).toBe(false);
  });

  it('rejects when the audio file cannot be decoded', async () => {
    const playing = player.playAudioUrl('blob:broken');
    FakeAudio.instances[0].onerror();
    await expect(playing).rejects.toThrow(/could not be played/);
  });

  it('turns base64 audio into a playable object URL of the right type', () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => { created.push(blob); return 'blob:made'; });
    expect(player.audioUrlFromBase64('AAAA', 'audio/mpeg')).toBe('blob:made');
    expect(created[0].type).toBe('audio/mpeg');
    expect(created[0].size).toBe(3);
  });
});

describe('speakText (chunked Sarvam speech with prefetch)', () => {
  // Each sentence is ~155 characters, so two never share a 240-character chunk.
  const sentence = (n) => `Sentence ${n} ${'word '.repeat(28).trim()}.`;
  const THREE_CHUNKS = [sentence(1), sentence(2), sentence(3)].join(' ');

  function harness({ failOnCall = null } = {}) {
    const calls = { synth: [] };
    const synth = vi.fn(async (text) => {
      const index = calls.synth.length;
      calls.synth.push(text);
      if (failOnCall === index) throw Object.assign(new Error('quota'), { code: 'SARVAM_QUOTA_EXCEEDED' });
      return { audioBase64: 'AAAA', mimeType: 'audio/mpeg' };
    });
    const plays = [];
    const play = vi.fn((url) => new Promise((resolve) => { plays.push({ url, resolve }); }));
    const stopPlayback = vi.fn();
    const speak = (text, language = 'en') => speakText({
      text, language, getToken: async () => 'tok', synth, play, stopPlayback,
    });
    return { synth, play, plays, stopPlayback, speak, calls };
  }

  it('starts after the first chunk and prepares the next one while it plays', async () => {
    const h = harness();
    const speech = h.speak(THREE_CHUNKS, 'hi');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(1));
    expect(h.synth).toHaveBeenCalledTimes(2); // chunk 2 is already being prepared
    expect(h.synth.mock.calls[0]).toEqual([expect.stringContaining('Sentence 1'), 'hi', 'tok']);

    h.plays[0].resolve('ended');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(2));
    expect(h.synth).toHaveBeenCalledTimes(3);

    h.plays[1].resolve('ended');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(3));
    h.plays[2].resolve('ended');
    await expect(speech.done).resolves.toBe('ended');
    expect(h.synth).toHaveBeenCalledTimes(3);
  });

  it('stop() silences the current clip and plays nothing more', async () => {
    const h = harness();
    const speech = h.speak(THREE_CHUNKS);
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(1));
    speech.stop();
    expect(h.stopPlayback).toHaveBeenCalledTimes(1);
    h.plays[0].resolve('interrupted');
    await expect(speech.done).resolves.toBe('interrupted');
    expect(h.play).toHaveBeenCalledTimes(1);
  });

  it('stop() before the first audio arrives plays nothing at all', async () => {
    const h = harness();
    const speech = h.speak('Hello there.');
    speech.stop();
    await expect(speech.done).resolves.toBe('interrupted');
    expect(h.play).not.toHaveBeenCalled();
  });

  it('rejects when synthesis fails, so the caller can explain why', async () => {
    const h = harness({ failOnCall: 0 });
    const speech = h.speak('Hello there.');
    await expect(speech.done).rejects.toMatchObject({ code: 'SARVAM_QUOTA_EXCEEDED' });
    expect(h.play).not.toHaveBeenCalled();
  });

  it('a failure in a later chunk only matters once playback reaches it', async () => {
    const h = harness({ failOnCall: 2 });
    const speech = h.speak(THREE_CHUNKS);
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(1));
    h.plays[0].resolve('ended');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(2));
    h.plays[1].resolve('ended');
    await expect(speech.done).rejects.toMatchObject({ code: 'SARVAM_QUOTA_EXCEEDED' });
    expect(h.play).toHaveBeenCalledTimes(2);
  });

  it('replaying the same text uses cached audio instead of calling Sarvam again', async () => {
    const h = harness();
    const first = h.speak('Hello there.');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(1));
    h.plays[0].resolve('ended');
    await first.done;

    const second = h.speak('Hello there.');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(2));
    h.plays[1].resolve('ended');
    await second.done;

    expect(h.synth).toHaveBeenCalledTimes(1);
    expect(h.plays[1].url).toBe(h.plays[0].url);
  });

  it('does not reuse audio across languages', async () => {
    const h = harness();
    const english = h.speak('Hello there.', 'en');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(1));
    h.plays[0].resolve('ended');
    await english.done;

    const hindi = h.speak('Hello there.', 'hi');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(2));
    h.plays[1].resolve('ended');
    await hindi.done;
    expect(h.synth).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 40 clips in memory and releases the oldest', async () => {
    const h = harness();
    for (let i = 0; i < 41; i += 1) {
      const speech = h.speak(`Clip number ${i}.`);
      await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(i + 1));
      h.plays[i].resolve('ended');
      await speech.done;
    }
    expect(revoked).toEqual([h.plays[0].url]);
  });

  it('speaks plain text only, and nothing at all for empty text', async () => {
    const h = harness();
    const markup = h.speak('**Onion** <b>x</b> https://example.test/a');
    await vi.waitFor(() => expect(h.play).toHaveBeenCalledTimes(1));
    expect(h.calls.synth[0]).toBe('Onion x');
    h.plays[0].resolve('ended');
    await markup.done;

    const empty = h.speak('   ');
    await expect(empty.done).resolves.toBe('empty');
    expect(h.synth).toHaveBeenCalledTimes(1);
  });
});
