// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AskAiPage from '../src/pages/AskAiPage';
import SpeakButton from '../src/components/SpeakButton';
import VoiceInputButton from '../src/components/VoiceInputButton';
import * as api from '../src/services/assistantApi';
import * as copilot from '../src/services/copilotService';
import * as audio from '../src/voice/audioPlayer';
import { pickRecorderMime, recordingErrorKey, serviceErrorKey, toSpokenText } from '../src/utils/speech';

const user = { getIdToken: vi.fn().mockResolvedValue('token') };
let language = 'en';
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ language, user }) }));
vi.mock('../src/services/assistantApi');
vi.mock('../src/services/copilotService');
vi.mock('../src/voice/audioPlayer', () => ({
  unlockAudio: vi.fn(),
  stopAudio: vi.fn(),
  isAudioPlaying: vi.fn(() => false),
  playAudioUrl: vi.fn(),
  audioUrlFromBase64: vi.fn(),
}));

const OLD_PRICE_REPLY = {
  status: 'ok',
  answer: 'The latest reported onion price in Nashik is 1400 rupees per quintal, from 15 September 2025.',
  language: 'en',
  intent: 'LATEST_PRICE',
  entity: { commodity: 'Onion', mandi: 'Nashik APMC' },
  sources: [{ type: 'mandi_price', source: 'AGMARKNET', date: '2025-09-15' }],
  marketData: {
    commodityName: 'Onion',
    mandiName: 'Nashik APMC',
    modalPrice: 1400,
    minPrice: 1200,
    maxPrice: 1600,
    priceDate: '2025-09-15',
    ageDays: 389,
    isStale: true,
    source: 'AGMARKNET',
    alternatives: [{ mandiName: 'Pune APMC', modalPrice: 1350, priceDate: '2025-09-14' }],
  },
  assumptions: [],
  groqPowered: true,
  aiError: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  language = 'en';
  vi.mocked(api.getAssistantCapabilities).mockResolvedValue({ speechToText: true, textToSpeech: true });
  vi.mocked(copilot.getCopilotCapabilities).mockResolvedValue({ capabilities: { groqConfigured: true } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); delete globalThis.MediaRecorder; delete window.MediaRecorder; });

it('speech helpers: mime choice, error mapping, spoken text cleanup', () => {
  expect(pickRecorderMime({ isTypeSupported: (t) => t === 'audio/mp4' })).toBe('audio/mp4');
  expect(pickRecorderMime(undefined)).toBe('');
  expect(recordingErrorKey({ name: 'NotAllowedError' })).toBe('denied');
  expect(recordingErrorKey({ name: 'NotFoundError' })).toBe('noMic');
  expect(serviceErrorKey({ code: 'NO_SPEECH_DETECTED' })).toBe('noSpeech');
  expect(serviceErrorKey({ status: 429 })).toBe('busy');
  expect(toSpokenText('**Onion** ₹1,400 <b>x</b> https://a.b/c')).toBe('Onion ₹1,400 x');
});

it('answers come from the Copilot only, with the verified price, its date and its age', async () => {
  vi.mocked(copilot.sendCopilotMessage).mockResolvedValue(OLD_PRICE_REPLY);
  render(<AskAiPage />);
  fireEvent.change(screen.getByLabelText(/Ask anything/), { target: { value: 'onion price' } });
  fireEvent.click(screen.getByLabelText('Send'));

  expect(await screen.findByText(/1400 rupees per quintal/)).toBeTruthy();
  expect(screen.getByText('₹1,400/quintal')).toBeTruthy();
  expect(screen.getByText(/Reported Date: 15 September 2025/)).toBeTruthy();
  expect(screen.getByText('Old report: 389 days old')).toBeTruthy();
  expect(screen.getByText('Other markets')).toBeTruthy();
  expect(screen.getByText('Pune APMC')).toBeTruthy();
  expect(screen.getByText('AI answer')).toBeTruthy();
  expect(copilot.sendCopilotMessage).toHaveBeenCalledTimes(1);
  expect(copilot.sendCopilotMessage).toHaveBeenCalledWith({
    message: 'onion price', language: 'en', context: {}, conversationHistory: [], token: 'token',
  });
  // the old, separate chat endpoint no longer exists
  expect(api.sendChatMessage).toBeUndefined();
});

it('a failed request shows an error and never invents an answer', async () => {
  vi.mocked(copilot.sendCopilotMessage).mockRejectedValue(new Error('Cannot reach the FASALYTICS server.'));
  render(<AskAiPage />);
  fireEvent.change(screen.getByLabelText(/Ask anything/), { target: { value: 'tomato' } });
  fireEvent.click(screen.getByLabelText('Send'));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot reach the FASALYTICS server/);
  expect(screen.getByText('tomato')).toBeTruthy(); // the question stays visible
  expect(screen.queryByText('AI answer')).toBeNull();
});

