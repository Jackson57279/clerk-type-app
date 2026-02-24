import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decode as base32Decode } from "hi-base32";
import {
  register,
  login,
  createLoginLimitsResolver,
  type RegistrationLoginStore,
  type CredentialUser,
} from "../src/registration-login.js";
import {
  defaultPasswordPolicy,
  validatePasswordWithPolicy,
} from "../src/password.js";
import { createBruteForceProtection } from "../src/brute-force.js";
import { createAccountLockout } from "../src/account-lockout.js";
import {
  createMemoryTotpStore,
  startTotpSetup,
  confirmTotpSetup,
} from "../src/totp-authenticator.js";
import { generateTOTP } from "../src/totp.js";
import {
  createMemoryUserMfaPhoneStore,
  createMemorySmsMfaChallengeStore,
  sendLoginSmsOtp,
} from "../src/sms-mfa.js";
import type { SmsSender } from "../src/sms-otp.js";
import {
  createMemoryBackupCodeStore,
  addBackupCodesForUser,
  getRemainingBackupCodeCount,
} from "../src/backup-codes.js";
import { createSuspiciousActivityDetector } from "../src/suspicious-activity.js";
import { AUDIT_EVENT_TYPES, type AuditLogStore } from "../src/audit-log.js";
import {
  clearAllSessions,
  registerSession,
} from "../src/concurrent-session-limit.js";

function secretToBuffer(secretBase32: string): Buffer {
  return Buffer.from(base32Decode.asBytes(secretBase32));
}

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

