import { describe, it, expect, vi } from "vitest";
import * as simplewebauthn from "@simplewebauthn/server";
import type { VerifiedRegistrationResponse } from "@simplewebauthn/server";
import {
  createPostgresPasskeyStore,
  type PostgresPasskeyStoreOptions,
} from "../src/webauthn-credentials-db.js";
import {
  createMemoryPasskeyChallengeStore,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  listPasskeys,
  revokePasskey,
  type StoredPasskey,
  type PasskeyRpConfig,
} from "../src/passkeys.js";

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn().mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "dGVzdC1jcmVkLWJhc2U2NHVybA",
          publicKey: new Uint8Array(32).fill(1),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "singleDevice" as const,
        credentialBackedUp: false,
      },
    }),
    verifyAuthenticationResponse: vi.fn().mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    }),
  };
});

interface WebauthnCredentialRow {
  user_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  sign_count: number;
  device_type: string | null;
  friendly_name: string | null;
  is_synced: boolean;
  last_used_at: Date | null;
}

function createMockPool(): {
  pool: PostgresPasskeyStoreOptions["pool"];
  rows: Map<string, WebauthnCredentialRow[]>;
  queries: { text: string; values: unknown[] }[];
} {
  const rows = new Map<string, WebauthnCredentialRow[]>();
  const queries: { text: string; values: unknown[] }[] = [];

  const runQuery = (
    text: string,
    values: unknown[] = []
  ): { rows: unknown[] } => {
    queries.push({ text, values });
    if (
      text.includes("INSERT INTO webauthn_credentials") &&
      text.includes("ON CONFLICT")
    ) {
      const userId = values[0] as string;
      const credential_id = values[1] as Buffer;
      const existing = (rows.get(userId) ?? []) as WebauthnCredentialRow[];
      if (
        !existing.some(
          (r) => r.credential_id.toString("base64url") === credential_id.toString("base64url")
        )
      ) {
        existing.push({
          user_id: userId,
          credential_id,
          public_key: values[2] as Buffer,
          sign_count: values[3] as number,
          device_type: values[4] as string,
          friendly_name: values[5] as string | null,
          is_synced: values[6] as boolean,
          last_used_at: null,
        });
        rows.set(userId, existing);
      }
      return { rows: [] };
    }
    if (text.startsWith("SELECT") && text.includes("WHERE user_id = $1") && values.length === 1) {
      const userId = values[0] as string;
      const list = rows.get(userId) ?? [];
      return { rows: list };
    }
    if (
      text.startsWith("SELECT") &&
      text.includes("WHERE user_id = $1 AND credential_id = $2")
    ) {
      const userId = values[0] as string;
      const list = (rows.get(userId) ?? []) as WebauthnCredentialRow[];
      const credId = (values[1] as Buffer).toString("base64url");
      const row = list.find(
        (r) => r.credential_id.toString("base64url") === credId
      );
      return { rows: row ? [row] : [] };
    }
    if (
      text.startsWith("SELECT") &&
      text.includes("WHERE credential_id = $1")
    ) {
      for (const list of rows.values()) {
        const arr = list as WebauthnCredentialRow[];
        const credId = (values[0] as Buffer).toString("base64url");
        const row = arr.find(
          (r) => r.credential_id.toString("base64url") === credId
        );
        if (row) return { rows: [row] };
      }
      return { rows: [] };
    }
    if (text.startsWith("UPDATE webauthn_credentials SET sign_count")) {
      const [counter, userId, credBytes] = values;
      const list = (rows.get(userId as string) ?? []) as WebauthnCredentialRow[];
      const credId = (credBytes as Buffer).toString("base64url");
      const r = list.find(
        (x) => x.credential_id.toString("base64url") === credId
      );
      if (r) r.sign_count = counter as number;
      return { rows: [] };
    }
    if (text.startsWith("UPDATE webauthn_credentials SET last_used_at")) {
      const [userId, credBytes] = values;
      const list = (rows.get(userId as string) ?? []) as WebauthnCredentialRow[];
      const credId = (credBytes as Buffer).toString("base64url");
      const r = list.find(
        (x) => x.credential_id.toString("base64url") === credId
      );
      if (r) r.last_used_at = new Date();
      return { rows: [] };
    }
    if (text.startsWith("DELETE FROM webauthn_credentials")) {
      const [userId, credBytes] = values;
      const list = (rows.get(userId as string) ?? []) as WebauthnCredentialRow[];
      const credId = (credBytes as Buffer).toString("base64url");
      const next = list.filter(
        (x) => x.credential_id.toString("base64url") !== credId
      );
      rows.set(userId as string, next);
      return { rows: [] };
    }
    return { rows: [] };
  };

  const pool = {
    query: vi.fn((text: string, values?: unknown[]) =>
      Promise.resolve(runQuery(text, values ?? []))
    ),
  };

  return {
    pool: pool as unknown as PostgresPasskeyStoreOptions["pool"],
    rows,
    queries,
  };
}

