import { createHmac, randomBytes } from "crypto";

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64url(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
  return Buffer.from(base64, "base64");
}

function encodePayload(data: Record<string, unknown>): string {
  return base64url(Buffer.from(JSON.stringify(data), "utf8"));
}

export interface ClientInfo {
  scope?: string;
  orgId?: string;
  permissions?: string[];
}

export type ClientVerifier = (
  clientId: string,
  clientSecret: string
) => ClientInfo | null;

export interface ExchangeClientCredentialsOptions {
  secret: string;
  clientVerifier: ClientVerifier;
  scope?: string;
  ttlMs?: number;
  iss?: string;
  aud?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
}

export interface ClientCredentialsErrorResponse {
  error: "invalid_client";
  error_description: string;
}

export interface ClientCredentialsTokenPayload {
  sub: string;
  client_id: string;
  scope?: string;
  org_id?: string;
  permissions?: string[];
  iss?: string;
  aud?: string;
  iat: number;
  exp: number;
  jti: string;
}

export function exchangeClientCredentials(
  clientId: string,
  clientSecret: string,
  options: ExchangeClientCredentialsOptions
): TokenResponse | ClientCredentialsErrorResponse {
  const client = options.clientVerifier(clientId, clientSecret);
  if (!client) {
    return { error: "invalid_client", error_description: "Invalid client credentials" };
  }

  const ttlMs = options.ttlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
  const nowMs = Date.now();
  const expSec = Math.floor((nowMs + ttlMs) / 1000);
  const iatSec = Math.floor(nowMs / 1000);
  const jti = randomBytes(16).toString("hex");
  const scope = options.scope ?? client.scope;

  const payload: Record<string, unknown> = {
    sub: clientId,
    client_id: clientId,
    iat: iatSec,
    exp: expSec,
    jti,
  };
  if (scope) payload.scope = scope;
  if (client.orgId) payload.org_id = client.orgId;
  if (client.permissions?.length) payload.permissions = client.permissions;
  if (options.iss) payload.iss = options.iss;
  if (options.aud) payload.aud = options.aud;

  const headerB64 = encodePayload(JWT_HEADER as unknown as Record<string, unknown>);
  const payloadB64 = encodePayload(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", options.secret).update(signingInput).digest();
  const access_token = `${signingInput}.${base64url(sig)}`;

  const expires_in = Math.floor(ttlMs / 1000);
  const result: TokenResponse = {
    access_token,
    token_type: "Bearer",
    expires_in,
  };
  if (scope) result.scope = scope;
  return result;
}

export function verifyClientCredentialsToken(
  token: string,
  secret: string
): ClientCredentialsTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  if (sigB64 !== base64url(expectedSig)) return null;
  let payloadBuf: Buffer;
  try {
    payloadBuf = decodeBase64url(payloadB64);
  } catch {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payloadBuf.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = data.exp as number | undefined;
  if (typeof exp !== "number" || exp < nowSec) return null;
  const sub = data.sub as string | undefined;
  if (typeof sub !== "string") return null;
  const client_id = (data.client_id as string | undefined) ?? sub;
  const iat = data.iat as number | undefined;
  const jti = data.jti as string | undefined;
  return {
    sub,
    client_id,
    scope: data.scope as string | undefined,
    org_id: data.org_id as string | undefined,
    permissions: data.permissions as string[] | undefined,
    iss: data.iss as string | undefined,
    aud: data.aud as string | undefined,
    iat: typeof iat === "number" ? iat : 0,
    exp,
    jti: typeof jti === "string" ? jti : "",
  };
}
