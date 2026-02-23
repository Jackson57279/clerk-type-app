import { describe, it, expect } from "vitest";
import {
  createMemoryPasskeyStore,
  createMemoryPasskeyChallengeStore,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  type StoredPasskey,
  type PasskeyRpConfig,
} from "../src/passkeys.js";

const rpConfig: PasskeyRpConfig = {
  rpName: "Test RP",
  rpID: "localhost",
  origin: "http://localhost",
};

describe("PasskeyStore (multiple passkeys)", () => {
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
    });
    expect(result.verified).toBe(false);
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
