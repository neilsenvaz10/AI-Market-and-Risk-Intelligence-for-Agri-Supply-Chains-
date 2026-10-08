import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export default function AskAiPage() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: 'user',
      text: 'आज टोमॅटो विकू का? पुणे मंडीचा भाव काय आहे?',
      time: '10:42 AM',
      status: 'Read',
    },
    {
      id: 2,
      sender: 'ai',
      text: 'नमस्कार! सद्यस्थितीनुसार आज टोमॅटोची बाजारपेठ अनुकूल आहे. खालीलप्रमाणे नियोजन फायदेशीर ठरेल:',
      time: '10:43 AM',
      hasCard: true,
    },
    {
      id: 3,
      sender: 'user',
      text: 'वाहतूक खर्च किती होईल?',
      time: '10:45 AM',
      status: 'Read',
    },
    {
      id: 4,
      sender: 'ai',
      text: 'पुणे मंडीसाठी वाहतूक खर्च अंदाजे ₹1,200 (अंतर: 110 किमी) आहे. हा खर्च आपल्या एकूण नफ्यातून वजा करून वरील निव्वळ परतावा (Net Return) गणला आहे.',
      time: '10:45 AM',
    },
  ]);

  const [inputText, setInputText] = useState('');

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg = {
      id: Date.now(),
      sender: 'user',
      text: inputText,
      time: 'Just now',
      status: 'Sent',
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputText('');

    // Simulated assistant response response acknowledgment
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'ai',
          text: 'सध्या आम्ही प्रत्यक्ष AI मॉडेल (Phase 1) जोडणीच्या तयारीमध्ये आहोत. पुढील टप्प्यांमध्ये थेट लाईव्ह डेटा उपलब्ध होईल.',
          time: 'Just now',
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
            Fasalytics AI • Agri-Advisor Online
          </span>
        </div>
        <span className="text-body-sm text-on-surface-variant font-medium">Session #8921</span>
      </div>

      {/* Chat Conversation Area */}
      <div className="flex flex-col gap-4 w-full">
        {/* Timestamp Divider */}
        <div className="flex justify-center my-1">
          <span className="px-3 py-1 bg-surface-container-high rounded-full text-body-sm text-on-surface-variant font-medium">
            Today, 10:42 AM
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
                  <span className="text-body-sm font-bold text-secondary">Fasalytics Expert AI</span>
                </div>
                <div className="bg-surface-container-lowest p-4 rounded-xl shadow-[0_1px_8px_rgba(0,38,13,0.06)] w-full flex flex-col gap-3">
                  <p className="text-body-md text-on-surface">{msg.text}</p>

                  {/* Rich Embedded Result Card if present */}
                  {msg.hasCard && (
                    <div className="bg-surface-container-low p-4 rounded-xl flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="font-headline-md text-headline-md text-primary">
                          Pune APMC • Recommended
                        </span>
                        <span className="px-2.5 py-1 bg-secondary-container text-on-secondary-container text-body-sm font-bold rounded-full">
                          Confidence: 78%
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline py-2 bg-surface-container-lowest px-3 rounded-lg">
                        <div>
                          <span className="text-body-sm text-on-surface-variant block">
                            Expected Net Return
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
                          Medium Risk Factor
                        </span>
                        <Link
                          to="/recommendation"
                          className="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-body-sm font-medium flex items-center gap-1 active:scale-95 transition-all"
                        >
                          <span>View Full Breakdown</span>
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

      {/* Suggestion Chips Scroll Area */}
      <div className="flex gap-2 overflow-x-auto py-3 mt-4">
        <button
          onClick={() => handleChipClick('कमाल भाव कधी मिळेल?')}
          className="whitespace-nowrap px-3.5 py-2 bg-surface-container-lowest text-primary rounded-full text-body-sm font-medium shadow-sm hover:bg-secondary-container transition-all"
        >
          कमाल भाव कधी मिळेल?
        </button>
        <button
          onClick={() => handleChipClick('कोल्ड स्टोरेज भाव')}
          className="whitespace-nowrap px-3.5 py-2 bg-surface-container-lowest text-primary rounded-full text-body-sm font-medium shadow-sm hover:bg-secondary-container transition-all"
        >
          कोल्ड स्टोरेज भाव
        </button>
        <button
          onClick={() => handleChipClick('हवामान अंदाज तपासा')}
          className="whitespace-nowrap px-3.5 py-2 bg-surface-container-lowest text-primary rounded-full text-body-sm font-medium shadow-sm hover:bg-secondary-container transition-all"
        >
          हवामान अंदाज तपासा
        </button>
      </div>

      {/* Bottom Floating Input Bar Area */}
      <div className="fixed bottom-20 inset-x-0 z-40 px-gutter pb-2 bg-surface/95 backdrop-blur-xl">
        <form onSubmit={handleSend} className="flex flex-col gap-2 max-w-screen-xl mx-auto">
          {/* Input container */}
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
              placeholder="Ask anything about Mandi prices, weather..."
            />
            <button
              type="submit"
              className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary shrink-0 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-[20px]">send</span>
            </button>
          </div>
          {/* Secondary caption */}
          <div className="text-center">
            <span className="text-[11px] text-on-surface-variant font-medium">
              Also works via SMS and WhatsApp • Powered by Fasalytics LLM
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