describe("register", () => {
  it("creates user with hashed password when email is new", async () => {
    const store = memoryStore();
    const result = await register(store, {
      email: "new@example.com",
      password: "SecurePass1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBeDefined();
    expect(result.created).toBe(true);

    const found = await store.findUserByEmail("new@example.com");
    expect(found).not.toBeNull();
    expect(found?.passwordHash).toBeDefined();
    expect(found?.passwordHash).not.toBe("SecurePass1");
    expect(found?.passwordHash).toMatch(/^\$argon2/);
  });

  it("normalizes email to lowercase", async () => {
    const store = memoryStore();
    await register(store, { email: "User@Example.COM", password: "SecurePass1" });
    const found = await store.findUserByEmail("user@example.com");
    expect(found).not.toBeNull();
  });

  it("returns email_taken when user already has password", async () => {
    const store = memoryStore([
      {
        userId: "u1",
        email: "taken@example.com",
        passwordHash: "existing-hash",
      },
    ]);

    const result = await register(store, {
      email: "taken@example.com",
      password: "OtherPass1",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("email_taken");
  });

  it("sets password for existing user without password and returns created: false", async () => {
    const store = memoryStore([
      { userId: "u1", email: "no-password@example.com", passwordHash: null },
    ]);

    const result = await register(store, {
      email: "no-password@example.com",
      password: "NewSecure1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe("u1");
    expect(result.created).toBe(false);

    const found = await store.findUserByEmail("no-password@example.com");
    expect(found?.passwordHash).toBeDefined();
    expect(found?.passwordHash).not.toBe("NewSecure1");
  });

  it("returns invalid_password when password fails policy", async () => {
    const store = memoryStore();
    const result = await register(store, {
      email: "u@example.com",
      password: "short",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("invalid_password");
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });

  it("returns email_not_allowed when isAllowedEmail returns false", async () => {
    const store = memoryStore();
    const result = await register(
      store,
      { email: "user@forbidden.com", password: "SecurePass1" },
      { isAllowedEmail: (e) => e.endsWith("@example.com") }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("email_not_allowed");
  });

  it("passes optional name/firstName/lastName to createUser", async () => {
    const createUser = vi.fn().mockImplementation(async (data) => {
      return {
        userId: "u1",
        email: data.email,
        passwordHash: data.passwordHash,
      };
    });
    const store: RegistrationLoginStore = {
      findUserByEmail: async () => null,
      createUser,
      setPassword: async () => {},
    };

    await register(store, {
      email: "named@example.com",
      password: "SecurePass1",
      name: "Full Name",
      firstName: "Full",
      lastName: "Name",
    });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "named@example.com",
        name: "Full Name",
        firstName: "Full",
        lastName: "Name",
      })
    );
  });
});

describe("login", () => {
  it("returns userId when email and password match", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "login@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const result = await login(store, {
      email: "login@example.com",
      password: "MyPassword1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
  });

  it("returns invalid_credentials for wrong password", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "Correct1" });

    const result = await login(store, {
      email: "u@example.com",
      password: "WrongPass1",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result ? result.reason : undefined).toBe(
      "invalid_credentials"
    );
  });

  it("returns invalid_credentials when user not found", async () => {
    const store = memoryStore();
    const result = await login(store, {
      email: "nobody@example.com",
      password: "AnyPass1",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result ? result.reason : undefined).toBe(
      "invalid_credentials"
    );
  });

  it("returns invalid_credentials when user has no password", async () => {
    const store = memoryStore([
      { userId: "u1", email: "nopass@example.com", passwordHash: null },
    ]);

    const result = await login(store, {
      email: "nopass@example.com",
      password: "Anything1",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result ? result.reason : undefined).toBe(
      "invalid_credentials"
    );
  });

  it("normalizes email for login", async () => {
    const store = memoryStore();
    await register(store, { email: "case@example.com", password: "PassWord1" });

    const result = await login(store, {
      email: "  CASE@EXAMPLE.COM  ",
      password: "PassWord1",
    });

    expect(result.success).toBe(true);
  });

  it("returns invalid_credentials for empty password", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });

    const result = await login(store, {
      email: "u@example.com",
      password: "",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result ? result.reason : undefined).toBe(
      "invalid_credentials"
    );
  });
});

describe("login with session fixation prevention", () => {
  it("issues new session ID after login so pre-login session is invalid (session fixation prevention)", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const sessionStore = new Map<string, { userId: string; orgId: string | null }>();
    const preLoginId = "fixated-session-id";
    sessionStore.set(preLoginId, { userId: "anonymous", orgId: null });

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: {
            remove(id: string) {
              sessionStore.delete(id);
            },
            register(id: string, userId: string, orgId: string | null) {
              sessionStore.set(id, { userId, orgId });
            },
          },
          currentSessionId: preLoginId,
        },
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.newSessionId).toBeDefined();
    expect(result.newSessionId).not.toBe(preLoginId);
    expect(sessionStore.has(preLoginId)).toBe(false);
    expect(sessionStore.get(result.newSessionId!)).toEqual({
      userId: result.userId,
      orgId: null,
    });
  });

  it("returns newSessionId and setCookieHeader on success when sessionFixation provided", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const sessionStore = new Map<string, { userId: string; orgId: string | null }>();
    const preLoginId = "pre-login-session-id";
    sessionStore.set(preLoginId, { userId: "anonymous", orgId: null });

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: {
            remove(id: string) {
              sessionStore.delete(id);
            },
            register(id: string, userId: string, orgId: string | null) {
              sessionStore.set(id, { userId, orgId });
            },
          },
          currentSessionId: preLoginId,
        },
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.newSessionId).toBeDefined();
    expect(result.setCookieHeader).toBeDefined();
    expect(result.newSessionId).not.toBe(preLoginId);
    expect(result.setCookieHeader).toMatch(/^session=/);
    expect(result.setCookieHeader).toContain(result.newSessionId);
    expect(sessionStore.has(preLoginId)).toBe(false);
    expect(sessionStore.get(result.newSessionId!)).toEqual({
      userId: result.userId,
      orgId: null,
    });
  });

  it("does not return newSessionId or setCookieHeader when sessionFixation not provided", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const result = await login(store, {
      email: "u@example.com",
      password: "PassWord1",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.newSessionId).toBeUndefined();
    expect(result.setCookieHeader).toBeUndefined();
  });

  it("does not regenerate session on login failure", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const sessionStore = new Map<string, { userId: string; orgId: string | null }>();
    const preLoginId = "fixated-id";
    sessionStore.set(preLoginId, { userId: "anonymous", orgId: null });

    const result = await login(
      store,
      { email: "u@example.com", password: "WrongPassword" },
      {
        sessionFixation: {
          sessionStore: {
            remove(id: string) {
              sessionStore.delete(id);
            },
            register(id: string, userId: string, orgId: string | null) {
              sessionStore.set(id, { userId, orgId });
            },
          },
          currentSessionId: preLoginId,
        },
      }
    );

    expect(result.success).toBe(false);
    expect(sessionStore.has(preLoginId)).toBe(true);
    expect(sessionStore.get(preLoginId)).toEqual({
      userId: "anonymous",
      orgId: null,
    });
  });

  it("registers new session with orgId when sessionFixation.orgId provided", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const sessionStore = new Map<string, { userId: string; orgId: string | null }>();

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: {
            remove(id: string) {
              sessionStore.delete(id);
            },
            register(id: string, userId: string, orgId: string | null) {
              sessionStore.set(id, { userId, orgId });
            },
          },
          currentSessionId: "old-id",
          orgId: "org-1",
        },
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.newSessionId).toBeDefined();
    expect(sessionStore.get(result.newSessionId!)).toEqual({
      userId: result.userId,
      orgId: "org-1",
    });
  });
});

