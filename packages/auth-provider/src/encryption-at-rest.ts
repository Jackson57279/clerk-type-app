import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type BinaryLike,
} from "crypto";

const ALG = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length === 64 && /^[a-f0-9]+$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const fromB64 = Buffer.from(trimmed, "base64");
  if (fromB64.length === KEY_BYTES) return fromB64;
  throw new Error(
    "ENCRYPTION_KEY must be 32 bytes: use base64 (44 chars) or hex (64 chars)"
  );
}

export function encryptAes256(
  plaintext: BinaryLike,
  key: Buffer
): string {
  if (key.length !== KEY_BYTES) {
    throw new Error("key must be 32 bytes");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: AUTH_TAG_BYTES });
  const data = Buffer.isBuffer(plaintext)
    ? plaintext
    : Buffer.from(plaintext as string, "utf8");
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptAes256(ciphertextBase64: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error("key must be 32 bytes");
  }
  const raw = Buffer.from(ciphertextBase64, "base64");
  if (
    raw.length < IV_BYTES + AUTH_TAG_BYTES + 1
  ) {
    throw new Error("invalid ciphertext");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const encrypted = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALG, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encryptAes256Utf8(plaintext: string, key: Buffer): string {
  return encryptAes256(plaintext, key);
}

export function decryptAes256Utf8(ciphertextBase64: string, key: Buffer): string {
  return decryptAes256(ciphertextBase64, key).toString("utf8");
}
