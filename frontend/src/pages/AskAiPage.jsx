import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';
import { sendCopilotMessage, getCopilotCapabilities } from '../services/copilotService';
import { auth } from '../config/firebase';

export default function AskAiPage() {
  const { language } = useAuth();

  const [capabilities, setCapabilities] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [lastContext, setLastContext] = useState({});

  const chatBottomRef = useRef(null);

  // Fetch capabilities on mount
  useEffect(() => {
    let active = true;
    getCopilotCapabilities()
      .then((res) => {
        if (active && res?.capabilities) setCapabilities(res.capabilities);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    if (typeof chatBottomRef.current?.scrollIntoView === 'function') { chatBottomRef.current.scrollIntoView({ behavior: 'smooth' }); }
  }, [messages, submitting]);

  const suggestions = [
    { key: 'copilot.suggest1', text: t(language, 'copilot.suggest1') },
    { key: 'copilot.suggest2', text: t(language, 'copilot.suggest2') },
    { key: 'copilot.suggest3', text: t(language, 'copilot.suggest3') },
    { key: 'copilot.suggest4', text: t(language, 'copilot.suggest4') },
    { key: 'copilot.suggest5', text: t(language, 'copilot.suggest5') },
  ];

  const handleSend = async (textToSend) => {
    const query = String(textToSend || inputText).trim();
    if (!query || submitting) return;

    setError(null);
    setInputText('');

    const userMessage = {
      id: Date.now(),
      sender: 'user',
      text: query,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setSubmitting(true);

    try {
      let token = null;
      if (auth?.currentUser) {
        token = await auth.currentUser.getIdToken().catch(() => null);
      }

      // Format conversation history for backend context
      const conversationHistory = messages.slice(-6).map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      const res = await sendCopilotMessage({
        message: query,
        language,
        context: lastContext,
        conversationHistory,
        token,
      });

      if (res?.status === 'ok') {
        const aiMessage = {
          id: Date.now() + 1,
          sender: 'ai',
          text: res.answer,
          intent: res.intent,
          marketData: res.marketData,
          trendData: res.trendData,
          forecastData: res.forecastData,
          sources: res.sources || [],
          limitations: res.limitations || [],
          groqPowered: res.groqPowered,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        if (res.entity?.commodity || res.entity?.mandi) {
          setLastContext({
            commodity: res.entity.commodity || lastContext.commodity,
            mandi: res.entity.mandi || lastContext.mandi,
          });
        }

        setMessages((prev) => [...prev, aiMessage]);
      } else {
        throw new Error(res?.message || t(language, 'copilot.error'));
      }
    } catch (err) {
      setError(err.message || t(language, 'copilot.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-4xl mx-auto px-4 py-2">
      {/* Header Bar */}
      <header className="flex items-center justify-between py-3 px-4 bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/30 mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold shadow-sm">
            <span className="material-symbols-outlined text-[24px]">smart_toy</span>
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

        {/* Engine status indicator */}
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
            <span className="material-symbols-outlined text-[14px] text-secondary">verified</span>
            {t(language, 'copilot.badge.verified')}
          </span>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-1 space-y-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8 px-4">
            <div className="w-16 h-16 rounded-2xl bg-secondary-container/50 text-secondary flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-[36px]">psychology</span>
            </div>
            <h2 className="text-headline-sm font-bold text-on-surface mb-2">
              {t(language, 'copilot.welcome.title')}
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-md mb-6">
              {t(language, 'copilot.welcome.prompt')}
            </p>

            {/* Suggestions Chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-xl">
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSend(s.text)}
                  className="py-2 px-3.5 rounded-xl bg-surface-container-low hover:bg-secondary-container hover:text-on-secondary-container text-on-surface text-body-sm font-medium border border-outline-variant/30 transition-all text-left shadow-sm active:scale-95"
                >
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] md:max-w-[78%] rounded-2xl px-4 py-3 shadow-sm ${
                  m.sender === 'user'
                    ? 'bg-secondary text-on-secondary rounded-br-none'
                    : 'bg-surface-container-lowest text-on-surface border border-outline-variant/30 rounded-bl-none'
                }`}
              >
                {/* AI Header info */}
                {m.sender === 'ai' && (
                  <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-outline-variant/20 text-xs font-bold text-on-surface-variant">
                    <span className="material-symbols-outlined text-[16px] text-secondary">smart_toy</span>
                    <span>{t(language, 'copilot.title')}</span>
                    {m.groqPowered ? (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-secondary-container text-on-secondary-container font-semibold ml-auto">
                        Groq AI
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-container-high text-on-surface-variant font-semibold ml-auto">
                        Verified Data Engine
                      </span>
                    )}
                  </div>
                )}

                {/* Message Text */}
                <p className="text-body-md whitespace-pre-line leading-relaxed">{m.text}</p>

                {/* Structured Market Card */}
                {m.marketData && (
                  <div className="mt-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs flex flex-col gap-1.5">
                    <div className="flex items-center justify-between font-bold text-on-surface">
                      <span>{m.marketData.commodityName} @ {m.marketData.mandiName}</span>
                      <span className="text-secondary font-black text-sm">
                        ₹{m.marketData.modalPrice}/quintal
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-on-surface-variant">
                      <span>{t(language, 'copilot.priceRange')}: ₹{m.marketData.minPrice} - ₹{m.marketData.maxPrice}</span>
                      <span>{t(language, 'copilot.observationDate')}: {m.marketData.priceDate}</span>
                    </div>
                  </div>
                )}

                {/* Structured Forecast Card */}
                {m.forecastData && m.forecastData.forecasts?.[0] && (
                  <div className="mt-3 p-3 rounded-xl bg-secondary-container/40 border border-secondary/30 text-xs flex flex-col gap-1.5">
                    <div className="flex items-center justify-between font-bold text-on-surface">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px] text-secondary">trending_up</span>
                        {t(language, 'copilot.badge.forecast')}
                      </span>
                      <span className="text-secondary font-black text-sm">
                        ₹{m.forecastData.forecasts[0].predictedPrice}/quintal
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-on-surface-variant">
                      <span>{t(language, 'copilot.predictionInterval')}: ₹{m.forecastData.forecasts[0].lowerBound} - ₹{m.forecastData.forecasts[0].upperBound}</span>
                      <span className="font-bold text-secondary">{m.forecastData.forecasts[0].confidence}% {t(language, 'copilot.confidence')}</span>
                    </div>
                    <div className="text-[10px] text-on-surface-variant/80 border-t border-outline-variant/20 pt-1">
                      {t(language, 'copilot.forecastDate')}: {m.forecastData.forecasts[0].forecastDate}
                    </div>
                  </div>
                )}

                {/* Sources & Limitations */}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 text-[10px] text-on-surface-variant flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold">{t(language, 'copilot.sources')}:</span>
                    {m.sources.map((s, idx) => (
                      <span key={idx} className="bg-surface-container-high px-1.5 py-0.5 rounded">
                        {s.source || s.type}
                      </span>
                    ))}
                  </div>
                )}

                <span
                  className={`block text-[10px] mt-1 text-right ${
                    m.sender === 'user' ? 'text-on-secondary/75' : 'text-on-surface-variant/75'
                  }`}
                >
                  {m.time}
                </span>
              </div>
            </div>
          ))
        )}

        {/* Thinking Indicator */}
        {submitting && (
          <div className="flex items-center gap-2 text-on-surface-variant text-body-sm px-4 py-2 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl w-fit animate-pulse">
            <span className="material-symbols-outlined text-secondary animate-spin text-[18px]">progress_activity</span>
            <span>{t(language, 'copilot.thinking')}</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-3 bg-error-container text-on-error-container rounded-xl text-body-sm flex items-center justify-between" role="alert">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs font-bold underline ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Input Area */}
      <div className="pt-2 shrink-0 border-t border-outline-variant/20">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <div className="flex-1 relative">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value.slice(0, 500))}
              placeholder={t(language, 'copilot.inputPlaceholder')}
              disabled={submitting}
              className="w-full py-3.5 pl-4 pr-12 rounded-2xl bg-surface-container-low border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-secondary text-body-md transition-all shadow-inner disabled:opacity-75"
            />
            {inputText.length > 0 && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant font-mono">
                {inputText.length}/500
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || submitting}
            className="w-12 h-12 rounded-2xl bg-secondary text-on-secondary flex items-center justify-center shadow-md active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all shrink-0"
            aria-label={t(language, 'copilot.send')}
          >
            <span className="material-symbols-outlined text-[22px]">send</span>
          </button>
        </form>

        <p className="text-[10px] text-center text-on-surface-variant/80 mt-1.5 line-clamp-1">
          {t(language, 'copilot.disclaimer')}
        </p>
      </div>
    </div>
  );
}
