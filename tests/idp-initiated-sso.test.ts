import { describe, it, expect } from "vitest";
import { createIdpInitiatedResponse, type IdpInitiatedIdpConfig, type IdpInitiatedSpConfig } from "../src/idp-initiated-sso.js";
import {
  validateSpInitiatedPostResponse,
  validateIdpInitiatedPostResponse,
  type SpInitiatedSpConfig,
  type SpInitiatedIdpConfig,
} from "../src/sp-initiated-sso.js";

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBX9ZAnn+hUzzM
UEqE4QGRhTZosYfH0Qy7FKOfKRBcM7QUVD1kurOkJfJgO+WgBHaOPiVchPED4uRf
n1m506FpCMOxO2BperPhEnEjEGBygi6uJjxzzB7WbKRaMDaflWsfPEklKNUypaVT
VSBopvCUOUkYt6dGg+lAIrvVsUObPsR5w8IL0Irt0muAjpeTUI5Ata9i64SZyUEI
sNIbJ9ZxoINeYxGgwmWvLj8NRLR7/LJqGaY028EQVY17cy7JGCEcmC0I76kfv0AH
dF2XGr9C3U8EEeqG4PwsEoL+6hv1jerduVSCBkAyFJFTAYSw5gofEEaU78dWFrpk
lluA9pNpAgMBAAECggEAfi4XFBtYlOBHr9pEheh8qYQPOMl/HDeg4wJYsiaNclya
iRle5jeduOK6AWmUMJI4+iA7KN/mlO6crnjAh608idkaOK/R/YH/lkH+aS7qgE3K
QADbOYRcKvbBV8hWHFPXjo47/G9kjqPf+Tx25VLpcQ7gT6ynDjBNJ3iCsLH2t3lf
M3rgdeRqauRrCvHb8zJzLgOFd+d5UZWGzcQxfSlRTkReBul2QPEK+GE3tLVVWWCg
sC51teOHnPq6l0ymgFou6Z48e2QXXGc7I7ebYWIwjBQlHwhwT32q1uNB/xXyOHmh
jJ5z7N8ZJk0mrtDZ8N3ClhMUdVH8+nm5G79WVonTwQKBgQDjaMR8B98s3QPOFoWG
3JK5xBw4dV2z7cTPr/qakA12E5vslqKjab51NQ1kzU7GyRWhNthv4iHM8KyerLH2
GgZfYM4cve9uW5KOZKRPrBkvou3XBe/FFikRk19EvTL6BXqhnxyYYdOC6LfppGI9
8PbEGq0Z1BF0fbadw3Pmxvi5xQKBgQDZr6WTESfLHfXHJ6EmI3yvM3RBrUdojRY7
WpwGcn6MkqnuFuTqkqJ1UUbB7wsDFvuBEXLvd3mgmWJYLditVvhhCxbqbPO2rj/B
1FC34FdMQLl2981ucz6qwTolaUwjBlhtoMnL+03hoJTG7lf2ZxlfbJZzXawMa0m/
1RHHChyhVQKBgQDEPSJhDcHuywJ/kzvCtxD+sVbQ+abUn/fYaTnOq0SSgjVpokvS
zGuIZTGbrPev3tKFffikA/W7Dm1HuCsR/j9FixoR/21gRDFiI0MPZamOTAEGLp9L
6eWivxPVE5er3ZKHafCZJsIJE52xRyNn5Epty79YrIIrjlhKJ+IaYdU9KQKBgAaC
okkLskz40GjsXn1tgkUbHNb5/7C4x3lu9EudEPvTRxG/zYjWadVoYN1b8NBe15a8
lttij1imPbK1bE2C1FrSohTQvVkxTObXGrLlGrdFGEbekl5DRBSHQt3rkENb5Tki
Hebj1ShyTQDGEAtmefPIo5c/re2RJ9t829NAEishAoGAGOW5CPq7Q0tEvOVE+/br
JXddPyZe++FB1e7i+iVYrA5F8wtvhVHsVsSxpm47XdAyAFdLdnttrnwzt3EA+QvB
tsprKkdbwhTwaVKRDwnIAfwwpvONAV+/6X5W0UDJEmevDQZR8x74nBHWezdDv+lk
Ig9R0ZWbG6k7TkdrLwTbs1c=
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIJAO8HJfrb3JZeMA0GCSqGSIb3DQEBBQUAMCMxITAfBgNV
BAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0xNDAzMTgwMTE3MTdaFw0y
NDAzMTcwMTE3MTdaMCMxITAfBgNVBAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0
ZDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMFf1kCef6FTPMxQSoTh
AZGFNmixh8fRDLsUo58pEFwztBRUPWS6s6Ql8mA75aAEdo4+JVyE8QPi5F+fWbnT
oWkIw7E7YGl6s+EScSMQYHKCLq4mPHPMHtZspFowNp+Vax88SSUo1TKlpVNVIGim
8JQ5SRi3p0aD6UAiu9WxQ5s+xHnDwgvQiu3Sa4COl5NQjkC1r2LrhJnJQQiw0hsn
1nGgg15jEaDCZa8uPw1EtHv8smoZpjTbwRBVjXtzLskYIRyYLQjvqR+/QAd0XZca
v0LdTwQR6obg/CwSgv7qG/WN6t25VIIGQDIUkVMBhLDmCh8QRpTvx1YWumSWW4D2
k2kCAwEAAaNQME4wHQYDVR0OBBYEFLpo8Vz1m19xvPmzx+2wf2PaSTIpMB8GA1Ud
IwQYMBaAFLpo8Vz1m19xvPmzx+2wf2PaSTIpMAwGA1UdEwQFMAMBAf8wDQYJKoZI
hvcNAQEFBQADggEBALhwpLS6C+97nWrEICI5yetQjexCJGltMESg1llNYjsbIuJ/
S4XbrVzhN4nfNGMSbj8rb/9FT6TSru5QLjJQQmj38pqsWtEhR2vBLclqGqEcJfvP
Mdn1qAJhJfhrs0KUpsX6xFTnSkNoyGxCP8Wh2C1L0NL5r+x58lkma5vL6ncwWYY+
0C3bt1XbBRdeOZHUwuYTIcD+BCNixQiNor7KjO1TzpOb6V3m1SKHu8idDM5fUcKo
oGbV3WuE7AJrAG5fvt59V9MtMPc2FklVFminfTeYKboEaxZJxuPDbQs2IyJ/0lI8
P0Mv4LIKj4+OipQ/fGbZuE7cOioPKKl02dE7eCA=
-----END CERTIFICATE-----`;

const SP_ENTITY_ID = "https://sp.example.com/metadata.xml";
const SP_ASSERT_ENDPOINT = "https://sp.example.com/assert";
const IDP_ENTITY_ID = "https://idp.example.com/metadata";

function idpConfig(overrides: Partial<IdpInitiatedIdpConfig> = {}): IdpInitiatedIdpConfig {
  return {
    entityId: IDP_ENTITY_ID,
    privateKey: TEST_KEY,
    certificate: TEST_CERT,
    ...overrides,
  };
}

function idpInitiatedSpConfig(overrides: Partial<IdpInitiatedSpConfig> = {}): IdpInitiatedSpConfig {
  return {
    entityId: SP_ENTITY_ID,
    assertEndpoint: SP_ASSERT_ENDPOINT,
    ...overrides,
  };
}

function spConfigForValidation(overrides: Partial<SpInitiatedSpConfig> = {}): SpInitiatedSpConfig {
  return {
    entityId: SP_ENTITY_ID,
    privateKey: TEST_KEY,
    certificate: TEST_CERT,
    assertEndpoint: SP_ASSERT_ENDPOINT,
    allowUnencryptedAssertion: true,
    ...overrides,
  };
}

function idpConfigForValidation(overrides: Partial<SpInitiatedIdpConfig> = {}): SpInitiatedIdpConfig {
  return {
    ssoLoginUrl: "https://idp.example.com/sso/login",
    ssoLogoutUrl: "https://idp.example.com/sso/logout",
    certificates: TEST_CERT,
    ...overrides,
  };
}

describe("createIdpInitiatedResponse", () => {
  it("returns base64 SAMLResponse, destination, and optional relayState", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig(),
      { nameId: "user@example.com", sessionIndex: "sess_123" }
    );
    expect(result.destination).toBe(SP_ASSERT_ENDPOINT);
    expect(result.relayState).toBeUndefined();
    expect(typeof result.samlResponseBase64).toBe("string");
    expect(Buffer.from(result.samlResponseBase64, "base64").toString("utf8")).toContain("Response");
  });

  it("includes relayState when provided", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig(),
      { nameId: "user@example.com" },
      { relayState: "/app/dashboard" }
    );
    expect(result.relayState).toBe("/app/dashboard");
  });

  it("produces response that SP validation accepts (roundtrip)", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig(),
      { nameId: "user@example.com", sessionIndex: "sess_456" }
    );
    const validated = await validateSpInitiatedPostResponse(
      spConfigForValidation(),
      idpConfigForValidation(),
      { SAMLResponse: result.samlResponseBase64 },
      { requireSessionIndex: true }
    );
    expect(validated.nameId).toBe("user@example.com");
    expect(validated.sessionIndex).toBe("sess_456");
  });

  it("roundtrip with attributes", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig(),
      {
        nameId: "user@example.com",
        sessionIndex: "sess_789",
        attributes: {
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": ["user@example.com"],
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname": ["Jane"],
        },
      }
    );
    const validated = await validateSpInitiatedPostResponse(
      spConfigForValidation(),
      idpConfigForValidation(),
      { SAMLResponse: result.samlResponseBase64 },
      { requireSessionIndex: true }
    );
    expect(validated.nameId).toBe("user@example.com");
    expect(validated.attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"]).toEqual(["user@example.com"]);
    expect(validated.attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"]).toEqual(["Jane"]);
  });

  it("encrypts assertion when SP encryptionCertificate is provided", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig({ encryptionCertificate: TEST_CERT }),
      { nameId: "user@example.com", sessionIndex: "sess_enc" }
    );
    const xml = Buffer.from(result.samlResponseBase64, "base64").toString("utf8");
    expect(xml).toContain("EncryptedAssertion");
    expect(xml).not.toContain("<saml:Assertion ");
  });

  it("encrypted assertion roundtrip: SP decrypts and validates", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig({ encryptionCertificate: TEST_CERT }),
      { nameId: "encuser@example.com", sessionIndex: "sess_enc2" }
    );
    const validated = await validateSpInitiatedPostResponse(
      spConfigForValidation(),
      idpConfigForValidation(),
      { SAMLResponse: result.samlResponseBase64 },
      { requireSessionIndex: true }
    );
    expect(validated.nameId).toBe("encuser@example.com");
    expect(validated.sessionIndex).toBe("sess_enc2");
  });

  it("encrypted assertion roundtrip preserves attributes after decrypt", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig({ encryptionCertificate: TEST_CERT }),
      {
        nameId: "attruser@example.com",
        sessionIndex: "sess_attr",
        attributes: { email: ["attruser@example.com"], role: ["admin"] },
      }
    );
    const validated = await validateIdpInitiatedPostResponse(
      spConfigForValidation(),
      idpConfigForValidation(),
      { SAMLResponse: result.samlResponseBase64 }
    );
    expect(validated.nameId).toBe("attruser@example.com");
    expect(validated.attributes.email).toEqual(["attruser@example.com"]);
    expect(validated.attributes.role).toEqual(["admin"]);
  });

  it("rejects encrypted response when ciphertext is tampered", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig({ encryptionCertificate: TEST_CERT }),
      { nameId: "user@example.com", sessionIndex: "sess_x" }
    );
    const tamperedB64 = result.samlResponseBase64.slice(0, -4) + "XXXX";
    await expect(
      validateIdpInitiatedPostResponse(spConfigForValidation(), idpConfigForValidation(), {
        SAMLResponse: tamperedB64,
      })
    ).rejects.toThrow();
  });
});

describe("validateIdpInitiatedPostResponse", () => {
  it("accepts IdP-initiated response and returns nameId and attributes", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig(),
      { nameId: "idp-user@example.com", sessionIndex: "sess_idp" }
    );
    const validated = await validateIdpInitiatedPostResponse(
      spConfigForValidation(),
      idpConfigForValidation(),
      { SAMLResponse: result.samlResponseBase64 }
    );
    expect(validated.nameId).toBe("idp-user@example.com");
    expect(validated.sessionIndex).toBe("sess_idp");
    expect(validated.inResponseTo).toBe("");
  });

  it("accepts IdP-initiated response without SessionIndex by default", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig(),
      { nameId: "no-session@example.com" }
    );
    const validated = await validateIdpInitiatedPostResponse(
      spConfigForValidation(),
      idpConfigForValidation(),
      { SAMLResponse: result.samlResponseBase64 }
    );
    expect(validated.nameId).toBe("no-session@example.com");
    expect(validated.sessionIndex).toBeDefined();
  });

  it("preserves relayState", async () => {
    const result = await createIdpInitiatedResponse(
      idpConfig(),
      idpInitiatedSpConfig(),
      { nameId: "user@example.com" },
      { relayState: "/dashboard" }
    );
    const validated = await validateIdpInitiatedPostResponse(
      spConfigForValidation(),
      idpConfigForValidation(),
      { SAMLResponse: result.samlResponseBase64, RelayState: "/dashboard" }
    );
    expect(validated.relayState).toBe("/dashboard");
  });

  it("rejects invalid base64 SAMLResponse", async () => {
    await expect(
      validateIdpInitiatedPostResponse(spConfigForValidation(), idpConfigForValidation(), {
        SAMLResponse: "not-valid-base64!!!",
      })
    ).rejects.toThrow();
  });

  it("rejects valid base64 but non-SAML content", async () => {
    const notSaml = Buffer.from("<foo>bar</foo>", "utf8").toString("base64");
    await expect(
      validateIdpInitiatedPostResponse(spConfigForValidation(), idpConfigForValidation(), {
        SAMLResponse: notSaml,
      })
    ).rejects.toThrow();
  });
});
