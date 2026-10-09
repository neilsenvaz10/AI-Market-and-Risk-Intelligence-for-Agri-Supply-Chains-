import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import HomePage from './pages/HomePage';
import SplashOnboardingPage from './pages/SplashOnboardingPage';
import AskAiPage from './pages/AskAiPage';
import RecommendationResultPage from './pages/RecommendationResultPage';
import MandisPage from './pages/MandisPage';
import AlertsPage from './pages/AlertsPage';
import ProfilePage from './pages/ProfilePage';
import LoginPage from './pages/LoginPage';
import VerifyOtpPage from './pages/VerifyOtpPage';
import FarmerRegistrationPage from './pages/FarmerRegistrationPage';
import PhoneLoginPage from './pages/PhoneLoginPage';
import SignupPage from './pages/SignupPage';
import VerifyPhonePage from './pages/VerifyPhonePage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import AddEmailPage from './pages/AddEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { SETUP_ROUTES } from './utils/setupSteps';
import ProtectedRoute from './components/ProtectedRoute';
import PublicRoute from './components/PublicRoute';
import { AuthProvider } from './context/AuthContext';
import { RECAPTCHA_CONTAINER_ID } from './services/authService';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<MainLayout hideNav />}>
            {/* Login & sign-up: only for signed-out visitors */}
            <Route element={<PublicRoute />}>
              <Route path="login" element={<LoginPage />} />
              <Route path="login/phone" element={<PhoneLoginPage />} />
              <Route path="signup" element={<SignupPage />} />
            </Route>
            {/* OTP entry and password recovery manage their own state */}
            <Route path="verify-otp" element={<VerifyOtpPage />} />
            <Route path="forgot-password" element={<ForgotPasswordPage />} />
            <Route path="forgot-password/new" element={<ResetPasswordPage />} />
            {/* Registration steps â€” each reachable only while it is the current step */}
            <Route element={<ProtectedRoute step={SETUP_ROUTES.addEmail} />}>
              <Route path="account/email" element={<AddEmailPage />} />
            </Route>
            <Route element={<ProtectedRoute step={SETUP_ROUTES.verifyPhone} />}>
              <Route path="verify-phone" element={<VerifyPhonePage />} />
            </Route>
            <Route element={<ProtectedRoute step={SETUP_ROUTES.verifyEmail} />}>
              <Route path="verify-email" element={<VerifyEmailPage />} />
            </Route>
            <Route element={<ProtectedRoute step={SETUP_ROUTES.profile} />}>
              <Route path="register" element={<FarmerRegistrationPage />} />
            </Route>
          </Route>

          <Route path="/" element={<MainLayout />}>
            {/* Language selection stays reachable before and after login */}
            <Route path="onboarding" element={<SplashOnboardingPage />} />
            <Route element={<ProtectedRoute />}>
              <Route index element={<HomePage />} />
              <Route path="ask-ai" element={<AskAiPage />} /><Route path="copilot" element={<AskAiPage />} />
              <Route path="recommendation" element={<RecommendationResultPage />} />
              <Route path="mandis" element={<MandisPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      {/* Firebase invisible reCAPTCHA mounts here */}
      <div id={RECAPTCHA_CONTAINER_ID} />
    </AuthProvider>
  );
}

export default App;
