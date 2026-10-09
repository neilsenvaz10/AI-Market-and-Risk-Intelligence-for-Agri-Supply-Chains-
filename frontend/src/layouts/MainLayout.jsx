import { Outlet, useLocation } from 'react-router-dom';
import '../styles/copilot-layout.css';
import Header from '../components/Header';
import BottomNav from '../components/BottomNav';
import PwaStatus from '../components/PwaStatus';
import PhoneFrame from '../components/PhoneFrame';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function MainLayout({ hideNav = false }) {
  const { language } = useAuth();
  const { pathname } = useLocation();
  const isChat = pathname === '/ask-ai' || pathname === '/copilot';
  return (
    <PhoneFrame hideNav={hideNav} fitScreen={isChat}>
      <div className={`bg-surface font-body-md text-on-surface flex flex-col h-full min-h-0 w-full relative ${isChat ? 'copilot-shell' : ''}`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
        >
          {t(language, 'a11y.skipToContent')}
        </a>
        <Header />
        <main
          id="main-content"
          tabIndex={-1}
          className={
            isChat
              ? 'copilot-content bg-surface focus:outline-none'
              : `flex flex-col flex-1 min-h-0 relative w-full mx-auto px-4 py-3.5 ${
                  hideNav ? 'max-w-xl pb-6' : 'max-w-5xl pb-4'
                } bg-surface focus:outline-none overflow-y-auto no-scrollbar`
          }
        >
          <PwaStatus language={language} />
          <Outlet />
        </main>
        {!hideNav && <BottomNav />}
      </div>
    </PhoneFrame>
  );
}
