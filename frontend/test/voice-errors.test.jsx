// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VoiceInputButton from '../src/components/VoiceInputButton';
import SpeakButton from '../src/components/SpeakButton';
import * as api from '../src/services/assistantApi';
import { detectRecordingSupport } from '../src/utils/speech';
import * as voice from '../src/voice';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { getIdToken: async () => 'auth-token' } }) }));
vi.mock('../src/services/assistantApi');
vi.mock('../src/voice/audioPlayer', () => ({
  unlockAudio: vi.fn(),
  stopAudio: vi.fn(),
  isAudioPlaying: vi.fn(() => false),
  playAudioUrl: vi.fn(),
  audioUrlFromBase64: vi.fn(),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.MediaRecorder; delete window.MediaRecorder; });
beforeEach(() => vi.clearAllMocks());

function install({ getUserMedia }) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(400)]), size: 400 }); this.onstop?.(); }
  }
  globalThis.MediaRecorder = Recorder;
  window.MediaRecorder = Recorder;
}
const okStream = () => vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
const click = async (name) => act(async () => { fireEvent.click(screen.getByLabelText(name)); });

it('unsupported browser: the mic is disabled and explains why; no recording is attempted', () => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  render(<VoiceInputButton language="en" onTranscript={() => {}} />);
  expect(screen.getByLabelText('Speak your question').disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toMatch(/not supported in this browser/);
});

it('insecure page: reports that the microphone needs HTTPS', () => {
  const win = { isSecureContext: false, location: { hostname: 'farm.example' }, navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder() {} };
  expect(detectRecordingSupport(win)).toEqual({ supported: false, reason: 'insecure' });
  expect(detectRecordingSupport({ ...win, location: { hostname: 'localhost' } }).supported).toBe(true);
});

it('permission denied and missing microphone produce distinct messages', async () => {
  install({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
  const { unmount } = render(<VoiceInputButton language="en" onTranscript={() => {}} />);
  await click('Speak your question');
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/permission was denied/));
  unmount();

  install({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' })) });
  render(<VoiceInputButton language="mr" onTranscript={() => {}} />);
  await click('बोलून विचारा');
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/मायक्रोफोन सापडला नाही/));
  expect(api.transcribeAudio).not.toHaveBeenCalled();
});

it('service errors are explained: nothing heard, quota/busy, not configured, network', async () => {
  const cases = [
    [{ code: 'NO_SPEECH_DETECTED', status: 422 }, /No speech was heard/],
    [{ code: 'SARVAM_QUOTA_EXCEEDED', status: 503 }, /service is busy/],
    [{ code: 'SARVAM_NOT_CONFIGURED', status: 503 }, /not switched on/],
    [{ code: 'NETWORK_ERROR', status: 0 }, /internet connection/],
  ];
  for (const [error, pattern] of cases) {
    install({ getUserMedia: okStream() });
    api.transcribeAudio.mockRejectedValueOnce(Object.assign(new Error('x'), error));
    const { unmount } = render(<VoiceInputButton language="en" onTranscript={() => {}} />);
    await click('Speak your question');
    await click('Stop recording');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(pattern));
    unmount();
  }
});

it('the token source can be injected so the Phase 7 Copilot can reuse the buttons', async () => {
  install({ getUserMedia: okStream() });
  api.transcribeAudio.mockResolvedValue({ transcript: 'hello' });
  const onTranscript = vi.fn();
  render(<VoiceInputButton language="en" onTranscript={onTranscript} getToken={async () => 'copilot-token'} />);
  await click('Speak your question');
  await click('Stop recording');
  await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('hello'));
  expect(api.transcribeAudio).toHaveBeenCalledWith(expect.any(Blob), 'en', 'copilot-token');

  api.synthesizeSpeech.mockRejectedValue(Object.assign(new Error('x'), { code: 'SARVAM_QUOTA_EXCEEDED' }));
  render(<SpeakButton text="Hello" language="en" getToken={async () => 'copilot-token'} />);
  await click('Listen');
  await waitFor(() => expect(api.synthesizeSpeech).toHaveBeenCalledWith('Hello', 'en', 'copilot-token'));
});

it('the reusable voice entry point exports the public pieces', () => {
  for (const name of [
    'VoiceInputButton', 'SpeakButton', 'useVoiceRecorder', 'useVoiceConversation', 'speakText', 'unlockAudio', 'stopAudio',
    'transcribeAudio', 'synthesizeSpeech', 'getAssistantCapabilities',
  ]) {
    expect(voice[name], name).toBeTruthy();
  }
  // the chat endpoint was removed: the Copilot is the only chatbot
  expect(voice.sendChatMessage).toBeUndefined();
});
