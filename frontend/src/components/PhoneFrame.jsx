import React, { useState, useEffect } from 'react';

/**
 * PhoneFrame - wraps the application in an authentic smartphone mockup
 * on desktop/tablet viewports (>= 640px) while maintaining full native
 * responsiveness on physical mobile devices.
 */
export default function PhoneFrame({ children, hideNav = false, fitScreen = false }) {
  const [currentTime, setCurrentTime] = useState('');
  const [isPhoneView, setIsPhoneView] = useState(true);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!isPhoneView) {
    return (
      <div className="w-full bg-surface relative h-dvh flex flex-col overflow-hidden">
        <div className="fixed top-3 right-3 z-[100] hidden sm:block">
          <button
            onClick={() => setIsPhoneView(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 text-white text-xs font-semibold shadow-lg hover:bg-slate-800 backdrop-blur-md border border-white/10 transition-all active:scale-95"
            title="Switch back to Phone View"
          >
            <span className="material-symbols-outlined text-[16px] text-emerald-400">smartphone</span>
            Phone Frame
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#0a120c] flex flex-col items-center justify-center p-0 sm:py-6 sm:px-4 selection:bg-secondary selection:text-on-secondary">
      {/* Desktop Helper Bar */}
      <div className="hidden sm:flex items-center justify-between w-full max-w-[430px] mb-2 px-3 text-xs text-zinc-400 font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-emerald-400 tracking-wider uppercase">Fasalytics Phone</span>
        </div>
        <button
          onClick={() => setIsPhoneView(false)}
          className="text-[11px] hover:text-white transition-colors underline flex items-center gap-1"
          title="Toggle wide desktop view"
        >
          <span className="material-symbols-outlined text-[14px]">fullscreen</span>
          Full Width
        </button>
      </div>

      {/* Smartphone Chassis */}
      <div className="relative w-full sm:max-w-[430px] h-screen sm:h-[880px] sm:max-h-[92vh] flex flex-col">
        {/* Hardware Side Buttons (Desktop only) */}
        {/* Left: Volume Up */}
        <div className="hidden sm:block absolute -left-[14px] top-28 w-[4px] h-12 bg-zinc-700/80 rounded-l-sm" />
        {/* Left: Volume Down */}
        <div className="hidden sm:block absolute -left-[14px] top-44 w-[4px] h-12 bg-zinc-700/80 rounded-l-sm" />
        {/* Right: Power Button */}
        <div className="hidden sm:block absolute -right-[14px] top-32 w-[4px] h-16 bg-zinc-700/80 rounded-r-sm" />

        {/* Phone Shell with Border & Rounded Corners */}
        <div className="relative w-full h-full flex flex-col bg-surface sm:rounded-[50px] sm:border-[11px] sm:border-[#18201a] sm:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08),0_0_35px_rgba(8,109,57,0.12)] sm:ring-1 sm:ring-black/60 overflow-hidden transform-gpu [transform:translateZ(0)]">
          {/* Top Status Bar & Dynamic Island (Desktop frame) */}
          <div className="hidden sm:flex items-center justify-between px-6 pt-3 pb-1.5 bg-primary text-white text-[11px] font-semibold tracking-tight z-50 select-none shrink-0 border-b border-primary-container/20">
            <span>{currentTime || '09:41'}</span>
            {/* Dynamic Island pill */}
            <div className="w-24 h-[18px] bg-black rounded-full flex items-center justify-end pr-2 gap-1.5 shadow-inner">
              <div className="w-2 h-2 rounded-full bg-[#111c24] border border-[#203040] relative">
                <div className="w-0.5 h-0.5 rounded-full bg-blue-400/60 absolute top-0.5 right-0.5" />
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="material-symbols-outlined text-[13px]">signal_cellular_4_bar</span>
              <span className="font-bold text-[10px]">5G</span>
              <span className="material-symbols-outlined text-[14px]">battery_5_bar</span>
            </div>
          </div>

          {/* Phone Screen Inner Viewport */}
          <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden relative">
            {children}
          </div>

          {/* Bottom Home Indicator Bar (Desktop frame) */}
          <div className="hidden sm:flex justify-center items-center py-1.5 bg-surface z-50 select-none shrink-0">
            <div className="w-32 h-1 bg-on-surface-variant/30 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
