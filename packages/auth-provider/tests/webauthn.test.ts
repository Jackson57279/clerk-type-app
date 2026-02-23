import { describe, it, expect, vi } from "vitest";
import * as simplewebauthn from "@simplewebauthn/server";
import type { VerifiedRegistrationResponse } from "@simplewebauthn/server";
import {
  createMemoryPasskeyStore,
  createMemoryPasskeyChallengeStore,
  startRegistration,
  finishRegistration,
  startAuthentication,
  type PasskeyRpConfig,
} from "../src/passkeys.js";

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn().mockImplementation(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: "webauthn-cred",
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    })),
    verifyAuthenticationResponse: vi.fn().mockImplementation(actual.verifyAuthenticationResponse),
  };
});

const rpConfig: PasskeyRpConfig = {
  rpName: "Test RP",
  rpID: "localhost",
  origin: "http://localhost",
};

const allowMfaBackup = { hasMfaOrBackupCodes: async () => true };

describe("WebAuthn hardware keys", () => {
  it("startRegistration with cross-platform and securityKey returns options for hardware key", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const options = await startRegistration({
      userId: "u-hw",
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

  it("register hardware key then authenticate with userVerification required", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await startRegistration({
      userId: "u-hw-flow",
      userName: "bob",
      credentialStore,
      challengeStore,
      rpConfig,
      authenticatorAttachment: "cross-platform",
      preferredAuthenticatorType: "securityKey",
    });
    await finishRegistration({
      userId: "u-hw-flow",
      response: {
        id: "webauthn-cred",
        rawId: "webauthn-cred",
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
      mfaBackupProvider: allowMfaBackup,
    });
    const authOptions = await startAuthentication({
      userId: "u-hw-flow",
      credentialStore,
      challengeStore,
      rpConfig,
      userVerification: "required",
    });
    expect(authOptions.userVerification).toBe("required");
    expect(authOptions.allowCredentials).toBeDefined();
    expect(authOptions.allowCredentials?.some((c) => c.id === "webauthn-cred")).toBe(true);
  });
});

describe("WebAuthn platform authenticators", () => {
  it("startRegistration with platform and localDevice returns options for Touch ID / Windows Hello", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    const options = await startRegistration({
      userId: "u-platform",
      userName: "carol",
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

  it("register platform authenticator and persist with internal transport", async () => {
    const credentialStore = createMemoryPasskeyStore();
    const challengeStore = createMemoryPasskeyChallengeStore();
    await startRegistration({
      userId: "u-platform-flow",
      userName: "dave",
      credentialStore,
      challengeStore,
      rpConfig,
      authenticatorAttachment: "platform",
      preferredAuthenticatorType: "localDevice",
    });
    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        registrationInfo: {
          credential: {
            id: "platform-cred-id",
            publicKey: new Uint8Array(32),
            counter: 0,
            transports: ["internal"],
          },
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
        },
      }) as VerifiedRegistrationResponse
    );
    const result = await finishRegistration({
      userId: "u-platform-flow",
      response: {
        id: "platform-cred-id",
        rawId: "platform-cred-id",
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
      mfaBackupProvider: allowMfaBackup,
    });
    expect(result.verified).toBe(true);
    expect(result.credentialId).toBe("platform-cred-id");
    const list = await credentialStore.listByUserId("u-platform-flow");
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("platform-cred-id");
    expect(list[0]!.transports).toEqual(["internal"]);
  });
});
