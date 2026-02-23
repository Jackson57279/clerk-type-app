import { createRequire } from "module";
import crypto from "crypto";
import zlib from "zlib";

const require = createRequire(import.meta.url);
const { SignedXml } = require("xml-crypto") as { SignedXml: new (options?: { privateKey?: string; signatureAlgorithm?: string; canonicalizationAlgorithm?: string }) => SignedXmlInstance };
const { DOMParser } = require("@xmldom/xmldom") as { DOMParser: new () => { parseFromString(xml: string): Document } };

interface SignedXmlInstance {
  addReference(opts: { xpath: string; transforms?: string[]; digestAlgorithm?: string }): void;
  computeSignature(xml: string, options?: { prefix?: string; location?: { reference: string; action: string }; existingPrefixes?: Record<string, string> }): void;
  getSignedXml(): string;
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

export interface IdpLogoutConfig {
  entityId: string;
  privateKey: string;
  certificate: string;
}

export interface ParsedLogoutRequest {
  requestId: string | undefined;
  issuer: string | undefined;
  nameId: string | undefined;
  sessionIndex: string | undefined;
}

export function parseLogoutRequest(samlRequestBase64: string): ParsedLogoutRequest {
  const raw = Buffer.from(samlRequestBase64, "base64");
  let xml: string;
  try {
    xml = zlib.inflateRawSync(raw).toString("utf8");
  } catch {
    xml = raw.toString("utf8");
  }
  const dom = new DOMParser().parseFromString(xml);
  const logoutRequest = dom.getElementsByTagNameNS(XMLNS_SAMLP, "LogoutRequest");
  if (!logoutRequest.length) throw new Error("Expected LogoutRequest; not found");
  const requestEl = logoutRequest[0] as Element;
  const issuerEl = dom.getElementsByTagNameNS(XMLNS_SAML, "Issuer");
  const nameIdEl = dom.getElementsByTagNameNS(XMLNS_SAML, "NameID");
  const sessionIndexEl = dom.getElementsByTagNameNS(XMLNS_SAMLP, "SessionIndex");
  return {
    requestId: requestEl.getAttribute("ID") ?? undefined,
    issuer: issuerEl[0]?.firstChild?.nodeValue?.trim(),
    nameId: nameIdEl[0]?.firstChild?.nodeValue?.trim(),
    sessionIndex: sessionIndexEl[0]?.firstChild?.nodeValue?.trim(),
  };
}

export interface CreateLogoutResponseOptions {
  inResponseTo: string;
  status?: string;
}

export interface LogoutResponseResult {
  samlResponseBase64: string;
  destination: string;
}

export function createLogoutResponse(
  idpConfig: IdpLogoutConfig,
  destination: string,
  options: CreateLogoutResponseOptions
): LogoutResponseResult {
  const status = options.status ?? "urn:oasis:names:tc:SAML:2.0:status:Success";
  const responseId = randomId();
  const issueInstant = new Date().toISOString();
  const logoutResponseXml = `<?xml version="1.0" encoding="UTF-8"?><samlp:LogoutResponse xmlns:samlp="${XMLNS_SAMLP}" xmlns:saml="${XMLNS_SAML}" ID="${responseId}" Version="2.0" IssueInstant="${escapeXml(issueInstant)}" Destination="${escapeXml(destination)}" InResponseTo="${escapeXml(options.inResponseTo)}">
  <saml:Issuer>${escapeXml(idpConfig.entityId)}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="${escapeXml(status)}"/>
  </samlp:Status>
</samlp:LogoutResponse>`;

  const privateKeyPem = formatPem(idpConfig.privateKey, "PRIVATE KEY");
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "//*[local-name(.)='LogoutResponse']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(logoutResponseXml, {
    location: { reference: "//*[local-name(.)='LogoutResponse']", action: "append" },
  });
  const signedXml = signer.getSignedXml();
  const deflated = zlib.deflateRawSync(Buffer.from(signedXml, "utf8"));
  const samlResponseBase64 = deflated.toString("base64");
  return { samlResponseBase64, destination };
}

export interface CreateLogoutRequestOptions {
  nameId: string;
  sessionIndex?: string;
}

export interface LogoutRequestResult {
  samlRequestBase64: string;
  destination: string;
}

export function createLogoutRequest(
  idpConfig: IdpLogoutConfig,
  spLogoutUrl: string,
  options: CreateLogoutRequestOptions
): LogoutRequestResult {
  const requestId = randomId();
  const issueInstant = new Date().toISOString();
  const sessionIndexMarkup = options.sessionIndex != null
    ? `<samlp:SessionIndex>${escapeXml(options.sessionIndex)}</samlp:SessionIndex>`
    : "";
  const logoutRequestXml = `<?xml version="1.0" encoding="UTF-8"?><samlp:LogoutRequest xmlns:samlp="${XMLNS_SAMLP}" xmlns:saml="${XMLNS_SAML}" ID="${requestId}" Version="2.0" IssueInstant="${escapeXml(issueInstant)}" Destination="${escapeXml(spLogoutUrl)}">
  <saml:Issuer>${escapeXml(idpConfig.entityId)}</saml:Issuer>
  <saml:NameID>${escapeXml(options.nameId)}</saml:NameID>
  ${sessionIndexMarkup}
</samlp:LogoutRequest>`;

  const privateKeyPem = formatPem(idpConfig.privateKey, "PRIVATE KEY");
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "//*[local-name(.)='LogoutRequest']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  signer.computeSignature(logoutRequestXml, {
    location: { reference: "//*[local-name(.)='LogoutRequest']", action: "append" },
  });
  const signedXml = signer.getSignedXml();
  const deflated = zlib.deflateRawSync(Buffer.from(signedXml, "utf8"));
  const samlRequestBase64 = deflated.toString("base64");
  return { samlRequestBase64, destination: spLogoutUrl };
}

export interface HandleSpInitiatedLogoutOptions {
  samlRequestBase64: string;
  relayState?: string;
  idpConfig: IdpLogoutConfig;
  getSpLogoutUrl: (issuer: string) => string | null;
  invalidateSession: (params: { nameId: string; sessionIndex?: string }) => void | Promise<void>;
}

export interface HandleSpInitiatedLogoutResult {
  redirectUrl: string;
}

export async function handleSpInitiatedLogout(
  options: HandleSpInitiatedLogoutOptions
): Promise<HandleSpInitiatedLogoutResult> {
  const parsed = parseLogoutRequest(options.samlRequestBase64);
  const inResponseTo = parsed.requestId ?? "";
  const destination = parsed.issuer ? options.getSpLogoutUrl(parsed.issuer) : null;
  if (!destination) {
    throw new Error("Unknown or unsupported SP issuer for SLO");
  }
  await Promise.resolve(options.invalidateSession({
    nameId: parsed.nameId ?? "",
    sessionIndex: parsed.sessionIndex,
  }));
  const { samlResponseBase64 } = createLogoutResponse(options.idpConfig, destination, {
    inResponseTo,
  });
  const redirectUrl = `${destination}?SAMLResponse=${encodeURIComponent(samlResponseBase64)}${options.relayState != null && options.relayState !== "" ? "&RelayState=" + encodeURIComponent(options.relayState) : ""}`;
  return { redirectUrl };
}
