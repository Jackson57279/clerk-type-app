import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEnvSecretProvider,
  createAwsKmsSecretProvider,
  createVaultSecretProvider,
  createSecretProviderFromEnv,
  getFieldEncryptionKeyFromProvider,
} from "../src/secure-key-storage.js";

const HEX_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const mockKmsSend = vi.fn();
vi.mock("@aws-sdk/client-kms", () => ({
  KMSClient: vi.fn().mockImplementation(() => ({ send: mockKmsSend })),
  DecryptCommand: vi.fn(),
}));

describe("createEnvSecretProvider", () => {
  it("returns secret from env by name", async () => {
    const provider = createEnvSecretProvider({
      FIELD_ENCRYPTION_KEY: HEX_KEY,
    });
    const value = await provider.getSecret("FIELD_ENCRYPTION_KEY");
    expect(value).toBe(HEX_KEY);
  });

  it("trims whitespace", async () => {
    const provider = createEnvSecretProvider({
      FOO: "  bar  ",
    });
    expect(await provider.getSecret("FOO")).toBe("bar");
  });

  it("throws when secret is missing", async () => {
    const provider = createEnvSecretProvider({});
    await expect(provider.getSecret("MISSING")).rejects.toThrow(
      'Secret "MISSING" is not set'
    );
  });

  it("throws when secret is empty string", async () => {
    const provider = createEnvSecretProvider({ FOO: "" });
    await expect(provider.getSecret("FOO")).rejects.toThrow("not set");
  });
});

describe("createAwsKmsSecretProvider", () => {
  beforeEach(() => {
    mockKmsSend.mockReset();
  });

  it("decrypts ciphertext via KMS and returns plaintext", async () => {
    mockKmsSend.mockResolvedValueOnce({
      Plaintext: new Uint8Array(Buffer.from(HEX_KEY, "utf8")),
    });

    const provider = createAwsKmsSecretProvider({
      region: "us-east-1",
      env: { FIELD_ENCRYPTION_KEY_KMS_CIPHERTEXT: "YmFzZTY0Y2lwaGVydGV4dA==" },
      getCiphertextEnvVar: (name) => `${name}_KMS_CIPHERTEXT`,
    });
    const value = await provider.getSecret("FIELD_ENCRYPTION_KEY");
    expect(value).toBe(HEX_KEY);
    expect(mockKmsSend).toHaveBeenCalledTimes(1);
  });

  it("throws when ciphertext env var is missing", async () => {
    const provider = createAwsKmsSecretProvider({
      region: "us-east-1",
      env: {},
      getCiphertextEnvVar: (name) => `${name}_KMS_CIPHERTEXT`,
    });
    await expect(provider.getSecret("FIELD_ENCRYPTION_KEY")).rejects.toThrow(
      "KMS ciphertext"
    );
  });
});

describe("createVaultSecretProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads secret from Vault KV and returns value key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          data: {
            value: HEX_KEY,
          },
        },
      }),
    } as Response);

    const provider = createVaultSecretProvider({
      vaultAddr: "https://vault.example.com",
      token: "s.token",
      getPath: (name) => `secret/data/auth-provider/${name.toLowerCase()}`,
    });
    const value = await provider.getSecret("FIELD_ENCRYPTION_KEY");
    expect(value).toBe(HEX_KEY);
    expect(fetch).toHaveBeenCalledWith(
      "https://vault.example.com/v1/secret/data/auth-provider/field_encryption_key",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-Vault-Token": "s.token" }),
      })
    );
  });

  it("uses custom secret key field", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { data: { key: HEX_KEY } },
      }),
    } as Response);

    const provider = createVaultSecretProvider({
      vaultAddr: "https://vault.example.com",
      token: "x",
      secretKey: "key",
      getPath: () => "secret/data/keys",
    });
    expect(await provider.getSecret("X")).toBe(HEX_KEY);
  });

  it("throws when Vault returns non-ok", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "permission denied",
    } as Response);

    const provider = createVaultSecretProvider({
      vaultAddr: "https://vault.example.com",
      token: "x",
      getPath: () => "secret/data/keys",
    });
    await expect(provider.getSecret("X")).rejects.toThrow("Vault read failed");
  });

  it("throws when secret has no data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const provider = createVaultSecretProvider({
      vaultAddr: "https://vault.example.com",
      token: "x",
      getPath: () => "secret/data/keys",
    });
    await expect(provider.getSecret("X")).rejects.toThrow("no data");
  });
});

describe("createSecretProviderFromEnv", () => {
  it("returns env provider when SECRET_PROVIDER=env or unset", async () => {
    const p1 = createSecretProviderFromEnv({ FIELD_ENCRYPTION_KEY: HEX_KEY });
    expect(await p1.getSecret("FIELD_ENCRYPTION_KEY")).toBe(HEX_KEY);

    const p2 = createSecretProviderFromEnv({
      SECRET_PROVIDER: "env",
      FIELD_ENCRYPTION_KEY: HEX_KEY,
    });
    expect(await p2.getSecret("FIELD_ENCRYPTION_KEY")).toBe(HEX_KEY);
  });

  it("throws when SECRET_PROVIDER=aws-kms and AWS_REGION is missing", () => {
    expect(() =>
      createSecretProviderFromEnv({ SECRET_PROVIDER: "aws-kms" })
    ).toThrow("AWS_REGION");
  });

  it("throws when SECRET_PROVIDER=vault and VAULT_ADDR is missing", () => {
    expect(() =>
      createSecretProviderFromEnv({
        SECRET_PROVIDER: "vault",
        VAULT_TOKEN: "x",
      })
    ).toThrow("VAULT_ADDR");
  });

  it("throws when SECRET_PROVIDER=vault and VAULT_TOKEN is missing", () => {
    expect(() =>
      createSecretProviderFromEnv({
        SECRET_PROVIDER: "vault",
        VAULT_ADDR: "http://vault",
      })
    ).toThrow("VAULT_TOKEN");
  });

  it("throws for unknown SECRET_PROVIDER", () => {
    expect(() =>
      createSecretProviderFromEnv({ SECRET_PROVIDER: "unknown" })
    ).toThrow("Unknown SECRET_PROVIDER");
  });
});

describe("getFieldEncryptionKeyFromProvider", () => {
  it("returns 32-byte buffer from provider (hex key)", async () => {
    const provider = createEnvSecretProvider({
      FIELD_ENCRYPTION_KEY: HEX_KEY,
    });
    const key = await getFieldEncryptionKeyFromProvider(provider);
    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe(HEX_KEY);
  });

  it("accepts base64 key from provider", async () => {
    const b64 = Buffer.from(HEX_KEY, "hex").toString("base64");
    const provider = createEnvSecretProvider({
      FIELD_ENCRYPTION_KEY: b64,
    });
    const key = await getFieldEncryptionKeyFromProvider(provider);
    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe(HEX_KEY);
  });

  it("throws when provider returns invalid key format", async () => {
    const provider = createEnvSecretProvider({
      FIELD_ENCRYPTION_KEY: "tooshort",
    });
    await expect(getFieldEncryptionKeyFromProvider(provider)).rejects.toThrow(
      "32 bytes"
    );
  });
});
