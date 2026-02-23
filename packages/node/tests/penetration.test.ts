import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyAccessToken } from "../src/verify.js";

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

describe("penetration: access token attacks", () => {
  const secret = "correct-secret";

  it("rejects token with wrong secret", () => {
    const payload = {
      sub: "user_1",
      session_id: "sess_1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "jti1",
    };
    const token = signJwt(payload, secret);
    expect(verifyAccessToken(token, "attacker-secret")).toBeNull();
  });

  it("rejects expired token", () => {
    const payload = {
      sub: "user_1",
      session_id: "sess_1",
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 1,
      jti: "jti1",
    };
    const token = signJwt(payload, secret);
    expect(verifyAccessToken(token, secret)).toBeNull();
  });

  it("rejects tampered payload (e.g. sub changed to another user)", () => {
    const payload = {
      sub: "victim",
      session_id: "sess_1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "jti1",
    };
    const token = signJwt(payload, secret);
    const parts = token.split(".");
    const padded = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
    const tampered = { ...decoded, sub: "attacker" };
    const tamperedB64 = base64url(Buffer.from(JSON.stringify(tampered), "utf8"));
    const badToken = `${parts[0]}.${tamperedB64}.${parts[2] ?? ""}`;
    expect(verifyAccessToken(badToken, secret)).toBeNull();
  });

  it("rejects malformed token (not three parts)", () => {
    expect(verifyAccessToken("a.b", secret)).toBeNull();
    expect(verifyAccessToken("single", secret)).toBeNull();
    expect(verifyAccessToken("", secret)).toBeNull();
    expect(verifyAccessToken("a.b.c.d", secret)).toBeNull();
  });

  it("rejects token with invalid base64 in payload", () => {
    const payload = {
      sub: "u1",
      session_id: "s1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: "j",
    };
    const token = signJwt(payload, secret);
    const parts = token.split(".");
    const badToken = `${parts[0]}.!!!invalid!!!.${parts[2] ?? ""}`;
    expect(verifyAccessToken(badToken, secret)).toBeNull();
  });
});
