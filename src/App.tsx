/**
 * Orbital — App root.
 * Public auth pages + protected app shell with nested routes.
 */

import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './context/CallContext';
import { ScrollToTop } from './components/ScrollToTop';


// Public pages
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ConfirmEmail from './pages/ConfirmEmail';
import ConfirmEmailPending from './pages/ConfirmEmailPending';

// Protected app shell
import AppShell from './pages/AppShell';

// Nested panes inside the app shell
import DirectMessagePane from './components/DirectMessagePane';
import GroupPane from './components/GroupPane';
import FriendsPane from './components/FriendsPane';
import SettingsPane from './components/SettingsPane';
import CallsPane from './components/CallsPane';
import NotificationsPane from './components/NotificationsPane';

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
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
          <ScrollToTop />           
      <AuthProvider>
        <CallProvider>
          <Routes>
            {/* ── Public ───────────────────────────────── */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            <Route path="/confirm-email-pending" element={<ConfirmEmailPending />} />

            {/* ── Protected app shell ──────────────────── */}
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/app/dm" replace />} />
              <Route path="dm" element={<DirectMessagePane />} />
              <Route path="dm/:userId" element={<DirectMessagePane />} />
              <Route path="groups" element={<GroupPane />} />
              <Route path="groups/:groupId" element={<GroupPane />} />
              <Route path="friends" element={<FriendsPane />} />
              <Route path="calls" element={<CallsPane />} />
              <Route path="notifications" element={<NotificationsPane />} />
              <Route path="settings" element={<SettingsPane />} />
            </Route>

            {/* ── Catch-all ────────────────────────────── */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CallProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}