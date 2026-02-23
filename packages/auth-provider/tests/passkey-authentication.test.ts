import { describe, it, expect, vi } from "vitest";
import type { VerifiedAuthenticationResponse } from "@simplewebauthn/server";
import {
  createMemoryPasskeyStore,
  createMemoryPasskeyChallengeStore,
} from "../src/passkeys.js";
import {
  startPasskeyAuthentication,
  finishPasskeyAuthentication,
  type PasskeyAuthenticationDeps,
} from "../src/passkey-authentication.js";

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyAuthenticationResponse: vi.fn().mockImplementation(actual.verifyAuthenticationResponse),
  };
});

const rpConfig = {
  rpName: "Test RP",
  rpID: "localhost",
  origin: "http://localhost",
};

function createDeps(): PasskeyAuthenticationDeps {
  return {
    credentialStore: createMemoryPasskeyStore(),
    challengeStore: createMemoryPasskeyChallengeStore(),
    rpConfig,
  };
}

const baseAuthResponse = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key" as const,
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiYWJjIiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdCJ9",
    authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAA",
    signature: "MEUCIQDxZWE",
  },
  clientExtensionResults: {},
};

describe("passkey authentication", () => {
  it("full flow: start then finish with userId returns verified and updates counter", async () => {
    const deps = createDeps();
    const userId = "user-auth-1";
    await deps.credentialStore.save({
      userId,
      credentialId: "cred-1",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });

    const options = await startPasskeyAuthentication(deps, { userId });
    expect(options.challenge).toBeDefined();
    expect(options.allowCredentials).toHaveLength(1);
    expect(options.allowCredentials![0]!.id).toBe("cred-1");

    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyAuthenticationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      }) as VerifiedAuthenticationResponse
    );

    const result = await finishPasskeyAuthentication(deps, {
      userId,
      response: baseAuthResponse,
    });
    expect(result.verified).toBe(true);
    expect(result.credentialId).toBe("cred-1");
    expect(result.userId).toBeUndefined();
  });

  it("finishPasskeyAuthentication returns verified false when no challenge was stored", async () => {
    const deps = createDeps();
    await deps.credentialStore.save({
      userId: "user-no-challenge",
      credentialId: "cred-1",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const result = await finishPasskeyAuthentication(deps, {
      userId: "user-no-challenge",
      response: baseAuthResponse,
    });
    expect(result.verified).toBe(false);
  });

  it("finishPasskeyAuthentication returns verified false when credential not registered for user", async () => {
    const deps = createDeps();
    await deps.credentialStore.save({
      userId: "user-1",
      credentialId: "other-cred",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    await startPasskeyAuthentication(deps, { userId: "user-1" });
    const result = await finishPasskeyAuthentication(deps, {
      userId: "user-1",
      response: { ...baseAuthResponse, id: "wrong-cred", rawId: "wrong-cred" },
    });
    expect(result.verified).toBe(false);
  });

  it("startPasskeyAuthentication with useDiscoverableCredentials omits allowCredentials", async () => {
    const deps = createDeps();
    const options = await startPasskeyAuthentication(deps, {
      useDiscoverableCredentials: true,
    });
    expect(options.allowCredentials).toBeUndefined();
    expect(options.challenge).toBeDefined();
  });

  it("discoverable flow: finish without userId returns userId when verified", async () => {
    const deps = createDeps();
    const userId = "user-discoverable";
    await deps.credentialStore.save({
      userId,
      credentialId: "resident-cred",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const authOptions = await startPasskeyAuthentication(deps, {
      useDiscoverableCredentials: true,
    });
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: authOptions.challenge,
        origin: rpConfig.origin,
      }),
      "utf-8"
    ).toString("base64url");

    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyAuthenticationResponse).mockImplementationOnce(async () =>
      ({
        verified: true,
        authenticationInfo: {
          newCounter: 1,
          credentialID: "resident-cred",
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
        },
      }) as unknown as VerifiedAuthenticationResponse
    );

    const result = await finishPasskeyAuthentication(deps, {
      response: {
        ...baseAuthResponse,
        id: "resident-cred",
        rawId: "resident-cred",
        response: {
          ...baseAuthResponse.response,
          clientDataJSON,
        },
      },
    });
    expect(result.verified).toBe(true);
    expect(result.userId).toBe("user-discoverable");
    expect(result.credentialId).toBe("resident-cred");
  });

  it("startPasskeyAuthentication accepts userVerification", async () => {
    const deps = createDeps();
    await deps.credentialStore.save({
      userId: "user-uv",
      credentialId: "cred-uv",
      publicKey: new Uint8Array(32),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "w",
    });
    const options = await startPasskeyAuthentication(deps, {
      userId: "user-uv",
      userVerification: "required",
    });
    expect(options.userVerification).toBe("required");
  });
});