describe("login with concurrent session limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllSessions();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts oldest sessions when over limit and syncs app session store", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const user = await store.findUserByEmail("u@example.com");
    expect(user).not.toBeNull();
    const userId = user!.userId;
    const sessionStore = new Map<string, { userId: string; orgId: string | null }>();
    const appStore = {
      remove(id: string) {
        sessionStore.delete(id);
      },
      register(id: string, uid: string, orgId: string | null) {
        sessionStore.set(id, { userId: uid, orgId });
      },
    };
    registerSession("s0", userId, null);
    vi.advanceTimersByTime(100);
    registerSession("s1", userId, null);
    sessionStore.set("s0", { userId, orgId: null });
    sessionStore.set("s1", { userId, orgId: null });
    sessionStore.set("pre-login", { userId: "anonymous", orgId: null });

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: appStore,
          currentSessionId: "pre-login",
        },
        concurrentSessionLimit: { limits: { user: 2 } },
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.newSessionId).toBeDefined();
    expect(result.setCookieHeader).toMatch(/^session=/);
    expect(result.evictedSessionIds).toContain("s0");
    expect(sessionStore.has("s0")).toBe(false);
    expect(sessionStore.has("pre-login")).toBe(false);
    expect(sessionStore.get(result.newSessionId!)).toEqual({
      userId: result.userId,
      orgId: null,
    });
  });

  it("returns no evictions when under limit", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const sessionStore = new Map<string, { userId: string; orgId: string | null }>();
    const appStore = {
      remove(id: string) {
        sessionStore.delete(id);
      },
      register(id: string, userId: string, orgId: string | null) {
        sessionStore.set(id, { userId, orgId });
      },
    };
    sessionStore.set("pre-login", { userId: "anonymous", orgId: null });

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: appStore,
          currentSessionId: "pre-login",
        },
        concurrentSessionLimit: { limits: { user: 5 } },
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.evictedSessionIds).toEqual([]);
    expect(result.newSessionId).toBeDefined();
  });

  it("uses getLimits for configurable per-user limit", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const user = await store.findUserByEmail("u@example.com");
    expect(user).not.toBeNull();
    const userId = user!.userId;
    const appStore = {
      remove: vi.fn(),
      register: vi.fn(),
    };
    registerSession("s0", userId, null);
    registerSession("s1", userId, null);
    registerSession("s2", userId, null);

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: appStore,
          currentSessionId: "pre-login",
        },
        concurrentSessionLimit: {
          getLimits: (uid) =>
            uid === userId ? { user: 2 } : { user: 5 },
        },
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.evictedSessionIds).toHaveLength(2);
    expect(result.evictedSessionIds).toContain("s0");
    expect(result.evictedSessionIds).toContain("s1");
  });

  it("uses async getLimits for configurable per-org limit", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const user = await store.findUserByEmail("u@example.com");
    expect(user).not.toBeNull();
    const userId = user!.userId;
    const orgId = "org-strict";
    const appStore = {
      remove: vi.fn(),
      register: vi.fn(),
    };
    registerSession("s0", userId, orgId);
    registerSession("s1", userId, orgId);

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: appStore,
          currentSessionId: "pre-login",
          orgId,
        },
        concurrentSessionLimit: {
          getLimits: async (_uid, oid) =>
            oid === "org-strict"
              ? { user: 2, org: 10 }
              : { user: 5 },
        },
      }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.evictedSessionIds).toHaveLength(1);
    expect(result.evictedSessionIds).toContain("s0");
  });

  it("returns session_limit_reached when concurrent session limit is 0", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const appStore = {
      remove: vi.fn(),
      register: vi.fn(),
    };
    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        sessionFixation: {
          sessionStore: appStore,
          currentSessionId: "pre-login",
        },
        concurrentSessionLimit: { limits: { user: 0 } },
      }
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("session_limit_reached");
    expect(appStore.register).not.toHaveBeenCalled();
  });
});

describe("createLoginLimitsResolver", () => {
  it("returns default limits when org has no settings", async () => {
    const orgStore = {
      getById: vi.fn().mockResolvedValue(null),
      getBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    };
    const resolve = createLoginLimitsResolver({
      organizationStore: orgStore,
      defaultUserLimit: 5,
      defaultOrgLimit: 3,
    });
    const limits = await resolve("u1", "org-unknown");
    expect(limits).toEqual({ user: 5, org: 3 });
  });

  it("returns org maxConcurrentSessionsPerUser when set", async () => {
    const orgStore = {
      getById: vi.fn().mockImplementation((id: string) =>
        id === "org-1"
          ? Promise.resolve({
              id: "org-1",
              name: "Org",
              slug: "org",
              maxConcurrentSessionsPerUser: 2,
              logoUrl: null,
              primaryColor: null,
              faviconUrl: null,
              maxMembers: null,
              allowedDomains: [],
              customDomains: [],
              requireEmailVerification: true,
              samlEnabled: false,
              samlConfig: null,
              scimEnabled: false,
              scimTokenHash: null,
              createdAt: "",
              updatedAt: "",
              deletedAt: null,
            })
          : Promise.resolve(null)
      ),
      getBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    };
    const resolve = createLoginLimitsResolver({
      organizationStore: orgStore,
      defaultUserLimit: 5,
    });
    const limits = await resolve("u1", "org-1");
    expect(limits).toEqual({ user: 2 });
  });

  it("uses default user limit when orgId is null", async () => {
    const orgStore = {
      getById: vi.fn(),
      getBySlug: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    };
    const resolve = createLoginLimitsResolver({
      organizationStore: orgStore,
      defaultUserLimit: 3,
      defaultOrgLimit: 2,
    });
    const limits = await resolve("u1", null);
    expect(limits).toEqual({ user: 3, org: 2 });
    expect(orgStore.getById).not.toHaveBeenCalled();
  });
});

