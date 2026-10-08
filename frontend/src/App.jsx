import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import HomePage from './pages/HomePage';
import SplashOnboardingPage from './pages/SplashOnboardingPage';
import AskAiPage from './pages/AskAiPage';
import RecommendationResultPage from './pages/RecommendationResultPage';
import MandisPage from './pages/MandisPage';
import AlertsPage from './pages/AlertsPage';
import ProfilePage from './pages/ProfilePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<HomePage />} />
          <Route path="onboarding" element={<SplashOnboardingPage />} />
          <Route path="ask-ai" element={<AskAiPage />} />
          <Route path="recommendation" element={<RecommendationResultPage />} />
          <Route path="mandis" element={<MandisPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
