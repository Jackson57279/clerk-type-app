import { describe, it, expect } from "vitest";
import {
  hasPermission,
  requirePermission,
  getDefaultPermissionsForRole,
  type MembershipLike,
} from "../src/rbac.js";
import {
  verifyCsrfDoubleSubmit,
  verifyCsrfRequest,
  generateCsrfToken,
} from "../src/csrf-double-submit.js";
import { register, login, type RegistrationLoginStore, type CredentialUser } from "../src/registration-login.js";
import {
  verifyAndConsumeBackupCode,
  generateAndStoreBackupCodes,
  getRemainingBackupCodeCount,
  createMemoryBackupCodeStore,
} from "../src/backup-codes.js";
import {
  verifyConfirmationToken,
  createConfirmationToken,
  type DoubleOptInPayload,
} from "../src/double-opt-in.js";

function memoryStore(initial: CredentialUser[] = []): RegistrationLoginStore {
  const users = new Map<string, CredentialUser>();
  const byEmail = new Map<string, string>();
  for (const u of initial) {
    users.set(u.userId, { ...u });
    byEmail.set(u.email.toLowerCase(), u.userId);
  }
  return {
    async findUserByEmail(email: string) {
      const id = byEmail.get(email.toLowerCase());
      return id ? users.get(id) ?? null : null;
    },
    async createUser(data) {
      const userId = `user_${users.size + 1}`;
      const user: CredentialUser = {
        userId,
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
      };
      users.set(userId, user);
      byEmail.set(user.email, userId);
      return user;
    },
    async setPassword(userId: string, passwordHash: string) {
      const u = users.get(userId);
      if (!u) throw new Error("User not found");
      users.set(userId, { ...u, passwordHash });
    },
  };
}

describe("penetration: RBAC privilege escalation", () => {
  it("guest cannot perform members:write", () => {
    const guest: MembershipLike = {
      role: "guest",
      permissions: getDefaultPermissionsForRole("guest"),
    };
    expect(hasPermission(guest, "members:write")).toBe(false);
    expect(() => requirePermission(guest, "members:write")).toThrow(/Permission denied/);
  });

  it("member cannot perform org:delete", () => {
    const member: MembershipLike = {
      role: "member",
      permissions: getDefaultPermissionsForRole("member"),
    };
    expect(hasPermission(member, "org:delete")).toBe(false);
    expect(() => requirePermission(member, "org:delete")).toThrow(/Permission denied/);
  });

  it("editor cannot perform org:billing", () => {
    const editor: MembershipLike = {
      role: "editor",
      permissions: getDefaultPermissionsForRole("editor"),
    };
    expect(hasPermission(editor, "org:billing")).toBe(false);
  });

  it("custom permissions do not grant role permissions not in list", () => {
    const m: MembershipLike = { role: "guest", permissions: ["content:read", "org:delete"] };
    expect(hasPermission(m, "org:delete")).toBe(true);
    expect(hasPermission(m, "members:write")).toBe(false);
  });
});

describe("penetration: CSRF bypass", () => {
  it("rejects when cookie and header token differ", () => {
    const cookieToken = generateCsrfToken();
    const headerToken = generateCsrfToken();
    expect(verifyCsrfDoubleSubmit(cookieToken, headerToken)).toBe(false);
  });

  it("rejects when cookie token is missing", () => {
    expect(verifyCsrfDoubleSubmit(undefined, generateCsrfToken())).toBe(false);
  });

  it("rejects when header token is missing", () => {
    expect(verifyCsrfDoubleSubmit(generateCsrfToken(), undefined)).toBe(false);
  });

  it("verifyCsrfRequest rejects when header is missing", () => {
    const token = generateCsrfToken();
    const cookieHeader = `csrf=${token}`;
    const getHeader = () => undefined;
    expect(verifyCsrfRequest(cookieHeader, getHeader)).toBe(false);
  });

  it("verifyCsrfRequest rejects when cookie is missing", () => {
    const getHeader = (name: string) => (name === "X-CSRF-Token" ? generateCsrfToken() : undefined);
    expect(verifyCsrfRequest(undefined, getHeader)).toBe(false);
  });
});

describe("penetration: input injection resistance", () => {
  it("register accepts and stores email with SQL-like payload without executing", async () => {
    const store = memoryStore();
    const email = "'; DROP TABLE users;--@example.com";
    const result = await register(store, { email, password: "SecurePass1" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const found = await store.findUserByEmail(email);
    expect(found).not.toBeNull();
    expect(found?.email).toBe(email.toLowerCase());
  });

  it("register accepts email with script-like payload and stores as data", async () => {
    const store = memoryStore();
    const email = "<script>alert(1)</script>@example.com";
    const result = await register(store, { email, password: "SecurePass1" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const found = await store.findUserByEmail(email);
    expect(found).not.toBeNull();
    expect(found?.email).toBe(email.toLowerCase());
  });

  it("login works with SQL-like email after registration", async () => {
    const store = memoryStore();
    const email = "1' OR '1'='1@test.com";
    await register(store, { email, password: "SecurePass1" });
    const result = await login(store, { email, password: "SecurePass1" }, {});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBeDefined();
  });
});

describe("penetration: backup code IDOR", () => {
  it("attacker userId cannot consume victim backup code", async () => {
    const store = createMemoryBackupCodeStore();
    const victimId = "victim";
    const attackerId = "attacker";
    const codes = await generateAndStoreBackupCodes(victimId, store, 2);
    const victimCode = codes[0]!;
    const countBefore = await getRemainingBackupCodeCount(victimId, store);
    expect(countBefore).toBe(2);

    const consumed = await verifyAndConsumeBackupCode(attackerId, victimCode, store);
    expect(consumed).toBe(false);

    const countAfter = await getRemainingBackupCodeCount(victimId, store);
    expect(countAfter).toBe(2);
  });

  it("valid backup code is consumed only for correct userId", async () => {
    const store = createMemoryBackupCodeStore();
    const userId = "user1";
    const codes = await generateAndStoreBackupCodes(userId, store, 2);
    const code = codes[0]!;
    const ok = await verifyAndConsumeBackupCode(userId, code, store);
    expect(ok).toBe(true);
    expect(await getRemainingBackupCodeCount(userId, store)).toBe(1);
  });
});

describe("penetration: sensitive operation token tampering", () => {
  const secret = "op-secret";
  const payload: DoubleOptInPayload = {
    userId: "u1",
    email: "u1@example.com",
    operation: "change_password",
  };

  it("rejects token signed with wrong secret", () => {
    const { token } = createConfirmationToken(payload, secret);
    expect(verifyConfirmationToken(token, "wrong-secret")).toBeNull();
  });

  it("rejects tampered payload (e.g. userId change)", () => {
    const { token } = createConfirmationToken(payload, secret);
    const parts = token.split(".");
    const payloadB64 = parts[1] ?? "";
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
    const tampered = { ...decoded, userId: "attacker" };
    const tamperedB64 = Buffer.from(JSON.stringify(tampered), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const badToken = `${parts[0]}.${tamperedB64}.${parts[2] ?? ""}`;
    expect(verifyConfirmationToken(badToken, secret)).toBeNull();
  });
});
