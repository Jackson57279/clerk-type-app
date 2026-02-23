import { createHmac, randomBytes } from "crypto";

export type SocialLoginProvider = "google" | "github" | "microsoft";

export interface SocialLoginProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
}

function getEnvOptional(name: string): string | undefined {
  return process.env[name];
}

export function getProviderConfig(provider: SocialLoginProvider): SocialLoginProviderConfig | null {
  switch (provider) {
    case "google": {
      const clientId = getEnvOptional("GOOGLE_CLIENT_ID");
      const clientSecret = getEnvOptional("GOOGLE_CLIENT_SECRET");
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userinfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
        scopes: ["openid", "email", "profile"],
      };
    }
    case "github": {
      const clientId = getEnvOptional("GITHUB_CLIENT_ID");
      const clientSecret = getEnvOptional("GITHUB_CLIENT_SECRET");
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        userinfoUrl: "https://api.github.com/user",
        scopes: ["user:email"],
      };
    }
    case "microsoft": {
      const clientId = getEnvOptional("MICROSOFT_CLIENT_ID");
      const clientSecret = getEnvOptional("MICROSOFT_CLIENT_SECRET");
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        userinfoUrl: "https://graph.microsoft.com/oidc/userinfo",
        scopes: ["openid", "email", "profile"],
      };
    }
    default:
      return null;
  }
}

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

export interface SocialLoginStatePayload {
  provider: SocialLoginProvider;
  redirectUri?: string;
  nonce: string;
}

