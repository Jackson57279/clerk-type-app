import { describe, it, expect, vi } from "vitest";
import * as simplewebauthn from "@simplewebauthn/server";
import type {
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import {
  createMemoryPasskeyStore,
  createMemoryPasskeyChallengeStore,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  revokePasskey,
  type StoredPasskey,
  type PasskeyRpConfig,
} from "../src/passkeys.js";

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@simplewebauthn/server")>();
  const defaultRegMock = async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: "mock-cred-id",
        publicKey: new Uint8Array(32),
        counter: 0,
        transports: [],
      },
      credentialDeviceType: "singleDevice" as const,
      credentialBackedUp: false,
    },
  });
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn().mockImplementation(defaultRegMock),
    verifyAuthenticationResponse: vi.fn().mockImplementation(actual.verifyAuthenticationResponse),
  };
});

const rpConfig: PasskeyRpConfig = {
  rpName: "Test RP",
  rpID: "localhost",
  origin: "http://localhost",
};

const allowMfaBackupProvider = { hasMfaOrBackupCodes: async () => true };

describe("PasskeyStore (multiple passkeys)", () => {
  it("user can register multiple passkeys and use any for auth", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const userId = "user-1";
    const base: Omit<StoredPasskey, "credentialId" | "publicKey"> = {
      userId,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "webauthn-id",
    };
    await credentialStore.save({
      ...base,
      credentialId: "passkey-laptop",
      publicKey: new Uint8Array([1, 2, 3]),
    });
    await credentialStore.save({
      ...base,
      credentialId: "passkey-phone",
      publicKey: new Uint8Array([4, 5, 6]),
    });
    const list = await credentialStore.listByUserId(userId);
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.credentialId).sort()).toEqual(["passkey-laptop", "passkey-phone"]);

    const regOptions = await startRegistration({
      userId,
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(regOptions.excludeCredentials).toHaveLength(2);
    expect(regOptions.excludeCredentials!.map((c) => c.id).sort()).toEqual([
      "passkey-laptop",
      "passkey-phone",
    ]);

    const authOptions = await startAuthentication({
      userId,
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(authOptions.allowCredentials).toHaveLength(2);
    expect(authOptions.allowCredentials!.map((c) => c.id).sort()).toEqual([
      "passkey-laptop",
      "passkey-phone",
    ]);
  });

  it("saves and lists multiple passkeys for the same user", async () => {
    const store = createMemoryPasskeyStore();
    const userId = "user-1";
    const base: Omit<StoredPasskey, "credentialId" | "publicKey"> = {
      userId,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "webauthn-id",
    };
    await store.save({
      ...base,
      credentialId: "cred-1",
      publicKey: new Uint8Array([1, 2, 3]),
    });
    await store.save({
      ...base,
      credentialId: "cred-2",
      publicKey: new Uint8Array([4, 5, 6]),
    });
    await store.save({
      ...base,
      credentialId: "cred-3",
      publicKey: new Uint8Array([7, 8, 9]),
    });
    const list = await store.listByUserId(userId);
    expect(list).toHaveLength(3);
    expect(list.map((p) => p.credentialId).sort()).toEqual(["cred-1", "cred-2", "cred-3"]);
  });

  it("findByCredentialId returns the correct passkey among many", async () => {
    const store = createMemoryPasskeyStore();
    const userId = "user-1";
    await store.save({
      userId,
      credentialId: "cred-a",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "wid",
    });
    await store.save({
      userId,
      credentialId: "cred-b",
      publicKey: new Uint8Array(2),
      counter: 1,
      deviceType: "multiDevice",
      backedUp: true,
      webauthnUserID: "wid",
    });
    const found = await store.findByCredentialId(userId, "cred-b");
    expect(found).not.toBeNull();
    expect(found!.credentialId).toBe("cred-b");
    expect(found!.counter).toBe(1);
    expect(found!.deviceType).toBe("multiDevice");
  });

  it("updateCounter updates only the matching credential", async () => {
    const store = createMemoryPasskeyStore();
    const userId = "user-1";
    await store.save({
      userId,
      credentialId: "c1",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await store.save({
      userId,
      credentialId: "c2",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await store.updateCounter(userId, "c2", 5);
    const list = await store.listByUserId(userId);
    const c1 = list.find((p) => p.credentialId === "c1");
    const c2 = list.find((p) => p.credentialId === "c2");
    expect(c1!.counter).toBe(0);
    expect(c2!.counter).toBe(5);
  });

  it("delete removes one credential and leaves others", async () => {
    const store = createMemoryPasskeyStore();
    const userId = "user-1";
    await store.save({
      userId,
      credentialId: "x",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await store.save({
      userId,
      credentialId: "y",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await store.delete(userId, "x");
    const list = await store.listByUserId(userId);
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("y");
  });
});

describe("Passkey metadata (name, device info, last used)", () => {
  it("save and list preserve friendlyName, deviceInfo, and lastUsedAt", async () => {
    const store = createMemoryPasskeyStore();
    const userId = "user-1";
    const lastUsedAt = "2025-02-20T12:00:00.000Z";
    await store.save({
      userId,
      credentialId: "cred-meta",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
      friendlyName: "My MacBook",
      deviceInfo: "Chrome on macOS · internal",
      lastUsedAt,
    });
    const list = await store.listByUserId(userId);
    expect(list).toHaveLength(1);
    expect(list[0]!.friendlyName).toBe("My MacBook");
    expect(list[0]!.deviceInfo).toBe("Chrome on macOS · internal");
    expect(list[0]!.lastUsedAt).toBe(lastUsedAt);
  });

  it("updateLastUsed sets lastUsedAt on the credential", async () => {
    const store = createMemoryPasskeyStore();
    const userId = "user-1";
    await store.save({
      userId,
      credentialId: "cred-1",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    expect((await store.listByUserId(userId))[0]!.lastUsedAt).toBeUndefined();
    const before = Date.now();
    await store.updateLastUsed(userId, "cred-1");
    const after = Date.now();
    const list = await store.listByUserId(userId);
    expect(list[0]!.lastUsedAt).toBeDefined();
    const ts = new Date(list[0]!.lastUsedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it("updateLastUsed only updates the matching credential", async () => {
    const store = createMemoryPasskeyStore();
    const userId = "user-1";
    await store.save({
      userId,
      credentialId: "cred-a",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await store.save({
      userId,
      credentialId: "cred-b",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
      lastUsedAt: "2025-01-01T00:00:00.000Z",
    });
    await store.updateLastUsed(userId, "cred-a");
    const list = await store.listByUserId(userId);
    const a = list.find((p) => p.credentialId === "cred-a");
    const b = list.find((p) => p.credentialId === "cred-b");
    expect(a!.lastUsedAt).toBeDefined();
    expect(b!.lastUsedAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("finishRegistration with name and deviceInfo stores friendlyName and deviceInfo", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await startRegistration({
      userId: "u-meta",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    await finishRegistration({
      userId: "u-meta",
      response: {
        id: "mock-cred-id",
        rawId: "mock-cred-id",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3ClB1YmxpYyBLZXnALg",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider: allowMfaBackupProvider,
      name: "My MacBook",
      deviceInfo: "Chrome on macOS · internal",
    });
    const list = await credentialStore.listByUserId("u-meta");
    expect(list).toHaveLength(1);
    expect(list[0]!.friendlyName).toBe("My MacBook");
    expect(list[0]!.deviceInfo).toBe("Chrome on macOS · internal");
  });

  it("finishAuthentication updates lastUsedAt on the used passkey", async () => {
    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      }) as VerifiedAuthenticationResponse
    );
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await credentialStore.save({
      userId: "u1",
      credentialId: "p1",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await startAuthentication({
      userId: "u1",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    const before = Date.now();
    const result = await finishAuthentication({
      userId: "u1",
      response: {
        id: "p1",
        rawId: "p1",
        type: "public-key",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiYWJjIiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdCJ9",
          authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAA",
          signature: "MEUCIQDxZWE",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
    });
    const after = Date.now();
    expect(result.verified).toBe(true);
    const list = await credentialStore.listByUserId("u1");
    expect(list[0]!.lastUsedAt).toBeDefined();
    const ts = new Date(list[0]!.lastUsedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });
});

describe("Passkey revocation", () => {
  it("revokes an existing passkey and returns revoked true", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const userId = "user-1";
    await credentialStore.save({
      userId,
      credentialId: "lost-device",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const result = await revokePasskey({
      userId,
      credentialId: "lost-device",
      credentialStore,
    });
    expect(result.revoked).toBe(true);
    const list = await credentialStore.listByUserId(userId);
    expect(list).toHaveLength(0);
  });

  it("revoking non-existent credential returns revoked false and does not affect other passkeys", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const userId = "user-1";
    await credentialStore.save({
      userId,
      credentialId: "kept",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const result = await revokePasskey({
      userId,
      credentialId: "unknown-credential",
      credentialStore,
    });
    expect(result.revoked).toBe(false);
    const list = await credentialStore.listByUserId(userId);
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("kept");
  });

  it("revoking one of multiple passkeys leaves the others", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const userId = "user-1";
    const base: Omit<StoredPasskey, "credentialId" | "publicKey"> = {
      userId,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    };
    await credentialStore.save({ ...base, credentialId: "a", publicKey: new Uint8Array(1) });
    await credentialStore.save({ ...base, credentialId: "b", publicKey: new Uint8Array(1) });
    await credentialStore.save({ ...base, credentialId: "c", publicKey: new Uint8Array(1) });
    const result = await revokePasskey({
      userId,
      credentialId: "b",
      credentialStore,
    });
    expect(result.revoked).toBe(true);
    const list = await credentialStore.listByUserId(userId);
    expect(list.map((p) => p.credentialId).sort()).toEqual(["a", "c"]);
  });

  it("revoking credential for another user does not revoke it", async () => {
    const credentialStore = createMemoryPasskeyStore();
    await credentialStore.save({
      userId: "user-A",
      credentialId: "cred-a",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const result = await revokePasskey({
      userId: "user-B",
      credentialId: "cred-a",
      credentialStore,
    });
    expect(result.revoked).toBe(false);
    const list = await credentialStore.listByUserId("user-A");
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("cred-a");
  });
});

describe("startRegistration", () => {
  it("returns registration options with no excludeCredentials when user has no passkeys", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const options = await startRegistration({
      userId: "u1",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(options.challenge).toBeDefined();
    expect(options.rp).toEqual({ name: "Test RP", id: "localhost" });
    expect(options.user.name).toBe("alice");
    expect(options.excludeCredentials ?? []).toHaveLength(0);
  });

  it("excludes existing passkeys when user has multiple passkeys", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await credentialStore.save({
      userId: "u1",
      credentialId: "existing-1",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await credentialStore.save({
      userId: "u1",
      credentialId: "existing-2",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const options = await startRegistration({
      userId: "u1",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(options.excludeCredentials).toHaveLength(2);
    const ids = options.excludeCredentials!.map((c) => c.id).sort();
    expect(ids).toEqual(["existing-1", "existing-2"]);
  });

  it("stores registration options in challenge store for finishRegistration", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await startRegistration({
      userId: "u1",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(challengeStore.getRegistrationOptions("u1")).not.toBeNull();
    expect(challengeStore.getRegistrationOptions("u1")!.challenge).toBeDefined();
  });

  it("can request resident keys on cross-platform hardware authenticators", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const options = await startRegistration({
      userId: "u-hardware",
      userName: "bob",
      credentialStore,
      challengeStore,
      rpConfig,
      residentKeyRequirement: "required",
      authenticatorAttachment: "cross-platform",
    });
    expect(options.authenticatorSelection?.residentKey).toBe("required");
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe("cross-platform");
  });
});

describe("WebAuthn hardware keys (cross-platform authenticators)", () => {
  it("requests cross-platform attachment and optional userVerification for hardware keys", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const options = await startRegistration({
      userId: "u-yubikey",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
      authenticatorAttachment: "cross-platform",
      userVerification: "required",
      preferredAuthenticatorType: "securityKey",
    });
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe("cross-platform");
    expect(options.authenticatorSelection?.userVerification).toBe("required");
  });

  it("startAuthentication with userVerification required forwards to options", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await credentialStore.save({
      userId: "u1",
      credentialId: "hw-cred",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const options = await startAuthentication({
      userId: "u1",
      credentialStore,
      challengeStore,
      rpConfig,
      userVerification: "required",
    });
    expect(options.userVerification).toBe("required");
  });
});

describe("WebAuthn platform authenticators", () => {
  it("requests platform attachment for Touch ID / Windows Hello", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const options = await startRegistration({
      userId: "u-platform",
      userName: "bob",
      credentialStore,
      challengeStore,
      rpConfig,
      authenticatorAttachment: "platform",
      userVerification: "preferred",
      preferredAuthenticatorType: "localDevice",
    });
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe("platform");
    expect(options.authenticatorSelection?.userVerification).toBe("preferred");
  });

  it("stores deviceType and transports from verification (platform vs cross-platform)", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await startRegistration({
      userId: "u-device-type",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
      authenticatorAttachment: "platform",
    });
    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        registrationInfo: {
          credential: {
            id: "platform-cred",
            publicKey: new Uint8Array(32),
            counter: 0,
            transports: ["internal"],
          },
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
        },
      }) as VerifiedRegistrationResponse
    );
    await finishRegistration({
      userId: "u-device-type",
      response: {
        id: "platform-cred",
        rawId: "platform-cred",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3ClB1YmxpYyBLZXnALg",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider: allowMfaBackupProvider,
    });
    const list = await credentialStore.listByUserId("u-device-type");
    expect(list).toHaveLength(1);
    expect(list[0]!.deviceType).toBe("singleDevice");
    expect(list[0]!.transports).toEqual(["internal"]);
  });
});

describe("finishRegistration", () => {
  it("returns verified false when no registration challenge was stored", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const result = await finishRegistration({
      userId: "u1",
      response: {
        id: "any",
        rawId: "any",
        type: "public-key",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiYWJjIiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdCJ9",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3 ClB1YmxpYyBLZXnALg",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider: allowMfaBackupProvider,
    });
    expect(result.verified).toBe(false);
  });

  it("returns requiresMfaOrBackup and does not save passkey when mfaBackupProvider returns false", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await startRegistration({
      userId: "u1",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    const mfaBackupProvider = {
      hasMfaOrBackupCodes: vi.fn().mockResolvedValue(false),
    };
    const result = await finishRegistration({
      userId: "u1",
      response: {
        id: "mock-cred-id",
        rawId: "mock-cred-id",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3 ClB1YmxpYyBLZXnALg",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider,
    });
    expect(result.verified).toBe(false);
    expect(result.requiresMfaOrBackup).toBe(true);
    const list = await credentialStore.listByUserId("u1");
    expect(list).toHaveLength(0);
  });

  it("saves passkey when mfaBackupProvider returns true after verification", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await startRegistration({
      userId: "u1",
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    const mfaBackupProvider = {
      hasMfaOrBackupCodes: vi.fn().mockResolvedValue(true),
    };
    const result = await finishRegistration({
      userId: "u1",
      response: {
        id: "mock-cred-id",
        rawId: "mock-cred-id",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3 ClB1YmxpYyBLZXnALg",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider,
    });
    expect(result.verified).toBe(true);
    expect(result.credentialId).toBe("mock-cred-id");
    expect(result.requiresMfaOrBackup).toBeUndefined();
    const list = await credentialStore.listByUserId("u1");
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("mock-cred-id");
  });

  it("allows registering multiple passkeys via repeated registration flow", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const userId = "user-multi";
    const baseResponse = {
      rawId: "mock",
      type: "public-key" as const,
      response: {
        clientDataJSON: "e30",
        attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3ClB1YmxpYyBLZXnALg",
      },
      clientExtensionResults: {},
    };
    const mockCred = (id: string) => ({
      verified: true as const,
      registrationInfo: {
        credential: {
          id,
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: [] as const,
        },
        credentialDeviceType: "singleDevice" as const,
        credentialBackedUp: false,
      },
    });
    vi.mocked(simplewebauthn.verifyRegistrationResponse)
      .mockImplementationOnce(async () => mockCred("cred-first") as unknown as VerifiedRegistrationResponse)
      .mockImplementationOnce(async () => mockCred("cred-second") as unknown as VerifiedRegistrationResponse);

    await startRegistration({
      userId,
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    const r1 = await finishRegistration({
      userId,
      response: { ...baseResponse, id: "cred-first" },
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider: allowMfaBackupProvider,
    });
    expect(r1.verified).toBe(true);
    expect(r1.credentialId).toBe("cred-first");

    await startRegistration({
      userId,
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    const r2 = await finishRegistration({
      userId,
      response: { ...baseResponse, id: "cred-second" },
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider: allowMfaBackupProvider,
    });
    expect(r2.verified).toBe(true);
    expect(r2.credentialId).toBe("cred-second");

    const list = await credentialStore.listByUserId(userId);
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.credentialId).sort()).toEqual(["cred-first", "cred-second"]);

    const authOptions = await startAuthentication({
      userId,
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(authOptions.allowCredentials).toHaveLength(2);
    expect(authOptions.allowCredentials!.map((c) => c.id).sort()).toEqual(["cred-first", "cred-second"]);
  });
});

describe("startAuthentication", () => {
  it("returns allowCredentials for all user passkeys when user has multiple", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await credentialStore.save({
      userId: "u1",
      credentialId: "p1",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await credentialStore.save({
      userId: "u1",
      credentialId: "p2",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const options = await startAuthentication({
      userId: "u1",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(options.allowCredentials).toHaveLength(2);
    const ids = options.allowCredentials!.map((c) => c.id).sort();
    expect(ids).toEqual(["p1", "p2"]);
  });

  it("stores authentication options in challenge store", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await credentialStore.save({
      userId: "u1",
      credentialId: "p1",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await startAuthentication({
      userId: "u1",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(challengeStore.getAuthenticationOptions("u1")).not.toBeNull();
    expect(challengeStore.getAuthenticationOptions("u1")!.challenge).toBeDefined();
  });
});

describe("finishAuthentication", () => {
  it("returns verified false when no authentication challenge was stored", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await credentialStore.save({
      userId: "u1",
      credentialId: "p1",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const result = await finishAuthentication({
      userId: "u1",
      response: {
        id: "p1",
        rawId: "p1",
        type: "public-key",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiYWJjIiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdCJ9",
          authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAA",
          signature: "MEUCIQDxZWE",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(result.verified).toBe(false);
  });

  it("returns verified false when credential id is not registered for user", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await credentialStore.save({
      userId: "u1",
      credentialId: "registered-id",
      publicKey: new Uint8Array(1),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await startAuthentication({
      userId: "u1",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    const result = await finishAuthentication({
      userId: "u1",
      response: {
        id: "unknown-credential-id",
        rawId: "unknown-credential-id",
        type: "public-key",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiYWJjIiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdCJ9",
          authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAA",
          signature: "MEUCIQDxZWE",
        },
        clientExtensionResults: {},
      },
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(result.verified).toBe(false);
  });
});
