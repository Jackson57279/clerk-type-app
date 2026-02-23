import {
  parseEncryptionKey,
  encryptAes256Utf8,
  decryptAes256Utf8,
} from "./encryption-at-rest.js";

const ENV_KEY_NAME = "FIELD_ENCRYPTION_KEY";

export function getFieldEncryptionKey(
  env: NodeJS.ProcessEnv = process.env
): Buffer {
  const raw = env[ENV_KEY_NAME];
  if (!raw || typeof raw !== "string") {
    throw new Error(
      `${ENV_KEY_NAME} is required for field-level encryption (SSN, tax IDs)`
    );
  }
  try {
    return parseEncryptionKey(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${ENV_KEY_NAME}: ${msg}`);
  }
}

export function encryptSensitiveField(
  plaintext: string,
  key: Buffer
): string {
  return encryptAes256Utf8(plaintext, key);
}

export function decryptSensitiveField(
  ciphertextBase64: string,
  key: Buffer
): string {
  return decryptAes256Utf8(ciphertextBase64, key);
}
