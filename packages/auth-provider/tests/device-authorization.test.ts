import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDeviceAuthorization,
  approveDeviceByUserCode,
  denyDeviceByUserCode,
  exchangeDeviceCode,
  verifyDeviceAccessToken,
  createMemoryDeviceCodeStore,
  handleDeviceCodeFlow,
  DEVICE_CODE_GRANT_TYPE,
} from "../src/device-authorization.js";

const SECRET = "device-oauth-secret";
const VERIFICATION_URI = "https://auth.example.com/device";

describe("createDeviceAuthorization", () => {
  it("returns device_code, user_code, verification_uri, expires_in, interval", () => {
    const store = createMemoryDeviceCodeStore();
    const result = createDeviceAuthorization({
      clientId: "iot-client",
      verificationUri: VERIFICATION_URI,
      store,
    });
    expect(result.device_code).toBeDefined();
    expect(result.device_code.length).toBeGreaterThan(20);
    expect(result.user_code).toMatch(/^[A-Z0-9]+-[A-Z0-9]+$/);
    expect(result.verification_uri).toBe(VERIFICATION_URI);
    expect(result.verification_uri_complete).toContain("user_code=");
    expect(result.verification_uri_complete).toContain(result.user_code);
    expect(result.expires_in).toBe(900);
    expect(result.interval).toBe(5);
  });

  it("stores entry in store", () => {
    const store = createMemoryDeviceCodeStore();
    const result = createDeviceAuthorization({
      clientId: "c1",
      scope: "openid",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const entry = store.findByDeviceCode(result.device_code);
    expect(entry).not.toBeNull();
    expect(entry?.clientId).toBe("c1");
    expect(entry?.scope).toBe("openid");
    expect(entry?.status).toBe("pending");
    expect(entry?.userCode).toBe(result.user_code);
  });

  it("accepts custom expiresInSec and intervalSec", () => {
    const store = createMemoryDeviceCodeStore();
    const result = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
      expiresInSec: 600,
      intervalSec: 10,
    });
    expect(result.expires_in).toBe(600);
    expect(result.interval).toBe(10);
  });
});

describe("approveDeviceByUserCode", () => {
  it("approves pending device and exchange returns tokens", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "iot-client",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const ok = approveDeviceByUserCode(created.user_code, "user-123", store);
    expect(ok).toBe(true);

    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "iot-client",
      store,
      secret: SECRET,
    });
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.access_token).toBeDefined();
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBe(3600);
      const payload = verifyDeviceAccessToken(result.access_token, SECRET);
      expect(payload?.sub).toBe("user-123");
      expect(payload?.client_id).toBe("iot-client");
    }
  });

  it("returns false for unknown user code", () => {
    const store = createMemoryDeviceCodeStore();
    expect(approveDeviceByUserCode("XXXX-XXXX", "user-1", store)).toBe(false);
  });

  it("returns false when already approved", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-1", store);
    expect(approveDeviceByUserCode(created.user_code, "user-2", store)).toBe(false);
  });
});

describe("denyDeviceByUserCode", () => {
  it("denies pending device and exchange returns access_denied", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "iot-client",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const ok = denyDeviceByUserCode(created.user_code, store);
    expect(ok).toBe(true);

    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "iot-client",
      store,
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("access_denied");
    }
  });

  it("returns false for unknown user code", () => {
    const store = createMemoryDeviceCodeStore();
    expect(denyDeviceByUserCode("YYYY-YYYY", store)).toBe(false);
  });
});

describe("exchangeDeviceCode", () => {
  it("returns authorization_pending when not yet approved", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("authorization_pending");
      expect(result.interval).toBe(5);
    }
  });

  it("returns slow_down when polling within interval", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
      intervalSec: 5,
    });
    exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("slow_down");
      expect(result.interval).toBe(10);
    }
  });

  it("returns invalid_grant for unknown device_code", () => {
    const store = createMemoryDeviceCodeStore();
    const result = exchangeDeviceCode({
      deviceCode: "unknown-device-code",
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_grant");
  });

  it("returns invalid_grant when client_id does not match", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "client-a",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "client-b",
      store,
      secret: SECRET,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_grant");
  });

  it("returns expired_token when device code has expired", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
      expiresInSec: 1,
    });
    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);
    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    vi.useRealTimers();
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("expired_token");
  });

  it("includes scope in token response when present", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      scope: "openid profile",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-1", store);
    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.scope).toBe("openid profile");
      const payload = verifyDeviceAccessToken(result.access_token, SECRET);
      expect(payload?.scope).toBe("openid profile");
    }
  });

  it("accepts custom ttlMs, iss, aud", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-1", store);
    const result = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
      ttlMs: 30 * 60 * 1000,
      iss: "https://auth.example.com",
      aud: "https://api.example.com",
    });
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.expires_in).toBe(1800);
      const payload = verifyDeviceAccessToken(result.access_token, SECRET);
      expect(payload?.iss).toBe("https://auth.example.com");
      expect(payload?.aud).toBe("https://api.example.com");
    }
  });

  it("device code is single-use: second exchange after success returns invalid_grant", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-1", store);
    const first = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("access_token" in first).toBe(true);
    const second = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("error" in second).toBe(true);
    if ("error" in second) expect(second.error).toBe("invalid_grant");
  });
});

