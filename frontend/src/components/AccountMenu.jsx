import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import { formatPhone } from '../constants/profile';

const avatarClass =
  'w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-on-secondary hover:opacity-90';

/**
 * Header account button. Signed-in farmers get a menu with their profile and
 * Log Out; signed-out visitors keep the original link (redirects to login).
 */
export default function AccountMenu() {
  const { isAuthenticated, farmer, user } = useAuth();
  const { logout, loggingOut, logoutError } = useLogout();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!isAuthenticated) {
    return (
      <Link to="/profile" className={avatarClass} aria-label="Account">
        <span className="material-symbols-outlined text-on-secondary text-[18px]">person</span>
      </Link>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className={avatarClass}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="material-symbols-outlined text-on-secondary text-[18px]">person</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 w-56 bg-surface-container-lowest text-on-surface rounded-xl shadow-md border border-outline-variant/30 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-surface-container">
            <p className="font-label-lg text-sm font-bold text-on-surface truncate">{farmer?.fullName || 'Farmer'}</p>
            <p className="font-body-sm text-xs text-on-surface-variant truncate">{farmer?.email || user?.email || ''}</p>
            <p className="font-body-sm text-xs text-on-surface-variant">{formatPhone(farmer?.phoneNumber || user?.phoneNumber)}</p>
          </div>
          {farmer && (
            <Link
              to="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-body-md text-on-surface hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">person</span>
              My Profile
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 px-4 py-3 text-body-md text-error font-bold hover:bg-error-container/40 disabled:opacity-60"
          >
            <span className={`material-symbols-outlined text-[20px] ${loggingOut ? 'animate-spin' : ''}`}>
              {loggingOut ? 'progress_activity' : 'logout'}
            </span>
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </button>
          {logoutError && (
            <p className="px-4 pb-3 text-body-sm text-error" role="alert">{logoutError}</p>
          )}
        </div>
      )}
    </div>
  );
}
