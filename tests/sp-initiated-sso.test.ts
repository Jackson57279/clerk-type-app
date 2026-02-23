import { describe, it, expect } from "vitest";
import {
  createSpInitiatedLoginRequestUrl,
  validateSpInitiatedPostResponse,
  type SpInitiatedSpConfig,
  type SpInitiatedIdpConfig,
} from "../src/sp-initiated-sso.js";

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