describe("login with suspicious activity detection", () => {
  it("returns success without suspicious when no detector provided", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const result = await login(store, {
      email: "u@example.com",
      password: "PassWord1",
      deviceFingerprint: "new-device",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.suspicious).toBeUndefined();
    expect(result.suspiciousReasons).toBeUndefined();
  });

  it("flags new device and sets suspicious + reasons when detector provided", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const detector = createSuspiciousActivityDetector();
    const result = await login(store, {
      email: "u@example.com",
      password: "PassWord1",
      deviceFingerprint: "device-A",
    }, { suspiciousActivityDetector: detector });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.suspicious).toBe(true);
    expect(result.suspiciousReasons).toContain("new_device");
  });

  it("does not set suspicious on second login from same device", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const detector = createSuspiciousActivityDetector();
    await login(store, {
      email: "u@example.com",
      password: "PassWord1",
      deviceFingerprint: "device-A",
    }, { suspiciousActivityDetector: detector });
    const result = await login(store, {
      email: "u@example.com",
      password: "PassWord1",
      deviceFingerprint: "device-A",
    }, { suspiciousActivityDetector: detector });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.suspicious).not.toBe(true);
    expect(result.suspiciousReasons ?? []).not.toContain("new_device");
  });

  it("emits SECURITY_SUSPICIOUS_LOGIN audit event when suspicious and auditLogStore provided", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const detector = createSuspiciousActivityDetector();
    const events: { eventType: string; metadata?: Record<string, unknown> }[] = [];
    const auditLogStore: AuditLogStore = {
      append: async (evt) => { events.push(evt); },
    };
    const result = await login(store, {
      email: "u@example.com",
      password: "PassWord1",
      deviceFingerprint: "new-device",
    }, { suspiciousActivityDetector: detector, auditLogStore });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.suspicious).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe(AUDIT_EVENT_TYPES.SECURITY_SUSPICIOUS_LOGIN);
    expect(events[0]!.metadata).toEqual({ reasons: ["new_device"] });
  });
});

describe("login with TOTP MFA", () => {
  it("returns requiresTotp and userId when TOTP enabled and no totpCode", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "mfa@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();
    const { secret } = await startTotpSetup(
      reg.userId,
      "TestApp",
      "mfa@example.com",
      totpStore
    );
    const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
    await confirmTotpSetup(reg.userId, code, totpStore);

    const result = await login(
      store,
      { email: "mfa@example.com", password: "MyPassword1" },
      { totpStore }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("requiresTotp" in result && result.requiresTotp).toBe(true);
    expect("userId" in result && result.userId).toBe(reg.userId);
  });

  it("returns success when TOTP enabled and valid totpCode", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "mfa2@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();
    const { secret } = await startTotpSetup(
      reg.userId,
      "TestApp",
      "mfa2@example.com",
      totpStore
    );
    const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
    await confirmTotpSetup(reg.userId, code, totpStore);
    const nextCode = generateTOTP(secretToBuffer(secret), {
      period: 30,
      digits: 6,
    });

    const result = await login(
      store,
      {
        email: "mfa2@example.com",
        password: "MyPassword1",
        totpCode: nextCode,
      },
      { totpStore }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
  });

  it("returns invalid_credentials when TOTP enabled and wrong totpCode", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "mfa3@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();
    const { secret } = await startTotpSetup(
      reg.userId,
      "TestApp",
      "mfa3@example.com",
      totpStore
    );
    const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
    await confirmTotpSetup(reg.userId, code, totpStore);

    const result = await login(
      store,
      {
        email: "mfa3@example.com",
        password: "MyPassword1",
        totpCode: "000000",
      },
      { totpStore }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("invalid_credentials");
  });

  it("returns success when no totpStore (TOTP not checked)", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "nomfa@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const result = await login(store, {
      email: "nomfa@example.com",
      password: "MyPassword1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
  });

  it("returns success when TOTP not enabled for user even with totpStore", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "nototp@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();

    const result = await login(
      store,
      { email: "nototp@example.com", password: "MyPassword1" },
      { totpStore }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
  });
});

