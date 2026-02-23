import { describe, it, expect } from "vitest";
import zlib from "zlib";
import {
  parseLogoutRequest,
  createLogoutResponse,
  createLogoutRequest,
  handleSpInitiatedLogout,
  handleIdpInitiatedLogoutToSp,
  handleSpInitiatedSloEndpoint,
  handleIdpInitiatedSloEndpoint,
  type IdpLogoutConfig,
} from "../src/single-logout.js";

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
lttij1imPbL1bE2C1FrSohTQvVkxTObXGrLlGrdFGEbekl5DRBSHQt3rkENb5Tki
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

const LOGOUT_REQUEST_XML = `<?xml version="1.0"?>
<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_1" IssueInstant="2015-01-21T22:30:38.150Z" Version="2.0" Destination="https://idp.example.com/slo">
  <saml:Issuer>https://sp.example.com/metadata</saml:Issuer>
  <saml:NameID>tstudent</saml:NameID>
  <samlp:SessionIndex>_2</samlp:SessionIndex>
</samlp:LogoutRequest>`;

function idpConfig(overrides: Partial<IdpLogoutConfig> = {}): IdpLogoutConfig {
  return {
    entityId: "https://idp.example.com/metadata",
    privateKey: TEST_KEY,
    certificate: TEST_CERT,
    ...overrides,
  };
}

describe("parseLogoutRequest", () => {
  it("parses deflated base64 LogoutRequest", () => {
    const deflated = zlib.deflateRawSync(Buffer.from(LOGOUT_REQUEST_XML, "utf8")).toString("base64");
    const parsed = parseLogoutRequest(deflated);
    expect(parsed.requestId).toBe("_1");
    expect(parsed.issuer).toBe("https://sp.example.com/metadata");
    expect(parsed.nameId).toBe("tstudent");
    expect(parsed.sessionIndex).toBe("_2");
  });

  it("parses raw base64 LogoutRequest when not deflated", () => {
    const raw = Buffer.from(LOGOUT_REQUEST_XML, "utf8").toString("base64");
    const parsed = parseLogoutRequest(raw);
    expect(parsed.requestId).toBe("_1");
    expect(parsed.nameId).toBe("tstudent");
  });

  it("throws when XML does not contain LogoutRequest", () => {
    const bad = Buffer.from("<foo>bar</foo>", "utf8").toString("base64");
    expect(() => parseLogoutRequest(bad)).toThrow("Expected LogoutRequest");
  });
});

describe("createLogoutResponse", () => {
  it("returns deflated base64 SAMLResponse and destination", () => {
    const result = createLogoutResponse(idpConfig(), "https://sp.example.com/slo", {
      inResponseTo: "req_abc",
    });
    expect(result.destination).toBe("https://sp.example.com/slo");
    expect(typeof result.samlResponseBase64).toBe("string");
    const xml = zlib.inflateRawSync(Buffer.from(result.samlResponseBase64, "base64")).toString("utf8");
    expect(xml).toContain("LogoutResponse");
    expect(xml).toContain("InResponseTo=\"req_abc\"");
    expect(xml).toContain("StatusCode");
  });

  it("uses custom status when provided", () => {
    const result = createLogoutResponse(idpConfig(), "https://sp.example.com/slo", {
      inResponseTo: "req_xyz",
      status: "urn:oasis:names:tc:SAML:2.0:status:Requester",
    });
    const xml = zlib.inflateRawSync(Buffer.from(result.samlResponseBase64, "base64")).toString("utf8");
    expect(xml).toContain("Requester");
  });
});

describe("createLogoutRequest", () => {
  it("returns deflated base64 SAMLRequest and destination", () => {
    const result = createLogoutRequest(idpConfig(), "https://sp.example.com/slo", {
      nameId: "user@example.com",
      sessionIndex: "sess_123",
    });
    expect(result.destination).toBe("https://sp.example.com/slo");
    expect(typeof result.samlRequestBase64).toBe("string");
    const xml = zlib.inflateRawSync(Buffer.from(result.samlRequestBase64, "base64")).toString("utf8");
    expect(xml).toContain("LogoutRequest");
    expect(xml).toContain("user@example.com");
    expect(xml).toContain("sess_123");
  });

  it("omits SessionIndex when not provided", () => {
    const result = createLogoutRequest(idpConfig(), "https://sp.example.com/slo", {
      nameId: "user@example.com",
    });
    const xml = zlib.inflateRawSync(Buffer.from(result.samlRequestBase64, "base64")).toString("utf8");
    expect(xml).toContain("LogoutRequest");
    expect(xml).toContain("user@example.com");
    expect(xml).not.toContain("SessionIndex");
  });
});

