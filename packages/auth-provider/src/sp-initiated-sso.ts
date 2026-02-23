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

export interface ValidateIdpInitiatedPostResponseOptions {
  requireSessionIndex?: boolean;
}

export function validateIdpInitiatedPostResponse(
  spConfig: SpInitiatedSpConfig,
  idpConfig: SpInitiatedIdpConfig,
  requestBody: { SAMLResponse: string; RelayState?: string },
  options: ValidateIdpInitiatedPostResponseOptions = {}
): Promise<SpInitiatedAssertionResult> {
  return validateSpInitiatedPostResponse(spConfig, idpConfig, requestBody, {
    requireSessionIndex: options.requireSessionIndex ?? false,
  });
}

export function isIdpInitiatedAssertion(result: SpInitiatedAssertionResult): boolean {
  return result.inResponseTo === "";
}

export interface ValidateSamlAssertPostOptions {
  requireSessionIndex?: boolean;
}

export function validateSamlAssertPost(
  spConfig: SpInitiatedSpConfig,
  idpConfig: SpInitiatedIdpConfig,
  requestBody: { SAMLResponse: string; RelayState?: string },
  options: ValidateSamlAssertPostOptions = {}
): Promise<SpInitiatedAssertionResult> {
  return validateSpInitiatedPostResponse(spConfig, idpConfig, requestBody, {
    requireSessionIndex: options.requireSessionIndex ?? false,
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

export interface SpInitiatedLoginEndpointParams {
  relayState?: string;
}

export interface SpInitiatedLoginEndpointOptions {
  spConfig: SpInitiatedSpConfig;
  idpConfig: SpInitiatedIdpConfig;
  signAuthnRequest?: boolean;
}

export interface SpInitiatedLoginEndpointSuccess {
  status: 302;
  redirectUrl: string;
}

export interface SpInitiatedLoginEndpointError {
  status: 400;
  error: string;
  errorDescription: string;
}

export type SpInitiatedLoginEndpointResult =
  | SpInitiatedLoginEndpointSuccess
  | SpInitiatedLoginEndpointError;

export async function getSpInitiatedLoginRedirect(
  params: SpInitiatedLoginEndpointParams,
  options: SpInitiatedLoginEndpointOptions
): Promise<SpInitiatedLoginEndpointResult> {
  try {
    const { loginUrl } = await createSpInitiatedLoginRequestUrl(
      options.spConfig,
      options.idpConfig,
      {
        relayState: params.relayState,
        signAuthnRequest: options.signAuthnRequest,
      }
    );
    return { status: 302, redirectUrl: loginUrl };
  } catch (err) {
    return {
      status: 400,
      error: "saml_request_failed",
      errorDescription: err instanceof Error ? err.message : "Failed to create SAML login request",
    };
  }
}

export interface SpInitiatedAssertEndpointParams {
  SAMLResponse: string;
  RelayState?: string;
}

export interface SpInitiatedAssertEndpointOptions {
  spConfig: SpInitiatedSpConfig;
  idpConfig: SpInitiatedIdpConfig;
  requireSessionIndex?: boolean;
  allowIdpInitiated?: boolean;
}

export interface SpInitiatedAssertEndpointSuccess {
  status: 200;
  assertion: SpInitiatedAssertionResult;
}

export interface SpInitiatedAssertEndpointError {
  status: 400;
  error: string;
  errorDescription: string;
}

export type SpInitiatedAssertEndpointResult =
  | SpInitiatedAssertEndpointSuccess
  | SpInitiatedAssertEndpointError;

export async function handleSpInitiatedAssertEndpoint(
  params: SpInitiatedAssertEndpointParams,
  options: SpInitiatedAssertEndpointOptions
): Promise<SpInitiatedAssertEndpointResult> {
  const samlResponse = params.SAMLResponse?.trim();
  if (!samlResponse) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: "SAMLResponse is required",
    };
  }
  const requireSessionIndex = options.allowIdpInitiated
    ? false
    : (options.requireSessionIndex ?? true);
  try {
    const assertion = await validateSpInitiatedPostResponse(
      options.spConfig,
      options.idpConfig,
      { SAMLResponse: samlResponse, RelayState: params.RelayState },
      { requireSessionIndex }
    );
    return { status: 200, assertion };
  } catch (err) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: err instanceof Error ? err.message : "Invalid SAML response",
    };
  }
}

export interface IdpInitiatedAssertEndpointParams {
  SAMLResponse: string;
  RelayState?: string;
}

export interface IdpInitiatedAssertEndpointOptions {
  spConfig: SpInitiatedSpConfig;
  idpConfig: SpInitiatedIdpConfig;
  requireSessionIndex?: boolean;
}

export type IdpInitiatedAssertEndpointResult = SpInitiatedAssertEndpointResult;

export async function handleIdpInitiatedAssertEndpoint(
  params: IdpInitiatedAssertEndpointParams,
  options: IdpInitiatedAssertEndpointOptions
): Promise<IdpInitiatedAssertEndpointResult> {
  const samlResponse = params.SAMLResponse?.trim();
  if (!samlResponse) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: "SAMLResponse is required",
    };
  }
  try {
    const assertion = await validateIdpInitiatedPostResponse(
      options.spConfig,
      options.idpConfig,
      { SAMLResponse: samlResponse, RelayState: params.RelayState },
      { requireSessionIndex: options.requireSessionIndex ?? false }
    );
    return { status: 200, assertion };
  } catch (err) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: err instanceof Error ? err.message : "Invalid SAML response",
    };
  }
}

export interface SpInitiatedLogoutResponseEndpointParams {
  SAMLResponse: string;
  RelayState?: string;
}

export interface SpInitiatedLogoutResponseEndpointOptions {
  spConfig: SpInitiatedSpConfig;
  idpConfig: SpInitiatedIdpConfig;
  defaultRedirectUrl?: string;
}

export interface SpInitiatedLogoutResponseEndpointSuccess {
  status: 302;
  redirectUrl: string;
}

export interface SpInitiatedLogoutResponseEndpointError {
  status: 400;
  error: string;
  errorDescription: string;
}

export type SpInitiatedLogoutResponseEndpointResult =
  | SpInitiatedLogoutResponseEndpointSuccess
  | SpInitiatedLogoutResponseEndpointError;

export async function handleSpInitiatedLogoutResponseEndpoint(
  params: SpInitiatedLogoutResponseEndpointParams,
  options: SpInitiatedLogoutResponseEndpointOptions
): Promise<SpInitiatedLogoutResponseEndpointResult> {
  const samlResponse = params.SAMLResponse?.trim();
  if (!samlResponse) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: "SAMLResponse is required",
    };
  }
  try {
    await validateSpInitiatedLogoutResponse(
      options.spConfig,
      options.idpConfig,
      { SAMLResponse: samlResponse, RelayState: params.RelayState }
    );
    const redirectUrl =
      (params.RelayState != null && params.RelayState !== "")
        ? params.RelayState
        : (options.defaultRedirectUrl ?? "/");
    return { status: 302, redirectUrl };
  } catch (err) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: err instanceof Error ? err.message : "Invalid SAML logout response",
    };
  }
}
