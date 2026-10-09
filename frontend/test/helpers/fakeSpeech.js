import { vi } from 'vitest';

/**
 * A controllable stand-in for speakText(). Each call returns a controller whose `finish()` ends the
 * speech; `stop()` interrupts it the way the real player does (done resolves 'interrupted').
 */
export function speechStub() {
  const controllers = [];
  const speak = vi.fn(() => {
    let end;
    const controller = {
      done: new Promise((resolve) => { end = resolve; }),
      stop: vi.fn(() => end('interrupted')),
      finish: (outcome = 'ended') => end(outcome),
    };
    controllers.push(controller);
    return controller;
  });
  return { speak, controllers };
}
