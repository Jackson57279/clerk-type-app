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

export function encryptSSN(ssn: string, key: Buffer): string {
  return encryptSensitiveField(ssn, key);
}

export function decryptSSN(ciphertextBase64: string, key: Buffer): string {
  return decryptSensitiveField(ciphertextBase64, key);
}

export function encryptTaxId(taxId: string, key: Buffer): string {
  return encryptSensitiveField(taxId, key);
}

export function decryptTaxId(ciphertextBase64: string, key: Buffer): string {
  return decryptSensitiveField(ciphertextBase64, key);
}

export interface SensitiveFieldsRecord {
  ssn?: string;
  taxId?: string;
}

export function encryptSensitiveFields(
  record: SensitiveFieldsRecord,
  key: Buffer
): SensitiveFieldsRecord {
  const out: SensitiveFieldsRecord = {};
  if (record.ssn !== undefined && record.ssn !== "") {
    out.ssn = encryptSSN(record.ssn, key);
  }
  if (record.taxId !== undefined && record.taxId !== "") {
    out.taxId = encryptTaxId(record.taxId, key);
  }
  return out;
}

export function decryptSensitiveFields(
  record: SensitiveFieldsRecord,
  key: Buffer
): SensitiveFieldsRecord {
  const out: SensitiveFieldsRecord = {};
  if (record.ssn !== undefined && record.ssn !== "") {
    out.ssn = decryptSSN(record.ssn, key);
  }
  if (record.taxId !== undefined && record.taxId !== "") {
    out.taxId = decryptTaxId(record.taxId, key);
  }
  return out;
}
