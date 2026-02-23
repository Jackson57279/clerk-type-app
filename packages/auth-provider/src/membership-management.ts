import type { MemberRole, OrganizationMembership as ApprovalMembership } from "./member-approval.js";
import { assertOrganizationCanAddMember } from "./seat-management.js";
import type { Organization } from "./organization-crud.js";

export const MEMBERSHIP_ROLES: MemberRole[] = [
  "owner",
  "admin",
  "editor",
  "member",
  "guest",
];

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: MemberRole;
  permissions: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMembershipInput {
  userId: string;
  organizationId: string;
  role: MemberRole;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateMembershipInput {
  role?: MemberRole;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export interface MembershipStore {
  create(data: CreateMembershipInput): Promise<Membership>;
  getById(id: string): Promise<Membership | null>;
  getByUserAndOrg(userId: string, organizationId: string): Promise<Membership | null>;
  listByOrganization(organizationId: string): Promise<Membership[]>;
  listByUser(userId: string): Promise<Membership[]>;
  update(id: string, data: UpdateMembershipInput): Promise<Membership>;
  delete(id: string): Promise<void>;
}

export function validateRole(role: string): asserts role is MemberRole {
  if (!MEMBERSHIP_ROLES.includes(role as MemberRole)) {
    throw new Error(
      `Invalid role: ${role}. Must be one of ${MEMBERSHIP_ROLES.join(", ")}`
    );
  }
}

function membershipToApproval(m: Membership): ApprovalMembership {
  return {
    userId: m.userId,
    organizationId: m.organizationId,
    role: m.role,
    status: "active",
  };
}

export async function addMember(
  store: MembershipStore,
  org: Organization,
  userId: string,
  role: MemberRole,
  options?: { permissions?: string[]; metadata?: Record<string, unknown> }
): Promise<Membership> {
  validateRole(role);
  const existing = await store.getByUserAndOrg(userId, org.id);
  if (existing) {
    throw new Error("User is already a member of this organization");
  }
  const members = await store.listByOrganization(org.id);
  const approvalMemberships: ApprovalMembership[] = members.map(membershipToApproval);
  assertOrganizationCanAddMember({
    organizationId: org.id,
    memberships: approvalMemberships,
    seatLimit: org.maxMembers,
  });
  return store.create({
    userId,
    organizationId: org.id,
    role,
    permissions: options?.permissions ?? [],
    metadata: options?.metadata ?? {},
  });
}

export async function removeMember(
  store: MembershipStore,
  membershipId: string
): Promise<void> {
  const membership = await store.getById(membershipId);
  if (!membership) {
    throw new Error("Membership not found");
  }
  if (membership.role === "owner") {
    const members = await store.listByOrganization(membership.organizationId);
    const owners = members.filter((m) => m.role === "owner");
    if (owners.length <= 1) {
      throw new Error(
        "Cannot remove the last owner. Transfer ownership or add another owner first."
      );
    }
  }
  await store.delete(membershipId);
}

export async function updateMemberRole(
  store: MembershipStore,
  membershipId: string,
  role: MemberRole
): Promise<Membership> {
  validateRole(role);
  const membership = await store.getById(membershipId);
  if (!membership) {
    throw new Error("Membership not found");
  }
  if (membership.role === "owner" && role !== "owner") {
    const members = await store.listByOrganization(membership.organizationId);
    const owners = members.filter((m) => m.role === "owner");
    if (owners.length <= 1) {
      throw new Error(
        "Cannot demote the last owner. Transfer ownership or add another owner first."
      );
    }
  }
  return store.update(membershipId, { role });
}

export async function getMembership(
  store: MembershipStore,
  id: string
): Promise<Membership | null> {
  return store.getById(id);
}

export async function getMembershipByUserAndOrg(
  store: MembershipStore,
  userId: string,
  organizationId: string
): Promise<Membership | null> {
  return store.getByUserAndOrg(userId, organizationId);
}

export async function listOrganizationMembers(
  store: MembershipStore,
  organizationId: string
): Promise<Membership[]> {
  return store.listByOrganization(organizationId);
}

export async function listUserMemberships(
  store: MembershipStore,
  userId: string
): Promise<Membership[]> {
  return store.listByUser(userId);
}

export function countMembers(memberships: Membership[]): number {
  return memberships.length;
}

export function canAddMember(
  org: Organization,
  currentMemberCount: number
): boolean {
  if (org.maxMembers === null) return true;
  return currentMemberCount < org.maxMembers;
}
