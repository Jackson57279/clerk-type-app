import { useContext } from "react";
import { AuthContext } from "./context.js";

export function useUser() {
  const ctx = useContext(AuthContext);
  return ctx?.user ?? null;
}

export function useSession() {
  const ctx = useContext(AuthContext);
  return ctx?.session ?? null;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      isLoaded: false,
      isSignedIn: false,
      session: null,
      user: null,
      error: null,
      reload: async () => {},
    };
  }
  return {
    isLoaded: ctx.isLoaded,
    isSignedIn: ctx.isSignedIn,
    session: ctx.session,
    user: ctx.user,
    error: ctx.error,
    reload: ctx.reload,
  };
}
