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

/**
 * Routes on which a `?token=` query param represents a *login* token
 * that should be exchanged for a session via hydrateFromToken().
 */
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

function PublicOnlyRoute({ children }: { children: ReactElement }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0A08] text-[#6B6259] font-mono text-xs">
        Loading…
      </div>
    );
  }

  if (isAuthenticated) return <Navigate to="/app" replace />;

  return children;
}

function ProtectedRoute({ children }: { children: ReactElement }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0A08] text-[#6B6259] font-mono text-xs">
        Loading…
      </div>
    );
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CallProvider>
          <ScrollToTop />
          <TokenInterceptor />
          <Routes>
            {/* ── Public (redirects to /app if logged in) ── */}
            <Route
              path="/"
              element={
                <PublicOnlyRoute>
                  <Landing />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/login"
              element={
                <PublicOnlyRoute>
                  <Login />
                </PublicOnlyRoute>
              }
            />
            <Route
              path="/register"
              element={
                <PublicOnlyRoute>
                  <Register />
                </PublicOnlyRoute>
              }
            />

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