import { describe, it, expect, vi } from "vitest";
import * as simplewebauthn from "@simplewebauthn/server";
import type { VerifiedRegistrationResponse } from "@simplewebauthn/server";
import {
  createMemoryPasskeyStore,
  createMemoryPasskeyChallengeStore,
  listPasskeys,
} from "../src/passkeys.js";
import {
  startPasskeyRegistration,
  finishPasskeyRegistration,
  type PasskeyRegistrationDeps,
} from "../src/passkey-registration.js";

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn().mockImplementation(async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: "reg-cred-1",
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "singleDevice" as const,
        credentialBackedUp: false,
      },
    })),
  };
});

const rpConfig = {
  rpName: "Test RP",
  rpID: "localhost",
  origin: "http://localhost",
};

function createDeps(mfaBackupProvider: { hasMfaOrBackupCodes: (userId: string) => Promise<boolean> }): PasskeyRegistrationDeps {
  return {
    credentialStore: createMemoryPasskeyStore(),
    challengeStore: createMemoryPasskeyChallengeStore(),
    rpConfig,
    mfaBackupProvider,
  };
}

describe("passkey registration", () => {
  it("full flow: start then finish stores credential and listPasskeys returns it", async () => {
    const deps = createDeps({ hasMfaOrBackupCodes: async () => true });
    const userId = "user-reg-1";
    const userName = "alice@example.com";

    const options = await startPasskeyRegistration(deps, { userId, userName });
    expect(options.challenge).toBeDefined();
    expect(options.rp).toEqual({ name: "Test RP", id: "localhost" });
    expect(options.user.name).toBe(userName);

    const response = {
      id: "reg-cred-1",
      rawId: "reg-cred-1",
      type: "public-key" as const,
      response: {
        clientDataJSON: "e30",
        attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3ClB1YmxpYyBLZXnALg",
      },
      clientExtensionResults: {},
    };

    const result = await finishPasskeyRegistration(deps, { userId, response });
    expect(result.verified).toBe(true);
    expect(result.credentialId).toBe("reg-cred-1");

    const list = await listPasskeys({ userId, credentialStore: deps.credentialStore });
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("reg-cred-1");
  });

  it("finishPasskeyRegistration returns verified false when no challenge was stored", async () => {
    const deps = createDeps({ hasMfaOrBackupCodes: async () => true });
    const result = await finishPasskeyRegistration(deps, {
      userId: "user-no-challenge",
      response: {
        id: "any",
        rawId: "any",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oA",
        },
        clientExtensionResults: {},
      },
    });
    expect(result.verified).toBe(false);
  });

  it("finishPasskeyRegistration returns requiresMfaOrBackup and does not save when mfaBackupProvider returns false", async () => {
    const deps = createDeps({ hasMfaOrBackupCodes: async () => false });
    await startPasskeyRegistration(deps, {
      userId: "user-mfa-required",
      userName: "bob",
    });
    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-mfa",
            publicKey: new Uint8Array(32),
            counter: 0,
            transports: [],
          },
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
        },
      }) as unknown as VerifiedRegistrationResponse
    );
    const result = await finishPasskeyRegistration(deps, {
      userId: "user-mfa-required",
      response: {
        id: "cred-mfa",
        rawId: "cred-mfa",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oA",
        },
        clientExtensionResults: {},
      },
    });
    expect(result.verified).toBe(false);
    expect(result.requiresMfaOrBackup).toBe(true);
    const list = await listPasskeys({ userId: "user-mfa-required", credentialStore: deps.credentialStore });
    expect(list).toHaveLength(0);
  });

  it("startPasskeyRegistration accepts optional authenticator options", async () => {
    const deps = createDeps({ hasMfaOrBackupCodes: async () => true });
    const options = await startPasskeyRegistration(deps, {
      userId: "user-opts",
      userName: "carol",
      residentKeyRequirement: "preferred",
      authenticatorAttachment: "platform",
      userVerification: "preferred",
    });
    expect(options.authenticatorSelection?.residentKey).toBe("preferred");
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe("platform");
    expect(options.authenticatorSelection?.userVerification).toBe("preferred");
  });

  it("finishPasskeyRegistration stores friendlyName and deviceInfo when provided", async () => {
    const deps = createDeps({ hasMfaOrBackupCodes: async () => true });
    await startPasskeyRegistration(deps, { userId: "user-meta", userName: "dave" });
    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-meta",
            publicKey: new Uint8Array(32),
            counter: 0,
            transports: ["internal"],
          },
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
        },
      }) as unknown as VerifiedRegistrationResponse
    );
    await finishPasskeyRegistration(deps, {
      userId: "user-meta",
      response: {
        id: "cred-meta",
        rawId: "cred-meta",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oA",
        },
        clientExtensionResults: {},
      },
      name: "My MacBook",
      deviceInfo: "Chrome on macOS",
    });
    const list = await listPasskeys({ userId: "user-meta", credentialStore: deps.credentialStore });
    expect(list[0]!.friendlyName).toBe("My MacBook");
    expect(list[0]!.deviceInfo).toContain("Chrome");
  });

  it("finishPasskeyRegistration stores multiDevice and backedUp when authenticator is synced", async () => {
    const deps = createDeps({ hasMfaOrBackupCodes: async () => true });
    await startPasskeyRegistration(deps, { userId: "user-synced", userName: "eve" });
    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-synced",
            publicKey: new Uint8Array(32),
            counter: 0,
            transports: ["internal"],
          },
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      }) as unknown as VerifiedRegistrationResponse
    );
    await finishPasskeyRegistration(deps, {
      userId: "user-synced",
      response: {
        id: "cred-synced",
        rawId: "cred-synced",
        type: "public-key",
        response: {
          clientDataJSON: "e30",
          attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oA",
        },
        clientExtensionResults: {},
      },
    });
    const list = await listPasskeys({ userId: "user-synced", credentialStore: deps.credentialStore });
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("cred-synced");
    expect(list[0]!.deviceType).toBe("multiDevice");
    expect(list[0]!.backedUp).toBe(true);
  });
});
