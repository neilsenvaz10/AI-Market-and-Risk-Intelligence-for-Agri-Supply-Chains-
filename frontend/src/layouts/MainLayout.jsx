import { Outlet } from 'react-router-dom';
import Header from '../components/Header';
import BottomNav from '../components/BottomNav';
import PwaStatus from '../components/PwaStatus';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function MainLayout({ hideNav = false }) {
  const { language } = useAuth();
  return (
    <div className="bg-surface font-body-md text-on-surface flex flex-col min-h-screen w-full">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        {t(language, 'a11y.skipToContent')}
      </a>
      <Header />
      <main id="main-content" tabIndex={-1} className={`flex flex-col relative w-full mx-auto px-4 sm:px-gutter pt-20 ${hideNav ? 'max-w-xl pb-8' : 'max-w-5xl pb-36'} bg-surface flex-grow focus:outline-none`}>
        <PwaStatus language={language} />
        <Outlet />
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
