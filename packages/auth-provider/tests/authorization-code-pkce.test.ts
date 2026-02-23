import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateCodeVerifier,
  computeCodeChallenge,
  verifyCodeVerifier,
  createAuthorizationCode,
  verifyAndConsumeAuthorizationCode,
  createMemoryUsedAuthorizationCodeStore,
} from "../src/authorization-code-pkce.js";

const SECRET = "oauth-server-secret";

describe("generateCodeVerifier", () => {
  it("returns string of length between 43 and 128", () => {
    for (let i = 0; i < 20; i++) {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
    }
  });

  it("uses only unreserved characters", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});

describe("computeCodeChallenge", () => {
  it("S256 produces base64url-encoded SHA256 of verifier", () => {
    const verifier = "a".repeat(43);
    const challenge = computeCodeChallenge(verifier, "S256");
    expect(challenge).not.toBe(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyCodeVerifier(verifier, challenge, "S256")).toBe(true);
  });

  it("plain returns verifier unchanged", () => {
    const verifier = "test_verifier-123.xyz";
    expect(computeCodeChallenge(verifier, "plain")).toBe(verifier);
  });
});

describe("verifyCodeVerifier", () => {
  it("returns true when S256 challenge matches verifier", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    expect(verifyCodeVerifier(verifier, challenge, "S256")).toBe(true);
  });

  it("returns false when verifier is wrong for S256", () => {
    const verifier = "correct_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const challenge = computeCodeChallenge(verifier, "S256");
    expect(verifyCodeVerifier("wrong_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", challenge, "S256")).toBe(false);
  });

  it("returns true for plain when verifier equals challenge", () => {
    const v = "same_value_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    expect(verifyCodeVerifier(v, v, "plain")).toBe(true);
  });

  it("returns false for plain when verifier differs from challenge", () => {
    expect(verifyCodeVerifier("verifier_a", "verifier_b", "plain")).toBe(false);
  });
});

describe("createAuthorizationCode", () => {
  it("returns code, expiresAt, and jti", () => {
    const result = createAuthorizationCode(
      {
        clientId: "client1",
        redirectUri: "https://app.example/cb",
        sub: "user-1",
        codeChallenge: "challenge_b64",
        codeChallengeMethod: "S256",
      },
      SECRET
    );
    expect(result.code).toBeDefined();
    expect(result.code).toContain(".");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("uses default TTL of 10 minutes", () => {
    const before = Date.now();
    const result = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: "x",
        codeChallengeMethod: "S256",
      },
      SECRET
    );
    const after = Date.now();
    const tenMin = 10 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + tenMin - 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + tenMin + 1000);
  });

  it("accepts custom ttlMs and optional scope/state", () => {
    const result = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        scope: "openid profile",
        sub: "u",
        codeChallenge: "x",
        codeChallengeMethod: "S256",
        state: "abc123",
      },
      SECRET,
      { ttlMs: 5 * 60 * 1000 }
    );
    expect(result.expiresAt).toBeGreaterThanOrEqual(Date.now() + 5 * 60 * 1000 - 2000);
  });
});

describe("verifyAndConsumeAuthorizationCode", () => {
  it("returns payload when code and code_verifier are valid", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const { code } = createAuthorizationCode(
      {
        clientId: "my-client",
        redirectUri: "https://app.example/callback",
        scope: "openid",
        sub: "user-42",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        state: "xyz",
      },
      SECRET
    );
    const payload = verifyAndConsumeAuthorizationCode(code, verifier, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.clientId).toBe("my-client");
    expect(payload?.redirectUri).toBe("https://app.example/callback");
    expect(payload?.sub).toBe("user-42");
    expect(payload?.scope).toBe("openid");
    expect(payload?.state).toBe("xyz");
  });

  it("returns null for wrong code_verifier", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );
    expect(
      verifyAndConsumeAuthorizationCode(code, "wrong_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", SECRET)
    ).toBeNull();
  });

  it("returns null for wrong secret", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );
    expect(verifyAndConsumeAuthorizationCode(code, verifier, "wrong-secret")).toBeNull();
  });

  it("returns null for tampered code", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );
    const parts = code.split(".");
    const payloadB64 = parts[0] ?? "";
    const sig = parts[1] ?? "";
    const tampered = payloadB64.slice(0, -1) + (payloadB64.slice(-1) === "a" ? "b" : "a");
    expect(
      verifyAndConsumeAuthorizationCode(`${tampered}.${sig}`, verifier, SECRET)
    ).toBeNull();
  });

  it("returns null for malformed code (no dot)", () => {
    expect(
      verifyAndConsumeAuthorizationCode("nodot", "v", SECRET)
    ).toBeNull();
  });
});

describe("authorization code expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null after TTL has passed", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      },
      SECRET,
      { ttlMs: 1000 }
    );
    expect(verifyAndConsumeAuthorizationCode(code, verifier, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(verifyAndConsumeAuthorizationCode(code, verifier, SECRET)).toBeNull();
  });
});

describe("single-use authorization code", () => {
  it("first verify succeeds, second returns null when store is used", () => {
    const store = createMemoryUsedAuthorizationCodeStore();
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );
    const first = verifyAndConsumeAuthorizationCode(code, verifier, SECRET, {
      usedCodeStore: store,
    });
    expect(first).not.toBeNull();
    const second = verifyAndConsumeAuthorizationCode(code, verifier, SECRET, {
      usedCodeStore: store,
    });
    expect(second).toBeNull();
  });

  it("without store, code can be verified multiple times", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier, "S256");
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      },
      SECRET
    );
    expect(verifyAndConsumeAuthorizationCode(code, verifier, SECRET)).not.toBeNull();
    expect(verifyAndConsumeAuthorizationCode(code, verifier, SECRET)).not.toBeNull();
  });
});

describe("plain code_challenge_method", () => {
  it("accepts plain method and verifies by string equality", () => {
    const verifier = "plain_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: verifier,
        codeChallengeMethod: "plain",
      },
      SECRET
    );
    const payload = verifyAndConsumeAuthorizationCode(code, verifier, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("u");
  });

  it("rejects wrong verifier for plain", () => {
    const verifier = "correct_plain_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const { code } = createAuthorizationCode(
      {
        clientId: "c",
        redirectUri: "https://r",
        sub: "u",
        codeChallenge: verifier,
        codeChallengeMethod: "plain",
      },
      SECRET
    );
    expect(
      verifyAndConsumeAuthorizationCode(code, "wrong_plain_verifier_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", SECRET)
    ).toBeNull();
  });
});