describe("verifyDeviceAccessToken", () => {
  it("returns payload for valid token", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      scope: "openid",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-42", store);
    const tokenResult = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("access_token" in tokenResult).toBe(true);
    if (!("access_token" in tokenResult)) return;
    const payload = verifyDeviceAccessToken(tokenResult.access_token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-42");
    expect(payload?.client_id).toBe("c");
    expect(payload?.scope).toBe("openid");
    expect(payload?.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("returns null for wrong secret", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-1", store);
    const tokenResult = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
    });
    expect("access_token" in tokenResult).toBe(true);
    if (!("access_token" in tokenResult)) return;
    expect(verifyDeviceAccessToken(tokenResult.access_token, "wrong-secret")).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(verifyDeviceAccessToken("a.b", SECRET)).toBeNull();
    expect(verifyDeviceAccessToken("a.b.c.d", SECRET)).toBeNull();
  });
});

describe("device token expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when token is expired", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-1", store);
    const tokenResult = exchangeDeviceCode({
      deviceCode: created.device_code,
      clientId: "c",
      store,
      secret: SECRET,
      ttlMs: 1000,
    });
    expect("access_token" in tokenResult).toBe(true);
    if (!("access_token" in tokenResult)) return;
    expect(verifyDeviceAccessToken(tokenResult.access_token, SECRET)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(verifyDeviceAccessToken(tokenResult.access_token, SECRET)).toBeNull();
  });
});

describe("createMemoryDeviceCodeStore", () => {
  it("findByUserCode is case-insensitive", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const lower = created.user_code.toLowerCase();
    const entry = store.findByUserCode(lower);
    expect(entry).not.toBeNull();
    expect(entry?.userCode).toBe(created.user_code);
  });
});

describe("handleDeviceCodeFlow", () => {
  it("returns access_token for valid grant_type, device_code, and client_id when authorized", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "iot-client",
      verificationUri: VERIFICATION_URI,
      store,
    });
    approveDeviceByUserCode(created.user_code, "user-123", store);
    const result = handleDeviceCodeFlow(
      {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: created.device_code,
        client_id: "iot-client",
      },
      { store, secret: SECRET }
    );
    expect("access_token" in result).toBe(true);
    if ("access_token" in result) {
      expect(result.access_token).toBeDefined();
      expect(result.token_type).toBe("Bearer");
      expect(result.expires_in).toBe(3600);
    }
  });

  it("returns unsupported_grant_type when grant_type is not device_code", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const result = handleDeviceCodeFlow(
      {
        grant_type: "authorization_code",
        device_code: created.device_code,
        client_id: "c",
      },
      { store, secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("unsupported_grant_type");
      expect(result.error_description).toContain(DEVICE_CODE_GRANT_TYPE);
    }
  });

  it("returns invalid_request when device_code is missing", () => {
    const store = createMemoryDeviceCodeStore();
    const result = handleDeviceCodeFlow(
      {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        client_id: "c",
      },
      { store, secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
      expect(result.error_description).toContain("device_code");
    }
  });

  it("returns invalid_request when device_code is blank", () => {
    const store = createMemoryDeviceCodeStore();
    const result = handleDeviceCodeFlow(
      {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: "   ",
        client_id: "c",
      },
      { store, secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
    }
  });

  it("returns invalid_request when client_id is missing", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const result = handleDeviceCodeFlow(
      {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: created.device_code,
      },
      { store, secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("invalid_request");
      expect(result.error_description).toContain("client_id");
    }
  });

  it("returns authorization_pending when device not yet authorized", () => {
    const store = createMemoryDeviceCodeStore();
    const created = createDeviceAuthorization({
      clientId: "c",
      verificationUri: VERIFICATION_URI,
      store,
    });
    const result = handleDeviceCodeFlow(
      {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: created.device_code,
        client_id: "c",
      },
      { store, secret: SECRET }
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("authorization_pending");
    }
  });
});
