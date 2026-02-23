import { useContext } from "react";
import { AuthContext } from "./context.js";
import type { ClerkProviderProps } from "./types.js";
import { AuthContextProvider } from "./context.js";

export function ClerkProvider(props: ClerkProviderProps) {
  const { publishableKey, apiUrl, getSession, children } = props;
  return (
    <AuthContextProvider
      publishableKey={publishableKey}
      apiUrl={apiUrl}
      getSession={getSession}
    >
      {children}
    </AuthContextProvider>
  );
}

export function SignedIn(props: { children: React.ReactNode }) {
  const ctx = useContext(AuthContext);
  if (!ctx?.isLoaded || !ctx.isSignedIn) return null;
  return <>{props.children}</>;
}

export function SignedOut(props: { children: React.ReactNode }) {
  const ctx = useContext(AuthContext);
  if (!ctx?.isLoaded || ctx.isSignedIn) return null;
  return <>{props.children}</>;
}
