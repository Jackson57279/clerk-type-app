import { createHmac } from "crypto";
import { createAuthorizationCode } from "./authorization-code-pkce.js";
import type { CodeChallengeMethod } from "./authorization-code-pkce.js";
import {
  handleAuthorizationCodeFlow,
  type ExchangeAuthorizationCodeOptions,
} from "./authorization-code-exchange.js";
import {
  handleRefreshTokenFlow,
  type ExchangeRefreshTokenOptions,
} from "./refresh-token.js";
import {
  handleClientCredentialsFlow,
  type ClientVerifier,
} from "./client-credentials.js";

function decodeBase64url(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
  return Buffer.from(base64, "base64");
}

export interface OAuth2Client {
  allowedRedirectUris: string[];
  verifySecret(secret: string): boolean;
}

export type OAuth2ClientResolver = (clientId: string) => OAuth2Client | null;

export interface AuthorizationRequestQuery {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export type AuthorizationRequestValidationSuccess = {
  ok: true;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: CodeChallengeMethod;
};

export type AuthorizationRequestValidationError = {
  ok: false;
  redirect_uri: string | null;
  error: string;
  error_description: string;
  state?: string;
};

export type AuthorizationRequestValidationResult =
  | AuthorizationRequestValidationSuccess
  | AuthorizationRequestValidationError;

export function validateAuthorizationRequest(
  query: AuthorizationRequestQuery,
  clientResolver: OAuth2ClientResolver
): AuthorizationRequestValidationResult {
  const responseType = query.response_type?.trim();
  if (responseType !== "code") {
    return {
      ok: false,
      redirect_uri: query.redirect_uri?.trim() ?? null,
      error: "unsupported_response_type",
      error_description: "response_type must be code",
      state: query.state?.trim() || undefined,
    };
  }

  const clientId = query.client_id?.trim();
  if (!clientId) {
    return {
      ok: false,
      redirect_uri: query.redirect_uri?.trim() ?? null,
      error: "invalid_request",
      error_description: "client_id is required",
      state: query.state?.trim() || undefined,
    };
  }

  const client = clientResolver(clientId);
  if (!client) {
    return {
      ok: false,
      redirect_uri: query.redirect_uri?.trim() ?? null,
      error: "invalid_client",
      error_description: "Unknown client",
      state: query.state?.trim() || undefined,
    };
  }

  const redirectUri = query.redirect_uri?.trim();
  if (!redirectUri) {
    return {
      ok: false,
      redirect_uri: null,
      error: "invalid_request",
      error_description: "redirect_uri is required",
      state: query.state?.trim() || undefined,
    };
  }

  const allowed = client.allowedRedirectUris;
  const allowedSet = new Set(allowed.map((u) => u.toLowerCase?.() ?? u));
  if (!allowedSet.has(redirectUri.toLowerCase?.() ?? redirectUri)) {
    return {
      ok: false,
      redirect_uri: redirectUri,
      error: "invalid_request",
      error_description: "redirect_uri not allowed",
      state: query.state?.trim() || undefined,
    };
  }

  const codeChallenge = query.code_challenge?.trim();
  if (!codeChallenge) {
    return {
      ok: false,
      redirect_uri: redirectUri,
      error: "invalid_request",
      error_description: "code_challenge is required (PKCE)",
      state: query.state?.trim() || undefined,
    };
  }

  const method = (query.code_challenge_method?.trim() || "S256") as string;
  if (method !== "S256" && method !== "plain") {
    return {
      ok: false,
      redirect_uri: redirectUri,
      error: "invalid_request",
      error_description: "code_challenge_method must be S256 or plain",
      state: query.state?.trim() || undefined,
    };
  }

  return {
    ok: true,
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: query.scope?.trim() || undefined,
    state: query.state?.trim() || undefined,
    code_challenge: codeChallenge,
    code_challenge_method: method as CodeChallengeMethod,
  };
}

export interface CreateAuthorizationRedirectOptions {
  secret: string;
  codeTtlMs?: number;
}

export function createAuthorizationRedirect(
  validated: AuthorizationRequestValidationSuccess,
  sub: string,
  options: CreateAuthorizationRedirectOptions
): string {
  const { code } = createAuthorizationCode(
    {
      clientId: validated.client_id,
      redirectUri: validated.redirect_uri,
      scope: validated.scope,
      sub,
      codeChallenge: validated.code_challenge,
      codeChallengeMethod: validated.code_challenge_method,
      state: validated.state,
    },
    options.secret,
    { ttlMs: options.codeTtlMs }
  );
  const url = new URL(validated.redirect_uri);
  url.searchParams.set("code", code);
  if (validated.state) url.searchParams.set("state", validated.state);
  return url.toString();
}

export function buildAuthorizationErrorRedirect(
  error: AuthorizationRequestValidationError
): string | null {
  if (!error.redirect_uri) return null;
  const url = new URL(error.redirect_uri);
  url.searchParams.set("error", error.error);
  url.searchParams.set("error_description", error.error_description);
  if (error.state) url.searchParams.set("state", error.state);
  return url.toString();
}

export interface TokenEndpointParams {
  grant_type?: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  scope?: string;
}

export interface TokenEndpointOptions extends ExchangeAuthorizationCodeOptions {
  clientResolver: OAuth2ClientResolver;
  supportClientCredentials?: boolean;
  clientVerifier?: ClientVerifier;
  ttlMs?: number;
  keySet?: ExchangeRefreshTokenOptions["keySet"];
  usedTokenStore?: ExchangeRefreshTokenOptions["usedTokenStore"];
  rotateRefreshToken?: boolean;
}

function parseBasicAuth(header: string): { clientId: string; clientSecret: string } | null {
  const parts = header.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "basic" || !parts[1]) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(parts[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  const clientId = decoded.slice(0, colon);
  const clientSecret = decoded.slice(colon + 1);
  return { clientId, clientSecret };
}

export function parseClientAuth(
  body: TokenEndpointParams,
  authorizationHeader?: string
): { clientId: string; clientSecret: string } | null {
  if (authorizationHeader) {
    const basic = parseBasicAuth(authorizationHeader);
    if (basic) return basic;
  }
  const clientId = body.client_id?.trim();
  const clientSecret = body.client_secret ?? "";
  if (!clientId) return null;
  return { clientId, clientSecret };
}

export type TokenEndpointSuccess = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
  refresh_token?: string;
};

export type TokenEndpointError = {
  error: string;
  error_description: string;
};

export type TokenEndpointResponse = TokenEndpointSuccess | TokenEndpointError;

export function handleTokenRequest(
  params: TokenEndpointParams,
  options: TokenEndpointOptions,
  authorizationHeader?: string
): TokenEndpointResponse {
  const auth = parseClientAuth(params, authorizationHeader);
  if (!auth) {
    return {
      error: "invalid_client",
      error_description: "Client authentication required",
    };
  }

  const client = options.clientResolver(auth.clientId);
  if (!client || !client.verifySecret(auth.clientSecret)) {
    return {
      error: "invalid_client",
      error_description: "Invalid client credentials",
    };
  }

  const grantType = params.grant_type?.trim();

  if (grantType === "authorization_code") {
    const result = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code: params.code,
        code_verifier: params.code_verifier,
        redirect_uri: params.redirect_uri,
        client_id: auth.clientId,
      },
      {
        secret: options.secret,
        usedCodeStore: options.usedCodeStore,
        accessTokenTtlMs: options.accessTokenTtlMs,
        issueRefreshToken: options.issueRefreshToken,
        iss: options.iss,
        aud: options.aud,
      }
    );
    if ("error" in result) return result;
    return result;
  }

  if (grantType === "refresh_token") {
    const result = handleRefreshTokenFlow(
      {
        grant_type: "refresh_token",
        refresh_token: params.refresh_token,
        client_id: auth.clientId,
      },
      {
        secret: options.secret,
        keySet: options.keySet,
        usedTokenStore: options.usedTokenStore,
        accessTokenTtlMs: options.accessTokenTtlMs,
        rotateRefreshToken: options.rotateRefreshToken,
        iss: options.iss,
        aud: options.aud,
      }
    );
    if ("error" in result) return result;
    return result;
  }

  if (grantType === "client_credentials" && options.supportClientCredentials) {
    const clientVerifier: ClientVerifier = (cid: string, secret: string) => {
      const c = options.clientResolver(cid);
      if (!c || !c.verifySecret(secret)) return null;
      return options.clientVerifier?.(cid, secret) ?? {};
    };
    const result = handleClientCredentialsFlow(
      {
        grant_type: "client_credentials",
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        scope: params.scope,
      },
      {
        secret: options.secret,
        clientVerifier,
        scope: params.scope,
        ttlMs: options.ttlMs,
        iss: options.iss,
        aud: options.aud,
      }
    );
    if ("error" in result) return result;
    return result;
  }

  return {
    error: "unsupported_grant_type",
    error_description: grantType
      ? `Unsupported grant_type: ${grantType}`
      : "grant_type is required",
  };
}

