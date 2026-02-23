import { isActiveMember, type OrganizationMembership } from "./member-approval.js";

export interface SeatUsage {
  organizationId: string;
  seatCount: number;
}

export function countActiveSeats(
  memberships: OrganizationMembership[]
): number {
  return memberships.filter((m) => isActiveMember(m)).length;
}

export function canAddSeat(
  seatsInUse: number,
  seatLimit: number | null
): boolean {
  if (seatLimit === null) return true;
  return seatsInUse < seatLimit;
}

export function getSeatUsage(
  organizationId: string,
  memberships: OrganizationMembership[]
): SeatUsage {
  return {
    organizationId,
    seatCount: countActiveSeats(memberships),
  };
}

export interface OrganizationMembershipsInput {
  organizationId: string;
  memberships: OrganizationMembership[];
}

export function getBillingSeatReport(
  organizations: OrganizationMembershipsInput[]
): SeatUsage[] {
  return organizations.map(({ organizationId, memberships }) =>
    getSeatUsage(organizationId, memberships)
  );
}
