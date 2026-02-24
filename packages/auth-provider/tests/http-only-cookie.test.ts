import { describe, it, expect } from "vitest";
import {
  buildSessionCookie,
  buildClearSessionCookie,
} from "../src/http-only-cookie.js";

describe("buildSessionCookie", () => {
  it("includes HttpOnly, Secure, SameSite=Strict", () => {
    const header = buildSessionCookie("sid", "token123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
  });

  it("uses exact attribute string HttpOnly; Secure; SameSite=Strict", () => {
    const header = buildSessionCookie("sid", "v");
    expect(header).toContain("HttpOnly; Secure; SameSite=Strict");
  });

  it("returns valid Set-Cookie value with only required attributes", () => {
    const header = buildSessionCookie("sid", "token123");
    expect(header).toBe("sid=token123; HttpOnly; Secure; SameSite=Strict");
  });

  it("starts with name=value", () => {
    const header = buildSessionCookie("sessionId", "abc");
    expect(header).toMatch(/^sessionId=abc/);
  });

  it("includes Max-Age when provided", () => {
    const header = buildSessionCookie("sid", "t", {
      maxAgeSeconds: 3600,
    });
    expect(header).toContain("Max-Age=3600");
  });

  it("includes Path when provided", () => {
    const header = buildSessionCookie("sid", "t", { path: "/" });
    expect(header).toContain("Path=/");
  });

  it("includes both options when provided", () => {
    const header = buildSessionCookie("sid", "t", {
      maxAgeSeconds: 86400,
      path: "/api",
    });
    expect(header).toContain("Max-Age=86400");
    expect(header).toContain("Path=/api");
  });
});

describe("buildClearSessionCookie", () => {
  it("includes HttpOnly, Secure, SameSite=Strict and Max-Age=0", () => {
    const header = buildClearSessionCookie("sid");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=0");
  });

  it("uses empty value and given name", () => {
    const header = buildClearSessionCookie("sessionId");
    expect(header).toMatch(/^sessionId=/);
  });

  it("includes Path when provided", () => {
    const header = buildClearSessionCookie("sid", "/");
    expect(header).toContain("Path=/");
  });

  it("returns valid Set-Cookie clear value with HttpOnly; Secure; SameSite=Strict", () => {
    const header = buildClearSessionCookie("sid");
    expect(header).toBe("sid=; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
  });

  it("includes HttpOnly; Secure; SameSite=Strict when path is provided", () => {
    const header = buildClearSessionCookie("sid", "/");
    expect(header).toContain("HttpOnly; Secure; SameSite=Strict");
  });
});
