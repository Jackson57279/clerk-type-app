export interface PasskeyInfo {
  credentialId: string;
  friendlyName?: string | null;
  deviceType: string;
  deviceInfo?: string | null;
  lastUsedAt?: string | null;
}

export interface PasskeyListResult {
  passkeys: PasskeyInfo[];
}

export interface StartPasskeyRegistrationBody {
  userName?: string;
  userDisplayName?: string;
  residentKeyRequirement?: "discouraged" | "preferred" | "required";
}

export interface FinishPasskeyRegistrationBody {
  response: RegistrationResponseJSON;
  name?: string;
  deviceInfo?: string;
}

export interface RegistrationResponseJSON {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  type: "public-key";
  clientExtensionResults?: Record<string, unknown>;
  authenticatorAttachment?: "platform" | "cross-platform";
}

export interface CreationOptionsJSON {
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  timeout?: number;
  excludeCredentials?: Array<{ id: string; transports?: string[] }>;
  authenticatorSelection?: Record<string, unknown>;
}

function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function creationOptionsToPublicKey(opt: CreationOptionsJSON): CredentialCreationOptions {
  const challenge = base64UrlToBuffer(opt.challenge);
  const userId = base64UrlToBuffer(opt.user.id);
  const pubKeyCredParams: PublicKeyCredentialParameters[] = opt.pubKeyCredParams.map((p) => ({
    type: "public-key",
    alg: p.alg,
  }));
  const excludeCredentials: PublicKeyCredentialDescriptor[] | undefined = opt.excludeCredentials?.map((c) => ({
    type: "public-key",
    id: base64UrlToBuffer(c.id),
    transports: c.transports as AuthenticatorTransport[] | undefined,
  }));
  return {
    publicKey: {
      rp: opt.rp,
      user: { ...opt.user, id: userId },
      challenge,
      pubKeyCredParams,
      timeout: opt.timeout,
      excludeCredentials,
      authenticatorSelection: opt.authenticatorSelection,
    },
  };
}
