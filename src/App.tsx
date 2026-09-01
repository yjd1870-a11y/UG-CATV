import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ActiveView } from './app/ActiveView';
import { Header } from './components/common/Header';
import { BottomNav } from './components/common/BottomNav';
import { Toast } from './components/common/Toast';
import { LoginView } from './components/auth/LoginView';
import telecomAppBackground from './assets/images/telecom-app-background.png';

const MainLayout: React.FC = () => {
  const { activeView, isAuthenticated, isAuthChecking } = useApp();

  if (isAuthChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F7FA] text-sm font-semibold text-[#173B57]">
        인증 정보를 확인하는 중...
      </div>
    );
  }

  if (!isAuthenticated || activeView === 'login') {
    return (
      <div className="min-h-screen bg-[#0F2333] flex flex-col justify-center">
        <LoginView />
        <Toast />
      </div>
    );
  }

  return (
    <div
      className="app-authenticated-shell min-h-screen text-[#1F2937] flex flex-col antialiased selection:bg-[#F28C28] selection:text-white"
      style={{ backgroundImage: `linear-gradient(rgba(244, 252, 248, 0.38), rgba(244, 252, 248, 0.38)), url(${telecomAppBackground})` }}
    >
      {/* Top Application Header */}
      <Header />

      {/* Main Content Area */}
      <main className="app-main-content flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <ActiveView />
      </main>

      {/* Mobile Fixed Bottom Navigation */}
      <BottomNav />

      {/* Global Toast Alerts */}
      <Toast />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
