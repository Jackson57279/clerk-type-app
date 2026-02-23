export type MembershipStatus = "pending" | "active" | "rejected";

export type MemberRole = "owner" | "admin" | "editor" | "member" | "guest";

export interface OrganizationApprovalSettings {
  memberApprovalRequired?: boolean;
}

export interface OrganizationMembership {
  userId: string;
  organizationId: string;
  role: MemberRole;
  status: MembershipStatus;
}

const APPROVER_ROLES: MemberRole[] = ["owner", "admin"];

export function getNewMemberStatus(
  settings: OrganizationApprovalSettings
): MembershipStatus {
  return settings.memberApprovalRequired === true ? "pending" : "active";
}

export function canApproveOrRejectMembers(role: MemberRole): boolean {
  return APPROVER_ROLES.includes(role);
}

export function approveMembership(
  membership: OrganizationMembership
): OrganizationMembership {
  if (membership.status !== "pending") {
    throw new Error("Only pending memberships can be approved");
  }
  return { ...membership, status: "active" };
}

export function rejectMembership(
  membership: OrganizationMembership
): OrganizationMembership {
  if (membership.status !== "pending") {
    throw new Error("Only pending memberships can be rejected");
  }
  return { ...membership, status: "rejected" };
}

export function isActiveMember(membership: OrganizationMembership): boolean {
  return membership.status === "active";
}

export function isPendingMember(membership: OrganizationMembership): boolean {
  return membership.status === "pending";
}
