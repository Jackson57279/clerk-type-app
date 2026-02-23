import { createHmac, randomBytes } from "crypto";

const DEFAULT_REFRESH_TOKEN_EXPIRES_IN_SEC = 30 * 24 * 60 * 60;
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

export interface RefreshTokenPayload {
  sub: string;
  clientId: string;
  scope?: string;
}

export interface CreateRefreshTokenOptions {
  expiresInSec?: number;
  iss?: string;
  aud?: string;
}

export interface CreateRefreshTokenResult {
  refresh_token: string;
  expires_in: number;
}

export function createRefreshToken(
  payload: RefreshTokenPayload,
  secret: string,
  options: CreateRefreshTokenOptions = {}
): CreateRefreshTokenResult {
  const expiresInSec = options.expiresInSec ?? DEFAULT_REFRESH_TOKEN_EXPIRES_IN_SEC;
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + expiresInSec;
  const jti = randomBytes(16).toString("hex");
  const tokenPayload: Record<string, unknown> = {
    sub: payload.sub,
    client_id: payload.clientId,
    iat: nowSec,
    exp: expSec,
    jti,
    purpose: "refresh",
  };
  if (payload.scope) tokenPayload.scope = payload.scope;
  if (options.iss) tokenPayload.iss = options.iss;
  if (options.aud) tokenPayload.aud = options.aud;

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = encodePayload(header as unknown as Record<string, unknown>);
  const payloadB64 = encodePayload(tokenPayload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  const refresh_token = `${signingInput}.${base64url(sig)}`;
  return { refresh_token, expires_in: expiresInSec };
}

export interface RefreshTokenPayloadVerified {
  sub: string;
  client_id: string;
  scope?: string;
  jti: string;
  exp: number;
  iat: number;
  iss?: string;
  aud?: string;
}

export function verifyRefreshToken(
  token: string,
  secret: string
): RefreshTokenPayloadVerified | null {
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
  if (data.purpose !== "refresh") return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = data.exp as number | undefined;
  if (typeof exp !== "number" || exp < nowSec) return null;
  const sub = data.sub as string | undefined;
  if (typeof sub !== "string") return null;
  const client_id = (data.client_id as string | undefined) ?? sub;
  const jti = data.jti as string | undefined;
  const iat = data.iat as number | undefined;
  return {
    sub,
    client_id,
    scope: data.scope as string | undefined,
    jti: typeof jti === "string" ? jti : "",
    exp,
    iat: typeof iat === "number" ? iat : 0,
    iss: data.iss as string | undefined,
    aud: data.aud as string | undefined,
  };
}

export interface UsedRefreshTokenStore {
  isUsed(jti: string): boolean;
  markUsed(jti: string, expiresAtMs: number): void;
}

export function createMemoryUsedRefreshTokenStore(): UsedRefreshTokenStore {
  const used = new Map<string, number>();
  return {
    isUsed(jti: string): boolean {
      const exp = used.get(jti);
      if (exp === undefined) return false;
      if (exp < Date.now()) {
        used.delete(jti);
        return false;
      }
      return true;
    },
    markUsed(jti: string, expiresAtMs: number): void {
      used.set(jti, expiresAtMs);
    },
  };
}

export interface RefreshTokenSuccessResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}

export interface RefreshTokenErrorResponse {
  error: "invalid_grant";
  error_description: string;
}

export interface RefreshTokenFlowParams {
  grant_type: string;
  refresh_token: string | undefined;
  client_id?: string;
}

export type RefreshTokenFlowErrorResponse =
  | { error: "unsupported_grant_type"; error_description: string }
  | { error: "invalid_request"; error_description: string }
  | RefreshTokenErrorResponse;

export type RefreshTokenFlowResponse =
  | RefreshTokenSuccessResponse
  | RefreshTokenFlowErrorResponse;

export type RefreshTokenFlowOptions = ExchangeRefreshTokenOptions;

export function handleRefreshTokenFlow(
  params: RefreshTokenFlowParams,
  options: RefreshTokenFlowOptions
): RefreshTokenFlowResponse {
  if (params.grant_type !== "refresh_token") {
    return {
      error: "unsupported_grant_type",
      error_description: "grant_type must be refresh_token",
    };
  }
  const refreshToken = params.refresh_token?.trim();
  if (!refreshToken) {
    return {
      error: "invalid_request",
      error_description: "refresh_token is required",
    };
  }
  const payload = verifyRefreshToken(refreshToken, options.secret);
  if (!payload) {
    return {
      error: "invalid_grant",
      error_description: "Invalid or expired refresh_token",
    };
  }
  if (
    params.client_id != null &&
    params.client_id.trim() !== "" &&
    payload.client_id !== params.client_id.trim()
  ) {
    return {
      error: "invalid_grant",
      error_description: "client_id does not match refresh token",
    };
  }
  return exchangeRefreshToken(refreshToken, options);
}

export interface ExchangeRefreshTokenOptions {
  secret: string;
  usedTokenStore?: UsedRefreshTokenStore;
  accessTokenTtlMs?: number;
  rotateRefreshToken?: boolean;
  iss?: string;
  aud?: string;
}

function issueAccessToken(
  sub: string,
  clientId: string,
  scope: string | undefined,
  options: { secret: string; ttlMs: number; iss?: string; aud?: string }
): { access_token: string; expires_in: number } {
  const nowMs = Date.now();
  const expSec = Math.floor((nowMs + options.ttlMs) / 1000);
  const iatSec = Math.floor(nowMs / 1000);
  const jti = randomBytes(16).toString("hex");
  const payload: Record<string, unknown> = {
    sub,
    client_id: clientId,
    iat: iatSec,
    exp: expSec,
    jti,
  };
  if (scope) payload.scope = scope;
  if (options.iss) payload.iss = options.iss;
  if (options.aud) payload.aud = options.aud;

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = encodePayload(header as unknown as Record<string, unknown>);
  const payloadB64 = encodePayload(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", options.secret).update(signingInput).digest();
  const access_token = `${signingInput}.${base64url(sig)}`;
  return {
    access_token,
    expires_in: Math.floor(options.ttlMs / 1000),
  };
}

export function exchangeRefreshToken(
  refreshToken: string,
  options: ExchangeRefreshTokenOptions
): RefreshTokenSuccessResponse | RefreshTokenErrorResponse {
  const payload = verifyRefreshToken(refreshToken, options.secret);
  if (!payload) {
    return { error: "invalid_grant", error_description: "Invalid or expired refresh_token" };
  }
  const store = options.usedTokenStore;
  if (store?.isUsed(payload.jti)) {
    return { error: "invalid_grant", error_description: "Refresh token was already used" };
  }
  const ttlMs = options.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
  const access = issueAccessToken(
    payload.sub,
    payload.client_id,
    payload.scope,
    {
      secret: options.secret,
      ttlMs,
      iss: options.iss,
      aud: options.aud,
    }
  );
  const result: RefreshTokenSuccessResponse = {
    access_token: access.access_token,
    token_type: "Bearer",
    expires_in: access.expires_in,
  };
  if (payload.scope) result.scope = payload.scope;

  if (store) store.markUsed(payload.jti, payload.exp * 1000);

  if (options.rotateRefreshToken && store) {
    const newRefresh = createRefreshToken(
      { sub: payload.sub, clientId: payload.client_id, scope: payload.scope },
      options.secret,
      { iss: options.iss, aud: options.aud }
    );
    result.refresh_token = newRefresh.refresh_token;
  }
  return result;
}
