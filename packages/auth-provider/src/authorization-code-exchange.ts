import { createHmac, randomBytes } from "crypto";
import {
  verifyAndConsumeAuthorizationCode,
  type UsedAuthorizationCodeStore,
} from "./authorization-code-pkce.js";
import { createRefreshToken } from "./refresh-token.js";

const DEFAULT_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodePayload(data: Record<string, unknown>): string {
  return base64url(Buffer.from(JSON.stringify(data), "utf8"));
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
  const headerB64 = encodePayload(header as Record<string, unknown>);
  const payloadB64 = encodePayload(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", options.secret).update(signingInput).digest();
  const access_token = `${signingInput}.${base64url(sig)}`;
  return {
    access_token,
    expires_in: Math.floor(options.ttlMs / 1000),
  };
}

export interface AuthorizationCodeExchangeSuccessResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}

export interface AuthorizationCodeExchangeErrorResponse {
  error: "invalid_grant" | "invalid_request" | "unsupported_grant_type";
  error_description: string;
}

export interface ExchangeAuthorizationCodeOptions {
  secret: string;
  usedCodeStore?: UsedAuthorizationCodeStore;
  accessTokenTtlMs?: number;
  issueRefreshToken?: boolean;
  iss?: string;
  aud?: string;
}

export function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string,
  options: ExchangeAuthorizationCodeOptions
): AuthorizationCodeExchangeSuccessResponse | AuthorizationCodeExchangeErrorResponse {
  const payload = verifyAndConsumeAuthorizationCode(
    code,
    codeVerifier,
    options.secret,
    { usedCodeStore: options.usedCodeStore }
  );
  if (!payload) {
    return {
      error: "invalid_grant",
      error_description: "Invalid or expired authorization code, or invalid code_verifier",
    };
  }
  if (payload.redirectUri !== redirectUri) {
    return {
      error: "invalid_grant",
      error_description: "redirect_uri does not match",
    };
  }
  if (payload.clientId !== clientId) {
    return {
      error: "invalid_grant",
      error_description: "client_id does not match",
    };
  }

  const ttlMs = options.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
  const access = issueAccessToken(
    payload.sub,
    payload.clientId,
    payload.scope,
    {
      secret: options.secret,
      ttlMs,
      iss: options.iss,
      aud: options.aud,
    }
  );

  const result: AuthorizationCodeExchangeSuccessResponse = {
    access_token: access.access_token,
    token_type: "Bearer",
    expires_in: access.expires_in,
  };
  if (payload.scope) result.scope = payload.scope;

  if (options.issueRefreshToken) {
    const refresh = createRefreshToken(
      { sub: payload.sub, clientId: payload.clientId, scope: payload.scope },
      options.secret,
      { iss: options.iss, aud: options.aud }
    );
    result.refresh_token = refresh.refresh_token;
  }

  return result;
}

export interface AuthorizationCodeFlowParams {
  grant_type: string;
  code: string | undefined;
  code_verifier: string | undefined;
  redirect_uri: string | undefined;
  client_id: string | undefined;
}

export type AuthorizationCodeFlowResponse =
  | AuthorizationCodeExchangeSuccessResponse
  | AuthorizationCodeExchangeErrorResponse;

export function handleAuthorizationCodeFlow(
  params: AuthorizationCodeFlowParams,
  options: ExchangeAuthorizationCodeOptions
): AuthorizationCodeFlowResponse {
  if (params.grant_type !== "authorization_code") {
    return {
      error: "unsupported_grant_type",
      error_description: "grant_type must be authorization_code",
    };
  }
  const code = params.code?.trim();
  if (!code) {
    return {
      error: "invalid_request",
      error_description: "code is required",
    };
  }
  const codeVerifier = params.code_verifier?.trim();
  if (!codeVerifier) {
    return {
      error: "invalid_request",
      error_description: "code_verifier is required",
    };
  }
  const redirectUri = params.redirect_uri?.trim();
  if (!redirectUri) {
    return {
      error: "invalid_request",
      error_description: "redirect_uri is required",
    };
  }
  const clientId = params.client_id?.trim();
  if (!clientId) {
    return {
      error: "invalid_request",
      error_description: "client_id is required",
    };
  }

  return exchangeAuthorizationCode(
    code,
    codeVerifier,
    redirectUri,
    clientId,
    options
  );
}
