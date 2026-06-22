import {
  User,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from "firebase/auth";
import {
  createContext,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { auth } from "../firebase/client";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error("Nicht eingeloggt.");
    }
    return auth.currentUser.getIdToken();
  }, []);

  const value = useMemo(
    () => ({ user, loading, signOut, getIdToken }),
    [getIdToken, loading, signOut, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
