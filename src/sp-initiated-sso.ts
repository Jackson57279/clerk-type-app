import { createRequire } from "module";
import zlib from "zlib";
import { DOMParser } from "@xmldom/xmldom";

const require = createRequire(import.meta.url);
const saml2 = require("saml2-js") as {
  ServiceProvider: new (opts: SpOptions) => ServiceProviderInstance;
  IdentityProvider: new (opts: IdpOptions) => IdpInstance;
};

const XMLNS_SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";

interface SpOptions {
  entity_id: string;
  private_key: string;
  certificate: string;
  assert_endpoint: string;
  force_authn?: boolean;
  nameid_format?: string;
  allow_unencrypted_assertion?: boolean;
  notbefore_skew?: number;
}

interface IdpOptions {
  sso_login_url: string;
  sso_logout_url: string;
  certificates: string | string[];
  force_authn?: boolean;
  allow_unencrypted_assertion?: boolean;
}

interface ServiceProviderInstance {
  create_login_request_url(
    idp: IdpInstance,
    options: { relay_state?: string },
    cb: (err: Error | null, loginUrl: string, requestId: string) => void
  ): void;
  create_authn_request_xml(idp: IdpInstance, options?: { relay_state?: string }): string;
  create_logout_request_url(
    idp: IdpInstance,
    options: { name_id: string; session_index?: string; relay_state?: string },
    cb: (err: Error | null, logoutUrl: string, requestId: string) => void
  ): void;
  post_assert(
    idp: IdpInstance,
    options: { request_body: { SAMLResponse?: string; SAMLRequest?: string; RelayState?: string }; require_session_index?: boolean },
    cb: (err: Error | null, response: SamlAssertResponse | SamlLogoutResponse) => void
  ): void;
}

interface IdpInstance {
  sso_login_url: string;
  sso_logout_url: string;
  certificates: string | string[];
}

interface SamlAssertResponse {
  response_header: { id: string; destination: string; in_response_to: string };
  type: string;
  user: {
    name_id: string;
    session_index: string | undefined;
    attributes: Record<string, string[]>;
  };
}

interface SamlLogoutResponse {
  response_header: { id: string; destination: string; in_response_to: string };
  type: "logout_response";
}

export interface SpInitiatedSpConfig {
  entityId: string;
  privateKey: string;
  certificate: string;
  assertEndpoint: string;
  forceAuthn?: boolean;
  nameIdFormat?: string;
  allowUnencryptedAssertion?: boolean;
  notBeforeSkewSeconds?: number;
}

export interface SpInitiatedIdpConfig {
  ssoLoginUrl: string;
  ssoLogoutUrl: string;
  certificates: string | string[];
  forceAuthn?: boolean;
  allowUnencryptedAssertion?: boolean;
}

export interface SpInitiatedLoginResult {
  loginUrl: string;
  requestId: string;
}

export interface SpInitiatedAssertionResult {
  nameId: string;
  sessionIndex: string | undefined;
  attributes: Record<string, string[]>;
  inResponseTo: string;
  relayState: string | undefined;
}

function toSpOptions(c: SpInitiatedSpConfig): SpOptions {
  return {
    entity_id: c.entityId,
    private_key: c.privateKey,
    certificate: c.certificate,
    assert_endpoint: c.assertEndpoint,
    force_authn: c.forceAuthn,
    nameid_format: c.nameIdFormat,
    allow_unencrypted_assertion: c.allowUnencryptedAssertion,
    notbefore_skew: c.notBeforeSkewSeconds ?? 1,
  };
}

function toIdpOptions(c: SpInitiatedIdpConfig): IdpOptions {
  return {
    sso_login_url: c.ssoLoginUrl,
    sso_logout_url: c.ssoLogoutUrl,
    certificates: c.certificates,
    force_authn: c.forceAuthn,
    allow_unencrypted_assertion: c.allowUnencryptedAssertion,
  };
}

function extractAuthnRequestId(signedAuthnRequestXml: string): string {
  const dom = new DOMParser().parseFromString(signedAuthnRequestXml, "text/xml");
  const authnRequest = dom.getElementsByTagNameNS(XMLNS_SAMLP, "AuthnRequest")[0];
  if (!authnRequest) throw new Error("AuthnRequest element not found");
  const id = authnRequest.getAttribute("ID");
  if (!id) throw new Error("AuthnRequest ID attribute not found");
  return id;
}

export interface CreateSpInitiatedLoginRequestUrlOptions {
  relayState?: string;
  signAuthnRequest?: boolean;
}

