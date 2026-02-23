import { describe, it, expect } from "vitest";
import { verifyAccessToken } from "../src/verify.js";
import { createHmac } from "crypto";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header), "utf8"));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64url(sig)}`;
}

describe("verifyAccessToken", () => {
  const secret = "test-secret";

  it("returns payload for valid token", () => {
    const payload = {
      sub: "user_123",
      session_id: "sess_456",
      org_id: "org_789",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "jti-1",
    };
    const token = signJwt(payload, secret);
    const result = verifyAccessToken(token, secret);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sub).toBe("user_123");
      expect(result.session_id).toBe("sess_456");
      expect(result.org_id).toBe("org_789");
    }
  });

  it("returns payload with null org_id when omitted", () => {
    const payload = {
      sub: "u1",
      session_id: "s1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "j",
    };
    const token = signJwt(payload, secret);
    const result = verifyAccessToken(token, secret);
    expect(result).not.toBeNull();
    if (result) expect(result.org_id).toBeNull();
  });

  it("returns null for wrong secret", () => {
    const payload = {
      sub: "u1",
      session_id: "s1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "j",
    };
    const token = signJwt(payload, secret);
    expect(verifyAccessToken(token, "wrong-secret")).toBeNull();
  });

  it("returns null for expired token", () => {
    const payload = {
      sub: "u1",
      session_id: "s1",
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
      jti: "j",
    };
    const token = signJwt(payload, secret);
    expect(verifyAccessToken(token, secret)).toBeNull();
  });

  it("returns null for invalid token format", () => {
    expect(verifyAccessToken("not-three-parts", secret)).toBeNull();
    expect(verifyAccessToken("a.b", secret)).toBeNull();
    expect(verifyAccessToken("", secret)).toBeNull();
  });

  it("returns null for tampered payload", () => {
    const payload = {
      sub: "u1",
      session_id: "s1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "j",
    };
    const token = signJwt(payload, secret);
    const parts = token.split(".");
    const padded = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
    const altered = { ...decoded, sub: "hacker" };
    const alteredB64 = base64url(Buffer.from(JSON.stringify(altered), "utf8"));
    const badToken = `${parts[0]}.${alteredB64}.${parts[2] ?? ""}`;
    expect(verifyAccessToken(badToken, secret)).toBeNull();
  });
});
