/**
 * Reusable voice building blocks (Sarvam speech-to-text / text-to-speech via the backend).
 * Nothing here knows about a particular chat: any screen can import these directly.
 *
 *   useVoiceConversation                                             a full spoken conversation loop
 *   <VoiceInputButton language onTranscript getToken? disabled? />   mic -> text (dictation)
 *   <SpeakButton text language getToken? disabled? />                text -> audio
 *   speakText / unlockAudio / stopAudio                              chunked speech playback
 *   transcribeAudio / synthesizeSpeech / getAssistantCapabilities    backend client
 *   useVoiceRecorder                                                 raw recorder hook
 */
export { default as VoiceInputButton } from '../components/VoiceInputButton';
export { default as SpeakButton } from '../components/SpeakButton';
export { default as useVoiceRecorder } from '../hooks/useVoiceRecorder';
export { default as useVoiceConversation } from '../hooks/useVoiceConversation';
export { getAssistantCapabilities, synthesizeSpeech, transcribeAudio } from '../services/assistantApi';
export { detectRecordingSupport, serviceErrorKey, recordingErrorKey, toSpokenText } from '../utils/speech';
export { speakText } from './speak';
export { stopAudio, unlockAudio } from './audioPlayer';
