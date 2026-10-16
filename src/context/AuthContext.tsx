/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import {
  apiService,
  getAccessToken,
  refreshAuthToken,
  setAccessToken,
} from '../services/api';
import { authService } from '../services/auth';
import { signalRService } from '../services/signalr';
import type { RegisterDto, UserProfileDto } from '../types/api';

export interface AuthContextType {
  user: UserProfileDto | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<UserProfileDto>;
  register: (dto: RegisterDto) => Promise<string>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<UserProfileDto | null>;
  hydrateFromToken: (token: string) => Promise<UserProfileDto | null>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Routes that must NOT trigger auth hydration.
 * Visiting these as a logged-out user is expected and must not
 * fire /refresh, /api/User/profile, or the SignalR hub — all of
 * which return 401 and trigger a spurious redirect.
 */
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

function isPublicRoute(pathname: string): boolean {
  // Exact match, plus allow nested paths under each public route
  // e.g. /reset-password?token=... still matches /reset-password
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function AuthProviderComponent({ children }: AuthProviderProps) {
  const location = useLocation();

  const [token, setTokenState] = useState<string | null>(() => getAccessToken());
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [loading, setLoading] = useState(true);

  const clearAuthState = useCallback(() => {
    setAccessToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  const startSignalR = useCallback(async () => {
    try {
      await signalRService.start();
    } catch (err) {
      console.error('[signalR] start failed:', err);
    }
  }, []);

  const stopSignalR = useCallback(async () => {
    try {
      await signalRService.stop();
    } catch (err) {
      console.error('[signalR] stop failed:', err);
    }
  }, []);

  const refreshUser = useCallback(async (): Promise<UserProfileDto | null> => {
    const currentToken = getAccessToken();
    if (!currentToken) {
      clearAuthState();
      return null;
    }
    try {
      const profile = await apiService.getMyProfile();
      setUser(profile);
      setTokenState(currentToken);
      await startSignalR();
      return profile;
    } catch {
      clearAuthState();
      return null;
    }
  }, [clearAuthState, startSignalR]);

  useEffect(() => {
    let isMounted = true;

    // ── Public-route guard ──────────────────────────────────────
    // On /login, /register, /forgot-password, /reset-password we
    // do NOT attempt to hydrate the session. There is no session
    // to hydrate, and running the flow produces a 401 storm plus
    // a redirect back to /login after the guard's timeout.
    if (isPublicRoute(location.pathname)) {
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    const bootstrap = async () => {
      const storedToken = getAccessToken();

      // If no token in localStorage, still try to refresh — the httpOnly
      // refresh cookie may be valid even when the local token was cleared.
      if (!storedToken) {
        const refreshed = await refreshAuthToken();
        if (!refreshed) {
          if (isMounted) setLoading(false);
          return;
        }
      }

      try {
        const profile = await apiService.getMyProfile();
        if (isMounted) {
          setUser(profile);
          // Read the token again — request() may have set a fresh one
          setTokenState(getAccessToken());
        }
        await startSignalR();
      } catch {
        if (isMounted) clearAuthState();
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void bootstrap();

    const handleUnauthorized = () => {
      void stopSignalR();
      clearAuthState();
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      isMounted = false;
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [location.pathname, clearAuthState, startSignalR, stopSignalR]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<UserProfileDto> => {
      const trimmed = identifier.trim();

      const loginResponse = await authService.login({
        identifier: trimmed,
        password,
      });

      if (!loginResponse?.token) {
        throw new Error('Authentication succeeded but no token was returned.');
      }

      setAccessToken(loginResponse.token);
      setTokenState(loginResponse.token);

      const profile = await apiService.getMyProfile();
      setUser(profile);
      await startSignalR();

      return profile;
    },
    [startSignalR],
  );

  const hydrateFromToken = useCallback(
    async (incomingToken: string): Promise<UserProfileDto | null> => {
      setAccessToken(incomingToken);
      setTokenState(incomingToken);
      try {
        const profile = await apiService.getMyProfile();
        setUser(profile);
        await startSignalR();
        return profile;
      } catch (err) {
        console.error('[auth] hydrateFromToken failed:', err);
        clearAuthState();
        return null;
      }
    },
    [clearAuthState, startSignalR],
  );

  const register = useCallback(async (dto: RegisterDto): Promise<string> => {
    await authService.register(dto);
    return 'Registration successful. Please verify your email before logging in.';
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await stopSignalR();
    try {
      await authService.logout().catch(() => {
        /* ignore network errors on logout */
      });
    } finally {
      clearAuthState();
    }
  }, [clearAuthState, stopSignalR]);

  const isAuthenticated = useMemo(() => Boolean(token && user), [token, user]);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      token,
      loading,
      isAuthenticated,
      login,
      register,
      logout,
      refreshUser,
      hydrateFromToken,
    }),
    [
      user,
      token,
      loading,
      isAuthenticated,
      login,
      register,
      logout,
      refreshUser,
      hydrateFromToken,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthProviderComponent;
export { AuthProviderComponent as AuthProvider };