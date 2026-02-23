import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
import { parseEncryptionKey } from "./encryption-at-rest.js";

export interface SecretProvider {
  getSecret(name: string): Promise<string>;
}

export function createEnvSecretProvider(
  env: NodeJS.ProcessEnv = process.env
): SecretProvider {
  return {
    async getSecret(name: string): Promise<string> {
      const raw = env[name];
      if (raw == null || typeof raw !== "string" || raw.trim() === "") {
        throw new Error(`Secret "${name}" is not set in environment`);
      }
      return raw.trim();
    },
  };
}

export interface AwsKmsSecretProviderOptions {
  region: string;
  getCiphertextEnvVar(secretName: string): string;
  env?: NodeJS.ProcessEnv;
}

export function createAwsKmsSecretProvider(
  options: AwsKmsSecretProviderOptions
): SecretProvider {
  const env = options.env ?? process.env;
  const client = new KMSClient({ region: options.region });

  return {
    async getSecret(name: string): Promise<string> {
      const envVar = options.getCiphertextEnvVar(name);
      const b64 = env[envVar];
      if (b64 == null || typeof b64 !== "string" || b64.trim() === "") {
        throw new Error(
          `KMS ciphertext for "${name}" not set (env: ${envVar})`
        );
      }
      const ciphertext = Buffer.from(b64.trim(), "base64");
      const response = await client.send(
        new DecryptCommand({ CiphertextBlob: ciphertext })
      );
      const plaintext = response.Plaintext;
      if (!plaintext || plaintext.length === 0) {
        throw new Error(`KMS Decrypt returned no plaintext for "${name}"`);
      }
      return Buffer.from(plaintext).toString("utf8");
    },
  };
}

export interface VaultSecretProviderOptions {
  vaultAddr: string;
  token: string;
  getPath(secretName: string): string;
  secretKey?: string;
}

export function createVaultSecretProvider(
  options: VaultSecretProviderOptions
): SecretProvider {
  const secretKey = options.secretKey ?? "value";

  return {
    async getSecret(name: string): Promise<string> {
      const path = options.getPath(name);
      const url = `${options.vaultAddr.replace(/\/$/, "")}/v1/${path}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "X-Vault-Token": options.token,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Vault read failed for "${name}" (${path}): ${res.status} ${body}`
        );
      }
      const data = (await res.json()) as { data?: { data?: Record<string, string> } };
      const inner = data.data?.data;
      if (!inner || typeof inner !== "object") {
        throw new Error(`Vault secret "${name}" has no data`);
      }
      const value = inner[secretKey];
      if (value == null || typeof value !== "string") {
        throw new Error(
          `Vault secret "${name}" has no string key "${secretKey}"`
        );
      }
      return value;
    },
  };
}

const DEFAULT_SECRET_PROVIDER = "env";
const FIELD_ENCRYPTION_KEY_NAME = "FIELD_ENCRYPTION_KEY";

export function createSecretProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env
): SecretProvider {
  const provider = (env.SECRET_PROVIDER ?? DEFAULT_SECRET_PROVIDER).trim().toLowerCase();

  if (provider === "env") {
    return createEnvSecretProvider(env);
  }

  if (provider === "aws-kms") {
    const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    if (!region) {
      throw new Error("SECRET_PROVIDER=aws-kms requires AWS_REGION or AWS_DEFAULT_REGION");
    }
    return createAwsKmsSecretProvider({
      region,
      env,
      getCiphertextEnvVar: (name) => `${name}_KMS_CIPHERTEXT`,
    });
  }

  if (provider === "vault") {
    const vaultAddr = env.VAULT_ADDR;
    const token = env.VAULT_TOKEN;
    if (!vaultAddr || !token) {
      throw new Error("SECRET_PROVIDER=vault requires VAULT_ADDR and VAULT_TOKEN");
    }
    const pathPrefix = env.VAULT_SECRET_PATH_PREFIX ?? "secret/data/auth-provider";
    return createVaultSecretProvider({
      vaultAddr,
      token,
      secretKey: env.VAULT_SECRET_KEY_FIELD ?? "value",
      getPath: (name) => {
        const custom = env[`VAULT_PATH_${name}`];
        if (custom) return custom;
        const slug = name.toLowerCase().replace(/_/g, "-");
        return `${pathPrefix}/${slug}`;
      },
    });
  }

  throw new Error(
    `Unknown SECRET_PROVIDER="${env.SECRET_PROVIDER}". Use env, aws-kms, or vault.`
  );
}

export async function getFieldEncryptionKeyFromProvider(
  provider: SecretProvider
): Promise<Buffer> {
  const raw = await provider.getSecret(FIELD_ENCRYPTION_KEY_NAME);
  return parseEncryptionKey(raw);
}
