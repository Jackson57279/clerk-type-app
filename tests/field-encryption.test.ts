import { describe, it, expect } from "vitest";
import {
  getFieldEncryptionKey,
  encryptSensitiveField,
  decryptSensitiveField,
} from "../src/field-encryption.js";

const HEX_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY = Buffer.from(HEX_KEY, "hex");

describe("getFieldEncryptionKey", () => {
  it("returns key from FIELD_ENCRYPTION_KEY (hex)", () => {
    const key = getFieldEncryptionKey({ FIELD_ENCRYPTION_KEY: HEX_KEY });
    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe(HEX_KEY);
  });

  it("returns key from FIELD_ENCRYPTION_KEY (base64)", () => {
    const b64 = KEY.toString("base64");
    const key = getFieldEncryptionKey({ FIELD_ENCRYPTION_KEY: b64 });
    expect(key.equals(KEY)).toBe(true);
  });

  it("throws when FIELD_ENCRYPTION_KEY is missing", () => {
    expect(() => getFieldEncryptionKey({})).toThrow(
      "FIELD_ENCRYPTION_KEY is required"
    );
  });

  it("throws when key format is invalid", () => {
    expect(() =>
      getFieldEncryptionKey({ FIELD_ENCRYPTION_KEY: "short" })
    ).toThrow("FIELD_ENCRYPTION_KEY");
  });
});

describe("encryptSensitiveField / decryptSensitiveField", () => {
  it("roundtrips SSN", () => {
    const ssn = "123-45-6789";
    const enc = encryptSensitiveField(ssn, KEY);
    expect(enc).toBeTruthy();
    expect(enc).not.toContain(ssn);
    expect(decryptSensitiveField(enc, KEY)).toBe(ssn);
  });

  it("roundtrips tax ID (EIN)", () => {
    const ein = "12-3456789";
    const enc = encryptSensitiveField(ein, KEY);
    expect(decryptSensitiveField(enc, KEY)).toBe(ein);
  });

  it("produces different ciphertext each time (IV)", () => {
    const plain = "123-45-6789";
    const a = encryptSensitiveField(plain, KEY);
    const b = encryptSensitiveField(plain, KEY);
    expect(a).not.toBe(b);
    expect(decryptSensitiveField(a, KEY)).toBe(plain);
    expect(decryptSensitiveField(b, KEY)).toBe(plain);
  });

  it("decrypt with wrong key throws", () => {
    const enc = encryptSensitiveField("123-45-6789", KEY);
    const other = Buffer.alloc(32, 1);
    expect(() => decryptSensitiveField(enc, other)).toThrow();
  });

  it("decrypt tampered ciphertext throws", () => {
    const enc = encryptSensitiveField("123-45-6789", KEY);
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSensitiveField(raw.toString("base64"), KEY)).toThrow();
  });

  it("decrypt invalid base64 throws", () => {
    expect(() => decryptSensitiveField("not-valid-base64!!", KEY)).toThrow();
  });
});
