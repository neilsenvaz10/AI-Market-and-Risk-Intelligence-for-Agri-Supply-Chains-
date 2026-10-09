import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { t } from '../i18n/strings';

export default function BottomNav() {
  const location = useLocation();
  const { language } = useAuth();

  const navItems = [
    { path: '/', icon: 'home', labelKey: 'nav.home', dataPath: 'home' },
    { path: '/ask-ai', icon: 'smart_toy', labelKey: 'nav.askAi', dataPath: 'ask-ai' },
    { path: '/mandis', icon: 'storefront', labelKey: 'nav.mandis', dataPath: 'mandis' },
    { path: '/alerts', icon: 'notifications', labelKey: 'nav.alerts', dataPath: 'alerts' },
    { path: '/profile', icon: 'person', labelKey: 'nav.profile', dataPath: 'profile' },
  ];

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="w-full shrink-0 z-40 bg-surface/95 backdrop-blur-xl border-t border-outline-variant/20 shadow-[0_-1px_8px_rgba(0,38,13,0.06)]">
      <div className="flex justify-around items-center h-16 max-w-5xl mx-auto px-1">
        {navItems.map((item) => (
          <Link
            key={item.dataPath}
            to={item.path}
            data-path={item.dataPath}
            className={`flex flex-col items-center justify-center gap-0.5 w-14 h-13 py-1 transition-all rounded-xl ${
              isActive(item.path)
                ? 'bg-secondary-container text-on-secondary-container font-bold'
                : 'text-on-surface-variant'
            }`}
            {...(isActive(item.path) ? { 'aria-current': 'page' } : {})}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className={`text-body-sm ${isActive(item.path) ? 'font-bold' : ''}`}>
              {t(language, item.labelKey)}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
