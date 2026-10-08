import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import AuthStatusScreen from './AuthStatusScreen';

/**
 * Guards routes that need a logged-in farmer.
 *
 * Without `step`: the app itself — every registration step must be complete;
 *   otherwise the farmer is sent to the first unmet step.
 * With `step` (e.g. "/verify-phone"): a registration step page — shown only
 *   while it is the current step, so steps cannot be skipped or revisited.
 */
export default function ProtectedRoute({ step }) {
  const { initializing, isAuthenticated, profileStatus, profileError, reloadProfile, setupStep } = useAuth();
  const { logout, logoutError } = useLogout();
  const location = useLocation();

  if (initializing) return <AuthStatusScreen message="Checking your session..." />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (profileStatus === 'loading' || profileStatus === 'idle') {
    return <AuthStatusScreen message="Loading your profile..." />;
  }

  if (profileStatus === 'error') {
    return <AuthStatusScreen error={logoutError || profileError} onRetry={reloadProfile} onLogout={logout} />;
  }

  if (step) {
    return setupStep === step ? <Outlet /> : <Navigate to={setupStep || '/'} replace />;
  }

  return setupStep ? <Navigate to={setupStep} replace /> : <Outlet />;
}
