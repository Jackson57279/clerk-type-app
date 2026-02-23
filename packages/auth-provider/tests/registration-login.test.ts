import { describe, it, expect, vi } from "vitest";
import { decode as base32Decode } from "hi-base32";
import {
  register,
  login,
  type RegistrationLoginStore,
  type CredentialUser,
} from "../src/registration-login.js";
import { defaultPasswordPolicy } from "../src/password.js";
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
});
