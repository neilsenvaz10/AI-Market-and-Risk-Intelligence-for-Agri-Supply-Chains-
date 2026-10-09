// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AskAiPage from '../src/pages/AskAiPage';
import * as api from '../src/services/assistantApi';
import * as copilot from '../src/services/copilotService';
import { speakText } from '../src/voice/speak';
import { t } from '../src/i18n/strings';
import { installFakeMedia } from './helpers/fakeMedia';
import { speechStub } from './helpers/fakeSpeech';

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
vi.mock('../src/voice/speak', () => ({ speakText: vi.fn(), clearSpeechCache: vi.fn() }));

const reply = (overrides = {}) => ({
  status: 'ok',
  answer: 'Onion in Nashik is 1650 rupees per quintal, reported on 8 October 2026.',
  language: 'en',
  intent: 'LATEST_PRICE',
  entity: { commodity: 'Onion', mandi: 'Nashik APMC' },
  sources: [{ type: 'mandi_price', source: 'AGMARKNET', date: '2026-10-08' }],
  marketData: {
    commodityName: 'Onion',
    mandiName: 'Nashik APMC',
    modalPrice: 1650,
    minPrice: 1200,
    maxPrice: 1900,
    priceDate: '2026-10-08',
    ageDays: 1,
    isStale: false,
    source: 'AGMARKNET',
  },
  assumptions: [],
  groqPowered: true,
  aiError: null,
  ...overrides,
});

let media;
let speech;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  language = 'en';
  media = installFakeMedia();
  speech = speechStub();
  vi.mocked(speakText).mockImplementation((...args) => speech.speak(...args));
  vi.mocked(api.getAssistantCapabilities).mockResolvedValue({ speechToText: true, textToSpeech: true });
  vi.mocked(api.transcribeAudio).mockResolvedValue({ transcript: 'what is the onion price in Nashik' });
  vi.mocked(copilot.getCopilotCapabilities).mockResolvedValue({ capabilities: { groqConfigured: true } });
  vi.mocked(copilot.sendCopilotMessage).mockResolvedValue(reply());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  media.uninstall();
});