describe("handleSpInitiatedLogout", () => {
  const deflatedSamlRequest = zlib.deflateRawSync(Buffer.from(LOGOUT_REQUEST_XML, "utf8")).toString("base64");

  it("returns redirect URL with SAMLResponse and destination, and invalidates session", async () => {
    const invalidated: { nameId: string; sessionIndex?: string }[] = [];
    const result = await handleSpInitiatedLogout({
      samlRequestBase64: deflatedSamlRequest,
      idpConfig: idpConfig(),
      getSpLogoutUrl: (issuer) => (issuer === "https://sp.example.com/metadata" ? "https://sp.example.com/slo" : null),
      invalidateSession: (params) => { invalidated.push(params); },
    });
    expect(result.redirectUrl).toContain("https://sp.example.com/slo?");
    expect(result.redirectUrl).toContain("SAMLResponse=");
    expect(invalidated).toHaveLength(1);
    const inv = invalidated[0];
    if (!inv) throw new Error("expected one invalidated session");
    expect(inv.nameId).toBe("tstudent");
    expect(inv.sessionIndex).toBe("_2");
  });

  it("includes RelayState in redirect URL when provided", async () => {
    const result = await handleSpInitiatedLogout({
      samlRequestBase64: deflatedSamlRequest,
      relayState: "rs123",
      idpConfig: idpConfig(),
      getSpLogoutUrl: () => "https://sp.example.com/slo",
      invalidateSession: () => {},
    });
    expect(result.redirectUrl).toContain("RelayState=");
    expect(result.redirectUrl).toContain("rs123");
  });

  it("throws when SP issuer has no logout URL", async () => {
    await expect(
      handleSpInitiatedLogout({
        samlRequestBase64: deflatedSamlRequest,
        idpConfig: idpConfig(),
        getSpLogoutUrl: () => null,
        invalidateSession: () => {},
      })
    ).rejects.toThrow("Unknown or unsupported SP issuer for SLO");
  });

  it("awaits async invalidateSession", async () => {
    let resolved = false;
    await handleSpInitiatedLogout({
      samlRequestBase64: deflatedSamlRequest,
      idpConfig: idpConfig(),
      getSpLogoutUrl: () => "https://sp.example.com/slo",
      invalidateSession: () => new Promise<void>((r) => { setTimeout(() => { resolved = true; r(); }, 0); }),
    });
    expect(resolved).toBe(true);
  });
});

describe("handleIdpInitiatedLogoutToSp", () => {
  const idpInitiatedRequestXml = `<?xml version="1.0"?>
<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_idp1" IssueInstant="2015-01-21T22:30:38.150Z" Version="2.0" Destination="https://sp.example.com/slo">
  <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>
  <saml:NameID>user@example.com</saml:NameID>
  <samlp:SessionIndex>sess_abc</samlp:SessionIndex>
</samlp:LogoutRequest>`;
  const deflatedIdpRequest = zlib.deflateRawSync(Buffer.from(idpInitiatedRequestXml, "utf8")).toString("base64");

  it("returns redirect URL to IdP with SAMLResponse and invalidates session", async () => {
    const invalidated: { nameId: string; sessionIndex?: string }[] = [];
    const result = await handleIdpInitiatedLogoutToSp({
      samlRequestBase64: deflatedIdpRequest,
      spConfig: idpConfig(),
      getIdpLogoutUrl: (issuer) => (issuer === "https://idp.example.com/metadata" ? "https://idp.example.com/slo" : null),
      invalidateSession: (params) => { invalidated.push(params); },
    });
    expect(result.redirectUrl).toContain("https://idp.example.com/slo?");
    expect(result.redirectUrl).toContain("SAMLResponse=");
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]?.nameId).toBe("user@example.com");
    expect(invalidated[0]?.sessionIndex).toBe("sess_abc");
  });

  it("includes RelayState in redirect URL when provided", async () => {
    const result = await handleIdpInitiatedLogoutToSp({
      samlRequestBase64: deflatedIdpRequest,
      relayState: "/signed-out",
      spConfig: idpConfig(),
      getIdpLogoutUrl: () => "https://idp.example.com/slo",
      invalidateSession: () => {},
    });
    expect(result.redirectUrl).toContain("RelayState=");
    expect(result.redirectUrl).toContain("signed-out");
  });

  it("throws when IdP issuer has no logout URL", async () => {
    await expect(
      handleIdpInitiatedLogoutToSp({
        samlRequestBase64: deflatedIdpRequest,
        spConfig: idpConfig(),
        getIdpLogoutUrl: () => null,
        invalidateSession: () => {},
      })
    ).rejects.toThrow("Unknown or unsupported IdP issuer for SLO");
  });
});

