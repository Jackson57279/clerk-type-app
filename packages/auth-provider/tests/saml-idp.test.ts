import { describe, it, expect } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { getIdpMetadataXml, type IdpMetadataConfig } from "../src/saml-idp-metadata.js";
import { parseAuthnRequest, parseAuthnRequestFromQuery } from "../src/saml-idp-authn-request.js";
import { createIdpInitiatedResponse } from "../src/idp-initiated-sso.js";
import { createSpInitiatedLoginRequestUrl } from "../src/sp-initiated-sso.js";
import type { SpInitiatedSpConfig, SpInitiatedIdpConfig } from "../src/sp-initiated-sso.js";
import { validateSpInitiatedPostResponse } from "../src/sp-initiated-sso.js";

const XMLNS_MD = "urn:oasis:names:tc:SAML:2.0:metadata";
const XMLNS_SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIJAO8HJfrb3JZeMA0GCSqGSIb3DQEBBQUAMCMxITAfBgNV
BAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0xNDAzMTgwMTE3MTdaFw0y
NDAzMTcwMTE3MTdaMCMxITAfBgNVBAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0
ZDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMFf1kCef6FTPMxQSoTh
AZGFNmixh8fRDLsUo58pEFwztBRUPWS6s6Ql8mA75aAEdo4+JVyE8QPi5F+fWbnT
oWkIw7E7YGl6s+EScSMQYHKCLq4mPHPMHtZspFowNp+Vax88SSUo1TKlpVNVIGi
m8JQ5SRi3p0aD6UAiu9WxQ5s+xHnDwgvQiu3Sa4COl5NQjkC1r2LrhJnJQQiw0hs
n1nGgg15jEaDCZa8uPw1EtHv8smoZpjTbwRBVjXtzLskYIRyYLQjvqR+/QAd0XZc
av0LdTwQR6obg/CwSgv7qG/WN6t25VIIGQDIUkVMBhLDmCh8QRpTvx1YWumSWW4D2
k2kCAwEAAaNQME4wHQYDVR0OBBYEFLpo8Vz1m19xvPmzx+2wf2PaSTIpMB8GA1Ud
IwQYMBaAFLpo8Vz1m19xvPmzx+2wf2PaSTIpMAwGA1UdEwQFMAMBAf8wDQYJKoZI
hvcNAQEFBQADggEBALhwpLS6C+97nWrEICI5yetQjexCJGltMESg1llNYjsbIuJ/
S4XbrVzhN4nfNGMSbj8rb/9FT6TSru5QLjJQQmj38pqsWtEhR2vBLclqGqEcJfvP
Mdn1qAJhJfhrs0KUpsX6xFTnSkNoyGxCP8Wh2C1L0NL5r+x58lkma5vL6ncwWYY+
0C3bt1XbBRdeOZHUwuYTIcD+BCNixQiNor7KjO1TzpOb6V3m1SKHu8idDM5fUcKo
oGbV3WuE7AJrAG5fvt59V9MtMPc2FklVFminfTeYKboEaxZJxuPDbQs2IyJ/0lI8
P0Mv4LIKj4+OipQ/fGbZuE7cOioPKKl02dE7eCA=
-----END CERTIFICATE-----`;

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
lttij1imPbL1bE2C1FrSohTQvVkxTObXGrLlGrdFGEbekl5DRBSHQt3rkENb5Tki
Hebj1ShyTQDGEAtmefPIo5c/re2RJ9t829NAEishAoGAGOW5CPq7Q0tEvOVE+/br
JXddPyZe++FB1e7i+iVYrA5F8wtvhVHsVsSxpm47XdAyAFdLdnttrnwzt3EA+QvB
tsprKkdbwhTwaVKRDwnIAfwwpvONAV+/6X5W0UDJEmevDQZR8x74nBHWezdDv+lk
Ig9R0ZWbG6k7TkdrLwTbs1c=
-----END PRIVATE KEY-----`;

