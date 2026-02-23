import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { createSessionClient } from "./client.js";
import type { AuthState, Session, User } from "./types.js";

export interface AuthContextValue extends AuthState {
  publishableKey: string;
  reload: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const initialState: AuthState = {
  isLoaded: false,
  isSignedIn: false,
  session: null,
  user: null,
  error: null,
};

export function AuthContextProvider(props: {
  publishableKey: string;
  apiUrl?: string | null;
  getSession?: () => Promise<{ ok: true; session: Session; user: User } | { ok: false; error?: string }>;
  children: React.ReactNode;
}) {
  const { publishableKey, apiUrl, getSession, children } = props;
  const [state, setState] = useState<AuthState>(initialState);

  const client = useMemo(
    () => createSessionClient({ apiUrl, getSession }),
    [apiUrl, getSession]
  );

  const load = useCallback(async () => {
    setState((s) => ({ ...s, isLoaded: false, error: null }));
    const result = await client.getSession();
    if (result.ok) {
      setState({
        isLoaded: true,
        isSignedIn: true,
        session: result.session,
        user: result.user,
        error: null,
      });
    } else {
      setState({
        isLoaded: true,
        isSignedIn: false,
        session: null,
        user: null,
        error: result.error ?? null,
      });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      publishableKey,
      reload: load,
    }),
    [state, publishableKey, load]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
