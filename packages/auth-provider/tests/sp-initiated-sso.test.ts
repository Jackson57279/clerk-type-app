import { createRequire } from "module";
import { describe, it, expect } from "vitest";
import zlib from "zlib";
import {
  createSpInitiatedLoginRequestUrl,
  validateSpInitiatedPostResponse,
  validateIdpInitiatedPostResponse,
  validateSamlAssertPost,
  isIdpInitiatedAssertion,
  createSpInitiatedLogoutRequestUrl,
  validateSpInitiatedLogoutResponse,
  getSpInitiatedLoginRedirect,
  handleSpInitiatedAssertEndpoint,
  type SpInitiatedSpConfig,
  type SpInitiatedIdpConfig,
} from "../src/sp-initiated-sso.js";
import {
  createLogoutResponse,
  handleSpInitiatedLogout,
  parseLogoutRequest,
  type IdpLogoutConfig,
} from "../src/single-logout.js";
import { createIdpInitiatedResponse } from "../src/idp-initiated-sso.js";
import { DOMParser } from "@xmldom/xmldom";

const require = createRequire(import.meta.url);
const { SignedXml } = require("xml-crypto") as {
  SignedXml: new (opts?: { publicCert?: string }) => {
    findSignatures: (doc: Document) => Node[];
    loadSignature: (node: Node) => void;
    checkSignature: (xml: string) => boolean;
  };
};

