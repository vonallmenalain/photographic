import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';
import { firebaseSignOut } from '../lib/firebase';

/** Klasse, für die die angemeldete E-Mail-Adresse als Lehrperson eingetragen ist. */
export interface TeacherClassRef {
  id: string;
  name: string;
  status: string;
  open: boolean;
}

interface SessionResponse {
  verified: boolean;
  email?: string;
  teacherClasses?: TeacherClassRef[];
  openConsents?: number;
  next?: string;
}

interface ParentAuthState {
  loading: boolean;
  verified: boolean;
  email: string | null;
  /** Klassen der Klassenerfassung, für die diese E-Mail-Adresse Lehrperson ist. */
  teacherClasses: TeacherClassRef[];
  /** Eigene Kinder, für die noch ein Einverständnis aussteht. */
  openConsents: number;
  /** Zielseite nach der Anmeldung (Einverständnis, Klassenseite oder Galerie). */
  next: string;
  refresh: () => Promise<void>;
  setVerified: (email: string) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<ParentAuthState | null>(null);

export function ParentAuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [verified, setV] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [teacherClasses, setTeacherClasses] = useState<TeacherClassRef[]>([]);
  const [openConsents, setOpenConsents] = useState(0);
  const [next, setNext] = useState('/galerie');

  const refresh = useCallback(async () => {
    try {
      const res = await api<SessionResponse>('/api/parent/session');
      setV(res.verified);
      setEmail(res.email ?? null);
      setTeacherClasses(res.teacherClasses ?? []);
      setOpenConsents(res.openConsents ?? 0);
      setNext(res.next || '/galerie');
    } catch {
      setV(false);
      setEmail(null);
      setTeacherClasses([]);
      setOpenConsents(0);
      setNext('/galerie');
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
    await firebaseSignOut();
    setV(false);
    setEmail(null);
    setTeacherClasses([]);
    setOpenConsents(0);
    setNext('/galerie');
  };

  return (
    <Ctx.Provider
      value={{ loading, verified, email, teacherClasses, openConsents, next, refresh, setVerified, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useParentAuth(): ParentAuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useParentAuth must be used within ParentAuthProvider');
  return ctx;
}
