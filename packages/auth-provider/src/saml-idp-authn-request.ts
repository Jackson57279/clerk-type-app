import zlib from "zlib";
import { DOMParser } from "@xmldom/xmldom";

const XMLNS_SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";
const XMLNS_SAML = "urn:oasis:names:tc:SAML:2.0:assertion";

export interface ParsedAuthnRequest {
  id: string | undefined;
  issuer: string | undefined;
  assertionConsumerServiceURL: string | undefined;
  relayState: string | undefined;
  forceAuthn: boolean;
  nameIdPolicyFormat: string | undefined;
}

export function parseAuthnRequest(samlRequestBase64: string): ParsedAuthnRequest {
  const raw = Buffer.from(samlRequestBase64, "base64");
  let xml: string;
  try {
    xml = zlib.inflateRawSync(raw).toString("utf8");
  } catch {
    xml = raw.toString("utf8");
  }
  const dom = new DOMParser().parseFromString(xml, "text/xml");
  const authnRequestList = dom.getElementsByTagNameNS(XMLNS_SAMLP, "AuthnRequest");
  if (!authnRequestList.length) {
    throw new Error("Expected AuthnRequest; not found");
  }
  const requestEl = authnRequestList[0] as Element;
  const issuerEl = dom.getElementsByTagNameNS(XMLNS_SAML, "Issuer");
  const nameIdPolicyEl = dom.getElementsByTagNameNS(XMLNS_SAMLP, "NameIDPolicy");
  const acsUrl = requestEl.getAttribute("AssertionConsumerServiceURL");
  const forceAuthn = requestEl.getAttribute("ForceAuthn") === "true" || requestEl.getAttribute("ForceAuthn") === "1";
  let nameIdPolicyFormat: string | undefined;
  if (nameIdPolicyEl[0]) {
    nameIdPolicyFormat = (nameIdPolicyEl[0] as Element).getAttribute("Format") ?? undefined;
  }
  return {
    id: requestEl.getAttribute("ID") ?? undefined,
    issuer: issuerEl[0]?.firstChild?.nodeValue?.trim(),
    assertionConsumerServiceURL: acsUrl ?? undefined,
    relayState: undefined,
    forceAuthn,
    nameIdPolicyFormat,
  };
}

export function parseAuthnRequestFromQuery(query: { SAMLRequest?: string; RelayState?: string }): ParsedAuthnRequest {
  const samlRequest = query.SAMLRequest;
  if (!samlRequest) {
    throw new Error("SAMLRequest is required");
  }
  const parsed = parseAuthnRequest(samlRequest);
  parsed.relayState = query.RelayState;
  return parsed;
}