const TEST_SP_KEY = `-----BEGIN PRIVATE KEY-----
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

function spConfig(overrides: Partial<SpInitiatedSpConfig> = {}): SpInitiatedSpConfig {
  return {
    entityId: "https://sp.example.com/metadata.xml",
    privateKey: TEST_SP_KEY,
    certificate: TEST_CERT,
    assertEndpoint: "https://sp.example.com/assert",
    ...overrides,
  };
}

function idpConfig(overrides: Partial<SpInitiatedIdpConfig> = {}): SpInitiatedIdpConfig {
  return {
    ssoLoginUrl: "https://idp.example.com/sso/login",
    ssoLogoutUrl: "https://idp.example.com/sso/logout",
    certificates: TEST_CERT,
    ...overrides,
  };
}

describe("createSpInitiatedLoginRequestUrl", () => {
  it("returns login URL with IdP host and SAMLRequest param", async () => {
    const result = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig());
    expect(result.loginUrl).toContain("https://idp.example.com/sso/login");
    const url = new URL(result.loginUrl);
    expect(url.searchParams.get("SAMLRequest")).toBeTruthy();
    expect(result.requestId).toBeTruthy();
    expect(result.requestId.length).toBeGreaterThan(1);
  });

  it("includes RelayState in URL when provided", async () => {
    const result = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig(), {
      relayState: "/dashboard",
    });
    const url = new URL(result.loginUrl);
    expect(url.searchParams.get("RelayState")).toBe("/dashboard");
  });

  it("produces different requestId per call", async () => {
    const a = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig());
    const b = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig());
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.loginUrl).not.toBe(b.loginUrl);
  });

  it("produces signed AuthnRequest by default (Signature inside SAMLRequest)", async () => {
    const result = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig());
    const samlRequestB64 = new URL(result.loginUrl).searchParams.get("SAMLRequest");
    expect(samlRequestB64).toBeTruthy();
    const deflated = Buffer.from(samlRequestB64!, "base64");
    const xml = zlib.inflateRawSync(deflated).toString("utf8");
    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const signature = dom.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
    expect(signature.length).toBe(1);
    const signatureMethod = dom.getElementsByTagName("SignatureMethod")[0];
    expect(signatureMethod?.getAttribute("Algorithm")).toBe(
      "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
    );
  });

  it("signed AuthnRequest signature validates with SP certificate", async () => {
    const result = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig());
    const samlRequestB64 = new URL(result.loginUrl).searchParams.get("SAMLRequest");
    const deflated = Buffer.from(samlRequestB64!, "base64");
    const xml = zlib.inflateRawSync(deflated).toString("utf8");
    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const sig = new SignedXml({ publicCert: TEST_CERT });
    const signatures = sig.findSignatures(dom as unknown as Document);
    expect(signatures.length).toBeGreaterThanOrEqual(1);
    sig.loadSignature(signatures[0]!);
    expect(sig.checkSignature(xml)).toBe(true);
  });

  it("when signAuthnRequest is false, produces unsigned AuthnRequest", async () => {
    const result = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig(), {
      signAuthnRequest: false,
    });
    const samlRequestB64 = new URL(result.loginUrl).searchParams.get("SAMLRequest");
    expect(samlRequestB64).toBeTruthy();
    const deflated = Buffer.from(samlRequestB64!, "base64");
    const xml = zlib.inflateRawSync(deflated).toString("utf8");
    expect(xml).not.toContain("Signature");
  });

  it("full SP-initiated login flow: IdP response validates at SP assert endpoint", async () => {
    const { loginUrl } = await createSpInitiatedLoginRequestUrl(spConfig(), idpConfig());
    expect(loginUrl).toContain("SAMLRequest");
    const idpInitiatedIdpConfig = {
      entityId: "https://idp.example.com/metadata",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
    };
    const idpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpResponse = await createIdpInitiatedResponse(
      idpInitiatedIdpConfig,
      idpInitiatedSpConfig,
      { nameId: "user@example.com", sessionIndex: "sess_123" }
    );
    const validated = await validateSpInitiatedPostResponse(
      spConfig({ allowUnencryptedAssertion: true }),
      idpConfig(),
      { SAMLResponse: idpResponse.samlResponseBase64 },
      { requireSessionIndex: true }
    );
    expect(validated.nameId).toBe("user@example.com");
    expect(validated.sessionIndex).toBe("sess_123");
  });
});

describe("validateSpInitiatedPostResponse", () => {
  it("rejects when SAMLResponse is invalid base64", async () => {
    await expect(
      validateSpInitiatedPostResponse(spConfig(), idpConfig(), {
        SAMLResponse: "not-valid-base64!!!",
      })
    ).rejects.toThrow();
  });

  it("rejects when SAMLResponse is valid base64 but not valid SAML", async () => {
    const notSaml = Buffer.from("<foo>bar</foo>", "utf8").toString("base64");
    await expect(
      validateSpInitiatedPostResponse(spConfig(), idpConfig(), {
        SAMLResponse: notSaml,
      })
    ).rejects.toThrow();
  });

  it("rejects when SAMLResponse is empty", async () => {
    await expect(
      validateSpInitiatedPostResponse(spConfig(), idpConfig(), {
        SAMLResponse: "",
      })
    ).rejects.toThrow();
  });
});

describe("validateIdpInitiatedPostResponse", () => {
  it("accepts IdP-initiated SAML response without requiring SessionIndex", async () => {
    const idpInitiatedIdpConfig = {
      entityId: "https://idp.example.com/metadata",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
    };
    const idpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpResponse = await createIdpInitiatedResponse(
      idpInitiatedIdpConfig,
      idpInitiatedSpConfig,
      { nameId: "idp-user@example.com" }
    );
    const validated = await validateIdpInitiatedPostResponse(
      spConfig({ allowUnencryptedAssertion: true }),
      idpConfig(),
      { SAMLResponse: idpResponse.samlResponseBase64 }
    );
    expect(validated.nameId).toBe("idp-user@example.com");
    expect(validated.inResponseTo).toBe("");
  });
});

describe("validateSamlAssertPost (IdP-initiated and SP-initiated on same endpoint)", () => {
  it("accepts IdP-initiated POST and returns assertion with empty inResponseTo", async () => {
    const idpInitiatedIdpConfig = {
      entityId: "https://idp.example.com/metadata",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
    };
    const idpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpResponse = await createIdpInitiatedResponse(
      idpInitiatedIdpConfig,
      idpInitiatedSpConfig,
      { nameId: "idp-portal@example.com" }
    );
    const result = await validateSamlAssertPost(
      spConfig({ allowUnencryptedAssertion: true }),
      idpConfig(),
      { SAMLResponse: idpResponse.samlResponseBase64 }
    );
    expect(result.nameId).toBe("idp-portal@example.com");
    expect(result.inResponseTo).toBe("");
    expect(isIdpInitiatedAssertion(result)).toBe(true);
  });

  it("accepts SP-initiated-style response when using same assert handler", async () => {
    const idpInitiatedIdpConfig = {
      entityId: "https://idp.example.com/metadata",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
    };
    const idpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpResponse = await createIdpInitiatedResponse(
      idpInitiatedIdpConfig,
      idpInitiatedSpConfig,
      { nameId: "user@example.com", sessionIndex: "sess_99" }
    );
    const result = await validateSamlAssertPost(
      spConfig({ allowUnencryptedAssertion: true }),
      idpConfig(),
      { SAMLResponse: idpResponse.samlResponseBase64 }
    );
    expect(result.nameId).toBe("user@example.com");
    expect(result.sessionIndex).toBe("sess_99");
  });

  it("rejects invalid SAMLResponse", async () => {
    await expect(
      validateSamlAssertPost(spConfig(), idpConfig(), {
        SAMLResponse: "not-valid-base64!!!",
      })
    ).rejects.toThrow();
  });
});

describe("createSpInitiatedLogoutRequestUrl", () => {
  it("returns logout URL with IdP host and SAMLRequest param", async () => {
    const result = await createSpInitiatedLogoutRequestUrl(spConfig(), idpConfig(), {
      nameId: "user@example.com",
      sessionIndex: "sess_123",
    });
    expect(result.logoutUrl).toContain("https://idp.example.com/sso/logout");
    const url = new URL(result.logoutUrl);
    expect(url.searchParams.get("SAMLRequest")).toBeTruthy();
    expect(result.requestId).toBeTruthy();
  });

  it("includes RelayState in URL when provided", async () => {
    const result = await createSpInitiatedLogoutRequestUrl(spConfig(), idpConfig(), {
      nameId: "user@example.com",
      sessionIndex: "sess_1",
      relayState: "/goodbye",
    });
    const url = new URL(result.logoutUrl);
    expect(url.searchParams.get("RelayState")).toBe("/goodbye");
  });

  it("produces different requestId per call", async () => {
    const a = await createSpInitiatedLogoutRequestUrl(spConfig(), idpConfig(), {
      nameId: "u1",
      sessionIndex: "s1",
    });
    const b = await createSpInitiatedLogoutRequestUrl(spConfig(), idpConfig(), {
      nameId: "u1",
      sessionIndex: "s1",
    });
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.logoutUrl).not.toBe(b.logoutUrl);
  });
});

describe("validateSpInitiatedLogoutResponse", () => {
  it("accepts valid LogoutResponse from IdP and returns inResponseTo and relayState", async () => {
    const idpEntityId = "https://idp.example.com/metadata";
    const { samlResponseBase64 } = createLogoutResponse(
      { entityId: idpEntityId, privateKey: TEST_SP_KEY, certificate: TEST_CERT },
      "https://sp.example.com/assert",
      { inResponseTo: "req_123" }
    );
    const xml = zlib.inflateRawSync(Buffer.from(samlResponseBase64, "base64")).toString("utf8");
    const postBody = { SAMLResponse: Buffer.from(xml, "utf8").toString("base64") };
    const result = await validateSpInitiatedLogoutResponse(
      spConfig(),
      idpConfig(),
      postBody
    );
    expect(result.inResponseTo).toBe("req_123");
    expect(result.relayState).toBeUndefined();
  });

  it("returns relayState when present in request body", async () => {
    const { samlResponseBase64 } = createLogoutResponse(
      { entityId: "https://idp.example.com/metadata", privateKey: TEST_SP_KEY, certificate: TEST_CERT },
      "https://sp.example.com/assert",
      { inResponseTo: "req_456" }
    );
    const xml = zlib.inflateRawSync(Buffer.from(samlResponseBase64, "base64")).toString("utf8");
    const result = await validateSpInitiatedLogoutResponse(spConfig(), idpConfig(), {
      SAMLResponse: Buffer.from(xml, "utf8").toString("base64"),
      RelayState: "/landing",
    });
    expect(result.relayState).toBe("/landing");
  });

  it("rejects when SAMLResponse is not a LogoutResponse", async () => {
    const notLogout = Buffer.from("<foo>bar</foo>", "utf8").toString("base64");
    await expect(
      validateSpInitiatedLogoutResponse(spConfig(), idpConfig(), { SAMLResponse: notLogout })
    ).rejects.toThrow();
  });
});

describe("getSpInitiatedLoginRedirect", () => {
  it("returns 302 with redirectUrl to IdP login URL", async () => {
    const result = await getSpInitiatedLoginRedirect(
      {},
      { spConfig: spConfig(), idpConfig: idpConfig() }
    );
    expect(result.status).toBe(302);
    if (result.status === 302) {
      expect(result.redirectUrl).toContain("https://idp.example.com/sso/login");
      expect(new URL(result.redirectUrl).searchParams.get("SAMLRequest")).toBeTruthy();
    }
  });

  it("includes RelayState in redirect URL when provided", async () => {
    const result = await getSpInitiatedLoginRedirect(
      { relayState: "/app/callback" },
      { spConfig: spConfig(), idpConfig: idpConfig() }
    );
    expect(result.status).toBe(302);
    if (result.status === 302) {
      expect(new URL(result.redirectUrl).searchParams.get("RelayState")).toBe("/app/callback");
    }
  });
});

describe("handleSpInitiatedAssertEndpoint", () => {
  it("returns 200 with assertion when SAMLResponse is valid", async () => {
    const idpInitiatedIdpConfig = {
      entityId: "https://idp.example.com/metadata",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
    };
    const idpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpResponse = await createIdpInitiatedResponse(
      idpInitiatedIdpConfig,
      idpInitiatedSpConfig,
      { nameId: "user@example.com", sessionIndex: "sess_1" }
    );
    const result = await handleSpInitiatedAssertEndpoint(
      { SAMLResponse: idpResponse.samlResponseBase64 },
      {
        spConfig: spConfig({ allowUnencryptedAssertion: true }),
        idpConfig: idpConfig(),
        requireSessionIndex: true,
      }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.assertion.nameId).toBe("user@example.com");
      expect(result.assertion.sessionIndex).toBe("sess_1");
    }
  });

  it("returns 400 when SAMLResponse is missing", async () => {
    const result = await handleSpInitiatedAssertEndpoint(
      { SAMLResponse: "" },
      { spConfig: spConfig(), idpConfig: idpConfig() }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.errorDescription).toContain("SAMLResponse");
    }
  });

  it("returns 400 when SAMLResponse is invalid", async () => {
    const result = await handleSpInitiatedAssertEndpoint(
      { SAMLResponse: "not-valid-base64!!!" },
      { spConfig: spConfig(), idpConfig: idpConfig() }
    );
    expect(result.status).toBe(400);
    if (result.status === 400) {
      expect(result.error).toBe("invalid_request");
    }
  });
});

describe("SLO end-to-end", () => {
  it("SP-initiated logout: SP creates logout URL, IdP handles request and returns response, SP validates response", async () => {
    const nameId = "user@example.com";
    const sessionIndex = "sess_abc";
    const { logoutUrl } = await createSpInitiatedLogoutRequestUrl(
      spConfig(),
      idpConfig(),
      { nameId, sessionIndex }
    );
    const samlRequest = new URL(logoutUrl).searchParams.get("SAMLRequest");
    expect(samlRequest).toBeTruthy();
    const parsed = parseLogoutRequest(samlRequest!);
    expect(parsed.nameId).toBe(nameId);
    expect(parsed.sessionIndex).toBe(sessionIndex);

    const idpLogoutConfig: IdpLogoutConfig = {
      entityId: "https://idp.example.com/metadata",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
    };
    const invalidated: { nameId: string; sessionIndex?: string }[] = [];
    const { redirectUrl } = await handleSpInitiatedLogout({
      samlRequestBase64: samlRequest!,
      idpConfig: idpLogoutConfig,
      getSpLogoutUrl: (issuer) =>
        issuer === "https://sp.example.com/metadata.xml" ? "https://sp.example.com/slo" : null,
      invalidateSession: (params) => {
        invalidated.push(params);
      },
    });
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]?.nameId).toBe(nameId);
    expect(invalidated[0]?.sessionIndex).toBe(sessionIndex);

    const responseUrl = new URL(redirectUrl);
    const samlResponseDeflated = responseUrl.searchParams.get("SAMLResponse");
    expect(samlResponseDeflated).toBeTruthy();
    const xml = zlib.inflateRawSync(Buffer.from(samlResponseDeflated!, "base64")).toString("utf8");
    const samlResponseBase64 = Buffer.from(xml, "utf8").toString("base64");
    const validated = await validateSpInitiatedLogoutResponse(spConfig(), idpConfig(), {
      SAMLResponse: samlResponseBase64,
    });
    expect(validated.inResponseTo).toBe(parsed.requestId);
  });
});
