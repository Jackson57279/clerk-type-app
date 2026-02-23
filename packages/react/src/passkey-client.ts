import type {
  PasskeyListResult,
  StartPasskeyRegistrationBody,
  FinishPasskeyRegistrationBody,
  CreationOptionsJSON,
} from "./passkey-types.js";

export interface PasskeyClientOptions {
  apiUrl: string;
}

export interface PasskeyClient {
  list(): Promise<PasskeyListResult>;
  startRegistration(body?: StartPasskeyRegistrationBody): Promise<CreationOptionsJSON>;
  finishRegistration(body: FinishPasskeyRegistrationBody): Promise<{ credentialId: string }>;
  revoke(credentialId: string): Promise<{ revoked: boolean }>;
}

function baseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/$/, "");
}

export function createPasskeyClient(options: PasskeyClientOptions): PasskeyClient {
  const base = baseUrl(options.apiUrl);

  return {
    async list(): Promise<PasskeyListResult> {
      const res = await fetch(`${base}/passkeys`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `List passkeys failed: ${res.status}`);
      }
      return res.json() as Promise<PasskeyListResult>;
    },

    async startRegistration(body?: StartPasskeyRegistrationBody): Promise<CreationOptionsJSON> {
      const res = await fetch(`${base}/passkeys/registration/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Start passkey registration failed: ${res.status}`);
      }
      return res.json() as Promise<CreationOptionsJSON>;
    },

    async finishRegistration(body: FinishPasskeyRegistrationBody): Promise<{ credentialId: string }> {
      const res = await fetch(`${base}/passkeys/registration/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Finish passkey registration failed: ${res.status}`);
      }
      return res.json() as Promise<{ credentialId: string }>;
    },

    async revoke(credentialId: string): Promise<{ revoked: boolean }> {
      const res = await fetch(`${base}/passkeys/${encodeURIComponent(credentialId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `Revoke passkey failed: ${res.status}`);
      }
      return res.json() as Promise<{ revoked: boolean }>;
    },
  };
}

export function serializeRegistrationResponse(credential: globalThis.PublicKeyCredential): FinishPasskeyRegistrationBody["response"] {
  const response = credential.response as AuthenticatorAttestationResponse;
  const rawIdB64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const clientDataB64 = btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const attestationB64 = btoa(String.fromCharCode(...new Uint8Array(response.attestationObject))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ext = credential.getClientExtensionResults?.();
  const authAttachment = credential.authenticatorAttachment ?? undefined;
  return {
    id: credential.id,
    rawId: rawIdB64,
    response: {
      clientDataJSON: clientDataB64,
      attestationObject: attestationB64,
      transports: response.getTransports?.() ?? undefined,
    },
    type: "public-key",
    clientExtensionResults: ext ? (ext as Record<string, unknown>) : undefined,
    authenticatorAttachment: authAttachment === "platform" || authAttachment === "cross-platform" ? authAttachment : undefined,
  };
}
