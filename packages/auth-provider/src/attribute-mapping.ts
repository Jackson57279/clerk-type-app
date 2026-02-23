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
