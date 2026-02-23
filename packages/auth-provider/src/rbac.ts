import type { MemberRole } from "./member-approval.js";

export const PERMISSION_ORG_READ = "org:read";
export const PERMISSION_ORG_WRITE = "org:write";
export const PERMISSION_ORG_DELETE = "org:delete";
export const PERMISSION_ORG_BILLING = "org:billing";
export const PERMISSION_MEMBERS_READ = "members:read";
export const PERMISSION_MEMBERS_WRITE = "members:write";
export const PERMISSION_SETTINGS_READ = "settings:read";
export const PERMISSION_SETTINGS_WRITE = "settings:write";
export const PERMISSION_SSO_MANAGE = "sso:manage";
export const PERMISSION_CONTENT_READ = "content:read";
export const PERMISSION_CONTENT_WRITE = "content:write";

export const ALL_PERMISSIONS = [
  PERMISSION_ORG_READ,
  PERMISSION_ORG_WRITE,
  PERMISSION_ORG_DELETE,
  PERMISSION_ORG_BILLING,
  PERMISSION_MEMBERS_READ,
  PERMISSION_MEMBERS_WRITE,
  PERMISSION_SETTINGS_READ,
  PERMISSION_SETTINGS_WRITE,
  PERMISSION_SSO_MANAGE,
  PERMISSION_CONTENT_READ,
  PERMISSION_CONTENT_WRITE,
] as const;

const ROLE_PERMISSIONS: Record<MemberRole, readonly string[]> = {
  owner: [...ALL_PERMISSIONS],
  admin: [
    PERMISSION_ORG_READ,
    PERMISSION_ORG_WRITE,
    PERMISSION_MEMBERS_READ,
    PERMISSION_MEMBERS_WRITE,
    PERMISSION_SETTINGS_READ,
    PERMISSION_SETTINGS_WRITE,
    PERMISSION_SSO_MANAGE,
    PERMISSION_CONTENT_READ,
    PERMISSION_CONTENT_WRITE,
  ],
  editor: [
    PERMISSION_ORG_READ,
    PERMISSION_MEMBERS_READ,
    PERMISSION_CONTENT_READ,
    PERMISSION_CONTENT_WRITE,
  ],
  member: [PERMISSION_ORG_READ, PERMISSION_CONTENT_READ],
  guest: [PERMISSION_CONTENT_READ],
};

export interface MembershipLike {
  role: MemberRole;
  permissions: string[];
}

export function getDefaultPermissionsForRole(role: MemberRole): string[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function getEffectivePermissions(membership: MembershipLike): string[] {
  const fromRole = getDefaultPermissionsForRole(membership.role);
  const custom = membership.permissions ?? [];
  const set = new Set<string>([...fromRole, ...custom]);
  return Array.from(set);
}

export function hasPermission(
  membership: MembershipLike,
  permission: string
): boolean {
  const effective = getEffectivePermissions(membership);
  return effective.includes(permission);
}

export function requirePermission(
  membership: MembershipLike,
  permission: string
): void {
  if (!hasPermission(membership, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}