function idpMetadataConfig(overrides: Partial<IdpMetadataConfig> = {}): IdpMetadataConfig {
  return {
    entityId: "https://idp.example.com/metadata",
    ssoLoginUrl: "https://idp.example.com/sso/login",
    signingCertificates: [TEST_CERT],
    ...overrides,
  };
}

describe("getIdpMetadataXml", () => {
  it("returns valid SAML 2.0 IdP metadata XML", () => {
    const xml = getIdpMetadataXml(idpMetadataConfig());
    expect(xml).toContain("EntityDescriptor");
    expect(xml).toContain("IDPSSODescriptor");
    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const entityDescriptor = dom.getElementsByTagNameNS(XMLNS_MD, "EntityDescriptor")[0];
    expect(entityDescriptor).toBeTruthy();
    expect(entityDescriptor?.getAttribute("entityID")).toBe("https://idp.example.com/metadata");
  });

  it("includes SingleSignOnService HTTP-Redirect and HTTP-POST with ssoLoginUrl", () => {
    const xml = getIdpMetadataXml(idpMetadataConfig());
    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const ssoList = dom.getElementsByTagNameNS(XMLNS_MD, "SingleSignOnService");
    expect(ssoList.length).toBeGreaterThanOrEqual(2);
    const redirect = Array.from(ssoList).find((el) => el.getAttribute("Binding") === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect");
    const post = Array.from(ssoList).find((el) => el.getAttribute("Binding") === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST");
    expect(redirect?.getAttribute("Location")).toBe("https://idp.example.com/sso/login");
    expect(post?.getAttribute("Location")).toBe("https://idp.example.com/sso/login");
  });

  it("includes KeyDescriptor with signing certificate", () => {
    const xml = getIdpMetadataXml(idpMetadataConfig());
    expect(xml).toContain("KeyDescriptor");
    expect(xml).toContain("X509Certificate");
    expect(xml).toContain("use=\"signing\"");
  });

  it("includes SingleLogoutService when ssoLogoutUrl is set", () => {
    const xml = getIdpMetadataXml(idpMetadataConfig({ ssoLogoutUrl: "https://idp.example.com/sso/logout" }));
    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const sloList = dom.getElementsByTagNameNS(XMLNS_MD, "SingleLogoutService");
    expect(sloList.length).toBe(1);
    expect(sloList[0]?.getAttribute("Location")).toBe("https://idp.example.com/sso/logout");
  });

  it("supports multiple signing certificates for rotation", () => {
    const xml = getIdpMetadataXml(idpMetadataConfig({ signingCertificates: [TEST_CERT, TEST_CERT] }));
    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const keyDescriptors = dom.getElementsByTagNameNS(XMLNS_MD, "KeyDescriptor");
    const signing = Array.from(keyDescriptors).filter((el) => el.getAttribute("use") === "signing");
    expect(signing.length).toBe(2);
  });

  it("uses custom entityId and ssoLoginUrl from config", () => {
    const xml = getIdpMetadataXml(
      idpMetadataConfig({
        entityId: "https://auth.mycompany.com/saml",
        ssoLoginUrl: "https://auth.mycompany.com/saml/sso",
      })
    );
    const dom = new DOMParser().parseFromString(xml, "text/xml");
    const entityDescriptor = dom.getElementsByTagNameNS(XMLNS_MD, "EntityDescriptor")[0];
    expect(entityDescriptor?.getAttribute("entityID")).toBe("https://auth.mycompany.com/saml");
    const ssoList = dom.getElementsByTagNameNS(XMLNS_MD, "SingleSignOnService");
    expect(ssoList[0]?.getAttribute("Location")).toBe("https://auth.mycompany.com/saml/sso");
  });
});

describe("parseAuthnRequest", () => {
  it("parses deflated base64 AuthnRequest from SP", async () => {
    const spConfig: SpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpConfig: SpInitiatedIdpConfig = {
      ssoLoginUrl: "https://idp.example.com/sso/login",
      ssoLogoutUrl: "https://idp.example.com/slo",
      certificates: TEST_CERT,
    };
    const { loginUrl } = await createSpInitiatedLoginRequestUrl(spConfig, idpConfig);
    const samlRequest = new URL(loginUrl).searchParams.get("SAMLRequest");
    expect(samlRequest).toBeTruthy();
    const parsed = parseAuthnRequest(samlRequest!);
    expect(parsed.id).toBeTruthy();
    expect(parsed.issuer).toBe("https://sp.example.com/metadata.xml");
    expect(parsed.assertionConsumerServiceURL).toBe("https://sp.example.com/assert");
    expect(parsed.forceAuthn).toBe(false);
  });

  it("parses raw base64 AuthnRequest when not deflated", () => {
    const authnRequestXml = `<?xml version="1.0"?>
<samlp:AuthnRequest xmlns:samlp="${XMLNS_SAMLP}" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_req123" Version="2.0" IssueInstant="2025-01-01T00:00:00Z" AssertionConsumerServiceURL="https://sp.example.com/acs"/>
`;
    const raw = Buffer.from(authnRequestXml, "utf8").toString("base64");
    const parsed = parseAuthnRequest(raw);
    expect(parsed.id).toBe("_req123");
    expect(parsed.assertionConsumerServiceURL).toBe("https://sp.example.com/acs");
  });

  it("throws when XML does not contain AuthnRequest", () => {
    const bad = Buffer.from("<foo>bar</foo>", "utf8").toString("base64");
    expect(() => parseAuthnRequest(bad)).toThrow("Expected AuthnRequest");
  });

  it("parseAuthnRequestFromQuery includes RelayState from query", async () => {
    const spConfig: SpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
      assertEndpoint: "https://sp.example.com/assert",
    };
    const idpConfig: SpInitiatedIdpConfig = {
      ssoLoginUrl: "https://idp.example.com/sso/login",
      ssoLogoutUrl: "https://idp.example.com/slo",
      certificates: TEST_CERT,
    };
    const { loginUrl } = await createSpInitiatedLoginRequestUrl(spConfig, idpConfig, { relayState: "/dashboard" });
    const url = new URL(loginUrl);
    const parsed = parseAuthnRequestFromQuery({
      SAMLRequest: url.searchParams.get("SAMLRequest")!,
      RelayState: url.searchParams.get("RelayState") ?? undefined,
    });
    expect(parsed.relayState).toBe("/dashboard");
    expect(parsed.issuer).toBe("https://sp.example.com/metadata.xml");
  });

  it("parseAuthnRequestFromQuery throws when SAMLRequest is missing", () => {
    expect(() => parseAuthnRequestFromQuery({})).toThrow("SAMLRequest is required");
  });
});

describe("createIdpInitiatedResponse with inResponseTo (SP-initiated)", () => {
  it("produces response with InResponseTo accepted by SP validation", async () => {
    const spConfig: SpInitiatedSpConfig = {
      entityId: "https://sp.example.com/metadata.xml",
      privateKey: TEST_SP_KEY,
      certificate: TEST_CERT,
      assertEndpoint: "https://sp.example.com/assert",
      allowUnencryptedAssertion: true,
    };
    const idpConfig: SpInitiatedIdpConfig = {
      ssoLoginUrl: "https://idp.example.com/sso/login",
      ssoLogoutUrl: "https://idp.example.com/slo",
      certificates: TEST_CERT,
    };
    const { loginUrl, requestId } = await createSpInitiatedLoginRequestUrl(spConfig, idpConfig, { relayState: "/app" });
    const samlRequest = new URL(loginUrl).searchParams.get("SAMLRequest");
    const parsed = parseAuthnRequest(samlRequest!);
    expect(parsed.assertionConsumerServiceURL).toBe("https://sp.example.com/assert");

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
      { nameId: "user@example.com" },
      { inResponseTo: requestId, relayState: "/app" }
    );
    const validated = await validateSpInitiatedPostResponse(spConfig, idpConfig, {
      SAMLResponse: idpResponse.samlResponseBase64,
      RelayState: "/app",
    });
    expect(validated.nameId).toBe("user@example.com");
    expect(validated.inResponseTo).toBe(requestId);
  });
});
