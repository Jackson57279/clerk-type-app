import { describe, it, expect } from "vitest";
import {
  generateCodeVerifier,
  computeCodeChallenge,
  createAuthorizationCode,
} from "../src/authorization-code-pkce.js";
import { handleAuthorizationCodeFlow } from "../src/authorization-code-exchange.js";

const SECRET = "oauth-server-secret";
const REDIRECT_URI = "https://app.example/callback";
const CLIENT_ID = "my-spa-client";
const SUB = "user-123";
const SCOPE = "openid profile";

describe("Authorization Code + PKCE full flow", () => {
  it("completes authorize → redirect with code → token request → access token (S256)", () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier, "S256");

    const { code } = createAuthorizationCode(
      {
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scope: SCOPE,
        sub: SUB,
        codeChallenge,
        codeChallengeMethod: "S256",
        state: "csrf-state-xyz",
      },
      SECRET
    );

    const tokenResponse = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );

    expect("error" in tokenResponse).toBe(false);
    if ("access_token" in tokenResponse) {
      expect(tokenResponse.access_token).toBeDefined();
      expect(tokenResponse.token_type).toBe("Bearer");
      expect(tokenResponse.expires_in).toBeGreaterThan(0);
      expect(tokenResponse.scope).toBe(SCOPE);
    }
  });

  it("returns access_token and refresh_token when issueRefreshToken is true", () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier, "S256");

    const { code } = createAuthorizationCode(
      {
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scope: SCOPE,
        sub: SUB,
        codeChallenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );

    const tokenResponse = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET, issueRefreshToken: true }
    );

    expect("error" in tokenResponse).toBe(false);
    if ("access_token" in tokenResponse) {
      expect(tokenResponse.access_token).toBeDefined();
      expect(tokenResponse.refresh_token).toBeDefined();
    }
  });

  it("rejects token request when code_verifier does not match code_challenge", () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier, "S256");

    const { code } = createAuthorizationCode(
      {
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        sub: SUB,
        codeChallenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );

    const tokenResponse = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: "wrong_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );

    expect("error" in tokenResponse).toBe(true);
    if ("error" in tokenResponse) {
      expect(tokenResponse.error).toBe("invalid_grant");
    }
  });

  it("rejects second token request (single-use code)", () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier, "S256");

    const { code } = createAuthorizationCode(
      {
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        sub: SUB,
        codeChallenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );

    const first = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );
    expect("error" in first).toBe(false);

    const second = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );
    expect("error" in second).toBe(true);
    if ("error" in second) expect(second.error).toBe("invalid_grant");
  });
});
