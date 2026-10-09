import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import CopilotAnswerCards from '../components/CopilotAnswerCards';
import SpeakButton from '../components/SpeakButton';
import useVoiceConversation from '../hooks/useVoiceConversation';
import { getAssistantCapabilities } from '../services/assistantApi';
import { getCopilotCapabilities, sendCopilotMessage } from '../services/copilotService';
import { t } from '../i18n/strings';

const CHIPS = ['onion', 'tomato', 'wheat'];
const MAX_MESSAGE_CHARS = 500;
const HISTORY_TURNS = 6;
const READ_ALOUD_KEY = 'fasalytics.readAnswersAloud';
const PROFILE_ASSUMPTIONS = ['commodity_from_profile', 'place_from_profile'];

const clockTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function loadReadAloud() {
  try {
    return localStorage.getItem(READ_ALOUD_KEY) === '1';
  } catch {
    return false;
  }
}

function saveReadAloud(on) {
  try {
    localStorage.setItem(READ_ALOUD_KEY, on ? '1' : '0');
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

function Switch({ checked, onChange, disabled, icon, label, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title || label}
      disabled={disabled}
      onClick={onChange}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm font-medium transition-all active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 disabled:cursor-not-allowed ${
        checked
          ? 'bg-secondary text-on-secondary border-secondary'
          : 'bg-surface-container-low text-on-surface-variant border-outline-variant/40'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

/** The main microphone: one tap to talk, tap again to finish, cancel while it works, interrupt while it speaks. */
function MicButton({ language, phase, problem, disabled, onStart, onStop, onCancel }) {
  const listening = phase === 'listening';
  const working = phase === 'transcribing' || phase === 'thinking';
  const speaking = phase === 'speaking';
  const label = listening ? t(language, 'voice.stop')
    : working ? t(language, 'common.cancel')
      : speaking ? t(language, 'voice.interrupt')
        : t(language, 'voice.start');
  const icon = problem ? 'mic_off' : listening ? 'stop' : working ? 'progress_activity' : speaking ? 'graphic_eq' : 'mic';
  const tone = listening ? 'bg-primary text-on-primary animate-pulse'
    : working ? 'bg-surface-container-high text-on-surface-variant'
      : speaking ? 'bg-secondary text-on-secondary'
        : 'bg-secondary-container text-on-secondary-container';
  return (
    <button
      type="button"
      aria-label={label}
      title={problem ? t(language, `voice.error.${problem}`) : label}
      disabled={disabled}
      onClick={listening ? onStop : working ? onCancel : onStart}
      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-md active:scale-95 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 ${tone}`}
    >
      <span
        className={`material-symbols-outlined text-[24px] ${working ? 'animate-spin' : ''}`}
        aria-hidden="true"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
    </button>
  );
}

function MessageBubble({ message: m, language, showListen }) {
  const isUser = m.sender === 'user';
  const usedProfile = m.assumptions?.some((a) => PROFILE_ASSUMPTIONS.includes(a));
  const aiUnavailable = !isUser && !m.groqPowered && Boolean(m.aiError);
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[90%] md:max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
          isUser
            ? 'bg-secondary text-on-secondary rounded-br-none'
            : 'bg-surface-container-lowest text-on-surface border border-outline-variant/30 rounded-bl-none'
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-outline-variant/20 text-xs font-bold text-on-surface-variant">
            <span className="material-symbols-outlined text-[16px] text-secondary" aria-hidden="true">smart_toy</span>
            <span>{t(language, 'ai.aiName')}</span>
            {m.groqPowered ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container font-semibold ml-auto">
                {t(language, 'ai.aiBadge')}
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-semibold ml-auto">
                {t(language, 'ai.verifiedBadge')}
              </span>
            )}
          </div>
        )}

        <p className="text-body-md whitespace-pre-line leading-relaxed" lang={m.language || language}>{m.text}</p>

        {!isUser && <CopilotAnswerCards message={m} language={language} />}

        {usedProfile && (
          <p className="mt-2 flex items-start gap-1 text-[11px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">person</span>
            {t(language, 'copilot.assumedProfile')}
          </p>
        )}
        {aiUnavailable && (
          <p className="mt-2 flex items-start gap-1 text-[11px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">info</span>
            {t(language, 'copilot.aiUnavailable')}
          </p>
        )}

        <div className="mt-2.5 pt-1.5 border-t border-outline-variant/20 flex items-center justify-between">
          {!isUser && showListen ? <SpeakButton text={m.text} language={m.language || language} /> : <span />}
          <span className={`text-[10px] ${isUser ? 'text-on-secondary/75' : 'text-on-surface-variant/75'}`}>{m.time}</span>
        </div>
      </div>
    </div>
  );
}

export default function AskAiPage() {
  const { language, user } = useAuth();

  const [capabilities, setCapabilities] = useState(null);
  const [voiceCaps, setVoiceCaps] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [readAloud, setReadAloud] = useState(loadReadAloud);
  const [handsFree, setHandsFree] = useState(false);

  // The conversation lives in refs too, so a voice turn (which finishes long after the render
  // that started it) always sees the latest history and context.
  const messagesRef = useRef([]);
  const contextRef = useRef({});
  const busyRef = useRef(false);
  const idRef = useRef(0);
  const logRef = useRef(null);

  const getToken = useCallback(async () => (user?.getIdToken ? user.getIdToken() : null), [user]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await getCopilotCapabilities();
        if (active && res?.capabilities) setCapabilities(res.capabilities);
      } catch {
        // The header badge keeps its neutral state.
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const caps = await getAssistantCapabilities(await getToken());
        if (active && caps) setVoiceCaps(caps);
      } catch {
        // Voice stays optimistic; a real problem is explained when it is used.
      }
    })();
    return () => { active = false; };
  }, [getToken]);

  // Keep the newest message in view by scrolling the conversation itself. (scrollIntoView would also
  // scroll the whole page, pushing the app header out of sight.)
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (messages.length === 0 && !submitting) {
      log.scrollTop = 0;
      return;
    }
    if (typeof log.scrollTo === 'function') log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    else log.scrollTop = log.scrollHeight;
  }, [messages, submitting]);

  const pushMessage = useCallback((message) => {
    idRef.current += 1;
    messagesRef.current = [...messagesRef.current, { id: idRef.current, time: clockTime(), ...message }];
    setMessages(messagesRef.current);
  }, []);

  /** One question to the Copilot. Resolves to the answer text, or null when it could not be answered. */
  const ask = useCallback(async (rawQuery) => {
    const query = String(rawQuery ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
    if (!query || busyRef.current) return null;
    busyRef.current = true;
    setSubmitting(true);
    setError(null);

    const history = messagesRef.current.slice(-HISTORY_TURNS).map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: String(m.text).slice(0, 500),
    }));
    pushMessage({ sender: 'user', text: query });

    try {
      const token = await getToken();
      const res = await sendCopilotMessage({
        message: query,
        language,
        context: contextRef.current,
        conversationHistory: history,
        token,
      });
      if (res?.status !== 'ok' || !res.answer) throw new Error(res?.message || t(language, 'copilot.error'));

      pushMessage({
        sender: 'ai',
        text: res.answer,
        language: res.language,
        intent: res.intent,
        marketData: res.marketData,
        trendData: res.trendData,
        forecastData: res.forecastData,
        sources: res.sources || [],
        assumptions: res.assumptions || [],
        groqPowered: Boolean(res.groqPowered),
        aiError: res.aiError || null,
      });
      // Follow-up questions ("and tomato?", "what about Pune?") keep the crop and market in view.
      if (res.entity?.commodity) contextRef.current = { ...contextRef.current, commodity: res.entity.commodity };
      if (res.entity?.mandi) contextRef.current = { ...contextRef.current, mandi: res.entity.mandi };
      return res.answer;
    } catch (err) {
      setError(err?.message || t(language, 'copilot.error'));
      return null;
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }, [language, getToken, pushMessage]);

  const voice = useVoiceConversation({
    language,
    getToken,
    sendUtterance: ask,
    handsFree,
    onHandsFreeStop: () => setHandsFree(false),
  });

  const recordingProblem = !voice.supported
    ? (voice.reason === 'insecure' ? 'insecure' : 'unsupported')
    : voiceCaps?.speechToText === false ? 'unavailable' : null;
  const speechAvailable = voiceCaps?.textToSpeech !== false;

  const send = async (text) => {
    const query = String(text ?? inputText).trim();
    if (!query || busyRef.current) return;
    setInputText('');
    // Typing takes over from a voice conversation.
    if (voice.phase !== 'idle') voice.cancel();
    if (handsFree) setHandsFree(false);
    voice.clearError();
    const reply = await ask(query);
    if (reply && readAloud && speechAvailable) voice.speakReply(reply);
  };

  // A second tap while the browser is still asking for the microphone must not start another recording.
  const startingRef = useRef(false);
  const startVoice = async () => {
    if (startingRef.current) return true;
    startingRef.current = true;
    setError(null);
    try {
      return await voice.start();
    } finally {
      startingRef.current = false;
    }
  };

  // Stopping the voice turn by hand also ends the hands-free loop (otherwise it would look "on" while idle).
  const cancelVoice = () => {
    setHandsFree(false);
    voice.cancel();
  };

  const toggleHandsFree = async () => {
    if (handsFree) {
      cancelVoice();
      return;
    }
    setHandsFree(true);
    if (voice.phase !== 'listening') {
      const started = await startVoice();
      if (!started) setHandsFree(false);
    }
  };

  const toggleReadAloud = () => {
    const next = !readAloud;
    setReadAloud(next);
    saveReadAloud(next);
    if (!next && voice.phase === 'speaking') voice.cancel();
  };

  const phase = voice.phase;
  const statusText = phase === 'listening'
    ? t(language, voice.heardSpeech ? 'voice.status.hearing' : 'voice.status.listening')
    : phase === 'transcribing' ? t(language, 'voice.transcribing')
      : phase === 'speaking' ? t(language, 'voice.status.speaking')
        : null;
  const statusIcon = phase === 'listening' ? 'mic' : phase === 'speaking' ? 'graphic_eq' : 'progress_activity';
  // "chatFailed" is already shown as the chat error itself.
  const voiceMessage = voice.error && voice.error !== 'chatFailed' ? t(language, `voice.error.${voice.error}`) : null;
  const micDisabled = Boolean(recordingProblem) || (submitting && phase === 'idle');

  const suggestions = [1, 2, 3, 4, 5].map((n) => t(language, `copilot.suggest${n}`));

  return (
    <div className="copilot-page flex flex-col w-full min-h-0">
      <header className="flex items-center justify-between py-3 px-4 bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/30 mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold shadow-sm">
            <span className="material-symbols-outlined text-[24px]" aria-hidden="true">smart_toy</span>
          </div>
          <div>
            <h1 className="text-title-md font-bold text-on-surface leading-tight">
              {t(language, 'copilot.title')}
            </h1>
            <p className="text-body-sm text-on-surface-variant line-clamp-1">
              {t(language, 'copilot.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {capabilities?.groqConfigured ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-secondary-container text-on-secondary-container border border-secondary/30">
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
              {t(language, 'copilot.badge.groq')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-surface-container-high text-on-surface-variant">
              <span className="w-2 h-2 rounded-full bg-primary/70" />
              {t(language, 'copilot.badge.deterministic')}
            </span>
          )}
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-surface-container-low text-on-surface-variant border border-outline-variant/30">
            <span className="material-symbols-outlined text-[14px] text-secondary" aria-hidden="true">verified</span>
            {t(language, 'copilot.badge.verified')}
          </span>
        </div>
      </header>

      <div
        ref={logRef}
        className="copilot-log flex-1 min-h-0 overflow-y-auto px-1 space-y-4 pb-4"
        role="log"
        aria-live="polite"
        aria-label={t(language, 'ai.logLabel')}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-full text-center py-6 px-4">
            <div className="w-16 h-16 rounded-2xl bg-secondary-container/50 text-secondary flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-[36px]" aria-hidden="true">psychology</span>
            </div>
            <h2 className="text-headline-sm font-bold text-on-surface mb-2">
              {t(language, 'copilot.welcome.title')}
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-lg mb-3 leading-relaxed">
              {t(language, 'ai.welcome')}
            </p>
            {!recordingProblem && (
              <p className="flex items-center gap-1 text-body-sm text-on-surface-variant mb-5">
                <span className="material-symbols-outlined text-[18px] text-secondary" aria-hidden="true">mic</span>
                {t(language, 'voice.hint')}
              </p>
            )}

            <div className="flex flex-wrap gap-2 justify-center max-w-xl">
              {suggestions.map((text, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => send(text)}
                  className="py-2 px-3.5 rounded-xl bg-surface-container-low hover:bg-secondary-container hover:text-on-secondary-container text-on-surface text-body-sm font-medium border border-outline-variant/30 transition-all text-left shadow-sm active:scale-95"
                >
                  {text}
                </button>
              ))}
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => send(t(language, `ai.chip.${chip}`))}
                  className="py-2 px-3.5 rounded-xl bg-surface-container-lowest text-primary hover:bg-secondary-container hover:text-on-secondary-container text-body-sm font-medium border border-primary/20 transition-all shadow-sm active:scale-95"
                >
                  {t(language, `ai.chip.${chip}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} message={m} language={language} showListen={speechAvailable} />
          ))
        )}

        {submitting && (
          <div
            role="status"
            className="flex items-center gap-2 text-on-surface-variant text-body-sm px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl w-fit animate-pulse"
          >
            <span className="material-symbols-outlined text-secondary animate-spin text-[18px]" aria-hidden="true">progress_activity</span>
            <span>{t(language, 'copilot.thinking')}</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-error-container text-on-error-container rounded-xl text-body-sm flex items-center justify-between" role="alert">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">error</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs font-bold underline ml-2"
            >
              {t(language, 'profile.dismiss')}
            </button>
          </div>
        )}
      </div>

      <div className="copilot-composer pt-2 shrink-0 border-t border-outline-variant/20">
        {/* What the voice conversation is doing right now (always present so screen readers announce changes). */}
        <div role="status" aria-live="polite">
          {(statusText || voiceMessage) && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl bg-secondary-container/60 px-4 py-2 text-body-sm text-on-secondary-container">
              <span className="flex items-center gap-2">
                <span
                  className={`material-symbols-outlined text-[18px] ${phase === 'listening' ? 'animate-pulse' : phase === 'transcribing' ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                >
                  {statusText ? statusIcon : 'info'}
                </span>
                {statusText || voiceMessage}
              </span>
              {statusText && (
                <button type="button" onClick={cancelVoice} className="text-xs font-bold underline shrink-0">
                  {phase === 'speaking' ? t(language, 'voice.stopSpeaking') : t(language, 'common.cancel')}
                </button>
              )}
            </div>
          )}
        </div>

        {(!recordingProblem || speechAvailable) && (
          <div className="copilot-voice-options mb-2 flex flex-wrap gap-2">
            {speechAvailable && (
              <Switch
                checked={readAloud}
                onChange={toggleReadAloud}
                icon="volume_up"
                label={t(language, 'voice.readAloud')}
              />
            )}
            {!recordingProblem && (
              <Switch
                checked={handsFree}
                onChange={toggleHandsFree}
                icon="hearing"
                label={t(language, 'voice.handsFree')}
                title={t(language, 'voice.handsFreeHint')}
              />
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-center gap-2"
        >
          <MicButton
            language={language}
            phase={phase}
            problem={recordingProblem}
            disabled={micDisabled}
            onStart={startVoice}
            onStop={voice.stopListening}
            onCancel={cancelVoice}
          />

          <div className="flex-1 min-w-0 relative">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
              aria-label={t(language, 'ai.placeholder')}
              placeholder={t(language, 'copilot.inputPlaceholder')}
              className="w-full h-12 pl-3 pr-3 rounded-2xl bg-surface-container-low border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-secondary focus:border-secondary text-base transition-all shadow-inner"
            />
            {inputText.length > 0 && (
              <span className="absolute right-3 bottom-0 text-[9px] text-on-surface-variant font-mono">
                {inputText.length}/{MAX_MESSAGE_CHARS}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || submitting}
            className="w-12 h-12 rounded-2xl bg-secondary text-on-secondary flex items-center justify-center shadow-md active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all shrink-0"
            aria-label={t(language, 'copilot.send')}
          >
            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">send</span>
          </button>
        </form>

        <p className="text-[10px] text-center text-on-surface-variant/80 mt-1.5">
          {t(language, 'copilot.disclaimer')}
        </p>
        {recordingProblem ? (
          <p className="text-[10px] text-center text-on-surface-variant/80 mt-0.5">
            {t(language, `voice.error.${recordingProblem}`)}
          </p>
        ) : (
          <p className="text-[10px] text-center text-on-surface-variant/80 mt-0.5">
            {t(language, 'voice.privacy')}
          </p>
        )}
      </div>
    </div>
  );
}
