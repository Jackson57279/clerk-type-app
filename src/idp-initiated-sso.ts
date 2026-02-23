import { createRequire } from "module";
import crypto from "crypto";

const require = createRequire(import.meta.url);
const { SignedXml } = require("xml-crypto") as { SignedXml: new (options?: { privateKey?: string; signatureAlgorithm?: string; canonicalizationAlgorithm?: string }) => SignedXmlInstance };

interface SignedXmlInstance {
  addReference(opts: { xpath: string; transforms?: string[]; digestAlgorithm?: string }): void;
  computeSignature(xml: string, options?: { prefix?: string; location?: { reference: string; action: string }; existingPrefixes?: Record<string, string> }): void;
  getSignedXml(): string;
  privateKey?: string;
  signatureAlgorithm?: string;
  canonicalizationAlgorithm?: string;
}

const XMLNS_SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";
const XMLNS_SAML = "urn:oasis:names:tc:SAML:2.0:assertion";

function formatPem(key: string, type: string): string {
  if (/-----BEGIN [0-9A-Z ]+-----[^-]*-----END [0-9A-Z ]+-----/g.exec(key)) {
    return key;
  }
  const trimmed = key.replace(/\s/g, "");
  const lines = trimmed.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${type.toUpperCase()}-----\n${lines.join("\n")}\n-----END ${type.toUpperCase()}-----`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function randomId(): string {
  return "_" + crypto.randomBytes(21).toString("hex");
}

export interface IdpInitiatedIdpConfig {
  entityId: string;
  privateKey: string;
  certificate: string;
  nameIdFormat?: string;
}

export interface IdpInitiatedSpConfig {
  entityId: string;
  assertEndpoint: string;
}

export interface IdpInitiatedUser {
  nameId: string;
  sessionIndex?: string;
  attributes?: Record<string, string[]>;
}

export interface CreateIdpInitiatedResponseOptions {
  relayState?: string;
  notBeforeSkewSeconds?: number;
  notOnOrAfterSeconds?: number;
  sessionNotOnOrAfterSeconds?: number;
}

export interface IdpInitiatedResponseResult {
  samlResponseBase64: string;
  destination: string;
  relayState: string | undefined;
}

export function createIdpInitiatedResponse(
  idpConfig: IdpInitiatedIdpConfig,
  spConfig: IdpInitiatedSpConfig,
  user: IdpInitiatedUser,
  options: CreateIdpInitiatedResponseOptions = {}
): IdpInitiatedResponseResult {
  const now = new Date();
  const skew = (options.notBeforeSkewSeconds ?? 60) * 1000;
  const validity = (options.notOnOrAfterSeconds ?? 300) * 1000;
  const sessionValidity = (options.sessionNotOnOrAfterSeconds ?? 3600) * 1000;

  const notBefore = new Date(now.getTime() - skew).toISOString();
  const notOnOrAfter = new Date(now.getTime() + validity).toISOString();
  const authnInstant = now.toISOString();
  const sessionNotOnOrAfter = new Date(now.getTime() + sessionValidity).toISOString();
  const responseId = randomId();
  const assertionId = randomId();
  const sessionIndex = user.sessionIndex ?? randomId();

  const nameIdFormat = idpConfig.nameIdFormat ?? "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified";

  const attributeMarkup =
    user.attributes && Object.keys(user.attributes).length > 0
      ? `<saml:AttributeStatement xmlns:saml="${XMLNS_SAML}">${Object.entries(user.attributes)
          .map(
            ([name, values]) =>
              `<saml:Attribute Name="${escapeXml(name)}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">${(values ?? []).map((v) => `<saml:AttributeValue xmlns:saml="${XMLNS_SAML}">${escapeXml(v)}</saml:AttributeValue>`).join("")}</saml:Attribute>`
          )
          .join("")}</saml:AttributeStatement>`
      : "";

  const assertionXml = `<saml:Assertion xmlns:saml="${XMLNS_SAML}" ID="${assertionId}" IssueInstant="${authnInstant}" Version="2.0">
  <saml:Issuer>${escapeXml(idpConfig.entityId)}</saml:Issuer>
  <saml:Subject>
    <saml:NameID Format="${escapeXml(nameIdFormat)}">${escapeXml(user.nameId)}</saml:NameID>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${escapeXml(spConfig.assertEndpoint)}"/>
    </saml:SubjectConfirmation>
  </saml:Subject>
  <saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">
    <saml:AudienceRestriction>
      <saml:Audience>${escapeXml(spConfig.entityId)}</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AuthnStatement AuthnInstant="${authnInstant}" SessionIndex="${escapeXml(sessionIndex)}" SessionNotOnOrAfter="${sessionNotOnOrAfter}">
    <saml:AuthnContext>
      <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
    </saml:AuthnContext>
  </saml:AuthnStatement>
  ${attributeMarkup}
</saml:Assertion>`;

  const responseWithoutSignedAssertion = `<?xml version="1.0" encoding="UTF-8"?><samlp:Response xmlns:samlp="${XMLNS_SAMLP}" xmlns:saml="${XMLNS_SAML}" ID="${responseId}" Version="2.0" IssueInstant="${authnInstant}" Destination="${escapeXml(spConfig.assertEndpoint)}">
  <saml:Issuer>${escapeXml(idpConfig.entityId)}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  ${assertionXml}
</samlp:Response>`;

  const privateKeyPem = formatPem(idpConfig.privateKey, "PRIVATE KEY");
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(responseWithoutSignedAssertion, {
    location: { reference: "//*[local-name(.)='Assertion']", action: "append" },
  });

  const signedXml = signer.getSignedXml();
  const samlResponseBase64 = Buffer.from(signedXml, "utf8").toString("base64");

  return {
    samlResponseBase64,
    destination: spConfig.assertEndpoint,
    relayState: options.relayState,
  };
}
