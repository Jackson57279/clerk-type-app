import { describe, it, expect } from "vitest";
import {
  parseEncryptionKey,
  encryptAes256,
  decryptAes256,
  encryptAes256Utf8,
  decryptAes256Utf8,
} from "../src/encryption-at-rest.js";

const HEX_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY = Buffer.from(HEX_KEY, "hex");

describe("parseEncryptionKey", () => {
  it("accepts 64-char hex string", () => {
    const key = parseEncryptionKey(HEX_KEY);
    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe(HEX_KEY);
  });

  it("accepts 32-byte base64 string", () => {
    const b64 = KEY.toString("base64");
    const key = parseEncryptionKey(b64);
    expect(key.length).toBe(32);
    expect(key.equals(KEY)).toBe(true);
  });

  it("rejects invalid key length", () => {
    expect(() => parseEncryptionKey("short")).toThrow("32 bytes");
  });

  it("rejects wrong-length base64", () => {
    expect(() => parseEncryptionKey("YWJj")).toThrow("32 bytes");
  });
});

describe("encryptAes256 / decryptAes256", () => {
  it("roundtrips buffer", () => {
    const plain = Buffer.from("secret data");
    const enc = encryptAes256(plain, KEY);
    expect(enc).toBeTruthy();
    expect(Buffer.from(enc, "base64").length).toBeGreaterThan(plain.length);
    const dec = decryptAes256(enc, KEY);
    expect(dec.equals(plain)).toBe(true);
  });

  it("roundtrips string (utf8)", () => {
    const plain = "access_token_xyz";
    const enc = encryptAes256(plain, KEY);
    const dec = decryptAes256(enc, KEY);
    expect(dec.toString("utf8")).toBe(plain);
  });

  it("produces different ciphertext each time (IV)", () => {
    const plain = "same";
    const a = encryptAes256(plain, KEY);
    const b = encryptAes256(plain, KEY);
    expect(a).not.toBe(b);
    expect(decryptAes256(a, KEY).toString("utf8")).toBe(plain);
    expect(decryptAes256(b, KEY).toString("utf8")).toBe(plain);
  });

  it("decrypt with wrong key throws", () => {
    const enc = encryptAes256("secret", KEY);
    const other = Buffer.alloc(32, 1);
    expect(() => decryptAes256(enc, other)).toThrow();
  });

  it("decrypt tampered ciphertext throws", () => {
    const enc = encryptAes256("secret", KEY);
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptAes256(raw.toString("base64"), KEY)).toThrow();
  });

  it("decrypt invalid base64 throws", () => {
    expect(() => decryptAes256("not-valid-base64!!", KEY)).toThrow();
  });

  it("decrypt too-short blob throws", () => {
    expect(() => decryptAes256(Buffer.alloc(20).toString("base64"), KEY)).toThrow(
      "invalid ciphertext"
    );
  });

  it("rejects key not 32 bytes for encrypt", () => {
    expect(() => encryptAes256("x", Buffer.alloc(16))).toThrow("32 bytes");
  });

  it("rejects key not 32 bytes for decrypt", () => {
    const enc = encryptAes256("x", KEY);
    expect(() => decryptAes256(enc, Buffer.alloc(16))).toThrow("32 bytes");
  });
});

describe("encryptAes256Utf8 / decryptAes256Utf8", () => {
  it("roundtrips utf8 string", () => {
    const plain = "refresh_token_abc_123";
    const enc = encryptAes256Utf8(plain, KEY);
    expect(typeof enc).toBe("string");
    const dec = decryptAes256Utf8(enc, KEY);
    expect(dec).toBe(plain);
  });

  it("handles unicode", () => {
    const plain = "tëst_日本語";
    const enc = encryptAes256Utf8(plain, KEY);
    expect(decryptAes256Utf8(enc, KEY)).toBe(plain);
  });
});
