import { createHash, timingSafeEqual } from "crypto";

const HASH_ENCODING = "hex" as const;

export function hashDeviceFingerprint(fingerprint: string): string {
  const normalized = fingerprint.trim();
  return createHash("sha256").update(normalized, "utf8").digest(HASH_ENCODING);
}

export interface ValidateDeviceBindingOptions {
  storedFingerprintHash: string | null;
  currentFingerprint: string | null;
}

export function validateDeviceBinding(options: ValidateDeviceBindingOptions): boolean {
  const { storedFingerprintHash, currentFingerprint } = options;
  if (storedFingerprintHash === null || storedFingerprintHash === "") {
    return true;
  }
  if (currentFingerprint === null || currentFingerprint === undefined) {
    return false;
  }
  const currentHash = hashDeviceFingerprint(currentFingerprint);
  if (currentHash.length !== storedFingerprintHash.length) {
    return false;
  }
  const a = Buffer.from(currentHash, HASH_ENCODING);
  const b = Buffer.from(storedFingerprintHash, HASH_ENCODING);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