function capturingSmsSender(): SmsSender & {
  lastBody: string;
  lastPhone: string;
} {
  let lastBody = "";
  let lastPhone = "";
  return {
    async send(phone: string, body: string) {
      lastPhone = phone;
      lastBody = body;
    },
    get lastBody() {
      return lastBody;
    },
    get lastPhone() {
      return lastPhone;
    },
  };
}

describe("login with SMS MFA", () => {
  it("returns requiresSmsOtp and userId when SMS MFA enabled and no smsOtpCode", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "smsmfa@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const phoneStore = createMemoryUserMfaPhoneStore();
    const challengeStore = createMemorySmsMfaChallengeStore();
    await phoneStore.set(reg.userId, "+15551234567");

    const result = await login(
      store,
      { email: "smsmfa@example.com", password: "MyPassword1" },
      { smsMfa: { phoneStore, challengeStore } }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("requiresSmsOtp" in result && result.requiresSmsOtp).toBe(true);
    expect("userId" in result && result.userId).toBe(reg.userId);
  });

  it("returns success when SMS MFA enabled and valid smsOtpCode", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "smsmfa2@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const phoneStore = createMemoryUserMfaPhoneStore();
    const challengeStore = createMemorySmsMfaChallengeStore();
    await phoneStore.set(reg.userId, "+15559999999");
    const sender = capturingSmsSender();
    await sendLoginSmsOtp(reg.userId, {
      phoneStore,
      challengeStore,
      sender,
      template: "Code: {{code}}",
    });
    const code = /Code: (\d{6})/.exec(sender.lastBody)?.[1];
    expect(code).toBeDefined();

    const result = await login(
      store,
      {
        email: "smsmfa2@example.com",
        password: "MyPassword1",
        smsOtpCode: code,
      },
      { smsMfa: { phoneStore, challengeStore } }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
  });

  it("returns invalid_credentials when SMS MFA enabled and wrong smsOtpCode", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "smsmfa3@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const phoneStore = createMemoryUserMfaPhoneStore();
    const challengeStore = createMemorySmsMfaChallengeStore();
    await phoneStore.set(reg.userId, "+15558888888");

    const result = await login(
      store,
      {
        email: "smsmfa3@example.com",
        password: "MyPassword1",
        smsOtpCode: "000000",
      },
      { smsMfa: { phoneStore, challengeStore } }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("invalid_credentials");
  });

  it("returns success when no smsMfa options (SMS not checked)", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "nosmsmfa@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const result = await login(store, {
      email: "nosmsmfa@example.com",
      password: "MyPassword1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
  });

  it("TOTP takes precedence over SMS MFA when both configured", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "both@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();
    const { secret } = await startTotpSetup(
      reg.userId,
      "TestApp",
      "both@example.com",
      totpStore
    );
    const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
    await confirmTotpSetup(reg.userId, code, totpStore);

    const phoneStore = createMemoryUserMfaPhoneStore();
    const challengeStore = createMemorySmsMfaChallengeStore();
    await phoneStore.set(reg.userId, "+15557777777");

    const result = await login(
      store,
      { email: "both@example.com", password: "MyPassword1" },
      { totpStore, smsMfa: { phoneStore, challengeStore } }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("requiresTotp" in result && result.requiresTotp).toBe(true);
  });
});