export function createSpInitiatedLoginRequestUrl(
  spConfig: SpInitiatedSpConfig,
  idpConfig: SpInitiatedIdpConfig,
  options: CreateSpInitiatedLoginRequestUrlOptions = {}
): Promise<SpInitiatedLoginResult> {
  const signAuthnRequest = options.signAuthnRequest !== false;
  const sp = new saml2.ServiceProvider(toSpOptions(spConfig));
  const idp = new saml2.IdentityProvider(toIdpOptions(idpConfig));

  if (signAuthnRequest) {
    const signedXml = sp.create_authn_request_xml(idp, {
      relay_state: options.relayState,
    });
    const requestId = extractAuthnRequestId(signedXml);
    const deflated = zlib.deflateRawSync(Buffer.from(signedXml, "utf8"));
    const samlRequestBase64 = deflated.toString("base64");
    const url = new URL(idpConfig.ssoLoginUrl);
    url.searchParams.set("SAMLRequest", samlRequestBase64);
    if (options.relayState !== undefined) {
      url.searchParams.set("RelayState", options.relayState);
    }
    return Promise.resolve({
      loginUrl: url.toString(),
      requestId,
    });
  }

  return new Promise((resolve, reject) => {
    sp.create_login_request_url(
      idp,
      { relay_state: options.relayState },
      (err: Error | null, loginUrl: string, requestId: string) => {
        if (err) reject(err);
        else resolve({ loginUrl, requestId });
      }
    );
  });
}

export interface ValidateSpInitiatedPostResponseOptions {
  requireSessionIndex?: boolean;
}

export function validateSpInitiatedPostResponse(
  spConfig: SpInitiatedSpConfig,
  idpConfig: SpInitiatedIdpConfig,
  requestBody: { SAMLResponse: string; RelayState?: string },
  options: ValidateSpInitiatedPostResponseOptions = {}
): Promise<SpInitiatedAssertionResult> {
  const sp = new saml2.ServiceProvider(toSpOptions(spConfig));
  const idp = new saml2.IdentityProvider(toIdpOptions(idpConfig));
  return new Promise((resolve, reject) => {
    sp.post_assert(
      idp,
      {
        request_body: requestBody,
        require_session_index: options.requireSessionIndex ?? true,
      },
      (err: Error | null, response: SamlAssertResponse | SamlLogoutResponse) => {
        if (err) reject(err);
        else if (response.type !== "authn_response" || !response.user) reject(new Error("Invalid SAML response: no user"));
        else
          resolve({
            nameId: response.user.name_id,
            sessionIndex: response.user.session_index,
            attributes: response.user.attributes ?? {},
            inResponseTo: response.response_header?.in_response_to ?? "",
            relayState: requestBody.RelayState,
          });
      }
    );
  });
}

export interface SpInitiatedLogoutRequestOptions {
  nameId: string;
  sessionIndex?: string;
  relayState?: string;
}

export interface SpInitiatedLogoutResult {
  logoutUrl: string;
  requestId: string;
}

export function createSpInitiatedLogoutRequestUrl(
  spConfig: SpInitiatedSpConfig,
  idpConfig: SpInitiatedIdpConfig,
  options: SpInitiatedLogoutRequestOptions
): Promise<SpInitiatedLogoutResult> {
  const sp = new saml2.ServiceProvider(toSpOptions(spConfig));
  const idp = new saml2.IdentityProvider(toIdpOptions(idpConfig));
  return new Promise((resolve, reject) => {
    sp.create_logout_request_url(
      idp,
      {
        name_id: options.nameId,
        session_index: options.sessionIndex ?? "",
        relay_state: options.relayState,
      },
      (err: Error | null, logoutUrl: string, requestId: string) => {
        if (err) reject(err);
        else resolve({ logoutUrl, requestId });
      }
    );
  });
}

export interface SpInitiatedLogoutResponseResult {
  inResponseTo: string;
  relayState: string | undefined;
}

export function validateSpInitiatedLogoutResponse(
  spConfig: SpInitiatedSpConfig,
  idpConfig: SpInitiatedIdpConfig,
  requestBody: { SAMLResponse: string; RelayState?: string }
): Promise<SpInitiatedLogoutResponseResult> {
  const sp = new saml2.ServiceProvider(toSpOptions(spConfig));
  const idp = new saml2.IdentityProvider(toIdpOptions(idpConfig));
  return new Promise((resolve, reject) => {
    sp.post_assert(
      idp,
      { request_body: requestBody },
      (err: Error | null, response: SamlAssertResponse | SamlLogoutResponse) => {
        if (err) reject(err);
        else if (response.type !== "logout_response") reject(new Error("Invalid SAML response: expected LogoutResponse"));
        else
          resolve({
            inResponseTo: response.response_header?.in_response_to ?? "",
            relayState: requestBody.RelayState,
          });
      }
    );
  });
}