it('the page is localised and keeps the welcome note honest about missing features', async () => {
  language = 'hi';
  render(<AskAiPage />);
  expect(screen.getByText(/परिवहन खर्च और मंडी सिफ़ारिश अभी उपलब्ध नहीं हैं/)).toBeTruthy();
  // this browser cannot record, so the page says so instead of inviting the farmer to talk
  expect(screen.queryByText('माइक दबाकर बस बोलिए। मैं बोलकर जवाब दूँगा।')).toBeNull();
  expect(screen.getByText('इस ब्राउज़र में आवाज़ रिकॉर्डिंग समर्थित नहीं है।')).toBeTruthy();
});

it('with a working microphone the welcome invites the farmer to just talk', () => {
  installRecorder();
  language = 'hi';
  render(<AskAiPage />);
  expect(screen.getByText('माइक दबाकर बस बोलिए। मैं बोलकर जवाब दूँगा।')).toBeTruthy();
  expect(screen.getByLabelText('बोलकर पूछें').disabled).toBe(false);
});

it('mic is disabled with an explanation when the browser cannot record', () => {
  render(<VoiceInputButton language="en" onTranscript={() => {}} />);
  const button = screen.getByLabelText('Speak your question');
  expect(button.disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toMatch(/not supported/);
});

function installRecorder({ denyPermission = false } = {}) {
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: denyPermission ? vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })) : vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
  });
  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(400)]), size: 400 }); this.onstop?.(); }
  }
  globalThis.MediaRecorder = FakeRecorder;
  window.MediaRecorder = FakeRecorder;
  return track;
}

it('records, sends the audio for transcription and returns the text; releases the microphone', async () => {
  const track = installRecorder();
  vi.mocked(api.transcribeAudio).mockResolvedValue({ transcript: 'प्याज का भाव' });
  const onTranscript = vi.fn();
  render(<VoiceInputButton language="hi" onTranscript={onTranscript} />);
  await act(async () => { fireEvent.click(screen.getByLabelText('बोलकर पूछें')); });
  await act(async () => { fireEvent.click(screen.getByLabelText('रिकॉर्डिंग रोकें')); });
  await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('प्याज का भाव'));
  expect(api.transcribeAudio).toHaveBeenCalledWith(expect.any(Blob), 'hi', 'token');
  expect(track.stop).toHaveBeenCalled();
});

it('microphone permission denial is reported, not swallowed', async () => {
  installRecorder({ denyPermission: true });
  render(<VoiceInputButton language="en" onTranscript={() => {}} />);
  await act(async () => { fireEvent.click(screen.getByLabelText('Speak your question')); });
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/permission was denied/));
  expect(api.transcribeAudio).not.toHaveBeenCalled();
});

it('listen button requests speech in the active language and reports provider errors', async () => {
  language = 'mr';
  vi.mocked(api.synthesizeSpeech).mockRejectedValue(Object.assign(new Error('x'), { status: 503, code: 'SARVAM_NOT_CONFIGURED' }));
  render(<SpeakButton text="कांद्याचा भाव" language="mr" />);
  await act(async () => { fireEvent.click(screen.getByLabelText('ऐका')); });
  await waitFor(() => expect(api.synthesizeSpeech).toHaveBeenCalledWith('कांद्याचा भाव', 'mr', 'token'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/आवाज सेवा सध्या सुरू नाही/));
});

it('listen plays the answer and becomes a stop button while it plays', async () => {
  let endPlayback;
  vi.mocked(audio.audioUrlFromBase64).mockReturnValue('blob:answer');
  vi.mocked(audio.playAudioUrl).mockImplementation(() => new Promise((resolve) => { endPlayback = resolve; }));
  vi.mocked(api.synthesizeSpeech).mockResolvedValue({ audioBase64: 'AAAA', mimeType: 'audio/mpeg' });
  render(<SpeakButton text="Onion is 1400 rupees per quintal." language="en" />);

  await act(async () => { fireEvent.click(screen.getByLabelText('Listen')); });
  await waitFor(() => expect(audio.playAudioUrl).toHaveBeenCalledWith('blob:answer'));
  expect(api.synthesizeSpeech).toHaveBeenCalledWith('Onion is 1400 rupees per quintal.', 'en', 'token');

  const stop = await screen.findByLabelText('Stop audio');
  await act(async () => { fireEvent.click(stop); });
  expect(audio.stopAudio).toHaveBeenCalled();
  await act(async () => { endPlayback('interrupted'); });
  expect(await screen.findByLabelText('Listen')).toBeTruthy();
});
