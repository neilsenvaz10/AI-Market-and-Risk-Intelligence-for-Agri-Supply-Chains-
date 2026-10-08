import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { path: '/', icon: 'home', label: 'Home', dataPath: 'home' },
  { path: '/ask-ai', icon: 'smart_toy', label: 'Ask AI', dataPath: 'ask-ai' },
  { path: '/mandis', icon: 'storefront', label: 'Mandis', dataPath: 'mandis' },
  { path: '/alerts', icon: 'notifications', label: 'Alerts', dataPath: 'alerts' },
  { path: '/profile', icon: 'person', label: 'Profile', dataPath: 'profile' },
];

export default function BottomNav() {
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 pb-safe bg-surface/90 backdrop-blur-xl shadow-[0_-1px_8px_rgba(0,38,13,0.06)]">
      <div className="flex justify-around items-center h-20 px-space-sm">
        {navItems.map((item) => (
          <Link
            key={item.dataPath}
            to={item.path}
            data-path={item.dataPath}
            className={`flex flex-col items-center justify-center gap-space-xs w-16 h-16 transition-all rounded-xl ${
              isActive(item.path)
                ? 'bg-secondary-container text-on-secondary-container font-bold'
                : 'text-on-surface-variant'
            }`}
            {...(isActive(item.path) ? { 'aria-current': 'page' } : {})}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className={`text-body-sm ${isActive(item.path) ? 'font-bold' : ''}`}>
              {item.label}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
