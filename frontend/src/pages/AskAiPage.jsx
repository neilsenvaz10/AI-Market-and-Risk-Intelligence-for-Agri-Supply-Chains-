import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SpeakButton from '../components/SpeakButton';
import VoiceInputButton from '../components/VoiceInputButton';
import { getAssistantCapabilities, sendChatMessage } from '../services/assistantApi';
import { t } from '../i18n/strings';

const CHIPS = ['onion', 'tomato', 'wheat'];
const MAX_MESSAGE_CHARS = 500;

/** Verified market data returned with an answer: mandi, price, unit and the reporting date. */
function Sources({ sources, language }) {
  if (!sources?.length) return null;
  return (
    <div className="bg-surface-container-low p-3 rounded-xl flex flex-col gap-1">
      <span className="text-body-sm font-bold text-on-surface-variant uppercase tracking-wide">{t(language, 'ai.sourcesTitle')}</span>
      <ul className="flex flex-col gap-1">
        {sources.map((s) => (
          <li key={`${s.mandi}-${s.date}`} className="text-body-sm text-on-surface flex flex-wrap justify-between gap-x-3">
            <span>{s.mandi} ({s.district})</span>
            <span className="font-semibold">₹{s.modal} / {t(language, 'ai.quintal')} · {t(language, 'ai.reportedOn', { date: s.date })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AskAiPage() {
  const { language, user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [caps, setCaps] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getAssistantCapabilities(await user.getIdToken());
        if (active) setCaps(data);
      } catch {
        if (active) setCaps({ chat: false, speechToText: false, textToSpeech: false });
      }
    })();
    return () => { active = false; };
  }, [user]);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

  const send = async (text) => {
    const message = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!message || sending) return;
    const history = messages.slice(-6).map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text }));
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, sender: 'user', text: message }]);
    setInputText('');
    setError(null);
    setSending(true);
    try {
      const data = await sendChatMessage({ message, language, history }, await user.getIdToken());
      setMessages((prev) => [...prev, {
        id: `a${Date.now()}`, sender: 'ai', text: data.reply, sources: data.sources, aiUsed: data.aiUsed,
      }]);
    } catch {
      setError(t(language, 'ai.error'));
    } finally {
      setSending(false);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    send(inputText);
  };

  return (
    <div className="flex flex-col w-full pb-32">
      <div className="flex items-center justify-between py-2 px-1 mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${caps?.chat ? 'bg-secondary animate-pulse' : 'bg-outline'}`} aria-hidden="true" />
          <span className="text-body-sm font-semibold text-on-surface-variant uppercase tracking-wider">
            Fasalytics AI • {caps?.chat ? t(language, 'ai.statusLabel') : t(language, 'ai.statusLimited')}
          </span>
        </div>
      </div>

      <div role="log" aria-live="polite" aria-label={t(language, 'ai.logLabel')} className="flex flex-col gap-4 w-full">
        <div className="flex flex-col items-start gap-1 w-full pr-8">
          <div className="bg-surface-container-lowest p-4 rounded-xl shadow-[0_1px_8px_rgba(0,38,13,0.06)] w-full">
            <p className="text-body-md text-on-surface">{t(language, 'ai.welcome')}</p>
          </div>
        </div>

        {messages.map((msg) => (msg.sender === 'user' ? (
          <div key={msg.id} className="flex flex-col items-end gap-1 w-full pl-8">
            <div className="bg-primary text-on-primary p-4 rounded-xl rounded-br-xs shadow-sm max-w-[90%]">
              <p className="text-body-lg font-label-lg break-words">{msg.text}</p>
            </div>
          </div>
        ) : (
          <div key={msg.id} className="flex flex-col items-start gap-1 w-full pr-8">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-secondary-container flex items-center justify-center" aria-hidden="true">
                <span className="material-symbols-outlined text-on-secondary-container text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
              </div>
              <span className="text-body-sm font-bold text-secondary">{t(language, 'ai.aiName')}</span>
              <span className="px-2 py-0.5 bg-secondary-container text-on-secondary-container text-[11px] font-bold rounded-full">
                {msg.aiUsed ? t(language, 'ai.aiBadge') : t(language, 'ai.verifiedBadge')}
              </span>
            </div>
            <div className="bg-surface-container-lowest p-4 rounded-xl shadow-[0_1px_8px_rgba(0,38,13,0.06)] w-full flex flex-col gap-3">
              <p className="text-body-md text-on-surface whitespace-pre-line break-words">{msg.text}</p>
              <Sources sources={msg.sources} language={language} />
              <div className="flex items-center justify-between">
                <SpeakButton text={msg.text} language={language} disabled={caps ? !caps.textToSpeech : false} />
                {caps?.textToSpeech && <span className="text-[11px] text-on-surface-variant">{t(language, 'voice.privacy')}</span>}
              </div>
            </div>
          </div>
        )))}
        {sending && <p className="text-body-sm text-on-surface-variant px-1" role="status">{t(language, 'ai.thinking')}</p>}
        {error && <p className="text-body-sm text-error px-1" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 overflow-x-auto py-3 mt-4">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => send(t(language, `ai.chip.${chip}`))}
            disabled={sending}
            className="whitespace-nowrap px-3.5 py-2 bg-surface-container-lowest text-primary rounded-full text-body-sm font-medium shadow-sm hover:bg-secondary-container transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            {t(language, `ai.chip.${chip}`)}
          </button>
        ))}
      </div>

      <div className="fixed bottom-20 inset-x-0 z-40 px-gutter pb-2 bg-surface/95 backdrop-blur-xl">
        <form onSubmit={handleSend} className="flex flex-col gap-2 max-w-screen-xl mx-auto">
          <div className="flex items-center gap-2 bg-surface-container-lowest p-2 rounded-xl shadow-[0_-1px_8px_rgba(0,38,13,0.06)]">
            <VoiceInputButton
              language={language}
              disabled={caps ? !caps.speechToText : false}
              onTranscript={(text) => setInputText((prev) => `${prev} ${text}`.trim().slice(0, MAX_MESSAGE_CHARS))}
            />
            <input
              type="text"
              value={inputText}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(e) => setInputText(e.target.value)}
              aria-label={t(language, 'ai.placeholder')}
              className="flex-grow bg-transparent text-body-md text-on-surface placeholder:text-on-surface-variant outline-none px-2"
              placeholder={t(language, 'ai.placeholder')}
            />
            <button
              type="submit"
              disabled={sending || !inputText.trim()}
              aria-label={t(language, 'ai.send')}
              className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary shrink-0 active:scale-95 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">send</span>
            </button>
          </div>
          <div className="text-center">
            <span className="text-[11px] text-on-surface-variant font-medium">{t(language, 'ai.footerVoice')}</span>
          </div>
        </form>
      </div>
    </div>
  );
}
