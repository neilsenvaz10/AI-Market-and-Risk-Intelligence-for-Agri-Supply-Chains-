import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthStatusScreen from './AuthStatusScreen';

/**
 * Login / sign-up screens. Once Firebase reports a signed-in user and the
 * profile lookup finishes, farmers continue to their next registration step
 * or the dashboard (or the page they originally requested).
 */
export default function PublicRoute() {
  const { initializing, isAuthenticated, profileStatus, setupStep } = useAuth();
  const location = useLocation();

  if (initializing) return <AuthStatusScreen message="Checking your session..." />;

  if (isAuthenticated) {
    if (profileStatus === 'loading' || profileStatus === 'idle') {
      return <AuthStatusScreen message="Loading your profile..." />;
    }
    if (setupStep) return <Navigate to={setupStep} replace />;
    // 'complete' or 'error' (the protected route shows retry for errors)
    const from = location.state?.from;
    return <Navigate to={from && !from.startsWith('/login') ? from : '/'} replace />;
  }

  return <Outlet />;
}
