/** Client for the backend voice + chat assistant (Sarvam AI runs server-side). */
import { apiRequest } from './api';

export const getAssistantCapabilities = (token) => apiRequest('/api/assistant/capabilities', { token }).then((r) => r.data);

/** @param {Blob} audio a recording (audio/webm, audio/mp4, ...) */
export const transcribeAudio = (audio, language, token) =>
  apiRequest(`/api/assistant/transcribe?language=${encodeURIComponent(language)}`, { method: 'POST', body: audio, token }).then((r) => r.data);

export const synthesizeSpeech = (text, language, token) =>
  apiRequest('/api/assistant/speak', { method: 'POST', body: { text, language }, token }).then((r) => r.data);

export const sendChatMessage = ({ message, language, history }, token) =>
  apiRequest('/api/assistant/chat', { method: 'POST', body: { message, language, history }, token }).then((r) => r.data);
