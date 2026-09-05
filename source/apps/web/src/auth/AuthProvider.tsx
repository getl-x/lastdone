import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthClient {
  currentUser(): AuthUser | null;
  login(username: string, password: string): Promise<AuthUser>;
  logout(): void | Promise<void>;
  isOffline?(): boolean;
}

export type AuthStatus =
  "authenticated" | "unauthenticated" | "authenticating" | "offline-authenticated";

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  client,
  children,
}: PropsWithChildren<{ client: AuthClient }>) {
  const initialUser = client.currentUser();
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (initialUser && client.isOffline?.()) {
      return "offline-authenticated";
    }
    return initialUser ? "authenticated" : "unauthenticated";
  });

  const login = useCallback(
    async (username: string, password: string) => {
      setStatus("authenticating");
      try {
        const authenticatedUser = await client.login(username, password);
        setUser(authenticatedUser);
        setStatus("authenticated");
      } catch (error) {
        setStatus("unauthenticated");
        throw error;
      }
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    setUser(null);
    setStatus("unauthenticated");
  }, [client]);

  const value = useMemo(
    () => ({ user, status, login, logout }),
    [login, logout, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
