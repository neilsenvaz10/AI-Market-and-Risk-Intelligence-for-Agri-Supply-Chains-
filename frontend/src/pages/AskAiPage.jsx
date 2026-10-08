import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function AskAiPage() {
  const { language } = useAuth();

  // Demo messages — built from the active language on mount.
  // They reset when language changes since language is a dep of initializer.
  const makeInitialMessages = (lang) => [
    {
      id: 1,
      sender: 'user',
      text: t(lang, 'ai.demo.userMsg1'),
      time: '10:42 AM',
      status: t(lang, 'ai.demo.read'),
    },
    {
      id: 2,
      sender: 'ai',
      text: t(lang, 'ai.demo.aiMsg1'),
      time: '10:43 AM',
      hasCard: true,
    },
    {
      id: 3,
      sender: 'user',
      text: t(lang, 'ai.demo.userMsg2'),
      time: '10:45 AM',
      status: t(lang, 'ai.demo.read'),
    },
    {
      id: 4,
      sender: 'ai',
      text: t(lang, 'ai.demo.aiMsg2'),
      time: '10:45 AM',
    },
  ];

  const [messages, setMessages] = useState(() => makeInitialMessages(language));
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    setMessages(makeInitialMessages(language));
  }, [language]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg = {
      id: Date.now(),
      sender: 'user',
      text: inputText,
      time: t(language, 'ai.demo.justNow'),
      status: t(language, 'ai.demo.sent'),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputText('');

    // Simulated AI acknowledgment response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'ai',
          text: t(language, 'ai.demo.aiResponse'),
          time: t(language, 'ai.demo.justNow'),
        },
      ]);
    }, 1000);
  };

  const handleChipClick = (query) => {
    setInputText(query);
  };

  return (
    <div className="flex flex-col w-full pb-32">
      {/* Chat Header status info */}
      <div className="flex items-center justify-between py-2 px-1 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-secondary animate-pulse"></div>
          <span className="text-body-sm font-semibold text-on-surface-variant uppercase tracking-wider">
            Fasalytics AI • {t(language, 'ai.statusLabel')}
          </span>
        </div>
        <span className="text-body-sm text-on-surface-variant font-medium">
          {t(language, 'ai.session')} #8921
        </span>
      </div>

      {/* Chat Conversation Area */}
      <div className="flex flex-col gap-4 w-full">
        {/* Timestamp Divider */}
        <div className="flex justify-center my-1">
          <span className="px-3 py-1 bg-surface-container-high rounded-full text-body-sm text-on-surface-variant font-medium">
            {t(language, 'ai.demo.timeLabel')}
          </span>
        </div>

        {messages.map((msg) => (
          <React.Fragment key={msg.id}>
            {msg.sender === 'user' ? (
              /* Farmer User Message */
              <div className="flex flex-col items-end gap-1 w-full pl-8">
                <div className="bg-primary text-on-primary p-4 rounded-xl rounded-br-xs shadow-sm max-w-[90%]">
                  <p className="text-body-lg font-label-lg">{msg.text}</p>
                </div>
                <span className="text-body-sm text-on-surface-variant pr-1">
                  {msg.time} • {msg.status}
                </span>
              </div>
            ) : (
              /* AI Response */
              <div className="flex flex-col items-start gap-1 w-full pr-8">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded-full bg-secondary-container flex items-center justify-center">
                    <span
                      className="material-symbols-outlined text-on-secondary-container text-[14px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      smart_toy
                    </span>
                  </div>
                  <span className="text-body-sm font-bold text-secondary">{t(language, 'ai.aiName')}</span>
                </div>
                <div className="bg-surface-container-lowest p-4 rounded-xl shadow-[0_1px_8px_rgba(0,38,13,0.06)] w-full flex flex-col gap-3">
                  <p className="text-body-md text-on-surface">{msg.text}</p>

                  {/* Rich Embedded Result Card */}
                  {msg.hasCard && (
                    <div className="bg-surface-container-low p-4 rounded-xl flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="font-headline-md text-headline-md text-primary">
                          Pune APMC • {t(language, 'ai.card.recommended')}
                        </span>
                        <span className="px-2.5 py-1 bg-secondary-container text-on-secondary-container text-body-sm font-bold rounded-full">
                          {t(language, 'ai.card.confidence')}: 78%
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline py-2 bg-surface-container-lowest px-3 rounded-lg">
                        <div>
                          <span className="text-body-sm text-on-surface-variant block">
                            {t(language, 'ai.card.expectedReturn')}
                          </span>
                          <span className="font-headline-lg text-headline-lg text-secondary">
                            ₹19,800
                          </span>
                        </div>
                        <span className="text-body-sm font-bold text-secondary bg-secondary/10 px-2 py-0.5 rounded">
                          +14% vs avg
                        </span>
                      </div>
                      <div className="text-body-md text-on-surface flex flex-col gap-1">
                        <div className="flex justify-between py-1">
                          <span className="text-on-surface-variant">Pune Mandi (60%)</span>
                          <span className="font-semibold">600 kg @ ₹2,050/qtl</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-on-surface-variant">Ahmednagar (40%)</span>
                          <span className="font-semibold">400 kg @ ₹1,920/qtl</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-amber-800 bg-amber-100 px-2 py-1 rounded font-medium">
                          {t(language, 'ai.card.mediumRisk')}
                        </span>
                        <Link
                          to="/recommendation"
                          className="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-body-sm font-medium flex items-center gap-1 active:scale-95 transition-all"
                        >
                          <span>{t(language, 'ai.card.viewBreakdown')}</span>
                          <span className="material-symbols-outlined text-[16px]">
                            arrow_forward
                          </span>
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-body-sm text-on-surface-variant pl-1">{msg.time}</span>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Suggestion Chips — localised per active language */}
      <div className="flex gap-2 overflow-x-auto py-3 mt-4">
        <button
          onClick={() => handleChipClick(t(language, 'ai.chip.bestPrice'))}
          className="whitespace-nowrap px-3.5 py-2 bg-surface-container-lowest text-primary rounded-full text-body-sm font-medium shadow-sm hover:bg-secondary-container transition-all"
        >
          {t(language, 'ai.chip.bestPrice')}
        </button>
        <button
          onClick={() => handleChipClick(t(language, 'ai.chip.coldStorage'))}
          className="whitespace-nowrap px-3.5 py-2 bg-surface-container-lowest text-primary rounded-full text-body-sm font-medium shadow-sm hover:bg-secondary-container transition-all"
        >
          {t(language, 'ai.chip.coldStorage')}
        </button>
        <button
          onClick={() => handleChipClick(t(language, 'ai.chip.weather'))}
          className="whitespace-nowrap px-3.5 py-2 bg-surface-container-lowest text-primary rounded-full text-body-sm font-medium shadow-sm hover:bg-secondary-container transition-all"
        >
          {t(language, 'ai.chip.weather')}
        </button>
      </div>

      {/* Bottom Floating Input Bar */}
      <div className="fixed bottom-20 inset-x-0 z-40 px-gutter pb-2 bg-surface/95 backdrop-blur-xl">
        <form onSubmit={handleSend} className="flex flex-col gap-2 max-w-screen-xl mx-auto">
          <div className="flex items-center gap-2 bg-surface-container-lowest p-2 rounded-xl shadow-[0_-1px_8px_rgba(0,38,13,0.06)]">
            <button
              type="button"
              className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container shrink-0 active:scale-95 transition-all"
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                mic
              </span>
            </button>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-grow bg-transparent text-body-md text-on-surface placeholder:text-on-surface-variant outline-none px-2"
              placeholder={t(language, 'ai.placeholder')}
            />
            <button
              type="submit"
              className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary shrink-0 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">send</span>
            </button>
          </div>
          <div className="text-center">
            <span className="text-[11px] text-on-surface-variant font-medium">
              {t(language, 'ai.footer')}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
