import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { checkBackendHealth } from '../services/api';

export default function Header() {
  const [backendStatus, setBackendStatus] = useState('checking'); // 'connected', 'offline', 'checking'

  useEffect(() => {
    let isMounted = true;
    checkBackendHealth().then((res) => {
      if (!isMounted) return;
      if (res && res.status === 'ok') {
        setBackendStatus('connected');
      } else {
        setBackendStatus('offline');
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-primary text-on-primary pt-safe shadow-[0_1px_8px_rgba(0,38,13,0.15)]">
      <div className="h-16 px-gutter flex items-center justify-between">
        <div className="flex items-center gap-space-sm">
          <Link to="/" className="text-headline-md font-headline-md tracking-tight uppercase">
            Fasalytics
          </Link>
          {/* Subtle service status indicator using Stitch pill design */}
          <span
            title={`Backend Service: ${backendStatus}`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${
              backendStatus === 'connected'
                ? 'bg-secondary-container text-on-secondary-container'
                : backendStatus === 'checking'
                ? 'bg-surface-container-high text-on-surface-variant'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                backendStatus === 'connected'
                  ? 'bg-secondary animate-pulse'
                  : backendStatus === 'checking'
                  ? 'bg-outline animate-spin'
                  : 'bg-amber-600'
              }`}
            ></span>
            {backendStatus === 'connected' ? 'API LIVE' : backendStatus === 'checking' ? 'SYNC' : 'LOCAL'}
          </span>
        </div>
        <div className="flex items-center gap-space-md">
          <div className="flex bg-primary-container rounded-full p-1 text-xs">
            <button className="px-2 py-1 rounded-full bg-surface text-primary font-bold">EN</button>
            <button className="px-2 py-1 rounded-full text-on-primary-container">हिं</button>
            <button className="px-2 py-1 rounded-full text-on-primary-container">मराठी</button>
          </div>
          <Link
            to="/profile"
            className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-on-secondary hover:opacity-90"
          >
            <span className="material-symbols-outlined text-on-secondary text-[18px]">person</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