describe("handleSpInitiatedSloEndpoint", () => {
  const deflatedSamlRequest = zlib.deflateRawSync(Buffer.from(LOGOUT_REQUEST_XML, "utf8")).toString("base64");

  it("returns 302 with redirectUrl when SAMLRequest is valid", async () => {
    const invalidated: { nameId: string; sessionIndex?: string }[] = [];
    const result = await handleSpInitiatedSloEndpoint(
      { samlRequest: deflatedSamlRequest },
      {
        idpConfig: idpConfig(),
        getSpLogoutUrl: (issuer) => (issuer === "https://sp.example.com/metadata" ? "https://sp.example.com/slo" : null),
        invalidateSession: (params) => invalidated.push(params),
      }
    );
    expect(result.status).toBe(302);
    if (result.status !== 302) throw new Error("expected redirect");
    expect(result.redirectUrl).toContain("https://sp.example.com/slo?");
    expect(result.redirectUrl).toContain("SAMLResponse=");
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]?.nameId).toBe("tstudent");
  });

  it("includes RelayState in redirect when provided", async () => {
    const result = await handleSpInitiatedSloEndpoint(
      { samlRequest: deflatedSamlRequest, relayState: "rs456" },
      {
        idpConfig: idpConfig(),
        getSpLogoutUrl: () => "https://sp.example.com/slo",
        invalidateSession: () => {},
      }
    );
    expect(result.status).toBe(302);
    if (result.status !== 302) throw new Error("expected redirect");
    expect(result.redirectUrl).toContain("RelayState=rs456");
  });

  it("returns 400 when SAMLRequest is missing", async () => {
    const result = await handleSpInitiatedSloEndpoint(
      {},
      {
        idpConfig: idpConfig(),
        getSpLogoutUrl: () => "https://sp.example.com/slo",
        invalidateSession: () => {},
      }
    );
    expect(result.status).toBe(400);
    if (result.status !== 400) throw new Error("expected error");
    expect(result.error).toBe("invalid_request");
    expect(result.errorDescription).toContain("SAMLRequest");
  });

  it("returns 400 when SAMLRequest is empty string", async () => {
    const result = await handleSpInitiatedSloEndpoint(
      { samlRequest: "   " },
      {
        idpConfig: idpConfig(),
        getSpLogoutUrl: () => "https://sp.example.com/slo",
        invalidateSession: () => {},
      }
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when SP issuer has no logout URL", async () => {
    const result = await handleSpInitiatedSloEndpoint(
      { samlRequest: deflatedSamlRequest },
      {
        idpConfig: idpConfig(),
        getSpLogoutUrl: () => null,
        invalidateSession: () => {},
      }
    );
    expect(result.status).toBe(400);
    if (result.status !== 400) throw new Error("expected error");
    expect(result.errorDescription).toContain("Unknown or unsupported SP issuer");
  });
});

describe("handleIdpInitiatedSloEndpoint", () => {
  const idpInitiatedRequestXml = `<?xml version="1.0"?>
<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_idp1" IssueInstant="2015-01-21T22:30:38.150Z" Version="2.0" Destination="https://sp.example.com/slo">
  <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>
  <saml:NameID>user@example.com</saml:NameID>
  <samlp:SessionIndex>sess_abc</samlp:SessionIndex>
</samlp:LogoutRequest>`;
  const deflatedIdpRequest = zlib.deflateRawSync(Buffer.from(idpInitiatedRequestXml, "utf8")).toString("base64");

  it("returns 302 with redirectUrl when SAMLRequest is valid", async () => {
    const invalidated: { nameId: string; sessionIndex?: string }[] = [];
    const result = await handleIdpInitiatedSloEndpoint(
      { samlRequest: deflatedIdpRequest },
      {
        spConfig: idpConfig(),
        getIdpLogoutUrl: (issuer) => (issuer === "https://idp.example.com/metadata" ? "https://idp.example.com/slo" : null),
        invalidateSession: (params) => invalidated.push(params),
      }
    );
    expect(result.status).toBe(302);
    if (result.status !== 302) throw new Error("expected redirect");
    expect(result.redirectUrl).toContain("https://idp.example.com/slo?");
    expect(result.redirectUrl).toContain("SAMLResponse=");
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]?.nameId).toBe("user@example.com");
  });

  it("returns 400 when SAMLRequest is missing", async () => {
    const result = await handleIdpInitiatedSloEndpoint(
      {},
      {
        spConfig: idpConfig(),
        getIdpLogoutUrl: () => "https://idp.example.com/slo",
        invalidateSession: () => {},
      }
    );
    expect(result.status).toBe(400);
    if (result.status !== 400) throw new Error("expected error");
    expect(result.error).toBe("invalid_request");
  });

  it("returns 400 when IdP issuer has no logout URL", async () => {
    const result = await handleIdpInitiatedSloEndpoint(
      { samlRequest: deflatedIdpRequest },
      {
        spConfig: idpConfig(),
        getIdpLogoutUrl: () => null,
        invalidateSession: () => {},
      }
    );
    expect(result.status).toBe(400);
    if (result.status !== 400) throw new Error("expected error");
    expect(result.errorDescription).toContain("Unknown or unsupported IdP issuer");
  });
});
