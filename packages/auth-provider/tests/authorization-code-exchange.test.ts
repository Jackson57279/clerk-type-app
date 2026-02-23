import { describe, it, expect } from "vitest";
import {
  generateCodeVerifier,
  computeCodeChallenge,
  createAuthorizationCode,
  createMemoryUsedAuthorizationCodeStore,
} from "../src/authorization-code-pkce.js";
import {
  exchangeAuthorizationCode,
  handleAuthorizationCodeFlow,
} from "../src/authorization-code-exchange.js";

const SECRET = "oauth-server-secret";
const REDIRECT_URI = "https://app.example/callback";
const CLIENT_ID = "my-client";

function makeCodeAndVerifier(overrides: {
  redirectUri?: string;
  clientId?: string;
  scope?: string;
  sub?: string;
} = {}) {
  const verifier = generateCodeVerifier();
  const challenge = computeCodeChallenge(verifier, "S256");
  const { code } = createAuthorizationCode(
    {
      clientId: overrides.clientId ?? CLIENT_ID,
      redirectUri: overrides.redirectUri ?? REDIRECT_URI,
      scope: overrides.scope,
      sub: overrides.sub ?? "user-1",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    },
    SECRET
  );
  return { code, verifier };
}

describe("exchangeAuthorizationCode", () => {
  it("returns access_token for valid code and code_verifier", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = exchangeAuthorizationCode(
      code,
      verifier,
      REDIRECT_URI,
      CLIENT_ID,
      { secret: SECRET }
    );
    expect("error" in result).toBe(false);
    if ("access_token" in result) {
      expect(result.access_token).toBeDefined();
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBeGreaterThan(0);
      expect(result.access_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  });

  it("returns scope when present in auth code", () => {
    const { code, verifier } = makeCodeAndVerifier({ scope: "openid profile" });
    const result = exchangeAuthorizationCode(
      code,
      verifier,
      REDIRECT_URI,
      CLIENT_ID,
      { secret: SECRET }
    );
    expect("error" in result).toBe(false);
    if ("scope" in result) expect(result.scope).toBe("openid profile");
  });

  it("returns refresh_token when issueRefreshToken is true", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = exchangeAuthorizationCode(
      code,
      verifier,
      REDIRECT_URI,
      CLIENT_ID,
      { secret: SECRET, issueRefreshToken: true }
    );
    expect("error" in result).toBe(false);
    if ("refresh_token" in result) {
      expect(result.refresh_token).toBeDefined();
      expect(result.refresh_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  });

  it("returns invalid_grant for wrong code_verifier", () => {
    const { code } = makeCodeAndVerifier();
    const result = exchangeAuthorizationCode(
      code,
      "wrong_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      REDIRECT_URI,
      CLIENT_ID,
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_grant");
    }
  });

  it("returns invalid_grant when redirect_uri does not match", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = exchangeAuthorizationCode(
      code,
      verifier,
      "https://evil.example/callback",
      CLIENT_ID,
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_grant");
  });

  it("returns invalid_grant when client_id does not match", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = exchangeAuthorizationCode(
      code,
      verifier,
      REDIRECT_URI,
      "other-client",
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_grant");
  });

  it("returns invalid_grant for reused code when using usedCodeStore", () => {
    const store = createMemoryUsedAuthorizationCodeStore();
    const { code, verifier } = makeCodeAndVerifier();
    const first = exchangeAuthorizationCode(code, verifier, REDIRECT_URI, CLIENT_ID, {
      secret: SECRET,
      usedCodeStore: store,
    });
    expect("error" in first).toBe(false);
    const second = exchangeAuthorizationCode(code, verifier, REDIRECT_URI, CLIENT_ID, {
      secret: SECRET,
      usedCodeStore: store,
    });
    expect("error" in second).toBe(true);
    if ("error" in second) expect(second.error).toBe("invalid_grant");
  });
});

describe("handleAuthorizationCodeFlow", () => {
  it("returns access_token for valid params", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );
    expect("error" in result).toBe(false);
    if ("access_token" in result) expect(result.access_token).toBeDefined();
  });

  it("returns unsupported_grant_type when grant_type is not authorization_code", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = handleAuthorizationCodeFlow(
      {
        grant_type: "refresh_token",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("unsupported_grant_type");
    }
  });

  it("returns invalid_request when code is missing", () => {
    const { verifier } = makeCodeAndVerifier();
    const result = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code: "",
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
      expect(result.error_description).toContain("code");
    }
  });

  it("returns invalid_request when code_verifier is missing", () => {
    const { code } = makeCodeAndVerifier();
    const result = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: "",
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
      expect(result.error_description).toContain("code_verifier");
    }
  });

  it("returns invalid_request when redirect_uri is missing", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: "",
        client_id: CLIENT_ID,
      },
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
      expect(result.error_description).toContain("redirect_uri");
    }
  });

  it("returns invalid_request when client_id is missing", () => {
    const { code, verifier } = makeCodeAndVerifier();
    const result = handleAuthorizationCodeFlow(
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: "",
      },
      { secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
      expect(result.error_description).toContain("client_id");
    }
  });
});