const questionBox = () => screen.getByLabelText(/Ask anything/);
const typeAndSend = async (text) => {
  fireEvent.change(questionBox(), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Send')); });
};
const tap = (label) => act(async () => { fireEvent.click(screen.getByLabelText(label)); });
const flip = (name) => act(async () => { fireEvent.click(screen.getByRole('switch', { name })); });
const spokenText = () => vi.mocked(speakText).mock.calls.map(([options]) => options.text);

describe('talking to the assistant', () => {
  it('a voice turn: tap, talk, the transcript is sent, and the answer is spoken aloud', async () => {
    render(<AskAiPage />);
    await tap('Speak your question');
    expect(screen.getByText('Listening… speak now')).toBeTruthy();

    await tap('Stop recording');
    expect(await screen.findByText('what is the onion price in Nashik')).toBeTruthy(); // the transcript is the user's message
    expect(await screen.findByText(/Onion in Nashik is 1650 rupees per quintal/)).toBeTruthy();
    expect(api.transcribeAudio).toHaveBeenCalledWith(expect.any(Blob), 'en', 'token');
    expect(copilot.sendCopilotMessage).toHaveBeenCalledTimes(1);
    expect(copilot.sendCopilotMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: 'what is the onion price in Nashik', language: 'en', token: 'token',
    }));

    await waitFor(() => expect(speakText).toHaveBeenCalledTimes(1));
    expect(speakText).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
    expect(spokenText()[0]).toContain('1650 rupees per quintal');
    expect(screen.getByText('Speaking… tap the mic to interrupt')).toBeTruthy();

    await act(async () => { speech.controllers[0].finish(); });
    await waitFor(() => expect(screen.queryByText(/Speaking…/)).toBeNull());
    expect(screen.getByLabelText('Speak your question')).toBeTruthy();
    expect(media.tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true); // microphone released
  });

  it('the mic interrupts a spoken answer so the farmer can talk over it', async () => {
    render(<AskAiPage />);
    await tap('Speak your question');
    await tap('Stop recording');
    await waitFor(() => expect(speakText).toHaveBeenCalledTimes(1));

    await tap('Interrupt and speak');
    expect(speech.controllers[0].stop).toHaveBeenCalled();
    expect(screen.getByLabelText('Stop recording')).toBeTruthy();
    expect(screen.getByText('Listening… speak now')).toBeTruthy();
  });

  it('shows what is happening while the voice is converted, and Cancel drops the turn', async () => {
    let release;
    vi.mocked(api.transcribeAudio).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render(<AskAiPage />);
    await tap('Speak your question');
    await tap('Stop recording');

    expect(await screen.findByText('Converting your voice to text…')).toBeTruthy();
    await tap('Cancel');
    expect(screen.queryByText('Converting your voice to text…')).toBeNull();

    await act(async () => { release({ transcript: 'too late' }); });
    expect(copilot.sendCopilotMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('too late')).toBeNull();
    expect(screen.getByLabelText('Speak your question')).toBeTruthy();
  });

  it('tapping the mic twice while the browser asks for permission opens only one recording', async () => {
    media.uninstall();
    let grant;
    const track = { stop: vi.fn() };
    media = installFakeMedia({ getUserMedia: vi.fn(() => new Promise((resolve) => { grant = () => resolve({ getTracks: () => [track] }); })) });
    render(<AskAiPage />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Speak your question'));
      fireEvent.click(screen.getByLabelText('Speak your question'));
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => { grant(); });
    expect(await screen.findByLabelText('Stop recording')).toBeTruthy();
    expect(media.recorders).toHaveLength(1);
  });

  it('works in Hindi: the microphone, the transcript and the question all use the app language', async () => {
    language = 'hi';
    render(<AskAiPage />);
    await tap('बोलकर पूछें');
    expect(screen.getByText('सुन रहा हूँ… अब बोलिए')).toBeTruthy();
    await tap('रिकॉर्डिंग रोकें');

    await waitFor(() => expect(copilot.sendCopilotMessage).toHaveBeenCalledTimes(1));
    expect(api.transcribeAudio).toHaveBeenCalledWith(expect.any(Blob), 'hi', 'token');
    expect(copilot.sendCopilotMessage).toHaveBeenCalledWith(expect.objectContaining({ language: 'hi' }));
    await waitFor(() => expect(speakText).toHaveBeenCalledWith(expect.objectContaining({ language: 'hi' })));
  });

  it('a hidden tab closes the microphone and ends the hands-free conversation', async () => {
    render(<AskAiPage />);
    await flip('Hands-free conversation');
    expect(screen.getByText('Listening… speak now')).toBeTruthy();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    } finally {
      delete document.hidden;
    }
    expect(screen.getByRole('switch', { name: 'Hands-free conversation' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('Speak your question')).toBeTruthy();
    expect(media.tracks[0].stop).toHaveBeenCalled();
  });
});