describe("login with backup code", () => {
  it("succeeds with valid backup code when TOTP required and consumes code", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "backup@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();
    const { secret } = await startTotpSetup(
      reg.userId,
      "TestApp",
      "backup@example.com",
      totpStore
    );
    const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
    await confirmTotpSetup(reg.userId, code, totpStore);

    const backupCodeStore = createMemoryBackupCodeStore();
    await addBackupCodesForUser(reg.userId, ["abcd1234", "wxyz5678"], backupCodeStore);

    const result = await login(
      store,
      {
        email: "backup@example.com",
        password: "MyPassword1",
        backupCode: "abcd1234",
      },
      { totpStore, backupCodeStore }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
    expect(await getRemainingBackupCodeCount(reg.userId, backupCodeStore)).toBe(1);
  });

  it("returns invalid_credentials when TOTP required and backup code wrong", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "backupbad@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();
    const { secret } = await startTotpSetup(
      reg.userId,
      "TestApp",
      "backupbad@example.com",
      totpStore
    );
    const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
    await confirmTotpSetup(reg.userId, code, totpStore);

    const backupCodeStore = createMemoryBackupCodeStore();
    await addBackupCodesForUser(reg.userId, ["validcode"], backupCodeStore);

    const result = await login(
      store,
      {
        email: "backupbad@example.com",
        password: "MyPassword1",
        backupCode: "wrongcode",
      },
      { totpStore, backupCodeStore }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("invalid_credentials");
    expect(await getRemainingBackupCodeCount(reg.userId, backupCodeStore)).toBe(1);
  });

  it("succeeds with valid backup code when SMS MFA required", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "smsbackup@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const phoneStore = createMemoryUserMfaPhoneStore();
    const challengeStore = createMemorySmsMfaChallengeStore();
    await phoneStore.set(reg.userId, "+15551112222");

    const backupCodeStore = createMemoryBackupCodeStore();
    await addBackupCodesForUser(reg.userId, ["smsbc12"], backupCodeStore);

    const result = await login(
      store,
      {
        email: "smsbackup@example.com",
        password: "MyPassword1",
        backupCode: "smsbc12",
      },
      { smsMfa: { phoneStore, challengeStore }, backupCodeStore }
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.userId).toBe(reg.userId);
    expect(await getRemainingBackupCodeCount(reg.userId, backupCodeStore)).toBe(0);
  });

  it("returns requiresTotp when TOTP required and no totpCode or backupCode", async () => {
    const store = memoryStore();
    const reg = await register(store, {
      email: "nototpbackup@example.com",
      password: "MyPassword1",
    });
    expect(reg.success).toBe(true);
    if (!reg.success) return;

    const totpStore = createMemoryTotpStore();
    const { secret } = await startTotpSetup(
      reg.userId,
      "TestApp",
      "nototpbackup@example.com",
      totpStore
    );
    const code = generateTOTP(secretToBuffer(secret), { period: 30, digits: 6 });
    await confirmTotpSetup(reg.userId, code, totpStore);

    const result = await login(
      store,
      { email: "nototpbackup@example.com", password: "MyPassword1" },
      { totpStore }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("requiresTotp" in result && result.requiresTotp).toBe(true);
  });
});

