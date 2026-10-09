/**
 * Speaks a piece of text with Sarvam text-to-speech (through the backend).
 *
 * The text is cut into sentence-sized chunks. While chunk N is playing, chunk N+1 is already
 * being synthesised, so even a long answer starts speaking after one short request instead of
 * after the whole text has been converted. Synthesised audio is cached in memory (never in
 * storage) so replaying an answer is instant and free.
 */
import { synthesizeSpeech } from '../services/assistantApi';
import { splitSpeechChunks, toSpokenText } from '../utils/speech';
import { audioUrlFromBase64, playAudioUrl, stopAudio } from './audioPlayer';

const CACHE_LIMIT = 40;
const cache = new Map(); // `${language}:${chunk}` -> object URL

export function clearSpeechCache() {
  for (const url of cache.values()) URL.revokeObjectURL?.(url);
  cache.clear();
}

async function audioFor(chunk, language, getToken, synth) {
  const key = `${language}:${chunk}`;
  if (cache.has(key)) {
    const url = cache.get(key);
    cache.delete(key); // refresh recency
    cache.set(key, url);
    return url;
  }
  const { audioBase64, mimeType } = await synth(chunk, language, await getToken());
  const url = audioUrlFromBase64(audioBase64, mimeType || 'audio/mpeg');
  cache.set(key, url);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    URL.revokeObjectURL?.(cache.get(oldest));
    cache.delete(oldest);
  }
  return url;
}

/**
 * @returns {{ done: Promise<'ended'|'interrupted'|'empty'>, stop(): void }}
 *   `done` rejects if synthesis or playback fails (e.g. the voice service is unavailable).
 */
export function speakText({ text, language = 'en', getToken, synth = synthesizeSpeech, play = playAudioUrl, stopPlayback = stopAudio }) {
  const chunks = splitSpeechChunks(toSpokenText(text));
  let stopped = false;

  const done = (async () => {
    if (chunks.length === 0) return 'empty';
    let next = audioFor(chunks[0], language, getToken, synth);
    for (let i = 0; i < chunks.length; i += 1) {
      const url = await next;
      if (stopped) return 'interrupted';
      // Start synthesising the following chunk while this one plays; a failure there only
      // matters if playback actually reaches it.
      next = i + 1 < chunks.length ? audioFor(chunks[i + 1], language, getToken, synth) : null;
      next?.catch(() => {});
      const outcome = await play(url);
      if (outcome === 'interrupted' || stopped) return 'interrupted';
    }
    return 'ended';
  })();

  return {
    done,
    stop() {
      stopped = true;
      stopPlayback();
    },
  };
}
