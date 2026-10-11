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
import { apiService, getAccessToken, setAccessToken } from '../services/api';
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
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
  children: ReactNode;
}

function AuthProviderComponent({ children }: AuthProviderProps) {
  const [token, setTokenState] = useState<string | null>(() => getAccessToken());
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [loading, setLoading] = useState(true);

  const clearAuthState = useCallback(() => {
    setAccessToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  // Best-effort start of the SignalR connection. Requires a token to be
  // present in localStorage; callers must set the token BEFORE invoking this.
  const startSignalR = useCallback(async () => {
    try {
      await signalRService.start();
    } catch (err) {
      // Non-fatal: the app still works over REST; live updates will just
      // be missing until the connection succeeds on the next attempt.
      console.error('[signalR] start failed:', err);
    }
  }, []);

  // Best-effort stop of the SignalR connection on logout.
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
      // Backend rule: profile comes from /api/User/profile, NOT /api/Auth/me
      const profile = await apiService.getMyProfile();
      setUser(profile);
      setTokenState(currentToken);
      // Ensure SignalR is running whenever a valid session exists.
      await startSignalR();
      return profile;
    } catch {
      clearAuthState();
      return null;
    }
  }, [clearAuthState, startSignalR]);

  // Bootstrap: hydrate from stored token on mount
  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      const storedToken = getAccessToken();
      if (!storedToken) {
        if (isMounted) setLoading(false);
        return;
      }
      try {
        const profile = await apiService.getMyProfile();
        if (isMounted) {
          setUser(profile);
          setTokenState(storedToken);
        }
        // Token is in localStorage at this point — safe to open the socket.
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
  }, [clearAuthState, startSignalR, stopSignalR]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<UserProfileDto> => {
      // Trim identifier — backend trims too, but consistent
      const trimmed = identifier.trim();

      const loginResponse = await authService.login({
        identifier: trimmed,
        password,
      });

      if (!loginResponse?.token) {
        throw new Error('Authentication succeeded but no token was returned.');
      }

      // Persist + set state BEFORE fetching profile
      setAccessToken(loginResponse.token);
      setTokenState(loginResponse.token);

      // Fetch profile (this is what makes login "work without refresh")
      const profile = await apiService.getMyProfile();
      setUser(profile);

      // Now that the token is in localStorage and the user is known,
      // open the realtime connection.
      await startSignalR();

      return profile;
    },
    [startSignalR],
  );

  const register = useCallback(async (dto: RegisterDto): Promise<string> => {
    // Backend rule: register returns empty body — no token, no auto-login.
    await authService.register(dto);
    return 'Registration successful. Please verify your email before logging in.';
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    // Stop the realtime connection first so we don't get events
    // delivered while the token is being torn down.
    await stopSignalR();
    try {
      await authService.logout().catch(() => {
        // Ignore network errors on logout — clear state anyway
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
    }),
    [user, token, loading, isAuthenticated, login, register, logout, refreshUser],
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