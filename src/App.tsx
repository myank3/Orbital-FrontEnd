/**
 * Orbital — App root.
 * Public auth pages + protected app shell with nested routes.
 */

import { useEffect, type ReactElement } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './context/CallContext';
import { ScrollToTop } from './components/ScrollToTop';
import ConnectionBanner from './components/ConnectionBanner';

// Capacitor Native Imports
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { Browser } from '@capacitor/browser';
import { initPushNotifications } from './services/pushService';
import { requestCallPermissions } from './services/permissions';

// Public pages
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ConfirmEmail from './pages/ConfirmEmail';
import ConfirmEmailPending from './pages/ConfirmEmailPending';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';

// Protected app shell
import AppShell from './pages/AppShell';

// Nested panes inside the app shell
import DirectMessagePane from './components/DirectMessagePane';
import GroupPane from './components/GroupPane';
import FriendsPane from './components/FriendsPane';
import SettingsPane from './components/SettingsPane';
import CallsPane from './components/CallsPane';
import NotificationsPane from './components/NotificationsPane';
import OrbitView from './pages/OrbitView';
import SignalsPage from './pages/SignalsPage';

const TOKEN_INTERCEPT_ROUTES = [
  '/auth/google/success',
  '/confirm-email',
  '/verify-email',
  '/auth/callback',
  '/magic-login',
];

function isTokenInterceptRoute(pathname: string): boolean {
  return TOKEN_INTERCEPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

// 🔥 NEW CUSTOM LOADING SCREEN COMPONENT
function LoadingScreen() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0B0A08]">
      {/* Change /logo.svg to /icon.png if that's the path to your logo */}
      <img 
        src="/ic_background.png" 
        alt="Orbital" 
        className="w-20 h-20 animate-pulse drop-shadow-[0_0_15px_rgba(217,119,6,0.5)] mb-6 object-contain" 
      />
      
      {/* Spinner */}
      <div className="w-8 h-8 border-4 border-[#D97706]/30 border-t-[#D97706] rounded-full animate-spin"></div>
      
      {/* Loading Text */}
      <p className="mt-5 text-[#6B6259] font-mono text-xs tracking-[0.2em] uppercase animate-pulse">
        Connecting to Orbital
      </p>
    </div>
  );
}

function PublicOnlyRoute({ children }: { children: ReactElement }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />; // 🔥 REPLACED BORING TEXT
  }

  if (isAuthenticated) return <Navigate to="/app" replace />;

  return children;
}

function ProtectedRoute({ children }: { children: ReactElement }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />; // 🔥 REPLACED BORING TEXT
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <>
      <ConnectionBanner />
      {children}
    </>
  );
}

function TokenInterceptor() {
  const { hydrateFromToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const path = window.location.pathname;
    if (!isTokenInterceptRoute(path)) return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return;

    window.history.replaceState({}, '', window.location.pathname);

    (async () => {
      const profile = await hydrateFromToken(token);
      navigate(profile ? '/app' : '/login?error=hydrate_failed', {
        replace: true,
      });
    })();
  }, [hydrateFromToken, navigate]);

  return null;
}

// 🔥 Native Integration with separated useEffects
function NativeIntegration() {
  const { isAuthenticated } = useAuth();

  // 1. Setup Deep Link Listener (Runs ONCE on app load)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const setupDeepLink = async () => {
      CapacitorApp.addListener('appUrlOpen', async (event) => {
        console.log('App opened with URL:', event.url);
        
        if (event.url.includes('auth?')) {
          const url = new URL(event.url);
          const token = url.searchParams.get('token');
          const refreshToken = url.searchParams.get('refreshToken');

          if (token) {
            await Preferences.set({ key: 'accessToken', value: token });
            if (refreshToken) {
              await Preferences.set({ key: 'refreshToken', value: refreshToken });
            }
            window.location.href = `/auth/google/success?token=${token}`;
          }
        }
      });
    };

    setupDeepLink();
  }, []);

  // 2. Request Push & Call Permissions (Runs when user logs in)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !isAuthenticated) return;

    // Ask for Push Notifications
    initPushNotifications();

    // Ask for Mic/Camera after 1.5 seconds
    const timer = setTimeout(async () => {
      console.log('Requesting call permissions...');
      const granted = await requestCallPermissions(true);
      console.log('Call permissions granted:', granted);
    }, 1500);

    return () => clearTimeout(timer);
  }, [isAuthenticated]);

  // 3. Handle Android Hardware Back Button
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const backListener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) {
        window.history.back();
      } else {
        CapacitorApp.exitApp();
      }
    });

    return () => {
      backListener.then((listener) => listener.remove());
    };
  }, []);

  // 4. Open external links in Chrome/Safari instead of inside the app
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (
        target &&
        target.href &&
        target.href.startsWith('http') &&
        !target.href.includes('orbitalhq.vercel.app')
      ) {
        e.preventDefault();
        Browser.open({ url: target.href });
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CallProvider>
          <ScrollToTop />
          <TokenInterceptor />
          <NativeIntegration />
          <Routes>
            {/* ── Public (redirects to /app if logged in) ── */}
            <Route path="/" element={<PublicOnlyRoute><Landing /></PublicOnlyRoute>} />
            <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
            <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />

            {/* ── Public (always accessible) ───────────── */}
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            <Route path="/confirm-email-pending" element={<ConfirmEmailPending />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />

            {/* ── Protected app shell ──────────────────── */}
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/app/orbit" replace />} />
              <Route path="orbit" element={<OrbitView />} />
              <Route path="dm" element={<DirectMessagePane />} />
              <Route path="dm/:userId" element={<DirectMessagePane />} />
              <Route path="groups" element={<GroupPane />} />
              <Route path="groups/:groupId" element={<GroupPane />} />
              <Route path="friends" element={<FriendsPane />} />
              <Route path="calls" element={<CallsPane />} />
              <Route path="notifications" element={<NotificationsPane />} />
              <Route path="signals" element={<SignalsPage />} />
              <Route path="settings" element={<SettingsPane />} />
            </Route>

            {/* ── Auth Callbacks (intercepted by TokenInterceptor above) ── */}
            <Route path="/auth/google/success" element={<div className="h-screen w-screen bg-[#0B0A08]" />} />
            <Route path="/auth/callback" element={<div className="h-screen w-screen bg-[#0B0A08]" />} />

            {/* ── Catch-all ────────────────────────────── */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          <Toaster
            position="top-center"
            theme="dark"
            toastOptions={{
              style: {
                background: '#1A1816',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#EDE5D4',
              },
            }}
          />
        </CallProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}