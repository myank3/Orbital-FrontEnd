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
import { syncPublicKeyToServer } from '../services/cryptoService';
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

function AuthProviderComponent({ children }: AuthProviderProps) {
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

  /* ── E2EE: generate + upload public key once user is known ── */
  useEffect(() => {
    if (!user) return;
    void syncPublicKeyToServer().catch((e) =>
      console.warn('[E2EE] key sync failed', e),
    );
  }, [user]);

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