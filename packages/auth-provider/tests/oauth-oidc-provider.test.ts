import { describe, it, expect } from "vitest";
import {
  validateAuthorizationRequest,
  createAuthorizationRedirect,
  buildAuthorizationErrorRedirect,
  parseClientAuth,
  handleTokenRequest,
  getOpenIdConfiguration,
  verifyOAuth2AccessToken,
  getUserInfo,
} from "../src/oauth-oidc-provider.js";
import {
  generateCodeVerifier,
  computeCodeChallenge,
  createMemoryUsedAuthorizationCodeStore,
} from "../src/authorization-code-pkce.js";
import type { OAuth2Client, OAuth2ClientResolver } from "../src/oauth-oidc-provider.js";

const ISSUER = "https://auth.example.com";
const SECRET = "oidc-secret";
const REDIRECT_URI = "https://app.example.com/cb";
const CLIENT_ID = "app-1";
const CLIENT_SECRET = "secret-123";

const client: OAuth2Client = {
  allowedRedirectUris: [REDIRECT_URI, "https://app.example.com/cb2"],
  verifySecret(secret: string) {
    return secret === CLIENT_SECRET;
  },
};

const clientResolver: OAuth2ClientResolver = (clientId) => {
  if (clientId === CLIENT_ID) return client;
  return null;
};