describe("login with brute force protection", () => {
  it("returns rate_limited when brute force protection blocks key", async () => {
    const store = memoryStore();
    await register(store, { email: "u@example.com", password: "PassWord1" });
    const bf = createBruteForceProtection({ baseDelayMs: 1000 });
    bf.recordFailedAttempt("192.168.1.1");

    const result = await login(
      store,
      { email: "u@example.com", password: "PassWord1" },
      {
        getBruteForceKey: () => "192.168.1.1",
        bruteForceProtection: bf,
      }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("rate_limited");
    expect("retryAfterSeconds" in result && result.retryAfterSeconds).toBe(1);
  });

  it("allows login after delay has passed", async () => {
    const store = memoryStore();
    await register(store, { email: "u2@example.com", password: "PassWord1" });
    const bf = createBruteForceProtection({ baseDelayMs: 50 });
    bf.recordFailedAttempt("192.168.1.2");
    await new Promise((r) => setTimeout(r, 60));

    const result = await login(
      store,
      { email: "u2@example.com", password: "PassWord1" },
      {
        getBruteForceKey: () => "192.168.1.2",
        bruteForceProtection: bf,
      }
    );

    expect(result.success).toBe(true);
  });

  it("records failed attempt on invalid credentials when brute force protection enabled", async () => {
    const store = memoryStore();
    await register(store, { email: "u3@example.com", password: "PassWord1" });
    const bf = createBruteForceProtection({ baseDelayMs: 1000 });

    await login(store, { email: "u3@example.com", password: "Wrong" }, {
      getBruteForceKey: () => "10.0.0.1",
      bruteForceProtection: bf,
    });

    const result = await login(
      store,
      { email: "u3@example.com", password: "PassWord1" },
      {
        getBruteForceKey: () => "10.0.0.1",
        bruteForceProtection: bf,
      }
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("rate_limited");
  });

  it("applies progressive delay: retryAfterSeconds increases after each failed login", async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    await register(store, { email: "prog@example.com", password: "PassWord1" });
    const bf = createBruteForceProtection({ baseDelayMs: 1000 });

    await login(store, { email: "prog@example.com", password: "Wrong" }, {
      getBruteForceKey: () => "10.0.0.5",
      bruteForceProtection: bf,
    });
    let result = await login(
      store,
      { email: "prog@example.com", password: "PassWord1" },
      { getBruteForceKey: () => "10.0.0.5", bruteForceProtection: bf }
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("retryAfterSeconds" in result && result.retryAfterSeconds).toBe(1);

    vi.advanceTimersByTime(1000);
    await login(store, { email: "prog@example.com", password: "Wrong" }, {
      getBruteForceKey: () => "10.0.0.5",
      bruteForceProtection: bf,
    });
    result = await login(
      store,
      { email: "prog@example.com", password: "PassWord1" },
      { getBruteForceKey: () => "10.0.0.5", bruteForceProtection: bf }
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("retryAfterSeconds" in result && result.retryAfterSeconds).toBe(2);

    vi.advanceTimersByTime(2000);
    await login(store, { email: "prog@example.com", password: "Wrong" }, {
      getBruteForceKey: () => "10.0.0.5",
      bruteForceProtection: bf,
    });
    result = await login(
      store,
      { email: "prog@example.com", password: "PassWord1" },
      { getBruteForceKey: () => "10.0.0.5", bruteForceProtection: bf }
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("retryAfterSeconds" in result && result.retryAfterSeconds).toBe(4);
    vi.useRealTimers();
  });

  it("returns account_locked when account lockout blocks email", async () => {
    const store = memoryStore();
    await register(store, { email: "locked@example.com", password: "PassWord1" });
    const lockout = createAccountLockout({ maxAttempts: 3, lockoutDurationMs: 60_000 });
    lockout.recordFailedAttempt("locked@example.com");
    lockout.recordFailedAttempt("locked@example.com");
    lockout.recordFailedAttempt("locked@example.com");

    const result = await login(
      store,
      { email: "locked@example.com", password: "PassWord1" },
      { accountLockout: lockout }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("account_locked");
    expect("retryAfterSeconds" in result && result.retryAfterSeconds).toBe(60);
  });

  it("records failed attempt on invalid credentials when account lockout enabled", async () => {
    const store = memoryStore();
    await register(store, { email: "u4@example.com", password: "PassWord1" });
    const lockout = createAccountLockout({ maxAttempts: 2, lockoutDurationMs: 60_000 });

    await login(store, { email: "u4@example.com", password: "Wrong" }, {
      accountLockout: lockout,
    });
    await login(store, { email: "u4@example.com", password: "Wrong" }, {
      accountLockout: lockout,
    });
    const result = await login(store, { email: "u4@example.com", password: "PassWord1" }, {
      accountLockout: lockout,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("account_locked");
  });

  it("clears account lockout on successful login", async () => {
    const store = memoryStore();
    await register(store, { email: "u5@example.com", password: "PassWord1" });
    const lockout = createAccountLockout({ maxAttempts: 3, lockoutDurationMs: 60_000 });
    lockout.recordFailedAttempt("u5@example.com");
    lockout.recordFailedAttempt("u5@example.com");

    const result = await login(
      store,
      { email: "u5@example.com", password: "PassWord1" },
      { accountLockout: lockout }
    );
    expect(result.success).toBe(true);
    lockout.recordFailedAttempt("u5@example.com");
    expect(lockout.check("u5@example.com").locked).toBe(false);
  });

  it("locks account for 30 min after 10 failed login attempts (default)", async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    await register(store, { email: "ten@example.com", password: "PassWord1" });
    const lockout = createAccountLockout();

    for (let i = 0; i < 10; i++) {
      await login(store, { email: "ten@example.com", password: "Wrong" }, {
        accountLockout: lockout,
      });
    }
    const result = await login(
      store,
      { email: "ten@example.com", password: "PassWord1" },
      { accountLockout: lockout }
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("account_locked");
    expect("retryAfterSeconds" in result && result.retryAfterSeconds).toBe(30 * 60);

    vi.advanceTimersByTime(30 * 60 * 1000);
    const after = await login(
      store,
      { email: "ten@example.com", password: "PassWord1" },
      { accountLockout: lockout }
    );
    expect(after.success).toBe(true);
    vi.useRealTimers();
  });

  it("login without brute force or lockout options is unchanged", async () => {
    const store = memoryStore();
    await register(store, { email: "u6@example.com", password: "PassWord1" });
    const result = await login(store, {
      email: "u6@example.com",
      password: "PassWord1",
    });
    expect(result.success).toBe(true);
  });
});

describe("login with IP rate limit (5 per 15 min)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first 5 attempts from same IP", async () => {
    const store = memoryStore();
    await register(store, { email: "ip@example.com", password: "PassWord1" });
    const opts = { useIpRateLimit: true };
    for (let i = 0; i < 5; i++) {
      const result = await login(
        store,
        { email: "ip@example.com", password: "PassWord1", ip: "10.0.0.1" },
        opts
      );
      expect(result.success).toBe(true);
    }
  });

  it("blocks 6th attempt within 15 min", async () => {
    const store = memoryStore();
    await register(store, { email: "ip2@example.com", password: "PassWord1" });
    const opts = { useIpRateLimit: true };
    for (let i = 0; i < 5; i++) {
      await login(
        store,
        { email: "ip2@example.com", password: "PassWord1", ip: "10.0.0.2" },
        opts
      );
    }
    const result = await login(
      store,
      { email: "ip2@example.com", password: "PassWord1", ip: "10.0.0.2" },
      opts
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("rate_limited");
    expect("retryAfterSeconds" in result && result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("allows again after 15 min window", async () => {
    const store = memoryStore();
    await register(store, { email: "ip3@example.com", password: "PassWord1" });
    const opts = { useIpRateLimit: true };
    for (let i = 0; i < 5; i++) {
      await login(
        store,
        { email: "ip3@example.com", password: "PassWord1", ip: "10.0.0.3" },
        opts
      );
    }
    let result = await login(
      store,
      { email: "ip3@example.com", password: "PassWord1", ip: "10.0.0.3" },
      opts
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect("reason" in result && result.reason).toBe("rate_limited");
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    result = await login(
      store,
      { email: "ip3@example.com", password: "PassWord1", ip: "10.0.0.3" },
      opts
    );
    expect(result.success).toBe(true);
  });

  it("tracks IPs independently", async () => {
    const store = memoryStore();
    await register(store, { email: "ip4@example.com", password: "PassWord1" });
    const opts = { useIpRateLimit: true };
    for (let i = 0; i < 5; i++) {
      await login(
        store,
        { email: "ip4@example.com", password: "PassWord1", ip: "10.0.0.4" },
        opts
      );
    }
    await login(
      store,
      { email: "ip4@example.com", password: "PassWord1", ip: "10.0.0.5" },
      opts
    );
    const blocked = await login(
      store,
      { email: "ip4@example.com", password: "PassWord1", ip: "10.0.0.4" },
      opts
    );
    const allowed = await login(
      store,
      { email: "ip4@example.com", password: "PassWord1", ip: "10.0.0.5" },
      opts
    );
    expect(blocked.success).toBe(false);
    if (!blocked.success) expect("reason" in blocked && blocked.reason).toBe("rate_limited");
    expect(allowed.success).toBe(true);
  });

  it("does not apply when ip is missing", async () => {
    const store = memoryStore();
    await register(store, { email: "ip5@example.com", password: "PassWord1" });
    for (let i = 0; i < 6; i++) {
      const result = await login(
        store,
        { email: "ip5@example.com", password: "PassWord1" },
        { useIpRateLimit: true }
      );
      expect(result.success).toBe(true);
    }
  });
});

describe("custom password policy", () => {
  it("uses provided policy for validation", async () => {
    const store = memoryStore();
    const strictPolicy = {
      ...defaultPasswordPolicy,
      minLength: 12,
      requireUppercase: true,
      requireSpecial: true,
    };

    const result = await register(
      store,
      { email: "u@example.com", password: "short" },
      { passwordPolicy: strictPolicy }
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("invalid_password");

    const ok = await register(
      store,
      { email: "u2@example.com", password: "LongSecure!Pass1" },
      { passwordPolicy: strictPolicy }
    );
    expect(ok.success).toBe(true);
  });

  it("uses env for policy when options.env is provided", async () => {
    const store = memoryStore();
    const env = { PASSWORD_MIN_LENGTH: "12", PASSWORD_REQUIRE_SPECIAL: "true" };
    const short = await register(
      store,
      { email: "env@example.com", password: "short1a" },
      { env }
    );
    expect(short.success).toBe(false);
    if (!short.success) {
      expect(short.reason).toBe("invalid_password");
      expect(short.errors?.some((e) => e.includes("at least 12"))).toBe(true);
    }
    const ok = await register(
      store,
      { email: "env@example.com", password: "LongEnough1!" },
      { env }
    );
    expect(ok.success).toBe(true);
  });

  it("rejects pwned password when options.env has PASSWORD_CHECK_BREACH", async () => {
    const store = memoryStore();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("5BAA6")
          ? Promise.resolve({
              ok: true,
              text: () =>
                Promise.resolve(
                  "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n"
                ),
            } as Response)
          : Promise.resolve({ ok: false } as Response)
      )
    );
    try {
      const env = {
        PASSWORD_REQUIRE_DIGIT: "0",
        PASSWORD_CHECK_BREACH: "true",
      };
      const result = await register(
        store,
        { email: "pwned@example.com", password: "password" },
        { env }
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("invalid_password");
        expect(result.errors?.some((e) => e.includes("breach"))).toBe(true);
      }
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("uses validatePasswordAsync when provided and rejects pwned password", async () => {
    const store = memoryStore();
    const permissive = { ...defaultPasswordPolicy, requireDigit: false };
    const validateAsync = (plain: string, policy: typeof permissive) =>
      validatePasswordWithPolicy(plain, policy, { checkBreach: true });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("5BAA6")
          ? Promise.resolve({
              ok: true,
              text: () =>
                Promise.resolve(
                  "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3730471\r\n"
                ),
            } as Response)
          : Promise.resolve({ ok: false } as Response)
      )
    );
    try {
      const result = await register(
        store,
        { email: "async@pwned.com", password: "password" },
        {
          passwordPolicy: permissive,
          validatePasswordAsync: validateAsync,
        }
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("invalid_password");
        expect(result.errors?.some((e) => e.includes("breach"))).toBe(true);
      }
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
