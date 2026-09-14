'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { type MeResponse } from '@gcp/shared';

import { authClient } from './auth-client';
import { getAccessToken, setAccessToken, subscribeToAccessToken } from './token-store';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: MeResponse | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<MeResponse | null>(null);

  const loadUser = useCallback(async (): Promise<void> => {
    const token = getAccessToken();
    if (!token) {
      setStatus('unauthenticated');
      setUser(null);
      return;
    }
    const me = await authClient.me(token);
    if (me) {
      setUser(me);
      setStatus('authenticated');
    } else {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    // On first load there is no in-memory token yet (a hard refresh clears
    // it) — try to silently mint one from the httpOnly refresh cookie before
    // deciding the visitor is signed out.
    void (async () => {
      const session = await authClient.refresh();
      if (session) {
        setAccessToken(session.accessToken);
      }
      await loadUser();
    })();
  }, [loadUser]);

  useEffect(() => subscribeToAccessToken(() => void loadUser()), [loadUser]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const session = await authClient.login(email, password);
    setAccessToken(session.accessToken);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await authClient.logout();
    setAccessToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
