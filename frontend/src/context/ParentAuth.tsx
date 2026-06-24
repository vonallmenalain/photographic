import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';

interface ParentAuthState {
  loading: boolean;
  verified: boolean;
  email: string | null;
  refresh: () => Promise<void>;
  setVerified: (email: string) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<ParentAuthState | null>(null);

export function ParentAuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [verified, setV] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ verified: boolean; email?: string }>('/api/parent/session');
      setV(res.verified);
      setEmail(res.email ?? null);
    } catch {
      setV(false);
      setEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setVerified = (e: string) => {
    setV(true);
    setEmail(e);
  };

  const logout = async () => {
    try {
      await api('/api/parent/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setV(false);
    setEmail(null);
  };

  return (
    <Ctx.Provider value={{ loading, verified, email, refresh, setVerified, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useParentAuth(): ParentAuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useParentAuth must be used within ParentAuthProvider');
  return ctx;
}
