import { useContext } from "react";
import { AuthContext } from "./context.js";
import type { ClerkProviderProps } from "./types.js";
import { AuthContextProvider } from "./context.js";
import { usePasskeys } from "./use-passkeys.js";
import type { UsePasskeysOptions } from "./use-passkeys.js";

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

export interface PasskeyManagementProps extends UsePasskeysOptions {
  addButtonLabel?: string;
  emptyMessage?: string;
  title?: string;
}

export function PasskeyManagement(props: PasskeyManagementProps) {
  const {
    apiUrl,
    addButtonLabel = "Add passkey",
    emptyMessage = "No passkeys yet.",
    title = "Passkeys",
  } = props;
  const { passkeys, loading, error, addPasskey, revokePasskey } = usePasskeys({ apiUrl });

  if (loading) {
    return (
      <div data-testid="passkey-management">
        <h2>{title}</h2>
        <p data-testid="passkey-loading">Loading…</p>
      </div>
    );
  }

  return (
    <div data-testid="passkey-management">
      <h2>{title}</h2>
      {error && (
        <p data-testid="passkey-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        data-testid="passkey-add"
        onClick={() => void addPasskey()}
      >
        {addButtonLabel}
      </button>
      {passkeys.length === 0 ? (
        <p data-testid="passkey-empty">{emptyMessage}</p>
      ) : (
        <ul data-testid="passkey-list">
          {passkeys.map((pk) => (
            <li key={pk.credentialId} data-testid={`passkey-item-${pk.credentialId}`}>
              <span data-testid={`passkey-name-${pk.credentialId}`}>
                {pk.friendlyName ?? pk.deviceInfo ?? "Passkey"}
              </span>
              {pk.lastUsedAt && (
                <span data-testid={`passkey-last-used-${pk.credentialId}`}>
                  {" "}
                  Last used: {pk.lastUsedAt}
                </span>
              )}
              <button
                type="button"
                data-testid={`passkey-revoke-${pk.credentialId}`}
                onClick={() => void revokePasskey(pk.credentialId)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
