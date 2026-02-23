import {
  applyAttributeMapping,
  type AttributeMappingConfig,
  type MappedClaims,
} from "./attribute-mapping.js";
import { createDefaultEmailDomainChecker } from "./email-domain-restriction.js";
import {
  validateSpInitiatedPostResponse,
  type SpInitiatedAssertionResult,
  type SpInitiatedIdpConfig,
  type SpInitiatedSpConfig,
} from "./sp-initiated-sso.js";

export type JitAttributeMapping = AttributeMappingConfig;
export type JitMappedClaims = MappedClaims;

export function extractMappedClaims(
  assertion: SpInitiatedAssertionResult,
  mapping: JitAttributeMapping
): JitMappedClaims {
  return applyAttributeMapping(assertion.attributes ?? {}, mapping);
}

export interface JitProvisionUserData {
  samlNameId: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  groups?: string[];
  roles?: string[];
}

export interface JitUser {
  id: string;
  email: string;
  samlNameId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  groups?: string[];
  roles?: string[];
}

export interface JitUserStore {
  findBySamlNameId(organizationId: string, nameId: string): Promise<JitUser | null>;
  findByEmail(organizationId: string, email: string): Promise<JitUser | null>;
  createUser(organizationId: string, data: JitProvisionUserData): Promise<JitUser>;
}

export interface JitProvisioningOptions {
  organizationId: string;
  jitEnabled?: boolean;
  isAllowedEmail?: (email: string) => boolean;
}

export interface JitProvisioningResult {
  user: JitUser;
  created: boolean;
}

export async function getOrProvisionUser(
  assertion: SpInitiatedAssertionResult,
  mapping: JitAttributeMapping,
  store: JitUserStore,
  options: JitProvisioningOptions
): Promise<JitProvisioningResult> {
  const { organizationId, jitEnabled = true, isAllowedEmail: isAllowedEmailOpt } = options;
  const claims = extractMappedClaims(assertion, mapping);
  const email =
    claims.email ??
    (assertion.nameId.includes("@") ? assertion.nameId : undefined);

  let user = await store.findBySamlNameId(organizationId, assertion.nameId);
  if (user) return { user, created: false };

  if (email) {
    user = await store.findByEmail(organizationId, email);
    if (user) return { user, created: false };
  }

  if (!jitEnabled) {
    throw new Error("JIT provisioning is disabled and no matching user found");
  }

  if (!email) {
    throw new Error("Cannot JIT provision: no email in assertion and nameId not suitable as email");
  }

  const isAllowed = isAllowedEmailOpt ?? createDefaultEmailDomainChecker();
  if (!isAllowed(email)) {
    throw new Error("Email domain not allowed");
  }

  user = await store.createUser(organizationId, {
    samlNameId: assertion.nameId,
    email,
    name: claims.name,
    firstName: claims.firstName,
    lastName: claims.lastName,
    groups: claims.groups.length > 0 ? claims.groups : undefined,
    roles: claims.roles.length > 0 ? claims.roles : undefined,
  });
  return { user, created: true };
}

export interface HandleSpInitiatedAssertWithJitParams {
  SAMLResponse: string;
  RelayState?: string;
}

export interface HandleSpInitiatedAssertWithJitOptions {
  spConfig: SpInitiatedSpConfig;
  idpConfig: SpInitiatedIdpConfig;
  requireSessionIndex?: boolean;
  allowIdpInitiated?: boolean;
  mapping: JitAttributeMapping;
  store: JitUserStore;
  organizationId: string;
  jitEnabled?: boolean;
  isAllowedEmail?: (email: string) => boolean;
}

export interface HandleSpInitiatedAssertWithJitSuccess {
  status: 200;
  user: JitUser;
  created: boolean;
}

export interface HandleSpInitiatedAssertWithJitError {
  status: 400;
  error: string;
  errorDescription: string;
}

export type HandleSpInitiatedAssertWithJitResult =
  | HandleSpInitiatedAssertWithJitSuccess
  | HandleSpInitiatedAssertWithJitError;

export async function handleSpInitiatedAssertWithJit(
  params: HandleSpInitiatedAssertWithJitParams,
  options: HandleSpInitiatedAssertWithJitOptions
): Promise<HandleSpInitiatedAssertWithJitResult> {
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
  let assertion: SpInitiatedAssertionResult;
  try {
    assertion = await validateSpInitiatedPostResponse(
      options.spConfig,
      options.idpConfig,
      { SAMLResponse: samlResponse, RelayState: params.RelayState },
      { requireSessionIndex }
    );
  } catch (err) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: err instanceof Error ? err.message : "Invalid SAML response",
    };
  }
  try {
    const result = await getOrProvisionUser(
      assertion,
      options.mapping,
      options.store,
      {
        organizationId: options.organizationId,
        jitEnabled: options.jitEnabled,
        isAllowedEmail: options.isAllowedEmail,
      }
    );
    return { status: 200, user: result.user, created: result.created };
  } catch (err) {
    return {
      status: 400,
      error: "invalid_request",
      errorDescription: err instanceof Error ? err.message : "JIT provisioning failed",
    };
  }
}
