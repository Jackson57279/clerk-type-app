import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getProviderConfig,
  createSocialLoginState,
  verifySocialLoginState,
  getSocialLoginAuthorizationUrl,
  exchangeSocialLoginCode,
  fetchSocialLoginProfile,
  handleSocialLoginCallback,
  confirmAccountLink,
  type SocialLoginStore,
  type OAuthAccountRow,
  type PendingLinkData,
} from "../src/social-login.js";

const SECRET = "social-login-secret";

describe("getProviderConfig", () => {
  const envRestore: Record<string, string | undefined> = {};
  beforeEach(() => {
    envRestore.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    envRestore.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    envRestore.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
    envRestore.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
    envRestore.MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
    envRestore.MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(envRestore)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("returns null when env vars are missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(getProviderConfig("google")).toBeNull();
    expect(getProviderConfig("github")).toBeNull();
    expect(getProviderConfig("microsoft")).toBeNull();
  });

  it("returns config for google when env set", () => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    const c = getProviderConfig("google");
    expect(c).not.toBeNull();
    expect(c?.clientId).toBe("g-id");
    expect(c?.clientSecret).toBe("g-secret");
    expect(c?.authorizationUrl).toContain("accounts.google.com");
    expect(c?.tokenUrl).toContain("oauth2.googleapis.com");
    expect(c?.userinfoUrl).toContain("www.googleapis.com");
    expect(c?.scopes).toContain("openid");
  });

  it("returns config for github when env set", () => {
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret";
    const c = getProviderConfig("github");
    expect(c).not.toBeNull();
    expect(c?.clientId).toBe("gh-id");
    expect(c?.authorizationUrl).toContain("github.com");
    expect(c?.tokenUrl).toContain("github.com");
  });

  it("returns config for microsoft when env set", () => {
    process.env.MICROSOFT_CLIENT_ID = "ms-id";
    process.env.MICROSOFT_CLIENT_SECRET = "ms-secret";
    const c = getProviderConfig("microsoft");
    expect(c).not.toBeNull();
    expect(c?.clientId).toBe("ms-id");
    expect(c?.authorizationUrl).toContain("login.microsoftonline.com");
  });
});

describe("createSocialLoginState / verifySocialLoginState", () => {
  it("round-trips state with provider and optional redirectUri", () => {
    const state = createSocialLoginState(SECRET, "google", {
      redirectUri: "https://app.example/callback",
    });
    expect(state).toContain(".");
    const payload = verifySocialLoginState(SECRET, state);
    expect(payload).not.toBeNull();
    expect(payload?.provider).toBe("google");
    expect(payload?.redirectUri).toBe("https://app.example/callback");
    expect(payload?.nonce).toMatch(/^[a-f0-9]{32}$/);
  });

  it("rejects state with wrong secret", () => {
    const state = createSocialLoginState(SECRET, "github");
    expect(verifySocialLoginState("wrong-secret", state)).toBeNull();
  });

  it("rejects tampered state", () => {
    const state = createSocialLoginState(SECRET, "google");
    const [payloadB64] = state.split(".");
    const tampered = payloadB64 + ".invalidSig";
    expect(verifySocialLoginState(SECRET, tampered)).toBeNull();
  });

  it("rejects malformed state", () => {
    expect(verifySocialLoginState(SECRET, "no-dot")).toBeNull();
    expect(verifySocialLoginState(SECRET, "a.b.c")).toBeNull();
  });
});

describe("getSocialLoginAuthorizationUrl", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("builds Google auth URL with state and redirect_uri", () => {
    const url = getSocialLoginAuthorizationUrl(
      "google",
      "https://app.example/cb",
      "my-state"
    );
    expect(url).not.toBeNull();
    const u = new URL(url!);
    expect(u.searchParams.get("client_id")).toBe("g-id");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("my-state");
    expect(u.searchParams.get("scope")).toContain("openid");
  });

  it("returns null when provider config missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(
      getSocialLoginAuthorizationUrl("google", "https://x/cb", "s")
    ).toBeNull();
  });
});

describe("exchangeSocialLoginCode", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.restoreAllMocks();
  });

  it("exchanges code for tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
        }),
      })
    );
    const result = await exchangeSocialLoginCode(
      "google",
      "code123",
      "https://app/cb"
    );
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe("at");
    expect(result?.refresh_token).toBe("rt");
    expect(result?.expires_in).toBe(3600);
  });

  it("returns null on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400 })
    );
    const result = await exchangeSocialLoginCode("google", "bad", "https://app/cb");
    expect(result).toBeNull();
  });
});