export function createSocialLoginState(
  secret: string,
  provider: SocialLoginProvider,
  options: { redirectUri?: string } = {}
): string {
  const nonce = randomBytes(16).toString("hex");
  const payload: SocialLoginStatePayload = {
    provider,
    redirectUri: options.redirectUri,
    nonce,
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return `${payloadB64}.${base64url(sig)}`;
}

export function verifySocialLoginState(
  secret: string,
  state: string
): SocialLoginStatePayload | null {
  const dot = state.indexOf(".");
  if (dot === -1) return null;
  const payloadB64 = state.slice(0, dot);
  const sigB64 = state.slice(dot + 1);
  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
  if (sigB64 !== base64url(expectedSig)) return null;
  try {
    const buf = decodeBase64url(payloadB64);
    const data = JSON.parse(buf.toString("utf8")) as SocialLoginStatePayload;
    if (
      typeof data.provider !== "string" ||
      typeof data.nonce !== "string" ||
      !["google", "github", "microsoft"].includes(data.provider)
    ) {
      return null;
    }
    return {
      provider: data.provider as SocialLoginProvider,
      redirectUri: typeof data.redirectUri === "string" ? data.redirectUri : undefined,
      nonce: data.nonce,
    };
  } catch {
    return null;
  }
}

export function getSocialLoginAuthorizationUrl(
  provider: SocialLoginProvider,
  redirectUri: string,
  state: string
): string | null {
  const config = getProviderConfig(provider);
  if (!config) return null;
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  if (provider === "google" || provider === "microsoft") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeSocialLoginCode(
  provider: SocialLoginProvider,
  code: string,
  redirectUri: string
): Promise<TokenResponse | null> {
  const config = getProviderConfig(provider);
  if (!config) return null;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  const access_token = data.access_token;
  if (typeof access_token !== "string") return null;
  return {
    access_token,
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
    scope: typeof data.scope === "string" ? data.scope : undefined,
  };
}

export interface SocialLoginProfile {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

export async function fetchSocialLoginProfile(
  provider: SocialLoginProvider,
  accessToken: string
): Promise<SocialLoginProfile | null> {
  const config = getProviderConfig(provider);
  if (!config) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  const res = await fetch(config.userinfoUrl, { headers });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, unknown>;
  let id: string;
  let email: string | null = null;
  let name: string | null = null;
  let picture: string | null = null;

  switch (provider) {
    case "google":
      id = String(data.id ?? data.sub ?? "");
      email = typeof data.email === "string" ? data.email : null;
      name = typeof data.name === "string" ? data.name : null;
      picture = typeof data.picture === "string" ? data.picture : null;
      break;
    case "github":
      id = String(data.id ?? "");
      email = typeof data.email === "string" ? data.email : null;
      name = typeof data.name === "string" ? data.name : (typeof data.login === "string" ? data.login : null);
      picture = typeof data.avatar_url === "string" ? data.avatar_url : null;
      if (!email && typeof data.login === "string") {
        const emailRes = await fetch("https://api.github.com/user/emails", { headers });
        if (emailRes.ok) {
          const emails = (await emailRes.json()) as Array<{ email: string; primary?: boolean }>;
          const primary = emails.find((e) => e.primary) ?? emails[0];
          if (primary?.email) email = primary.email;
        }
      }
      break;
    case "microsoft":
      id = String(data.sub ?? data.oid ?? data.id ?? "");
      email = typeof data.email === "string" ? data.email : (typeof data.preferred_username === "string" ? data.preferred_username : null);
      name = typeof data.name === "string" ? data.name : null;
      picture = typeof data.picture === "string" ? data.picture : null;
      break;
    default:
      return null;
  }
  if (!id) return null;
  return { id, email, name, picture };
}

export interface SocialLoginUser {
  id: string;
  email: string;
}

export interface OAuthAccountRow {
  userId: string;
  provider: string;
  providerAccountId: string;
}

export interface SocialLoginStore {
  findUserByEmail(email: string): Promise<SocialLoginUser | null>;
  createUser(data: {
    email: string;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }): Promise<SocialLoginUser>;
  findOAuthAccount(provider: string, providerAccountId: string): Promise<OAuthAccountRow | null>;
  createOAuthAccount(data: {
    userId: string;
    provider: string;
    providerAccountId: string;
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: Date | null;
    profileData?: Record<string, unknown> | null;
  }): Promise<void>;
  updateOAuthAccount(
    provider: string,
    providerAccountId: string,
    data: {
      accessToken?: string | null;
      refreshToken?: string | null;
      expiresAt?: Date | null;
      profileData?: Record<string, unknown> | null;
    }
  ): Promise<void>;
}

export interface HandleSocialLoginCallbackOptions {
  secret: string;
  store: SocialLoginStore;
  isAllowedEmail?: (email: string) => boolean;
}

export type HandleSocialLoginCallbackSuccess = { ok: true; userId: string };
export type HandleSocialLoginCallbackError =
  | { ok: false; error: "provider_disabled" }
  | { ok: false; error: "invalid_state" }
  | { ok: false; error: "token_exchange_failed" }
  | { ok: false; error: "profile_fetch_failed" }
  | { ok: false; error: "email_not_allowed" }
  | { ok: false; error: "email_required" };

export type HandleSocialLoginCallbackResult =
  | HandleSocialLoginCallbackSuccess
  | HandleSocialLoginCallbackError;

export async function handleSocialLoginCallback(
  provider: SocialLoginProvider,
  code: string,
  redirectUri: string,
  state: string,
  options: HandleSocialLoginCallbackOptions
): Promise<HandleSocialLoginCallbackResult> {
  const { secret, store, isAllowedEmail } = options;
  if (!getProviderConfig(provider)) {
    return { ok: false, error: "provider_disabled" };
  }
  const statePayload = verifySocialLoginState(secret, state);
  if (!statePayload || statePayload.provider !== provider) {
    return { ok: false, error: "invalid_state" };
  }
  const tokens = await exchangeSocialLoginCode(provider, code, redirectUri);
  if (!tokens) return { ok: false, error: "token_exchange_failed" };
  const profile = await fetchSocialLoginProfile(provider, tokens.access_token);
  if (!profile) return { ok: false, error: "profile_fetch_failed" };
  const email = profile.email?.trim().toLowerCase();
  if (!email) return { ok: false, error: "email_required" };
  if (isAllowedEmail && !isAllowedEmail(email)) {
    return { ok: false, error: "email_not_allowed" };
  }
  const existingLink = await store.findOAuthAccount(provider, profile.id);
  if (existingLink) {
    await store.updateOAuthAccount(provider, profile.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      profileData: { name: profile.name, picture: profile.picture },
    });
    return { ok: true, userId: existingLink.userId };
  }
  let user = await store.findUserByEmail(email);
  if (!user) {
    const nameParts = profile.name?.trim().split(/\s+/) ?? [];
    const firstName = nameParts[0] ?? null;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
    user = await store.createUser({
      email,
      name: profile.name ?? undefined,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
    });
  }
  await store.createOAuthAccount({
    userId: user.id,
    provider,
    providerAccountId: profile.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    profileData: { name: profile.name, picture: profile.picture },
  });
  return { ok: true, userId: user.id };
}
