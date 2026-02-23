import {
  applyAttributeMapping,
  type AttributeMappingConfig,
  type MappedClaims,
} from "./attribute-mapping.js";
import type { SpInitiatedAssertionResult } from "./sp-initiated-sso.js";

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
  const { organizationId, jitEnabled = true } = options;
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
