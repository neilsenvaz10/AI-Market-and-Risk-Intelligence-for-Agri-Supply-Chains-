/**
 * Full-height loading / error state shown while auth or the profile resolves.
 * Uses the same spinner and card styling as the Stitch screens.
 */
export default function AuthStatusScreen({ message = 'Loading...', error, onRetry, onLogout }) {
  if (error) {
    return (
      <div className="flex flex-col w-full min-h-[60vh] items-center justify-center px-gutter">
        <div className="w-full bg-error-container text-on-error-container p-4 rounded-xl shadow-sm flex items-start gap-3">
          <span className="material-symbols-outlined text-error text-[22px]">error</span>
          <div className="flex-1">
            <p className="font-label-md text-xs font-bold">Could not load your profile</p>
            <p className="font-body-sm text-xs mt-0.5">{error}</p>
          </div>
        </div>
        <div className="flex gap-space-sm w-full mt-space-md">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex-1 py-3 rounded-xl bg-secondary text-on-secondary font-label-lg text-label-lg shadow-md active:scale-95 transition-transform"
            >
              Try again
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex-1 py-3 rounded-xl bg-surface-container-high text-on-surface font-label-lg text-label-lg shadow-sm active:scale-95 transition-transform"
            >
              Log out
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-[60vh] items-center justify-center gap-space-sm text-on-surface-variant" role="status">
      <span className="material-symbols-outlined animate-spin text-secondary text-[36px]">progress_activity</span>
      <p className="font-body-md text-body-md">{message}</p>
    </div>
  );
}
