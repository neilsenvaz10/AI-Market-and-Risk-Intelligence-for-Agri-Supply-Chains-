// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AskAiPage from '../src/pages/AskAiPage';
import SpeakButton from '../src/components/SpeakButton';
import VoiceInputButton from '../src/components/VoiceInputButton';
import * as api from '../src/services/assistantApi';
import { pickRecorderMime, recordingErrorKey, serviceErrorKey, toSpokenText } from '../src/utils/speech';

const user = { getIdToken: vi.fn().mockResolvedValue('token') };
let language = 'en';
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ language, user }) }));
vi.mock('../src/services/assistantApi');

beforeEach(() => {
  language = 'en';
  vi.mocked(api.getAssistantCapabilities).mockResolvedValue({ chat: true, speechToText: true, textToSpeech: true });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.MediaRecorder; });

it('speech helpers: mime choice, error mapping, spoken text cleanup', () => {
  expect(pickRecorderMime({ isTypeSupported: (t) => t === 'audio/mp4' })).toBe('audio/mp4');
  expect(pickRecorderMime(undefined)).toBe('');
  expect(recordingErrorKey({ name: 'NotAllowedError' })).toBe('denied');
  expect(recordingErrorKey({ name: 'NotFoundError' })).toBe('noMic');
  expect(serviceErrorKey({ code: 'NO_SPEECH_DETECTED' })).toBe('noSpeech');
  expect(serviceErrorKey({ status: 429 })).toBe('busy');
  expect(toSpokenText('**Onion** ₹1,400 <b>x</b> https://a.b/c')).toBe('Onion ₹1,400 x');
});

it('chat shows verified sources with price, unit and reporting date, and flags non-AI answers', async () => {
  vi.mocked(api.sendChatMessage).mockResolvedValue({
    reply: 'Latest reported Onion prices', aiUsed: false,
    sources: [{ mandi: 'Lasalgaon APMC', district: 'Nashik', modal: '1,400', date: '2026-09-15' }],
  });
  render(<AskAiPage />);
  fireEvent.change(screen.getByLabelText(/Ask anything/), { target: { value: 'onion price' } });
  fireEvent.click(screen.getByLabelText('Send'));
  expect(await screen.findByText('Latest reported Onion prices')).toBeTruthy();
  expect(screen.getByText(/₹1,400 \/ quintal/)).toBeTruthy();
  expect(screen.getByText(/reported 2026-09-15/)).toBeTruthy();
  expect(screen.getByText('Verified data')).toBeTruthy();
  expect(api.sendChatMessage).toHaveBeenCalledWith({ message: 'onion price', language: 'en', history: [] }, 'token');
});

it('chat failure shows an error and never invents an answer', async () => {
  vi.mocked(api.sendChatMessage).mockRejectedValue(new Error('down'));
  render(<AskAiPage />);
  fireEvent.change(screen.getByLabelText(/Ask anything/), { target: { value: 'tomato' } });
  fireEvent.click(screen.getByLabelText('Send'));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Could not get an answer/);
});

it('the page is localised and keeps the welcome note honest about missing features', async () => {
  language = 'hi';
  render(<AskAiPage />);
  expect(screen.getByText(/पूर्वानुमान, परिवहन खर्च और मंडी सिफ़ारिश अभी जुड़े नहीं हैं/)).toBeTruthy();
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