export interface OpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri?: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
}

export function getOpenIdConfiguration(issuer: string): OpenIdConfiguration {
  const base = issuer.replace(/\/$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth2/authorize`,
    token_endpoint: `${base}/oauth2/token`,
    userinfo_endpoint: `${base}/oauth2/userinfo`,
    scopes_supported: ["openid", "profile", "email"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256", "plain"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["HS256"],
  };
}

export interface OAuth2AccessTokenPayload {
  sub: string;
  client_id: string;
  scope?: string;
  iat: number;
  exp: number;
  jti: string;
  iss?: string;
  aud?: string;
}

export function verifyOAuth2AccessToken(
  token: string,
  secret: string
): OAuth2AccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  const base64url = (buf: Buffer) =>
    buf
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
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
    iat: typeof iat === "number" ? iat : 0,
    exp,
    jti: typeof jti === "string" ? jti : "",
    iss: data.iss as string | undefined,
    aud: data.aud as string | undefined,
  };
}

export interface UserInfoClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
}

export type UserInfoResolver = (sub: string) => UserInfoClaims | Promise<UserInfoClaims>;

export interface UserInfoEndpointOptions {
  secret: string;
  getUserClaims: UserInfoResolver;
}

export type UserInfoResult =
  | { ok: true; claims: UserInfoClaims }
  | { ok: false; error: "invalid_token"; status: 401 };

export async function getUserInfo(
  bearerToken: string,
  options: UserInfoEndpointOptions
): Promise<UserInfoResult> {
  const payload = verifyOAuth2AccessToken(bearerToken, options.secret);
  if (!payload) {
    return { ok: false, error: "invalid_token", status: 401 };
  }
  const claims = await Promise.resolve(options.getUserClaims(payload.sub));
  const result: UserInfoClaims = { sub: claims.sub };
  const scope = payload.scope?.split(/\s+/) ?? [];
  if (scope.includes("email") && claims.email !== undefined) {
    result.email = claims.email;
    result.email_verified = claims.email_verified;
  }
  if (scope.includes("profile") || scope.includes("openid")) {
    if (claims.name !== undefined) result.name = claims.name;
    if (claims.preferred_username !== undefined)
      result.preferred_username = claims.preferred_username;
  }
  if (scope.includes("openid") && result.sub === undefined) result.sub = claims.sub;
  result.sub = claims.sub;
  return { ok: true, claims: result };
}
