import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, Session, setAccessToken, setSessionLostHandler, User } from './api';

interface AuthState {
  user: User | null;
  /** False until the first silent refresh has finished, so pages do not flash a signed-out state. */
  ready: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  signIn: (session: Session) => void;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let alive = true;
    refreshSession().then((session) => {
      if (!alive) return;
      setUser(session?.user ?? null);
      setReady(true);
    });
    setSessionLostHandler(() => {
      setUser(null);
      queryClient.clear();
    });
    return () => {
      alive = false;
    };
  }, [queryClient]);

  const signIn = useCallback(
    (session: Session) => {
      setAccessToken(session.accessToken);
      queryClient.clear();
      setUser(session.user);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      isStaff: !!user && user.role !== 'CLIENT',
      isAdmin: user?.role === 'ADMIN' || user?.role === 'OWNER',
      isOwner: user?.role === 'OWNER',
      signIn,
      signOut,
      setUser,
    }),
    [user, ready, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Where a person lands after signing in. */
export const homeFor = (user: User) =>
  user.role === 'CLIENT' ? '/account' : user.role === 'BARBER' ? '/staff/day' : '/staff/today';