describe("validateAuthorizationRequest", () => {
  it("returns success for valid request with PKCE", () => {
    const result = validateAuthorizationRequest(
      {
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: "openid profile",
        state: "xyz",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
      },
      clientResolver
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.client_id).toBe(CLIENT_ID);
      expect(result.redirect_uri).toBe(REDIRECT_URI);
      expect(result.scope).toBe("openid profile");
      expect(result.state).toBe("xyz");
      expect(result.code_challenge_method).toBe("S256");
    }
  });

  it("returns error when response_type is not code", () => {
    const result = validateAuthorizationRequest(
      {
        response_type: "token",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: "challenge",
        code_challenge_method: "S256",
      },
      clientResolver
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unsupported_response_type");
    }
  });

  it("returns error when client_id is unknown", () => {
    const result = validateAuthorizationRequest(
      {
        response_type: "code",
        client_id: "unknown",
        redirect_uri: REDIRECT_URI,
        code_challenge: "challenge",
        code_challenge_method: "S256",
      },
      clientResolver
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_client");
  });

  it("returns error when redirect_uri not allowed", () => {
    const result = validateAuthorizationRequest(
      {
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: "https://evil.example/cb",
        code_challenge: "challenge",
        code_challenge_method: "S256",
      },
      clientResolver
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_request");
  });

  it("returns error when code_challenge missing", () => {
    const result = validateAuthorizationRequest(
      {
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge_method: "S256",
      },
      clientResolver
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error_description).toContain("code_challenge");
  });
});

describe("createAuthorizationRedirect", () => {
  it("returns redirect URL with code and state", () => {
    const validated = validateAuthorizationRequest(
      {
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        state: "csrf-1",
        code_challenge: computeCodeChallenge(generateCodeVerifier(), "S256"),
        code_challenge_method: "S256",
      },
      clientResolver
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const url = createAuthorizationRedirect(validated, "user-99", {
      secret: SECRET,
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(REDIRECT_URI);
    expect(parsed.searchParams.get("code")).toBeTruthy();
    expect(parsed.searchParams.get("state")).toBe("csrf-1");
  });
});

describe("buildAuthorizationErrorRedirect", () => {
  it("returns URL with error and state when redirect_uri present", () => {
    const url = buildAuthorizationErrorRedirect({
      ok: false,
      redirect_uri: REDIRECT_URI,
      error: "invalid_client",
      error_description: "Unknown client",
      state: "s1",
    });
    expect(url).toBeTruthy();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("error")).toBe("invalid_client");
    expect(parsed.searchParams.get("state")).toBe("s1");
  });

  it("returns null when redirect_uri is null", () => {
    const url = buildAuthorizationErrorRedirect({
      ok: false,
      redirect_uri: null,
      error: "invalid_request",
      error_description: "redirect_uri is required",
    });
    expect(url).toBeNull();
  });
});

describe("parseClientAuth", () => {
  it("parses Basic header", () => {
    const encoded = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64");
    const auth = parseClientAuth({}, `Basic ${encoded}`);
    expect(auth).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  });

  it("parses body client_id and client_secret", () => {
    const auth = parseClientAuth({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(auth).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  });

  it("returns null when no auth", () => {
    expect(parseClientAuth({})).toBeNull();
    expect(parseClientAuth({ client_id: CLIENT_ID })).toEqual({
      clientId: CLIENT_ID,
      clientSecret: "",
    });
  });
});

describe("handleTokenRequest", () => {
  it("returns invalid_client when client auth missing", () => {
    const result = handleTokenRequest(
      { grant_type: "authorization_code", code: "x", code_verifier: "y", redirect_uri: REDIRECT_URI },
      { secret: SECRET, clientResolver }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_client");
  });

  it("exchanges authorization_code for access_token", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const redirect = createAuthorizationRedirect(
      {
        ok: true,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
      "user-1",
      { secret: SECRET }
    );
    const code = new URL(redirect).searchParams.get("code")!;
    const result = handleTokenRequest(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      { secret: SECRET, clientResolver }
    );
    expect("error" in result).toBe(false);
    if ("access_token" in result) {
      expect(result.access_token).toBeTruthy();
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBeGreaterThan(0);
    }
  });

  it("exchanges refresh_token for access_token", () => {
    const usedCodeStore = createMemoryUsedAuthorizationCodeStore();
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const redirect = createAuthorizationRedirect(
      {
        ok: true,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
      "user-1",
      { secret: SECRET }
    );
    const code = new URL(redirect).searchParams.get("code")!;
    const tokenRes = handleTokenRequest(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      {
        secret: SECRET,
        clientResolver,
        usedCodeStore,
        issueRefreshToken: true,
      }
    );
    expect("error" in tokenRes).toBe(false);
    const refresh = "refresh_token" in tokenRes ? tokenRes.refresh_token : undefined;
    expect(refresh).toBeTruthy();
    if (!refresh) return;
    const refreshResult = handleTokenRequest(
      {
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      { secret: SECRET, clientResolver }
    );
    expect("error" in refreshResult).toBe(false);
    if ("access_token" in refreshResult)
      expect(refreshResult.access_token).toBeTruthy();
  });

  it("returns unsupported_grant_type for unknown grant_type", () => {
    const encoded = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64");
    const result = handleTokenRequest(
      {
        grant_type: "password",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      { secret: SECRET, clientResolver },
      `Basic ${encoded}`
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("unsupported_grant_type");
  });
});

describe("getOpenIdConfiguration", () => {
  it("returns discovery document with issuer and endpoints", () => {
    const doc = getOpenIdConfiguration(ISSUER);
    expect(doc.issuer).toBe(ISSUER);
    expect(doc.authorization_endpoint).toBe(`${ISSUER}/oauth2/authorize`);
    expect(doc.token_endpoint).toBe(`${ISSUER}/oauth2/token`);
    expect(doc.userinfo_endpoint).toBe(`${ISSUER}/oauth2/userinfo`);
    expect(doc.scopes_supported).toContain("openid");
    expect(doc.response_types_supported).toContain("code");
    expect(doc.grant_types_supported).toContain("authorization_code");
    expect(doc.code_challenge_methods_supported).toContain("S256");
  });
});

describe("verifyOAuth2AccessToken", () => {
  it("returns payload for token from authorization_code flow", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const redirect = createAuthorizationRedirect(
      {
        ok: true,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
      "user-42",
      { secret: SECRET }
    );
    const code = new URL(redirect).searchParams.get("code")!;
    const tokenRes = handleTokenRequest(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      { secret: SECRET, clientResolver }
    );
    expect("access_token" in tokenRes).toBe(true);
    const accessToken = "access_token" in tokenRes ? tokenRes.access_token : "";
    const payload = verifyOAuth2AccessToken(accessToken, SECRET);
    expect(payload).not.toBeNull();
    if (payload) {
      expect(payload.sub).toBe("user-42");
      expect(payload.client_id).toBe(CLIENT_ID);
    }
  });

  it("returns null for wrong secret", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const redirect = createAuthorizationRedirect(
      {
        ok: true,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
      "user-1",
      { secret: SECRET }
    );
    const code = new URL(redirect).searchParams.get("code")!;
    const tokenRes = handleTokenRequest(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      { secret: SECRET, clientResolver }
    );
    const accessToken = "access_token" in tokenRes ? tokenRes.access_token : "";
    expect(verifyOAuth2AccessToken(accessToken, "wrong-secret")).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyOAuth2AccessToken("a.b", SECRET)).toBeNull();
    expect(verifyOAuth2AccessToken("", SECRET)).toBeNull();
  });
});

describe("getUserInfo", () => {
  it("returns claims for valid token and openid scope", async () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const redirect = createAuthorizationRedirect(
      {
        ok: true,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: "openid profile email",
        code_challenge: challenge,
        code_challenge_method: "S256",
      },
      "user-7",
      { secret: SECRET }
    );
    const code = new URL(redirect).searchParams.get("code")!;
    const tokenRes = handleTokenRequest(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
      { secret: SECRET, clientResolver }
    );
    const accessToken = "access_token" in tokenRes ? tokenRes.access_token : "";
    const result = await getUserInfo(accessToken, {
      secret: SECRET,
      getUserClaims: (sub) => ({
        sub,
        email: "u@example.com",
        email_verified: true,
        name: "User Seven",
        preferred_username: "user7",
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe("user-7");
      expect(result.claims.email).toBe("u@example.com");
      expect(result.claims.name).toBe("User Seven");
    }
  });

  it("returns invalid_token for invalid access token", async () => {
    const result = await getUserInfo("invalid.jwt.here", {
      secret: SECRET,
      getUserClaims: (sub) => ({ sub }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_token");
      expect(result.status).toBe(401);
    }
  });
});
