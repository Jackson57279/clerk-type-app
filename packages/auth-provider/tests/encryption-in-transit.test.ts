import { describe, it, expect } from "vitest";
import { createSecureContext } from "node:tls";
import {
  TLS_MIN_VERSION,
  getServerTlsOptions,
  getClientTlsOptions,
} from "../src/encryption-in-transit.js";

describe("encryption-in-transit", () => {
  describe("TLS_MIN_VERSION", () => {
    it("is TLSv1.3", () => {
      expect(TLS_MIN_VERSION).toBe("TLSv1.3");
    });
  });

  describe("getServerTlsOptions", () => {
    it("returns minVersion TLSv1.3", () => {
      const opts = getServerTlsOptions();
      expect(opts.minVersion).toBe("TLSv1.3");
    });

    it("returns a new object each time", () => {
      const a = getServerTlsOptions();
      const b = getServerTlsOptions();
      expect(a).not.toBe(b);
      a.minVersion = "TLSv1.2";
      expect(b.minVersion).toBe("TLSv1.3");
    });

    it("has shape accepted by createSecureContext", () => {
      const opts = getServerTlsOptions();
      expect(opts).toHaveProperty("minVersion", "TLSv1.3");
    });

    it("can be used with createSecureContext", () => {
      const opts = getServerTlsOptions();
      expect(() => createSecureContext(opts)).not.toThrow();
    });
  });

  describe("getClientTlsOptions", () => {
    it("returns minVersion TLSv1.3", () => {
      const opts = getClientTlsOptions();
      expect(opts.minVersion).toBe("TLSv1.3");
    });

    it("returns a new object each time", () => {
      const a = getClientTlsOptions();
      const b = getClientTlsOptions();
      expect(a).not.toBe(b);
      a.minVersion = "TLSv1.2";
      expect(b.minVersion).toBe("TLSv1.3");
    });

    it("can be used with createSecureContext", () => {
      const opts = getClientTlsOptions();
      expect(() => createSecureContext(opts)).not.toThrow();
    });
  });
});
