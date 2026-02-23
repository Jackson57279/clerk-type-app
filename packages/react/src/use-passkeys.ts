import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./context.js";
import { createPasskeyClient } from "./passkey-client.js";
import { creationOptionsToPublicKey } from "./passkey-types.js";
import { serializeRegistrationResponse } from "./passkey-client.js";
import type { PasskeyInfo } from "./passkey-types.js";

export interface UsePasskeysOptions {
  apiUrl?: string | null;
}

export interface UsePasskeysResult {
  passkeys: PasskeyInfo[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  addPasskey: (options?: { name?: string }) => Promise<void>;
  revokePasskey: (credentialId: string) => Promise<void>;
}

export function usePasskeys(options: UsePasskeysOptions = {}): UsePasskeysResult {
  const ctx = useContext(AuthContext);
  const apiUrl = options.apiUrl ?? ctx?.apiUrl ?? null;
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () => (apiUrl ? createPasskeyClient({ apiUrl }) : null),
    [apiUrl]
  );

  const reload = useCallback(async () => {
    if (!client) {
      setPasskeys([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await client.list();
      setPasskeys(result.passkeys);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setPasskeys([]);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addPasskey = useCallback(
    async (opts?: { name?: string }) => {
      if (!client) {
        setError("No API URL configured for passkeys");
        return;
      }
      setError(null);
      try {
        const optionsJson = await client.startRegistration();
        const creationOptions = creationOptionsToPublicKey(optionsJson);
        const credential = await navigator.credentials.create(creationOptions);
        if (!credential || !(credential instanceof PublicKeyCredential)) {
          throw new Error("Passkey creation was cancelled or failed");
        }
        const response = serializeRegistrationResponse(credential);
        await client.finishRegistration({
          response,
          name: opts?.name,
          deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        });
        await reload();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
      }
    },
    [client, reload]
  );

  const revokePasskey = useCallback(
    async (credentialId: string) => {
      if (!client) return;
      setError(null);
      try {
        await client.revoke(credentialId);
        await reload();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
      }
    },
    [client, reload]
  );

  return {
    passkeys,
    loading,
    error,
    reload,
    addPasskey,
    revokePasskey,
  };
}