describe('hands-free conversation', () => {
  it('one tap starts a spoken conversation that keeps listening after every answer', async () => {
    render(<AskAiPage />);
    const toggle = screen.getByRole('switch', { name: 'Hands-free conversation' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await act(async () => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(media.getUserMedia).toHaveBeenCalledTimes(1); // listening starts immediately

    await tap('Stop recording');
    await screen.findByText(/Onion in Nashik is 1650/);
    await waitFor(() => expect(speakText).toHaveBeenCalledTimes(1));
    await act(async () => { speech.controllers[0].finish(); });

    await waitFor(() => expect(media.getUserMedia).toHaveBeenCalledTimes(2)); // it listens again by itself
    expect(await screen.findByText('Listening… speak now')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await act(async () => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('Speak your question')).toBeTruthy();
    expect(media.tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it('typing a question takes over from the voice conversation', async () => {
    render(<AskAiPage />);
    await flip('Hands-free conversation');
    expect(screen.getByText('Listening… speak now')).toBeTruthy();

    await typeAndSend('tomato price');
    await screen.findByText(/Onion in Nashik is 1650/);
    expect(screen.getByRole('switch', { name: 'Hands-free conversation' }).getAttribute('aria-checked')).toBe('false');
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(api.transcribeAudio).not.toHaveBeenCalled();
    expect(copilot.sendCopilotMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'tomato price' }));
    expect(speakText).not.toHaveBeenCalled(); // read-aloud is off
  });

  it('if the answer cannot be fetched, the error is shown and hands-free switches itself off', async () => {
    vi.mocked(copilot.sendCopilotMessage).mockRejectedValue(new Error('The server is busy.'));
    render(<AskAiPage />);
    await flip('Hands-free conversation');
    await tap('Stop recording');

    expect((await screen.findByRole('alert')).textContent).toMatch(/The server is busy/);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hands-free conversation' }).getAttribute('aria-checked')).toBe('false'));
    expect(speakText).not.toHaveBeenCalled();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('cancelling from the status bar also ends hands-free', async () => {
    render(<AskAiPage />);
    await flip('Hands-free conversation');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(screen.getByRole('switch', { name: 'Hands-free conversation' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('Speak your question')).toBeTruthy();
    expect(media.tracks[0].stop).toHaveBeenCalled();
  });

  it('does not stay switched on when the microphone is refused', async () => {
    media.uninstall();
    media = installFakeMedia({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })) });
    render(<AskAiPage />);
    await flip('Hands-free conversation');
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hands-free conversation' }).getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByText(/Microphone permission was denied/)).toBeTruthy();
  });
});

describe('reading typed answers aloud', () => {
  it('speaks typed answers only while the switch is on, and remembers the choice', async () => {
    const { unmount } = render(<AskAiPage />);
    const toggle = screen.getByRole('switch', { name: 'Read answers aloud' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await typeAndSend('onion price');
    await screen.findByText(/Onion in Nashik is 1650/);
    expect(speakText).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(toggle); });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('fasalytics.readAnswersAloud')).toBe('1');

    await typeAndSend('and tomato?');
    await waitFor(() => expect(speakText).toHaveBeenCalledTimes(1));
    expect(spokenText()[0]).toContain('1650 rupees per quintal');
    expect(screen.getByText('Speaking… tap the mic to interrupt')).toBeTruthy();

    await act(async () => { speech.controllers[0].finish(); });
    await waitFor(() => expect(screen.queryByText(/Speaking…/)).toBeNull());

    unmount();
    render(<AskAiPage />);
    expect(screen.getByRole('switch', { name: 'Read answers aloud' }).getAttribute('aria-checked')).toBe('true');
  });

  it('switching it off silences an answer that is being read', async () => {
    localStorage.setItem('fasalytics.readAnswersAloud', '1');
    render(<AskAiPage />);
    await typeAndSend('onion price');
    await waitFor(() => expect(speakText).toHaveBeenCalledTimes(1));

    await flip('Read answers aloud');
    expect(speech.controllers[0].stop).toHaveBeenCalled();
    expect(localStorage.getItem('fasalytics.readAnswersAloud')).toBe('0');
  });

  it('each answer has a Listen button that speaks that answer', async () => {
    render(<AskAiPage />);
    await typeAndSend('onion price');
    await screen.findByText(/Onion in Nashik is 1650/);

    await tap('Listen');
    expect(speakText).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
    expect(spokenText()[0]).toContain('1650 rupees per quintal');
    await act(async () => { speech.controllers[0].finish(); });
    expect(await screen.findByLabelText('Listen')).toBeTruthy();
  });
});

describe('when voice is not available', () => {
  it('a missing speech service disables the mic and the voice switches, with a reason, and typing still works', async () => {
    vi.mocked(api.getAssistantCapabilities).mockResolvedValue({ speechToText: false, textToSpeech: false });
    render(<AskAiPage />);
    await waitFor(() => expect(screen.getByLabelText('Speak your question').disabled).toBe(true));
    expect(screen.getByText('Voice service is not switched on yet.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();

    await typeAndSend('onion');
    expect(await screen.findByText(/Onion in Nashik is 1650/)).toBeTruthy();
    expect(screen.queryByLabelText('Listen')).toBeNull();
  });

  it('without text-to-speech there is no read-aloud switch or Listen button, but talking still works', async () => {
    vi.mocked(api.getAssistantCapabilities).mockResolvedValue({ speechToText: true, textToSpeech: false });
    render(<AskAiPage />);
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Read answers aloud' })).toBeNull());
    expect(screen.getByRole('switch', { name: 'Hands-free conversation' })).toBeTruthy();
    expect(screen.getByLabelText('Speak your question').disabled).toBe(false);

    await typeAndSend('onion');
    await screen.findByText(/Onion in Nashik is 1650/);
    expect(screen.queryByLabelText('Listen')).toBeNull();
  });

  it('a browser that cannot record explains why, and typing still works', async () => {
    media.uninstall();
    render(<AskAiPage />);
    expect(screen.getByLabelText('Speak your question').disabled).toBe(true);
    expect(screen.getByText('Voice recording is not supported in this browser.')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Hands-free conversation' })).toBeNull();

    await typeAndSend('onion');
    expect(await screen.findByText(/Onion in Nashik is 1650/)).toBeTruthy();
  });

  it('a refused microphone permission is explained in the status bar', async () => {
    media.uninstall();
    media = installFakeMedia({ getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })) });
    render(<AskAiPage />);
    await tap('Speak your question');
    expect(await screen.findByText(/Microphone permission was denied/)).toBeTruthy();
    expect(api.transcribeAudio).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Speak your question').disabled).toBe(false);
  });
});

describe('the conversation view', () => {
  it('keeps the newest message in view by scrolling the conversation, not the whole page', async () => {
    const pageScroll = vi.fn();
    Element.prototype.scrollIntoView = pageScroll;
    const scrollTo = vi.fn();
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = scrollTo;
    try {
      render(<AskAiPage />);
      await typeAndSend('onion price');
      await screen.findByText(/Onion in Nashik is 1650/);
      expect(scrollTo).toHaveBeenCalled();
      expect(scrollTo.mock.calls.at(-1)[0]).toMatchObject({ behavior: 'smooth' });
      expect(scrollTo.mock.contexts.at(-1).getAttribute('role')).toBe('log');
      expect(pageScroll).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollTo = original;
    }
  });

  it('leaves the question box usable while an answer is on its way', async () => {
    let answer;
    vi.mocked(copilot.sendCopilotMessage).mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    render(<AskAiPage />);
    await typeAndSend('onion price');
    expect(screen.getByText('Consulting verified market data...')).toBeTruthy();
    expect(questionBox().disabled).toBe(false);

    // a second question cannot be sent until the first has been answered
    fireEvent.change(questionBox(), { target: { value: 'tomato price' } });
    expect(screen.getByLabelText('Send').disabled).toBe(true);
    await act(async () => { answer(reply()); });
    expect(await screen.findByText(/Onion in Nashik is 1650/)).toBeTruthy();
    expect(screen.getByLabelText('Send').disabled).toBe(false);
    expect(questionBox().value).toBe('tomato price'); // what the farmer was typing is kept
  });
});

describe('verified data on every answer', () => {
  it('shows a forecast as an estimate with its interval, not as a "confidence"', async () => {
    vi.mocked(copilot.sendCopilotMessage).mockResolvedValue(reply({
      intent: 'FORECAST',
      answer: 'The model expects about 1700 rupees per quintal on 10 October 2026. This is an estimate.',
      marketData: null,
      forecastData: {
        found: true,
        forecasts: [{
          forecastDate: '2026-10-10', predictedPrice: 1700, lowerBound: 1500, upperBound: 1900, intervalLevelPercent: 80, confidence: 91,
        }],
      },
    }));
    render(<AskAiPage />);
    await typeAndSend('forecast for onion');

    expect(await screen.findByText('₹1,700/quintal')).toBeTruthy();
    expect(screen.getByText('Interval: ₹1,500 - ₹1,900')).toBeTruthy();
    expect(screen.getByText('80% interval')).toBeTruthy();
    expect(screen.getByText('Forecast Date: 10 October 2026')).toBeTruthy();
    expect(screen.queryByText(/Confidence/i)).toBeNull();
    expect(screen.queryByText(/91/)).toBeNull();
  });

  it('shows a trend with the dates it covers and does not repeat the age warning twice', async () => {
    vi.mocked(copilot.sendCopilotMessage).mockResolvedValue(reply({
      intent: 'PRICE_HISTORY',
      answer: 'Onion prices rose about 3.5 percent over the last seven reports.',
      trendData: {
        found: true, startDate: '2026-10-01', endDate: '2026-10-07', oldestModal: 1400, latestModal: 1450, changePercent: 3.6, direction: 'up', isStale: true, ageDays: 2,
      },
    }));
    render(<AskAiPage />);
    await typeAndSend('how did onion change');

    expect(await screen.findByText('Recent trend')).toBeTruthy();
    expect(screen.getByText('₹1,400 → ₹1,450 (+3.6%)')).toBeTruthy();
    expect(screen.getByText('1 October 2026 – 7 October 2026')).toBeTruthy();
    expect(screen.queryByText(/Old report/)).toBeNull(); // the price card already carries the age
  });

  it('says when the farm profile filled in a missing crop, and when the AI was not available', async () => {
    vi.mocked(copilot.sendCopilotMessage).mockResolvedValue(reply({
      assumptions: ['commodity_from_profile'],
      groqPowered: false,
      aiError: 'GROQ_RATE_LIMITED',
    }));
    render(<AskAiPage />);
    await typeAndSend('price today');

    expect(await screen.findByText(/I used your farm profile/)).toBeTruthy();
    expect(screen.getByText(/The AI assistant is unavailable right now/)).toBeTruthy();
    expect(screen.getByText('Verified data')).toBeTruthy();
    expect(screen.queryByText('AI answer')).toBeNull();
  });

  it('a suggestion sends that exact question, once', async () => {
    render(<AskAiPage />);
    fireEvent.click(screen.getByText(t('en', 'copilot.suggest1')));
    await screen.findByText(/Onion in Nashik is 1650/);
    expect(copilot.sendCopilotMessage).toHaveBeenCalledTimes(1);
    expect(copilot.sendCopilotMessage).toHaveBeenCalledWith(expect.objectContaining({ message: t('en', 'copilot.suggest1') }));
  });

  it('keeps the crop and market for the next question, and sends the recent turns', async () => {
    render(<AskAiPage />);
    await typeAndSend('onion price in Nashik');
    await screen.findByText(/Onion in Nashik is 1650/);
    await typeAndSend('and the trend?');
    await waitFor(() => expect(copilot.sendCopilotMessage).toHaveBeenCalledTimes(2));

    const second = vi.mocked(copilot.sendCopilotMessage).mock.calls[1][0];
    expect(second.context).toEqual({ commodity: 'Onion', mandi: 'Nashik APMC' });
    expect(second.conversationHistory).toEqual([
      { role: 'user', content: 'onion price in Nashik' },
      { role: 'assistant', content: expect.stringContaining('1650 rupees per quintal') },
    ]);
  });

  it('never sends history entries the server would reject', async () => {
    vi.mocked(copilot.sendCopilotMessage).mockResolvedValue(reply({ answer: `Long answer ${'x'.repeat(900)}` }));
    render(<AskAiPage />);
    await typeAndSend('first');
    await screen.findByText(/Long answer/);
    await typeAndSend('second');
    await waitFor(() => expect(copilot.sendCopilotMessage).toHaveBeenCalledTimes(2));

    const { conversationHistory } = vi.mocked(copilot.sendCopilotMessage).mock.calls[1][0];
    expect(conversationHistory.every((entry) => entry.content.length <= 500)).toBe(true);
  });
});