describe("fetchSocialLoginProfile", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret";
    process.env.MICROSOFT_CLIENT_ID = "ms-id";
    process.env.MICROSOFT_CLIENT_SECRET = "ms-secret";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses Google userinfo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "google-123",
          email: "u@gmail.com",
          name: "User Name",
          picture: "https://photo.jpg",
        }),
      })
    );
    const profile = await fetchSocialLoginProfile("google", "token");
    expect(profile).not.toBeNull();
    expect(profile?.id).toBe("google-123");
    expect(profile?.email).toBe("u@gmail.com");
    expect(profile?.name).toBe("User Name");
    expect(profile?.picture).toBe("https://photo.jpg");
  });

  it("parses GitHub user and fetches email if missing", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (url.includes("/user/emails")) {
          return {
            ok: true,
            json: async () => [{ email: "u@github.com", primary: true }],
          };
        }
        return {
          ok: true,
          json: async () => ({
            id: 456,
            login: "octocat",
            name: "Octo Cat",
            avatar_url: "https://avatar.png",
          }),
        };
      })
    );
    const profile = await fetchSocialLoginProfile("github", "token");
    expect(profile).not.toBeNull();
    expect(profile?.id).toBe("456");
    expect(profile?.email).toBe("u@github.com");
    expect(profile?.name).toBe("Octo Cat");
    expect(profile?.picture).toBe("https://avatar.png");
    expect(callCount).toBe(2);
  });

  it("parses Microsoft userinfo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: "ms-sub",
          email: "u@outlook.com",
          name: "MS User",
          picture: "https://ms-photo.jpg",
        }),
      })
    );
    const profile = await fetchSocialLoginProfile("microsoft", "token");
    expect(profile).not.toBeNull();
    expect(profile?.id).toBe("ms-sub");
    expect(profile?.email).toBe("u@outlook.com");
    expect(profile?.name).toBe("MS User");
  });

  it("returns null on failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const profile = await fetchSocialLoginProfile("google", "token");
    expect(profile).toBeNull();
  });
});

function memorySocialStore(opts?: {
  emailVerified?: boolean;
  withPendingLink?: boolean;
}): SocialLoginStore {
  const users = new Map<string, { id: string; email: string; emailVerified?: boolean }>();
  const byEmail = new Map<string, string>();
  const oauthAccounts = new Map<string, OAuthAccountRow & { accessToken?: string }>();
  const pendingLinks = new Map<
    string,
    { data: PendingLinkData; expiresAt: Date }
  >();
  const key = (p: string, id: string) => `${p}:${id}`;
  return {
    async findUserByEmail(email: string) {
      const id = byEmail.get(email.toLowerCase());
      if (!id) return null;
      const u = users.get(id);
      if (!u) return null;
      return {
        id: u.id,
        email: u.email,
        emailVerified: u.emailVerified,
      };
    },
    async createUser(data) {
      const id = `user_${users.size + 1}`;
      const email = data.email.toLowerCase();
      const user = {
        id,
        email,
        emailVerified: opts?.emailVerified,
      };
      users.set(id, user);
      byEmail.set(email, id);
      return { id, email };
    },
    async findOAuthAccount(provider: string, providerAccountId: string) {
      return oauthAccounts.get(key(provider, providerAccountId)) ?? null;
    },
    async createOAuthAccount(data) {
      oauthAccounts.set(key(data.provider, data.providerAccountId), {
        userId: data.userId,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
      });
    },
    async updateOAuthAccount() {},
    ...(opts?.withPendingLink
      ? {
          async savePendingLink(
            token: string,
            data: PendingLinkData,
            expiresAt: Date
          ) {
            pendingLinks.set(token, { data, expiresAt });
          },
          async getAndDeletePendingLink(token: string) {
            const entry = pendingLinks.get(token);
            pendingLinks.delete(token);
            if (!entry || entry.expiresAt.getTime() < Date.now()) return null;
            return entry.data;
          },
        }
      : {}),
  };
}