function makeRow(
  userId: string,
  credentialId: string,
  overrides: Partial<{
    public_key: Buffer;
    sign_count: number;
    device_type: string;
    friendly_name: string;
    is_synced: boolean;
    last_used_at: Date | null;
  }> = {}
): {
  user_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  sign_count: number;
  device_type: string | null;
  friendly_name: string | null;
  is_synced: boolean;
  last_used_at: Date | null;
} {
  return {
    user_id: userId,
    credential_id: Buffer.from(credentialId, "base64url"),
    public_key: overrides.public_key ?? Buffer.alloc(32, 1),
    sign_count: overrides.sign_count ?? 0,
    device_type: overrides.device_type ?? "singleDevice",
    friendly_name: overrides.friendly_name ?? null,
    is_synced: overrides.is_synced ?? false,
    last_used_at: overrides.last_used_at ?? null,
  };
}

const rpConfig: PasskeyRpConfig = {
  rpName: "Test RP",
  rpID: "localhost",
  origin: "http://localhost",
};

const allowMfaBackupProvider = { hasMfaOrBackupCodes: async () => true };

describe("createPostgresPasskeyStore", () => {
  it("listByUserId returns empty when no credentials", async () => {
    const { pool, rows } = createMockPool();
    const store = createPostgresPasskeyStore({ pool });
    const list = await store.listByUserId("user-1");
    expect(list).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it("listByUserId returns credentials for user from DB rows", async () => {
    const { pool, rows } = createMockPool();
    const userId = "user-1";
    const credId = "dGVzdC1jcmVkLWJhc2U2NHVybA";
    rows.set(userId, [makeRow(userId, credId)]);
    const store = createPostgresPasskeyStore({ pool });
    const list = await store.listByUserId(userId);
    expect(list).toHaveLength(1);
    expect(list[0]!.userId).toBe(userId);
    expect(list[0]!.credentialId).toBe(credId);
    expect(list[0]!.counter).toBe(0);
    expect(list[0]!.deviceType).toBe("singleDevice");
    expect(list[0]!.backedUp).toBe(false);
  });

  it("listByUserId returns multiDevice and backedUp when row has device_type multiDevice and is_synced true", async () => {
    const { pool, rows } = createMockPool();
    const userId = "user-synced";
    const credId = "c3luY2VkLWNyZWQ";
    rows.set(userId, [
      makeRow(userId, credId, { device_type: "multiDevice", is_synced: true }),
    ]);
    const store = createPostgresPasskeyStore({ pool });
    const list = await store.listByUserId(userId);
    expect(list).toHaveLength(1);
    expect(list[0]!.deviceType).toBe("multiDevice");
    expect(list[0]!.backedUp).toBe(true);
  });

  it("save with multiDevice and backedUp persists and round-trips via listByUserId", async () => {
    const { pool } = createMockPool();
    const store = createPostgresPasskeyStore({ pool });
    const cred: StoredPasskey = {
      userId: "user-multi",
      credentialId: "bXVsdGktZGV2aWNl",
      publicKey: new Uint8Array(32).fill(3),
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      webauthnUserID: "user-multi",
    };
    await store.save(cred);
    const list = await store.listByUserId("user-multi");
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("bXVsdGktZGV2aWNl");
    expect(list[0]!.deviceType).toBe("multiDevice");
    expect(list[0]!.backedUp).toBe(true);
  });

  it("findByCredentialId returns credential when present", async () => {
    const { pool, rows } = createMockPool();
    const userId = "user-1";
    const credId = "Y3JlZC1pZA";
    rows.set(userId, [makeRow(userId, credId)]);
    const store = createPostgresPasskeyStore({ pool });
    const found = await store.findByCredentialId(userId, credId);
    expect(found).not.toBeNull();
    expect(found!.credentialId).toBe(credId);
    expect(found!.userId).toBe(userId);
  });

  it("findByCredentialId returns null when absent", async () => {
    const { pool } = createMockPool();
    const store = createPostgresPasskeyStore({ pool });
    const found = await store.findByCredentialId(
      "user-1",
      "bm9uZXhpc3RlbnQ"
    );
    expect(found).toBeNull();
  });

  it("findByCredentialIdGlobal returns credential across users", async () => {
    const { pool, rows } = createMockPool();
    const credId = "Z2xvYmFsLWNyZWQ";
    rows.set("user-a", [makeRow("user-a", credId)]);
    const store = createPostgresPasskeyStore({ pool });
    const findByGlobal = store.findByCredentialIdGlobal;
    expect(findByGlobal).toBeDefined();
    const found = await findByGlobal!(credId);
    expect(found).not.toBeNull();
    expect(found!.credentialId).toBe(credId);
    expect(found!.userId).toBe("user-a");
  });

  it("save inserts credential with base64url credential_id decoded to BYTEA", async () => {
    const { pool, queries } = createMockPool();
    const store = createPostgresPasskeyStore({ pool });
    const cred: StoredPasskey = {
      userId: "user-1",
      credentialId: "c2F2ZWQtY3JlZA",
      publicKey: new Uint8Array(32).fill(2),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      webauthnUserID: "user-1",
      friendlyName: "My Key",
    };
    await store.save(cred);
    const insert = queries.find((q) =>
      q.text.includes("INSERT INTO webauthn_credentials")
    );
    expect(insert).toBeDefined();
    expect(insert!.values[0]).toBe("user-1");
    expect(Buffer.isBuffer(insert!.values[1])).toBe(true);
    expect((insert!.values[1] as Buffer).toString("base64url")).toBe(
      "c2F2ZWQtY3JlZA"
    );
    expect(insert!.values[5]).toBe("My Key");
  });

  it("updateCounter and updateLastUsed and delete run correct SQL", async () => {
    const { pool, rows } = createMockPool();
    const userId = "user-1";
    const credId = "Y3JlZC0x";
    rows.set(userId, [makeRow(userId, credId)]);
    const store = createPostgresPasskeyStore({ pool });
    await store.updateCounter(userId, credId, 5);
    await store.updateLastUsed(userId, credId);
    await store.delete(userId, credId);
    const list = await store.listByUserId(userId);
    expect(list).toHaveLength(0);
  });
});

describe("WebAuthn server with Postgres store", () => {
  it("full registration and list flow using Postgres store", async () => {
    const { pool } = createMockPool();
    const credentialStore = createPostgresPasskeyStore({ pool });
    const challengeStore = createMemoryPasskeyChallengeStore();
    const userId = "550e8400-e29b-41d4-a716-446655440000";

    const regOptions = await startRegistration({
      userId,
      userName: "alice",
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(regOptions.challenge).toBeDefined();

    const response = {
      id: "dGVzdC1jcmVkLWJhc2U2NHVybA",
      rawId: "dGVzdC1jcmVkLWJhc2U2NHVybA",
      type: "public-key" as const,
      response: {
        clientDataJSON: Buffer.from(
          JSON.stringify({
            type: "webauthn.create",
            challenge: regOptions.challenge,
            origin: rpConfig.origin,
          })
        ).toString("base64url"),
        attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAK3OAAI1vMYKZIsLJfHwVQMAIER5YWx1eSBMYXB0b3ClB1YmxpYyBLZXnALg",
      },
      clientExtensionResults: {},
    };

    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValueOnce(
      {
        verified: true,
        registrationInfo: {
          credential: {
            id: "dGVzdC1jcmVkLWJhc2U2NHVybA",
            publicKey: new Uint8Array(32).fill(1),
            counter: 0,
            transports: [],
          },
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
        },
      } as unknown as VerifiedRegistrationResponse
    );

    const result = await finishRegistration({
      userId,
      response,
      credentialStore,
      challengeStore,
      rpConfig,
      mfaBackupProvider: allowMfaBackupProvider,
    });
    expect(result.verified).toBe(true);
    expect(result.credentialId).toBe("dGVzdC1jcmVkLWJhc2U2NHVybA");

    const list = await listPasskeys({ userId, credentialStore });
    expect(list).toHaveLength(1);
    expect(list[0]!.credentialId).toBe("dGVzdC1jcmVkLWJhc2U2NHVybA");
  });

  it("startAuthentication returns options and finishAuthentication verifies with Postgres store", async () => {
    const { pool, rows } = createMockPool();
    const credentialStore = createPostgresPasskeyStore({ pool });
    const challengeStore = createMemoryPasskeyChallengeStore();
    const userId = "550e8400-e29b-41d4-a716-446655440001";
    const credId = "YXV0aC1jcmVkLWlk";
    rows.set(userId, [
      makeRow(userId, credId, { sign_count: 0, public_key: Buffer.alloc(32, 1) }),
    ]);

    const authOptions = await startAuthentication({
      userId,
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(authOptions.challenge).toBeDefined();
    expect(authOptions.allowCredentials?.some((c) => c.id === credId)).toBe(
      true
    );

    const response = {
      id: credId,
      rawId: credId,
      type: "public-key" as const,
      response: {
        clientDataJSON: Buffer.from(
          JSON.stringify({
            type: "webauthn.get",
            challenge: authOptions.challenge,
            origin: rpConfig.origin,
          })
        ).toString("base64url"),
        authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAA",
        signature: "MEUCIQDxZWNjIENvZGU",
      },
      clientExtensionResults: {},
    };

    const authResult = await finishAuthentication({
      userId,
      response,
      credentialStore,
      challengeStore,
      rpConfig,
    });
    expect(authResult.verified).toBe(true);
    expect(authResult.credentialId).toBe(credId);
  });

  it("revokePasskey removes credential via Postgres store", async () => {
    const { pool, rows } = createMockPool();
    const credentialStore = createPostgresPasskeyStore({ pool });
    const userId = "user-revoke";
    const credId = "cmV2b2tlLW1l";
    rows.set(userId, [makeRow(userId, credId)]);

    const result = await revokePasskey({
      userId,
      credentialId: credId,
      credentialStore,
    });
    expect(result.revoked).toBe(true);

    const list = await credentialStore.listByUserId(userId);
    expect(list).toHaveLength(0);
  });
});
