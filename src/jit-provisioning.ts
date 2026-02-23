import type { SpInitiatedAssertionResult } from "./sp-initiated-sso.js";

export interface JitAttributeMapping {
  emailAttribute?: string;
  givenNameAttribute?: string;
  surnameAttribute?: string;
  groupsAttribute?: string;
  rolesAttribute?: string;
}

export interface JitMappedClaims {
  email: string | undefined;
  firstName: string | undefined;
  lastName: string | undefined;
  groups: string[];
  roles: string[];
}

function firstValue(attributes: Record<string, string[]>, name: string): string | undefined {
  const values = attributes[name];
  if (!values || values.length === 0) return undefined;
  const v = values[0]?.trim();
  return v === "" ? undefined : v;
}

function allValues(attributes: Record<string, string[]>, name: string): string[] {
  const values = attributes[name];
  if (!values) return [];
  return values.map((v) => v?.trim()).filter((v): v is string => Boolean(v));
}

export function extractMappedClaims(
  assertion: SpInitiatedAssertionResult,
  mapping: JitAttributeMapping
): JitMappedClaims {
  const attrs = assertion.attributes ?? {};
  const email = mapping.emailAttribute
    ? firstValue(attrs, mapping.emailAttribute)
    : undefined;
  const firstName = mapping.givenNameAttribute
    ? firstValue(attrs, mapping.givenNameAttribute)
    : undefined;
  const lastName = mapping.surnameAttribute
    ? firstValue(attrs, mapping.surnameAttribute)
    : undefined;
  const groups = mapping.groupsAttribute
    ? allValues(attrs, mapping.groupsAttribute)
    : [];
  const roles = mapping.rolesAttribute
    ? allValues(attrs, mapping.rolesAttribute)
    : [];
  return { email, firstName, lastName, groups, roles };
}

export interface JitProvisionUserData {
  samlNameId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  groups?: string[];
  roles?: string[];
}

export interface JitUser {
  id: string;
  email: string;
  samlNameId?: string;
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
    firstName: claims.firstName,
    lastName: claims.lastName,
    groups: claims.groups.length > 0 ? claims.groups : undefined,
    roles: claims.roles.length > 0 ? claims.roles : undefined,
  });
  return { user, created: true };
}