describe("handleSocialLoginCallback", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "google-123",
          email: "newuser@example.com",
          name: "New User",
          picture: null,
        }),
      };
    }));
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.restoreAllMocks();
  });

  it("creates user and oauth account when new", async () => {
    const store = memorySocialStore();
    const state = createSocialLoginState(SECRET, "google", {
      redirectUri: "https://app/cb",
    });
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBeDefined();
    const user = await store.findUserByEmail("newuser@example.com");
    expect(user).not.toBeNull();
    expect(user?.id).toBe(result.userId);
    const account = await store.findOAuthAccount("google", "google-123");
    expect(account).not.toBeNull();
    expect(account?.userId).toBe(result.userId);
  });

  it("returns invalid_state when state is wrong", async () => {
    const store = memorySocialStore();
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      "invalid-state",
      { secret: SECRET, store }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_state");
  });

  it("returns email_required when profile has no email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "at", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "no-email",
          name: "No Email",
          email: null,
        }),
      };
    }));
    const store = memorySocialStore();
    const state = createSocialLoginState(SECRET, "google");
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("email_required");
  });

  it("respects isAllowedEmail", async () => {
    const store = memorySocialStore();
    const state = createSocialLoginState(SECRET, "google");
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      {
        secret: SECRET,
        store,
        isAllowedEmail: (email) => email.endsWith("@allowed.com"),
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("email_not_allowed");
  });

  it("links to existing user by email when oauth account is new", async () => {
    const store = memorySocialStore();
    await store.createUser({ email: "existing@example.com", name: "Existing" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "at", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "google-456",
          email: "existing@example.com",
          name: "Existing User",
        }),
      };
    }));
    const state = createSocialLoginState(SECRET, "google");
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const user = await store.findUserByEmail("existing@example.com");
    expect(user?.id).toBe(result.userId);
    const account = await store.findOAuthAccount("google", "google-456");
    expect(account?.userId).toBe(result.userId);
  });

  it("returns existing userId when oauth account already linked", async () => {
    const store = memorySocialStore();
    const user = await store.createUser({
      email: "linked@example.com",
      name: "Linked",
    });
    await store.createOAuthAccount({
      userId: user.id,
      provider: "google",
      providerAccountId: "google-789",
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "at", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "google-789",
          email: "linked@example.com",
          name: "Linked",
        }),
      };
    }));
    const state = createSocialLoginState(SECRET, "google");
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe(user.id);
  });

  it("returns account_exists_with_email when strategy is disabled and user exists by email", async () => {
    const store = memorySocialStore();
    await store.createUser({ email: "existing@example.com", name: "Existing" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "at", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "google-456",
          email: "existing@example.com",
          name: "Existing User",
        }),
      };
    }));
    const state = createSocialLoginState(SECRET, "google");
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store, accountLinkingStrategy: "disabled" }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("account_exists_with_email");
  });

  it("returns link_confirmation_required when strategy is prompt_user and user exists by email", async () => {
    const store = memorySocialStore({ withPendingLink: true });
    await store.createUser({ email: "existing@example.com", name: "Existing" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "at", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "google-456",
          email: "existing@example.com",
          name: "Existing User",
        }),
      };
    }));
    const state = createSocialLoginState(SECRET, "google");
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store, accountLinkingStrategy: "prompt_user" }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("link_confirmation_required");
    expect("linkToken" in result && result.linkToken).toBeDefined();
    expect("userId" in result && result.userId).toBeDefined();
    expect("email" in result && result.email).toBe("existing@example.com");
    expect("provider" in result && result.provider).toBe("google");
  });

  it("returns link_confirmation_required when strategy is automatic but user email not verified", async () => {
    const store = memorySocialStore({
      emailVerified: false,
      withPendingLink: true,
    });
    await store.createUser({ email: "unverified@example.com", name: "Unverified" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "at", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "google-111",
          email: "unverified@example.com",
          name: "Unverified",
        }),
      };
    }));
    const state = createSocialLoginState(SECRET, "google");
    const result = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store, accountLinkingStrategy: "automatic" }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("link_confirmation_required");
    expect("linkToken" in result && result.linkToken).toBeDefined();
  });
});

describe("confirmAccountLink", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "at", expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: "google-456",
          email: "existing@example.com",
          name: "Existing User",
        }),
      };
    }));
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.restoreAllMocks();
  });
  it("links OAuth account to user when valid link token", async () => {
    const store = memorySocialStore({ withPendingLink: true });
    const user = await store.createUser({
      email: "existing@example.com",
      name: "Existing",
    });
    const state = createSocialLoginState(SECRET, "google");
    const callbackResult = await handleSocialLoginCallback(
      "google",
      "code",
      "https://app/cb",
      state,
      { secret: SECRET, store, accountLinkingStrategy: "prompt_user" }
    );
    expect(callbackResult.ok).toBe(false);
    if (callbackResult.ok) return;
    expect(callbackResult.error).toBe("link_confirmation_required");
    const linkToken = callbackResult.linkToken;
    const confirmResult = await confirmAccountLink(linkToken, { store });
    expect(confirmResult.ok).toBe(true);
    if (!confirmResult.ok) return;
    expect(confirmResult.userId).toBe(user.id);
    const account = await store.findOAuthAccount("google", "google-456");
    expect(account).not.toBeNull();
    expect(account?.userId).toBe(user.id);
  });

  it("returns invalid_link_token for unknown or reused token", async () => {
    const store = memorySocialStore({ withPendingLink: true });
    expect(await confirmAccountLink("unknown-token", { store })).toEqual({
      ok: false,
      error: "invalid_link_token",
    });
  });

  it("returns already_linked when provider account was linked after pending created", async () => {
    const store = memorySocialStore({ withPendingLink: true });
    const user = await store.createUser({
      email: "existing@example.com",
      name: "Existing",
    });
    await store.createOAuthAccount({
      userId: user.id,
      provider: "google",
      providerAccountId: "google-456",
    });
    const expiresAt = new Date(Date.now() + 600_000);
    await store.savePendingLink!(
      "reused-token",
      {
        userId: user.id,
        provider: "google",
        providerAccountId: "google-456",
        accessToken: "at",
      },
      expiresAt
    );
    const result = await confirmAccountLink("reused-token", { store });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_linked");
  });
});
