/**
 * Reusable voice building blocks (Sarvam speech-to-text / text-to-speech via the backend).
 * Nothing here knows about a particular chat: the Phase 7 Copilot can import these directly.
 *
 *   <VoiceInputButton language onTranscript getToken? disabled? />   mic -> text
 *   <SpeakButton text language getToken? disabled? />                text -> audio
 *   transcribeAudio / synthesizeSpeech / getAssistantCapabilities    backend client
 *   useVoiceRecorder                                                 raw recorder hook
 */
export { default as VoiceInputButton } from '../components/VoiceInputButton';
export { default as SpeakButton } from '../components/SpeakButton';
export { default as useVoiceRecorder } from '../hooks/useVoiceRecorder';
export { getAssistantCapabilities, synthesizeSpeech, transcribeAudio } from '../services/assistantApi';
export { detectRecordingSupport, serviceErrorKey, recordingErrorKey, toSpokenText } from '../utils/speech';
