/**
 * One shared audio output for the whole app.
 *
 * - Only one thing is ever spoken at a time: starting a new playback stops the previous one.
 * - Browsers (iOS Safari especially) only allow audio that was "unlocked" by a user gesture.
 *   Call unlockAudio() inside the tap that starts a voice turn; later replies, which arrive
 *   after network calls, then play through the same unlocked element.
 * - Nothing is written to storage; object URLs live only for the page session.
 */

// A valid, empty WAV file: playing it inside a user gesture unlocks the element.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

let element = null;
let active = null; // { resolve } for the playback in progress

function audioElement() {
  if (!element && typeof Audio !== 'undefined') element = new Audio();
  return element;
}

export function unlockAudio() {
  const audio = audioElement();
  if (!audio || active) return;
  try {
    audio.src = SILENT_WAV;
    const attempt = audio.play();
    attempt?.catch?.(() => {});
  } catch {
    /* unlocking is best effort */
  }
}

/** Stops whatever is playing; the pending play promise resolves as 'interrupted'. */
export function stopAudio() {
  const audio = element;
  const current = active;
  active = null;
  if (audio) {
    try {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
    } catch {
      /* ignore */
    }
  }
  current?.resolve('interrupted');
}

export function isAudioPlaying() {
  return Boolean(active);
}

/** Plays an audio URL. Resolves 'ended' or 'interrupted'; rejects when the browser cannot play it. */
export function playAudioUrl(url) {
  const audio = audioElement();
  if (!audio) return Promise.reject(new Error('Audio playback is not supported in this browser.'));
  stopAudio();
  return new Promise((resolve, reject) => {
    active = { resolve };
    audio.onended = () => {
      active = null;
      resolve('ended');
    };
    audio.onerror = () => {
      active = null;
      reject(new Error('The audio could not be played.'));
    };
    audio.src = url;
    const attempt = audio.play();
    if (attempt?.catch) {
      attempt.catch((err) => {
        if (active?.resolve === resolve) {
          active = null;
          reject(err);
        }
      });
    }
  });
}

/** base64 audio -> a playable object URL. */
export function audioUrlFromBase64(base64, mimeType = 'audio/mpeg') {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}
