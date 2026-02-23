export interface AttributeMappingConfig {
  emailAttribute?: string;
  nameAttribute?: string;
  givenNameAttribute?: string;
  surnameAttribute?: string;
  groupsAttribute?: string;
  rolesAttribute?: string;
}

export const DEFAULT_ATTRIBUTE_MAPPING: AttributeMappingConfig = {
  emailAttribute: "email",
  nameAttribute: "name",
  givenNameAttribute: "givenName",
  surnameAttribute: "surname",
  groupsAttribute: "groups",
  rolesAttribute: "roles",
};

export interface MappedClaims {
  email: string | undefined;
  name: string | undefined;
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

export function applyAttributeMapping(
  attributes: Record<string, string[]>,
  config: AttributeMappingConfig
): MappedClaims {
  const email = config.emailAttribute
    ? firstValue(attributes, config.emailAttribute)
    : undefined;
  const name = config.nameAttribute ? firstValue(attributes, config.nameAttribute) : undefined;
  const firstName = config.givenNameAttribute
    ? firstValue(attributes, config.givenNameAttribute)
    : undefined;
  const lastName = config.surnameAttribute
    ? firstValue(attributes, config.surnameAttribute)
    : undefined;
  const groups = config.groupsAttribute
    ? allValues(attributes, config.groupsAttribute)
    : [];
  const roles = config.rolesAttribute ? allValues(attributes, config.rolesAttribute) : [];
  return { email, name, firstName, lastName, groups, roles };
}

export interface ScimUserAttributeMappingConfig {
  emailPath?: string;
  namePath?: string;
  givenNamePath?: string;
  familyNamePath?: string;
  externalIdPath?: string;
  activePath?: string;
}

export const DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING: Required<ScimUserAttributeMappingConfig> = {
  emailPath: "emails",
  namePath: "name.formatted",
  givenNamePath: "name.givenName",
  familyNamePath: "name.familyName",
  externalIdPath: "externalId",
  activePath: "active",
};

export interface ScimUserAttributes {
  userName?: string;
  emails?: Array<{ value: string; primary?: boolean }>;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  externalId?: string;
  active?: boolean;
}

export interface ScimMappedProvisionData {
  email: string;
  externalId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(/\.|\[|\]/).filter(Boolean);
  let current: unknown = obj;
  for (const p of parts) {
    if (current == null || typeof current !== "object") return undefined;
    const key = p.match(/^\d+$/) ? parseInt(p, 10) : p;
    current = (current as Record<string, unknown>)[key as string];
  }
  return current;
}

function stringOrUndefined(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

export function mapScimUserToProvisionData(
  scimUser: ScimUserAttributes,
  config: Partial<ScimUserAttributeMappingConfig> = {}
): ScimMappedProvisionData {
  const c = { ...DEFAULT_SCIM_USER_ATTRIBUTE_MAPPING, ...config };
  const obj = scimUser as unknown as Record<string, unknown>;

  let email: string;
  if (c.emailPath === "emails") {
    const arr = scimUser.emails;
    const primary = arr?.find((e) => e.primary);
    const first = arr?.[0]?.value;
    email = primary?.value ?? first ?? scimUser.userName ?? "";
  } else {
    const v = getByPath(obj, c.emailPath);
    email = typeof v === "string" ? v.trim() : (scimUser.userName ?? "");
  }
  if (!email && scimUser.userName) email = scimUser.userName;

  const nameVal = stringOrUndefined(getByPath(obj, c.namePath));
  const givenName = stringOrUndefined(getByPath(obj, c.givenNamePath));
  const familyName = stringOrUndefined(getByPath(obj, c.familyNamePath));
  const name = nameVal ?? ([givenName, familyName].filter(Boolean).join(" ").trim() || undefined);
  const externalId = stringOrUndefined(getByPath(obj, c.externalIdPath));
  const activeVal = c.activePath ? getByPath(obj, c.activePath) : scimUser.active;
  const active = activeVal !== undefined && activeVal !== null ? Boolean(activeVal) : true;

  return {
    email,
    externalId: externalId ?? undefined,
    name: name ?? undefined,
    firstName: givenName ?? undefined,
    lastName: familyName ?? undefined,
    active,
  };
}
